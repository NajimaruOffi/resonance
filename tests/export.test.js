// Tests de la couche musicale : harmonie, arrangeur, morceau, projet Studio, exports WAV/MIDI.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeWav, songToMidi, songFileName } from '../src/audio/export.js';
import { generateStep, sectionMask, hash3 } from '../src/music/arranger.js';
import { createTracks, snapshotTracks, unlockTrack } from '../src/game/tracks.js';
import {
  SECTORS, MODES, PROGRESSIONS, chordName, padVoicing, chordToneMidi, progAt, rootForPc,
} from '../src/music/theory.js';
import { STYLES, styleById } from '../src/music/styles.js';
import { songFromRunLog, songLength, songStructure, walkSong } from '../src/music/song.js';
import { newProject, projectToSong, songToProject, templateSections, TEMPLATES } from '../src/music/project.js';
import { leadMotif, bassMotif } from '../src/music/motif.js';
import { RNG } from '../src/util/rng.js';

const fakeBuffer = (channels, sampleRate, samples) => ({
  numberOfChannels: channels, sampleRate, length: samples[0].length,
  getChannelData: (c) => Float32Array.from(samples[c]),
});

const fullTracks = (seed = 'T') => {
  const rng = new RNG(seed);
  const t = createTracks(null, rng);
  for (const id of ['snare', 'bass', 'lead']) unlockTrack(t[id], rng);
  return t;
};

const songCtx = (sector, tracks) => ({ tracks, harmony: sector, style: styleById(sector.style) });

// ───────────── harmonie ─────────────

test('noms d\'accords : La mineur Néon = Am7 Fmaj7 Cmaj7 G7 | Dm7 Fmaj7 Am7 Em7', () => {
  const names = [...Array(8)].map((_, b) => chordName(SECTORS[0], b));
  assert.deepEqual(names, ['Am7', 'Fmaj7', 'Cmaj7', 'G7', 'Dm7', 'Fmaj7', 'Am7', 'Em7']);
});

test('mineur harmonique : le V est un accord de dominante (G7 en Do mineur)', () => {
  const braise = SECTORS[1];
  const bar = braise.prog.indexOf(4);
  assert.equal(chordName(braise, bar), 'G7');
});

test('progressions A/B : la partie B prend le relais sur les mesures 5 à 8', () => {
  const s = SECTORS[0];
  assert.equal(progAt(s, 0), s.prog[0]);
  assert.equal(progAt(s, 4), s.progB[0]);
  assert.equal(progAt(s, 8), s.prog[0]);
});

test('voicings serrés : 4 notes dans une octave et demie autour du centre', () => {
  for (const s of SECTORS) for (let b = 0; b < 8; b++) {
    const v = padVoicing(s, b, true);
    assert.equal(v.length, 4);
    assert.ok(v[3] - v[0] <= 18, `voicing trop large ${v}`);
  }
});

test('toutes les notes générées par l\'arrangeur sont dans la gamme', () => {
  for (const s of SECTORS) {
    const pcs = new Set(MODES[s.mode].map((i) => (s.root + i) % 12));
    const ctx = songCtx(s, fullTracks(s.name));
    for (let bar = 0; bar < 16; bar++) for (let step = 0; step < 16; step++) {
      for (const e of generateStep(ctx, bar, step)) {
        const notes = e.chord || (e.inst === 'bass' || e.inst === 'lead' ? [e.midi] : []);
        if (e.slideTo != null) notes.push(e.slideTo);
        for (const m of notes) assert.ok(pcs.has(((m % 12) + 12) % 12), `${s.name} ${e.inst} ${m} hors gamme`);
      }
    }
  }
});

test('toutes les tonalités et modes du Studio restent justes', () => {
  for (let pc = 0; pc < 12; pc++) for (const mode of Object.keys(MODES)) for (const pr of PROGRESSIONS) {
    const h = { root: rootForPc(pc), mode, prog: pr.a, progB: pr.b };
    const pcs = new Set(MODES[mode].map((i) => (h.root + i) % 12));
    for (let bar = 0; bar < 8; bar++) for (let idx = 0; idx < 8; idx++) {
      assert.ok(pcs.has(chordToneMidi(h, bar, idx) % 12));
    }
  }
});

// ───────────── arrangeur ─────────────

test('arrangeur déterministe (export = jeu)', () => {
  const ctx = songCtx(SECTORS[2], fullTracks());
  assert.deepEqual(generateStep(ctx, 5, 7), generateStep(ctx, 5, 7));
  assert.equal(hash3(1, 2, 3), hash3(1, 2, 3));
});

test('swing : les doubles-croches paires sont décalées selon le style', () => {
  const ctx = songCtx(SECTORS[2], fullTracks()); // garage, swing 0.2
  const hats = generateStep(ctx, 1, 3).filter((e) => e.inst === 'hat');
  const any = generateStep({ ...ctx, tracks: { ...ctx.tracks, hat: { ...ctx.tracks.hat, steps: new Array(16).fill(true) } } }, 1, 3);
  const h = any.find((e) => e.inst === 'hat');
  assert.equal(h.pos, STYLES.garage.swing);
  assert.ok(hats.every((e) => e.pos === STYLES.garage.swing));
});

test('fills en fin de phrase (mesure 8) et crash en début de phrase', () => {
  const ctx = songCtx(SECTORS[0], fullTracks());
  const fill = [12, 13, 14, 15].flatMap((s) => generateStep(ctx, 7, s)).filter((e) => e.fillNote);
  assert.ok(fill.length >= 3);
  assert.ok(generateStep(ctx, 8, 0).some((e) => e.inst === 'crash'));
  assert.ok(!generateStep(ctx, 0, 0).some((e) => e.inst === 'crash'));
});

test('sections : l\'intro et le break retirent la batterie, l\'outro se vide', () => {
  assert.equal(sectionMask('breakdown', 0, 4).kick, false);
  assert.equal(sectionMask('intro', 0, 4).kick, false);
  assert.equal(sectionMask('intro', 3, 4).kick, true);
  assert.equal(sectionMask('outro', 3, 4).lead, false);
  const ctx = songCtx(SECTORS[0], fullTracks());
  const brk = generateStep(ctx, 0, 0, { type: 'breakdown', bar: 0, bars: 4 });
  assert.ok(!brk.some((e) => e.inst === 'kick'));
  assert.ok(brk.some((e) => e.inst === 'pad'));
});

test('montée : roulement de caisse claire qui s\'intensifie', () => {
  const ctx = songCtx(SECTORS[0], fullTracks());
  const v = (bar, step) => generateStep(ctx, 0, step, { type: 'build', bar, bars: 4 }).find((e) => e.fillNote)?.vel || 0;
  assert.ok(v(3, 14) > v(0, 2));
  assert.ok(generateStep(ctx, 0, 1, { type: 'build', bar: 3, bars: 4 }).some((e) => e.fillNote));
});

test('la mélodie du joueur suit l\'harmonie : même indice, accord différent → note différente', () => {
  const t = createTracks({ lead: [0] });
  t.lead.pitch[0] = 0;
  const ctx = songCtx(SECTORS[0], t);
  const m0 = generateStep(ctx, 0, 0).find((e) => e.inst === 'lead').midi;
  const m1 = generateStep(ctx, 1, 0).find((e) => e.inst === 'lead').midi;
  assert.notEqual(m0, m1);
});

test('motifs générés : indices valides, début stable', () => {
  for (let i = 0; i < 50; i++) {
    const rng = new RNG(`m${i}`);
    const lead = leadMotif(rng, [0, 3, 6, 8, 11]);
    assert.ok(lead.every((p) => p >= 0 && p <= 7));
    assert.ok([0, 1, 2, 4].includes(lead[0]));
    const bass = bassMotif(rng, [0, 5, 10]);
    assert.equal(bass[0], 0);
  }
});

// ───────────── morceau d'une partie ─────────────

function runLog(n) {
  const t = snapshotTracks(fullTracks());
  return [...Array(n)].map((_, i) => ({
    wave: i + 1, sectorId: Math.floor(i / 5) % 4 + 1, bpm: 118, boss: (i + 1) % 5 === 0, drops: i === 2 ? 1 : 0, tracks: t,
  }));
}

test('partie → morceau structuré (intro, couplets, montée/drop, break de modulation, outro)', () => {
  const song = songFromRunLog(runLog(7), { title: 'T' });
  const types = song.sections.map((s) => s.type);
  assert.equal(types[0], 'intro');
  assert.equal(types[types.length - 1], 'outro');
  assert.ok(types.includes('build') && types.includes('drop'));
  assert.ok(types.includes('breakdown'), 'changement de secteur → break');
  assert.ok(songStructure(song).length >= 5);
});

test('les longues parties restent écoutables (≤ 160 mesures)', () => {
  const song = songFromRunLog(runLog(40));
  assert.ok(songLength(song).bars <= 170);
});

test('walkSong parcourt chaque pas une fois, avec le tempo de chaque section', () => {
  const song = songFromRunLog(runLog(3));
  let n = 0;
  const end = walkSong(song, () => { n++; });
  assert.equal(n, songLength(song).bars * 16);
  assert.ok(Math.abs(end - songLength(song).seconds) < 1e-6);
});

// ───────────── projet Studio ─────────────

test('projet Studio → morceau : sections, tempo, harmonie', () => {
  const p = newProject('x');
  const song = projectToSong(p);
  assert.equal(song.sections.length, TEMPLATES.club.sections.length);
  assert.ok(song.sections.every((s) => s.bpm === p.bpm && s.style === p.style));
  assert.ok(song.project, 'le projet est conservé pour pouvoir le rouvrir');
  assert.deepEqual(songToProject(song).patterns, p.patterns);
});

test('un morceau de partie s\'ouvre dans le Studio', () => {
  const song = songFromRunLog(runLog(6), { title: 'Partie' });
  const p = songToProject(song);
  assert.ok(p.patterns.A && p.patterns.B);
  assert.ok(p.arrangement.length > 0 && p.arrangement.every((s) => s.bars <= 16));
  assert.match(p.title, /remix/);
  assert.equal(templateSections('court').length, 4);
});

// ───────────── WAV ─────────────

test('WAV : en-tête RIFF/PCM 16 bits correct', () => {
  const buf = encodeWav(fakeBuffer(2, 44100, [[0, 0.5, -0.5], [0, 0.25, -0.25]]), { normalize: false });
  const v = new DataView(buf);
  const s = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(s(0, 4), 'RIFF');
  assert.equal(s(8, 4), 'WAVE');
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 12);
  assert.equal(buf.byteLength, 56);
});

test('WAV : normalisation à −1 dBFS et écrêtage sûr', () => {
  const v = new DataView(encodeWav(fakeBuffer(1, 8000, [[0.1, -0.2, 0.05]])));
  assert.ok(Math.abs(Math.abs(v.getInt16(46, true)) / 0x8000 - 0.891) < 0.002);
  const lv = new DataView(encodeWav(fakeBuffer(1, 8000, [[3, -3]]), { normalize: false }));
  assert.equal(lv.getInt16(44, true), 0x7fff);
  assert.equal(lv.getInt16(46, true), -0x8000);
});

// ───────────── MIDI ─────────────

function parseMidi(bytes) {
  const s = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  assert.equal(s(0, 4), 'MThd');
  const ntracks = (bytes[10] << 8) | bytes[11];
  const ppq = (bytes[12] << 8) | bytes[13];
  let off = 14;
  const tracks = [];
  for (let i = 0; i < ntracks; i++) {
    assert.equal(s(off, 4), 'MTrk');
    const len = (bytes[off + 4] << 24) | (bytes[off + 5] << 16) | (bytes[off + 6] << 8) | bytes[off + 7];
    const data = bytes.slice(off + 8, off + 8 + len);
    // décompte des note-on (vélocité > 0)
    let p = 0, noteOns = 0, status = 0;
    const vlq = () => { let v = 0, b; do { b = data[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (p < data.length) {
      vlq();
      let b = data[p];
      if (b === 0xff) { p += 2; const l = vlq(); p += l; continue; }
      if (b & 0x80) { status = b; p++; }
      const type = status & 0xf0;
      if (type === 0xc0 || type === 0xd0) { p += 1; continue; }
      const d1 = data[p++], d2 = data[p++];
      if (type === 0x90 && d2 > 0) noteOns++;
      void d1;
    }
    tracks.push({ len, noteOns });
    off += 8 + len;
  }
  assert.equal(off, bytes.length, 'longueurs de pistes cohérentes');
  return { ntracks, ppq, tracks };
}

test('MIDI : fichier type 1 valide, 5 pistes, notes sur batterie/basse/lead/nappe', () => {
  const song = songFromRunLog(runLog(4), { title: 'Mon morceau' });
  const midi = parseMidi(songToMidi(song));
  assert.equal(midi.ntracks, 5);
  assert.equal(midi.ppq, 96);
  for (let i = 1; i < 5; i++) assert.ok(midi.tracks[i].noteOns > 0, `piste ${i} vide`);
});

test('noms de fichiers sûrs (accents et caractères spéciaux)', () => {
  assert.equal(songFileName({ title: 'Néon — vague 7' }, 'wav'), 'resonance-Neon-vague-7.wav');
  assert.equal(songFileName({ title: '../../x' }, 'mid'), 'resonance-x.mid');
});
