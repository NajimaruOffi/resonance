// Théorie musicale : gammes, accords diatoniques (triades et 7e), progressions en deux
// parties (A/B sur 8 mesures), voicings, noms d'accords. Tout reste dans la tonalité :
// n'importe quelle note composée par le joueur sonne juste par construction.
//
// Un objet « harmonie » = { root (MIDI), mode, prog: degrés A, progB: degrés B }.
// Les secteurs du jeu en sont des instances (avec en plus une palette et un style).

export const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export const MODE_LABELS = {
  aeolian: 'mineur', dorian: 'dorien', phrygian: 'phrygien', harmonic: 'mineur harmonique',
  ionian: 'majeur', mixolydian: 'mixolydien', lydian: 'lydien',
};

export const NOTE_NAMES_FR = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Fondamentale MIDI d'une classe de hauteur, dans un registre centré (Fa#3 → Fa4). */
export const rootForPc = (pc) => (pc >= 6 ? 48 + pc : 60 + pc);

/** Progressions nommées (degrés de gamme, 0 = i). A sur les mesures 1-4, B sur 5-8. */
export const PROGRESSIONS = [
  { id: 'neon', name: 'Néon', a: [0, 5, 2, 6], b: [3, 5, 0, 4] },
  { id: 'andalouse', name: 'Andalouse', a: [0, 6, 5, 4], b: [0, 6, 5, 4] },
  { id: 'nostalgie', name: 'Nostalgie', a: [5, 6, 0, 0], b: [3, 4, 0, 6] },
  { id: 'hypnose', name: 'Hypnose', a: [0, 0, 6, 6], b: [5, 5, 6, 6] },
  { id: 'ascension', name: 'Ascension', a: [0, 3, 4, 0], b: [5, 3, 6, 4] },
  { id: 'pop', name: 'Hymne', a: [0, 4, 5, 3], b: [5, 3, 0, 4] },
  { id: 'dorienne', name: 'Dorienne', a: [0, 3, 0, 3], b: [6, 3, 0, 6] },
  { id: 'braise', name: 'Braise', a: [0, 3, 5, 4], b: [5, 3, 4, 4] },
  { id: 'abysse', name: 'Abysse', a: [0, 6, 5, 6], b: [3, 5, 6, 0] },
  { id: 'eclipse', name: 'Éclipse', a: [0, 3, 0, 6], b: [5, 6, 3, 4] },
];
export const progressionById = (id) => PROGRESSIONS.find((p) => p.id === id) || PROGRESSIONS[0];

export const SECTORS = [
  {
    id: 1, name: 'Néon', key: 'La mineur', root: 57, mode: 'aeolian', style: 'synthwave',
    prog: [0, 5, 2, 6], progB: [3, 5, 0, 4],
    palette: { a: '#29f0ff', b: '#ff3df2', c: '#ffe066', d: '#7c5cff', bg: '#05040d', grid: '#16204a' },
  },
  {
    id: 2, name: 'Braise', key: 'Do mineur', root: 60, mode: 'harmonic', style: 'acid',
    prog: [0, 3, 5, 4], progB: [5, 3, 4, 4],
    palette: { a: '#ff9a3d', b: '#b04dff', c: '#fff1a8', d: '#ff3d6e', bg: '#0b0406', grid: '#3a1630' },
  },
  {
    id: 3, name: 'Abysse', key: 'Fa# mineur', root: 54, mode: 'aeolian', style: 'garage',
    prog: [0, 6, 5, 6], progB: [3, 5, 6, 0],
    palette: { a: '#3dffa8', b: '#3d8bff', c: '#d4ff6b', d: '#00e0ff', bg: '#020a0b', grid: '#0f3238' },
  },
  {
    id: 4, name: 'Éclipse', key: 'Ré dorien', root: 62, mode: 'dorian', style: 'breaks',
    prog: [0, 3, 0, 6], progB: [5, 6, 3, 4],
    palette: { a: '#ffd23d', b: '#ff3d3d', c: '#ffffff', d: '#ff7a3d', bg: '#0a0603', grid: '#3a2410' },
  },
];

export const sectorById = (id) => SECTORS.find((s) => s.id === id) || SECTORS[0];

export function sectorForWave(wave) {
  // Vagues 1-5 -> secteur 0, 6-10 -> secteur 1, etc. (cyclique)
  return SECTORS[Math.floor((wave - 1) / 5) % SECTORS.length];
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const midiName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

/** Degré de gamme (entier quelconque, peut être négatif) -> note MIDI. */
export function degreeToMidi(h, degree) {
  const scale = MODES[h.mode];
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return h.root + oct * 12 + scale[idx];
}

const wrap = (i, n) => ((i % n) + n) % n;

/** Degré fondamental de l'accord de la mesure (partie A sur 1-4, B sur 5-8, cyclique). */
export function progAt(h, bar) {
  const useB = h.progB && wrap(Math.floor(bar / 4), 2) === 1;
  const p = useB ? h.progB : h.prog;
  return p[wrap(bar, p.length)];
}

/** Degrés des notes de l'accord diatonique (triade) pour la mesure donnée. */
export function chordDegrees(h, bar) {
  const d = progAt(h, bar);
  return [d, d + 2, d + 4];
}

export function chordMidi(h, bar, octave = 0) {
  return chordDegrees(h, bar).map((d) => degreeToMidi(h, d) + octave * 12);
}

/**
 * Tons de l'accord sur deux octaves, indexés de 0 à 7 :
 * fondamentale, tierce, quinte, septième, octave, tierce+, quinte+, septième+.
 * C'est l'espace dans lequel le joueur compose ses mélodies : elles suivent l'harmonie.
 */
export const CHORD_TONES = [0, 2, 4, 6, 7, 9, 11, 13];
export const CHORD_TONE_LABELS = ['Fond.', 'Tierce', 'Quinte', '7e', 'Octave', 'Tierce +', 'Quinte +', '7e +'];

export function chordToneMidi(h, bar, idx, octave = 0) {
  const i = Math.max(0, Math.min(CHORD_TONES.length - 1, idx));
  return degreeToMidi(h, progAt(h, bar) + CHORD_TONES[i]) + octave * 12;
}

/** Voicing serré de l'accord autour d'une note centrale (conduite de voix naturelle). */
export function padVoicing(h, bar, sevenths = true, center = 62) {
  const r = progAt(h, bar);
  const degs = sevenths ? [r, r + 2, r + 4, r + 6] : [r, r + 2, r + 4];
  return degs
    .map((d) => {
      let m = degreeToMidi(h, d);
      while (m - center > 6) m -= 12;
      while (center - m > 6) m += 12;
      return m;
    })
    .sort((a, b) => a - b);
}

/** Symbole d'accord international (Am7, Cmaj7, G7, Bm7b5…). */
export function chordName(h, bar, sevenths = true) {
  const r = progAt(h, bar);
  const root = degreeToMidi(h, r);
  const iv = (k) => wrap(degreeToMidi(h, r + k) - root, 12);
  const third = iv(2), fifth = iv(4), seventh = iv(6);
  const name = NOTE_NAMES[wrap(root, 12)];
  const minor = third === 3;
  if (!sevenths) {
    if (fifth === 6) return `${name}dim`;
    if (fifth === 8) return `${name}aug`;
    return minor ? `${name}m` : name;
  }
  if (minor && fifth === 6) return `${name}m7b5`;
  if (minor) return seventh === 11 ? `${name}m(maj7)` : `${name}m7`;
  if (fifth === 8) return `${name}aug7`;
  return seventh === 11 ? `${name}maj7` : `${name}7`;
}

// ── fonctions historiques (conservées pour la compatibilité) ──

/** Basse : fondamentale / quinte / octave selon la position dans la mesure. */
export function bassMidi(h, bar, step) {
  const [r, , f] = chordDegrees(h, bar);
  const pattern = [r, r, f, r + 7];
  return degreeToMidi(h, pattern[(step >> 2) % 4]) - 24;
}

const ARP = [0, 1, 2, 3, 4, 3, 2, 1];
export function leadMidi(h, bar, step) {
  const [r] = chordDegrees(h, bar);
  const i = ARP[step % ARP.length];
  const deg = r + [0, 2, 4, 7, 9][i];
  return degreeToMidi(h, deg) + 12;
}

/** Pentatonique (degrés 0,2,3,4,6) — pour les « morts » musicales des ennemis. */
const PENTA = [0, 2, 3, 4, 6];
export function pentaMidi(h, index, octave = 1) {
  const n = PENTA.length;
  const o = Math.floor(index / n);
  const deg = PENTA[wrap(index, n)] + o * 7;
  return degreeToMidi(h, deg) + octave * 12;
}
