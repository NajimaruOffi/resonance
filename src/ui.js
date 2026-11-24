// Interface DOM : écrans, HUD, séquenceurs (mini / grand), améliorations, fin de partie.

import { TRACK_ORDER, TRACK_DEFS, isMelodic, PITCH_RANGE } from './game/tracks.js';
import { CHORD_TONE_LABELS, chordName } from './music/theory.js';
import { styleById } from './music/styles.js';
import { RARITY } from './game/upgrades.js';
import { dailySeedString, randomSeedString } from './util/rng.js';
import { save } from './storage.js';
import { SongTools, fmtTime } from './songtools.js';
import { songFromRunLog } from './music/song.js';
import { saveSong, loadLibrary } from './music/library.js';
import {
  KITS, GEAR, ACHIEVEMENTS, INTENSITY, MAX_INTENSITY, kitById, kitUnlocked, levelInfo, gearLevel,
  gearNextCost, buyGear, runSetup, rewardMultiplier, unlockAchievements, finishRun,
} from './meta/progression.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

export class UI {
  constructor(game, audio, store, renderer) {
    this.game = game;
    this.audio = audio;
    this.store = store;
    this.renderer = renderer;
    this.songs = new SongTools(audio);
    this.screen = 'splash';
    this.prevScreen = null;
    this.seqMini = { el: $('seq-mini'), cells: null };
    this.seqBig = { el: $('seq-big'), cells: null };
    this.seqFinal = { el: $('seq-final'), cells: null };
    this.cache = {};
    this.offers = null;
    this.placing = null;
    this.paletteRef = null;
    this.profile = store.profile;
    this.prepKit = kitUnlocked(kitById(this.profile.lastKit), this.profile) ? this.profile.lastKit : 'classic';
    this.prepIntensity = Math.min(this.profile.lastIntensity || 0, this.profile.intensityUnlocked);
    this.runAchievements = [];
    this.backTarget = 'title';
    this._bind();
    this._applySettings();
    this.refreshBest();
    this.refreshProfile();
    $('daily-seed').textContent = dailySeedString().slice(5);
  }

  // ───────────────────────────── navigation ─────────────────────────────

  show(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === `screen-${name}`);
    this.prevScreen = this.screen;
    this.screen = name;
    const inGame = name === 'game';
    $('hud').classList.toggle('hidden', !(inGame || name === 'pause'));
    document.body.classList.toggle('in-game', inGame);
    const first = document.querySelector(`#screen-${name} .btn-primary, #screen-${name} .card`);
    if (first && name !== 'game') setTimeout(() => first.focus({ preventScroll: true }), 30);
  }

  _bind() {
    const click = (id, fn) => $(id).addEventListener('click', () => { this.audio.ui('click'); fn(); });
    for (const b of document.querySelectorAll('.btn')) b.addEventListener('mouseenter', () => this.audio.ui('hover'));

    $('btn-enter').addEventListener('click', () => this.onEnter?.());
    click('btn-play', () => this.openPrep());
    click('btn-daily', () => this.startRun(dailySeedString(), 'classic', 0, true));
    click('btn-launch', () => {
      const v = $('seed-input').value.trim().toUpperCase();
      this.startRun(v || randomSeedString(), this.prepKit, this.prepIntensity);
    });
    $('seed-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-launch').click(); });
    click('int-minus', () => { this.prepIntensity = Math.max(0, this.prepIntensity - 1); this.renderPrep(); });
    click('int-plus', () => { this.prepIntensity = Math.min(this.profile.intensityUnlocked, this.prepIntensity + 1); this.renderPrep(); });
    click('btn-studio', () => this.openStudio('title'));
    click('btn-create', () => this.studio?.open());
    click('btn-library', () => this.studio?.openLibrary());
    click('btn-over-studio', () => this.openStudio('over'));
    click('btn-achievements', () => this.openAchievements());
    click('btn-how', () => { this.backTarget = 'title'; this.show('how'); });
    click('btn-options', () => { this.backTarget = 'title'; this.show('options'); });
    for (const b of document.querySelectorAll('[data-back]')) {
      b.addEventListener('click', () => {
        this.audio.ui('click');
        if (this.backTarget === 'title') this.refreshProfile();
        this.show(this.game.paused ? 'pause' : this.backTarget);
      });
    }
    click('btn-resume', () => this.togglePause(false));
    click('btn-pause-options', () => this.show('options'));
    click('btn-quit', () => { this.game.setPaused(false); this.toTitle(); });
    click('btn-retry', () => this.startRun(this.last.seed, this.last.kit, this.last.intensity, this.last.daily));
    click('btn-new', () => this.openPrep());
    click('btn-menu', () => this.toTitle());
    click('btn-download', () => this.busy($('btn-download'), async () => {
      const r = await this.songs.downloadWav(this.currentSong());
      $('dl-status').textContent = `Fichier audio prêt : ${fmtTime(r.seconds)} · ${(r.bytes / 1048576).toFixed(1)} Mo`;
    }));
    click('btn-download-midi', () => {
      const r = this.songs.downloadMidi(this.currentSong());
      $('dl-status').textContent = `Partition MIDI prête (${(r.bytes / 1024).toFixed(1)} Ko) : batterie, basse, lead et nappe sur des pistes séparées.`;
    });
    click('btn-song-play', () => this.toggleListen(this.currentSong(), $('btn-song-play')));
    click('btn-song-edit', () => { this.songs.stop(); this.onOpenStudio?.(this.currentSong()); });
    $('song-title').addEventListener('change', () => {
      if (!this.overSong) return;
      this.overSong.title = $('song-title').value.trim() || this.overSong.title;
      saveSong(this.overSong);
    });
    click('btn-pause-download', () => this.busy($('btn-pause-download'), async () => {
      const g = this.game;
      const song = songFromRunLog(g.run.songLog, { title: `Partie ${g.run.seed} (en cours)`, seed: g.run.seed });
      if (song) await this.songs.downloadWav(song);
    }));
    click('btn-reroll', () => {
      const offers = this.game.rerollOffers();
      if (offers) this.showOffers(offers);
    });

    // options
    const s = this.store.settings;
    const vol = $('opt-volume'), shake = $('opt-shake'), flash = $('opt-flash'), bloom = $('opt-bloom');
    vol.value = s.volume; shake.checked = s.shake; flash.checked = s.reduceFlash; bloom.checked = s.bloom;
    vol.addEventListener('input', () => { s.volume = +vol.value; this._applySettings(); });
    shake.addEventListener('change', () => { s.shake = shake.checked; this._applySettings(); });
    flash.addEventListener('change', () => { s.reduceFlash = flash.checked; this._applySettings(); });
    bloom.addEventListener('change', () => { s.bloom = bloom.checked; this._applySettings(); });

    // raccourcis clavier des cartes
    window.addEventListener('keydown', (e) => {
      if (this.screen !== 'upgrade' || this.placing || this.game.paused) return;
      const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
      const i = m ? +m[1] - 1 : -1;
      if (i >= 0 && this.offers && this.offers[i]) this._choose(this.offers[i]);
      if (e.code === 'KeyR' && !$('btn-reroll').classList.contains('hidden')) $('btn-reroll').click();
    });
  }

  _applySettings() {
    const s = this.store.settings;
    this.audio.setVolume(s.volume);
    this.renderer.bloomEnabled = s.bloom;
    save(this.store);
  }

  refreshBest() {
    const b = this.store.best;
    const el = $('best');
    el.textContent = '';
    if (!(b.score > 0)) { el.textContent = 'Aucun record pour l\'instant'; return; }
    const strong = (t) => { const s = document.createElement('b'); s.textContent = t; return s; };
    el.append('Record ', strong(b.score.toLocaleString('fr-FR')), ' · vague ', strong(String(b.wave)), ` · graine ${b.seed}`);
  }

  startRun(seed, kitId = 'classic', intensity = 0, daily = false) {
    this.songs.stop();
    this.last = { seed, kit: kitId, intensity, daily };
    if (!daily) {
      this.profile.lastKit = kitId;
      this.profile.lastIntensity = intensity;
    }
    this.runAchievements = [];
    this.game.setPaused(false);
    this.game.startRun(seed, runSetup(this.profile, kitId, intensity), daily);
    this.buildSeq(this.seqMini, { compact: true });
    this.store.runs++;
    save(this.store);
    this.show('game');
  }

  toTitle() {
    this.songs.stop();
    this.clearBanner();
    this.game.startAttract();
    this.refreshBest();
    this.refreshProfile();
    this.show('title');
  }

  // ───────────────────────────── méta-progression ─────────────────────────────

  refreshProfile() {
    const p = this.profile;
    const li = levelInfo(p.xp);
    $('pf-level').textContent = li.level;
    $('pf-xp').style.width = `${li.ratio * 100}%`;
    $('pf-xp-text').textContent = `${fmt(li.into)} / ${fmt(li.need)} XP`;
    $('pf-echoes').textContent = fmt(p.echoes);
    const affordable = GEAR.some((g) => { const c = gearNextCost(p, g.id); return c !== null && c <= p.echoes; });
    $('studio-badge').classList.toggle('hidden', !affordable);
    $('ach-count').textContent = `${Object.keys(p.achievements).length}/${ACHIEVEMENTS.length}`;
    const n = loadLibrary().length;
    $('lib-count').textContent = n ? String(n) : '';
  }

  /** Aperçu 16 pas d'un kit (mini-grille colorée). */
  _miniPattern(tracks) {
    const pal = this.game.sector.palette;
    const wrap = el('div', 'mini-pattern');
    for (const id of TRACK_ORDER) {
      if (!tracks[id]) continue;
      const row = el('div');
      row.style.setProperty('--tc', pal[TRACK_DEFS[id].color]);
      for (let s = 0; s < 16; s++) row.appendChild(el('i', tracks[id].includes(s) ? 'on' : ''));
      wrap.appendChild(row);
    }
    return wrap;
  }

  openPrep() {
    this.backTarget = 'title';
    this.renderPrep();
    this.show('prep');
  }

  renderPrep() {
    const p = this.profile;
    const wrap = $('kits');
    wrap.textContent = '';
    for (const kit of KITS) {
      const unlocked = kitUnlocked(kit, p);
      const b = el('button', `kit${unlocked ? '' : ' locked'}${kit.id === this.prepKit ? ' selected' : ''}`);
      b.appendChild(el('h4', '', kit.name));
      b.appendChild(this._miniPattern(kit.tracks));
      b.appendChild(el('p', '', kit.desc));
      if (!unlocked) b.appendChild(el('span', 'req', `Niveau ${kit.level} requis`));
      else if (p.bests[kit.id]) b.appendChild(el('span', 'best-wave', `Record : vague ${p.bests[kit.id]}`));
      b.addEventListener('mouseenter', () => this.audio.ui('hover'));
      b.addEventListener('click', () => {
        if (!unlocked) return;
        this.audio.ui('click');
        this.prepKit = kit.id;
        this.renderPrep();
      });
      wrap.appendChild(b);
    }

    const n = this.prepIntensity;
    $('int-value').textContent = n;
    $('int-mult').textContent = `gains ×${rewardMultiplier(n).toFixed(1)}`;
    $('int-minus').disabled = n <= 0;
    $('int-plus').disabled = n >= p.intensityUnlocked;
    const mods = $('int-mods');
    mods.textContent = '';
    const active = INTENSITY.filter((m) => m.level <= n);
    if (!active.length) mods.appendChild(el('li', 'none', 'Aucun modificateur — l\'expérience de base.'));
    for (const m of active) mods.appendChild(el('li', '', m.text));
    $('int-hint').textContent = p.intensityUnlocked >= MAX_INTENSITY
      ? 'Toutes les intensités sont débloquées.'
      : `Atteins la vague 10 en intensité ${p.intensityUnlocked} pour débloquer l'intensité ${p.intensityUnlocked + 1}.`;
  }

  openStudio(from) {
    this.backTarget = from;
    this.renderStudio();
    this.show('studio');
  }

  renderStudio() {
    const p = this.profile;
    $('studio-echoes').textContent = fmt(p.echoes);
    const wrap = $('gear');
    wrap.textContent = '';
    for (const g of GEAR) {
      const lvl = gearLevel(p, g.id);
      const cost = gearNextCost(p, g.id);
      const item = el('div', `gear-item${cost === null ? ' maxed' : ''}`);
      const h = el('h4', '', g.name);
      const pips = el('div', 'pips');
      for (let i = 0; i < g.costs.length; i++) pips.appendChild(el('i', i < lvl ? 'on' : ''));
      h.appendChild(pips);
      item.appendChild(h);
      item.appendChild(el('p', '', g.desc));
      const btn = el('button', 'btn', cost === null ? 'Niveau max' : `Acheter · ◈ ${fmt(cost)}`);
      btn.disabled = cost === null || p.echoes < cost;
      btn.addEventListener('click', () => {
        if (!buyGear(p, g.id)) return;
        this.audio.ui('confirm');
        save(this.store);
        this.renderStudio();
        this.refreshProfile();
      });
      item.appendChild(btn);
      wrap.appendChild(item);
    }
  }

  openAchievements() {
    this.backTarget = 'title';
    const p = this.profile;
    const done = Object.keys(p.achievements).length;
    $('ach-progress').textContent = `${done} / ${ACHIEVEMENTS.length}`;

    const life = $('lifetime');
    life.textContent = '';
    const t = p.totals;
    const h = Math.floor(t.seconds / 3600), m = Math.floor((t.seconds % 3600) / 60);
    const stats = [
      ['Niveau', levelInfo(p.xp).level], ['Parties', t.runs], ['Éliminations', fmt(t.kills)],
      ['Boss vaincus', t.bosses], ['Dash parfaits', fmt(t.perfects)], ['Temps de jeu', `${h}h${String(m).padStart(2, '0')}`],
      ['Intensité max', p.intensityUnlocked], ['Échos gagnés', fmt(p.echoesTotal)],
    ];
    for (const [k, v] of stats) {
      const s = el('div', 'stat');
      s.appendChild(el('b', '', String(v)));
      s.appendChild(el('span', '', k));
      life.appendChild(s);
    }

    const grid = $('ach-grid');
    grid.textContent = '';
    for (const a of ACHIEVEMENTS) {
      const ok = !!p.achievements[a.id];
      const row = el('div', `ach${ok ? ' done' : ''}`);
      const ico = el('div', 'ico');
      ico.appendChild(el('span', '', ok ? '✓' : '?'));
      row.appendChild(ico);
      const txt = el('div');
      txt.appendChild(el('b', '', a.name));
      txt.appendChild(el('small', '', a.desc));
      row.appendChild(txt);
      row.appendChild(el('span', 'rw', `◈ ${a.reward}`));
      grid.appendChild(row);
    }
    this.show('achievements');
  }

  toast(a) {
    const t = el('div', 'toast');
    t.appendChild(el('small', '', 'Succès débloqué'));
    t.appendChild(el('span', '', `◈ ${a.reward}`));
    t.appendChild(el('b', '', a.name));
    $('toasts').appendChild(t);
    this.audio.ui('confirm');
    setTimeout(() => t.remove(), 4200);
  }

  /** Vérification des succès en cours de partie (à chaque fin de vague). */
  onWaveClear(stats) {
    const got = unlockAchievements(this.profile, stats, false);
    if (!got.length) return;
    this.runAchievements.push(...got);
    got.forEach((a, i) => setTimeout(() => this.toast(a), i * 600));
    save(this.store);
  }

  togglePause(force) {
    const g = this.game;
    if (g.mode !== 'playing' && g.mode !== 'upgrade') return;
    const p = force ?? !g.paused;
    if (p === g.paused) return;
    g.setPaused(p);
    if (p) { this._resumeScreen = this.screen; this.show('pause'); }
    else this.show(this._resumeScreen === 'pause' || !this._resumeScreen ? 'game' : this._resumeScreen);
  }

  // ───────────────────────────── thème ─────────────────────────────

  _theme() {
    const pal = this.game.sector.palette;
    if (pal === this.paletteRef) return;
    this.paletteRef = pal;
    const root = document.documentElement.style;
    for (const k of ['a', 'b', 'c', 'd', 'bg']) root.setProperty(`--${k}`, pal[k]);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', pal.bg);
    for (const seq of [this.seqMini, this.seqBig, this.seqFinal]) if (seq.rows) this._colorRows(seq);
  }

  _colorRows(seq) {
    const pal = this.game.sector.palette;
    for (const id of TRACK_ORDER) seq.rows[id]?.style.setProperty('--tc', pal[TRACK_DEFS[id].color]);
  }

  // ───────────────────────────── séquenceur ─────────────────────────────

  buildSeq(seq, { compact = false, target = null, tracks = this.game.run.tracks } = {}) {
    seq.el.innerHTML = '';
    seq.cells = {};
    seq.rows = {};
    seq.tracks = tracks;
    for (const id of TRACK_ORDER) {
      const tr = tracks[id];
      if (compact && !tr.unlocked) continue;
      const row = document.createElement('div');
      row.className = 'seq-row' + (tr.unlocked ? '' : ' locked') + (target === id ? ' target' : '');
      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.innerHTML = compact ? tr.def.label : `${tr.def.label}<em>${tr.def.weapon}</em>`;
      row.appendChild(lbl);
      const cells = [];
      for (let s = 0; s < 16; s++) {
        const c = document.createElement('div');
        c.className = 'seq-cell' + (s % 4 === 0 ? ' beat' : '') + (tr.steps[s] ? ' on' : '');
        c.dataset.step = s;
        row.appendChild(c);
        cells.push(c);
      }
      seq.cells[id] = cells;
      seq.rows[id] = row;
      seq.el.appendChild(row);
    }
    this._colorRows(seq);
    seq.now = -1;
  }

  _playhead(seq, step) {
    if (!seq.cells || seq.el.offsetParent === null) return;
    for (const id in seq.cells) {
      const cells = seq.cells[id];
      if (seq.now >= 0) cells[seq.now].classList.remove('now');
      cells[step].classList.add('now');
    }
    seq.now = step;
  }

  onStep(ev) {
    if (this.roll && this.placing && $('roll').offsetParent) {
      for (const r of this.roll.rows) {
        if (this.roll.now >= 0) r.cells[this.roll.now].classList.remove('now');
        r.cells[ev.step].classList.add('now');
      }
      this.roll.now = ev.step;
      if (ev.step === 0) this._updateChordNow();
    }
    this._playhead(this.seqMini, ev.step);
    this._playhead(this.seqBig, ev.step);
    this._playhead(this.seqFinal, ev.step);
  }

  // ───────────────────────────── bannière ─────────────────────────────

  banner(title, sub = '', hold = false) {
    const el = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    el.classList.remove('show', 'hold');
    void el.offsetWidth; // relance l'animation
    el.classList.add(hold ? 'hold' : 'show');
  }

  // ───────────────────────────── améliorations ─────────────────────────────

  showOffers(offers) {
    this.offers = offers;
    this.placing = null;
    $('placer').classList.add('hidden');
    $('cards').classList.remove('hidden');
    $('up-title').textContent = `Vague ${this.game.run.wave} terminée`;
    const keys = offers.map((_, i) => i + 1).join(' · ');
    $('up-sub').textContent = `Choisis une amélioration — ton morceau continue de jouer. (Touches ${keys})`;
    const rerolls = this.game.run.rerolls;
    $('btn-reroll').classList.toggle('hidden', rerolls <= 0);
    $('reroll-count').textContent = `(${rerolls}) · R`;
    const pal = this.game.sector.palette;
    const wrap = $('cards');
    wrap.style.setProperty('--n', offers.length);
    wrap.innerHTML = '';
    offers.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = `card ${o.rarity}`;
      if (o.track) b.style.setProperty('--tc', pal[TRACK_DEFS[o.track].color]);
      b.innerHTML = `
        <span class="rar">${RARITY[o.rarity].label}</span>
        ${o.track ? `<span class="tag">${TRACK_DEFS[o.track].label}</span>` : ''}
        <h3></h3><p></p>
        <span class="key">[${i + 1}]${o.place ? ' · placement de note' : ''}</span>`;
      b.querySelector('h3').textContent = o.title;
      b.querySelector('p').textContent = o.desc;
      b.addEventListener('mouseenter', () => this.audio.ui('hover'));
      b.addEventListener('click', () => this._choose(o));
      wrap.appendChild(b);
    });
    this.show('upgrade');
  }

  _choose(offer) {
    // une seule amélioration par vague : on invalide les offres dès le premier choix
    if (!this.offers || this.placing || this.screen !== 'upgrade') return;
    this.offers = null;
    this.audio.ui('confirm');
    const place = this.game.chooseOffer(offer);
    if (place > 0) this._startPlacing(offer.track, place);
    else this._finishUpgrade();
  }

  _startPlacing(trackId, count) {
    this.placing = { trackId, left: count };
    $('cards').classList.add('hidden');
    $('btn-reroll').classList.add('hidden');
    $('placer').classList.remove('hidden');
    $('up-title').textContent = 'Compose';
    $('up-sub').textContent = `Piste ${TRACK_DEFS[trackId].label} — ${TRACK_DEFS[trackId].weapon}`;
    this._updatePlacerText();
    this.buildSeq(this.seqBig, { target: trackId });
    const melodic = isMelodic(trackId);
    $('roll').classList.toggle('hidden', !melodic);
    $('chord-now').classList.toggle('hidden', !melodic);
    $('placer-hint').textContent = melodic
      ? 'Choisis le moment ET la hauteur : les lignes sont les notes de l’accord en cours, ta mélodie suit l’harmonie. Survole pour écouter.'
      : 'Survole une case pour l’entendre, clique pour y placer la note.';
    if (melodic) this._buildRoll(trackId);
    const cells = this.seqBig.cells[trackId];
    cells.forEach((c, s) => {
      c.addEventListener('mouseenter', () => {
        if (melodic || !this.placing || this.game.run.tracks[trackId].steps[s]) return;
        this.game.previewStep(trackId, s);
      });
      c.addEventListener('click', () => {
        if (melodic || !this.placing || !this.game.placeStep(trackId, s)) return;
        c.classList.add('on', 'placed');
        this.placing.left--;
        this._updatePlacerText();
        if (this.placing.left <= 0) {
          this.placing = null;
          setTimeout(() => this._finishUpgrade(), 650);
        }
      });
    });
  }

  /** Piano roll : 16 pas × tons de l'accord (du plus aigu au plus grave). */
  _buildRoll(trackId) {
    const tr = this.game.run.tracks[trackId];
    const wrap = $('roll');
    wrap.textContent = '';
    wrap.style.setProperty('--tc', this.game.sector.palette[TRACK_DEFS[trackId].color]);
    const range = PITCH_RANGE[trackId];
    this.roll = { trackId, rows: [], now: -1 };
    for (let p = range - 1; p >= 0; p--) {
      const row = el('div', 'roll-row');
      row.appendChild(el('div', `lbl${[0, 2, 4].includes(p) ? ' stable' : ''}`, CHORD_TONE_LABELS[p]));
      const cells = [];
      for (let s = 0; s < 16; s++) {
        const c = el('div', 'roll-cell');
        const sync = () => {
          c.classList.toggle('on', tr.steps[s] && tr.pitch[s] === p);
          c.classList.toggle('col-taken', tr.steps[s] && tr.pitch[s] !== p);
        };
        sync();
        c.addEventListener('mouseenter', () => { if (this.placing && !tr.steps[s]) this.game.previewStep(trackId, s, p); });
        c.addEventListener('click', () => {
          if (!this.placing || !this.game.placeStep(trackId, s, p)) return;
          c.classList.add('placed');
          for (const r of this.roll.rows) r.sync.forEach((f) => f());
          this.seqBig.cells[trackId][s].classList.add('on', 'placed');
          this.placing.left--;
          this._updatePlacerText();
          if (this.placing.left <= 0) {
            this.placing = null;
            setTimeout(() => this._finishUpgrade(), 650);
          }
        });
        cells.push(c);
        row.appendChild(c);
        c._sync = sync;
      }
      wrap.appendChild(row);
      this.roll.rows.push({ cells, sync: cells.map((c) => c._sync) });
    }
    this._updateChordNow();
  }

  _updateChordNow() {
    const g = this.game;
    const st = styleById(g.sector.style);
    $('chord-now').textContent = `Accord en cours : ${chordName(g.sector, g.clock.bar, st.sevenths)} · ${st.name}`;
  }

  _updatePlacerText() {
    const n = this.placing ? this.placing.left : 0;
    $('placer-text').textContent = n > 1 ? `${n} notes à placer` : n === 1 ? '1 note à placer' : 'Parfait.';
  }

  _finishUpgrade() {
    this.offers = null;
    this.seqBig.cells = null;
    this.buildSeq(this.seqMini, { compact: true });
    this.show('game');
    this.game.nextWave();
  }

  // ───────────────────────────── fin de partie ─────────────────────────────

  clearBanner() { $('banner').classList.remove('show', 'hold'); }

  gameOver(st) {
    this.clearBanner();
    const best = this.store.best;
    const isBest = st.score > best.score;
    if (isBest) { best.score = st.score; best.wave = st.wave; best.seed = st.seed; }
    else if (st.wave > best.wave && best.score === 0) best.wave = st.wave;
    save(this.store);
    $('new-best').classList.toggle('hidden', !isBest);
    $('over-score').textContent = st.score.toLocaleString('fr-FR');
    const m = Math.floor(st.seconds / 60), s = String(st.seconds % 60).padStart(2, '0');
    const stats = [
      ['Vague', st.wave], ['Éliminations', st.kills], ['Combo max', st.maxCombo], ['Dash parfaits', st.perfects],
      ['DROPs', st.drops], ['Tempo final', `${st.bpm} BPM`], ['Durée', `${m}:${s}`], ['Graine', st.seed],
    ];
    $('stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><b></b><span>${k}</span></div>`).join('');
    [...$('stats').querySelectorAll('b')].forEach((b, i) => { b.textContent = stats[i][1]; });
    this.buildSeq(this.seqFinal, { tracks: st.tracks });
    this._prepareSong(st);
    this._showRewards(st);
    this.show('over');
  }

  /** Le morceau de la partie : construit depuis le journal des vagues et rangé dans la discothèque. */
  _prepareSong(st) {
    const song = songFromRunLog(st.songLog, {
      title: `${st.sector.name} — vague ${st.wave}`, seed: st.seed, origin: 'run',
      stats: { wave: st.wave, score: st.score, kit: st.kit },
    });
    this.overSong = song;
    $('over-song').classList.toggle('hidden', !song);
    $('dl-status').textContent = '';
    if (!song) return;
    const ok = saveSong(song);
    $('song-saved').textContent = ok ? 'Enregistré dans la discothèque' : 'Discothèque pleine ou indisponible';
    $('song-title').value = song.title;
    $('song-meta').textContent = this.songs.describe(song);
    this.songs.renderStructure($('song-structure'), song);
  }

  currentSong() {
    if (this.overSong) this.overSong.title = $('song-title').value.trim() || this.overSong.title;
    return this.overSong;
  }

  /** Exécute une action longue avec retour visuel sur le bouton. */
  async busy(btn, fn) {
    if (btn.classList.contains('busy')) return;
    const label = btn.innerHTML;
    btn.classList.add('busy');
    btn.textContent = 'Mixage en cours…';
    this.songs.onProgress = (x) => { btn.textContent = `Mixage ${Math.round(x * 100)} %`; };
    try {
      await fn();
      this.audio.ui('confirm');
    } catch (err) {
      console.error(err);
      $('dl-status').textContent = 'Export impossible dans ce navigateur.';
    } finally {
      btn.classList.remove('busy');
      btn.innerHTML = label;
    }
  }

  /** Bouton écouter / arrêter un morceau (avec minuteur). */
  async toggleListen(song, btn) {
    if (!song) return;
    if (this.songs.playingId === song.id) { this.songs.stop(); return; }
    const label = '▶ Écouter';
    btn.textContent = 'Mixage en cours…';
    btn.classList.add('busy');
    this.songs.onProgress = (x) => { if (this.songs.playingId !== song.id) btn.textContent = `Mixage ${Math.round(x * 100)} %`; };
    try {
      await this.songs.play(song, {
        onStart: (dur) => {
          btn.classList.remove('busy');
          clearInterval(this._listenTimer);
          this._listenTimer = setInterval(() => {
            btn.textContent = `■ Stop  ${fmtTime(this.songs.position)} / ${fmtTime(dur)}`;
          }, 250);
        },
        onEnd: () => { clearInterval(this._listenTimer); btn.textContent = label; btn.classList.remove('busy'); },
      });
    } catch (err) {
      console.error(err);
      btn.textContent = label;
      btn.classList.remove('busy');
    }
  }

  /** Bilan de progression : XP animée, Échos, succès, déblocages, prochain objectif. */
  _showRewards(st) {
    const p = this.profile;
    const r = finishRun(p, st);
    save(this.store);
    const achievements = [...this.runAchievements, ...r.achievements];
    this.runAchievements = [];

    const gains = $('rw-gains');
    gains.textContent = '';
    gains.appendChild(el('span', 'x', `+${fmt(r.xp)} XP`));
    gains.appendChild(el('span', 'e', `+${fmt(r.echoes + achievements.reduce((n, a) => n + a.reward, 0))} ◈`));
    if (r.mult > 1) gains.appendChild(el('span', 'm', `Intensité ${st.intensity} · gains ×${r.mult.toFixed(1)}`));

    const list = $('rw-list');
    list.textContent = '';
    const item = (cls, tag, text, delay) => {
      const row = el('div', `rw-item ${cls}`);
      row.style.animationDelay = `${delay}s`;
      row.appendChild(el('span', 'tag', tag));
      row.appendChild(el('span', '', text));
      list.appendChild(row);
    };
    let d = 0.9;
    for (const k of r.newKits) item('unlock', 'NOUVEAU KIT', `${k.name} — ${k.desc}`, (d += 0.25));
    if (r.intensityUp) item('unlock', 'INTENSITÉ', `Intensité ${r.intensityUnlocked} débloquée`, (d += 0.25));
    for (const a of achievements) item('rw-ach', 'SUCCÈS', `${a.name} · ◈ ${a.reward}`, (d += 0.15));
    // Prochain objectif : toujours donner une raison de relancer
    const goals = [];
    if (r.nextKit) goals.push(`Kit ${r.nextKit.name} au niveau ${r.nextKit.level}`);
    const cheapest = GEAR.map((g) => ({ g, c: gearNextCost(p, g.id) })).filter((x) => x.c !== null).sort((a, b) => a.c - b.c)[0];
    if (cheapest) {
      goals.push(cheapest.c <= p.echoes
        ? `Tu peux acheter « ${cheapest.g.name} » au Studio`
        : `« ${cheapest.g.name} » dans ${fmt(cheapest.c - p.echoes)} ◈`);
    }
    if (goals.length) item('goal', 'PROCHAIN OBJECTIF', goals.join(' · '), (d += 0.2));

    // barre d'XP animée (avec passages de niveau)
    const fill = $('rw-xp'), lvlEl = $('rw-level'), txt = $('rw-xp-text');
    let level = r.before.level;
    lvlEl.textContent = level;
    lvlEl.parentElement.classList.remove('up');
    fill.style.transition = 'none';
    fill.style.width = `${r.before.ratio * 100}%`;
    txt.textContent = `${fmt(r.before.into)} / ${fmt(r.before.need)} XP`;
    const step = () => {
      fill.style.transition = 'width 0.9s cubic-bezier(.3,.8,.3,1)';
      if (level < r.after.level) {
        fill.style.width = '100%';
        setTimeout(() => {
          level++;
          lvlEl.textContent = level;
          const box = lvlEl.parentElement;
          box.classList.remove('up'); void box.offsetWidth; box.classList.add('up');
          this.audio.ui('confirm');
          fill.style.transition = 'none';
          fill.style.width = '0%';
          void fill.offsetWidth;
          step();
        }, 950);
      } else {
        fill.style.width = `${r.after.ratio * 100}%`;
        txt.textContent = `${fmt(r.after.into)} / ${fmt(r.after.need)} XP`;
      }
    };
    setTimeout(step, 500);
    this.refreshProfile();
  }

  // ───────────────────────────── HUD (chaque frame) ─────────────────────────────

  frame() {
    this._theme();
    const g = this.game, run = g.run;
    if (!run || (this.screen !== 'game' && this.screen !== 'upgrade')) return;
    const c = this.cache;

    if (c.score !== run.score) { c.score = run.score; $('score').textContent = run.score.toLocaleString('fr-FR'); }

    const mult = g.comboMult.toFixed(1);
    if (c.combo !== run.combo) {
      const wrap = $('combo-wrap');
      if (run.combo > (c.combo || 0)) { wrap.classList.remove('bump'); void wrap.offsetWidth; wrap.classList.add('bump'); }
      c.combo = run.combo;
      $('combo').textContent = `×${mult}`;
      $('combo-count').textContent = run.combo > 0 ? `${run.combo} combo` : '';
      wrap.classList.toggle('on', run.combo > 0);
    }

    if (c.hp !== run.hp || c.maxHp !== run.maxHp) {
      const hpEl = $('hp');
      if (c.hp !== undefined && run.hp < c.hp) { hpEl.classList.remove('hurt'); void hpEl.offsetWidth; hpEl.classList.add('hurt'); }
      c.hp = run.hp; c.maxHp = run.maxHp;
      hpEl.innerHTML = Array.from({ length: run.maxHp }, (_, i) => `<i class="${i < run.hp ? '' : 'empty'}"></i>`).join('');
    }

    const wave = run.wave;
    if (c.wave !== wave) {
      c.wave = wave;
      $('wave-label').textContent = g.wave?.plan.boss ? `VAGUE ${wave} · BOSS` : `VAGUE ${wave}`;
      $('sector-label').textContent = `${g.sector.name} · ${g.sector.key}`;
    }
    if (c.bpm !== g.clock.bpm) {
      c.bpm = g.clock.bpm;
      $('bpm').textContent = g.clock.bpm;
      document.documentElement.style.setProperty('--beat', `${60 / g.clock.bpm}s`);
    }

    const drop = Math.round(run.drop * 100);
    const dropState = run.dropArmed ? 'armed' : drop >= 100 ? 'ready' : '';
    if (c.drop !== drop || c.dropState !== dropState) {
      c.drop = drop; c.dropState = dropState;
      $('drop-fill').style.width = `${drop}%`;
      const el = $('drop');
      el.classList.toggle('ready', dropState === 'ready');
      el.classList.toggle('armed', dropState === 'armed');
      $('drop-label').textContent = dropState === 'armed' ? 'SUR LE 1…' : dropState === 'ready' ? 'DROP PRÊT — E' : 'DROP';
    }

    const boss = g.boss && !g.boss.dead ? g.boss : null;
    const bossPct = boss ? Math.max(0, boss.hp / boss.maxHp) : -1;
    if (c.boss !== bossPct) {
      c.boss = bossPct;
      $('boss-bar').classList.toggle('hidden', !boss);
      if (boss) $('boss-fill').style.width = `${bossPct * 100}%`;
    }
  }
}
