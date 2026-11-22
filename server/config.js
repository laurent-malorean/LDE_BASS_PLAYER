// Chargement et validation de config.yml (+ player.md), avec priorité :
// ligne de commande / variables d'environnement > config.yml > valeurs par défaut.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAUTS = {
  serveur: { port: 3000, hote: 'localhost', ouvrir_navigateur: true },
  dossiers: { contenu: './content', donnees: './data', sauvegardes: './backups' },
  sauvegarde: { active: true, frequence: 'quotidienne', conserver: 30 },
  audio: {
    volume_general: 0.8,
    son_basse: 'synthese',
    metronome: { bpm_defaut: 80, chiffrage: '4/4', volume: 0.6, decompte_mesures: 1, son: 'clic' },
  },
  micro: { actif: true, peripherique: 'defaut', sensibilite: 0.5, tolerance_cents: 35, tolerance_temps_ms: 150 },
  interface: { theme: 'auto', taille_manche: 'moyenne' },
  avance: { journal: 'info' },
};

export const PLAYER_DEFAUTS = {
  langue: 'fr',
  main_dominante: 'droitier',
  main_frette: 'gauche',
  main_pincement: 'droite',
  basse: { cordes: 4, accordage: ['E', 'A', 'D', 'G'], type: 'short-scale', nb_frettes: 20 },
  niveau: 'debutant',
  notation_notes: 'francaise',
  objectif: '',
  temps_pratique_min_par_jour: 20,
};

function fusion(base, extra) {
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) return extra ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? fusion(base[k], v) : v;
  }
  return out;
}

function lireYaml(fichier) {
  if (!fs.existsSync(fichier)) return {};
  try {
    return YAML.parse(fs.readFileSync(fichier, 'utf8')) ?? {};
  } catch (e) {
    throw new Error(`${path.basename(fichier)} : YAML invalide (${e.message})`);
  }
}

export function lirePlayer(perso) {
  const f = path.join(perso, 'player.md');
  if (!fs.existsSync(f)) return structuredClone(PLAYER_DEFAUTS);
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let data = {};
  if (m) {
    try { data = YAML.parse(m[1]) ?? {}; }
    catch (e) { throw new Error(`player.md : en-tête YAML invalide (${e.message})`); }
  }
  const p = fusion(PLAYER_DEFAUTS, data);
  // Cohérence : droitier -> main de frette gauche, et inversement, sauf indication contraire.
  if (!data.main_frette) p.main_frette = p.main_dominante === 'gaucher' ? 'droite' : 'gauche';
  if (!data.main_pincement) p.main_pincement = p.main_dominante === 'gaucher' ? 'gauche' : 'droite';
  return p;
}

function arg(nom, argv) {
  const i = argv.findIndex((a) => a === `--${nom}` || a.startsWith(`--${nom}=`));
  if (i < 0) return undefined;
  const a = argv[i];
  return a.includes('=') ? a.split('=').slice(1).join('=') : argv[i + 1];
}

export function validerConfig(c) {
  const erreurs = [];
  const nb = (chemin, v, min, max) => {
    if (typeof v !== 'number' || Number.isNaN(v) || v < min || v > max) {
      erreurs.push(`${chemin} doit être un nombre entre ${min} et ${max} (reçu : ${JSON.stringify(v)})`);
    }
  };
  const choix = (chemin, v, liste) => {
    if (!liste.includes(v)) erreurs.push(`${chemin} doit valoir ${liste.join(' | ')} (reçu : ${JSON.stringify(v)})`);
  };
  if (c.serveur.port !== 'auto') {
    if (!Number.isInteger(c.serveur.port) || c.serveur.port < 1 || c.serveur.port > 65535) {
      erreurs.push(`serveur.port doit être un entier entre 1 et 65535 ou "auto" (reçu : ${JSON.stringify(c.serveur.port)})`);
    }
  }
  if (typeof c.serveur.hote !== 'string' || !c.serveur.hote) erreurs.push('serveur.hote doit être un texte non vide');
  choix('sauvegarde.frequence', c.sauvegarde.frequence, ['quotidienne', 'a_chaque_demarrage']);
  nb('sauvegarde.conserver', c.sauvegarde.conserver, 1, 1000);
  nb('audio.volume_general', c.audio.volume_general, 0, 1);
  choix('audio.son_basse', c.audio.son_basse, ['synthese', 'echantillons']);
  nb('audio.metronome.bpm_defaut', c.audio.metronome.bpm_defaut, 20, 300);
  nb('audio.metronome.volume', c.audio.metronome.volume, 0, 1);
  nb('audio.metronome.decompte_mesures', c.audio.metronome.decompte_mesures, 0, 8);
  choix('audio.metronome.son', c.audio.metronome.son, ['clic', 'bois', 'cloche']);
  if (!/^\d{1,2}\/(2|4|8|16)$/.test(String(c.audio.metronome.chiffrage))) {
    erreurs.push(`audio.metronome.chiffrage doit ressembler à "4/4" (reçu : ${JSON.stringify(c.audio.metronome.chiffrage)})`);
  }
  nb('micro.sensibilite', c.micro.sensibilite, 0, 1);
  nb('micro.tolerance_cents', c.micro.tolerance_cents, 1, 100);
  nb('micro.tolerance_temps_ms', c.micro.tolerance_temps_ms, 10, 1000);
  choix('interface.theme', c.interface.theme, ['clair', 'sombre', 'auto']);
  choix('interface.taille_manche', c.interface.taille_manche, ['petite', 'moyenne', 'grande']);
  choix('avance.journal', c.avance.journal, ['erreur', 'info', 'debug']);
  return erreurs;
}

/** Dossier des données personnelles (futur dépôt privé) : --perso, sinon BASS_PERSO, sinon ./perso. */
export function resoudrePerso({ racine = ROOT, argv = process.argv.slice(2), env = process.env } = {}) {
  return path.resolve(racine, arg('perso', argv) ?? env.BASS_PERSO ?? './perso');
}

/** Premier lancement : crée le dossier perso à partir des modèles du moteur (sans rien écraser). */
export function initialiserPerso(racine, perso) {
  fs.mkdirSync(perso, { recursive: true });
  for (const [modele, cible] of [['config.example.yml', 'config.yml'], ['player.example.md', 'player.md']]) {
    const src = path.join(racine, modele);
    const dst = path.join(perso, cible);
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }
}

export function chargerConfig({ racine = ROOT, argv = process.argv.slice(2), env = process.env } = {}) {
  const perso = resoudrePerso({ racine, argv, env });
  initialiserPerso(racine, perso);
  const brut = lireYaml(path.join(perso, 'config.yml'));
  const c = structuredClone(fusion(structuredClone(DEFAUTS), brut)); // jamais de mutation des défauts partagés
  const port = arg('port', argv) ?? env.PORT;
  if (port !== undefined) c.serveur.port = port === 'auto' ? 'auto' : Number(port);
  const hote = arg('hote', argv) ?? env.HOST;
  if (hote) c.serveur.hote = hote;
  if (argv.includes('--no-open')) c.serveur.ouvrir_navigateur = false;
  const erreurs = validerConfig(c);
  if (erreurs.length) {
    const e = new Error('Configuration invalide :\n  - ' + erreurs.join('\n  - '));
    e.erreurs = erreurs;
    throw e;
  }
  // contenu : cours du moteur (relatif au moteur) ; données et sauvegardes : relatives au dossier perso
  c.dossiers.contenu = path.resolve(racine, c.dossiers.contenu);
  for (const k of ['donnees', 'sauvegardes']) c.dossiers[k] = path.resolve(perso, c.dossiers[k]);
  c.perso = perso;
  return c;
}
