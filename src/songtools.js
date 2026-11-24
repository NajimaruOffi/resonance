// Outils communs autour d'un morceau : écoute dans l'application, exports, affichage de structure.
// Utilisé par l'écran de fin, la discothèque et le mode Création.

import { renderSong, encodeWav, downloadBlob, songFileName, downloadSongMidi } from './audio/export.js';
import { songLength, songStructure } from './music/song.js';
import { styleById } from './music/styles.js';
import { NOTE_NAMES_FR, MODE_LABELS } from './music/theory.js';

const keyOf = (song) => `${song.id}:${song.updatedAt || song.createdAt}:${JSON.stringify(song.sections).length}`;

export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function keyLabel(h) {
  return `${NOTE_NAMES_FR[((h.root % 12) + 12) % 12]} ${MODE_LABELS[h.mode] || h.mode}`;
}

export class SongTools {
  constructor(audio) {
    this.audio = audio;
    /** Rappel de progression du mixage (0 → 1), branché par l'interface. */
    this.onProgress = null;
    this.cache = new Map();
    this.source = null;
    this.playingId = null;
    this.onStop = null;
  }

  async buffer(song) {
    const k = keyOf(song);
    if (!this.cache.has(k)) {
      if (this.cache.size > 4) this.cache.clear();
      const p = renderSong(song, { onProgress: (x) => this.onProgress?.(x) });
      p.catch(() => this.cache.delete(k));
      this.cache.set(k, p);
    }
    return this.cache.get(k);
  }

  /** Écoute : rendu hors-ligne puis lecture ; la musique du jeu est coupée pendant l'écoute. */
  async play(song, { onStart, onEnd } = {}) {
    this.stop();
    const buffer = await this.buffer(song);
    const ctx = this.audio.ctx;
    await this.audio.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = this.audio.volume;
    src.connect(g); g.connect(ctx.destination);
    this.audio.musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    src.start();
    this.source = src;
    this.playingId = song.id;
    this.startedAt = ctx.currentTime;
    this.duration = buffer.duration;
    this.onStop = onEnd;
    src.onended = () => { if (this.source === src) this.stop(); };
    onStart?.(buffer.duration);
  }

  get position() {
    return this.source ? Math.min(this.duration, this.audio.ctx.currentTime - this.startedAt) : 0;
  }

  stop() {
    if (!this.source) return;
    const src = this.source;
    this.source = null;
    this.playingId = null;
    try { src.stop(); } catch { /* déjà arrêtée */ }
    this.audio.musicBus.gain.setTargetAtTime(0.9, this.audio.ctx.currentTime, 0.1);
    const cb = this.onStop;
    this.onStop = null;
    cb?.();
  }

  async downloadWav(song) {
    const buffer = await this.buffer(song);
    const blob = new Blob([encodeWav(buffer)], { type: 'audio/wav' });
    downloadBlob(blob, songFileName(song, 'wav'));
    return { bytes: blob.size, seconds: buffer.duration };
  }

  downloadMidi(song) { return downloadSongMidi(song); }

  /** Pastilles de structure (Intro · Couplet ×4 · Drop…). */
  renderStructure(el, song) {
    el.textContent = '';
    for (const part of songStructure(song)) {
      const chip = document.createElement('span');
      chip.className = `chip sec-${part.type}`;
      chip.textContent = part.n > 1 ? `${part.label} ×${part.n}` : part.label;
      el.appendChild(chip);
    }
  }

  /** Ligne d'informations : durée, mesures, styles et tonalités traversés. */
  describe(song) {
    const { seconds, bars } = songLength(song);
    const styles = [...new Set(song.sections.map((s) => styleById(s.style).name))];
    const keys = [...new Set(song.sections.map((s) => keyLabel(s.harmony)))];
    return `${fmtTime(seconds)} · ${bars} mesures · ${styles.join(' → ')} · ${keys.join(' → ')}`;
  }
}
