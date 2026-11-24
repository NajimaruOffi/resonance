// Styles musicaux : chaque secteur a son genre, avec sa propre lutherie (sons de synthèse),
// son groove (swing, notes fantômes) et son mixage (réverbe, delay).

export const STYLES = {
  synthwave: {
    id: 'synthwave', name: 'Synthwave', swing: 0, sevenths: true, ghosts: false, crash: true,
    kick: { f0: 160, f1: 45, decay: 0.42, click: 0.25, level: 0.95 },
    snare: { type: 'snare', tone: 200, noise: 1900, decay: 0.24, reverb: 0.55 },
    hat: { freq: 7200, decay: 0.045, open: 0.24, level: 0.2 },
    bass: { type: 'pluck', cutoff: 1800, q: 6, level: 0.42 },
    lead: { type: 'supersaw', level: 0.13, delay: 0.32, reverb: 0.35 },
    pad: { type: 'strings', cutoff: 1500, level: 0.055, reverb: 0.6 },
    fill: 'snare',
  },
  acid: {
    id: 'acid', name: 'Acid techno', swing: 0.06, sevenths: false, ghosts: true, crash: true,
    kick: { f0: 135, f1: 40, decay: 0.55, click: 0.12, level: 1, rumble: true },
    snare: { type: 'clap', tone: 0, noise: 1300, decay: 0.2, reverb: 0.35 },
    hat: { freq: 9500, decay: 0.03, open: 0.18, level: 0.24 },
    bass: { type: 'acid', cutoff: 320, q: 17, level: 0.36, slide: true },
    lead: { type: 'stab', level: 0.12, delay: 0.4, reverb: 0.25 },
    pad: { type: 'dark', cutoff: 650, level: 0.04, reverb: 0.5 },
    fill: 'tom',
  },
  garage: {
    id: 'garage', name: 'Deep garage', swing: 0.2, sevenths: true, ghosts: true, crash: false,
    kick: { f0: 120, f1: 48, decay: 0.35, click: 0.06, level: 0.9 },
    snare: { type: 'rim', tone: 1700, noise: 3000, decay: 0.07, reverb: 0.45 },
    hat: { freq: 8200, decay: 0.06, open: 0.3, level: 0.18 },
    bass: { type: 'sub', cutoff: 900, q: 1, level: 0.3, glide: true },
    lead: { type: 'fm', level: 0.15, delay: 0.38, reverb: 0.5 },
    pad: { type: 'fm', cutoff: 2200, level: 0.05, reverb: 0.75 },
    fill: 'rim',
  },
  breaks: {
    id: 'breaks', name: 'Breakbeat', swing: 0.04, sevenths: false, ghosts: true, crash: true,
    kick: { f0: 185, f1: 50, decay: 0.3, click: 0.3, level: 0.95 },
    snare: { type: 'snare', tone: 240, noise: 2500, decay: 0.18, reverb: 0.3 },
    hat: { freq: 8000, decay: 0.04, open: 0.2, level: 0.22 },
    bass: { type: 'reese', cutoff: 700, q: 2, level: 0.4 },
    lead: { type: 'brass', level: 0.11, delay: 0.25, reverb: 0.3 },
    pad: { type: 'organ', cutoff: 3000, level: 0.035, reverb: 0.45 },
    fill: 'snare',
  },
};

export const STYLE_ORDER = ['synthwave', 'acid', 'garage', 'breaks'];
export const styleById = (id) => STYLES[id] || STYLES.synthwave;
