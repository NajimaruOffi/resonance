// Grille de fond à ressorts : se déforme sous les explosions, respire avec la musique.
// Intégration semi-implicite d'Euler ; chaque nœud est rappelé vers sa position d'origine
// et couplé à ses 4 voisins.

export class SpringGrid {
  constructor(width, height, spacing = 50) {
    this.spacing = spacing;
    this.cols = Math.floor(width / spacing) + 1;
    this.rows = Math.floor(height / spacing) + 1;
    const n = this.cols * this.rows;
    this.ox = new Float32Array(n); this.oy = new Float32Array(n);
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        this.ox[i] = this.x[i] = c * spacing;
        this.oy[i] = this.y[i] = r * spacing;
      }
    }
  }

  /** Impulsion radiale (positive = pousse, négative = aspire). */
  impulse(x, y, strength, radius) {
    const s = this.spacing;
    // les nœuds du bord restent fixes (ancrage de la grille)
    const c0 = Math.max(1, Math.floor((x - radius) / s)), c1 = Math.min(this.cols - 2, Math.ceil((x + radius) / s));
    const r0 = Math.max(1, Math.floor((y - radius) / s)), r1 = Math.min(this.rows - 2, Math.ceil((y + radius) / s));
    const r2 = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const dx = this.x[i] - x, dy = this.y[i] - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2 || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const f = strength * (1 - d / radius);
        this.vx[i] += (dx / d) * f;
        this.vy[i] += (dy / d) * f;
      }
    }
  }

  update(dt) {
    const k = 60, neighbor = 18, damping = Math.exp(-5 * dt);
    const cols = this.cols, rows = this.rows;
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const i = r * cols + c;
        let ax = (this.ox[i] - this.x[i]) * k;
        let ay = (this.oy[i] - this.y[i]) * k;
        // couplage avec les voisins (lisse les ondes)
        const avgx = (this.x[i - 1] + this.x[i + 1] + this.x[i - cols] + this.x[i + cols]) * 0.25;
        const avgy = (this.y[i - 1] + this.y[i + 1] + this.y[i - cols] + this.y[i + cols]) * 0.25;
        ax += (avgx - this.x[i]) * neighbor;
        ay += (avgy - this.y[i]) * neighbor;
        this.vx[i] = (this.vx[i] + ax * dt) * damping;
        this.vy[i] = (this.vy[i] + ay * dt) * damping;
      }
    }
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const i = r * cols + c;
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
      }
    }
  }

  draw(ctx, color, accent, pulse, view) {
    const cols = this.cols, rows = this.rows;
    const s = this.spacing;
    const c0 = Math.max(0, Math.floor(view.x0 / s) - 1), c1 = Math.min(cols - 1, Math.ceil(view.x1 / s) + 1);
    const r0 = Math.max(0, Math.floor(view.y0 / s) - 1), r1 = Math.min(rows - 1, Math.ceil(view.y1 / s) + 1);

    ctx.lineWidth = 1;
    for (let pass = 0; pass < 2; pass++) {
      // passe 0 : lignes fines ; passe 1 : une ligne sur 4, plus lumineuse (pulse sur le temps)
      ctx.strokeStyle = pass === 0 ? color : accent;
      ctx.globalAlpha = pass === 0 ? 0.9 : 0.22 + pulse * 0.4;
      ctx.lineWidth = pass === 0 ? 1 : 1.5;
      ctx.beginPath();
      for (let r = r0; r <= r1; r++) {
        if (pass === 1 && r % 4) continue;
        let i = r * cols + c0;
        ctx.moveTo(this.x[i], this.y[i]);
        for (let c = c0 + 1; c <= c1; c++) { i = r * cols + c; ctx.lineTo(this.x[i], this.y[i]); }
      }
      for (let c = c0; c <= c1; c++) {
        if (pass === 1 && c % 4) continue;
        let i = r0 * cols + c;
        ctx.moveTo(this.x[i], this.y[i]);
        for (let r = r0 + 1; r <= r1; r++) { i = r * cols + c; ctx.lineTo(this.x[i], this.y[i]); }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
