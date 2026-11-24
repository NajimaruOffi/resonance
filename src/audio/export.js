// Exports : rendu audio hors-ligne (.wav) et partition multipiste (.mid).
// Les deux parcourent le morceau avec le MÊME arrangeur que le jeu.

import { AudioEngine } from './engine.js';
import { generateStep, playEvents } from '../music/arranger.js';
import { padVoicing } from '../music/theory.js';
import { styleById } from '../music/styles.js';
import { walkSong } from '../music/song.js';

const SAMPLE_RATE = 44100;
const TAIL = 4;

const songCtx = (section) => ({
  tracks: section.tracks, harmony: section.harmony, style: styleById(section.style), boss: !!section.boss,
});

// ───────────────────────────── audio ─────────────────────────────

/**
 * Rend le morceau complet. Effets de section : intro filtrée, montée (riser + filtre),
 * impact du drop, break assourdi, fondu de l'outro, accord final.
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSong(song, { onProgress } = {}) {
  const start = 0.05;
  // 1) liste des pas (données légères) — 2) planification audio tranche par tranche.
  // Planifier tout le morceau d'un coup créerait des milliers de nœuds dès le départ et le
  // coût de rendu deviendrait quadratique ; par tranches de 2 s, il reste linéaire.
  const items = [];
  const end = walkSong(song, (it) => items.push(it), start);
  const total = end + TAIL;
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * total), SAMPLE_RATE);
  const eng = new AudioEngine();
  eng.volume = 0.8;
  eng.collectable = [];
  eng.init(ctx);
  const f = eng.masterFilter.frequency;
  f.setValueAtTime(20000, 0);

  let lastSection = -1;
  const scheduleItem = ({ section, sIndex, bar, sectionBar, step, time, stepDur }) => {
    if (sIndex !== lastSection) {
      lastSection = sIndex;
      const dur = section.bars * 16 * stepDur;
      for (const d of [eng.delayL, eng.delayR]) d.delayTime.setValueAtTime(stepDur * 3, time);
      f.cancelScheduledValues(time);
      switch (section.type) {
        case 'intro':
          f.setValueAtTime(300, time);
          f.exponentialRampToValueAtTime(20000, time + dur);
          break;
        case 'build':
          f.setValueAtTime(900, time);
          f.exponentialRampToValueAtTime(20000, time + dur);
          eng.riser(time, dur);
          break;
        case 'breakdown':
          f.setValueAtTime(20000, time);
          f.exponentialRampToValueAtTime(2200, time + dur * 0.3);
          f.setValueAtTime(2200, time + dur * 0.75);
          f.exponentialRampToValueAtTime(20000, time + dur);
          break;
        case 'drop':
          f.setValueAtTime(20000, time);
          eng.dropImpact(time);
          break;
        default:
          f.setValueAtTime(20000, time);
      }
    }
    const sc = songCtx(section);
    const events = generateStep(sc, bar, step, { type: section.type, bar: sectionBar, bars: section.bars });
    playEvents(eng, events, time, stepDur, sc.style);
  };

  let idx = 0;
  const scheduleUntil = (limit) => {
    while (idx < items.length && items[idx].time < limit) scheduleItem(items[idx++]);
  };
  const scheduleEnding = () => {
    // Accord final tenu + grosse caisse, puis la réverbe s'éteint
    const last = song.sections[song.sections.length - 1];
    const lastStyle = styleById(last.style);
    eng.kick(end, 1, lastStyle.kick);
    eng.crash(end, 0.8);
    eng.pad(end, padVoicing(last.harmony, 0, lastStyle.sevenths), TAIL * 0.8, 1.6, lastStyle.pad);
    eng.master.gain.setValueAtTime(eng.volume, end + TAIL * 0.4);
    eng.master.gain.linearRampToValueAtTime(0, end + TAIL - 0.05);
  };

  const CHUNK = 2;
  const AHEAD = 0.5;
  scheduleUntil(CHUNK + AHEAD);
  let endingScheduled = false;
  for (let t = CHUNK; t < total; t += CHUNK) {
    ctx.suspend(t).then(() => {
      eng.collect(t);
      scheduleUntil(t + CHUNK + AHEAD);
      if (!endingScheduled && t + CHUNK + AHEAD >= end) { scheduleEnding(); endingScheduled = true; }
      onProgress?.(t / total);
      ctx.resume();
    });
  }
  if (CHUNK + AHEAD >= end) { scheduleEnding(); endingScheduled = true; }
  const buffer = await ctx.startRendering();
  onProgress?.(1);
  return buffer;
}

/**
 * Encode des canaux PCM flottants en WAV 16 bits, normalisé à −1 dBFS.
 * @param {{ numberOfChannels:number, sampleRate:number, length:number, getChannelData:(c:number)=>Float32Array }} buffer
 * @returns {ArrayBuffer}
 */
export function encodeWav(buffer, { normalize = true } = {}) {
  const ch = buffer.numberOfChannels;
  const n = buffer.length;
  const data = [];
  let peak = 0;
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    data.push(d);
    for (let i = 0; i < n; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  const gain = normalize && peak > 0 ? 0.891 / peak : 1; // −1 dBFS

  const blockAlign = ch * 2;
  const dataSize = n * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const v = new DataView(out);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let s = data[c][i] * gain;
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return out;
}

// ───────────────────────────── MIDI ─────────────────────────────

const PPQ = 96;
const TICKS_PER_STEP = PPQ / 4;
const GM_DRUMS = { kick: 36, rim: 37, snare: 38, clap: 39, hat: 42, openHat: 46, crash: 49 };

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

function trackChunk(events) {
  // events: { tick, data: number[] } — triés, delta-temps encodés
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes = [];
  let last = 0;
  for (const e of events) {
    bytes.push(...varLen(Math.max(0, e.tick - last)), ...e.data);
    last = e.tick;
  }
  bytes.push(0x00, 0xff, 0x2f, 0x00);
  const len = bytes.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...bytes];
}

const textMeta = (type, text) => {
  const b = Array.from(new TextEncoder().encode(text));
  return [0xff, type, ...varLen(b.length), ...b];
};

/**
 * Partition MIDI type 1 : tempo/structure, batterie (canal 10 GM), basse, lead, nappe.
 * Les sections sont marquées (marqueurs MIDI) et les changements de tempo conservés.
 * @returns {Uint8Array}
 */
export function songToMidi(song) {
  const meta = [], drums = [], bass = [], lead = [], pad = [];
  const note = (list, ch, tick, midi, vel, durTicks) => {
    const v = Math.max(1, Math.min(127, Math.round(vel * 100)));
    const m = Math.max(0, Math.min(127, Math.round(midi)));
    list.push({ tick, order: 1, data: [0x90 | ch, m, v] });
    list.push({ tick: tick + Math.max(1, Math.round(durTicks)), order: 0, data: [0x80 | ch, m, 0] });
  };

  meta.push({ tick: 0, order: 0, data: textMeta(0x03, song.title || 'Résonance') });
  meta.push({ tick: 0, order: 0, data: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] }); // 4/4
  const program = (list, ch, prog, name) => {
    list.push({ tick: 0, order: 0, data: textMeta(0x03, name) });
    if (ch !== 9) list.push({ tick: 0, order: 0, data: [0xc0 | ch, prog] });
  };
  program(drums, 9, 0, 'Batterie');
  program(bass, 0, 38, 'Basse');
  program(lead, 1, 81, 'Lead');
  program(pad, 2, 89, 'Nappe');

  let absStep = 0, lastSection = -1;
  walkSong(song, ({ section, sIndex, bar, sectionBar, step }) => {
    const tick0 = absStep * TICKS_PER_STEP;
    if (sIndex !== lastSection) {
      lastSection = sIndex;
      const mpq = Math.round(60000000 / section.bpm);
      meta.push({ tick: tick0, order: 0, data: [0xff, 0x51, 0x03, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255] });
      meta.push({ tick: tick0, order: 0, data: textMeta(0x06, section.type) });
    }
    const sc = songCtx(section);
    const events = generateStep(sc, bar, step, { type: section.type, bar: sectionBar, bars: section.bars });
    for (const e of events) {
      const tick = Math.round((absStep + e.pos) * TICKS_PER_STEP);
      switch (e.inst) {
        case 'kick': note(drums, 9, tick, GM_DRUMS.kick, e.vel, 12); break;
        case 'snare': {
          const n = e.rim ? GM_DRUMS.rim : sc.style.snare.type === 'clap' ? GM_DRUMS.clap : sc.style.snare.type === 'rim' ? GM_DRUMS.rim : GM_DRUMS.snare;
          note(drums, 9, tick, n, e.vel, 12);
          break;
        }
        case 'hat': note(drums, 9, tick, e.open ? GM_DRUMS.openHat : GM_DRUMS.hat, e.vel, 12); break;
        case 'tom': note(drums, 9, tick, e.midi, e.vel, 12); break;
        case 'crash': note(drums, 9, tick, GM_DRUMS.crash, e.vel, 48); break;
        case 'bass': note(bass, 0, tick, e.midi, e.vel, e.dur * TICKS_PER_STEP); break;
        case 'lead': note(lead, 1, tick, e.midi, e.vel, e.dur * TICKS_PER_STEP); break;
        case 'pad': for (const m of e.chord) note(pad, 2, tick, m, e.vel * 0.7, 16 * TICKS_PER_STEP - 2); break;
      }
    }
    absStep++;
  });

  const tracks = [meta, drums, bass, lead, pad].map(trackChunk);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
  return Uint8Array.from([...header, ...tracks.flat()]);
}

// ───────────────────────────── téléchargement ─────────────────────────────

export function songFileName(song, ext) {
  const safe = String(song.title || 'morceau').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'morceau';
  return `resonance-${safe}.${ext}`;
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadSongWav(song) {
  const buffer = await renderSong(song);
  const blob = new Blob([encodeWav(buffer)], { type: 'audio/wav' });
  downloadBlob(blob, songFileName(song, 'wav'));
  return { bytes: blob.size, seconds: buffer.duration };
}

export function downloadSongMidi(song) {
  const bytes = songToMidi(song);
  downloadBlob(new Blob([bytes], { type: 'audio/midi' }), songFileName(song, 'mid'));
  return { bytes: bytes.length };
}
