// État global : configuration, profil joueur, réglages personnels (data/reglages.json).
import * as api from './api.js';
import { Audio } from './audio.js';

export const etat = { config: null, player: null, reglages: {}, audio: new Audio() };

export async function charger() {
  const c = await api.config();
  etat.config = c.config;
  etat.player = c.player;
  etat.reglages = (await api.lire('reglages')) ?? {};
  appliquerAudio();
  appliquerTheme();
}

// Réglage effectif = réglage personnel (data/reglages.json) sinon valeur de config.yml
export function reglage(chemin) {
  const dans = (obj) => chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  return etat.reglages[chemin] ?? dans(etat.config);
}

export async function modifierReglage(chemin, valeur) {
  etat.reglages[chemin] = valeur;
  await api.ecrire('reglages', etat.reglages);
  appliquerAudio();
  appliquerTheme();
}

export function appliquerAudio() {
  const a = etat.audio;
  a.reglerVolume(reglage('audio.volume_general'));
  a.volumeMetro = reglage('audio.metronome.volume');
  a.sonMetro = reglage('audio.metronome.son');
}

export function appliquerTheme() {
  const t = reglage('interface.theme');
  const r = document.documentElement;
  if (t === 'clair') r.dataset.theme = 'light';
  else if (t === 'sombre') r.dataset.theme = 'dark';
  else delete r.dataset.theme;
}

export const notation = () => etat.player.notation_notes;
export const gaucher = () => etat.player.main_dominante === 'gaucher';

/** Remplace les variables {{...}} des leçons par les réglages du joueur. */
export function personnaliser(texte) {
  const p = etat.player;
  const maj = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const vars = {
    main_pince: p.main_pincement, main_frette: p.main_frette,
    Main_pince: maj(p.main_pincement), Main_frette: maj(p.main_frette),
    dominante: p.main_dominante,
    cordes: String(p.basse.cordes), accordage: p.basse.accordage.join('-'),
  };
  return texte.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => vars[k] ?? m);
}
