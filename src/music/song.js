// Modèle de morceau (sérialisable) : une suite de sections autonomes.
//   section = { type, bars, bpm, harmony: {root, mode, prog, progB}, style: id, tracks: instantané, boss? }
// Un morceau vient soit d'une partie (journal des vagues), soit du mode Création.
// Le même modèle alimente le rendu audio, l'export MIDI et la discothèque.

import { sectorById } from './theory.js';
import { SECTION_LABELS } from './arranger.js';

export const SONG_VERSION = 1;
const MAX_BARS = 160;

export const harmonyOf = (h) => ({ root: h.root, mode: h.mode, prog: [...h.prog], progB: [...(h.progB || h.prog)] });

export function newSongId() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Transforme le journal d'une partie en morceau structuré :
 * intro → une section par vague (le boss dure deux fois plus) → montée + drop là où tu as
 * déclenché un DROP → break qui module à chaque changement de secteur → outro.
 */
export function songFromRunLog(log, meta = {}) {
  if (!log || !log.length) return null;
  const sections = [];
  const sec = (type, bars, e) => {
    const sector = sectorById(e.sectorId);
    sections.push({
      type, bars, bpm: e.bpm, harmony: harmonyOf(sector), style: sector.style,
      tracks: e.tracks, boss: type === 'full' && !!e.boss, wave: e.wave,
    });
  };
  // longueur des couplets adaptée pour que le morceau reste écoutable (≤ 160 mesures)
  const extra = log.reduce((n, e, i) => n + (e.drops ? 8 : 0) + (i > 0 && e.sectorId !== log[i - 1].sectorId ? 4 : 0), 0);
  const bossCount = log.filter((e) => e.boss).length;
  const verseBars = 4 * log.length + 4 * bossCount + extra + 8 <= MAX_BARS ? 4 : 2;

  sec('intro', 4, log[0]);
  log.forEach((e, i) => {
    if (i > 0 && e.sectorId !== log[i - 1].sectorId) sec('breakdown', 4, e);
    sec('full', e.boss ? verseBars * 2 : verseBars, e);
    if (e.drops > 0) { sec('build', 4, e); sec('drop', 4, e); }
  });
  sec('outro', 4, log[log.length - 1]);

  return {
    version: SONG_VERSION,
    id: meta.id || newSongId(),
    title: meta.title || 'Sans titre',
    origin: meta.origin || 'run',
    createdAt: meta.createdAt || Date.now(),
    seed: meta.seed || null,
    stats: meta.stats || null,
    sections,
  };
}

/** Durée totale (secondes) et nombre de mesures. */
export function songLength(song) {
  let seconds = 0, bars = 0;
  for (const s of song.sections) { seconds += s.bars * (240 / s.bpm); bars += s.bars; }
  return { seconds, bars };
}

/** Résumé lisible de la structure : « Intro · Couplet ×5 · Montée · Drop · … ». */
export function songStructure(song) {
  const out = [];
  for (const s of song.sections) {
    const label = SECTION_LABELS[s.type] || s.type;
    const last = out[out.length - 1];
    if (last && last.label === label) last.n++;
    else out.push({ label, n: 1, type: s.type });
  }
  return out;
}

/**
 * Parcourt le morceau pas à pas en temps absolu.
 * cb({ section, sIndex, bar (global), sectionBar, step, time, stepDur })
 */
export function walkSong(song, cb, start = 0) {
  let time = start, bar = 0;
  song.sections.forEach((section, sIndex) => {
    const stepDur = 60 / section.bpm / 4;
    for (let sb = 0; sb < section.bars; sb++) {
      for (let step = 0; step < 16; step++) {
        cb({ section, sIndex, bar, sectionBar: sb, step, time, stepDur });
        time += stepDur;
      }
      bar++;
    }
  });
  return time;
}
