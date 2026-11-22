import { h, toast } from './ui.js';
import * as api from './api.js';
import { etat, reglage, modifierReglage } from './etat.js';
import { rendreMarkdown } from './widgets.js';
import { lecteurTablature, quizManche, panneauMains, nettoyages } from './composants.js';
import { Sequenceur } from './audio.js';
import { Micro, detecterHauteur } from './pitch.js';
import { nomNote, nomNoteAvecOctave, CORDES, accordage } from './music.js';

const CATS = { theorie: 'Théorie', manche: 'Le manche' };

async function progression() { return (await api.lire('progression')) ?? { lecons_terminees: [] }; }

export async function accueil(zone) {
  const [lecs, exos, prog, session] = await Promise.all([api.lecons(), api.exercices(), progression(), api.lire('sessions/' + api.aujourdhui())]);
  const toutes = Object.entries(lecs).flatMap(([cat, l]) => l.map((x) => ({ ...x, cat })));
  const faites = new Set(prog.lecons_terminees);
  const prochaine = toutes.find((l) => !faites.has(`${l.cat}/${l.id}`));
  const p = etat.player;
  zone.append(
    h('h1', {}, 'Bass Player'),
    h('p', { class: 'intro' }, `Basse ${p.basse.cordes} cordes (${p.basse.accordage.join('‑')}, ${p.basse.type}) · ${p.main_dominante} · niveau ${p.niveau}`),
    h('div', { class: 'cartes' },
      h('div', { class: 'carte' }, h('h3', {}, 'Progression'), h('p', { class: 'gros' }, `${faites.size}/${toutes.length}`), h('p', {}, 'leçons terminées')),
      h('div', { class: 'carte' }, h('h3', {}, 'Aujourd’hui'), h('p', { class: 'gros' }, `${Math.round(session?.minutes ?? 0)} min`), h('p', {}, `objectif : ${p.temps_pratique_min_par_jour} min`)),
      h('div', { class: 'carte' }, h('h3', {}, 'Exercices'), h('p', { class: 'gros' }, String(exos.length)), h('p', {}, 'disponibles')),
    ),
    prochaine
      ? h('div', { class: 'reprendre' }, h('h2', {}, 'Continuer'), h('a', { class: 'btn primaire', href: `#/${prochaine.cat}/${prochaine.id}` }, `${CATS[prochaine.cat]} : ${prochaine.titre}`))
      : h('p', {}, 'Toutes les leçons sont terminées. Bravo ! Continue avec les exercices.'),
    h('div', { class: 'raccourcis' },
      h('a', { class: 'btn', href: '#/exercices' }, 'Exercices en tablature'),
      h('a', { class: 'btn', href: '#/metronome' }, 'Métronome'),
      h('a', { class: 'btn', href: '#/accordeur' }, 'Accordeur')),
  );
}

export async function listeLecons(zone, [cat]) {
  const [lecs, prog] = await Promise.all([api.lecons(), progression()]);
  const faites = new Set(prog.lecons_terminees);
  zone.append(h('h1', {}, CATS[cat]));
  if (cat === 'manche') {
    zone.append(h('section', {}, h('h2', {}, 'Quiz : trouve la note'), quizManche({ frettes: 12 })), panneauMains());
    zone.append(h('h2', {}, 'Leçons'));
  }
  zone.append(h('ul', { class: 'liste-lecons' }, (lecs[cat] ?? []).map((l) =>
    h('li', {}, h('a', { href: `#/${cat}/${l.id}` }, (faites.has(`${cat}/${l.id}`) ? '✔ ' : '') + l.titre), l.resume ? h('span', { class: 'discret' }, ' — ' + l.resume) : null))));
}

export async function lecon(zone, [cat, id]) {
  const l = await api.lecon(cat, id);
  if (!l) { zone.append(h('p', {}, 'Leçon introuvable.')); return; }
  const prog = await progression();
  const cle = `${cat}/${id}`;
  const bouton = h('button', { class: 'btn primaire' });
  const maj = () => { bouton.textContent = prog.lecons_terminees.includes(cle) ? '✔ Terminée (cliquer pour annuler)' : 'Marquer comme terminée'; };
  maj();
  bouton.addEventListener('click', async () => {
    const i = prog.lecons_terminees.indexOf(cle);
    i >= 0 ? prog.lecons_terminees.splice(i, 1) : prog.lecons_terminees.push(cle);
    await api.ecrire('progression', prog); maj();
  });
  const debut = Date.now();
  nettoyages.add(() => {
    const min = (Date.now() - debut) / 60000;
    if (min > 0.3) api.noterActivite({ type: 'lecon', id: cle, minutes: Math.round(min * 10) / 10 }).catch(() => {});
  });
  zone.append(h('p', { class: 'fil' }, h('a', { href: `#/${cat}` }, CATS[cat]), ' › ', l.titre), h('h1', {}, l.titre), rendreMarkdown(l.markdown), h('div', { class: 'pied-lecon' }, bouton));
}

const ONGLETS = [
  { cle: 'cours', titre: 'Exercices du cours', vide: 'Aucun exercice du cours.' },
  { cle: 'perso', titre: 'Mes tablatures', vide: 'Tu n’as pas encore de tablature perso. Dépose un fichier .yml dans perso/data/mes-tablatures/ (même format que content/exercices/, voir le README) : il apparaîtra ici.' },
];

export async function exercices(zone) {
  const liste = await api.exercices();
  const stats = new Map((await Promise.all(liste.map(async (e) => [e.id, await api.lire('exercices/' + e.id)]))));
  let courant = reglage('interface.onglet_exercices') === 'perso' ? 'perso' : 'cours';
  const panneau = h('div', { role: 'tabpanel', id: 'panneau-exercices' });
  const barre = h('div', { class: 'onglets', role: 'tablist', 'aria-label': 'Type d’exercices' });

  const dessiner = () => {
    for (const b of barre.children) {
      const actif = b.dataset.cle === courant;
      b.setAttribute('aria-selected', actif);
      b.tabIndex = actif ? 0 : -1;
      b.classList.toggle('actif', actif);
    }
    const o = ONGLETS.find((x) => x.cle === courant);
    const items = liste.filter((e) => e.source === courant);
    panneau.setAttribute('aria-labelledby', `onglet-${courant}`);
    panneau.replaceChildren(items.length
      ? h('ul', { class: 'liste-lecons' }, items.map((e) => {
        const st = stats.get(e.id);
        return h('li', {},
          h('a', { href: `#/exercices/${e.id}` }, e.titre ?? e.id),
          e.niveau ? h('span', { class: 'badge' }, e.niveau) : null,
          st ? h('span', { class: 'discret' }, ` · ${st.essais} essai(s), meilleur ${st.meilleur_bpm || '—'} BPM`) : null,
          e.erreur ? h('span', { class: 'erreur' }, ' ' + e.erreur) : null);
      }))
      : h('p', { class: 'discret' }, o.vide));
  };
  const choisir = (cle, { focus = false } = {}) => {
    if (cle === courant) return;
    courant = cle; dessiner();
    if (focus) barre.querySelector(`[data-cle="${cle}"]`).focus();
    modifierReglage('interface.onglet_exercices', cle).catch(() => {}); // mémorisé dans data/reglages.json
  };
  for (const o of ONGLETS) {
    const n = liste.filter((e) => e.source === o.cle).length;
    const b = h('button', { class: 'onglet', role: 'tab', id: `onglet-${o.cle}`, 'data-cle': o.cle, 'aria-controls': 'panneau-exercices', type: 'button' },
      o.titre, h('span', { class: 'badge' }, String(n)));
    b.addEventListener('click', () => choisir(o.cle));
    b.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        choisir(ONGLETS.find((x) => x.cle !== courant).cle, { focus: true });
      }
    });
    barre.append(b);
  }
  zone.append(h('h1', {}, 'Exercices en tablature'), barre, panneau);
  dessiner();
}

export async function exercice(zone, [id]) {
  const ex = await api.exercice(id);
  if (!ex || ex.erreur) { zone.append(h('p', { class: 'erreur' }, ex?.erreur ?? 'Exercice introuvable.')); return; }
  if (reglage('interface.onglet_exercices') !== ex.source && (ex.source === 'perso' || ex.source === 'cours')) modifierReglage('interface.onglet_exercices', ex.source).catch(() => {});
  const debut = Date.now();
  nettoyages.add(() => {
    const min = (Date.now() - debut) / 60000;
    if (min > 0.3) api.noterActivite({ type: 'exercice', id, minutes: Math.round(min * 10) / 10 }).catch(() => {});
  });
  zone.append(
    h('p', { class: 'fil' }, h('a', { href: '#/exercices' }, 'Exercices'), ' › ', ONGLETS.find((o) => o.cle === ex.source)?.titre ?? '', ' › ', ex.titre ?? id),
    h('h1', {}, ex.titre ?? id),
    ex.origine ? h('p', { class: 'discret' }, '♪ ' + ex.origine) : null,
    ex.consigne ? h('p', { class: 'intro' }, ex.consigne) : null,
    lecteurTablature(ex, { complet: true }),
    ex.conseils?.length ? h('div', {}, h('h3', {}, 'Conseils'), h('ul', {}, ex.conseils.map((c) => h('li', {}, c)))) : null,
    panneauMains());
}

export function metronome(zone) {
  const audio = etat.audio;
  const seq = new Sequenceur(audio);
  let bpm = reglage('audio.metronome.bpm_defaut');
  let [pulses, unite] = String(reglage('audio.metronome.chiffrage')).split('/').map(Number);
  let subdivision = 1; let actif = false;
  const taps = [];
  const sortie = h('div', { class: 'bpm-gros', 'aria-live': 'off' }, String(bpm));
  const temoin = h('div', { class: 'temoin-gros' });
  const slider = h('input', { type: 'range', min: 30, max: 240, value: bpm, 'aria-label': 'Tempo' });
  const btn = h('button', { class: 'btn primaire gros-btn' }, '▶ Démarrer');
  const selMesure = h('select', { 'aria-label': 'Chiffrage' }, ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'].map((c) => h('option', { value: c, selected: c === `${pulses}/${unite}` }, c)));
  const selSub = h('select', { 'aria-label': 'Subdivision' }, [[1, 'aucune'], [2, 'croches'], [3, 'triolets'], [4, 'doubles-croches']].map(([v, t]) => h('option', { value: v }, t)));
  const selSon = h('select', { 'aria-label': 'Son' }, ['clic', 'bois', 'cloche'].map((s) => h('option', { value: s, selected: s === audio.sonMetro }, s)));
  const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: audio.volumeMetro, 'aria-label': 'Volume du métronome' });

  const dessinerPoints = () => { temoin.replaceChildren(...Array.from({ length: pulses }, (_, i) => h('span', { class: 'point' + (i === 0 ? ' accent' : '') }))); };
  dessinerPoints();
  function lancer() {
    seq.arreter();
    if (!actif) return;
    seq.demarrer({
      bpm, tempsParMesure: pulses, evenements: [], total: pulses, metronome: true, decompte: 0, boucle: true, subdivision,
      onTemps: ({ posMesure }) => [...temoin.children].forEach((p, i) => p.classList.toggle('on', i === posMesure)),
    });
  }
  const reglerBpm = (v) => { bpm = Math.max(30, Math.min(240, Math.round(v))); slider.value = bpm; sortie.textContent = bpm; if (actif) lancer(); };
  btn.addEventListener('click', () => { actif = !actif; btn.textContent = actif ? '■ Arrêter' : '▶ Démarrer'; lancer(); if (!actif) [...temoin.children].forEach((p) => p.classList.remove('on')); });
  slider.addEventListener('input', () => reglerBpm(+slider.value));
  selMesure.addEventListener('change', () => { [pulses, unite] = selMesure.value.split('/').map(Number); dessinerPoints(); if (actif) lancer(); });
  selSub.addEventListener('change', () => { subdivision = +selSub.value; if (actif) lancer(); });
  selSon.addEventListener('change', () => { audio.sonMetro = selSon.value; modifierReglage('audio.metronome.son', selSon.value); });
  vol.addEventListener('input', () => { audio.volumeMetro = +vol.value; });
  vol.addEventListener('change', () => modifierReglage('audio.metronome.volume', +vol.value));
  const tap = () => {
    const now = performance.now();
    if (taps.length && now - taps.at(-1) > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length >= 2) {
      const dernier = taps.slice(-6);
      reglerBpm(60000 / ((dernier.at(-1) - dernier[0]) / (dernier.length - 1)));
    }
  };
  nettoyages.add(() => { seq.arreter(); });
  const debut = Date.now();
  nettoyages.add(() => { const m = (Date.now() - debut) / 60000; if (actif && m > 0.3) api.noterActivite({ type: 'metronome', minutes: Math.round(m * 10) / 10 }).catch(() => {}); });

  zone.append(h('h1', {}, 'Métronome'),
    h('div', { class: 'metro' }, sortie, h('div', { class: 'discret' }, 'BPM'), temoin,
      h('div', { class: 'ligne' }, h('button', { class: 'btn', onClick: () => reglerBpm(bpm - 5), 'aria-label': 'Moins 5' }, '−5'), h('button', { class: 'btn', onClick: () => reglerBpm(bpm - 1), 'aria-label': 'Moins 1' }, '−1'), slider, h('button', { class: 'btn', onClick: () => reglerBpm(bpm + 1), 'aria-label': 'Plus 1' }, '+1'), h('button', { class: 'btn', onClick: () => reglerBpm(bpm + 5), 'aria-label': 'Plus 5' }, '+5')),
      h('div', { class: 'ligne' }, btn, h('button', { class: 'btn', onClick: tap }, 'Tap tempo')),
      h('div', { class: 'ligne' }, h('label', {}, 'Mesure ', selMesure), h('label', {}, 'Subdivision ', selSub), h('label', {}, 'Son ', selSon), h('label', {}, 'Volume ', vol))));
}

export async function accordeur(zone) {
  const notation = etat.player.notation_notes;
  const cordes = accordage(etat.player);
  const nom = h('div', { class: 'tuner-note' }, '—');
  const detail = h('div', { class: 'discret' }, 'Appuie sur « Écouter » puis pince une corde à vide.');
  const aiguille = h('div', { class: 'aiguille' });
  const jauge = h('div', { class: 'jauge' }, h('span', { class: 'zero' }), aiguille);
  const refs = h('div', { class: 'refs' }, cordes.slice().reverse().map((c) => h('button', { class: 'btn', onClick: () => etat.audio.jouerNote(CORDES[c], 0, 2) }, `${nomNote(CORDES[c], notation)} (${c})`)));
  let micro = null;
  const btn = h('button', { class: 'btn primaire gros-btn' }, '🎤 Écouter');
  btn.addEventListener('click', async () => {
    if (micro) { micro.arreter(); micro = null; btn.textContent = '🎤 Écouter'; return; }
    micro = new Micro();
    try {
      await micro.demarrer({ peripherique: reglage('micro.peripherique'), sensibilite: reglage('micro.sensibilite'), surMesure: (m) => {
        if (!m.valide) return;
        nom.textContent = nomNoteAvecOctave(m.midi, notation);
        const c = Math.round(m.cents);
        detail.textContent = `${m.freq.toFixed(1)} Hz · ${c > 0 ? '+' : ''}${c} cents ${Math.abs(c) <= 5 ? '— accordée ✔' : c < 0 ? '— trop grave, serre un peu' : '— trop aigu, desserre un peu'}`;
        aiguille.style.left = `${50 + Math.max(-50, Math.min(50, c))}%`;
        jauge.classList.toggle('ok', Math.abs(c) <= 5);
      } });
      btn.textContent = '■ Arrêter';
    } catch (e) { micro = null; toast('Micro inaccessible : ' + e.message, 'erreur'); }
  });
  nettoyages.add(() => micro?.arreter());
  zone.append(h('h1', {}, 'Accordeur'), h('div', { class: 'tuner' }, nom, jauge, detail, btn), h('h3', {}, 'Notes de référence (écoute-les)'), refs);
}

export async function parametres(zone) {
  const c = etat.config; const p = etat.player;
  const champ = (label, chemin, type, extra = {}) => {
    const v = reglage(chemin);
    const input = type === 'select'
      ? h('select', {}, extra.options.map((o) => h('option', { value: o, selected: o === v }, o)))
      : h('input', { type, value: v, checked: type === 'checkbox' ? v : false, ...extra });
    input.addEventListener('change', async () => {
      const val = type === 'checkbox' ? input.checked : type === 'range' || type === 'number' ? +input.value : input.value;
      await modifierReglage(chemin, val); toast('Réglage enregistré', 'ok');
    });
    return h('label', { class: 'champ' }, label, input);
  };
  const fichier = h('input', { type: 'file', accept: 'application/json' });
  fichier.addEventListener('change', async () => {
    try { const n = await api.importer(JSON.parse(await fichier.files[0].text())); toast(`${n.fichiers} fichier(s) importé(s) (sauvegarde faite avant)`, 'ok'); }
    catch (e) { toast('Import impossible : ' + e.message, 'erreur'); }
  });
  zone.append(h('h1', {}, 'Paramètres'),
    h('section', {}, h('h2', {}, 'Réglages personnels'), h('p', { class: 'discret' }, 'Enregistrés dans data/reglages.json. Ils passent avant config.yml.'),
      champ('Volume général', 'audio.volume_general', 'range', { min: 0, max: 1, step: 0.05 }),
      champ('Volume du métronome', 'audio.metronome.volume', 'range', { min: 0, max: 1, step: 0.05 }),
      champ('Son du métronome', 'audio.metronome.son', 'select', { options: ['clic', 'bois', 'cloche'] }),
      champ('Décompte (mesures)', 'audio.metronome.decompte_mesures', 'number', { min: 0, max: 8 }),
      champ('Sensibilité du micro', 'micro.sensibilite', 'range', { min: 0, max: 1, step: 0.05 }),
      champ('Tolérance de justesse (cents)', 'micro.tolerance_cents', 'number', { min: 5, max: 100 }),
      champ('Thème', 'interface.theme', 'select', { options: ['auto', 'clair', 'sombre'] }),
      champ('Taille du manche', 'interface.taille_manche', 'select', { options: ['petite', 'moyenne', 'grande'] })),
    h('section', {}, h('h2', {}, 'Mon profil (player.md)'), h('p', { class: 'discret' }, 'À modifier directement dans le fichier player.md, puis recharger la page.'),
      h('dl', {}, [['Main dominante', p.main_dominante], ['Main qui appuie sur le manche', p.main_frette], ['Main qui pince', p.main_pincement], ['Basse', `${p.basse.cordes} cordes, ${p.basse.accordage.join('-')}, ${p.basse.type}`], ['Niveau', p.niveau], ['Notation', p.notation_notes]].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
    h('section', {}, h('h2', {}, 'Mes données'), h('p', { class: 'discret' }, 'Fichiers dans le dossier data/, sauvegardés automatiquement dans backups/.'),
      h('a', { class: 'btn', href: '/api/export', download: '' }, 'Exporter tout (JSON)'),
      h('label', { class: 'champ' }, 'Importer un export : ', fichier)),
    h('section', {}, h('h2', {}, 'Serveur'), h('p', { class: 'discret' }, `Port ${location.port} · configuré dans config.yml (serveur.port) ou avec npm start -- --port 4000.`)));
}
