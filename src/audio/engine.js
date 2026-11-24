// Moteur audio : synthèse 100 % Web Audio (aucun sample), bus d'effets,
// instruments du séquenceur et effets sonores.
//
// Graphe :
//   instruments ─► musicBus ─┐
//   pad ─► padDuck ─► musicBus│
//   sfx ─► sfxBus ───────────┼─► master ─► masterFilter ─► compressor ─► destination
//   *.send ─► reverb ────────┤                                  └─► analyser
//   *.send ─► delay(fb) ─────┘

import { midiToFreq } from '../music/theory.js';
import { STYLES } from '../music/styles.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this._throttle = new Map();
    this.volume = 0.8;
  }

  /** @param {BaseAudioContext} [existing] contexte fourni (ex. OfflineAudioContext pour l'export). */
  init(existing = null) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = existing || new AC({ latencyHint: 'interactive' }));

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 20000;
    this.masterFilter.Q.value = 0.7;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.18;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.75;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.master.connect(this.masterFilter);
    this.masterFilter.connect(this.comp);
    this.comp.connect(ctx.destination);
    this.comp.connect(this.analyser);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.9;
    this.musicBus.connect(this.master);

    this.padDuck = ctx.createGain();
    this.padDuck.connect(this.musicBus);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.75;
    this.sfxBus.connect(this.master);

    // Réverbe à réponse impulsionnelle générée
    // (entrée coupe-bas : la réverbe n'empâte pas le grave)
    this.reverb = ctx.createBiquadFilter();
    this.reverb.type = 'highpass';
    this.reverb.frequency.value = 220;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this._makeImpulse(2.6, 3.2);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.42;
    this.reverb.connect(this.convolver);
    this.convolver.connect(this.reverbOut);
    this.reverbOut.connect(this.master);

    // Delay ping-pong synchronisé au tempo (croche pointée), feedback filtré
    this.delay = ctx.createGain(); // entrée des envois
    this.delayL = ctx.createDelay(2);
    this.delayR = ctx.createDelay(2);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.42;
    this.delayLP = ctx.createBiquadFilter();
    this.delayLP.type = 'lowpass';
    this.delayLP.frequency.value = 2800;
    const merger = ctx.createChannelMerger(2);
    this.delayOut = ctx.createGain();
    this.delayOut.gain.value = 0.5;
    this.delay.connect(this.delayL);
    this.delayL.connect(this.delayLP);
    this.delayLP.connect(merger, 0, 0);
    this.delayLP.connect(this.delayR);
    this.delayR.connect(merger, 0, 1);
    this.delayR.connect(this.delayFb);
    this.delayFb.connect(this.delayL);
    merger.connect(this.delayOut);
    this.delayOut.connect(this.master);
    this.delayOut.connect(this.reverb);

    this.noise = this._makeNoise(2);
    this.drive = this._makeDriveCurve(2.5);
    this.ready = true;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  /** Latence de sortie : le son planifié à t est entendu quand currentTime ≈ t + latency. */
  get latency() { return this.ctx ? (this.ctx.outputLatency || this.ctx.baseLatency || 0) : 0; }

  resume() { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume(); return Promise.resolve(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend(); return Promise.resolve(); }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.now, 0.05);
  }

  /** Coupe-bas global (menus, pause, montée du DROP). */
  setMasterFilter(freq, glide = 0.25) {
    if (!this.ctx) return;
    const p = this.masterFilter.frequency;
    p.cancelScheduledValues(this.now);
    p.setTargetAtTime(freq, this.now, glide / 3);
  }

  setTempo(bpm) {
    if (!this.ctx) return;
    const step = 60 / bpm / 4;
    for (const d of [this.delayL, this.delayR]) d.delayTime.setTargetAtTime(step * 3, this.now, 0.05); // croche pointée
  }

  getSpectrum() {
    if (!this.ready) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  // ───────────────────────────── utilitaires ─────────────────────────────

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _makeDriveCurve(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  _noiseSource(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const offset = Math.random() * (this.noise.duration - dur - 0.05);
    src.start(t, Math.max(0, offset), dur + 0.05);
    this._track(src, t + dur + 0.05);
    return src;
  }

  _env(t, peak, attack, decay, target = this.musicBus) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(target);
    return g;
  }

  _sends(node, reverb = 0, delay = 0) {
    if (reverb > 0) { const s = this.ctx.createGain(); s.gain.value = reverb; node.connect(s); s.connect(this.reverb); }
    if (delay > 0) { const s = this.ctx.createGain(); s.gain.value = delay; node.connect(s); s.connect(this.delay); }
  }

  /** Limite la densité d'un même effet sonore (évite la saturation quand 40 ennemis meurent). */
  _allow(key, gap) {
    const last = this._throttle.get(key) || -1;
    const t = this.now;
    if (t - last < gap) return false;
    this._throttle.set(key, t);
    return true;
  }

  // ───────────────────────────── routage ─────────────────────────────

  /** Connecte une source à une destination, avec panoramique stéréo optionnel. */
  _out(node, pan = 0, target = this.musicBus) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      p.connect(target);
      return p;
    }
    node.connect(target);
    return node;
  }

  /** Enveloppe d'amplitude non connectée (attaque linéaire, extinction exponentielle). */
  _vca(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  _osc(type, freq, t, end, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.value = detune;
    o.start(t);
    o.stop(end);
    this._track(o, end);
    return o;
  }

  /**
   * Rendu hors-ligne : on retient les sources et leur fin pour les débrancher ensuite.
   * Une source débranchée libère toute sa chaîne (filtres, gains, panoramiques), ce qui
   * garde le coût de rendu proportionnel à la durée du morceau.
   */
  _track(node, end) { if (this.collectable) this.collectable.push([node, end + 0.5]); }

  collect(now) {
    if (!this.collectable) return;
    const keep = [];
    for (const item of this.collectable) {
      if (item[1] < now) { try { item[0].disconnect(); } catch { /* déjà débranché */ } } else keep.push(item);
    }
    this.collectable = keep;
  }

  /** Sidechain : la nappe « respire » sous la grosse caisse. */
  _duck(t, depth = 0.3, release = 0.28) {
    const p = this.padDuck.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(depth, t);
    p.linearRampToValueAtTime(1, t + release);
  }

  // ───────────────────────────── batterie ─────────────────────────────

  kick(t, vel = 1, s = STYLES.synthwave.kick) {
    const ctx = this.ctx;
    const o = this._osc('sine', s.f0, t, t + s.decay + 0.1);
    o.frequency.exponentialRampToValueAtTime(s.f1, t + 0.12);
    const g = this._vca(t, s.level * vel, 0.002, s.decay);
    o.connect(g); this._out(g);

    if (s.click > 0) {
      const click = this._noiseSource(t, 0.02);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const cg = this._vca(t, s.click * vel, 0.001, 0.02);
      click.connect(hp); hp.connect(cg); this._out(cg);
    }
    if (s.rumble) {
      // grondement techno : la queue de la grosse caisse saturée dans la réverbe, filtrée en bas
      const r = this._osc('sine', s.f1, t + 0.04, t + 0.7);
      const sh = ctx.createWaveShaper(); sh.curve = this.drive;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const rg = this._vca(t + 0.04, 0.22 * vel, 0.02, 0.55);
      r.connect(sh); sh.connect(lp); lp.connect(rg); this._out(rg);
      this._sends(rg, 0.25, 0);
    }
    this._duck(t);
  }

  snare(t, vel = 1, { s = STYLES.synthwave.snare, delay = 0, pan = 0 } = {}) {
    const ctx = this.ctx;
    if (s.type === 'clap') {
      // trois impacts rapprochés + queue : le clap des boîtes à rythmes analogiques
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = s.noise; bp.Q.value = 1.1;
      const out = ctx.createGain(); out.gain.value = 0.75 * vel;
      bp.connect(out); this._out(out, pan);
      this._sends(out, s.reverb, delay);
      for (const off of [0, 0.011, 0.023]) {
        const n = this._noiseSource(t + off, 0.02);
        const g = this._vca(t + off, 0.8, 0.001, 0.012);
        n.connect(g); g.connect(bp);
      }
      const tail = this._noiseSource(t + 0.03, s.decay);
      const tg = this._vca(t + 0.03, 0.6, 0.002, s.decay);
      tail.connect(tg); tg.connect(bp);
      return;
    }
    if (s.type === 'rim') {
      const o = this._osc('triangle', s.tone, t, t + 0.08);
      const g = this._vca(t, 0.35 * vel, 0.001, s.decay);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
      o.connect(hp); hp.connect(g); this._out(g, pan || 0.15);
      const n = this._noiseSource(t, 0.03);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = s.noise; bp.Q.value = 2;
      const ng = this._vca(t, 0.25 * vel, 0.001, 0.025);
      n.connect(bp); bp.connect(ng); this._out(ng, pan || 0.15);
      this._sends(g, s.reverb, delay);
      return;
    }
    const n = this._noiseSource(t, s.decay + 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = s.noise; bp.Q.value = 0.8;
    const g = this._vca(t, 0.55 * vel, 0.001, s.decay);
    n.connect(bp); bp.connect(g); this._out(g, pan);
    this._sends(g, s.reverb, delay);
    const o = this._osc('triangle', s.tone * 1.15, t, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(s.tone * 0.7, t + 0.08);
    const og = this._vca(t, 0.45 * vel, 0.001, 0.1);
    o.connect(og); this._out(og, pan);
  }

  hat(t, vel = 1, { open = false, delay = 0, pan = -0.25, s = STYLES.synthwave.hat } = {}) {
    const ctx = this.ctx;
    const dur = open ? s.open : s.decay;
    const n = this._noiseSource(t, dur);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = s.freq;
    const g = this._vca(t, s.level * vel, 0.001, dur);
    n.connect(hp); hp.connect(g); this._out(g, pan);
    this._sends(g, 0.05, delay);
  }

  /** Tom accordé (fills). */
  tom(t, midi, vel = 1, pan = 0) {
    const f = midiToFreq(midi);
    const o = this._osc('sine', f * 1.6, t, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const g = this._vca(t, 0.55 * vel, 0.002, 0.32);
    o.connect(g); this._out(g, pan);
    this._sends(g, 0.25, 0);
  }

  /** Cymbale crash en début de phrase : deux bruits filtrés ouverts en stéréo. */
  crash(t, vel = 1) {
    const ctx = this.ctx;
    for (const pan of [-0.5, 0.5]) {
      const n = this._noiseSource(t, 2);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4800;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = pan < 0 ? 6800 : 8200; pk.gain.value = 6;
      const g = this._vca(t, 0.13 * vel, 0.003, 1.8);
      n.connect(hp); hp.connect(pk); pk.connect(g); this._out(g, pan);
      this._sends(g, 0.3, 0);
    }
  }

  // ───────────────────────────── basses ─────────────────────────────

  /**
   * @param {object} o { s: style.bass, delay, slideTo (note MIDI suivante pour un glissé), accent }
   */
  bass(t, midi, dur, vel = 1, { s = STYLES.synthwave.bass, delay = 0, slideTo = null, accent = false } = {}) {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const level = s.level * vel * (accent ? 1.15 : 1);
    const hold = slideTo !== null ? dur * 1.05 : dur;

    const glide = (osc, mult = 1) => {
      if (slideTo === null) return;
      osc.frequency.setValueAtTime(f * mult, t + hold * 0.55);
      osc.frequency.exponentialRampToValueAtTime(midiToFreq(slideTo) * mult, t + hold);
    };

    switch (s.type) {
      case 'acid': {
        // 303 : scie, filtre résonant, accent = enveloppe plus brillante et plus courte
        const end = t + hold + 0.25;
        const o = this._osc('sawtooth', f, t, end);
        glide(o);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = s.q;
        const peak = s.cutoff * (accent ? 9 : 4.5);
        lp.frequency.setValueAtTime(s.cutoff, t);
        lp.frequency.exponentialRampToValueAtTime(peak, t + 0.008);
        lp.frequency.exponentialRampToValueAtTime(s.cutoff, t + (accent ? 0.14 : 0.22));
        const sh = ctx.createWaveShaper(); sh.curve = this.drive;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + 0.004);
        g.gain.setValueAtTime(level * 0.85, t + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.06);
        o.connect(lp); lp.connect(sh); sh.connect(g); this._out(g);
        this._sends(g, 0.05, delay + 0.12);
        return;
      }
      case 'sub': {
        const end = t + hold + 0.3;
        const o = this._osc('sine', f, t, end);
        const o2 = this._osc('triangle', f * 2, t, end);
        glide(o); glide(o2, 2);
        const g2 = ctx.createGain(); g2.gain.value = 0.18;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = s.cutoff;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + 0.012);
        g.gain.setValueAtTime(level * 0.9, t + hold);
        g.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.18);
        o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); this._out(g);
        return;
      }
      case 'reese': {
        // deux scies désaccordées qui « battent » + sub, filtre lent : la basse drum & bass
        const end = t + hold * 1.6 + 0.2;
        const a = this._osc('sawtooth', f, t, end, -14);
        const b = this._osc('sawtooth', f, t, end, 14);
        const sub = this._osc('sine', f, t, end);
        glide(a); glide(b); glide(sub);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = s.q;
        lp.frequency.setValueAtTime(s.cutoff * 0.6, t);
        lp.frequency.linearRampToValueAtTime(s.cutoff * 1.3, t + hold * 1.2);
        const sh = ctx.createWaveShaper(); sh.curve = this.drive;
        const mix = ctx.createGain(); mix.gain.value = 0.5;
        const subG = ctx.createGain(); subG.gain.value = 0.7;
        const g = this._vca(t, level, 0.01, hold * 1.6);
        a.connect(mix); b.connect(mix); mix.connect(lp); lp.connect(sh); sh.connect(g);
        sub.connect(subG); subG.connect(g);
        this._out(g);
        this._sends(g, 0, delay);
        return;
      }
      default: { // pluck
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = s.q;
        lp.frequency.setValueAtTime(180, t);
        lp.frequency.exponentialRampToValueAtTime(s.cutoff * vel + 200, t + 0.02);
        lp.frequency.exponentialRampToValueAtTime(160, t + dur * 1.6);
        const sh = ctx.createWaveShaper(); sh.curve = this.drive;
        const g = this._vca(t, level, 0.004, dur * 1.8);
        const end = t + dur * 2 + 0.05;
        const o1 = this._osc('sawtooth', f, t, end);
        const o2 = this._osc('square', f / 2, t, end);
        glide(o1); glide(o2, 0.5);
        const g2 = ctx.createGain(); g2.gain.value = 0.5;
        o1.connect(lp); o2.connect(g2); g2.connect(lp);
        lp.connect(sh); sh.connect(g); this._out(g);
        this._sends(g, 0, delay);
      }
    }
  }

  // ───────────────────────────── lead ─────────────────────────────

  lead(t, midi, dur, vel = 1, { s = STYLES.synthwave.lead, delay = 0, pan = 0 } = {}) {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const level = s.level * vel;
    const out = ctx.createGain(); out.gain.value = 1;
    this._out(out, pan);
    this._sends(out, s.reverb, s.delay + delay);

    switch (s.type) {
      case 'fm': {
        // FM à deux opérateurs, ratio 3,5 : cloche / Rhodes numérique
        const end = t + 1.4;
        const car = this._osc('sine', f, t, end);
        const mod = this._osc('sine', f * 3.5, t, end);
        const idx = ctx.createGain();
        idx.gain.setValueAtTime(f * 2.2 * vel, t);
        idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.6);
        mod.connect(idx); idx.connect(car.frequency);
        const g = this._vca(t, level * 1.3, 0.003, 1.2);
        car.connect(g); g.connect(out);
        return;
      }
      case 'stab': {
        const end = t + 0.35;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
        lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.2);
        const g = this._vca(t, level * 1.2, 0.002, 0.2);
        for (const [type, det] of [['square', -5], ['sawtooth', 5]]) this._osc(type, f, t, end, det).connect(lp);
        lp.connect(g); g.connect(out);
        return;
      }
      case 'brass': {
        const end = t + dur * 2.4 + 0.3;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(500, t);
        lp.frequency.linearRampToValueAtTime(3200, t + 0.06);
        lp.frequency.exponentialRampToValueAtTime(1300, t + 0.3);
        const lfo = this._osc('sine', 5.5, t, end);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(7, t + 0.25);
        lfo.connect(depth);
        const g = this._vca(t, level, 0.03, dur * 2.2 + 0.2);
        for (const det of [-6, 6]) {
          const o = this._osc('sawtooth', f, t, end, det);
          depth.connect(o.detune);
          o.connect(lp);
        }
        lp.connect(g); g.connect(out);
        return;
      }
      default: { // supersaw (pluck large, stéréo)
        const end = t + dur * 2.5 + 0.1;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
        lp.frequency.setValueAtTime(5000, t);
        lp.frequency.exponentialRampToValueAtTime(800, t + dur * 2.2);
        const g = this._vca(t, level, 0.003, dur * 2.3);
        lp.connect(g); g.connect(out);
        for (const [det, p] of [[-13, -0.45], [0, 0], [13, 0.45]]) {
          const o = this._osc('sawtooth', f, t, end, det);
          if (p && ctx.createStereoPanner) {
            const pn = ctx.createStereoPanner(); pn.pan.value = p;
            const vg = ctx.createGain(); vg.gain.value = 0.7;
            o.connect(vg); vg.connect(pn); pn.connect(lp);
          } else o.connect(lp);
        }
      }
    }
  }

  // ───────────────────────────── nappes ─────────────────────────────

  /** Nappe d'accord (non-arme), une par mesure. */
  pad(t, midis, dur, vel = 1, s = STYLES.synthwave.pad) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = s.cutoff; lp.Q.value = 0.5;
    const g = ctx.createGain();
    const lvl = s.level * vel;
    const attack = s.type === 'organ' ? 0.02 : dur * 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(lvl, t + attack);
    g.gain.linearRampToValueAtTime(lvl * 0.85, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.08);
    lp.connect(g); g.connect(this.padDuck);
    this._sends(g, s.reverb, 0);
    const end = t + dur * 1.12;
    const n = midis.length;

    midis.forEach((m, i) => {
      const f = midiToFreq(m);
      const pan = n > 1 ? (i / (n - 1) - 0.5) * 0.9 : 0;
      const voice = ctx.createGain();
      voice.gain.value = 1 / Math.sqrt(n);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner(); p.pan.value = pan;
        voice.connect(p); p.connect(lp);
      } else voice.connect(lp);

      switch (s.type) {
        case 'fm': {
          const car = this._osc('sine', f, t, end);
          const mod = this._osc('sine', f, t, end);
          const idx = ctx.createGain(); idx.gain.value = f * 0.9;
          mod.connect(idx); idx.connect(car.frequency);
          car.connect(voice);
          break;
        }
        case 'organ': {
          [[1, 1], [2, 0.5], [3, 0.3], [4, 0.15]].forEach(([h, a]) => {
            const o = this._osc('sine', f * h, t, end);
            const hg = ctx.createGain(); hg.gain.value = a * 0.6;
            o.connect(hg); hg.connect(voice);
          });
          break;
        }
        case 'dark': {
          this._osc('sawtooth', f, t, end, -6).connect(voice);
          this._osc('triangle', f / 2, t, end).connect(voice);
          break;
        }
        default: // strings
          for (const det of [-9, 9]) this._osc('sawtooth', f, t, end, det).connect(voice);
      }
    });
  }

  // ───────────────────────────── effets sonores ─────────────────────────────

  hit(midi) {
    if (!this._allow('hit', 0.035)) return;
    const t = this.now, ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(midiToFreq(midi + 12), t);
    o.frequency.exponentialRampToValueAtTime(midiToFreq(midi), t + 0.05);
    const g = this._env(t, 0.06, 0.001, 0.06, this.sfxBus);
    o.connect(g); o.start(t); o.stop(t + 0.1);
  }

  death(midi, big = false) {
    if (!this._allow(big ? 'deathBig' : 'death', 0.04)) return;
    const t = this.now, ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(midiToFreq(midi), t);
    const g = this._env(t, big ? 0.14 : 0.08, 0.002, big ? 0.5 : 0.22, this.sfxBus);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    o.connect(lp); lp.connect(g);
    this._sends(g, 0.3, 0.15);
    o.start(t); o.stop(t + 0.6);
    if (big) {
      const n = this._noiseSource(t, 0.5);
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.setValueAtTime(3000, t);
      bp.frequency.exponentialRampToValueAtTime(100, t + 0.5);
      const ng = this._env(t, 0.35, 0.002, 0.5, this.sfxBus);
      n.connect(bp); bp.connect(ng);
    }
  }

  pickup(midi) {
    if (!this._allow('pickup', 0.03)) return;
    const t = this.now, ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = midiToFreq(midi + 24);
    const g = this._env(t, 0.05, 0.002, 0.12, this.sfxBus);
    o.connect(g); o.start(t); o.stop(t + 0.15);
  }

  hurt() {
    const t = this.now, ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.35);
    const sh = ctx.createWaveShaper(); sh.curve = this._makeDriveCurve(8);
    const g = this._env(t, 0.5, 0.002, 0.4, this.sfxBus);
    o.connect(sh); sh.connect(g); o.start(t); o.stop(t + 0.45);
    const n = this._noiseSource(t, 0.3);
    const ng = this._env(t, 0.3, 0.001, 0.25, this.sfxBus);
    n.connect(ng);
  }

  dash(perfect) {
    const t = this.now, ctx = this.ctx;
    const n = this._noiseSource(t, 0.25);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(5000, t + 0.18);
    const g = this._env(t, 0.22, 0.01, 0.2, this.sfxBus);
    n.connect(bp); bp.connect(g);
    if (perfect) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1320, t + 0.06);
      const og = this._env(t, 0.12, 0.002, 0.3, this.sfxBus);
      o.connect(og); this._sends(og, 0.4, 0.3);
      o.start(t); o.stop(t + 0.35);
    }
  }

  enemyShot() {
    if (!this._allow('eshot', 0.06)) return;
    const t = this.now, ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1200, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.08);
    const g = this._env(t, 0.05, 0.001, 0.08, this.sfxBus);
    o.connect(g); o.start(t); o.stop(t + 0.1);
  }

  spawn() {
    if (!this._allow('spawn', 0.1)) return;
    const t = this.now, ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.15);
    const g = this._env(t, 0.05, 0.05, 0.12, this.sfxBus);
    o.connect(g); o.start(t); o.stop(t + 0.25);
  }

  /** Montée avant le DROP : bruit filtré + scie qui grimpe jusqu'au « 1 ». */
  riser(t, dur) {
    const ctx = this.ctx;
    const n = this._noiseSource(t, dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.08, t + dur);
    og.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    o.connect(og); og.connect(this.sfxBus); this._sends(og, 0.3, 0);
    o.start(t); o.stop(t + dur + 0.05);
  }

  dropImpact(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    const sh = ctx.createWaveShaper(); sh.curve = this.drive;
    const g = this._env(t, 1.0, 0.003, 1.6, this.sfxBus);
    o.connect(sh); sh.connect(g); o.start(t); o.stop(t + 1.7);
    const n = this._noiseSource(t, 1.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(80, t + 1.2);
    const ng = this._env(t, 0.5, 0.002, 1.2, this.sfxBus);
    n.connect(lp); lp.connect(ng); this._sends(ng, 0.8, 0);
  }

  ui(kind = 'click') {
    if (!this.ready || !this._allow('ui' + kind, 0.03)) return;
    const t = this.now, ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = kind === 'hover' ? 'sine' : 'triangle';
    const f = kind === 'hover' ? 1400 : kind === 'confirm' ? 660 : 990;
    o.frequency.setValueAtTime(f, t);
    if (kind === 'confirm') o.frequency.setValueAtTime(f * 1.5, t + 0.07);
    const g = this._env(t, kind === 'hover' ? 0.025 : 0.08, 0.002, kind === 'confirm' ? 0.25 : 0.07, this.sfxBus);
    o.connect(g); this._sends(g, 0.2, 0);
    o.start(t); o.stop(t + 0.3);
  }
}
