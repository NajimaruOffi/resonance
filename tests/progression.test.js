// Tests de la méta-progression : niveaux, kits, studio, intensité, succès, fin de partie.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultProfile, normalizeProfile, levelInfo, xpToNext, KITS, kitUnlocked, GEAR, buyGear, gearLevel,
  gearNextCost, intensityMods, runSetup, ACHIEVEMENTS, unlockAchievements, finishRun, runRewards, MAX_INTENSITY,
} from '../src/meta/progression.js';
import { createTracks, activeStepCount } from '../src/game/tracks.js';

const baseStats = (over = {}) => ({
  score: 0, wave: 1, kills: 0, perfects: 0, maxCombo: 0, drops: 0, bosses: 0, bossNoHit: false,
  bpm: 118, tracksUnlocked: 2, fullTrack: false, intensity: 0, kit: 'classic', daily: false, seed: 'X', seconds: 60,
  ...over,
});

test('courbe d\'XP : niveaux croissants et cohérents', () => {
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(xpToNext(1) - 1).level, 1);
  assert.equal(levelInfo(xpToNext(1)).level, 2);
  assert.equal(levelInfo(xpToNext(1) + xpToNext(2)).level, 3);
  for (let l = 1; l < 20; l++) assert.ok(xpToNext(l + 1) > xpToNext(l));
});

test('profil : normalisation d\'une sauvegarde partielle ou corrompue', () => {
  assert.deepEqual(normalizeProfile(null), defaultProfile());
  const p = normalizeProfile({ xp: 500, totals: { runs: 3 } });
  assert.equal(p.xp, 500);
  assert.equal(p.totals.runs, 3);
  assert.equal(p.totals.kills, 0);
  assert.deepEqual(p.gear, {});
});

test('kits : seul Classique est disponible au départ, niveaux croissants', () => {
  const p = defaultProfile();
  assert.deepEqual(KITS.filter((k) => kitUnlocked(k, p)).map((k) => k.id), ['classic']);
  for (let i = 1; i < KITS.length; i++) assert.ok(KITS[i].level > KITS[i - 1].level);
});

test('kits : les pistes de départ sont appliquées', () => {
  for (const kit of KITS) {
    const t = createTracks(kit.tracks);
    for (const [id, steps] of Object.entries(kit.tracks)) {
      assert.ok(t[id].unlocked, `${kit.id}/${id}`);
      assert.equal(activeStepCount(t[id]), steps.length);
    }
    const unlocked = Object.values(t).filter((x) => x.unlocked).length;
    assert.equal(unlocked, Object.keys(kit.tracks).length);
  }
});

test('studio : achat, coût progressif, niveau max, fonds insuffisants', () => {
  const p = defaultProfile();
  assert.equal(buyGear(p, 'armor'), false);
  p.echoes = 10000;
  const armor = GEAR.find((g) => g.id === 'armor');
  for (let i = 0; i < armor.costs.length; i++) assert.ok(buyGear(p, 'armor'));
  assert.equal(gearLevel(p, 'armor'), armor.costs.length);
  assert.equal(gearNextCost(p, 'armor'), null);
  assert.equal(buyGear(p, 'armor'), false);
  assert.equal(p.echoes, 10000 - armor.costs.reduce((a, b) => a + b, 0));
});

test('configuration de partie : studio + intensité + kit', () => {
  const p = defaultProfile();
  p.gear = { armor: 2, preamp: 3, mixer: 1, remix: 1, capacitor: 1 };
  const s = runSetup(p, 'minimal', 4);
  assert.equal(s.maxHp, 5 + 2 - 1); // blindage +2, intensité 4 : −1
  assert.ok(Math.abs(s.dmgMul - 1.24) < 1e-9);
  assert.equal(s.offerCount, 3 + 1 + 1); // table de mixage + kit Minimal
  assert.equal(s.rerolls, 1);
  assert.equal(s.dropStart, 0.25);
  assert.equal(s.startBpm, 124);
});

test('intensité : modificateurs cumulatifs et monotones', () => {
  const m0 = intensityMods(0);
  assert.equal(m0.enemyHp, 1);
  assert.equal(m0.noHeal, false);
  let prev = m0;
  for (let n = 1; n <= MAX_INTENSITY; n++) {
    const m = intensityMods(n);
    assert.ok(m.enemyHp >= prev.enemyHp && m.enemySpeed >= prev.enemySpeed && m.budget >= prev.budget);
    prev = m;
  }
  assert.equal(intensityMods(8).noHeal, true);
});

test('succès : identifiants uniques, récompenses positives', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of ACHIEVEMENTS) assert.ok(a.reward > 0);
});

test('succès : débloqués une seule fois, Échos crédités, « fin de partie » réservés à la fin', () => {
  const p = defaultProfile();
  const got = unlockAchievements(p, baseStats({ wave: 10, bosses: 1 }), false);
  const ids = got.map((a) => a.id);
  assert.ok(ids.includes('w5') && ids.includes('w10') && ids.includes('boss'));
  assert.ok(!ids.includes('first'));
  assert.equal(p.echoes, got.reduce((n, a) => n + a.reward, 0));
  assert.equal(unlockAchievements(p, baseStats({ wave: 10, bosses: 1 }), false).length, 0);
  assert.ok(unlockAchievements(p, baseStats(), true).some((a) => a.id === 'first'));
});

test('récompenses : l\'intensité multiplie les gains', () => {
  const a = runRewards(baseStats({ score: 20000, wave: 8, bosses: 1 }));
  const b = runRewards(baseStats({ score: 20000, wave: 8, bosses: 1, intensity: 5 }));
  assert.ok(b.xp > a.xp && b.echoes > a.echoes);
  assert.equal(b.mult, 2);
});

test('fin de partie : XP, totaux, kits débloqués, intensité suivante', () => {
  const p = defaultProfile();
  const r = finishRun(p, baseStats({ score: 60000, wave: 10, bosses: 2, kills: 400, perfects: 20 }));
  assert.ok(r.xp > 0 && p.xp === r.xp);
  assert.equal(p.totals.runs, 1);
  assert.equal(p.totals.kills, 400);
  assert.ok(r.levelsGained >= 1);
  assert.ok(r.newKits.length >= 1, 'une grosse partie débloque au moins un kit');
  assert.equal(p.intensityUnlocked, 1);
  assert.ok(r.intensityUp);
  assert.deepEqual(p.kitsWave5, ['classic']);
  assert.equal(p.bests.classic, 10);
});

test('fin de partie : l\'intensité ne se débloque que depuis le palier maximal atteint', () => {
  const p = defaultProfile();
  p.intensityUnlocked = 3;
  finishRun(p, baseStats({ wave: 12, intensity: 1 }));
  assert.equal(p.intensityUnlocked, 3);
  finishRun(p, baseStats({ wave: 10, intensity: 3 }));
  assert.equal(p.intensityUnlocked, 4);
});

test('une première partie moyenne fait progresser sensiblement le niveau', () => {
  const p = defaultProfile();
  const r = finishRun(p, baseStats({ score: 6000, wave: 4, kills: 60, perfects: 3 }));
  assert.ok(r.after.ratio > 0.4 || r.levelsGained > 0, `progression trop lente : ${r.xp} XP`);
});
