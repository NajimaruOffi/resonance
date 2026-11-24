// Système de particules en pool (tableaux typés, zéro allocation en jeu).

import { TAU } from '../util/math.js';

const MAX = 4000;

export class Particles {
  constructor() {
    this.x = new Float32Array(MAX);
    this.y = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX); // 0 = point, 1 = trait (étincelle), 2 = anneau
    this.color = new Array(MAX).fill('#fff');
    this.count = 0;
  }

  spawn(x, y, vx, vy, life, size, color, kind = 0, drag = 3) {
    let i;
    if (this.count < MAX) i = this.count++;
    else i = Math.floor(Math.random() * MAX); // recyclage
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
    this.color[i] = color; this.kind[i] = kind; this.drag[i] = drag;
  }

  burst(x, y, n, color, { speed = 300, life = 0.6, size = 3, kind = 1, spread = TAU, angle = 0, drag = 3 } = {}) {
    for (let k = 0; k < n; k++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), color, kind, drag);
    }
  }

  ring(x, y, radius, color, life = 0.4) {
    this.spawn(x, y, radius, 0, life, 2, color, 2, 0);
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const j = --this.count;
        this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
        this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size[i] = this.size[j];
        this.color[i] = this.color[j]; this.kind[i] = this.kind[j]; this.drag[i] = this.drag[j];
        continue;
      }
      if (this.kind[i] !== 2) {
        const f = Math.exp(-this.drag[i] * dt);
        this.vx[i] *= f; this.vy[i] *= f;
        this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
      }
      i++;
    }
  }

  draw(ctx) {
    ctx.lineCap = 'round';
    for (let i = 0; i < this.count; i++) {
      const t = this.life[i] / this.max[i];
      ctx.globalAlpha = t;
      const k = this.kind[i];
      if (k === 1) {
        ctx.strokeStyle = this.color[i];
        ctx.lineWidth = this.size[i] * t + 0.5;
        ctx.beginPath();
        ctx.moveTo(this.x[i], this.y[i]);
        ctx.lineTo(this.x[i] - this.vx[i] * 0.04, this.y[i] - this.vy[i] * 0.04);
        ctx.stroke();
      } else if (k === 2) {
        const r = this.vx[i] * (1 - t * t);
        ctx.strokeStyle = this.color[i];
        ctx.lineWidth = 3 * t + 0.5;
        ctx.beginPath();
        ctx.arc(this.x[i], this.y[i], r, 0, TAU);
        ctx.stroke();
      } else {
        ctx.fillStyle = this.color[i];
        const s = this.size[i] * (0.4 + t * 0.6);
        ctx.fillRect(this.x[i] - s / 2, this.y[i] - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }
}
