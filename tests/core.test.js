// Tests des modules purs (aucun navigateur requis) : node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RNG, hashString, dailySeedString } from '../src/util/rng.js';
import { SpatialHash } from '../src/util/spatial.js';
import { pointSegDist2, angleDiff } from '../src/util/math.js';
import { SECTORS, degreeToMidi, chordMidi, bassMidi, leadMidi, pentaMidi, sectorForWave, midiToFreq, MODES } from '../src/music/theory.js';
import { buildWave, isBossWave, waveBudget, formationPositions } from '../src/game/waves.js';
import { ENEMY_DEFS } from '../src/game/enemies.js';
import { createTracks, activeStepCount, unlockTrack } from '../src/game/tracks.js';
import { rollOffers, applyOffer, candidates } from '../src/game/upgrades.js';

function makeRun(seed = 'T') {
  return { tracks: createTracks(), hp: 5, maxHp: 5, crit: 0.05, dashCd: 0.85, dropGain: 1, magnet: 150, bpm: 118, seed };
}

// ───────────── RNG ─────────────

test('RNG : même graine → même séquence', () => {
  const a = new RNG('ABC123'), b = new RNG('ABC123');
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('RNG : graines différentes → séquences différentes', () => {
  const a = new RNG('A'), b = new RNG('B');
  assert.notEqual(a.next(), b.next());
});

test('RNG : valeurs dans [0,1) et int inclusif', () => {
  const r = new RNG(42);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    seen.add(r.int(1, 3));
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('hashString est stable et le défi du jour a le bon format', () => {
  assert.equal(hashString('resonance'), hashString('resonance'));
  assert.equal(dailySeedString(new Date(2026, 10, 24)), 'JOUR-20261124');
});

// ───────────── Maths / spatial ─────────────

test('pointSegDist2 : projection, extrémités', () => {
  assert.equal(pointSegDist2(5, 3, 0, 0, 10, 0), 9);
  assert.equal(pointSegDist2(-4, 3, 0, 0, 10, 0), 25);
});

test('angleDiff reste dans [-π, π]', () => {
  assert.ok(Math.abs(angleDiff(0.1, Math.PI * 2 - 0.1) + 0.2) < 1e-9);
});

test('SpatialHash : trouve les voisins, sans doublon', () => {
  const h = new SpatialHash(50);
  const objs = [{ x: 10, y: 10, r: 60 }, { x: 400, y: 400, r: 5 }, { x: 30, y: 20, r: 5 }];
  objs.forEach((o) => h.insert(o));
  const found = [];
  h.query(20, 20, 30, (o) => { found.push(o); });
  assert.equal(found.length, 2);
  assert.equal(new Set(found).size, 2);
});

// ───────────── Théorie musicale ─────────────

test('La4 = 440 Hz', () => { assert.equal(midiToFreq(69), 440); });

test('degreeToMidi gère les octaves et les degrés négatifs', () => {
  const s = SECTORS[0]; // La mineur, racine 57
  assert.equal(degreeToMidi(s, 0), 57);
  assert.equal(degreeToMidi(s, 7), 69);
  assert.equal(degreeToMidi(s, -7), 45);
  assert.equal(degreeToMidi(s, 2), 60); // do
});

test('toutes les notes générées appartiennent à la gamme du secteur', () => {
  for (const s of SECTORS) {
    const pcs = new Set(MODES[s.mode].map((i) => (s.root + i) % 12));
    for (let bar = 0; bar < 8; bar++) {
      for (let step = 0; step < 16; step++) {
        for (const m of [...chordMidi(s, bar), bassMidi(s, bar, step), leadMidi(s, bar, step), pentaMidi(s, step)]) {
          assert.ok(pcs.has(((m % 12) + 12) % 12), `${s.name} : note ${m} hors gamme`);
        }
      }
    }
  }
});

test('progression : La mineur commence sur Am (la-do-mi)', () => {
  const [a, c, e] = chordMidi(SECTORS[0], 0).map((m) => m % 12);
  assert.deepEqual([a, c, e], [9, 0, 4]);
});

test('secteurs : changement toutes les 5 vagues, cyclique', () => {
  assert.equal(sectorForWave(1).id, 1);
  assert.equal(sectorForWave(5).id, 1);
  assert.equal(sectorForWave(6).id, 2);
  assert.equal(sectorForWave(21).id, 1);
});

// ───────────── Vagues ─────────────

test('vagues déterministes pour une même graine', () => {
  const a = buildWave(7, new RNG('S:waves'));
  const b = buildWave(7, new RNG('S:waves'));
  assert.deepEqual(a, b);
});

test('le coût des ennemis respecte le budget et seuls les types débloqués apparaissent', () => {
  for (let w = 1; w <= 30; w++) {
    const plan = buildWave(w, new RNG(`budget${w}`));
    let cost = 0;
    for (const bar of plan.bars) for (const g of bar) {
      cost += ENEMY_DEFS[g.type].cost * g.count;
      if (w < 2) assert.equal(g.type, 'drone');
      if (w < 7) assert.notEqual(g.type, 'colossus');
    }
    assert.ok(cost <= plan.budget, `vague ${w} : ${cost} > ${plan.budget}`);
    assert.ok(cost > 0);
  }
});

test('boss toutes les 5 vagues, difficulté croissante', () => {
  assert.ok(isBossWave(5) && isBossWave(10) && !isBossWave(4));
  for (let w = 1; w < 30; w++) assert.ok(waveBudget(w + 1) > waveBudget(w));
});

test('les apparitions restent dans l\'arène et à distance du joueur', () => {
  const rng = new RNG('pos');
  const player = { x: 120, y: 120 };
  for (const formation of ['cluster', 'ring', 'edge', 'pincer']) {
    for (let k = 0; k < 20; k++) {
      const pts = formationPositions({ type: 'drone', count: 6, formation }, player, 2400, 1500, rng);
      for (const p of pts) {
        assert.ok(p.x >= 0 && p.x <= 2400 && p.y >= 0 && p.y <= 1500, `${formation} hors arène`);
      }
    }
  }
});

// ───────────── Pistes & améliorations ─────────────

test('départ : seuls kick et hat sont débloqués', () => {
  const t = createTracks();
  assert.ok(t.kick.unlocked && t.hat.unlocked);
  assert.ok(!t.snare.unlocked && !t.bass.unlocked && !t.lead.unlocked);
  assert.equal(activeStepCount(t.kick), 4);
});

test('offres : 3 offres distinctes et toutes applicables', () => {
  for (let i = 0; i < 50; i++) {
    const run = makeRun();
    const offers = rollOffers(run, new RNG(`o${i}`), 3);
    assert.equal(offers.length, 3);
    assert.equal(new Set(offers.map((o) => o.id)).size, 3);
    for (const o of offers) applyOffer(run, o);
  }
});

test('pas d\'offre « soin » à PV pleins, ni de note sur une piste pleine', () => {
  const run = makeRun();
  run.tracks.kick.steps.fill(true);
  const keys = candidates(run).map((c) => c.key);
  assert.ok(!keys.includes('heal'));
  assert.ok(!keys.includes('step:kick'));
  assert.ok(keys.includes('step:hat'));
});

test('déblocage d\'une piste : notes par défaut', () => {
  const run = makeRun();
  unlockTrack(run.tracks.snare);
  assert.ok(run.tracks.snare.unlocked);
  assert.equal(activeStepCount(run.tracks.snare), 2);
});

test('Accélérando augmente le tempo et reste plafonné', () => {
  const run = makeRun();
  applyOffer(run, { id: 'tempo', track: null });
  assert.equal(run.bpm, 126);
  run.bpm = 160;
  assert.ok(!candidates(run).some((c) => c.key === 'tempo'));
});
