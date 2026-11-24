// Projet du mode Création (éditable) : deux patterns (A et B), un son (style, tonalité,
// progression, tempo) et un arrangement en sections. Se compile en « morceau » (song.js).

import { createTracks, snapshotTracks, TRACK_ORDER } from '../game/tracks.js';
import { progressionById, rootForPc, PROGRESSIONS } from './theory.js';
import { newSongId, SONG_VERSION } from './song.js';
import { RNG } from '../util/rng.js';
import { leadMotif, bassMotif } from './motif.js';

export const SECTION_TYPES = ['intro', 'full', 'build', 'drop', 'breakdown', 'outro'];
export const BAR_CHOICES = [2, 4, 8, 16];

export const TEMPLATES = {
  club: {
    name: 'Club (montée / drop)',
    sections: [['intro', 'A', 8], ['full', 'A', 8], ['build', 'B', 4], ['drop', 'B', 8], ['breakdown', 'A', 4], ['build', 'B', 4], ['drop', 'B', 8], ['outro', 'A', 4]],
  },
  pop: {
    name: 'Couplet / refrain',
    sections: [['intro', 'A', 4], ['full', 'A', 8], ['full', 'B', 8], ['full', 'A', 8], ['full', 'B', 8], ['breakdown', 'A', 4], ['full', 'B', 8], ['outro', 'B', 4]],
  },
  court: {
    name: 'Court (≈ 1 min)',
    sections: [['intro', 'A', 4], ['full', 'A', 8], ['drop', 'B', 8], ['outro', 'A', 4]],
  },
  boucle: {
    name: 'Boucle simple',
    sections: [['full', 'A', 8], ['full', 'B', 8]],
  },
};

const emptyPattern = () => snapshotTracks(createTracks({}));

export function templateSections(id) {
  return TEMPLATES[id].sections.map(([type, pattern, bars]) => ({ type, pattern, bars }));
}

/** Projet de départ : un groove complet et musical, pour ne jamais partir d'une page blanche. */
export function newProject(seed = Date.now()) {
  const rng = new RNG(`projet:${seed}`);
  const A = snapshotTracks(createTracks({
    kick: [0, 4, 8, 12], hat: [2, 6, 10, 14], snare: [4, 12], bass: [0, 3, 8, 11], lead: [0, 3, 6, 10, 12],
  }, rng));
  const B = snapshotTracks(createTracks({
    kick: [0, 4, 8, 12], hat: [2, 3, 6, 10, 11, 14], snare: [4, 12, 15], bass: [0, 3, 6, 8, 11, 14], lead: [0, 2, 4, 7, 8, 11, 14],
  }, rng));
  return {
    id: newSongId(), title: 'Nouveau morceau', origin: 'studio', createdAt: Date.now(),
    style: 'synthwave', root: 57, mode: 'aeolian', progId: 'neon', bpm: 118,
    patterns: { A, B },
    arrangement: templateSections('club'),
  };
}

export function projectHarmony(p) {
  const prog = progressionById(p.progId);
  return { root: p.root, mode: p.mode, prog: [...prog.a], progB: [...prog.b] };
}

/** Compile le projet en morceau (sections autonomes) prêt à rendre / exporter. */
export function projectToSong(p) {
  const harmony = projectHarmony(p);
  return {
    version: SONG_VERSION, id: p.id, title: p.title, origin: 'studio', createdAt: p.createdAt,
    sections: p.arrangement.map((s) => ({
      type: s.type, bars: s.bars, bpm: p.bpm, harmony, style: p.style,
      tracks: p.patterns[s.pattern] || p.patterns.A,
    })),
    project: JSON.parse(JSON.stringify(p)),
  };
}

const sameTracks = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Ouvre n'importe quel morceau dans le Studio (un morceau de partie devient éditable). */
export function songToProject(song) {
  if (song.project) return JSON.parse(JSON.stringify(song.project));
  const first = song.sections.find((s) => s.type === 'full') || song.sections[0];
  const verses = song.sections.filter((s) => s.type === 'full' || s.type === 'drop');
  const last = verses[verses.length - 1] || first;
  const A = JSON.parse(JSON.stringify(first.tracks));
  const B = JSON.parse(JSON.stringify(last.tracks));
  for (const pat of [A, B]) for (const id of TRACK_ORDER) pat[id].mods = { level: pat[id].mods?.level || 0, echo: !!pat[id].mods?.echo };
  const h = first.harmony;
  const prog = PROGRESSIONS.find((pr) => JSON.stringify(pr.a) === JSON.stringify(h.prog)) || PROGRESSIONS[0];
  // arrangement : sections fusionnées par type/pattern, longueurs bornées
  const arrangement = [];
  for (const s of song.sections) {
    const pattern = sameTracks(s.tracks, last.tracks) && !sameTracks(s.tracks, first.tracks) ? 'B' : 'A';
    const prev = arrangement[arrangement.length - 1];
    if (prev && prev.type === s.type && prev.pattern === pattern && prev.bars + s.bars <= 16) prev.bars += s.bars;
    else arrangement.push({ type: s.type, pattern, bars: Math.min(16, s.bars) });
  }
  return {
    id: newSongId(), title: `${song.title} (remix)`, origin: 'studio', createdAt: Date.now(),
    style: first.style, root: h.root, mode: h.mode, progId: prog.id, bpm: first.bpm,
    patterns: { A, B }, arrangement: arrangement.slice(0, 24),
  };
}

/** Nouveau motif mélodique pour une piste du pattern (aide à la composition). */
export function regenerateMotif(pattern, trackId, seed) {
  const rng = new RNG(`motif:${seed}`);
  const t = pattern[trackId];
  const steps = [];
  t.steps.forEach((on, s) => { if (on) steps.push(s); });
  const motif = trackId === 'bass' ? bassMotif(rng, steps) : leadMotif(rng, steps);
  steps.forEach((s, i) => { t.pitch[s] = motif[i]; });
}

export { rootForPc, emptyPattern };
