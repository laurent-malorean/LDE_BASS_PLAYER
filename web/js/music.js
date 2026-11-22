// Théorie : notes, cordes, parsing des tablatures.
export const NOTES_FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
export const NOTES_EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Notes MIDI des cordes à vide (la basse sonne E1 = 28 pour la corde grave).
export const CORDES = { B: 23, E: 28, A: 33, D: 38, G: 43 };
export const ORDRE_AIGU_GRAVE = ['G', 'D', 'A', 'E', 'B']; // ordre d'affichage (aigu en haut)

export const pitchClass = (midi) => ((midi % 12) + 12) % 12;
export const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const midiDepuisFreq = (f) => 69 + 12 * Math.log2(f / 440);

export function nomNote(midi, notation = 'francaise') {
  return (notation === 'anglo' ? NOTES_EN : NOTES_FR)[pitchClass(midi)];
}
export const nomNoteAvecOctave = (midi, notation) => nomNote(midi, notation) + (Math.floor(midi / 12) - 1);
export const nomCorde = (lettre, notation) => nomNote(CORDES[lettre], notation);

export function accordage(player) {
  const liste = player?.basse?.accordage?.length ? player.basse.accordage : ['E', 'A', 'D', 'G'];
  return liste.filter((c) => c in CORDES);
}

/** Cordes de la basse, triées de l'aiguë (haut) vers la grave (bas). */
export function cordesAffichees(player) {
  const a = accordage(player);
  return [...a].sort((x, y) => CORDES[y] - CORDES[x]);
}

export const midiDe = (corde, frette) => CORDES[corde] + frette;

/**
 * Format texte d'une tablature : "E0 A3/0.5 - A2/1:3 | D5"
 *  - Lettre de corde + numéro de frette, ex. A3 ; « x » = note morte (étouffée), ex. Ax
 *  - /durée en temps (1 par défaut) : décimal (/0.5) ou fraction (/1:3 = un tiers de temps, pour les triolets)
 *  - "-" = silence, "|" = barre de mesure (affichage uniquement)
 *  - effets, collés à la fin du jeton (ex. E5/0.5s) :
 *      h = hammer-on vers la note suivante     p = pull-off vers la note suivante
 *      s = glissé vers la note suivante        t = liaison : la note suivante est la même, tenue
 *      b = bend d'un quart de ton              * = staccato (note courte)
 * La note qui suit un h, p, s ou t n'est pas pincée : elle prolonge la précédente.
 */
export const EFFETS = { h: 'hammer-on', p: 'pull-off', s: 'glissé', t: 'liaison', b: 'bend', '*': 'staccato' };

function lireDuree(txt) {
  if (txt === undefined) return 1;
  const [n, d] = txt.split(':');
  return d ? parseFloat(n) / parseFloat(d) : parseFloat(n);
}

export function parserNotes(texte) {
  const evenements = [];
  const erreurs = [];
  let debut = 0;
  let mesure = 0;
  for (const jeton of String(texte ?? '').split(/\s+/).filter(Boolean)) {
    if (jeton === '|') { mesure++; continue; }
    const m = jeton.match(/^(?:([BEADG])(\d{1,2}|x)|-)(?:\/(\d*\.?\d+(?::\d+)?))?([hpstb*]*)$/i);
    const duree = m ? lireDuree(m[3]) : NaN;
    if (!m || !(duree > 0) || !Number.isFinite(duree)) { erreurs.push(`Jeton incompris : « ${jeton} »`); continue; }
    const ev = { duree, debut, mesure, silence: !m[1], effets: {} };
    if (m[1]) {
      ev.corde = m[1].toUpperCase();
      ev.mort = m[2].toLowerCase() === 'x';
      ev.frette = ev.mort ? null : parseInt(m[2], 10);
      ev.midi = midiDe(ev.corde, ev.frette ?? 0); // une note morte garde la hauteur de la corde à vide
    }
    for (const c of m[4].toLowerCase()) ev.effets[c] = true;
    if (ev.silence && m[4]) { erreurs.push(`Un silence ne peut pas avoir d'effet : « ${jeton} »`); continue; }
    evenements.push(ev);
    debut += duree;
  }
  // La note qui suit un h/p/s/t n'est pas pincée : on la marque pour l'audio, le micro et les doigtés.
  for (let i = 0; i < evenements.length; i++) {
    const e = evenements[i];
    if (!(e.effets.h || e.effets.p || e.effets.s || e.effets.t)) continue;
    const suivant = evenements[i + 1];
    if (!suivant || suivant.silence) { erreurs.push(`Effet sans note suivante après la note ${i + 1}`); continue; }
    suivant.sansAttaque = true;
    suivant.liePar = e.effets.t ? 't' : e.effets.s ? 's' : e.effets.h ? 'h' : 'p';
    if (e.effets.t && (suivant.mort || suivant.midi !== e.midi)) erreurs.push(`Liaison entre deux notes différentes (note ${i + 1})`);
  }
  return { evenements, total: debut, erreurs };
}

/**
 * Doigtés automatiques.
 *  - Main de frette : un doigt par frette. La position est fixée sur la frette la plus basse
 *    jouée (hors corde à vide et notes mortes) ; corde à vide = 0 (aucun doigt).
 *  - Main de pincement : alternance index (i) / majeur (m) sur les notes réellement pincées
 *    (pas sur celles qui suivent un hammer-on, un glissé ou une liaison).
 */
export function ajouterDoigtes(evenements, { gauche = true } = {}) {
  const frettes = evenements.filter((e) => !e.silence && !e.mort && e.frette > 0).map((e) => e.frette);
  const base = frettes.length ? Math.min(...frettes) : 1;
  let alt = 0;
  for (const e of evenements) {
    if (e.silence) continue;
    if (gauche && !e.mort) e.doigtFrette = e.frette === 0 ? 0 : Math.min(4, Math.max(1, e.frette - base + 1));
    if (!e.sansAttaque) e.doigtPince = alt++ % 2 === 0 ? 'i' : 'm';
  }
  return evenements;
}

export function mettreEnForme(texte) { return texte; }
