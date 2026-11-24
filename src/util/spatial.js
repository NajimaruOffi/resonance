// Grille de hachage spatial : requêtes de voisinage en O(1) amorti.
// Reconstruite à chaque frame pour les ennemis (quelques centaines max).

export class SpatialHash {
  constructor(cellSize = 96) {
    this.cell = cellSize;
    this.map = new Map();
    this._stamp = 0;
  }

  clear() { this.map.clear(); }

  _key(cx, cy) { return (cx + 4096) * 8192 + (cy + 4096); }

  insert(obj) {
    const c = this.cell;
    const r = obj.r || 0;
    const x0 = Math.floor((obj.x - r) / c), x1 = Math.floor((obj.x + r) / c);
    const y0 = Math.floor((obj.y - r) / c), y1 = Math.floor((obj.y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this._key(cx, cy);
        let bucket = this.map.get(k);
        if (!bucket) { bucket = []; this.map.set(k, bucket); }
        bucket.push(obj);
      }
    }
  }

  /** Appelle fn(obj) pour chaque objet unique dont la cellule recoupe le cercle (x,y,r). */
  query(x, y, r, fn) {
    const c = this.cell;
    const stamp = ++this._stamp;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.map.get(this._key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const o = bucket[i];
          if (o._qs === stamp) continue;
          o._qs = stamp;
          if (fn(o) === false) return;
        }
      }
    }
  }
}
