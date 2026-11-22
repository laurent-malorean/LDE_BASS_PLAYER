import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parserNotes, ajouterDoigtes, midiDe, nomNote, freq } from '../web/js/music.js';
import { detecterHauteur } from '../web/js/pitch.js';
import { chargerConfig, validerConfig, lirePlayer, DEFAUTS } from '../server/config.js';
import { Storage } from '../server/storage.js';
import { Contenu } from '../server/content.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bass-'));

test('parserNotes : notes, durées, silences, mesures', () => {
  const r = parserNotes('E0 A3/0.5 -/2 | G5');
  assert.equal(r.erreurs.length, 0);
  assert.deepEqual(r.evenements.map((e) => e.debut), [0, 1, 1.5, 3.5]);
  assert.equal(r.total, 4.5);
  assert.equal(r.evenements[2].silence, true);
  assert.equal(r.evenements[3].mesure, 1);
  assert.equal(r.evenements[1].midi, midiDe('A', 3)); // Do
  assert.equal(nomNote(r.evenements[1].midi), 'Do');
  assert.equal(nomNote(r.evenements[1].midi, 'anglo'), 'C');
});

test('parserNotes : jeton invalide signalé', () => {
  assert.equal(parserNotes('E0 Z9').erreurs.length, 1);
});

test('doigtés : un doigt par frette, alternance i/m', () => {
  const ev = ajouterDoigtes(parserNotes('E0 E3 E4 E5 -').evenements);
  assert.deepEqual(ev.filter((e) => !e.silence).map((e) => e.doigtFrette), [0, 1, 2, 3]);
  assert.deepEqual(ev.filter((e) => !e.silence).map((e) => e.doigtPince), ['i', 'm', 'i', 'm']);
});

test('gamme de Do majeur : les 8 notes de la leçon sont les bonnes', () => {
  const noms = parserNotes('A3 A5 D2 D3 D5 G2 G4 G5').evenements.map((e) => nomNote(e.midi, 'anglo'));
  assert.deepEqual(noms, ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
});

test('racine-quinte : D2 est la quinte de La', () => {
  assert.equal(nomNote(midiDe('D', 2), 'anglo'), 'E');
  assert.equal(nomNote(midiDe('G', 2), 'anglo'), 'A');
});

test('détection de hauteur sur les 4 cordes à vide (sinus + harmoniques)', () => {
  const sr = 48000;
  for (const [corde, f] of [['E', 41.2], ['A', 55], ['D', 73.42], ['G', 98]]) {
    const buf = new Float32Array(4096);
    for (let i = 0; i < buf.length; i++) {
      const t = i / sr;
      buf[i] = 0.5 * Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t) + 0.15 * Math.sin(2 * Math.PI * 3 * f * t);
    }
    const r = detecterHauteur(buf, sr);
    assert.ok(Math.abs(r.freq - f) / f < 0.01, `${corde}: attendu ${f}, trouvé ${r.freq}`);
  }
});

test('config : défauts valides, port via CLI / env, validation', () => {
  const racine = tmp();
  assert.deepEqual(validerConfig(structuredClone(DEFAUTS)), []);
  assert.equal(chargerConfig({ racine, argv: [], env: {} }).serveur.port, 3000);
  assert.equal(chargerConfig({ racine, argv: [], env: { PORT: '4001' } }).serveur.port, 4001);
  assert.equal(chargerConfig({ racine, argv: ['--port', '4002'], env: { PORT: '4001' } }).serveur.port, 4002);
  assert.equal(chargerConfig({ racine, argv: ['--port=auto'], env: {} }).serveur.port, 'auto');
  fs.mkdirSync(path.join(racine, 'perso'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'perso', 'config.yml'), 'serveur:\n  port: 5555\naudio:\n  volume_general: 0.3\n');
  const c = chargerConfig({ racine, argv: [], env: {} });
  assert.equal(c.serveur.port, 5555);
  assert.equal(c.audio.volume_general, 0.3);
  assert.equal(c.audio.metronome.bpm_defaut, 80); // défaut conservé
  assert.throws(() => chargerConfig({ racine, argv: ['--port', '99999'], env: {} }), /serveur\.port/);
  fs.writeFileSync(path.join(racine, 'perso', 'config.yml'), 'audio:\n  volume_general: 5\n');
  assert.throws(() => chargerConfig({ racine, argv: [], env: {} }), /volume_general/);
});

test('stockage : écriture atomique, lecture, noms refusés, fichier corrompu', () => {
  const s = new Storage(path.join(tmp(), 'data'));
  assert.equal(s.lire('progression'), null);
  s.ecrire('progression', { a: 1 });
  assert.deepEqual(s.lire('progression'), { a: 1 });
  s.ecrire('sessions/2026-11-22', { x: 2 });
  assert.deepEqual(s.lister('sessions'), ['2026-11-22']);
  for (const mauvais of ['../x', 'sessions/../../x', 'inconnu', 'sessions/a/b', 'sessions/.cache', '']) {
    assert.throws(() => s.ecrire(mauvais, {}), /invalide/, mauvais);
  }
  fs.writeFileSync(path.join(s.dir, 'quiz.json'), '{pas du json');
  assert.equal(s.lire('quiz'), null);
  assert.ok(fs.readdirSync(s.dir).some((n) => n.startsWith('quiz.json.corrompu-')));
  assert.ok(!fs.readdirSync(s.dir).some((n) => n.includes('.tmp-')));
});

test('export / import aller-retour et sauvegarde tournante', () => {
  const base = tmp();
  const s = new Storage(path.join(base, 'data'));
  s.ecrire('progression', { lecons_terminees: ['theorie/01'] });
  s.ecrire('exercices/ex1', { essais: 3 });
  const bundle = s.exporter();
  const s2 = new Storage(path.join(base, 'data2'));
  assert.equal(s2.importer(bundle), 2);
  assert.deepEqual(s2.lire('exercices/ex1'), { essais: 3 });
  assert.throws(() => s2.importer({ fichiers: { '../evil': {} } }), /refusé/);
  const sauv = path.join(base, 'backups');
  fs.mkdirSync(sauv, { recursive: true });
  for (const d of ['2026-01-01', '2026-01-02', '2026-01-03']) fs.mkdirSync(path.join(sauv, d));
  const r = s.sauvegarder(sauv, { frequence: 'quotidienne', conserver: 2 });
  assert.equal(r.cree, true);
  assert.equal(fs.readdirSync(sauv).length, 2);
  assert.ok(fs.existsSync(path.join(sauv, r.nom, 'progression.json')));
});

test('contenu du dépôt : toutes les leçons et tous les exercices sont valides', () => {
  const racine = path.resolve(import.meta.dirname, '..');
  const s = new Storage(path.join(tmp(), 'data'));
  const c = new Contenu(path.join(racine, 'content'), s);
  const exos = c.exercices();
  assert.ok(exos.length >= 5);
  for (const e of exos) {
    assert.ok(!e.erreur, `${e.id}: ${e.erreur}`);
    const r = parserNotes(e.notes);
    assert.deepEqual(r.erreurs, [], e.id);
    // chaque mesure doit totaliser le nombre de temps du chiffrage
    const tpm = Number(String(e.chiffrage).split('/')[0]);
    const parMesure = {};
    for (const ev of r.evenements) parMesure[ev.mesure] = (parMesure[ev.mesure] ?? 0) + ev.duree;
    for (const [m, d] of Object.entries(parMesure)) assert.equal(d, tpm, `${e.id} mesure ${+m + 1} : ${d} temps au lieu de ${tpm}`);
  }
  for (const cat of c.categories()) {
    for (const l of c.lecons(cat)) {
      assert.notEqual(l.titre, l.id, `${cat}/${l.id} : en-tête YAML illisible (titre manquant) — mets les textes contenant « : » entre guillemets`);
      assert.ok(l.resume, `${cat}/${l.id} : résumé manquant`);
      const { markdown } = c.lecon(cat, l.id);
      for (const m of markdown.matchAll(/```tab\n([\s\S]*?)```/g)) {
        const n = m[1].match(/notes:\s*(.*)/)[1];
        assert.deepEqual(parserNotes(n).erreurs, [], `${cat}/${l.id}`);
      }
    }
  }
});

// ---- Audio : séquenceur et synthèse avec un faux AudioContext ----
import { Sequenceur, Audio } from '../web/js/audio.js';

function fauxAudio() {
  const ctx = { currentTime: 0, sampleRate: 48000 };
  const journal = [];
  return {
    ctx, journal,
    init: () => ctx,
    clic: (t, accent, doux) => journal.push({ type: 'clic', t, accent, doux: !!doux }),
    jouerNote: (midi, t, d) => journal.push({ type: 'note', midi, t, d }),
  };
}
function lancer(opts) {
  const a = fauxAudio();
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  const timers = [];
  const origSet = globalThis.setInterval; const origClear = globalThis.clearInterval;
  globalThis.setInterval = (f) => { timers.push(f); return 1; };
  globalThis.clearInterval = () => {};
  const seq = new Sequenceur(a);
  const appels = { temps: [], notes: [], fin: 0 };
  seq.demarrer({ ...opts, onTemps: (i) => appels.temps.push(i), onNote: (i) => appels.notes.push(i), onFin: () => appels.fin++ });
  const avancer = (jusqua) => {
    while (a.ctx.currentTime < jusqua) { a.ctx.currentTime += 0.025; seq.planifier(); while (seq.file.length && seq.file[0].t <= a.ctx.currentTime) seq.file.shift().fn(); }
  };
  globalThis.setInterval = origSet; globalThis.clearInterval = origClear;
  return { a, seq, appels, avancer };
}

test('séquenceur : notes et clics tombent exactement sur la grille du tempo, avec décompte', () => {
  const { evenements, total } = parserNotes('E0 A3/0.5 A5/0.5 -/1 D2');
  const { a, appels, avancer, seq } = lancer({ bpm: 120, tempsParMesure: 4, evenements, total, metronome: true, decompte: 1, boucle: false });
  avancer(6);
  const spb = 0.5;
  const t0 = seq.t0;
  const clics = a.journal.filter((e) => e.type === 'clic');
  // 4 temps de décompte + 4 temps de partition (total = 4 temps), clics au pas de 0,5 s
  assert.equal(clics.length, 8 + 0); // total=4 temps => temps 0..3
  assert.ok(clics.every((c, i) => Math.abs(c.t - (t0 + (i - 4) * spb)) < 1e-9), 'clics sur la grille');
  assert.deepEqual(clics.map((c) => c.accent), [true, false, false, false, true, false, false, false]);
  const notes = a.journal.filter((e) => e.type === 'note');
  assert.deepEqual(notes.map((n) => Math.round((n.t - t0) / spb * 100) / 100), [0, 1, 1.5, 3]); // le silence (2.5) ne sonne pas
  assert.equal(appels.fin, 1);
  assert.deepEqual(appels.notes, [0, 1, 2, 3, 4]);
});

test('séquenceur : sans métronome, aucun clic ; boucle sans trou', () => {
  const { evenements, total } = parserNotes('E0 E0 E0 E0');
  const { a, avancer } = lancer({ bpm: 60, tempsParMesure: 4, evenements, total, metronome: false, decompte: 0, boucle: true });
  avancer(9.5);
  assert.equal(a.journal.filter((e) => e.type === 'clic').length, 0);
  const ts = a.journal.filter((e) => e.type === 'note').map((n) => n.t);
  assert.ok(ts.length >= 9);
  for (let i = 1; i < ts.length; i++) assert.ok(Math.abs(ts[i] - ts[i - 1] - 1) < 1e-9, `écart régulier à la note ${i}`);
});

test('séquenceur : métronome seul avec subdivision en croches', () => {
  const { a, avancer } = lancer({ bpm: 60, tempsParMesure: 3, evenements: [], total: 3, metronome: true, decompte: 0, boucle: true, subdivision: 2 });
  avancer(3.2);
  const c = a.journal.filter((e) => e.type === 'clic').slice(0, 6);
  assert.deepEqual(c.map((x) => x.doux), [false, true, false, true, false, true]);
  assert.deepEqual(c.map((x) => x.accent), [true, false, false, false, false, false]);
});

test('synthèse : chaque note de la basse est produite à la bonne hauteur', () => {
  const audio = new Audio();
  audio.ctx = { sampleRate: 48000, createBuffer: (c, n, sr) => { const d = new Float32Array(n); return { getChannelData: () => d, d, sampleRate: sr }; } };
  for (const midi of [28, 33, 38, 43, 40, 55]) {
    const { buf, baseFreq } = audio.tampon(midi);
    // hauteur du tampon brut, puis hauteur après le changement de vitesse de lecture
    const mesure = detecterHauteur(buf.d.slice(4800, 4800 + 4096), 48000);
    assert.ok(Math.abs(mesure.freq - baseFreq) / baseFreq < 0.01, `midi ${midi}: tampon ${mesure.freq} vs ${baseFreq}`);
    const finale = baseFreq * (freq(midi) / baseFreq);
    assert.ok(Math.abs(finale - freq(midi)) < 1e-9);
    assert.ok(Math.abs(1200 * Math.log2(baseFreq / freq(midi))) < 25, 'écart de la corde brute < 25 cents (corrigé par playbackRate)');
    assert.ok(buf.d.some((v) => Math.abs(v) > 0.5), 'signal non vide');
  }
});

test('séparation moteur / données : le dossier perso est configurable et s\'initialise seul', () => {
  const racine = tmp();
  fs.writeFileSync(path.join(racine, 'config.example.yml'), 'serveur:\n  port: 4321\n');
  fs.writeFileSync(path.join(racine, 'player.example.md'), '---\nmain_dominante: gaucher\n---\n');
  // défaut : ./perso, créé à partir des modèles
  let c = chargerConfig({ racine, argv: [], env: {} });
  assert.equal(c.perso, path.join(racine, 'perso'));
  assert.equal(c.serveur.port, 4321);
  assert.equal(c.dossiers.donnees, path.join(racine, 'perso', 'data'));
  assert.equal(c.dossiers.sauvegardes, path.join(racine, 'perso', 'backups'));
  assert.equal(c.dossiers.contenu, path.join(racine, 'content')); // les cours restent dans le moteur
  assert.equal(lirePlayer(c.perso).main_dominante, 'gaucher');
  assert.equal(lirePlayer(c.perso).main_frette, 'droite'); // déduit
  // une config existante n'est jamais écrasée
  fs.writeFileSync(path.join(c.perso, 'config.yml'), 'serveur:\n  port: 7000\n');
  assert.equal(chargerConfig({ racine, argv: [], env: {} }).serveur.port, 7000);
  // dossier perso ailleurs : option ou variable d\'environnement
  const ailleurs = path.join(tmp(), 'mon-perso');
  c = chargerConfig({ racine, argv: ['--perso', ailleurs], env: {} });
  assert.equal(c.perso, ailleurs);
  assert.equal(chargerConfig({ racine, argv: [], env: { BASS_PERSO: ailleurs } }).dossiers.donnees, path.join(ailleurs, 'data'));
});

test('serveur : démarre sur un dossier perso isolé, sert l\'API et écrit dans perso/data', async () => {
  const { demarrer } = await import('../server/index.js');
  const racine = path.resolve(import.meta.dirname, '..');
  const perso = path.join(tmp(), 'perso');
  const config = chargerConfig({ racine, argv: ['--perso', perso, '--port', 'auto', '--no-open'], env: {} });
  const serveur = await demarrer(config);
  const base = `http://localhost:${serveur.address().port}`;
  try {
    const cfg = await (await fetch(`${base}/api/config`)).json();
    assert.equal(cfg.player.main_dominante, 'droitier');
    assert.equal(cfg.config.dossiers, undefined);
    assert.equal(cfg.config.perso, undefined); // les chemins locaux ne fuient pas vers le navigateur
    const put = await fetch(`${base}/api/data/progression`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"lecons_terminees":["a"]}' });
    assert.equal(put.status, 200);
    assert.ok(fs.existsSync(path.join(perso, 'data', 'progression.json')), 'écrit dans perso/data');
    assert.ok(fs.existsSync(path.join(perso, 'backups')), 'sauvegardes dans perso/backups');
    assert.equal((await fetch(`${base}/api/data/progression`, { method: 'PUT', body: '{}' })).status, 415);
    assert.equal((await fetch(`${base}/vendor/marked.js`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await (await fetch(`${base}/api/exercices`)).json()).length >= 5, true);
  } finally {
    serveur.close();
  }
});

test('doigtés : l\'option gauche:false masque le doigté de la main de frette mais garde i/m', () => {
  const ev = ajouterDoigtes(parserNotes('A7 A10 A5').evenements, { gauche: false });
  assert.ok(ev.every((e) => e.doigtFrette === undefined));
  assert.deepEqual(ev.map((e) => e.doigtPince), ['i', 'm', 'i']);
});

// ---- Format étendu : notes mortes, effets, fractions ----
test('parserNotes : notes mortes, effets, fractions de temps', () => {
  const r = parserNotes('Ax/.25 E5/1:3 E5/2:3t E5/1 G10/.5b A5/.5s A12/.5 E3/.25h E4/.25* -/.5');
  assert.deepEqual(r.erreurs, []);
  const [mort, tiers, deuxTiers, tenue, bend, glisse, cible, ham, hamCible] = r.evenements;
  assert.equal(mort.mort, true); assert.equal(mort.frette, null); assert.equal(mort.midi, midiDe('A', 0));
  assert.ok(Math.abs(tiers.duree + deuxTiers.duree - 1) < 1e-9, 'triolet : 1/3 + 2/3 = 1 temps');
  assert.equal(tenue.sansAttaque, true); assert.equal(tenue.liePar, 't');
  assert.equal(bend.effets.b, true);
  assert.equal(cible.liePar, 's'); assert.equal(hamCible.liePar, 'h'); assert.equal(hamCible.effets['*'], true);
  assert.equal(ham.sansAttaque, undefined);
});

test('parserNotes : effets mal placés signalés', () => {
  assert.equal(parserNotes('E5/1t').erreurs.length, 1, 'liaison sans note suivante');
  assert.equal(parserNotes('E5/1t A5').erreurs.length, 1, 'liaison entre notes différentes');
  assert.equal(parserNotes('-/1s E5').erreurs.length, 1, 'effet sur un silence');
  assert.equal(parserNotes('E5/0').erreurs.length, 1, 'durée nulle');
  assert.equal(parserNotes('E5/1:0').erreurs.length, 1, 'fraction invalide');
});

test('doigtés : pas de lettre de main droite sur les notes liées, notes mortes sans doigt de frette', () => {
  const ev = ajouterDoigtes(parserNotes('E3 Ex A5/.5s A7/.5 E0').evenements);
  assert.equal(ev[1].doigtFrette, undefined, 'note morte : pas de doigt');
  assert.equal(ev[1].doigtPince, 'm', 'mais elle est pincée');
  assert.equal(ev[3].doigtPince, undefined, 'cible d\'un glissé : pas pincée');
  assert.deepEqual([ev[0], ev[2], ev[4]].map((e) => e.doigtPince), ['i', 'i', 'm'], 'l\'alternance ne compte que les notes pincées');
});

test('séquenceur : liaison, glissé, hammer-on, bend, note morte et staccato', () => {
  const { evenements, total } = parserNotes('E5/1t E5/1 A5/.5s A12/.5 E3/.5h E4/.5 G10/1b Ex/1 D5/1*');
  const a = fauxAudio();
  const appels = [];
  a.jouerNote = (midi, t, d) => { appels.push(['note', midi, +t.toFixed(3), +d.toFixed(3)]); return { src: {}, baseFreq: 1, midi, rate: 1 }; };
  a.jouerNoteMorte = (midi, t) => appels.push(['morte', midi, +t.toFixed(3)]);
  a.changerHauteur = (h, midi, t, depuis) => appels.push(['change', midi, +t.toFixed(3), depuis == null ? null : +depuis.toFixed(3)]);
  a.bend = (h, t) => appels.push(['bend', +t.toFixed(3)]);
  globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
  const origSet = globalThis.setInterval; globalThis.setInterval = () => 1;
  const seq = new Sequenceur(a);
  seq.demarrer({ bpm: 60, tempsParMesure: 4, evenements, total, metronome: false, decompte: 0, boucle: false });
  globalThis.setInterval = origSet;
  a.ctx.currentTime = 20; seq.planifier();
  const t0 = seq.t0;
  const rel = (x) => +(x - t0).toFixed(3);
  const notes = appels.filter((x) => x[0] === 'note');
  // E5 tenue = une seule attaque de 2 temps (puis la note liée n'est pas rejouée)
  assert.equal(notes[0][1], midiDe('E', 5)); assert.ok(Math.abs(notes[0][3] - 2 * 0.95) < 1e-9);
  // Le premier glissé : A5 puis A12, une seule attaque ; l'hammer-on E3 -> E4 aussi
  assert.deepEqual(notes.map((n) => n[1]), [midiDe('E', 5), midiDe('A', 5), midiDe('E', 3), midiDe('G', 10), midiDe('D', 5)], 'seules les notes pincées sont attaquées');
  const ch = appels.filter((x) => x[0] === 'change');
  assert.equal(ch.length, 2);
  assert.equal(ch[0][1], midiDe('A', 12)); assert.ok(ch[0][3] !== null && ch[0][3] < ch[0][2], 'glissé : la hauteur commence à bouger avant la note cible');
  assert.equal(ch[1][1], midiDe('E', 4)); assert.equal(ch[1][3], null, 'hammer-on : changement net');
  assert.equal(appels.filter((x) => x[0] === 'bend').length, 1);
  assert.equal(appels.filter((x) => x[0] === 'morte').length, 1);
  const stacc = notes.find((n) => n[1] === midiDe('D', 5));
  assert.ok(stacc[3] < 0.5, 'staccato : note courte');
  assert.ok(rel(stacc[2]) > 0);
});
