// Arrangeur : transforme l'état du séquenceur en événements musicaux.
//
// generateStep() est PUR et déterministe : il produit la liste des notes d'un pas (instrument,
// position fine en pas — swing compris —, vélocité, hauteur MIDI, durée…). Le même flux
// d'événements alimente le jeu (temps réel), l'export audio (hors-ligne) et l'export MIDI :
// ce que tu entends en jouant est exactement ce que tu télécharges.
//
// Ce que l'arrangeur ajoute à la grille brute du joueur :
//  - harmonie en deux parties (A/B) sur des phrases de 8 mesures, voicings conduits ;
//  - développement du motif (réponse sur la mesure 4, variation sur la 7) ;
//  - groove : swing du style, vélocités humanisées, notes fantômes de caisse claire ;
//  - ponctuation : fills en fin de phrase, crash en début de phrase, charleston ouvert ;
//  - basse : accents et glissés (303 / sub) vers la note suivante ;
//  - sections (intro, couplet, montée, drop, break, outro) qui ouvrent/ferment les instruments.

import { padVoicing, chordToneMidi } from './theory.js';
import { TRACK_ORDER } from '../game/tracks.js';

/** Hachage déterministe → [0, 1) (humanisation reproductible). */
export function hash3(a, b, c) {
  let x = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul((c | 0) + 1, 1274126177);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export const SECTION_LABELS = {
  full: 'Couplet', intro: 'Intro', breakdown: 'Break', build: 'Montée', drop: 'Drop', outro: 'Outro',
};

const ALL = { kick: true, snare: true, hat: true, bass: true, lead: true, pad: true, fills: true };

/** Instruments actifs selon la section et la mesure dans la section. */
export function sectionMask(type, sb, bars) {
  const last = bars - 1;
  switch (type) {
    case 'intro': {
      const half = sb >= Math.floor(bars / 2);
      return { kick: half, snare: false, hat: true, bass: half, lead: true, pad: true, fills: sb === last };
    }
    case 'breakdown':
      return { kick: false, snare: false, hat: sb === last, bass: false, lead: true, pad: true, fills: false };
    case 'build':
      return { kick: true, snare: false, hat: true, bass: sb < last, lead: true, pad: true, fills: false };
    case 'outro':
      return {
        kick: sb < last - 1, snare: sb < last - 1, hat: sb < last, bass: sb < last,
        lead: sb < last, pad: true, fills: false,
      };
    default:
      return ALL;
  }
}

const HAT_GROOVE = [1, 0.55, 0.78, 0.55];
const MOTIF_DEV = [0, 0, 0, 1, 0, 0, 2, 0]; // décalage (en tons de l'accord) par mesure de la phrase
const TOM_FILL = [50, 48, 45, 43]; // toms General MIDI (aigu → grave)

/** Prochain pas actif d'une piste dans la mesure (ou -1). */
function nextActive(track, step) {
  for (let s = step + 1; s < 16; s++) if (track.steps[s]) return s;
  return -1;
}

function melodicMidi(song, id, bar, step, pitchIdx) {
  if (id === 'bass') return chordToneMidi(song.harmony, bar, Math.min(pitchIdx, 4), -2);
  const dev = MOTIF_DEV[((bar % 8) + 8) % 8];
  return chordToneMidi(song.harmony, bar, Math.min(7, pitchIdx + dev), 1);
}

/**
 * Événements d'un pas.
 * @param {{ tracks, harmony, style, boss? }} song
 * @param {number} bar   index absolu de mesure (fait avancer l'harmonie)
 * @param {number} step  0..15
 * @param {{ type?: string, bar?: number, bars?: number }} [section]
 */
export function generateStep(song, bar, step, section = {}) {
  const type = section.type || 'full';
  const sb = section.bar || 0;
  const bars = section.bars || 8;
  const { tracks, style, harmony } = song;
  const mask = sectionMask(type, sb, bars);
  const phraseBar = ((bar % 8) + 8) % 8;
  const swing = step % 2 === 1 ? style.swing : 0;
  const h = (salt) => hash3(bar, step, salt);
  const ev = [];
  const sectionVel = type === 'drop' ? 1.08 : type === 'breakdown' ? 0.9 : 1;
  const push = (e) => ev.push({ pos: swing, vel: 1, ...e, vel: Math.min(1.3, (e.vel ?? 1) * sectionVel) });

  // Nappe d'accord sur le « 1 »
  if (step === 0 && mask.pad) {
    push({
      inst: 'pad', pos: 0, dur: 16,
      chord: padVoicing(harmony, bar, style.sevenths),
      vel: type === 'breakdown' ? 1.5 : type === 'intro' ? 1.2 : 1,
    });
  }
  // Crash d'ouverture de phrase
  if (step === 0 && style.crash && phraseBar === 0 && bar > 0 && (type === 'full' || type === 'drop')) {
    push({ inst: 'crash', pos: 0, vel: type === 'drop' ? 1.2 : 0.85 });
  }

  for (const id of TRACK_ORDER) {
    const tr = tracks[id];
    if (!tr || !tr.unlocked || !mask[id]) continue;
    const lvl = Math.min(1.25, 0.85 + (tr.mods?.level || 0) * 0.06);
    const echo = !!tr.mods?.echo;
    const prev = (step + 15) % 16;

    const emit = (srcStep, vel, isEcho) => {
      const base = { echo: isEcho || echo, pos: swing };
      switch (id) {
        case 'kick':
          push({ ...base, inst: 'kick', vel: vel * (srcStep % 4 === 0 ? 1 : 0.86) });
          break;
        case 'hat':
          push({
            ...base, inst: 'hat', open: srcStep % 8 === 6,
            vel: vel * HAT_GROOVE[srcStep % 4] * (0.9 + 0.2 * h(1)),
            pan: srcStep % 8 === 6 ? 0.3 : -0.25,
          });
          break;
        case 'snare':
          push({ ...base, inst: 'snare', vel: vel * (0.92 + 0.12 * h(2)), pan: 0.06 });
          break;
        case 'bass': {
          const midi = melodicMidi(song, id, bar, srcStep, tr.pitch?.[srcStep] || 0);
          const nxt = nextActive(tr, srcStep);
          let slideTo = null;
          if ((style.bass.slide || style.bass.glide) && !isEcho && nxt === srcStep + 1 && h(3) < 0.5) {
            slideTo = melodicMidi(song, id, bar, nxt, tr.pitch?.[nxt] || 0);
          }
          const accent = srcStep % 4 === 0 || (style.bass.slide && h(4) < 0.3);
          const gap = nxt < 0 ? 16 - srcStep : nxt - srcStep;
          const dur = style.bass.type === 'acid' ? 0.8 : Math.min(gap, 4) * 0.92;
          push({ ...base, inst: 'bass', midi, dur, vel: vel * (accent ? 1 : 0.88), slideTo, accent });
          break;
        }
        case 'lead': {
          let pitchIdx = tr.pitch?.[srcStep] || 0;
          // dernière note de la phrase : envolée à l'octave
          if (phraseBar === 7 && nextActive(tr, srcStep) < 0 && pitchIdx < 4) pitchIdx += 4;
          const midi = melodicMidi(song, id, bar, srcStep, pitchIdx);
          const nxt = nextActive(tr, srcStep);
          const gap = nxt < 0 ? 4 : nxt - srcStep;
          push({
            ...base, inst: 'lead', midi, dur: Math.min(gap, 3) * 0.9,
            vel: vel * (srcStep % 4 === 0 ? 1 : 0.86), pan: srcStep % 2 ? 0.12 : -0.12,
          });
          break;
        }
      }
    };

    if (tr.steps[step]) emit(step, lvl, false);
    if (echo && tr.steps[prev] && !tr.steps[step]) emit(prev, lvl * 0.45, true);

    // Notes fantômes : caisse claire très douce juste avant un coup
    if (id === 'snare' && style.ghosts && !tr.steps[step] && tr.steps[(step + 1) % 16] && h(5) < 0.55) {
      push({ inst: 'snare', vel: 0.16 + 0.08 * h(6), pan: 0.06 });
    }
  }

  // Montée : roulement de caisse claire qui accélère (croches puis doubles-croches)
  if (type === 'build') {
    const dense = sb >= bars - 1;
    if (dense || step % 2 === 0) {
      const progress = (sb * 16 + step) / (bars * 16);
      push({ inst: 'snare', vel: 0.25 + 0.75 * progress, pan: 0.06, fillNote: true });
    }
  }

  // Fills de fin de phrase et ponctuations
  if (mask.fills) {
    if (phraseBar === 7 && step >= 12) {
      const k = step - 12;
      const fill = style.fill === 'snare' && !tracks.snare?.unlocked ? 'tom' : style.fill;
      if (fill === 'snare') push({ inst: 'snare', vel: 0.45 + 0.17 * k, pan: 0.06, fillNote: true });
      else if (fill === 'tom') push({ inst: 'tom', midi: TOM_FILL[k], vel: 0.6 + 0.1 * k, pan: 0.35 - k * 0.22, fillNote: true });
      else if (k > 0) push({ inst: 'snare', rim: true, vel: 0.35 + 0.1 * k, pan: 0.2, fillNote: true });
    }
    if (phraseBar === 3 && step === 14 && tracks.hat?.unlocked) push({ inst: 'hat', open: true, vel: 0.8, pan: 0.3 });
  }

  if (song.boss && step % 4 === 2) push({ inst: 'hat', open: true, vel: 0.6, pan: 0.3 });
  return ev;
}

/** Joue des événements sur un moteur audio (temps réel ou hors-ligne). */
export function playEvents(a, events, t, stepDur, style) {
  for (const e of events) {
    const time = t + e.pos * stepDur;
    const delay = e.echo ? 0.45 : 0;
    switch (e.inst) {
      case 'kick': a.kick(time, e.vel, style.kick); break;
      case 'snare': a.snare(time, e.vel, { s: e.rim ? { ...style.snare, type: 'rim', tone: 1700, noise: 3000, decay: 0.06 } : style.snare, delay, pan: e.pan || 0 }); break;
      case 'hat': a.hat(time, e.vel, { open: e.open, delay, pan: e.pan ?? -0.25, s: style.hat }); break;
      case 'tom': a.tom(time, e.midi, e.vel, e.pan || 0); break;
      case 'crash': a.crash(time, e.vel); break;
      case 'bass': a.bass(time, e.midi, stepDur * e.dur, e.vel, { s: style.bass, delay, slideTo: e.slideTo, accent: e.accent }); break;
      case 'lead': a.lead(time, e.midi, stepDur * e.dur, e.vel, { s: style.lead, delay, pan: e.pan || 0 }); break;
      case 'pad': a.pad(time, e.chord, stepDur * e.dur, e.vel, style.pad); break;
    }
  }
}

/** Aperçu d'une note isolée (placement dans le piano roll, édition). */
export function previewNote(a, song, trackId, step, pitchIdx, bar, stepDur, t) {
  const tracks = {};
  for (const id of TRACK_ORDER) tracks[id] = { unlocked: false, steps: [], pitch: [] };
  const steps = new Array(16).fill(false); steps[step] = true;
  const pitch = new Array(16).fill(0); pitch[step] = pitchIdx;
  tracks[trackId] = { unlocked: true, steps, pitch, mods: { level: 1 } };
  const events = generateStep({ ...song, tracks, boss: false }, bar, step, { type: 'full' })
    .filter((e) => e.inst === trackId || (trackId === 'snare' && e.inst === 'snare'))
    .filter((e) => !e.fillNote);
  playEvents(a, events.map((e) => ({ ...e, pos: 0 })), t, stepDur, song.style);
}
