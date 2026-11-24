// Rendu Canvas 2D : composition additive, sprites de halo pré-calculés et passe de bloom
// en basse résolution. Aucune dépendance.

import { TAU, rgba, clamp } from '../util/math.js';
import { ARENA_W, ARENA_H } from '../game/game.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.bloom = document.createElement('canvas');
    this.bctx = this.bloom.getContext('2d');
    this.hasFilter = 'filter' in this.bctx;
    this.glowCache = new Map();
    this.dpr = 1;
    this.bloomEnabled = true;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // fenêtre de taille nulle (onglet caché, panneau replié) : on garde au moins 1 px
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.w = w; this.h = h;
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.bloom.width = Math.max(1, Math.floor(w / 4));
    this.bloom.height = Math.max(1, Math.floor(h / 4));
  }

  glow(color) {
    let c = this.glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(color, 0.9));
    grad.addColorStop(0.25, rgba(color, 0.35));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glowCache.set(color, c);
    return c;
  }

  drawGlow(ctx, color, x, y, size, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.glow(color), x - size, y - size, size * 2, size * 2);
    ctx.globalAlpha = 1;
  }

  poly(ctx, x, y, r, sides, angle) {
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = angle + (i / sides) * TAU;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  render(game, mouse, spectrum, showCursor) {
    const ctx = this.ctx;
    const pal = game.sector.palette;
    const cam = game.camera;
    const z = cam.zoom;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    // caméra
    ctx.translate(this.w / 2 + cam.sx, this.h / 2 + cam.sy);
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    const view = {
      x0: cam.x - this.w / 2 / z, x1: cam.x + this.w / 2 / z,
      y0: cam.y - this.h / 2 / z, y1: cam.y + this.h / 2 / z,
    };

    game.grid.draw(ctx, pal.grid, pal.a, game.beatPulse, view);

    ctx.globalCompositeOperation = 'lighter';
    this._arena(ctx, game, pal, spectrum);
    this._markers(ctx, game, pal);
    this._shards(ctx, game, pal);
    this._rings(ctx, game);
    this._beams(ctx, game);
    this._enemies(ctx, game, pal);
    this._bullets(ctx, game);
    this._shots(ctx, game);
    if (game.player.alive && game.mode !== 'idle') this._player(ctx, game, pal);
    game.particles.draw(ctx);
    this._texts(ctx, game);

    // ── espace écran ──
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bloomEnabled) this._bloomPass();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const run = game.run;
    if (run && game.audio.now < run.dropBoostUntil && game.mode === 'playing') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(pal.b, 0.06 + game.beatPulse * 0.06);
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (game.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(game.flashColor, clamp(game.flash, 0, 1) * 0.55);
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (showCursor) this._cursor(ctx, mouse, game, pal);
  }

  _bloomPass() {
    const ctx = this.ctx, b = this.bctx;
    if (this.canvas.width < 1 || this.canvas.height < 1 || this.bloom.width < 1 || this.bloom.height < 1) return;
    b.globalCompositeOperation = 'source-over';
    b.filter = this.hasFilter ? 'blur(3px) brightness(1.1)' : 'none';
    b.clearRect(0, 0, this.bloom.width, this.bloom.height);
    b.drawImage(this.canvas, 0, 0, this.bloom.width, this.bloom.height);
    b.filter = 'none';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bloom, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _arena(ctx, game, pal, spectrum) {
    const pulse = game.beatPulse;
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(pal.a, 0.5 + pulse * 0.4);
    ctx.strokeRect(0, 0, ARENA_W, ARENA_H);
    ctx.lineWidth = 12;
    ctx.strokeStyle = rgba(pal.a, 0.06 + pulse * 0.08);
    ctx.strokeRect(-6, -6, ARENA_W + 12, ARENA_H + 12);

    // spectre audio réel, déployé vers l'extérieur sur les quatre bords
    if (!spectrum) return;
    const bins = 48;
    ctx.fillStyle = rgba(pal.b, 0.5);
    for (let side = 0; side < 4; side++) {
      const horizontal = side % 2 === 0;
      const L = horizontal ? ARENA_W : ARENA_H;
      const bw = L / bins;
      for (let i = 0; i < bins; i++) {
        // miroir : les basses au centre de chaque bord
        const k = Math.abs(i - bins / 2) / (bins / 2);
        const v = spectrum[Math.floor(k * 90) + 2] / 255;
        const hgt = v * v * 140 + 2;
        const pos = i * bw + 2;
        if (side === 0) ctx.fillRect(pos, -12 - hgt, bw - 4, hgt);
        else if (side === 2) ctx.fillRect(pos, ARENA_H + 12, bw - 4, hgt);
        else if (side === 1) ctx.fillRect(ARENA_W + 12, pos, hgt, bw - 4);
        else ctx.fillRect(-12 - hgt, pos, hgt, bw - 4);
      }
    }
  }

  _markers(ctx, game, pal) {
    for (const m of game.markers) {
      const color = m.type === 'boss' ? pal.c : pal.b;
      const k = clamp(m.t / (game.clock.beatDur * 2), 0, 1);
      const r = m.type === 'boss' ? 80 : 26;
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(color, 0.25 + k * 0.6);
      ctx.beginPath(); ctx.arc(m.x, m.y, r * (2.2 - k * 1.2), 0, TAU); ctx.stroke();
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = rgba(color, 0.4);
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      this.drawGlow(ctx, color, m.x, m.y, r * 1.5, 0.3 + game.beatPulse * 0.4);
      ctx.strokeStyle = rgba(color, 0.7);
      ctx.beginPath();
      ctx.moveTo(m.x - 8, m.y); ctx.lineTo(m.x + 8, m.y);
      ctx.moveTo(m.x, m.y - 8); ctx.lineTo(m.x, m.y + 8);
      ctx.stroke();
    }
  }

  _shards(ctx, game, pal) {
    ctx.fillStyle = pal.c;
    for (const s of game.shards) {
      const r = 4 + Math.sin(s.t * 8) * 1;
      this.drawGlow(ctx, pal.c, s.x, s.y, 14, 0.6);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y); ctx.lineTo(s.x, s.y + r); ctx.lineTo(s.x - r, s.y);
      ctx.closePath(); ctx.fill();
    }
  }

  _rings(ctx, game) {
    for (const r of game.rings) {
      const k = 1 - clamp(r.t / (r.dur + 0.15), 0, 1);
      ctx.strokeStyle = rgba(r.color, k * 0.9);
      ctx.lineWidth = 10 * k + 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', k * 0.8);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
    }
  }

  _beams(ctx, game) {
    ctx.lineCap = 'round';
    for (const b of game.beams) {
      if (b.x0 === undefined) continue;
      const k = 1 - b.t / b.dur;
      const wob = 1 + Math.sin(b.t * 90) * 0.15;
      ctx.strokeStyle = rgba(b.color, 0.25 * k);
      ctx.lineWidth = b.width * 3.2 * wob;
      ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
      ctx.strokeStyle = rgba(b.color, 0.8 * k);
      ctx.lineWidth = b.width * wob;
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.9 * k);
      ctx.lineWidth = b.width * 0.3;
      ctx.stroke();
    }
  }

  _enemies(ctx, game, pal) {
    for (const e of game.enemies) {
      const color = pal[e.def.color];
      const s = 0.4 + 0.6 * e.spawnT;
      const r = e.r * s * (1 + game.beatPulse * 0.08);
      this.drawGlow(ctx, color, e.x, e.y, r * 2.8, 0.55 + e.flash * 0.45);

      if (e.telegraph > 0) {
        ctx.strokeStyle = rgba(e.type === 'dart' ? pal.c : '#ffffff', e.telegraph * 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, r * (1.5 + (1 - e.telegraph) * 0.8), 0, TAU); ctx.stroke();
      }

      if (e.type === 'boss') { this._boss(ctx, game, e, r, pal); continue; }

      const stroke = e.flash > 0.5 ? '#ffffff' : color;
      ctx.lineWidth = e.type === 'colossus' ? 4 : 2.5;
      ctx.strokeStyle = stroke;
      ctx.fillStyle = rgba(color, 0.12 + e.flash * 0.4);
      if (e.type === 'dart') {
        const a = e.angle;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * r * 1.4, e.y + Math.sin(a) * r * 1.4);
        ctx.lineTo(e.x + Math.cos(a + 2.5) * r, e.y + Math.sin(a + 2.5) * r);
        ctx.lineTo(e.x + Math.cos(a + Math.PI) * r * 0.4, e.y + Math.sin(a + Math.PI) * r * 0.4);
        ctx.lineTo(e.x + Math.cos(a - 2.5) * r, e.y + Math.sin(a - 2.5) * r);
        ctx.closePath();
      } else {
        this.poly(ctx, e.x, e.y, r, e.def.sides, e.angle);
      }
      ctx.fill(); ctx.stroke();

      if (e.type === 'sentinel') {
        // œil central qui se charge avant le tir
        this.drawGlow(ctx, '#ffffff', e.x, e.y, 6 + e.telegraph * 14, 0.6 + e.telegraph * 0.4);
      } else if (e.type === 'colossus' || e.type === 'splitter') {
        ctx.lineWidth = 1.5;
        this.poly(ctx, e.x, e.y, r * 0.55, e.def.sides, -e.angle * 1.5);
        ctx.stroke();
      }
      if (e.maxHp > 60 && e.hp < e.maxHp) {
        const w = e.r * 2;
        ctx.fillStyle = rgba(color, 0.25);
        ctx.fillRect(e.x - w / 2, e.y + e.r + 8, w, 3);
        ctx.fillStyle = color;
        ctx.fillRect(e.x - w / 2, e.y + e.r + 8, w * (e.hp / e.maxHp), 3);
      }
    }
  }

  _boss(ctx, game, e, r, pal) {
    const b = e.boss;
    const col = e.flash > 0.5 ? '#ffffff' : pal.c;
    const col2 = b.phase === 2 ? pal.b : pal.a;
    // corps : double pentagone contrarotatif
    ctx.lineWidth = 4;
    ctx.strokeStyle = col;
    ctx.fillStyle = rgba(pal.c, 0.08 + e.flash * 0.3);
    this.poly(ctx, e.x, e.y, r, 5, e.angle);
    ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = col2;
    this.poly(ctx, e.x, e.y, r * 0.7, 5, -e.angle * 1.3 + Math.PI);
    ctx.stroke();
    // balancier du métronome : extrémité atteinte exactement sur chaque temps
    const swingA = -Math.PI / 2 + b.swing * 0.75;
    const L = r * 2.1;
    const bx = e.x + Math.cos(swingA) * L, by = e.y + Math.sin(swingA) * L;
    ctx.strokeStyle = col2;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(bx, by); ctx.stroke();
    this.drawGlow(ctx, col2, bx, by, 34, 0.9);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(bx, by, 9, 0, TAU); ctx.fill();
    // graduations
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(col2, 0.5);
    for (let i = -3; i <= 3; i++) {
      const a = -Math.PI / 2 + i * 0.25;
      ctx.beginPath();
      ctx.moveTo(e.x + Math.cos(a) * L * 1.12, e.y + Math.sin(a) * L * 1.12);
      ctx.lineTo(e.x + Math.cos(a) * L * 1.22, e.y + Math.sin(a) * L * 1.22);
      ctx.stroke();
    }
    this.drawGlow(ctx, '#ffffff', e.x, e.y, 20 + game.beatPulse * 20, 0.8);
  }

  _bullets(ctx, game) {
    for (const b of game.bullets) {
      this.drawGlow(ctx, b.color, b.x, b.y, b.r * 4, 0.8);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.7, 0, TAU); ctx.fill();
    }
  }

  _shots(ctx, game) {
    ctx.lineCap = 'round';
    for (const s of game.shots) {
      if (s.kind === 'missile') {
        ctx.strokeStyle = rgba(s.color, 0.6);
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < s.trail.length; i += 2) {
          if (i === 0) ctx.moveTo(s.trail[i], s.trail[i + 1]); else ctx.lineTo(s.trail[i], s.trail[i + 1]);
        }
        ctx.stroke();
        this.drawGlow(ctx, s.color, s.x, s.y, 16, 0.9);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU); ctx.fill();
        continue;
      }
      const tail = s.kind === 'bolt' ? 0.03 : 0.022;
      this.drawGlow(ctx, s.color, s.x, s.y, s.r * 3, 0.7);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.r * 1.4;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * tail, s.y - s.vy * tail); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s.r * 0.5;
      ctx.stroke();
    }
  }

  _player(ctx, game, pal) {
    const p = game.player;
    // traînée du dash
    for (const t of p.trail) {
      const k = 1 - t.t / 0.3;
      this.drawGlow(ctx, t.perfect ? pal.c : pal.a, t.x, t.y, 22 * k, 0.5 * k);
    }
    const blink = p.iframes > 0 && game.mode === 'playing' && p.iframes < 100 && Math.floor(game.time * 20) % 2 === 0;
    const a = p.aim;
    const r = p.r * (1 + game.kickPulse * 0.15);
    this.drawGlow(ctx, pal.a, p.x, p.y, 46, blink ? 0.2 : 0.6);
    if (!blink) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = rgba(pal.a, 0.35);
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * r * 1.6, p.y + Math.sin(a) * r * 1.6);
      ctx.lineTo(p.x + Math.cos(a + 2.4) * r, p.y + Math.sin(a + 2.4) * r);
      ctx.lineTo(p.x + Math.cos(a + Math.PI) * r * 0.35, p.y + Math.sin(a + Math.PI) * r * 0.35);
      ctx.lineTo(p.x + Math.cos(a - 2.4) * r, p.y + Math.sin(a - 2.4) * r);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    if (game.mode !== 'playing') return;
    // anneau de recharge du dash + pulsation sur le temps
    const run = game.run;
    const cd = p.dashCdT > 0 ? 1 - p.dashCdT / run.dashCd : 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(cd >= 1 ? pal.c : pal.a, cd >= 1 ? 0.35 + game.beatPulse * 0.5 : 0.35);
    ctx.beginPath(); ctx.arc(p.x, p.y, 26, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, cd)); ctx.stroke();
  }

  _texts(ctx, game) {
    ctx.textAlign = 'center';
    ctx.font = '700 15px "Chakra Petch", system-ui, sans-serif';
    for (const t of game.texts) {
      const k = t.t / 0.9;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - k * 40);
    }
    ctx.globalAlpha = 1;
  }

  _cursor(ctx, mouse, game, pal) {
    const x = mouse.x, y = mouse.y;
    const pulse = game.beatPulse;
    const r = 10 + pulse * 5;
    ctx.strokeStyle = pal.c;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      ctx.moveTo(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3));
      ctx.lineTo(x + Math.cos(a) * (r + 9), y + Math.sin(a) * (r + 9));
    }
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
}
