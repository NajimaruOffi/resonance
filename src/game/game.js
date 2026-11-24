// Cœur du jeu : état de la partie, simulation, armes, collisions, vagues, DROP.
// La musique pilote le gameplay : Clock.pump() planifie le son, Clock.drain() déclenche
// les tirs et les comportements ennemis au moment exact où les notes sont entendues.

import { Clock } from '../audio/clock.js';
import { RNG, hashString } from '../util/rng.js';
import { TAU, clamp, len, dist2, damp, angleDiff, pointSegDist2 } from '../util/math.js';
import { SpatialHash } from '../util/spatial.js';
import { sectorForWave, SECTORS, pentaMidi } from '../music/theory.js';
import { generateStep, playEvents, previewNote } from '../music/arranger.js';
import { styleById } from '../music/styles.js';
import { createTracks, unlockTrack, snapshotTracks, TRACK_ORDER } from './tracks.js';
import { createEnemy, updateEnemy, enemyOnStep, ENEMY_DEFS } from './enemies.js';
import { buildWave, formationPositions, hpScale } from './waves.js';
import { rollOffers, applyOffer } from './upgrades.js';
import { Particles } from './particles.js';
import { SpringGrid } from './grid.js';

export const ARENA_W = 2400;
export const ARENA_H = 1500;
const START_BPM = 118;
const PERFECT_WINDOW = 0.09; // s

export class Game {
  constructor(audio, input, settings, hooks) {
    this.audio = audio;
    this.input = input;
    this.settings = settings;
    this.hooks = hooks;
    this.W = ARENA_W;
    this.H = ARENA_H;
    this.clock = new Clock(audio, START_BPM);
    this.particles = new Particles();
    this.grid = new SpringGrid(ARENA_W, ARENA_H, 50);
    this.spatial = new SpatialHash(110);
    this.mode = 'idle';
    this.paused = false;
    this.time = 0;
    this.beatCount = 0;
    this.camera = { x: ARENA_W / 2, y: ARENA_H / 2, shake: 0, zoom: 1, sx: 0, sy: 0 };
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.beatPulse = 0;
    this.kickPulse = 0;
    this.sector = SECTORS[0];
    this.enemySpeedScale = 1;
    this.viewW = 1280;
    this.viewH = 720;
    this.fxRng = new RNG(1234);
    this.resetWorld();
  }

  // ───────────────────────────── cycle de vie ─────────────────────────────

  resetWorld() {
    this.enemies = [];
    this.shots = [];      // projectiles du joueur (bolt, needle, missile)
    this.rings = [];      // ondes de la caisse claire
    this.beams = [];      // lasers de basse
    this.bullets = [];    // projectiles ennemis
    this.shards = [];     // éclats ramassables
    this.markers = [];    // télégraphes d'apparition
    this.texts = [];      // textes flottants
    this.player = {
      x: ARENA_W / 2, y: ARENA_H / 2, vx: 0, vy: 0, r: 13, aim: 0,
      dashT: 0, dashCdT: 0, dashDx: 1, dashDy: 0, iframes: 0, perfectT: 0, dashId: 0,
      trail: [], alive: true,
    };
  }

  color(key) { return this.sector.palette[key] || key; }

  /** Démarre le mode « vitrine » de l'écran titre : le jeu joue tout seul en musique. */
  startAttract() {
    this.mode = 'attract';
    this.paused = false;
    this.resetWorld();
    this.sector = SECTORS[0];
    this.enemySpeedScale = 1;
    this.boss = null;
    this.bossAlive = false;
    this.wave = null;
    this.run = this._newRun('VITRINE');
    unlockTrack(this.run.tracks.bass, this.run.musicRng);
    const lead = this.run.tracks.lead;
    lead.unlocked = true;
    lead.steps.fill(false);
    [[0, 2], [3, 1], [6, 0], [8, 4], [11, 2], [14, 3]].forEach(([st, p]) => { lead.steps[st] = true; lead.pitch[st] = p; });
    this.clock.swing = styleById(this.sector.style).swing;
    this.player.iframes = 1e9;
    this.clock.bpm = START_BPM;
    this.audio.setTempo(START_BPM);
    if (!this.clock.running) this.clock.start(0.15);
    this.audio.setMasterFilter(1400, 0.6);
  }

  /**
   * @param {string} seed
   * @param {object} [setup] configuration issue de la méta-progression (voir meta/progression.js runSetup)
   * @param {boolean} [daily]
   */
  startRun(seed, setup = null, daily = false) {
    this.resetWorld();
    this.run = this._newRun(seed, setup);
    this.run.daily = daily;
    this.mode = 'playing';
    this.paused = false;
    this.boss = null;
    this.bossAlive = false;
    this.time = 0;
    this.sector = sectorForWave(1);
    this.clock.swing = styleById(this.sector.style).swing;
    this.clock.bpm = this.run.bpm;
    this.clock.pendingBpm = null;
    this.audio.setTempo(this.run.bpm);
    if (!this.clock.running) this.clock.start(0.1);
    this.audio.setMasterFilter(20000, 0.8);
    this.startWave(1);
  }

  _newRun(seed, setup = null) {
    const s = setup || {};
    const mods = s.mods || { enemyHp: 1, enemySpeed: 1, bulletSpeed: 1, budget: 1, bossHp: 1, noHeal: false };
    const maxHp = s.maxHp ?? 5;
    const bpm = s.startBpm ?? START_BPM;
    const run = {
      seed,
      kit: s.kit || 'classic',
      intensity: s.intensity || 0,
      mods,
      noHeal: !!mods.noHeal,
      waveRng: new RNG(`${seed}:waves`),
      offerRng: new RNG(`${seed}:offers`),
      spawnRng: new RNG(`${seed}:spawn`),
      musicRng: new RNG(`${seed}:music`),
      songLog: [],
      hp: maxHp, maxHp, crit: 0.05 + (s.critBonus || 0), dashCd: 0.85, dropGain: 1,
      magnet: 150 * (s.magnetMul || 1), bpm, maxBpm: bpm,
      dmgMul: s.dmgMul || 1, rerolls: s.rerolls || 0, offerCount: s.offerCount || 3,
      perfectWindow: PERFECT_WINDOW + (s.perfectBonus || 0),
      score: 0, combo: 0, comboT: 0, maxCombo: 0, kills: 0, perfects: 0, hits: 0,
      wave: 0, drop: s.dropStart || 0, dropArmed: false, dropTarget: 0, dropBoostUntil: 0, drops: 0,
      bosses: 0, bossHitMark: 0, bossNoHit: false,
      startedAt: performance.now(), killNote: 0, damage: 0,
    };
    run.tracks = createTracks(s.kitTracks || null, run.musicRng);
    return run;
  }

  /** Statistiques de la partie (pour les succès et l'écran de fin). */
  runStats() {
    const run = this.run;
    const tracks = Object.values(run.tracks);
    return {
      score: run.score, wave: run.wave, kills: run.kills, perfects: run.perfects, maxCombo: run.maxCombo,
      drops: run.drops, bosses: run.bosses, bossNoHit: run.bossNoHit, bpm: run.maxBpm,
      tracksUnlocked: tracks.filter((t) => t.unlocked).length,
      fullTrack: tracks.some((t) => t.unlocked && t.steps.every(Boolean)),
      intensity: run.intensity, kit: run.kit, daily: !!run.daily, seed: run.seed,
      seconds: Math.round((performance.now() - run.startedAt) / 1000),
    };
  }

  /** Relance les offres (amélioration permanente « Remix »). */
  rerollOffers() {
    const run = this.run;
    if (this.mode !== 'upgrade' || run.rerolls <= 0) return null;
    run.rerolls--;
    return rollOffers(run, run.offerRng, run.offerCount);
  }

  setPaused(p) {
    if (this.mode !== 'playing' && this.mode !== 'upgrade') return;
    this.paused = p;
    if (p) this.audio.suspend(); else this.audio.resume();
  }

  // ───────────────────────────── musique ─────────────────────────────

  get comboMult() { return 1 + Math.min(this.run.combo, 100) / 20; }

  /** Planification audio d'un pas (appelé en avance par l'horloge). */
  /** Contexte musical courant pour l'arrangeur. */
  song() {
    return {
      tracks: this.run.tracks,
      harmony: this.sector,
      style: styleById(this.sector.style),
      boss: this.mode === 'playing' && this.bossAlive, // couche de tension pendant le boss
    };
  }

  /**
   * Mode Création : le moteur de jeu sert de lecteur en boucle. `provider()` renvoie le
   * contexte musical courant ({ tracks, harmony, style }) ou null quand la lecture est arrêtée.
   */
  startStudio(provider, bpm, swing) {
    this.mode = 'studio';
    this.paused = false;
    this.studio = provider;
    this.run = { studio: true, tracks: {} };
    this.resetWorld();
    this.player.alive = false;
    this.boss = null;
    this.bossAlive = false;
    this.wave = null;
    this.clock.bpm = bpm;
    this.clock.pendingBpm = null;
    this.clock.swing = swing;
    this.audio.setTempo(bpm);
    if (!this.clock.running) this.clock.start(0.1);
    this.audio.setMasterFilter(20000, 0.3);
  }

  _schedule(ev) {
    const run = this.run;
    if (!run) return;
    const a = this.audio;
    const t = ev.time;
    if (this.mode === 'studio') {
      const ctx = this.studio?.(ev);
      if (ctx) playEvents(a, generateStep(ctx, ev.bar, ev.step, { type: 'full' }), t, this.clock.stepDur, ctx.style);
      return;
    }
    const song = this.song();
    let events = generateStep(song, ev.bar, ev.step, { type: 'full' });
    if (this.mode === 'over') events = events.map((e) => ({ ...e, vel: e.vel * (e.inst === 'pad' ? 1.4 : 0.55) }));
    playEvents(a, events, t, this.clock.stepDur, song.style);

    if (run.dropArmed && ev.step === 0 && Math.abs(t - run.dropTarget) < 0.003) {
      a.dropImpact(t);
      ev.drop = true;
    }
  }


  /** Pas entendu : déclenche le gameplay. */
  _onStep(ev) {
    if (ev.step % 4 === 0) {
      this.beatCount++;
      this.beatPulse = 1;
    }
    const run = this.run;
    const active = this.mode === 'playing' || this.mode === 'attract';
    if (active && !this.paused) {
      for (const id of TRACK_ORDER) {
        const tr = run.tracks[id];
        if (!tr.unlocked) continue;
        if (tr.steps[ev.step]) this.fireTrack(tr, ev, 1);
        const prev = (ev.step + 15) % 16;
        if (tr.mods.echo && tr.steps[prev]) this.fireTrack(tr, { ...ev, step: prev }, 0.5);
      }
      if (this.mode === 'playing') {
        for (const e of this.enemies) if (!e.dead) enemyOnStep(e, this, ev);
        this._waveStep(ev);
        if (ev.drop) this._executeDrop();
      } else {
        this._attractStep(ev);
      }
    }
    this.hooks.onStep?.(ev);
  }

  // ───────────────────────────── armes ─────────────────────────────

  fireTrack(tr, ev, mult) {
    const p = this.player;
    const run = this.run;
    const boost = this.audio.now < run.dropBoostUntil ? 2 : 1;
    const dmgMul = tr.mods.dmg * mult * boost * (run.dmgMul || 1);
    const base = tr.def.base;
    const aim = p.aim;
    const col = this.color(tr.def.color);

    switch (tr.id) {
      case 'kick': {
        const n = 1 + tr.mods.multi;
        for (let i = 0; i < n; i++) {
          const a = aim + (i - (n - 1) / 2) * 0.14;
          this.shots.push({
            kind: 'bolt', x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
            vx: Math.cos(a) * base.speed, vy: Math.sin(a) * base.speed,
            r: base.radius * (mult < 1 ? 0.7 : 1), dmg: base.dmg * dmgMul, pierce: tr.mods.pierce,
            life: 1.1, color: col, hit: new Set(), knock: 160,
          });
        }
        this.kickPulse = 1;
        p.vx -= Math.cos(aim) * 40; p.vy -= Math.sin(aim) * 40;
        this.particles.burst(p.x + Math.cos(aim) * 20, p.y + Math.sin(aim) * 20, 5, col, { speed: 260, angle: aim, spread: 0.7, life: 0.25 });
        this.grid.impulse(p.x, p.y, 70, 140);
        break;
      }
      case 'hat': {
        const n = 1 + tr.mods.multi;
        for (let i = 0; i < n; i++) {
          const a = aim + (i - (n - 1) / 2) * 0.09 + (this.fxRng.next() - 0.5) * 0.06;
          this.shots.push({
            kind: 'needle', x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16,
            vx: Math.cos(a) * base.speed, vy: Math.sin(a) * base.speed,
            r: base.radius, dmg: base.dmg * dmgMul, pierce: tr.mods.pierce,
            life: 0.75, color: col, hit: new Set(), knock: 40,
          });
        }
        break;
      }
      case 'snare': {
        this.rings.push({
          x: p.x, y: p.y, r: 10, maxR: base.radius * tr.mods.size * (mult < 1 ? 0.75 : 1),
          t: 0, dur: 0.3, dmg: base.dmg * dmgMul, knock: base.knock, color: col, hit: new Set(),
        });
        this.grid.impulse(p.x, p.y, 260, base.radius * tr.mods.size * 1.2);
        break;
      }
      case 'bass': {
        this.beams.push({
          angle: aim, len: base.length * (0.85 + 0.15 * tr.mods.size) * (mult < 1 ? 0.7 : 1),
          width: base.width * tr.mods.size, t: 0, dur: Math.max(0.12, this.clock.stepDur * 1.7),
          dmg: base.dmg * dmgMul, color: col, hit: new Set(),
        });
        this.grid.impulse(p.x + Math.cos(aim) * 200, p.y + Math.sin(aim) * 200, -120, 260);
        break;
      }
      case 'lead': {
        const n = 1 + tr.mods.multi;
        for (let i = 0; i < n; i++) {
          const a = aim + Math.PI + (i - (n - 1) / 2) * 0.5 + (this.fxRng.next() - 0.5) * 0.8;
          this.shots.push({
            kind: 'missile', x: p.x, y: p.y, angle: a, speed: base.speed * 0.35, maxSpeed: base.speed,
            turn: base.turn, r: base.radius, dmg: base.dmg * dmgMul, pierce: tr.mods.pierce,
            life: 2.2, color: col, hit: new Set(), target: null, knock: 90, trail: [],
          });
        }
        break;
      }
    }
  }

  // ───────────────────────────── vagues ─────────────────────────────

  startWave(n) {
    const run = this.run;
    const prevSector = this.sector;
    run.wave = n;
    this.sector = sectorForWave(n);
    this.clock.swing = styleById(this.sector.style).swing;
    this.enemySpeedScale = Math.min(1.45, 1 + (n - 1) * 0.022) * run.mods.enemySpeed;
    this.wave = { plan: buildWave(n, run.waveRng, run.mods.budget), barIdx: 0, placed: false, clearAt: 0, cleared: false };
    this.bossAlive = false;
    // Journal du morceau : chaque vague devient une section du titre exportable
    run.songLog.push({
      wave: n, sectorId: this.sector.id, bpm: run.bpm, boss: this.wave.plan.boss, drops: 0,
      tracks: snapshotTracks(run.tracks),
    });
    if (this.sector !== prevSector && n > 1) {
      this.hooks.onBanner?.(`SECTEUR ${['I', 'II', 'III', 'IV'][this.sector.id - 1]} — ${this.sector.name.toUpperCase()}`, `${styleById(this.sector.style).name} · ${this.sector.key}`);
      this.flash = 0.8; this.flashColor = this.color('a');
    } else {
      this.hooks.onBanner?.(this.wave.plan.boss ? 'BOSS' : `VAGUE ${n}`, this.wave.plan.boss ? 'Le Métronome' : `${this.sector.name} · ${this.sector.key}`);
    }
  }

  _waveStep(ev) {
    const w = this.wave;
    if (!w || w.cleared) return;
    const plan = w.plan;
    if (w.barIdx >= plan.bars.length) return;

    // Le placement des marqueurs a lieu 2 temps avant l'apparition, au « 1 » suivant.
    if (ev.step === 8 && !w.placed) {
      const groups = plan.bars[w.barIdx];
      const scale = hpScale(plan.wave);
      const rng = this.run.spawnRng;
      if (plan.boss && w.barIdx === 0) {
        const bx = this.player.x < ARENA_W / 2 ? ARENA_W * 0.72 : ARENA_W * 0.28;
        this.markers.push({ type: 'boss', x: bx, y: ARENA_H / 2, t: 0, scale: hpScale(plan.wave) });
      }
      for (const g of groups) {
        for (const pos of formationPositions(g, this.player, ARENA_W, ARENA_H, rng)) {
          this.markers.push({ type: g.type, x: pos.x, y: pos.y, t: 0, scale });
        }
      }
      w.placed = true;
      if (this.markers.length) this.audio.spawn();
    }
    if (ev.step === 0 && w.placed) {
      for (const m of this.markers) this._spawnEnemy(m.type, m.x, m.y, m.scale);
      this.markers.length = 0;
      w.barIdx++;
      w.placed = false;
    }
  }

  _spawnEnemy(type, x, y, scale) {
    const run = this.run;
    const rng = run.spawnRng;
    const m = run.mods;
    const e = createEnemy(type, x, y, scale * m.enemyHp * (type === 'boss' ? m.bossHp : 1), () => rng.next());
    this.enemies.push(e);
    if (type === 'boss') {
      this.bossAlive = true;
      this.boss = e;
      run.bossHitMark = run.hits;
    }
    this.particles.ring(x, y, e.r * 3, this.color(e.def.color), 0.4);
    this.grid.impulse(x, y, -150, 120);
    return e;
  }

  /** Apparition immédiate (invocations du boss). */
  queueSpawn(type, x, y) {
    if (this.enemies.length > 160) return;
    this._spawnEnemy(type, clamp(x, 40, ARENA_W - 40), clamp(y, 40, ARENA_H - 40), hpScale(this.run.wave) * 0.8);
  }

  onBossPhase(e) {
    this.hooks.onBanner?.('PHASE II', 'Le tempo s\'emballe');
    this.flash = 0.6; this.flashColor = this.color('b');
    this.camera.shake = Math.max(this.camera.shake, 18);
    this.grid.impulse(e.x, e.y, 900, 600);
    this.particles.burst(e.x, e.y, 60, this.color('b'), { speed: 700, life: 1 });
  }

  _checkWaveClear() {
    const w = this.wave;
    if (!w) return;
    if (w.cleared) {
      // délai mesuré en temps de jeu : une pause le suspend proprement
      if (!w.offered && this.time - w.clearAt > 1.4) {
        w.offered = true;
        this.mode = 'upgrade';
        this.bullets.length = 0;
        this.hooks.onOffers?.(rollOffers(this.run, this.run.offerRng, this.run.offerCount));
      }
      return;
    }
    if (w.barIdx < w.plan.bars.length || this.markers.length || this.enemies.length) return;
    w.cleared = true;
    w.clearAt = this.time;
    this.run.score += 250 * this.run.wave;
    this.hooks.onBanner?.('VAGUE TERMINÉE', `+${250 * this.run.wave} pts`);
    this.hooks.onWaveClear?.(this.runStats());
    // collecte automatique des éclats restants
    for (const s of this.shards) s.magnet = true;
  }

  chooseOffer(offer) {
    const prevBpm = this.run.bpm;
    const place = applyOffer(this.run, offer);
    if (this.run.bpm !== prevBpm) {
      this.clock.setBpm(this.run.bpm);
      this.run.maxBpm = Math.max(this.run.maxBpm, this.run.bpm);
    }
    return place;
  }

  /** Place une note (mode placement). Joue un aperçu immédiat de l'instrument. */
  /** Place une note (et sa hauteur pour les pistes mélodiques), avec aperçu sonore immédiat. */
  placeStep(trackId, step, pitch = 0) {
    const tr = this.run.tracks[trackId];
    if (!tr || tr.steps[step]) return false;
    tr.steps[step] = true;
    tr.pitch[step] = pitch;
    this.previewStep(trackId, step, pitch);
    return true;
  }

  previewStep(trackId, step, pitch = 0) {
    previewNote(this.audio, this.song(), trackId, step, pitch, this.clock.bar, this.clock.stepDur, this.audio.now + 0.01);
  }

  nextWave() {
    if (this.mode !== 'upgrade') return;
    this.mode = 'playing';
    this.startWave(this.run.wave + 1);
  }

  // ───────────────────────────── DROP ─────────────────────────────

  tryDrop() {
    const run = this.run;
    if (this.mode !== 'playing' || run.drop < 1 || run.dropArmed) return;
    run.dropArmed = true;
    run.dropTarget = this.clock.nextBarTime(this.clock.beatDur * 0.9);
    const now = this.audio.now;
    this.audio.riser(now, run.dropTarget - now);
    this.audio.setMasterFilter(2200, (run.dropTarget - now) * 0.8);
    this.hooks.onBanner?.('DROP', 'sur le 1…', true);
  }

  _executeDrop() {
    const run = this.run;
    const p = this.player;
    run.dropArmed = false;
    run.drop = 0;
    run.drops++;
    if (run.songLog.length) run.songLog[run.songLog.length - 1].drops++;
    run.dropBoostUntil = this.audio.now + this.clock.barDur * 2;
    this.audio.setMasterFilter(20000, 0.05);
    this.flash = this.settings.reduceFlash ? 0.35 : 1;
    this.flashColor = '#ffffff';
    this.camera.shake = Math.max(this.camera.shake, 34);
    this.grid.impulse(p.x, p.y, 2200, 1600);
    for (let i = 0; i < 5; i++) this.particles.ring(p.x, p.y, 300 + i * 220, i % 2 ? this.color('a') : this.color('b'), 0.6 + i * 0.12);
    this.particles.burst(p.x, p.y, 120, this.color('c'), { speed: 1200, life: 1.1, size: 4 });
    const dmg = 140 * (1 + run.wave * 0.12);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = e.type === 'boss' ? e.maxHp * 0.12 : dmg;
      const dx = e.x - p.x, dy = e.y - p.y, dd = len(dx, dy) || 1;
      this.damageEnemy(e, d, dx / dd, dy / dd, 900, true);
    }
    // les projectiles ennemis se transforment en éclats
    for (const b of this.bullets) if (this.shards.length < 300 && Math.random() < 0.3) this._dropShard(b.x, b.y, 1);
    this.bullets.length = 0;
    this.hooks.onBanner?.('×2 DÉGÂTS', '2 mesures');
  }

  // ───────────────────────────── combat ─────────────────────────────

  damageEnemy(e, dmg, kx, ky, knock, noCrit = false) {
    if (e.dead) return;
    const run = this.run;
    let crit = false;
    if (!noCrit && this.fxRng.next() < run.crit) { dmg *= 2.5; crit = true; }
    e.hp -= dmg;
    e.flash = 1;
    run.damage += dmg;
    const kb = e.type === 'boss' ? 0 : e.type === 'colossus' ? 0.2 : 1;
    e.vx += kx * knock * kb;
    e.vy += ky * knock * kb;
    if (crit) {
      this.texts.push({ x: e.x, y: e.y - e.r, text: 'CRIT', t: 0, color: this.color('c') });
      this.particles.burst(e.x, e.y, 8, this.color('c'), { speed: 400, life: 0.35 });
    }
    if (this.mode === 'playing') this.audio.hit(pentaMidi(this.sector, (e.id % 5), 0));
    if (e.hp <= 0) this._killEnemy(e);
  }

  _killEnemy(e) {
    e.dead = true;
    const run = this.run;
    const col = this.color(e.def.color);
    const isBoss = e.type === 'boss';
    if (this.mode === 'playing') {
      run.kills++;
      run.combo++;
      run.comboT = 2.6;
      run.maxCombo = Math.max(run.maxCombo, run.combo);
      const pts = Math.round(e.def.score * this.comboMult);
      run.score += pts;
      if (e.def.score >= 120) this.texts.push({ x: e.x, y: e.y, text: `+${pts}`, t: 0, color: col });
      // chaque élimination du combo joue la note suivante de la pentatonique : les chaînes deviennent des mélodies
      this.audio.death(pentaMidi(this.sector, run.killNote++ % 12, 1), e.r > 25);
    }
    this.particles.burst(e.x, e.y, isBoss ? 200 : 10 + e.r, col, { speed: isBoss ? 1100 : 380, life: isBoss ? 1.6 : 0.7, size: 3 });
    this.particles.burst(e.x, e.y, 6, '#ffffff', { speed: 200, life: 0.3, kind: 0, size: 4 });
    this.particles.ring(e.x, e.y, e.r * 3.5, col, 0.35);
    this.grid.impulse(e.x, e.y, isBoss ? 1800 : 180 + e.r * 8, isBoss ? 1000 : 120 + e.r * 3);
    this.camera.shake = Math.max(this.camera.shake, isBoss ? 40 : e.r > 25 ? 8 : 2.5);

    if (this.mode === 'playing') this._dropShard(e.x, e.y, e.def.shards);
    if (e.type === 'splitter' || e.type === 'colossus') {
      const n = e.type === 'splitter' ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + e.angle;
        const m = createEnemy('mini', e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, hpScale(run.wave || 1) * (run.mods?.enemyHp || 1));
        m.vx = Math.cos(a) * 320; m.vy = Math.sin(a) * 320;
        this.enemies.push(m);
      }
    }
    if (isBoss) {
      if (this.mode === 'playing') {
        run.bosses++;
        if (run.hits === run.bossHitMark) run.bossNoHit = true;
      }
      this.bossAlive = false;
      this.boss = null;
      this.flash = this.settings.reduceFlash ? 0.4 : 1;
      this.flashColor = this.color('c');
      this.hooks.onBanner?.('MÉTRONOME DÉTRUIT', `+${Math.round(e.def.score * this.comboMult)} pts`);
      for (const o of this.enemies) if (!o.dead && o !== e) { o.hp = 0; this._killEnemy(o); }
      this.bullets.length = 0;
    }
  }

  _dropShard(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = this.fxRng.next() * TAU, s = 80 + this.fxRng.next() * 200;
      this.shards.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, magnet: false });
    }
  }

  enemyBullet(x, y, vx, vy, color, r = 5) {
    if (this.bullets.length > 600) return;
    const k = this.run?.mods?.bulletSpeed || 1;
    this.bullets.push({ x, y, vx: vx * k, vy: vy * k, r, life: 6, color });
  }

  _hurtPlayer() {
    const p = this.player, run = this.run;
    if (p.iframes > 0 || this.mode !== 'playing') return;
    run.hp--;
    run.hits++;
    run.combo = 0;
    run.killNote = 0;
    p.iframes = 1.3;
    this.audio.hurt();
    this.flash = this.settings.reduceFlash ? 0.25 : 0.6;
    this.flashColor = '#ff2045';
    this.camera.shake = Math.max(this.camera.shake, 22);
    this.grid.impulse(p.x, p.y, 1200, 500);
    this.particles.burst(p.x, p.y, 40, '#ff2045', { speed: 600, life: 0.8 });
    // grâce : efface les projectiles proches et repousse les ennemis
    this.bullets = this.bullets.filter((b) => dist2(b.x, b.y, p.x, p.y) > 180 * 180);
    for (const e of this.enemies) {
      const dx = e.x - p.x, dy = e.y - p.y, d = len(dx, dy) || 1;
      if (d < 220 && e.type !== 'boss') { e.vx += (dx / d) * 700; e.vy += (dy / d) * 700; }
    }
    if (run.hp <= 0) this._gameOver();
  }

  _gameOver() {
    const run = this.run;
    this.mode = 'over';
    this.player.alive = false;
    const p = this.player;
    this.particles.burst(p.x, p.y, 160, this.color('a'), { speed: 900, life: 1.5 });
    this.particles.burst(p.x, p.y, 80, '#ffffff', { speed: 500, life: 1, kind: 0 });
    this.grid.impulse(p.x, p.y, 2500, 1400);
    this.camera.shake = 40;
    this.audio.setMasterFilter(700, 1.5);
    run.dropArmed = false;
    this.hooks.onBanner?.('', '');
    const stats = { ...this.runStats(), tracks: run.tracks, sector: this.sector, damage: Math.round(run.damage), songLog: run.songLog };
    setTimeout(() => this.hooks.onGameOver?.(stats), 1600);
  }

  // ───────────────────────────── boucle ─────────────────────────────

  frame(dt) {
    // L'horloge tourne même en menu (musique) ; la simulation seulement hors pause.
    if (this.run && !this.paused) {
      this.clock.pump((ev) => this._schedule(ev));
      this.clock.drain((ev) => this._onStep(ev));
    }
    if (this.paused) return;

    const simulate = this.mode === 'playing' || this.mode === 'attract' || this.mode === 'over' || this.mode === 'upgrade' || this.mode === 'studio';
    if (!simulate) return;

    this.time += dt;
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.5);
    this.kickPulse = Math.max(0, this.kickPulse - dt * 6);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    for (const m of this.markers) m.t += dt;

    if (this.mode === 'playing') this._updatePlayer(dt);
    else if (this.mode === 'attract') this._updateAttractPlayer(dt);
    else { this.player.vx *= 0.9; this.player.vy *= 0.9; }

    this._updateEnemies(dt);
    this._updateShots(dt);
    this._updateRings(dt);
    this._updateBeams(dt);
    this._updateBullets(dt);
    this._updateShards(dt);
    for (const t of this.texts) t.t += dt;
    this.texts = this.texts.filter((t) => t.t < 0.9);
    this.particles.update(dt);
    this.grid.update(Math.min(dt, 1 / 30));

    if (this.mode === 'playing') {
      const run = this.run;
      if (run.combo > 0) {
        run.comboT -= dt;
        if (run.comboT <= 0) { run.combo = 0; run.killNote = 0; }
      }
      this._checkWaveClear();
    }
    this._updateCamera(dt);
  }

  _updatePlayer(dt) {
    const p = this.player, input = this.input, run = this.run;
    let mx = 0, my = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) my -= 1;
    if (input.down('KeyS') || input.down('ArrowDown')) my += 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) mx -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) mx += 1;
    const ml = len(mx, my);
    if (ml > 0) { mx /= ml; my /= ml; }

    // visée
    const w = this.screenToWorld(input.mouse.x, input.mouse.y);
    p.aim = Math.atan2(w.y - p.y, w.x - p.x);

    p.dashCdT = Math.max(0, p.dashCdT - dt);
    p.iframes = Math.max(0, p.iframes - dt);
    p.perfectT = Math.max(0, p.perfectT - dt);

    if ((input.pressed('Space') || input.pressed('ShiftLeft') || input.pressed('ShiftRight')) && p.dashCdT <= 0) {
      const perfect = this.clock.offBeat() <= run.perfectWindow;
      const dx = ml > 0 ? mx : Math.cos(p.aim), dy = ml > 0 ? my : Math.sin(p.aim);
      p.dashT = 0.16; p.dashDx = dx; p.dashDy = dy; p.dashId++;
      p.dashCdT = run.dashCd * (perfect ? 0.5 : 1);
      p.iframes = Math.max(p.iframes, perfect ? 0.5 : 0.22);
      this.audio.dash(perfect);
      this.grid.impulse(p.x, p.y, perfect ? 500 : 200, perfect ? 260 : 150);
      if (perfect) {
        p.perfectT = 0.3;
        run.perfects++;
        run.combo += 5;
        run.comboT = 2.6;
        run.maxCombo = Math.max(run.maxCombo, run.combo);
        run.drop = Math.min(1, run.drop + 0.04 * run.dropGain);
        this.texts.push({ x: p.x, y: p.y - 30, text: 'PARFAIT', t: 0, color: this.color('c') });
        this.particles.ring(p.x, p.y, 120, this.color('c'), 0.4);
      }
    }
    if (input.pressed('KeyE') || input.mousePressed(2)) this.tryDrop();

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDx * 1250; p.vy = p.dashDy * 1250;
      p.trail.push({ x: p.x, y: p.y, t: 0, perfect: p.perfectT > 0 });
      if (p.perfectT > 0) {
        // traînée offensive du dash parfait
        this.spatial.query(p.x, p.y, 60, (e) => {
          if (e.dead || e._dashHit === p.dashId) return;
          if (dist2(e.x, e.y, p.x, p.y) < (e.r + 34) ** 2) {
            e._dashHit = p.dashId;
            this.damageEnemy(e, 22 * (1 + run.wave * 0.08), p.dashDx, p.dashDy, 300);
          }
        });
      }
    } else {
      const speed = 340;
      p.vx = damp(p.vx, mx * speed, 14, dt);
      p.vy = damp(p.vy, my * speed, 14, dt);
    }
    for (const t of p.trail) t.t += dt;
    p.trail = p.trail.filter((t) => t.t < 0.3);

    p.x = clamp(p.x + p.vx * dt, p.r, ARENA_W - p.r);
    p.y = clamp(p.y + p.vy * dt, p.r, ARENA_H - p.r);
  }

  _updateAttractPlayer(dt) {
    const p = this.player;
    const t = this.time * 0.35;
    const tx = ARENA_W / 2 + Math.cos(t) * 360, ty = ARENA_H / 2 + Math.sin(t * 2) * 180;
    p.vx = damp(p.vx, (tx - p.x) * 2, 3, dt);
    p.vy = damp(p.vy, (ty - p.y) * 2, 3, dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    // vise l'ennemi le plus proche, sinon tourne doucement
    let best = null, bd = Infinity;
    for (const e of this.enemies) { const d = dist2(e.x, e.y, p.x, p.y); if (d < bd) { bd = d; best = e; } }
    const desired = best ? Math.atan2(best.y - p.y, best.x - p.x) : this.time * 0.8;
    p.aim += angleDiff(p.aim, desired) * Math.min(1, dt * 8);
  }

  _attractStep(ev) {
    if (ev.step === 0 && this.enemies.length < 14) {
      const rng = this.fxRng;
      const types = ['drone', 'drone', 'dart', 'splitter', 'sentinel'];
      for (let i = 0; i < 3; i++) {
        const a = rng.next() * TAU;
        const e = createEnemy(rng.pick(types), ARENA_W / 2 + Math.cos(a) * 700, ARENA_H / 2 + Math.sin(a) * 450, 1.2);
        this.enemies.push(e);
      }
    }
    for (const e of this.enemies) if (!e.dead && e.type === 'dart') enemyOnStep(e, this, ev);
  }

  _updateEnemies(dt) {
    const sp = this.spatial;
    sp.clear();
    for (const e of this.enemies) sp.insert(e);
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      updateEnemy(e, this, dt);
      // séparation douce
      sp.query(e.x, e.y, e.r * 2, (o) => {
        if (o === e || o.dead) return;
        const dx = e.x - o.x, dy = e.y - o.y;
        const min = e.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2), push = (min - d) * 0.5;
          const w = e.type === 'boss' ? 0 : o.type === 'boss' ? 1 : 0.5;
          e.x += (dx / d) * push * w * 2; e.y += (dy / d) * push * w * 2;
        }
      });
      // contact joueur
      if (this.mode === 'playing' && p.iframes <= 0 && dist2(e.x, e.y, p.x, p.y) < (e.r + p.r * 0.7) ** 2) {
        this._hurtPlayer();
      }
    }
    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
  }

  _collideShot(s) {
    let alive = true;
    this.spatial.query(s.x, s.y, s.r + 60, (e) => {
      if (e.dead || s.hit.has(e.id)) return;
      if (dist2(e.x, e.y, s.x, s.y) < (e.r + s.r) ** 2) {
        s.hit.add(e.id);
        let kx, ky;
        if (s.kind === 'missile') { kx = Math.cos(s.angle); ky = Math.sin(s.angle); }
        else { const sp = len(s.vx, s.vy) || 1; kx = s.vx / sp; ky = s.vy / sp; }
        this.damageEnemy(e, s.dmg, kx, ky, s.knock);
        this.particles.burst(s.x, s.y, 4, s.color, { speed: 260, life: 0.25, angle: Math.atan2(-ky, -kx), spread: 1.6 });
        if (s.pierce-- <= 0) { alive = false; return false; }
      }
    });
    return alive;
  }

  _updateShots(dt) {
    const out = [];
    for (const s of this.shots) {
      s.life -= dt;
      if (s.kind === 'missile') {
        if (!s.target || s.target.dead) s.target = this._nearestEnemy(s.x, s.y, 900);
        s.speed = Math.min(s.maxSpeed, s.speed + s.maxSpeed * 2.5 * dt);
        if (s.target) {
          const desired = Math.atan2(s.target.y - s.y, s.target.x - s.x);
          s.angle += clamp(angleDiff(s.angle, desired), -s.turn * dt, s.turn * dt);
        }
        s.x += Math.cos(s.angle) * s.speed * dt;
        s.y += Math.sin(s.angle) * s.speed * dt;
        s.trail.push(s.x, s.y);
        if (s.trail.length > 16) s.trail.splice(0, 2);
      } else {
        s.x += s.vx * dt; s.y += s.vy * dt;
      }
      if (s.x < 0 || s.y < 0 || s.x > ARENA_W || s.y > ARENA_H) {
        this.particles.burst(clamp(s.x, 0, ARENA_W), clamp(s.y, 0, ARENA_H), 3, s.color, { speed: 150, life: 0.2 });
        continue;
      }
      if (s.life <= 0) continue;
      if (!this._collideShot(s)) continue;
      out.push(s);
    }
    this.shots = out;
  }

  _nearestEnemy(x, y, maxD) {
    let best = null, bd = maxD * maxD;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist2(e.x, e.y, x, y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  _updateRings(dt) {
    const p = this.player;
    for (const r of this.rings) {
      r.t += dt;
      r.x = p.x; r.y = p.y;
      const k = Math.min(1, r.t / r.dur);
      r.r = 10 + (r.maxR - 10) * (1 - Math.pow(1 - k, 3));
      this.spatial.query(r.x, r.y, r.r + 60, (e) => {
        if (e.dead || r.hit.has(e.id)) return;
        const d = Math.sqrt(dist2(e.x, e.y, r.x, r.y));
        if (d < r.r + e.r) {
          r.hit.add(e.id);
          const dd = d || 1;
          this.damageEnemy(e, r.dmg, (e.x - r.x) / dd, (e.y - r.y) / dd, r.knock);
        }
      });
      // (l'onde ne détruit PAS les projectiles ennemis : sinon rester à distance rendait invincible)
    }
    this.rings = this.rings.filter((r) => r.t < r.dur + 0.15);
  }

  _updateBeams(dt) {
    const p = this.player;
    for (const b of this.beams) {
      b.t += dt;
      b.angle = p.aim; // le rayon suit la visée pendant toute la note
      const x1 = p.x + Math.cos(b.angle) * b.len, y1 = p.y + Math.sin(b.angle) * b.len;
      b.x0 = p.x; b.y0 = p.y; b.x1 = x1; b.y1 = y1;
      for (const e of this.enemies) {
        if (e.dead || b.hit.has(e.id)) continue;
        if (pointSegDist2(e.x, e.y, p.x, p.y, x1, y1) < (e.r + b.width) ** 2) {
          b.hit.add(e.id);
          this.damageEnemy(e, b.dmg, Math.cos(b.angle), Math.sin(b.angle), 120);
          this.particles.burst(e.x, e.y, 6, b.color, { speed: 300, life: 0.3 });
        }
      }
    }
    this.beams = this.beams.filter((b) => b.t < b.dur);
  }

  _updateBullets(dt) {
    const p = this.player;
    const out = [];
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.life -= dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.life <= 0 || b.x < -20 || b.y < -20 || b.x > ARENA_W + 20 || b.y > ARENA_H + 20) continue;
      if (this.mode === 'playing' && p.iframes <= 0 && dist2(b.x, b.y, p.x, p.y) < (b.r + p.r * 0.55) ** 2) {
        this._hurtPlayer();
        continue;
      }
      out.push(b);
    }
    this.bullets = out;
  }

  _updateShards(dt) {
    const p = this.player, run = this.run;
    const out = [];
    const mag = run ? run.magnet : 150;
    for (const s of this.shards) {
      s.t += dt;
      const dx = p.x - s.x, dy = p.y - s.y;
      const d = len(dx, dy) || 1;
      if ((s.magnet || d < mag) && this.mode === 'playing') {
        const pull = 1800 * (1 - Math.min(1, d / (mag * 2))) + 400;
        s.vx += (dx / d) * pull * dt;
        s.vy += (dy / d) * pull * dt;
      }
      const f = Math.exp(-2.5 * dt);
      s.vx *= f; s.vy *= f;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (this.mode === 'playing' && d < p.r + 12) {
        run.drop = Math.min(1, run.drop + 0.03 * run.dropGain);
        run.score += 10;
        this.audio.pickup(pentaMidi(this.sector, Math.floor(run.drop * 10), 1));
        continue;
      }
      if (s.t > 14) continue;
      out.push(s);
    }
    this.shards = out;
  }

  // ───────────────────────────── caméra ─────────────────────────────

  _updateCamera(dt) {
    const c = this.camera, p = this.player;
    const vw = this.viewW / c.zoom, vh = this.viewH / c.zoom;
    // anticipe légèrement vers la visée
    let tx = p.x + Math.cos(p.aim) * 60, ty = p.y + Math.sin(p.aim) * 60;
    tx = vw >= ARENA_W ? ARENA_W / 2 : clamp(tx, vw / 2 - 80, ARENA_W - vw / 2 + 80);
    ty = vh >= ARENA_H ? ARENA_H / 2 : clamp(ty, vh / 2 - 80, ARENA_H - vh / 2 + 80);
    c.x = damp(c.x, tx, 6, dt);
    c.y = damp(c.y, ty, 6, dt);
    const shakeAmt = this.settings.shake ? c.shake : 0;
    c.sx = (Math.random() - 0.5) * shakeAmt;
    c.sy = (Math.random() - 0.5) * shakeAmt;
    c.shake = Math.max(0, c.shake - dt * 60);
  }

  setViewport(w, h) {
    this.viewW = w;
    this.viewH = h;
    // zoom adaptatif : on voit toujours ~1500 px de large au minimum
    this.camera.zoom = clamp(Math.min(w / 1500, h / 900), 0.55, 1.4);
  }

  screenToWorld(sx, sy) {
    const c = this.camera;
    return { x: (sx - this.viewW / 2) / c.zoom + c.x, y: (sy - this.viewH / 2) / c.zoom + c.y };
  }
}

export { hashString, ENEMY_DEFS };
