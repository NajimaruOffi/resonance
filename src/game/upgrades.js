// Améliorations proposées entre les vagues (module pur, testable).

import { TRACK_ORDER, unlockTrack, activeStepCount } from './tracks.js';

export const RARITY = {
  common: { label: 'Commun', order: 0 },
  rare: { label: 'Rare', order: 1 },
  epic: { label: 'Épique', order: 2 },
};

const PROJECTILE_TRACKS = ['kick', 'hat', 'lead'];
const AREA_TRACKS = ['snare', 'bass'];

export const UPGRADES = [
  {
    id: 'unlock', rarity: 'rare', weight: 6, perTrack: true,
    ok: (r, t) => !t.unlocked,
    title: (t) => `Nouvelle piste : ${t.def.weapon}`,
    desc: (t) => `${t.def.desc} Ajoute l'instrument ${t.def.label} à ton morceau.`,
    apply: (r, t) => unlockTrack(t, r.musicRng),
  },
  {
    id: 'step', rarity: 'common', weight: 10, perTrack: true,
    ok: (r, t) => t.unlocked && activeStepCount(t) < 16,
    title: (t) => `Nouvelle note — ${t.def.weapon}`,
    desc: (t) => `Place toi-même une note sur la piste ${t.def.label}. Plus de notes = plus de tirs.`,
    place: 1,
  },
  {
    id: 'step2', rarity: 'epic', weight: 2.5, perTrack: true,
    ok: (r, t) => t.unlocked && activeStepCount(t) <= 13,
    title: (t) => `Phrasé — ${t.def.weapon}`,
    desc: (t) => `Place deux notes sur la piste ${t.def.label}.`,
    place: 2,
  },
  {
    id: 'dmg', rarity: 'common', weight: 7, perTrack: true,
    ok: (r, t) => t.unlocked,
    title: (t) => `Gain +35 % — ${t.def.weapon}`,
    desc: (t) => `Augmente les dégâts de la piste ${t.def.label}. Elle joue aussi plus fort.`,
    apply: (r, t) => { t.mods.dmg *= 1.35; t.mods.level++; },
  },
  {
    id: 'pierce', rarity: 'rare', weight: 4, perTrack: true,
    ok: (r, t) => t.unlocked && PROJECTILE_TRACKS.includes(t.id) && t.mods.pierce < 4,
    title: (t) => `Perforation — ${t.def.weapon}`,
    desc: () => 'Les projectiles traversent un ennemi de plus.',
    apply: (r, t) => { t.mods.pierce += 1; },
  },
  {
    id: 'multi', rarity: 'epic', weight: 3, perTrack: true,
    ok: (r, t) => t.unlocked && PROJECTILE_TRACKS.includes(t.id) && t.mods.multi < 3,
    title: (t) => `Éventail — ${t.def.weapon}`,
    desc: () => '+1 projectile par note, tirés en éventail.',
    apply: (r, t) => { t.mods.multi += 1; },
  },
  {
    id: 'echo', rarity: 'epic', weight: 3, perTrack: true,
    ok: (r, t) => t.unlocked && !t.mods.echo,
    title: (t) => `Écho — ${t.def.weapon}`,
    desc: (t) => `Chaque note de ${t.def.label} est rejouée une double-croche plus tard (50 % des dégâts). Ajoute un delay au son.`,
    apply: (r, t) => { t.mods.echo = true; },
  },
  {
    id: 'size', rarity: 'common', weight: 5, perTrack: true,
    // l'onde est plafonnée plus bas (+75 % max) pour ne pas couvrir tout l'écran
    ok: (r, t) => t.unlocked && AREA_TRACKS.includes(t.id) && t.mods.size < (t.id === 'snare' ? 1.75 : 2.5),
    title: (t) => `Amplitude — ${t.def.weapon}`,
    desc: (t) => (t.id === 'snare' ? 'Rayon de l\'onde +25 %.' : 'Rayon laser plus long et plus large (+25 %).'),
    apply: (r, t) => { t.mods.size += 0.25; },
  },
  {
    id: 'hp', rarity: 'common', weight: 5,
    ok: (r) => r.maxHp < 9,
    title: () => 'Blindage',
    desc: () => '+1 PV maximum et +1 PV.',
    apply: (r) => { r.maxHp += 1; r.hp = Math.min(r.maxHp, r.hp + 1); },
  },
  {
    id: 'heal', rarity: 'common', weight: 6,
    ok: (r) => r.hp < r.maxHp && !r.noHeal,
    title: () => 'Réparation',
    desc: () => 'Restaure tous tes PV.',
    apply: (r) => { r.hp = r.maxHp; },
  },
  {
    id: 'crit', rarity: 'rare', weight: 4,
    ok: (r) => r.crit < 0.5,
    title: () => 'Saturation',
    desc: () => '+12 % de chances de coup critique (dégâts ×2,5).',
    apply: (r) => { r.crit += 0.12; },
  },
  {
    id: 'dash', rarity: 'rare', weight: 4,
    ok: (r) => r.dashCd > 0.35,
    title: () => 'Syncope',
    desc: () => 'Recharge du dash −25 %.',
    apply: (r) => { r.dashCd *= 0.75; },
  },
  {
    id: 'drop', rarity: 'rare', weight: 4,
    ok: (r) => r.dropGain < 3,
    title: () => 'Résonance',
    desc: () => 'La jauge de DROP se remplit 40 % plus vite.',
    apply: (r) => { r.dropGain *= 1.4; },
  },
  {
    id: 'magnet', rarity: 'common', weight: 3,
    ok: (r) => r.magnet < 400,
    title: () => 'Aimant',
    desc: () => 'Les éclats sont attirés de 50 % plus loin.',
    apply: (r) => { r.magnet *= 1.5; },
  },
  {
    id: 'tempo', rarity: 'epic', weight: 2,
    ok: (r) => r.bpm < 158,
    title: () => 'Accélérando',
    desc: () => '+8 BPM : toutes tes armes tirent plus vite… mais les ennemis aussi.',
    apply: (r) => { r.bpm += 8; },
  },
];

/** Construit la liste de toutes les offres possibles pour l'état courant. */
export function candidates(run) {
  const out = [];
  for (const up of UPGRADES) {
    if (up.perTrack) {
      for (const id of TRACK_ORDER) {
        const t = run.tracks[id];
        if (up.ok(run, t)) out.push({ up, track: t, weight: up.weight, key: `${up.id}:${id}` });
      }
    } else if (up.ok(run)) {
      out.push({ up, track: null, weight: up.weight, key: up.id });
    }
  }
  return out;
}

/** Tire n offres distinctes (au plus une par type d'amélioration). */
export function rollOffers(run, rng, n = 3) {
  let pool = candidates(run);
  const offers = [];
  while (offers.length < n && pool.length) {
    const c = rng.weighted(pool);
    offers.push(c);
    pool = pool.filter((p) => p.up.id !== c.up.id);
  }
  return offers.map((c) => ({
    key: c.key,
    id: c.up.id,
    rarity: c.up.rarity,
    title: c.up.title(c.track),
    desc: c.up.desc(c.track),
    track: c.track ? c.track.id : null,
    place: c.up.place || 0,
  }));
}

export function applyOffer(run, offer) {
  const up = UPGRADES.find((u) => u.id === offer.id);
  const t = offer.track ? run.tracks[offer.track] : null;
  if (up.apply) up.apply(run, t);
  return up.place || 0;
}
