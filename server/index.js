// Serveur local : sert l'application web et l'API de stockage de fichiers.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chargerConfig, lirePlayer, ROOT } from './config.js';
import { Storage } from './storage.js';
import { Contenu } from './content.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2',
};
const VENDOR = {
  '/vendor/marked.js': path.join(ROOT, 'node_modules/marked/lib/marked.esm.js'),
};
const WEB = path.join(ROOT, 'web');
const NIVEAUX = { erreur: 0, info: 1, debug: 2 };

export function creerServeur(config) {
  const log = (niveau, ...a) => { if (NIVEAUX[niveau] <= NIVEAUX[config.avance.journal]) console.log(`[${niveau}]`, ...a); };
  const storage = new Storage(config.dossiers.donnees);
  const contenu = new Contenu(config.dossiers.contenu, storage);

  const json = (res, status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const lireCorps = (req) => new Promise((resolve, reject) => {
    const morceaux = []; let taille = 0;
    req.on('data', (c) => {
      taille += c.length;
      if (taille > 5_000_000) { reject(Object.assign(new Error('Corps trop volumineux'), { status: 413 })); req.destroy(); return; }
      morceaux.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(morceaux).toString('utf8') || 'null')); }
      catch { reject(Object.assign(new Error('JSON invalide'), { status: 400 })); }
    });
    req.on('error', reject);
  });

  async function api(req, res, url) {
    const p = url.pathname.replace(/^\/api\//, '').split('/').map(decodeURIComponent);
    const m = req.method;
    // Protection contre les écritures venant d'autres sites : JSON obligatoire + même origine.
    if (m !== 'GET') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { erreur: 'Content-Type JSON requis' });
      const o = req.headers.origin;
      if (o && new URL(o).host !== req.headers.host) return json(res, 403, { erreur: 'Origine refusée' });
    }
    if (p[0] === 'config' && m === 'GET') {
      const { dossiers, perso, ...publique } = config;
      return json(res, 200, { config: publique, player: lirePlayer(config.perso) });
    }
    if (p[0] === 'lecons' && m === 'GET') {
      if (p.length === 1) return json(res, 200, Object.fromEntries(contenu.categories().map((c) => [c, contenu.lecons(c)])));
      const l = contenu.lecon(p[1], p[2] ?? '');
      return l ? json(res, 200, l) : json(res, 404, { erreur: 'Leçon introuvable' });
    }
    if (p[0] === 'exercices' && m === 'GET') {
      if (p.length === 1) return json(res, 200, contenu.exercices());
      const e = contenu.exercice(p[1]);
      return e ? json(res, 200, e) : json(res, 404, { erreur: 'Exercice introuvable' });
    }
    if (p[0] === 'data') {
      if (p.length === 1 && m === 'GET') {
        const d = url.searchParams.get('dir');
        return json(res, 200, storage.lister(d));
      }
      const nom = p.slice(1).join('/');
      if (m === 'GET') {
        const v = storage.lire(nom);
        return v === null ? json(res, 404, { erreur: 'Aucune donnée' }) : json(res, 200, v);
      }
      if (m === 'PUT') { storage.ecrire(nom, await lireCorps(req)); return json(res, 200, { ok: true }); }
    }
    if (p[0] === 'export' && m === 'GET') {
      res.setHeader('Content-Disposition', `attachment; filename="bass-player-export-${new Date().toISOString().slice(0, 10)}.json"`);
      return json(res, 200, storage.exporter());
    }
    if (p[0] === 'import' && m === 'POST') {
      storage.sauvegarder(config.dossiers.sauvegardes, { frequence: 'a_chaque_demarrage', conserver: config.sauvegarde.conserver });
      return json(res, 200, { ok: true, fichiers: storage.importer(await lireCorps(req)) });
    }
    return json(res, 404, { erreur: 'Route inconnue' });
  }

  function statique(req, res, url) {
    let chemin = decodeURIComponent(url.pathname);
    let fichier = VENDOR[chemin];
    if (!fichier) {
      if (chemin === '/' || !path.extname(chemin)) chemin = '/index.html'; // routes côté client (#/...)
      fichier = path.join(WEB, path.normalize(chemin));
      if (!fichier.startsWith(WEB + path.sep)) { res.writeHead(403); return res.end('Interdit'); }
    }
    fs.readFile(fichier, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      log('debug', req.method, url.pathname);
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else statique(req, res, url);
    } catch (e) {
      const status = e.status ?? 500;
      if (status === 500) log('erreur', e);
      if (!res.headersSent) json(res, status, { erreur: e.message });
    }
  });
  return { serveur, storage, contenu, log };
}

export async function demarrer(config) {
  const { serveur, storage, log } = creerServeur(config);
  if (config.sauvegarde.active) {
    try {
      const r = storage.sauvegarder(config.dossiers.sauvegardes, config.sauvegarde);
      if (r.cree) log('info', `Sauvegarde créée : ${r.nom}`);
    } catch (e) { log('erreur', 'Sauvegarde impossible :', e.message); }
  }
  await new Promise((resolve, reject) => {
    serveur.once('error', reject);
    serveur.listen(config.serveur.port === 'auto' ? 0 : config.serveur.port, config.serveur.hote, resolve);
  });
  return serveur;
}

// Lancement direct : node server/index.js
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    const config = chargerConfig();
    lirePlayer(config.perso);
    const serveur = await demarrer(config).catch((e) => {
      if (e.code === 'EADDRINUSE') throw new Error(`Le port ${config.serveur.port} est déjà utilisé. Changez serveur.port dans config.yml, ou lancez : npm start -- --port auto`);
      throw e;
    });
    const url = `http://${config.serveur.hote}:${serveur.address().port}`;
    console.log(`\n  Bass Player prêt : ${url}\n  Données personnelles : ${config.perso}\n  (Ctrl+C pour arrêter)\n`);
    if (config.serveur.ouvrir_navigateur) exec(`open "${url}"`);
  } catch (e) {
    console.error('\nErreur :', e.message, '\n');
    process.exit(1);
  }
}
