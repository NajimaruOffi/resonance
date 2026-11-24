// Point d'entrée : assemble audio, jeu, rendu, interface et boucle principale.

import { AudioEngine } from './audio/engine.js';
import { Game } from './game/game.js';
import { Renderer } from './render/renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { StudioUI } from './studio.js';
import { load } from './storage.js';

const canvas = document.getElementById('game');
const store = load();
const audio = new AudioEngine();
const input = new Input(canvas);
const renderer = new Renderer(canvas);

const hooks = {};
const game = new Game(audio, input, store.settings, hooks);
const ui = new UI(game, audio, store, renderer);

const studio = new StudioUI({ game, audio, songs: ui.songs, ui });
ui.studio = studio;
ui.onOpenStudio = (song) => studio.open(song);

hooks.onStep = (ev) => { ui.onStep(ev); studio.onStep(ev); };
hooks.onBanner = (title, sub, hold) => ui.banner(title, sub, hold);
hooks.onOffers = (offers) => ui.showOffers(offers);
hooks.onGameOver = (stats) => ui.gameOver(stats);
hooks.onWaveClear = (stats) => ui.onWaveClear(stats);

ui.onEnter = async () => {
  audio.init();
  audio.setVolume(store.settings.volume);
  await audio.resume();
  game.startAttract();
  ui.show('title');
  audio.ui('confirm');
};

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) ui.togglePause(true);
});

// Exposé pour le débogage depuis la console
window.__resonance = { game, audio, ui, studio };

let last = performance.now();
let lastError = 0;
function loop(now) {
  // La frame suivante est demandée d'abord : une erreur ponctuelle ne fige jamais le jeu.
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (renderer.w !== Math.max(1, window.innerWidth) || renderer.h !== Math.max(1, window.innerHeight)) renderer.resize();
    game.setViewport(renderer.w, renderer.h);

    if (input.pressed('Escape') || input.pressed('KeyP')) {
      if (ui.screen === 'options' && game.paused) ui.show('pause');
      else ui.togglePause();
    }

    game.frame(dt);
    renderer.render(game, input.mouse, audio.getSpectrum(), ui.screen === 'game' && game.mode === 'playing');
    ui.frame();
  } catch (err) {
    if (now - lastError > 5000) { lastError = now; console.error(err); }
  } finally {
    input.endFrame();
  }
}
requestAnimationFrame(loop);
