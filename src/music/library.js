// Discothèque : tous les morceaux créés (parties et mode Création), sauvegardés localement.

const KEY = 'resonance:songs';
const MAX_SONGS = 60;

export function loadLibrary() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s) => s && Array.isArray(s.sections) && s.sections.length) : [];
  } catch {
    return [];
  }
}

function persist(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SONGS))); return true; } catch { return false; }
}

/** Ajoute ou remplace (même id) un morceau, le plus récent en tête. */
export function saveSong(song) {
  const list = loadLibrary().filter((s) => s.id !== song.id);
  list.unshift({ ...song, updatedAt: Date.now() });
  return persist(list);
}

export function deleteSong(id) {
  return persist(loadLibrary().filter((s) => s.id !== id));
}

export function getSong(id) {
  return loadLibrary().find((s) => s.id === id) || null;
}
