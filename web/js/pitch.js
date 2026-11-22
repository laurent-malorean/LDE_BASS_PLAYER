// Écoute du micro : détection de hauteur (algorithme YIN) adaptée à la basse (≈ 30–400 Hz).
import { midiDepuisFreq, pitchClass } from './music.js';

export function detecterHauteur(buf, sr, { fmin = 30, fmax = 420, seuil = 0.15 } = {}) {
  const W = Math.floor(buf.length / 2);
  const tauMax = Math.min(W - 1, Math.floor(sr / fmin));
  const tauMin = Math.max(2, Math.floor(sr / fmax));
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let somme = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; somme += x * x; }
    d[tau] = somme;
  }
  // différence normalisée cumulée
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let cumul = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    cumul += d[tau];
    cmnd[tau] = cumul === 0 ? 1 : (d[tau] * tau) / cumul;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < seuil) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) return { freq: 0, clarte: 0, rms };
  // interpolation parabolique
  const a = cmnd[tau - 1] ?? cmnd[tau]; const b = cmnd[tau]; const c = cmnd[tau + 1] ?? cmnd[tau];
  const denom = 2 * (2 * b - c - a);
  const decal = denom !== 0 ? (c - a) / denom : 0;
  const tauAffine = tau + decal;
  return { freq: sr / tauAffine, clarte: 1 - cmnd[tau], rms };
}

export class Micro {
  constructor() { this.flux = null; this.ctx = null; this.actif = false; }

  async demarrer({ peripherique = 'defaut', sensibilite = 0.5, surMesure } = {}) {
    if (this.actif) return;
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (peripherique && peripherique !== 'defaut') audio.deviceId = { ideal: peripherique };
    this.flux = await navigator.mediaDevices.getUserMedia({ audio });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.flux);
    this.analyseur = this.ctx.createAnalyser();
    this.analyseur.fftSize = 4096;
    src.connect(this.analyseur);
    this.buf = new Float32Array(this.analyseur.fftSize);
    this.rmsMin = 0.002 + 0.03 * (1 - sensibilite) ** 2;
    this.actif = true;
    this.surMesure = surMesure;
    this.boucle = setInterval(() => this.mesurer(), 40);
  }

  mesurer() {
    if (!this.actif) return;
    this.analyseur.getFloatTimeDomainData(this.buf);
    const r = detecterHauteur(this.buf, this.ctx.sampleRate);
    const valide = r.freq > 0 && r.clarte > 0.7 && r.rms >= this.rmsMin;
    const midiExact = valide ? midiDepuisFreq(r.freq) : null;
    const midi = valide ? Math.round(midiExact) : null;
    this.surMesure?.({ ...r, valide, midi, cents: valide ? (midiExact - midi) * 100 : 0, temps: performance.now() });
  }

  arreter() {
    this.actif = false;
    clearInterval(this.boucle);
    this.flux?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.flux = null; this.ctx = null;
  }

  static async peripheriques() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); }
    catch { return []; }
  }
}

/**
 * Valide une suite de notes jouées. Une note est acceptée quand la bonne classe de note
 * (do, ré…) est tenue ~3 mesures consécutives ; pour rejouer la même note il faut une nouvelle attaque
 * (le volume retombe puis remonte).
 */
export class Validateur {
  constructor({ toleranceCents = 35, onJuste, onFaux }) {
    this.tol = toleranceCents;
    this.onJuste = onJuste; this.onFaux = onFaux;
    this.attendu = null;
    this.compte = 0;
    this.pic = 0;
    this.verrou = false; // true tant que la note acceptée n'est pas retombée
    this.dernierFaux = 0;
  }

  // Le verrou n'est pas touché : après une note juste, la suivante exige une nouvelle attaque.
  attendre(midi) { this.attendu = midi; this.compte = 0; }

  mesure(m) {
    if (this.attendu == null) return;
    this.pic = Math.max(this.pic * 0.97, m.valide ? m.rms : 0);
    if (this.verrou) {
      if (!m.valide || m.rms < this.pic * 0.55) this.verrou = false;
      else return;
    }
    if (!m.valide) { this.compte = 0; return; }
    const bonne = pitchClass(m.midi) === pitchClass(this.attendu) && Math.abs(m.cents) <= this.tol;
    if (bonne) {
      if (++this.compte >= 3) { this.compte = 0; this.verrou = true; this.pic = m.rms; this.onJuste?.(m); }
    } else {
      this.compte = 0;
      const now = m.temps;
      if (now - this.dernierFaux > 500) { this.dernierFaux = now; this.onFaux?.(m); }
    }
  }
}
