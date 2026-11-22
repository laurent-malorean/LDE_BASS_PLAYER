// Lecture des cours (Markdown + en-tête YAML) et des exercices (YAML).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

export function separerEntete(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, corps: txt };
  let meta = {};
  try { meta = YAML.parse(m[1]) ?? {}; } catch { /* en-tête ignoré */ }
  return { meta, corps: m[2] };
}

export class Contenu {
  constructor(dossier, storage) {
    this.dir = dossier;
    this.storage = storage;
  }

  categories() {
    return ['theorie', 'manche'];
  }

  lecons(cat) {
    if (!this.categories().includes(cat)) return [];
    const d = path.join(this.dir, cat);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((n) => n.endsWith('.md')).sort().map((n) => {
      const id = n.slice(0, -3);
      const { meta } = separerEntete(fs.readFileSync(path.join(d, n), 'utf8'));
      return { id, titre: meta.titre ?? id, resume: meta.resume ?? '', duree_min: meta.duree_min ?? null };
    });
  }

  lecon(cat, id) {
    if (!this.categories().includes(cat) || !ID.test(id)) return null;
    const f = path.join(this.dir, cat, id + '.md');
    if (!fs.existsSync(f)) return null;
    const { meta, corps } = separerEntete(fs.readFileSync(f, 'utf8'));
    return { id, cat, titre: meta.titre ?? id, resume: meta.resume ?? '', markdown: corps };
  }

  lireExerciceFichier(f, id, source) {
    let y;
    try { y = YAML.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { return { id, source, erreur: `YAML invalide : ${e.message}` }; }
    if (!y || typeof y !== 'object') return { id, source, erreur: 'Fichier vide' };
    return { id, source, ...y };
  }

  exercices() {
    const liste = [];
    const d = path.join(this.dir, 'exercices');
    if (fs.existsSync(d)) {
      for (const n of fs.readdirSync(d).filter((n) => /\.ya?ml$/.test(n)).sort()) {
        liste.push(this.lireExerciceFichier(path.join(d, n), n.replace(/\.ya?ml$/, ''), 'cours'));
      }
    }
    for (const n of this.storage.listerTablatures()) {
      const id = 'perso-' + n.replace(/\.ya?ml$/, '');
      liste.push(this.lireExerciceFichier(path.join(this.storage.dir, 'mes-tablatures', n), id, 'perso'));
    }
    return liste;
  }

  exercice(id) {
    if (!ID.test(id)) return null;
    return this.exercices().find((e) => e.id === id) ?? null;
  }
}
