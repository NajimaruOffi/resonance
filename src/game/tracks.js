// Pistes du séquenceur = armes du joueur.

import { leadMotif, bassMotif } from '../music/motif.js';

export const TRACK_ORDER = ['kick', 'hat', 'snare', 'bass', 'lead'];

export const TRACK_DEFS = {
  kick: {
    id: 'kick', label: 'KICK', weapon: 'Canon', color: 'a',
    desc: 'Projectile lourd tiré vers le curseur.',
    start: [0, 4, 8, 12], unlockSteps: [0, 4, 8, 12],
    base: { dmg: 14, speed: 950, radius: 8 },
  },
  hat: {
    id: 'hat', label: 'HAT', weapon: 'Aiguilles', color: 'c',
    desc: 'Aiguilles rapides, faibles dégâts, grande cadence.',
    start: [2, 6, 10, 14], unlockSteps: [2, 6, 10, 14],
    base: { dmg: 5, speed: 1350, radius: 4 },
  },
  snare: {
    id: 'snare', label: 'SNARE', weapon: 'Onde', color: 'b',
    desc: 'Anneau de choc autour de toi : dégâts de zone et léger recul.',
    start: null, unlockSteps: [4, 12],
    base: { dmg: 11, radius: 190, knock: 160 },
  },
  bass: {
    id: 'bass', label: 'BASS', weapon: 'Laser', color: 'd',
    desc: 'Rayon perçant. Sa note suit la progression d\'accords.',
    start: null, unlockSteps: [0, 10],
    base: { dmg: 11, length: 900, width: 12 },
  },
  lead: {
    id: 'lead', label: 'LEAD', weapon: 'Essaim', color: 'b',
    desc: 'Missiles à tête chercheuse qui jouent l\'arpège.',
    start: null, unlockSteps: [0, 6, 11],
    base: { dmg: 6.5, speed: 560, radius: 6, turn: 7 },
  },
};

/**
 * @param {Record<string, number[]>} [kitTracks] pistes de départ d'un kit ({ kick: [0,4,8,12], ... }).
 *        Sans kit : configuration classique (kick + hat).
 */
export const MELODIC = ['bass', 'lead'];
export const isMelodic = (id) => MELODIC.includes(id);
/** Nombre de hauteurs disponibles (indices de tons de l'accord) par piste mélodique. */
export const PITCH_RANGE = { bass: 5, lead: 8 };

function applyMotif(track, rng) {
  const steps = [];
  track.steps.forEach((on, s) => { if (on) steps.push(s); });
  if (!isMelodic(track.id) || !steps.length) return;
  const motif = rng
    ? (track.id === 'bass' ? bassMotif(rng, steps) : leadMotif(rng, steps))
    : steps.map((s, i) => (track.id === 'bass' ? (i % 2 ? 2 : 0) : [0, 2, 4, 2][i % 4]));
  steps.forEach((s, i) => { track.pitch[s] = motif[i]; });
}

/**
 * @param {Record<string, number[]>} [kitTracks] pistes de départ d'un kit ({ kick: [0,4,8,12], ... }).
 *        Sans kit : configuration classique (kick + hat).
 * @param {import('../util/rng.js').RNG} [rng] pour générer les motifs mélodiques de départ.
 */
export function createTracks(kitTracks = null, rng = null) {
  const tracks = {};
  for (const id of TRACK_ORDER) {
    const def = TRACK_DEFS[id];
    const steps = new Array(16).fill(false);
    const start = kitTracks ? kitTracks[id] : def.start;
    if (start) for (const s of start) steps[s] = true;
    tracks[id] = {
      id,
      def,
      unlocked: !!start,
      steps,
      pitch: new Array(16).fill(0),
      mods: { dmg: 1, pierce: 0, multi: 0, echo: false, size: 1, level: 0 },
    };
    applyMotif(tracks[id], rng);
  }
  return tracks;
}

export function unlockTrack(track, rng = null) {
  track.unlocked = true;
  for (const s of track.def.unlockSteps) track.steps[s] = true;
  applyMotif(track, rng);
}

/** Copie sérialisable d'un ensemble de pistes (instantané pour le morceau / la sauvegarde). */
export function snapshotTracks(tracks) {
  const out = {};
  for (const id of TRACK_ORDER) {
    const t = tracks[id];
    out[id] = {
      id, unlocked: !!t.unlocked, steps: [...t.steps], pitch: [...(t.pitch || new Array(16).fill(0))],
      mods: { level: t.mods?.level || 0, echo: !!t.mods?.echo },
    };
  }
  return out;
}

export function activeStepCount(track) {
  return track.steps.reduce((n, s) => n + (s ? 1 : 0), 0);
}
