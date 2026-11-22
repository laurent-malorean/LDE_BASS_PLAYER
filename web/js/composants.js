// Composants interactifs : lecteur de tablature, quiz du manche, panneau des mains.
import { h, toast } from './ui.js';
import { etat, reglage, personnaliser } from './etat.js';
import { creerManche } from './fretboard.js';
import { creerTablature } from './tab.js';
import { parserNotes, ajouterDoigtes, nomNote, cordesAffichees, CORDES, midiDe, pitchClass } from './music.js';
import { Sequenceur } from './audio.js';
import { Micro, Validateur } from './pitch.js';
import * as api from './api.js';

/** Gestion de nettoyage : chaque composant s'enregistre pour être arrêté en quittant la page. */
export const nettoyages = new Set();
export function arreterTout() { for (const f of [...nettoyages]) f(); nettoyages.clear(); }

export function panneauMains() {
  const p = etat.player;
  const pince = p.main_pincement, frette = p.main_frette;
  return h('details', { class: 'mains', open: true },
    h('summary', {}, `Placement des mains (${p.main_dominante})`),
    h('div', { class: 'deux-colonnes' },
      h('div', {},
        h('h4', {}, `Main ${pince} — elle pince les cordes`),
        h('ul', {},
          h('li', {}, h('b', {}, 'Ancrage : '), 'pouce posé sur le micro (ou sur la corde grave en dessous de celle que tu joues).'),
          h('li', {}, h('b', {}, 'i et m : '), 'index (i) et majeur (m) jouent en alternance, toujours i puis m puis i…'),
          h('li', {}, h('b', {}, 'Placement : '), 'doigts légèrement courbés, tu pinces vers la corde grave et tu t’arrêtes dessus.'),
          h('li', {}, h('b', {}, 'Cordes plus aiguës : '), 'le pouce descend d’une corde à chaque fois (« pouce flottant »).'),
          h('li', {}, h('b', {}, 'Poignet : '), 'détendu, dans l’axe de l’avant-bras, pas de crispation.'))),
      h('div', {},
        h('h4', {}, `Main ${frette} — elle appuie sur le manche`),
        h('ul', {},
          h('li', {}, h('b', {}, 'Un doigt par frette : '), 'index = frette de départ, majeur = +1, annulaire = +2, auriculaire = +3.'),
          h('li', {}, h('b', {}, 'Appui : '), 'sur le bout du doigt, juste derrière la frette (côté sillet), pas dessus.'),
          h('li', {}, h('b', {}, 'Pouce : '), 'derrière le manche, vers le milieu, jamais enroulé au-dessus.'),
          h('li', {}, h('b', {}, 'Corde à vide : '), 'notée ○ au-dessus de la tablature, aucun doigt posé.'),
          h('li', {}, h('b', {}, 'Doigts levés : '), 'garde-les proches des cordes, prêts à retomber.'))),
    ),
    h('p', { class: 'legende' }, 'Sur la tablature : le chiffre au-dessus = doigt de la main ', frette, ' ; la lettre en dessous = doigt de la main ', pince, ' ; puis le comptage des temps.'));
}

/** Lecteur de tablature : écoute (son + métronome) ou « à moi de jouer » avec validation au micro. */
export function lecteurTablature(ex, { complet = false } = {}) {
  const { evenements, total, erreurs } = parserNotes(ex.notes);
  ajouterDoigtes(evenements, { gauche: ex.doigtes_gauche !== 'aucun' }); // 'aucun' : déplacements de main, doigté laissé libre
  const [pulses] = String(ex.chiffrage ?? '4/4').split('/').map(Number);
  const tpm = pulses || 4;
  const racine = h('div', { class: 'lecteur' });
  if (erreurs.length) racine.append(h('p', { class: 'erreur' }, erreurs.join(' ; ')));

  const tab = creerTablature(evenements, { player: etat.player, tempsParMesure: tpm, largeurMax: complet ? 1150 : 900 });
  racine.append(h('div', { class: 'tab-conteneur' }, tab.svg));
  const doigtsGauche = ex.doigtes_gauche !== 'aucun';
  racine.append(h('p', { class: 'legende legende-tab' },
    doigtsGauche ? h('span', {}, h('b', { class: 'cle-frette' }, 'Au-dessus'), ` : doigt de la main ${etat.player.main_frette} (1 index · 2 majeur · 3 annulaire · 4 auriculaire · ○ corde à vide)`) : null,
    doigtsGauche ? ' — ' : null,
    h('span', {}, h('b', { class: 'cle-pince' }, 'En dessous'), ` : doigt de la main ${etat.player.main_pincement} (i index · m majeur), puis le comptage des temps.`)));

  const seq = new Sequenceur(etat.audio);
  let bpm = Math.round(ex.bpm ?? reglage('audio.metronome.bpm_defaut'));
  let metronome = false;
  let boucle = false;
  let decompte = reglage('audio.metronome.decompte_mesures');
  let mode = null; // null | 'ecoute' | 'micro'
  let micro = null;

  const statut = h('div', { class: 'statut', 'aria-live': 'polite' });
  const temoin = h('div', { class: 'temoin-temps' });
  for (let i = 0; i < tpm; i++) temoin.append(h('span', { class: 'point' }));
  const btnJouer = h('button', { class: 'btn primaire', onClick: () => (mode ? arreter() : jouer()) }, '▶ Jouer');
  const btnMicro = h('button', { class: 'btn', onClick: () => (mode ? arreter() : jouerMicro()) }, '🎤 À moi de jouer');
  const sliderBpm = h('input', { type: 'range', min: 30, max: 200, value: bpm, 'aria-label': 'Tempo' });
  const lblBpm = h('output', {}, `${bpm} BPM`);
  sliderBpm.addEventListener('input', () => {
    bpm = +sliderBpm.value; lblBpm.textContent = `${bpm} BPM`;
    if (mode === 'ecoute') jouer(); // redémarre au nouveau tempo
  });
  const chkMetro = h('input', { type: 'checkbox' });
  chkMetro.addEventListener('change', () => { metronome = chkMetro.checked; if (mode === 'ecoute') jouer(); });
  const chkBoucle = h('input', { type: 'checkbox' });
  chkBoucle.addEventListener('change', () => { boucle = chkBoucle.checked; });
  const selDecompte = h('select', { 'aria-label': 'Décompte' }, [0, 1, 2].map((n) => h('option', { value: n, selected: n === decompte }, n === 0 ? 'pas de décompte' : `${n} mesure${n > 1 ? 's' : ''} de décompte`)));
  selDecompte.addEventListener('change', () => { decompte = +selDecompte.value; });

  racine.append(h('div', { class: 'controles' },
    btnJouer, btnMicro, temoin,
    h('label', {}, 'Tempo ', sliderBpm, ' ', lblBpm),
    h('label', {}, chkMetro, ' métronome'),
    h('label', {}, chkBoucle, ' boucle'),
    h('label', {}, selDecompte)));
  racine.append(statut);

  function pulse({ posMesure, decompte: dec }) {
    [...temoin.children].forEach((p, i) => p.classList.toggle('on', i === posMesure));
    temoin.classList.toggle('decompte', dec);
    if (dec) statut.textContent = `Décompte… ${posMesure + 1}`;
  }

  function interface_(etatMode) {
    mode = etatMode;
    btnJouer.textContent = mode === 'ecoute' ? '■ Stop' : '▶ Jouer';
    btnMicro.textContent = mode === 'micro' ? '■ Stop' : '🎤 À moi de jouer';
    btnJouer.disabled = mode === 'micro';
    btnMicro.disabled = mode === 'ecoute';
    if (!mode) { [...temoin.children].forEach((p) => p.classList.remove('on')); tab.activer(null); }
  }

  function jouer() {
    arreter(false);
    if (!evenements.length) return;
    interface_('ecoute');
    statut.textContent = '';
    tab.effacerMarques();
    seq.demarrer({
      bpm, tempsParMesure: tpm, evenements, total, metronome, decompte, boucle,
      onTemps: pulse,
      onNote: (i) => { tab.activer(i); statut.textContent = ''; },
      onFin: () => { interface_(null); statut.textContent = 'Terminé.'; },
    });
  }

  async function jouerMicro() {
    arreter(false);
    if (!reglage('micro.actif')) { toast('Le micro est désactivé dans la configuration.', 'erreur'); return; }
    // Pas de validation pour les silences, les notes mortes (pas de hauteur) ni les notes liées ou glissées (pas d'attaque).
    const notes = evenements.map((e, i) => ({ e, i })).filter((x) => !x.e.silence && !x.e.mort && !(x.e.sansAttaque && (x.e.liePar === 't' || x.e.liePar === 's')));
    if (!notes.length) return;
    let pos = 0; let fautes = 0; let fini = false;
    const validateur = new Validateur({
      toleranceCents: reglage('micro.tolerance_cents'),
      onJuste: () => {
        tab.marquer(notes[pos].i, 'juste');
        pos++;
        if (pos >= notes.length) { terminer(); return; }
        tab.activer(notes[pos].i); validateur.attendre(notes[pos].e.midi);
        statut.textContent = '✔ Juste !';
      },
      onFaux: (m) => { fautes++; statut.textContent = `J’entends ${nomNote(m.midi, etat.player.notation_notes)} — attendu : ${nomNote(notes[pos].e.midi, etat.player.notation_notes)}`; },
    });
    micro = new Micro();
    try {
      await micro.demarrer({ peripherique: reglage('micro.peripherique'), sensibilite: reglage('micro.sensibilite'), surMesure: (m) => validateur.mesure(m) });
    } catch (err) {
      micro = null;
      toast(`Micro inaccessible : ${err.message}. Autorise le micro dans le navigateur.`, 'erreur');
      return;
    }
    interface_('micro');
    tab.effacerMarques();
    tab.activer(notes[0].i); validateur.attendre(notes[0].e.midi);
    statut.textContent = 'À toi ! Joue la note surlignée.';
    if (metronome) {
      seq.demarrer({ bpm, tempsParMesure: tpm, evenements: [], total: tpm, metronome: true, decompte, boucle: true, onTemps: pulse });
    }
    async function terminer() {
      if (fini) return; fini = true;
      arreter(false);
      interface_(null);
      statut.textContent = `Bravo ! ${notes.length} notes justes, ${fautes} fausse${fautes > 1 ? 's' : ''} détectée${fautes > 1 ? 's' : ''}.`;
      if (complet) {
        try { await api.noterExercice(ex.id, { mode: 'micro', bpm, fautes, notes: notes.length, reussi: fautes <= Math.ceil(notes.length / 4) }); } catch { /* hors ligne */ }
        rafraichirBilan();
      }
    }
  }

  function arreter(maj = true) {
    seq.arreter();
    if (micro) { micro.arreter(); micro = null; }
    if (maj) { interface_(null); statut.textContent = ''; }
  }
  nettoyages.add(() => arreter(false));

  const bilan = h('div', { class: 'bilan' });
  async function rafraichirBilan() {
    if (!complet || !ex.id) return;
    const d = await api.lire('exercices/' + ex.id);
    bilan.replaceChildren(d
      ? h('p', {}, `Essais : ${d.essais} · Meilleur tempo réussi : ${d.meilleur_bpm || '—'} BPM`)
      : h('p', { class: 'discret' }, 'Pas encore d’essai enregistré pour cet exercice.'));
  }
  if (complet) {
    racine.append(bilan);
    rafraichirBilan();
    racine.append(h('div', { class: 'controles' }, h('button', {
      class: 'btn', onClick: async () => {
        await api.noterExercice(ex.id, { mode: 'manuel', bpm, reussi: true });
        toast(`Séance notée à ${bpm} BPM`, 'ok'); rafraichirBilan();
      },
    }, '✔ J’ai réussi à ce tempo (noter)')));
  }
  return racine;
}

/** Quiz : « où est la note X sur la corde Y ? » — réponse au clic ou avec la vraie basse (micro). */
export function quizManche({ frettes = 12 } = {}) {
  const notation = etat.player.notation_notes;
  const cordes = cordesAffichees(etat.player);
  const racine = h('div', { class: 'quiz' });
  const question = h('p', { class: 'question' });
  const retour = h('p', { class: 'retour', 'aria-live': 'polite' });
  const score = h('p', { class: 'score' });
  const zone = h('div');
  let cible = null; let bon = 0; let total = 0; let serie = 0;
  let micro = null; let validateur = null;
  const chkMicro = h('input', { type: 'checkbox' });
  const manche = creerManche({ player: etat.player, frettes, afficher: 'aucune', taille: reglage('interface.taille_manche'), onClic: (c) => repondre(c) });
  zone.append(manche.svg);

  function tirer() {
    let c;
    do {
      const corde = cordes[Math.floor(Math.random() * cordes.length)];
      const frette = Math.floor(Math.random() * (frettes + 1));
      c = { corde, frette, midi: midiDe(corde, frette) };
    } while (cible && c.corde === cible.corde && c.frette === cible.frette);
    cible = c;
    manche.effacer('juste'); manche.effacer('faux'); manche.effacer('montre');
    question.textContent = `Où est la note ${nomNote(c.midi, notation)} sur la corde de ${nomNote(CORDES[c.corde], notation)} ?`;
    validateur?.attendre(c.midi);
  }
  async function noter(c, ok) {
    const q = (await api.lire('quiz')) ?? {};
    q.notes ??= {}; // tolère un fichier incomplet ou ancien
    const k = nomNote(c.midi, 'anglo') + '@' + c.corde;
    const n = (q.notes[k] ??= { ok: 0, ko: 0 });
    ok ? n.ok++ : n.ko++;
    api.ecrire('quiz', q).catch(() => {});
  }
  function repondre(c) {
    if (!cible) return;
    total++;
    const juste = c.corde === cible.corde && pitchClass(c.midi) === pitchClass(cible.midi);
    if (juste) {
      bon++; serie++;
      manche.marquer(c.corde, c.frette, 'juste');
      retour.textContent = '✔ Exact !'; retour.className = 'retour ok';
      etat.audio.jouerNote(c.midi);
    } else {
      serie = 0;
      manche.marquer(c.corde, c.frette, 'faux', nomNote(c.midi, notation));
      manche.marquer(cible.corde, cible.frette, 'montre');
      retour.textContent = `✘ C’était ici (frette ${cible.frette}).`; retour.className = 'retour ko';
    }
    noter(cible, juste);
    score.textContent = `Score : ${bon}/${total} · série : ${serie}`;
    setTimeout(tirer, juste ? 700 : 1800);
  }
  async function basculerMicro() {
    if (!chkMicro.checked) { micro?.arreter(); micro = null; validateur = null; return; }
    micro = new Micro();
    validateur = new Validateur({
      toleranceCents: reglage('micro.tolerance_cents'),
      onJuste: () => repondre({ corde: cible.corde, frette: cible.frette, midi: cible.midi }),
      onFaux: () => { retour.textContent = 'Pas tout à fait… essaie encore.'; retour.className = 'retour'; },
    });
    try {
      await micro.demarrer({ peripherique: reglage('micro.peripherique'), sensibilite: reglage('micro.sensibilite'), surMesure: (m) => validateur?.mesure(m) });
      validateur.attendre(cible.midi);
    } catch (e) { toast('Micro inaccessible : ' + e.message, 'erreur'); chkMicro.checked = false; micro = null; validateur = null; }
  }
  chkMicro.addEventListener('change', basculerMicro);
  nettoyages.add(() => micro?.arreter());

  racine.append(question, zone, retour, score,
    h('label', {}, chkMicro, ' Répondre en jouant sur ma basse (micro) — la note doit sonner, peu importe la corde'),
    h('button', { class: 'btn', onClick: tirer }, 'Question suivante'));
  tirer();
  return racine;
}
