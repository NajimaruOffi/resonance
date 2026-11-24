// Persistance locale tolérante aux erreurs (navigation privée, stockage bloqué…).

import { normalizeProfile, defaultProfile } from './meta/progression.js';

const KEY = 'resonance:v1';

const DEFAULTS = {
  settings: { volume: 0.8, shake: true, reduceFlash: false, bloom: true },
  best: { score: 0, wave: 0, seed: null },
  runs: 0,
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...structuredClone(DEFAULTS), profile: defaultProfile() };
    const data = JSON.parse(raw);
    return {
      settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
      best: { ...DEFAULTS.best, ...(data.best || {}) },
      runs: data.runs || 0,
      profile: normalizeProfile(data.profile),
    };
  } catch {
    return { ...structuredClone(DEFAULTS), profile: defaultProfile() };
  }
}

export function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* stockage indisponible */ }
}
