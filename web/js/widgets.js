// Rendu des leçons Markdown : les blocs ```fretboard / ```tab / ```quiz deviennent des composants interactifs.
import { marked } from '/vendor/marked.js';
import { h, echapper } from './ui.js';
import { etat, reglage, personnaliser } from './etat.js';
import { creerManche } from './fretboard.js';
import { lecteurTablature, quizManche, panneauMains } from './composants.js';
import { nomNote, midiDe } from './music.js';

const WIDGETS = new Set(['fretboard', 'tab', 'quiz', 'mains']);

/** Mini-lecteur « cle: valeur » (une valeur par ligne). */
export function lireSpec(texte) {
  const spec = {};
  for (const l of texte.split('\n')) {
    const m = l.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (m) spec[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return spec;
}

marked.use({
  renderer: {
    code({ text, lang }) {
      if (WIDGETS.has(lang)) return `<div class="widget" data-kind="${lang}" data-spec="${echapper(text)}"></div>`;
      return false;
    },
  },
});

export function rendreMarkdown(md) {
  const zone = h('div', { class: 'lecon-corps', html: marked.parse(personnaliser(md)) });
  for (const w of zone.querySelectorAll('.widget')) {
    const spec = lireSpec(w.dataset.spec);
    try { w.replaceChildren(monter(w.dataset.kind, spec)); }
    catch (e) { w.replaceChildren(h('p', { class: 'erreur' }, `Widget « ${w.dataset.kind} » invalide : ${e.message}`)); }
  }
  return zone;
}

function monter(kind, spec) {
  if (kind === 'mains') return panneauMains();
  if (kind === 'quiz') return quizManche({ frettes: +(spec.frettes ?? 12) });
  if (kind === 'tab') {
    return lecteurTablature({ notes: spec.notes, bpm: +(spec.bpm ?? 70), chiffrage: spec.chiffrage ?? '4/4' }, { complet: false });
  }
  if (kind === 'fretboard') {
    const notation = etat.player.notation_notes;
    const surbrillance = (spec.surbrillance ?? '').split(/\s+/).filter(Boolean).map((t) => ({ corde: t[0].toUpperCase(), frette: +t.slice(1) }));
    const boite = h('div', { class: 'widget-manche' });
    const info = h('p', { class: 'legende' }, spec.aide ?? 'Clique sur une case pour entendre la note.');
    const manche = creerManche({
      player: etat.player,
      frettes: +(spec.frettes ?? 12),
      cordes: spec.cordes ? spec.cordes.split(/[\s,]+/).map((c) => c.toUpperCase()) : undefined,
      afficher: spec.afficher ?? 'toutes',
      surbrillance,
      taille: reglage('interface.taille_manche'),
      onClic: ({ corde, frette, midi }) => {
        etat.audio.jouerNote(midi);
        info.textContent = `${nomNote(midi, notation)} — corde de ${nomNote(midiDe(corde, 0), notation)}, frette ${frette}`;
      },
    });
    boite.append(manche.svg, info);
    return boite;
  }
  throw new Error('type inconnu');
}
