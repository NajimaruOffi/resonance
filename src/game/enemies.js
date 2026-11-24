// Ennemis : chaque type agit en continu (update) ET sur la musique (onStep).
// Les comportements dangereux sont toujours télégraphiés au moins un temps à l'avance.

import { TAU, clamp, len, angleDiff } from '../util/math.js';

export const ENEMY_DEFS = {
  drone: {
    name: 'Drone', hp: 14, r: 14, speed: 115, score: 50, shards: 1, cost: 1, sides: 3, color: 'b',
  },
  dart: {
    name: 'Fléchette', hp: 12, r: 13, speed: 40, score: 80, shards: 1, cost: 2, sides: 0, color: 'c',
  },
  splitter: {
    name: 'Diviseur', hp: 30, r: 20, speed: 80, score: 120, shards: 2, cost: 3, sides: 6, color: 'd',
  },
  mini: {
    name: 'Fragment', hp: 6, r: 9, speed: 175, score: 20, shards: 0, cost: 0, sides: 3, color: 'd',
  },
  sentinel: {
    name: 'Sentinelle', hp: 40, r: 19, speed: 70, score: 160, shards: 3, cost: 4, sides: 4, color: 'a',
  },
  colossus: {
    name: 'Colosse', hp: 140, r: 32, speed: 52, score: 400, shards: 6, cost: 7, sides: 8, color: 'b',
  },
  boss: {
    name: 'Le Métronome', hp: 1150, r: 58, speed: 0, score: 5000, shards: 30, cost: 0, sides: 5, color: 'c',
  },
};

let nextId = 1;

export function createEnemy(type, x, y, hpScale = 1, rng = Math.random) {
  const def = ENEMY_DEFS[type];
  const hp = def.hp * hpScale;
  return {
    id: nextId++, type, def, x, y, vx: 0, vy: 0, r: def.r,
    hp, maxHp: hp, angle: rng() * TAU, spin: (rng() - 0.5) * 2,
    flash: 0, telegraph: 0, phase: Math.floor(rng() * 2),
    seed: rng() * 1000, dead: false, spawnT: 0,
    target: null, aim: 0, boss: type === 'boss' ? { phase: 1, swing: 0, spiral: 0 } : null,
  };
}

function seek(e, px, py, speed, dt, k = 4) {
  const dx = px - e.x, dy = py - e.y;
  const d = len(dx, dy) || 1;
  const tx = (dx / d) * speed, ty = (dy / d) * speed;
  const f = 1 - Math.exp(-k * dt);
  e.vx += (tx - e.vx) * f;
  e.vy += (ty - e.vy) * f;
}

export function updateEnemy(e, g, dt) {
  const p = g.player;
  e.spawnT = Math.min(1, e.spawnT + dt * 4);
  e.flash = Math.max(0, e.flash - dt * 6);
  e.telegraph = Math.max(0, e.telegraph - dt * 1.2);
  const speed = e.def.speed * g.enemySpeedScale;

  switch (e.type) {
    case 'drone': {
      seek(e, p.x + Math.sin(g.time * 1.3 + e.seed) * 60, p.y + Math.cos(g.time * 1.1 + e.seed) * 60, speed, dt, 3);
      e.angle = Math.atan2(e.vy, e.vx);
      break;
    }
    case 'mini': {
      seek(e, p.x, p.y, speed, dt, 5);
      e.angle += dt * 8;
      break;
    }
    case 'dart': {
      // dérive lente entre deux bonds ; frottement fort après le bond
      const f = Math.exp(-3.2 * dt);
      e.vx *= f; e.vy *= f;
      const desired = Math.atan2(p.y - e.y, p.x - e.x);
      e.angle += angleDiff(e.angle, desired) * Math.min(1, dt * 6);
      e.vx += Math.cos(desired) * speed * dt * 3;
      e.vy += Math.sin(desired) * speed * dt * 3;
      break;
    }
    case 'splitter': {
      seek(e, p.x, p.y, speed, dt, 2);
      e.angle += dt * 0.8;
      break;
    }
    case 'sentinel': {
      // se place à distance moyenne du joueur et tourne autour
      if (!e.target || len(e.target.x - e.x, e.target.y - e.y) < 30) {
        const a = Math.random() * TAU, r = 300 + Math.random() * 200;
        e.target = { x: clamp(p.x + Math.cos(a) * r, 60, g.W - 60), y: clamp(p.y + Math.sin(a) * r, 60, g.H - 60) };
      }
      seek(e, e.target.x, e.target.y, speed, dt, 1.5);
      e.angle += dt * (0.6 + e.telegraph * 6);
      break;
    }
    case 'colossus': {
      seek(e, p.x, p.y, speed, dt, 1);
      e.angle += dt * 0.3;
      break;
    }
    case 'boss':
      updateBoss(e, g, dt);
      break;
  }

  e.x += e.vx * dt;
  e.y += e.vy * dt;
  // les murs de l'arène repoussent
  const m = e.r;
  if (e.x < m) { e.x = m; e.vx = Math.abs(e.vx); }
  if (e.x > g.W - m) { e.x = g.W - m; e.vx = -Math.abs(e.vx); }
  if (e.y < m) { e.y = m; e.vy = Math.abs(e.vy); }
  if (e.y > g.H - m) { e.y = g.H - m; e.vy = -Math.abs(e.vy); }
}

/** Réaction des ennemis au pas musical entendu. */
export function enemyOnStep(e, g, ev) {
  const p = g.player;
  const s = ev.step;
  switch (e.type) {
    case 'dart': {
      const beat = s >> 2;
      if (s % 4 === 3 && (beat + 1) % 2 === e.phase) e.telegraph = 1; // le bond arrive au temps suivant
      if (s % 4 === 0 && beat % 2 === e.phase) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        const v = 640 * g.enemySpeedScale;
        e.vx = Math.cos(a) * v; e.vy = Math.sin(a) * v;
        e.angle = a;
        g.particles.burst(e.x, e.y, 6, g.color(e.def.color), { speed: 200, angle: a + Math.PI, spread: 0.8, life: 0.3 });
      }
      break;
    }
    case 'sentinel': {
      if (ev.bar % 2 !== e.phase) break;
      if (s === 12) e.telegraph = 1;
      if (s === 0) {
        const n = 10, off = e.angle;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU;
          g.enemyBullet(e.x, e.y, Math.cos(a) * 210, Math.sin(a) * 210, g.color('a'));
        }
        g.audio.enemyShot();
        g.particles.ring(e.x, e.y, 60, g.color('a'), 0.35);
      }
      break;
    }
    case 'colossus': {
      if (s === 8 && ev.bar % 2 === e.phase) e.telegraph = 1;
      if (s === 0 && ev.bar % 2 === (e.phase + 1) % 2) {
        const a0 = Math.atan2(p.y - e.y, p.x - e.x);
        for (let i = -2; i <= 2; i++) {
          const a = a0 + i * 0.16;
          g.enemyBullet(e.x, e.y, Math.cos(a) * 260, Math.sin(a) * 260, g.color('b'), 7);
        }
        g.audio.enemyShot();
      }
      break;
    }
    case 'boss':
      bossOnStep(e, g, ev);
      break;
  }
}

// ─────────────────────────────── Boss : Le Métronome ───────────────────────────────

function updateBoss(e, g, dt) {
  const b = e.boss;
  // trajectoire de Lissajous autour du centre de l'arène
  const cx = g.W / 2, cy = g.H / 2;
  const t = g.time * (b.phase === 2 ? 0.32 : 0.22);
  const tx = cx + Math.sin(t * 1.0 + e.seed) * g.W * 0.28;
  const ty = cy + Math.sin(t * 1.7) * g.H * 0.22;
  e.vx = (tx - e.x) * 1.2;
  e.vy = (ty - e.y) * 1.2;
  // le balancier atteint une extrémité exactement sur chaque temps (une demi-période par temps)
  const phase = g.clock.beatPhase();
  b.swing = Math.cos(((g.beatCount % 2) + phase) * Math.PI);
  e.angle += dt * (b.phase === 2 ? 0.9 : 0.4);
  if (b.phase === 1 && e.hp < e.maxHp * 0.5) {
    b.phase = 2;
    g.onBossPhase(e);
  }
}

function bossOnStep(e, g, ev) {
  const b = e.boss;
  const s = ev.step;
  const p = g.player;
  // Sur chaque temps : anneau rotatif (spirale lente)
  if (s % 4 === 0) {
    const n = b.phase === 2 ? 12 : 9;
    b.spiral += 0.21;
    const spd = b.phase === 2 ? 240 : 200;
    for (let i = 0; i < n; i++) {
      const a = b.spiral + (i / n) * TAU;
      g.enemyBullet(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, Math.cos(a) * spd, Math.sin(a) * spd, g.color('c'));
    }
    g.audio.enemyShot();
  }
  // Phase 2 : salves visées en contretemps
  if (b.phase === 2 && (s === 6 || s === 14)) {
    const a0 = Math.atan2(p.y - e.y, p.x - e.x);
    for (let i = -1; i <= 1; i++) {
      const a = a0 + i * 0.12;
      g.enemyBullet(e.x, e.y, Math.cos(a) * 380, Math.sin(a) * 380, g.color('b'), 6);
    }
  }
  // Invocation de drones toutes les 2 mesures
  if (s === 0 && ev.bar % 2 === 0) {
    const n = b.phase === 2 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + e.angle;
      g.queueSpawn(b.phase === 2 && i % 2 ? 'dart' : 'drone', e.x + Math.cos(a) * 110, e.y + Math.sin(a) * 110);
    }
  }
  if (s === 12) e.telegraph = 1;
}
