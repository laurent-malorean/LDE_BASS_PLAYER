// Vérifie des fichiers de tablature (.yml) : YAML valide, jetons reconnus, bon nombre de temps par mesure.
//   node scripts/verifier-tablatures.js [dossier ou fichier ...]
// Par défaut : content/exercices et le dossier perso (data/mes-tablatures).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { parserNotes } from '../web/js/music.js';
import { chargerConfig, ROOT } from '../server/config.js';

export function verifierTablature(y) {
  const problemes = [];
  if (!y || typeof y !== 'object') return ['fichier vide'];
  if (!y.titre) problemes.push('titre manquant');
  if (typeof y.notes !== 'string') return [...problemes, 'champ « notes » manquant'];
  const [pulses] = String(y.chiffrage ?? '4/4').split('/').map(Number);
  if (!pulses) problemes.push(`chiffrage illisible : ${y.chiffrage}`);
  const r = parserNotes(y.notes);
  problemes.push(...r.erreurs);
  const parMesure = [];
  for (const e of r.evenements) parMesure[e.mesure] = (parMesure[e.mesure] ?? 0) + e.duree;
  parMesure.forEach((d, i) => {
    if (d !== undefined && pulses && Math.abs(d - pulses) > 1e-6) problemes.push(`mesure ${i + 1} : ${+d.toFixed(4)} temps au lieu de ${pulses}`);
  });
  return problemes;
}

function fichiersDe(cible) {
  if (!fs.existsSync(cible)) return [];
  if (fs.statSync(cible).isFile()) return [cible];
  return fs.readdirSync(cible).filter((n) => /\.ya?ml$/.test(n)).sort().map((n) => path.join(cible, n));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  let cibles = process.argv.slice(2);
  if (!cibles.length) {
    const c = chargerConfig({ racine: ROOT, argv: [], env: process.env });
    cibles = [path.join(ROOT, 'content/exercices'), path.join(c.dossiers.donnees, 'mes-tablatures')];
  }
  let total = 0, mauvais = 0;
  for (const f of cibles.flatMap(fichiersDe)) {
    total++;
    let p;
    try { p = verifierTablature(YAML.parse(fs.readFileSync(f, 'utf8'))); } catch (e) { p = [`YAML invalide : ${e.message}`]; }
    console.log(`${p.length ? '✖' : '✔'} ${path.relative(ROOT, f)}${p.length ? '\n    - ' + p.join('\n    - ') : ''}`);
    if (p.length) mauvais++;
  }
  console.log(`\n${total} fichier(s), ${mauvais} avec problème(s).`);
  process.exit(mauvais ? 1 : 0);
}
