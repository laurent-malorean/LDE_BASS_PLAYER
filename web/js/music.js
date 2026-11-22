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
 * Format texte d'une tablature : "E0 E3/0.5 - A2 | D5"
 *  - Lettre de corde + numéro de frette, ex. A3
 *  - /durée en temps (1 par défaut), ex. E3/0.5 pour une croche en 4/4
 *  - "-" = silence, "|" = barre de mesure (affichage uniquement)
 */
export function parserNotes(texte) {
  const evenements = [];
  const erreurs = [];
  let debut = 0;
  let mesure = 0;
  for (const jeton of String(texte ?? '').split(/\s+/).filter(Boolean)) {
    if (jeton === '|') { mesure++; continue; }
    const m = jeton.match(/^(?:([BEADG])(\d{1,2})|-)(?:\/(\d*\.?\d+))?$/i);
    if (!m) { erreurs.push(`Jeton incompris : « ${jeton} »`); continue; }
    const duree = m[3] ? parseFloat(m[3]) : 1;
    const ev = { duree, debut, mesure, silence: !m[1] };
    if (m[1]) {
      ev.corde = m[1].toUpperCase();
      ev.frette = parseInt(m[2], 10);
      ev.midi = midiDe(ev.corde, ev.frette);
    }
    evenements.push(ev);
    debut += duree;
  }
  return { evenements, total: debut, erreurs };
}

/**
 * Doigtés automatiques.
 *  - Main de frette : un doigt par frette. La position est fixée sur la frette la plus basse
 *    jouée (hors corde à vide) ; corde à vide = 0 (aucun doigt).
 *  - Main de pincement : alternance index (i) / majeur (m) sur les notes jouées.
 */
export function ajouterDoigtes(evenements, { gauche = true } = {}) {
  const frettes = evenements.filter((e) => !e.silence && e.frette > 0).map((e) => e.frette);
  const base = frettes.length ? Math.min(...frettes) : 1;
  let alt = 0;
  for (const e of evenements) {
    if (e.silence) continue;
    if (gauche) e.doigtFrette = e.frette === 0 ? 0 : Math.min(4, Math.max(1, e.frette - base + 1));
    e.doigtPince = alt++ % 2 === 0 ? 'i' : 'm';
  }
  return evenements;
}

export function mettreEnForme(texte) { return texte; }
