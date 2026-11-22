// Manche de basse en SVG : cliquable, notes nommées, surbrillance, miroir pour gaucher.
import { el, texte } from './svg.js';
import { CORDES, midiDe, nomNote, cordesAffichees, ORDRE_AIGU_GRAVE } from './music.js';

const REPERES = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const TAILLES = { petite: 700, moyenne: 900, grande: 1150 };

/**
 * opts : { player, frettes=12, cordes (lettres, sinon accordage du joueur), afficher: 'toutes'|'surbrillance'|'aucune',
 *          surbrillance: [{corde, frette, etiquette?, classe?}], taille, onClic({corde, frette, midi}) }
 * Renvoie { svg, marquer(corde, frette, classe), effacer(classe) }.
 */
export function creerManche(opts) {
  const { player, frettes = 12, afficher = 'toutes', surbrillance = [], onClic } = opts;
  const notation = player?.notation_notes ?? 'francaise';
  const gaucher = player?.main_dominante === 'gaucher';
  let cordes = opts.cordes ? ORDRE_AIGU_GRAVE.filter((c) => opts.cordes.includes(c)) : cordesAffichees(player);
  const largeurCorps = TAILLES[opts.taille] ?? 900;
  const margeG = 78, margeD = 24, haut = 26, ecart = 40;
  const L = largeurCorps - margeG - margeD;
  const H = haut * 2 + ecart * (cordes.length - 1) + 22;
  // positions de frettes proportionnelles à la vraie géométrie (2^(-n/12)), ramenées à la largeur
  const total = 1 - 2 ** (-frettes / 12);
  const xFrette = (n) => margeG + (L * (1 - 2 ** (-n / 12))) / total;
  const xMilieu = (n) => (n === 0 ? margeG - 28 : (xFrette(n - 1) + xFrette(n)) / 2);
  const X = (x) => (gaucher ? largeurCorps - x : x);
  const yCorde = (i) => haut + i * ecart;

  const svg = el('svg', { viewBox: `0 0 ${largeurCorps} ${H}`, class: 'manche', role: 'img', 'aria-label': 'Manche de basse' });
  // touche
  svg.append(el('rect', { x: Math.min(X(margeG), X(margeG + L)), y: yCorde(0) - 18, width: L, height: yCorde(cordes.length - 1) - yCorde(0) + 36, class: 'touche', rx: 4 }));
  // repères
  for (let n = 1; n <= frettes; n++) {
    if (REPERES.has(n)) svg.append(el('circle', { cx: X(xMilieu(n)), cy: (yCorde(0) + yCorde(cordes.length - 1)) / 2, r: 6, class: 'repere' }));
    if (n === 12) {
      const m = (yCorde(0) + yCorde(cordes.length - 1)) / 2;
      for (const dy of [-ecart * 0.9, ecart * 0.9]) svg.append(el('circle', { cx: X(xMilieu(12)), cy: m + dy, r: 6, class: 'repere' }));
    }
  }
  // frettes et sillet
  for (let n = 0; n <= frettes; n++) {
    svg.append(el('line', { x1: X(xFrette(n)), x2: X(xFrette(n)), y1: yCorde(0) - 18, y2: yCorde(cordes.length - 1) + 18, class: n === 0 ? 'sillet' : 'frette' }));
    if (n > 0 && (REPERES.has(n) || n === 12 || frettes <= 12)) {
      svg.append(texte(X(xMilieu(n)), H - 4, String(n), { class: 'num-frette', 'text-anchor': 'middle' }));
    }
  }
  // cordes
  cordes.forEach((c, i) => {
    svg.append(el('line', { x1: X(margeG - 28), x2: X(margeG + L), y1: yCorde(i), y2: yCorde(i), class: 'corde', 'stroke-width': 1.2 + (cordes.length - i) * 0.5 }));
    svg.append(texte(X(margeG - 64), yCorde(i) + 5, nomNote(CORDES[c], notation), { class: 'nom-corde', 'text-anchor': 'middle' }));
  });

  const marques = new Map();
  const cle = (c, f) => `${c}${f}`;
  function poser(corde, frette, { etiquette, classe = '' } = {}) {
    const i = cordes.indexOf(corde);
    if (i < 0) return;
    const g = el('g', { class: `marque ${classe}` });
    g.append(el('circle', { cx: X(xMilieu(frette)), cy: yCorde(i), r: 14 }));
    g.append(texte(X(xMilieu(frette)), yCorde(i) + 4.5, etiquette ?? nomNote(midiDe(corde, frette), notation), { 'text-anchor': 'middle' }));
    svg.append(g);
    marques.set(cle(corde, frette) + classe, g);
    return g;
  }

  if (afficher === 'toutes') {
    for (const c of cordes) for (let f = 0; f <= frettes; f++) poser(c, f, { classe: 'note' });
  }
  for (const s of surbrillance) poser(s.corde, s.frette, { etiquette: s.etiquette, classe: `actif ${s.classe ?? ''}` });

  if (onClic) {
    // zones cliquables invisibles, une par case
    cordes.forEach((c, i) => {
      for (let f = 0; f <= frettes; f++) {
        const r = el('circle', { cx: X(xMilieu(f)), cy: yCorde(i), r: 16, class: 'zone', tabindex: 0, role: 'button', 'aria-label': `${nomNote(midiDe(c, f), notation)}, corde ${nomNote(CORDES[c], notation)}, frette ${f}` });
        const declencher = () => onClic({ corde: c, frette: f, midi: midiDe(c, f) });
        r.addEventListener('click', declencher);
        r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); declencher(); } });
        svg.append(r);
      }
    });
  }

  return {
    svg,
    cordes,
    marquer(corde, frette, classe, etiquette) { return poser(corde, frette, { classe, etiquette }); },
    effacer(classe) {
      for (const [k, g] of marques) if (k.endsWith(classe)) { g.remove(); marques.delete(k); }
    },
  };
}
