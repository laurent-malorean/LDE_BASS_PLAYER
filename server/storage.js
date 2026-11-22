// Stockage : un petit fichier JSON par donnée, écriture atomique, sauvegardes tournantes.
import fs from 'node:fs';
import path from 'node:path';

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,80}$/;
const TOP_FICHIERS = new Set(['progression', 'reglages', 'quiz']);
const TOP_DOSSIERS = new Set(['sessions', 'exercices']);

export class Storage {
  constructor(dossier) {
    this.dir = dossier;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const d of [...TOP_DOSSIERS, 'mes-tablatures']) fs.mkdirSync(path.join(this.dir, d), { recursive: true });
  }

  // "sessions/2026-11-22" -> chemin absolu sûr, ou null si le nom est refusé.
  resoudre(nom) {
    const parts = String(nom).split('/');
    if (parts.length < 1 || parts.length > 2 || !parts.every((p) => SEGMENT.test(p) && !p.includes('..'))) return null;
    if (parts.length === 1 && !TOP_FICHIERS.has(parts[0])) return null;
    if (parts.length === 2 && !TOP_DOSSIERS.has(parts[0])) return null;
    return path.join(this.dir, ...parts) + '.json';
  }

  lire(nom) {
    const f = this.resoudre(nom);
    if (!f) throw Object.assign(new Error('Nom de donnée invalide'), { status: 400 });
    if (!fs.existsSync(f)) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch {
      // Fichier corrompu : on le garde de côté plutôt que de l'écraser silencieusement.
      fs.renameSync(f, f + `.corrompu-${Date.now()}`);
      return null;
    }
  }

  ecrire(nom, valeur) {
    const f = this.resoudre(nom);
    if (!f) throw Object.assign(new Error('Nom de donnée invalide'), { status: 400 });
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2) + '\n');
    fs.renameSync(tmp, f); // renommage atomique : jamais de fichier à moitié écrit
  }

  lister(dossier) {
    if (!TOP_DOSSIERS.has(dossier)) throw Object.assign(new Error('Dossier invalide'), { status: 400 });
    const d = path.join(this.dir, dossier);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
  }

  listerTablatures() {
    const d = path.join(this.dir, 'mes-tablatures');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((n) => /\.ya?ml$/.test(n)).sort();
  }

  exporter() {
    const fichiers = {};
    const noms = [...TOP_FICHIERS];
    for (const d of TOP_DOSSIERS) for (const n of this.lister(d)) noms.push(`${d}/${n}`);
    for (const n of noms) {
      const v = this.lire(n);
      if (v !== null) fichiers[n] = v;
    }
    return { version: 1, exporte_le: new Date().toISOString(), fichiers };
  }

  importer(bundle) {
    if (!bundle || typeof bundle !== 'object' || typeof bundle.fichiers !== 'object') {
      throw Object.assign(new Error('Fichier d\'export invalide'), { status: 400 });
    }
    const noms = Object.keys(bundle.fichiers);
    for (const n of noms) if (!this.resoudre(n)) throw Object.assign(new Error(`Nom refusé : ${n}`), { status: 400 });
    for (const n of noms) this.ecrire(n, bundle.fichiers[n]);
    return noms.length;
  }

  // Copie de data/ dans sauvegardes/AAAA-MM-JJ[_HHMMSS], puis purge des plus anciennes.
  sauvegarder(dossierSauvegardes, { frequence, conserver }) {
    fs.mkdirSync(dossierSauvegardes, { recursive: true });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const jour = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const nom = frequence === 'quotidienne' ? jour : `${jour}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const cible = path.join(dossierSauvegardes, nom);
    let cree = false;
    if (!fs.existsSync(cible)) {
      fs.cpSync(this.dir, cible, { recursive: true, filter: (s) => !s.includes('.tmp-') });
      cree = true;
    }
    const tous = fs.readdirSync(dossierSauvegardes).filter((n) => /^\d{4}-\d{2}-\d{2}/.test(n)).sort();
    for (const vieux of tous.slice(0, Math.max(0, tous.length - conserver))) {
      fs.rmSync(path.join(dossierSauvegardes, vieux), { recursive: true, force: true });
    }
    return { nom, cree };
  }
}
