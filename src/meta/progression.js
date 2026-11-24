// Méta-progression (module pur, testable) :
//  - Niveau de musicien (XP)  → débloque des kits de départ
//  - Échos (◈)                → achats permanents au Studio
//  - Intensité 0–10           → paliers de difficulté qui multiplient les gains
//  - Succès                   → objectifs, récompensés en Échos

// ───────────────────────────── profil ─────────────────────────────

export function defaultProfile() {
  return {
    xp: 0,               // XP cumulée totale
    echoes: 0,           // monnaie disponible
    echoesTotal: 0,
    gear: {},            // id → niveau acheté
    achievements: {},    // id → date
    intensityUnlocked: 0,
    lastKit: 'classic',
    lastIntensity: 0,
    kitsWave5: [],       // kits avec lesquels la vague 5 a été atteinte
    dailyDone: {},       // graine du jour → meilleur score
    totals: { runs: 0, kills: 0, bosses: 0, perfects: 0, seconds: 0 },
    bests: {},           // kit → meilleure vague
  };
}

export function normalizeProfile(p) {
  const d = defaultProfile();
  if (!p || typeof p !== 'object') return d;
  return {
    ...d, ...p,
    gear: { ...(p.gear || {}) },
    achievements: { ...(p.achievements || {}) },
    totals: { ...d.totals, ...(p.totals || {}) },
    bests: { ...(p.bests || {}) },
    dailyDone: { ...(p.dailyDone || {}) },
    kitsWave5: Array.isArray(p.kitsWave5) ? [...p.kitsWave5] : [],
  };
}

// ───────────────────────────── niveaux ─────────────────────────────

/** XP nécessaire pour passer du niveau l au niveau l+1. */
export const xpToNext = (l) => 250 + (l - 1) * 125;

export function levelInfo(xp) {
  let level = 1, rest = xp;
  while (rest >= xpToNext(level)) { rest -= xpToNext(level); level++; }
  return { level, into: rest, need: xpToNext(level), ratio: rest / xpToNext(level) };
}

// ───────────────────────────── kits ─────────────────────────────

const steps = (...s) => s;

export const KITS = [
  {
    id: 'classic', name: 'Classique', level: 1,
    desc: 'Le kit d\'origine : canon sur les temps, aiguilles en contretemps. Polyvalent.',
    tracks: { kick: steps(0, 4, 8, 12), hat: steps(2, 6, 10, 14) },
  },
  {
    id: 'breakbeat', name: 'Breakbeat', level: 2,
    desc: 'Grosse caisse syncopée et onde de choc dès le départ. Style corps à corps.',
    tracks: { kick: steps(0, 6, 10), snare: steps(4, 12) },
  },
  {
    id: 'acid', name: 'Acid', level: 4,
    desc: 'La basse ouvre le bal : lasers perçants sur un charleston serré.',
    tracks: { bass: steps(0, 3, 8, 11), hat: steps(2, 6, 10, 14) },
  },
  {
    id: 'arp', name: 'Arpégiateur', level: 6,
    desc: 'Missiles à tête chercheuse en rafales mélodiques. Tu vises moins, tu bouges plus.',
    tracks: { lead: steps(0, 4, 8, 12), kick: steps(0, 8) },
  },
  {
    id: 'minimal', name: 'Minimal', level: 8,
    desc: 'Un seul canon… mais une carte d\'amélioration en plus à chaque vague.',
    tracks: { kick: steps(0, 4, 8, 12) }, extraOffer: 1,
  },
  {
    id: 'poly', name: 'Polyrythmie', level: 10,
    desc: 'Un canon en 3 contre 4 qui ne retombe jamais au même endroit. Déroutant, redoutable.',
    tracks: { kick: steps(0, 3, 6, 9, 12, 15), hat: steps(2, 10), snare: steps(8) },
  },
];

export const kitById = (id) => KITS.find((k) => k.id === id) || KITS[0];

export function kitUnlocked(kit, profile) { return levelInfo(profile.xp).level >= kit.level; }

// ───────────────────────────── studio ─────────────────────────────

export const GEAR = [
  { id: 'armor', name: 'Blindage', desc: '+1 PV de départ par niveau.', costs: [60, 140, 260] },
  { id: 'preamp', name: 'Préampli', desc: '+8 % de dégâts sur toutes les pistes par niveau.', costs: [50, 100, 160, 240, 340] },
  { id: 'capacitor', name: 'Condensateur', desc: 'La jauge de DROP commence remplie à 25 % par niveau.', costs: [80, 180] },
  { id: 'remix', name: 'Remix', desc: '+1 relance des offres d\'amélioration par partie.', costs: [90, 220, 400] },
  { id: 'mixer', name: 'Table de mixage', desc: 'Une 4ᵉ carte d\'amélioration proposée à chaque vague.', costs: [450] },
  { id: 'metronome', name: 'Métronome intérieur', desc: 'Fenêtre du dash parfait élargie de 25 ms par niveau.', costs: [70, 160] },
  { id: 'magnet', name: 'Aimant', desc: '+30 % de portée d\'attraction des éclats par niveau.', costs: [40, 90] },
  { id: 'overdrive', name: 'Overdrive', desc: '+6 % de chances de coup critique par niveau.', costs: [70, 150, 280] },
];

export const gearLevel = (profile, id) => profile.gear[id] || 0;

export function gearNextCost(profile, id) {
  const g = GEAR.find((x) => x.id === id);
  const lvl = gearLevel(profile, id);
  return lvl < g.costs.length ? g.costs[lvl] : null;
}

/** Achète le niveau suivant. Renvoie true si l'achat a eu lieu. */
export function buyGear(profile, id) {
  const cost = gearNextCost(profile, id);
  if (cost === null || profile.echoes < cost) return false;
  profile.echoes -= cost;
  profile.gear[id] = gearLevel(profile, id) + 1;
  return true;
}

// ───────────────────────────── intensité ─────────────────────────────

export const INTENSITY = [
  { level: 1, text: 'Ennemis +15 % PV' },
  { level: 2, text: 'Tempo de départ +6 BPM' },
  { level: 3, text: 'Ennemis 10 % plus rapides' },
  { level: 4, text: '−1 PV de départ' },
  { level: 5, text: 'Projectiles ennemis 20 % plus rapides' },
  { level: 6, text: 'Vagues 20 % plus nombreuses' },
  { level: 7, text: 'Le Métronome a +35 % PV' },
  { level: 8, text: 'Plus d\'offre « Réparation »' },
  { level: 9, text: 'Ennemis +25 % PV supplémentaires' },
  { level: 10, text: 'Ennemis encore 10 % plus rapides, vagues +20 %' },
];
export const MAX_INTENSITY = 10;

export const rewardMultiplier = (intensity) => 1 + intensity * 0.2;

/** Modificateurs cumulés d'un niveau d'intensité. */
export function intensityMods(n) {
  return {
    enemyHp: (n >= 1 ? 1.15 : 1) * (n >= 9 ? 1.25 : 1),
    startBpm: n >= 2 ? 6 : 0,
    enemySpeed: (n >= 3 ? 1.1 : 1) * (n >= 10 ? 1.1 : 1),
    hpPenalty: n >= 4 ? 1 : 0,
    bulletSpeed: n >= 5 ? 1.2 : 1,
    budget: (n >= 6 ? 1.2 : 1) * (n >= 10 ? 1.2 : 1),
    bossHp: n >= 7 ? 1.35 : 1,
    noHeal: n >= 8,
  };
}

// ───────────────────────────── configuration d'une partie ─────────────────────────────

/** Tout ce que la méta-progression modifie au lancement d'une partie. */
export function runSetup(profile, kitId, intensity) {
  const kit = kitById(kitId);
  const im = intensityMods(intensity);
  const g = (id) => gearLevel(profile, id);
  return {
    kit: kit.id,
    kitTracks: kit.tracks,
    intensity,
    mods: im,
    maxHp: 5 + g('armor') - im.hpPenalty,
    dmgMul: 1 + 0.08 * g('preamp'),
    dropStart: 0.25 * g('capacitor'),
    rerolls: g('remix'),
    offerCount: 3 + g('mixer') + (kit.extraOffer || 0),
    perfectBonus: 0.025 * g('metronome'),
    magnetMul: 1 + 0.3 * g('magnet'),
    critBonus: 0.06 * g('overdrive'),
    startBpm: 118 + im.startBpm,
  };
}

// ───────────────────────────── succès ─────────────────────────────
// check(s, p) : s = statistiques de la partie (éventuellement en cours), p = profil.

export const ACHIEVEMENTS = [
  { id: 'first', name: 'Premier morceau', desc: 'Terminer une partie.', reward: 15, end: true, check: () => true },
  { id: 'w5', name: 'Échauffement', desc: 'Atteindre la vague 5.', reward: 25, check: (s) => s.wave >= 5 },
  { id: 'w10', name: 'Deuxième mouvement', desc: 'Atteindre la vague 10.', reward: 60, check: (s) => s.wave >= 10 },
  { id: 'w15', name: 'Troisième mouvement', desc: 'Atteindre la vague 15.', reward: 120, check: (s) => s.wave >= 15 },
  { id: 'w20', name: 'Finale', desc: 'Atteindre la vague 20.', reward: 250, check: (s) => s.wave >= 20 },
  { id: 'boss', name: 'Briser le Métronome', desc: 'Vaincre un boss.', reward: 40, check: (s) => s.bosses >= 1 },
  { id: 'boss3', name: 'Chef d\'orchestre', desc: 'Vaincre 3 boss dans la même partie.', reward: 200, check: (s) => s.bosses >= 3 },
  { id: 'nohit', name: 'Sans fausse note', desc: 'Vaincre un boss sans être touché pendant le combat.', reward: 120, check: (s) => s.bossNoHit },
  { id: 'perfect15', name: 'Dans le temps', desc: '15 dash parfaits en une partie.', reward: 40, check: (s) => s.perfects >= 15 },
  { id: 'perfect50', name: 'Horloge atomique', desc: '50 dash parfaits en une partie.', reward: 120, check: (s) => s.perfects >= 50 },
  { id: 'combo50', name: 'Groove', desc: 'Atteindre un combo de 50.', reward: 30, check: (s) => s.maxCombo >= 50 },
  { id: 'combo150', name: 'Virtuose', desc: 'Atteindre un combo de 150.', reward: 100, check: (s) => s.maxCombo >= 150 },
  { id: 'orchestra', name: 'Orchestre complet', desc: 'Avoir les 5 pistes débloquées dans une partie.', reward: 60, check: (s) => s.tracksUnlocked >= 5 },
  { id: 'wall', name: 'Mur de son', desc: 'Remplir entièrement une piste (16 notes).', reward: 100, check: (s) => s.fullTrack },
  { id: 'bpm150', name: 'Accélérando', desc: 'Atteindre 150 BPM.', reward: 80, check: (s) => s.bpm >= 150 },
  { id: 'drop5', name: 'Accro au drop', desc: '5 DROP en une seule partie.', reward: 50, check: (s) => s.drops >= 5 },
  { id: 'kills300', name: 'Saturation', desc: '300 éliminations en une partie.', reward: 70, check: (s) => s.kills >= 300 },
  { id: 'score100k', name: 'Disque d\'or', desc: 'Marquer 100 000 points.', reward: 120, check: (s) => s.score >= 100000 },
  { id: 'int3', name: 'Crescendo', desc: 'Atteindre la vague 10 en intensité 3 ou plus.', reward: 150, check: (s) => s.intensity >= 3 && s.wave >= 10 },
  { id: 'int6', name: 'Fortissimo', desc: 'Atteindre la vague 10 en intensité 6 ou plus.', reward: 300, check: (s) => s.intensity >= 6 && s.wave >= 10 },
  { id: 'int10', name: 'Résonance absolue', desc: 'Atteindre la vague 10 en intensité 10.', reward: 800, check: (s) => s.intensity >= 10 && s.wave >= 10 },
  { id: 'kits4', name: 'Multi-instrumentiste', desc: 'Atteindre la vague 5 avec 4 kits différents.', reward: 150, check: (s, p) => kitsWave5After(s, p).length >= 4 },
  { id: 'daily', name: 'Rendez-vous quotidien', desc: 'Jouer un Défi du jour.', reward: 20, end: true, check: (s) => s.daily },
  { id: 'runs25', name: 'Habitué du studio', desc: 'Jouer 25 parties.', reward: 150, end: true, check: (s, p) => p.totals.runs + 1 >= 25 },
];

function kitsWave5After(s, p) {
  const set = new Set(p.kitsWave5);
  if (s.wave >= 5 && s.kit) set.add(s.kit);
  return [...set];
}

/**
 * Débloque les succès remplis. `final` = fin de partie (autorise les succès marqués `end`).
 * Les Échos sont crédités immédiatement. Renvoie la liste des succès nouvellement obtenus.
 */
export function unlockAchievements(profile, stats, final = false) {
  const out = [];
  for (const a of ACHIEVEMENTS) {
    if (profile.achievements[a.id]) continue;
    if (a.end && !final) continue;
    if (!a.check(stats, profile)) continue;
    profile.achievements[a.id] = Date.now();
    profile.echoes += a.reward;
    profile.echoesTotal += a.reward;
    out.push(a);
  }
  return out;
}

// ───────────────────────────── fin de partie ─────────────────────────────

export function runRewards(stats) {
  const mult = rewardMultiplier(stats.intensity || 0);
  const xp = Math.round((stats.score / 60 + stats.wave * 30 + stats.bosses * 120 + stats.perfects * 2) * mult);
  const echoes = Math.round((stats.wave * 4 + stats.bosses * 30 + stats.score / 1500) * mult);
  return { xp, echoes, mult };
}

/**
 * Applique la fin de partie au profil. Renvoie un résumé pour l'écran de récompenses.
 */
export function finishRun(profile, stats) {
  const before = levelInfo(profile.xp);
  const { xp, echoes, mult } = runRewards(stats);
  const achievements = unlockAchievements(profile, stats, true);

  profile.xp += xp;
  profile.echoes += echoes;
  profile.echoesTotal += echoes;
  profile.totals.runs++;
  profile.totals.kills += stats.kills;
  profile.totals.bosses += stats.bosses;
  profile.totals.perfects += stats.perfects;
  profile.totals.seconds += stats.seconds || 0;
  if (stats.wave >= 5 && stats.kit && !profile.kitsWave5.includes(stats.kit)) profile.kitsWave5.push(stats.kit);
  if (stats.kit) profile.bests[stats.kit] = Math.max(profile.bests[stats.kit] || 0, stats.wave);
  if (stats.daily) profile.dailyDone[stats.seed] = Math.max(profile.dailyDone[stats.seed] || 0, stats.score);

  // Atteindre la vague 10 débloque l'intensité suivante
  let intensityUp = false;
  if (stats.wave >= 10 && stats.intensity >= profile.intensityUnlocked && profile.intensityUnlocked < MAX_INTENSITY) {
    profile.intensityUnlocked = stats.intensity + 1;
    intensityUp = true;
  }

  const after = levelInfo(profile.xp);
  const newKits = KITS.filter((k) => k.level > before.level && k.level <= after.level);
  const nextKit = KITS.find((k) => k.level > after.level) || null;

  return {
    xp, echoes, mult, achievements,
    achievementEchoes: achievements.reduce((n, a) => n + a.reward, 0),
    before, after, levelsGained: after.level - before.level,
    newKits, nextKit, intensityUp, intensityUnlocked: profile.intensityUnlocked,
  };
}
