// Tablature en SVG : lignes de cordes, numéros de frette, doigtés main de frette (au-dessus),
// doigtés main de pincement et comptage des temps (en dessous). Retour à la ligne automatique par mesures.
import { el, texte } from './svg.js';
import { cordesAffichees, nomCorde } from './music.js';

export function creerTablature(evenements, { player, tempsParMesure = 4, largeurMax = 860 } = {}) {
  const notation = player?.notation_notes ?? 'francaise';
  const cordes = cordesAffichees(player); // aiguë -> grave
  const ecart = 22, margeG = 38, pasTemps = 52, hautDoigts = 30, basDoigts = 52, margeRangee = 14;
  const hauteurLignes = ecart * (cordes.length - 1);
  const hauteurRangee = hautDoigts + hauteurLignes + basDoigts + margeRangee;

  // regroupement en mesures
  const mesures = [];
  for (const [index, e] of evenements.entries()) {
    (mesures[e.mesure] ??= []).push({ ...e, index });
  }
  const mesuresListe = mesures.filter(Boolean);
  const infos = mesuresListe.map((notes) => {
    const debut = notes[0].debut;
    const fin = Math.max(...notes.map((n) => n.debut + n.duree));
    return { notes, debut, fin, largeur: Math.max(1.5, fin - debut) * pasTemps + 18 };
  });

  // rangées
  const rangees = [];
  let courante = { mesures: [], largeur: margeG };
  for (const m of infos) {
    if (courante.mesures.length && courante.largeur + m.largeur > largeurMax) { rangees.push(courante); courante = { mesures: [], largeur: margeG }; }
    courante.mesures.push(m); courante.largeur += m.largeur;
  }
  if (courante.mesures.length) rangees.push(courante);

  const largeurSvg = Math.max(...rangees.map((r) => r.largeur), 200) + 10;
  const svg = el('svg', { viewBox: `0 0 ${largeurSvg} ${hauteurRangee * rangees.length}`, class: 'tablature', role: 'img', 'aria-label': 'Tablature' });
  svg.style.maxWidth = `${Math.round(largeurSvg * 1.3)}px`; // une tablature courte ne grossit pas démesurément
  const positions = new Array(evenements.length); // index -> {x, y}
  const noeuds = new Array(evenements.length);

  rangees.forEach((r, ri) => {
    const y0 = ri * hauteurRangee + hautDoigts;
    const yc = (ci) => y0 + ci * ecart;
    cordes.forEach((c, ci) => {
      svg.append(el('line', { x1: margeG - 6, x2: r.largeur, y1: yc(ci), y2: yc(ci), class: 'ligne-tab' }));
      svg.append(texte(14, yc(ci) + 4, nomCorde(c, notation), { class: 'nom-corde-tab', 'text-anchor': 'middle' }));
    });
    svg.append(el('line', { x1: margeG - 6, x2: margeG - 6, y1: yc(0), y2: yc(cordes.length - 1), class: 'barre' }));
    let x = margeG;
    for (const m of r.mesures) {
      for (const n of m.notes) {
        const nx = x + 10 + (n.debut - m.debut) * pasTemps;
        const g = el('g', { class: 'note-tab' });
        if (n.silence) {
          // symbole de silence : petit bloc sur la ligne centrale
          g.append(el('rect', { x: nx - 8, y: yc(cordes.length / 2 - 0.5) - 3, width: 16, height: 6, class: 'silence' }));
        } else {
          const ci = cordes.indexOf(n.corde);
          const y = yc(ci);
          const etiquette = String(n.frette);
          g.append(el('rect', { x: nx - 9, y: y - 9, width: 18, height: 18, rx: 9, class: 'fond-note' }));
          g.append(texte(nx, y + 4.5, etiquette, { 'text-anchor': 'middle', class: 'frette-num' }));
          // main de frette (au-dessus) : 0 = corde à vide
          if (n.doigtFrette !== undefined) g.append(texte(nx, y0 - 10, n.doigtFrette === 0 ? '○' : String(n.doigtFrette), { 'text-anchor': 'middle', class: 'doigt-frette' }));
          // main de pincement (dessous)
          g.append(texte(nx, y0 + hauteurLignes + 26, n.doigtPince ?? '', { 'text-anchor': 'middle', class: 'doigt-pince' }));
        }
        // comptage
        const pos = n.debut - m.debut;
        const entier = Number.isInteger(pos);
        const dansMesure = (n.debut % tempsParMesure);
        const compte = Number.isInteger(dansMesure) ? String(dansMesure + 1) : (Number.isInteger(dansMesure * 2) ? '+' : '·');
        g.append(texte(nx, y0 + hauteurLignes + 46, compte, { 'text-anchor': 'middle', class: entier || Number.isInteger(dansMesure) ? 'compte' : 'compte secondaire' }));
        svg.append(g);
        positions[n.index] = { x: nx, y0, ri };
        noeuds[n.index] = g;
      }
      x += m.largeur;
      svg.append(el('line', { x1: x, x2: x, y1: yc(0), y2: yc(cordes.length - 1), class: 'barre' }));
    }
  });

  // légende des lignes de doigtés
  const curseur = el('rect', { class: 'curseur-tab', width: 26, height: hauteurRangee - margeRangee, rx: 6, visibility: 'hidden' });
  svg.prepend(curseur);

  return {
    svg,
    activer(index) {
      noeuds.forEach((n) => n?.classList.remove('active', 'juste', 'faux'));
      if (index == null || !positions[index]) { curseur.setAttribute('visibility', 'hidden'); return; }
      const p = positions[index];
      noeuds[index].classList.add('active');
      curseur.setAttribute('x', p.x - 13);
      curseur.setAttribute('y', p.ri * hauteurRangee + 2);
      curseur.setAttribute('visibility', 'visible');
    },
    marquer(index, etat) { noeuds[index]?.classList.add(etat); },
    effacerMarques() { noeuds.forEach((n) => n?.classList.remove('juste', 'faux')); },
  };
}
