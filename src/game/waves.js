// Générateur de vagues déterministe (pur : testable sans navigateur).
// Une vague = une suite de mesures ; chaque mesure contient des groupes d'apparition.

import { ENEMY_DEFS } from './enemies.js';

const UNLOCK_WAVE = { drone: 1, dart: 2, splitter: 3, sentinel: 4, colossus: 7 };
const FORMATIONS = ['cluster', 'ring', 'edge', 'pincer'];

export function isBossWave(wave) { return wave % 5 === 0; }

export function waveBudget(wave) { return Math.round(7 + wave * 4.2 + Math.pow(wave, 1.35)); }

export function hpScale(wave) { return 1 + (wave - 1) * 0.13 + Math.pow(Math.max(0, wave - 10), 1.4) * 0.05; }

export function availableTypes(wave) {
  return Object.keys(UNLOCK_WAVE).filter((t) => wave >= UNLOCK_WAVE[t]);
}

/**
 * @returns {{ wave:number, boss:boolean, bars: Array<Array<{type:string,count:number,formation:string}>>, budget:number }}
 */
export function buildWave(wave, rng, budgetMul = 1) {
  const boss = isBossWave(wave);
  const types = availableTypes(wave);
  let budget = Math.round((boss ? waveBudget(wave) * 0.35 : waveBudget(wave)) * budgetMul);
  const total = budget;
  const nBars = boss ? 3 : Math.min(10, 3 + Math.floor(wave / 2));
  const bars = [];

  // Répartition : montée en puissance au fil des mesures
  const weights = [];
  let wsum = 0;
  for (let i = 0; i < nBars; i++) { const w = 1 + i * 0.35; weights.push(w); wsum += w; }

  for (let i = 0; i < nBars; i++) {
    let barBudget = i === nBars - 1 ? budget : Math.max(1, Math.round((total * weights[i]) / wsum));
    budget -= barBudget;
    const groups = [];
    let guard = 0;
    while (barBudget > 0 && guard++ < 20) {
      // privilégie les types récents (plus intéressants), sans exclure les anciens
      const affordable = types.filter((t) => ENEMY_DEFS[t].cost <= barBudget);
      if (!affordable.length) break;
      const pickList = affordable.map((t, idx) => ({ t, weight: 1 + idx * 0.6 }));
      const type = rng.weighted(pickList).t;
      const cost = ENEMY_DEFS[type].cost;
      const maxCount = Math.max(1, Math.floor(barBudget / cost));
      const count = Math.min(maxCount, type === 'drone' ? rng.int(3, 7) : type === 'colossus' ? 1 : rng.int(1, 4));
      groups.push({ type, count, formation: rng.pick(FORMATIONS) });
      barBudget -= count * cost;
    }
    bars.push(groups);
    if (budget <= 0 && i < nBars - 1) { budget = 0; }
  }

  return { wave, boss, bars, budget: total };
}

/** Positions d'apparition pour un groupe, en évitant la zone autour du joueur. */
export function formationPositions(group, player, W, H, rng) {
  const out = [];
  const margin = 70;
  const safe = 260;
  const clampPos = (x, y) => ({ x: Math.min(W - margin, Math.max(margin, x)), y: Math.min(H - margin, Math.max(margin, y)) });
  const n = group.count;

  switch (group.formation) {
    case 'ring': {
      const r = 480 + rng.range(0, 120);
      const off = rng.range(0, Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        out.push(clampPos(player.x + Math.cos(a) * r, player.y + Math.sin(a) * r));
      }
      break;
    }
    case 'edge': {
      const side = rng.int(0, 3);
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / (n + 1);
        if (side === 0) out.push(clampPos(W * t, margin));
        else if (side === 1) out.push(clampPos(W - margin, H * t));
        else if (side === 2) out.push(clampPos(W * t, H - margin));
        else out.push(clampPos(margin, H * t));
      }
      break;
    }
    case 'pincer': {
      const a = rng.range(0, Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const r = 520 + rng.range(-40, 40);
        const aa = a + (side > 0 ? 0 : Math.PI) + rng.range(-0.25, 0.25);
        out.push(clampPos(player.x + Math.cos(aa) * r, player.y + Math.sin(aa) * r));
      }
      break;
    }
    default: { // cluster
      let cx, cy, tries = 0;
      do {
        cx = rng.range(margin, W - margin);
        cy = rng.range(margin, H - margin);
      } while (Math.hypot(cx - player.x, cy - player.y) < safe + 200 && tries++ < 30);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(0, 30 + n * 12);
        out.push(clampPos(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
      }
    }
  }

  // garantit une distance minimale au joueur (repousse radialement)
  return out.map((p) => {
    const dx = p.x - player.x, dy = p.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d >= safe) return p;
    const k = d < 1 ? 1 : safe / d;
    return clampPos(player.x + (d < 1 ? safe : dx * k), player.y + (d < 1 ? 0 : dy * k));
  });
}
