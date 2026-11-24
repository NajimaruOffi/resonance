export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
export const len = (x, y) => Math.sqrt(x * x + y * y);

/** Lissage indépendant du framerate : 1 - exp(-k*dt) */
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
export function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

/** Distance au carré d'un point P au segment AB. */
export function pointSegDist2(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / l2;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t, cy = ay + aby * t;
  return dist2(px, py, cx, cy);
}

/** Couleur hex "#rrggbb" -> "rgba(r,g,b,a)" (mise en cache). */
const rgbaCache = new Map();
export function rgba(hex, a) {
  const key = hex + a.toFixed(3);
  let v = rgbaCache.get(key);
  if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
  if (rgbaCache.size > 4000) rgbaCache.clear();
  rgbaCache.set(key, v);
  return v;
}
