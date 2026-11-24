// Horloge musicale à planification anticipée (pattern « A Tale of Two Clocks »).
// - pump()  : planifie les pas à venir dans la fenêtre d'anticipation (audio précis à l'échantillon)
// - drain() : délivre au gameplay les pas au moment où ils sont *entendus* (compensation de latence)

export const STEPS_PER_BAR = 16;
const LOOKAHEAD = 0.12; // s

export class Clock {
  constructor(engine, bpm = 118) {
    this.engine = engine;
    this.bpm = bpm;
    this.pendingBpm = null;
    this.running = false;
    this.queue = [];
    this.step = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.lastBeatTime = 0;
    this.lastStepHeard = -1;
    this.swing = 0; // fraction de pas (style musical courant)
  }

  get stepDur() { return 60 / this.bpm / 4; }
  get beatDur() { return 60 / this.bpm; }
  get barDur() { return this.beatDur * 4; }

  start(delay = 0.1) {
    this.running = true;
    this.step = 0;
    this.bar = 0;
    this.queue.length = 0;
    this.nextTime = this.engine.now + delay;
    this.lastBeatTime = this.nextTime;
  }

  stop() { this.running = false; this.queue.length = 0; }

  /** Le changement de tempo est appliqué sur le prochain « 1 » pour rester carré. */
  setBpm(bpm) { this.pendingBpm = bpm; }

  pump(onSchedule) {
    if (!this.running) return;
    const now = this.engine.now;
    // Onglet en arrière-plan / gros lag : on resynchronise plutôt que de rattraper.
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD) {
      if (this.step === 0 && this.pendingBpm) {
        this.bpm = this.pendingBpm;
        this.pendingBpm = null;
        this.engine.setTempo(this.bpm);
      }
      const ev = { step: this.step, bar: this.bar, time: this.nextTime, dur: this.stepDur };
      onSchedule(ev);
      this.queue.push(ev);
      this.nextTime += this.stepDur;
      this.step++;
      if (this.step >= STEPS_PER_BAR) { this.step = 0; this.bar++; }
    }
  }

  drain(onDue) {
    const heard = this.engine.now - this.engine.latency;
    // Le swing décale les doubles-croches paires : le gameplay suit le son, pas la grille.
    const due = (ev) => ev.time + (ev.step % 2 ? this.swing * ev.dur : 0);
    while (this.queue.length && due(this.queue[0]) <= heard) {
      const ev = this.queue.shift();
      if (ev.step % 4 === 0) this.lastBeatTime = ev.time;
      this.lastStepHeard = ev.step;
      onDue(ev);
    }
  }

  /** Temps actuellement entendu par le joueur. */
  get heardTime() { return this.engine.now - this.engine.latency; }

  /** Phase dans le temps courant, 0 → 1. */
  beatPhase() {
    const p = (this.heardTime - this.lastBeatTime) / this.beatDur;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  /** Écart (s) au temps le plus proche — pour juger les actions « dans le temps ». */
  offBeat() {
    const d = this.heardTime - this.lastBeatTime;
    return Math.min(Math.abs(d), Math.abs(this.beatDur - d));
  }

  /**
   * Instant audio (horloge du contexte) du prochain « 1 » de mesure situé au moins
   * `minLead` secondes dans le futur. Les pas déjà planifiés sont pris en compte.
   */
  nextBarTime(minLead = 0) {
    const limit = this.engine.now + minLead;
    for (const ev of this.queue) if (ev.step === 0 && ev.time >= limit) return ev.time;
    let t = this.nextTime + ((STEPS_PER_BAR - this.step) % STEPS_PER_BAR) * this.stepDur;
    const bpm = this.pendingBpm || this.bpm;
    const barDur = (60 / bpm) * 4;
    while (t < limit) t += barDur;
    return t;
  }
}
