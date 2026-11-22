// Moteur audio : basse synthétique (corde pincée, Karplus-Strong), métronome, séquenceur précis.
import { freq } from './music.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.cache = new Map();
    this.volume = 0.8;
    this.volumeMetro = 0.6;
    this.sonMetro = 'clic';
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  reglerVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  // Corde pincée : bruit filtré circulant dans une ligne à retard avec perte (Karplus-Strong).
  tampon(midi) {
    if (this.cache.has(midi)) return this.cache.get(midi);
    const sr = this.ctx.sampleRate;
    const f = freq(midi);
    const N = Math.max(2, Math.round(sr / f));
    const duree = 2.5;
    const longueur = Math.floor(sr * duree);
    const buf = this.ctx.createBuffer(1, longueur, sr);
    const d = buf.getChannelData(0);
    // excitation : bruit lissé (son rond de basse)
    let seed = 12345 + midi;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 31 - 1; };
    const ligne = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) { prev = 0.55 * prev + 0.45 * rnd(); ligne[i] = prev; }
    const decay = 0.9985 - Math.min(0.004, 40 / f * 0.0001);
    let idx = 0;
    for (let i = 0; i < longueur; i++) {
      const a = ligne[idx];
      const b = ligne[(idx + 1) % N];
      const v = (a + b) * 0.5 * decay;
      ligne[idx] = v;
      d[i] = a;
      idx = (idx + 1) % N;
    }
    // normalisation
    let max = 0;
    for (let i = 0; i < longueur; i++) max = Math.max(max, Math.abs(d[i]));
    for (let i = 0; i < longueur; i++) d[i] /= max || 1;
    const res = { buf, baseFreq: sr / N };
    this.cache.set(midi, res);
    return res;
  }

  jouerNote(midi, quand = 0, duree = 1.2, vel = 0.9) {
    const ctx = this.init();
    const t = Math.max(quand, ctx.currentTime);
    const { buf, baseFreq } = this.tampon(midi);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = freq(midi) / baseFreq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(2200, freq(midi) * 14);
    lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.9, t + 0.004);
    const fin = t + Math.max(0.15, duree);
    g.gain.setValueAtTime(vel * 0.9, Math.max(t + 0.005, fin - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0008, fin + 0.18);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(fin + 0.3);
  }

  clic(quand, accent = false, doux = false) {
    const ctx = this.init();
    const t = Math.max(quand, ctx.currentTime);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const type = this.sonMetro;
    const cfg = {
      clic: { type: 'square', f: accent ? 1800 : 1200, d: 0.03 },
      bois: { type: 'triangle', f: accent ? 1000 : 700, d: 0.05 },
      cloche: { type: 'sine', f: accent ? 1760 : 1175, d: 0.28 },
    }[type] ?? { type: 'square', f: 1200, d: 0.03 };
    o.type = cfg.type;
    o.frequency.value = cfg.f;
    const pic = this.volumeMetro * (accent ? 1 : 0.7) * 0.8 * (doux ? 0.45 : 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pic, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + cfg.d);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + cfg.d + 0.05);
  }
}

/**
 * Séquenceur : planifie notes et clics à l'avance sur l'horloge audio (pas de dérive),
 * et déclenche les rappels visuels au bon moment via requestAnimationFrame.
 *
 * options : { bpm, tempsParMesure, evenements, total, metronome, decompte (en mesures),
 *             boucle, onTemps(info), onNote(index), onFin() }
 * Les durées sont en « temps » (la pulsation du chiffrage).
 */
export class Sequenceur {
  constructor(audio) {
    this.audio = audio;
    this.actif = false;
    this.file = [];
  }

  demarrer(o) {
    this.arreter();
    const ctx = this.audio.init();
    this.o = o;
    this.actif = true;
    const spb = 60 / o.bpm;
    const decompteTemps = (o.decompte ?? 0) * o.tempsParMesure;
    this.t0 = ctx.currentTime + 0.12 + decompteTemps * spb; // instant du temps 0 de la partition
    this.depart = ctx.currentTime + 0.12;
    this.spb = spb;
    this.prochainTemps = -decompteTemps; // prochain temps de métronome à planifier
    this.prochaineNote = 0;
    this.compteBoucle = 0;
    this.finTemps = o.total;
    this.file = [];
    this.timer = setInterval(() => this.planifier(), 25);
    this.planifier();
    const boucleVisuelle = () => {
      if (!this.actif) return;
      const now = ctx.currentTime;
      while (this.file.length && this.file[0].t <= now) this.file.shift().fn();
      this.raf = requestAnimationFrame(boucleVisuelle);
    };
    this.raf = requestAnimationFrame(boucleVisuelle);
  }

  planifier() {
    if (!this.actif) return;
    const o = this.o; const ctx = this.audio.ctx;
    const horizon = ctx.currentTime + 0.15;
    const tempsAbs = (b) => this.t0 + b * this.spb;
    // métronome
    while (tempsAbs(this.prochainTemps) < horizon && this.prochainTemps < this.finTemps) {
      const b = this.prochainTemps;
      const posMesure = ((b % o.tempsParMesure) + o.tempsParMesure) % o.tempsParMesure;
      const t = tempsAbs(b);
      if (o.metronome) {
        this.audio.clic(t, posMesure === 0);
        for (let k = 1; k < (o.subdivision ?? 1); k++) this.audio.clic(t + (k * this.spb) / o.subdivision, false, true);
      }
      this.file.push({ t, fn: () => o.onTemps?.({ temps: b, posMesure, decompte: b < 0 }) });
      this.prochainTemps++;
    }
    // notes
    while (this.prochaineNote < o.evenements.length && tempsAbs(o.evenements[this.prochaineNote].debut) < horizon) {
      const i = this.prochaineNote;
      const e = o.evenements[i];
      const t = tempsAbs(e.debut);
      if (!e.silence) this.audio.jouerNote(e.midi, t, e.duree * this.spb * 0.95);
      this.file.push({ t, fn: () => o.onNote?.(i) });
      this.prochaineNote++;
    }
    // fin / boucle
    if (this.prochainTemps >= this.finTemps && this.prochaineNote >= o.evenements.length) {
      const tFin = tempsAbs(this.finTemps);
      if (o.boucle) {
        this.compteBoucle++;
        this.t0 = tFin; this.prochainTemps = 0; this.prochaineNote = 0;
        this.file.push({ t: tFin, fn: () => o.onBoucle?.(this.compteBoucle) });
      } else if (!this.finPlanifiee) {
        this.finPlanifiee = true;
        this.file.push({ t: tFin, fn: () => { const f = o.onFin; this.arreter(); f?.(); } });
      }
    }
  }

  arreter() {
    this.actif = false;
    this.finPlanifiee = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.file = [];
  }
}
