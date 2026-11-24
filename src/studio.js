// Studio de création (mini-DAW) et discothèque.
// Le Studio édite un « projet » : patterns A/B, son (style, tonalité, progression, tempo)
// et arrangement en sections. La boucle joue en direct via l'horloge du jeu ;
// « Morceau » rend tout l'arrangement hors-ligne, exactement comme les exports.

import { TRACK_ORDER, TRACK_DEFS, isMelodic, PITCH_RANGE } from './game/tracks.js';
import { STYLES, STYLE_ORDER, styleById } from './music/styles.js';
import { PROGRESSIONS, MODE_LABELS, NOTE_NAMES_FR, CHORD_TONE_LABELS, chordName, rootForPc } from './music/theory.js';
import { previewNote, SECTION_LABELS } from './music/arranger.js';
import {
  newProject, projectHarmony, projectToSong, songToProject, regenerateMotif, templateSections,
  TEMPLATES, SECTION_TYPES, BAR_CHOICES,
} from './music/project.js';
import { songLength } from './music/song.js';
import { loadLibrary, saveSong, deleteSong } from './music/library.js';
import { fmtTime } from './songtools.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const option = (value, label) => { const o = el('option', '', label); o.value = value; return o; };

const INSTRUMENT_NAMES = {
  kick: () => 'Grosse caisse',
  hat: () => 'Charleston',
  snare: (s) => ({ snare: 'Caisse claire', clap: 'Clap', rim: 'Rimshot' }[s.snare.type]),
  bass: (s) => ({ pluck: 'Basse pluck', acid: 'Acid 303', sub: 'Sub', reese: 'Reese' }[s.bass.type]),
  lead: (s) => ({ supersaw: 'Supersaw', stab: 'Stab', fm: 'Cloche FM', brass: 'Cuivres' }[s.lead.type]),
};
const TRACK_COLORS = { kick: '--a', hat: '--c', snare: '--b', bass: '--d', lead: '--b' };

export class StudioUI {
  constructor({ game, audio, songs, ui }) {
    this.game = game;
    this.audio = audio;
    this.songs = songs;
    this.ui = ui;
    this.project = null;
    this.pat = 'A';
    this.looping = false;
    this.cells = null;
    this.now = -1;
    this._bind();
  }

  // ───────────────────────────── ouverture ─────────────────────────────

  open(projectOrSong = null) {
    this.songs.stop();
    let p;
    if (!projectOrSong) p = newProject();
    else if (projectOrSong.patterns) p = projectOrSong;
    else p = songToProject(projectOrSong);
    // dans le Studio, toutes les pistes sont éditables
    for (const pat of Object.values(p.patterns)) for (const id of TRACK_ORDER) pat[id].unlocked = true;
    this.project = p;
    this.pat = 'A';
    this.looping = false;
    this.game.startStudio((ev) => this._provider(ev), p.bpm, styleById(p.style).swing);
    this.renderAll();
    this.status('Clique sur ▶ Boucle pour écouter ton pattern en direct pendant que tu l’édites.');
    this.ui.show('create');
  }

  _provider() {
    if (!this.looping || !this.project) return null;
    const p = this.project;
    return { tracks: p.patterns[this.pat], harmony: projectHarmony(p), style: styleById(p.style), boss: false };
  }

  get ctx() {
    const p = this.project;
    return { tracks: p.patterns[this.pat], harmony: projectHarmony(p), style: styleById(p.style), boss: false };
  }

  status(text) { $('cr-status').textContent = text; }

  // ───────────────────────────── liaisons ─────────────────────────────

  _bind() {
    const click = (id, fn) => $(id).addEventListener('click', () => { this.audio.ui('click'); fn(); });

    for (const id of STYLE_ORDER) $('cr-style').appendChild(option(id, STYLES[id].name));
    NOTE_NAMES_FR.forEach((n, pc) => $('cr-key').appendChild(option(pc, n)));
    for (const [m, label] of Object.entries(MODE_LABELS)) $('cr-mode').appendChild(option(m, label));
    for (const pr of PROGRESSIONS) $('cr-prog').appendChild(option(pr.id, pr.name));
    $('cr-template').appendChild(option('', 'Appliquer une structure…'));
    for (const [id, t] of Object.entries(TEMPLATES)) $('cr-template').appendChild(option(id, t.name));

    click('cr-back', () => this.close());
    click('cr-loop', () => this.toggleLoop());
    click('cr-listen', () => this.listen());
    click('cr-save', () => this.save());
    click('cr-wav', () => this._export('wav'));
    click('cr-mid', () => this._export('mid'));
    click('cr-copy', () => {
      this.project.patterns.B = JSON.parse(JSON.stringify(this.project.patterns.A));
      this.renderEditor();
      this.status('Pattern A copié dans B : fais-le évoluer pour créer ton refrain ou ton drop.');
    });
    click('cr-add', () => {
      this.project.arrangement.push({ type: 'full', pattern: this.pat, bars: 8 });
      this.renderArrangement();
    });
    for (const tab of document.querySelectorAll('.pat-tabs .tab')) {
      tab.addEventListener('click', () => { this.audio.ui('click'); this.pat = tab.dataset.pat; this.renderEditor(); });
    }

    $('cr-title').addEventListener('input', () => { this.project.title = $('cr-title').value.trim() || 'Sans titre'; });
    $('cr-bpm').addEventListener('change', () => {
      const v = Math.max(70, Math.min(180, Math.round(+$('cr-bpm').value || 118)));
      $('cr-bpm').value = v;
      this.project.bpm = v;
      this.game.clock.setBpm(v);
      this.renderArrangement();
    });
    $('cr-style').addEventListener('change', () => {
      this.project.style = $('cr-style').value;
      this.game.clock.swing = styleById(this.project.style).swing;
      this.renderEditor();
      this.renderChords();
    });
    const keyChange = () => {
      this.project.root = rootForPc(+$('cr-key').value);
      this.project.mode = $('cr-mode').value;
      this.renderChords();
    };
    $('cr-key').addEventListener('change', keyChange);
    $('cr-mode').addEventListener('change', keyChange);
    $('cr-prog').addEventListener('change', () => { this.project.progId = $('cr-prog').value; this.renderChords(); });
    $('cr-template').addEventListener('change', () => {
      const id = $('cr-template').value;
      if (!id) return;
      this.project.arrangement = templateSections(id);
      $('cr-template').value = '';
      this.renderArrangement();
    });

    window.addEventListener('keydown', (e) => {
      if (this.ui.screen !== 'create' || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') { e.preventDefault(); this.toggleLoop(); }
      if (e.code === 'Tab') { e.preventDefault(); this.pat = this.pat === 'A' ? 'B' : 'A'; this.renderEditor(); }
    });

    click('lib-new', () => this.open());
  }

  close() {
    this.looping = false;
    this.songs.stop();
    this.ui.toTitle();
  }

  // ───────────────────────────── transport ─────────────────────────────

  toggleLoop() {
    this.songs.stop();
    this.looping = !this.looping;
    $('cr-loop').textContent = this.looping ? '■ Boucle' : '▶ Boucle';
    $('cr-loop').classList.toggle('btn-primary', this.looping);
    if (!this.looping) this._clearPlayhead();
  }

  async listen() {
    const btn = $('cr-listen');
    if (this.songs.playingId === this.project.id) { this.songs.stop(); return; }
    if (this.looping) this.toggleLoop();
    const song = projectToSong(this.project);
    btn.textContent = 'Mixage…';
    btn.classList.add('busy');
    this.songs.onProgress = (x) => { if (this.songs.playingId !== song.id) btn.textContent = `Mixage ${Math.round(x * 100)} %`; };
    try {
      await this.songs.play(song, {
        onStart: (dur) => {
          btn.classList.remove('busy');
          clearInterval(this._timer);
          this._timer = setInterval(() => {
            btn.textContent = `■ ${fmtTime(this.songs.position)} / ${fmtTime(dur)}`;
            this._highlightSection(this.songs.position);
          }, 200);
        },
        onEnd: () => {
          clearInterval(this._timer);
          btn.textContent = '▶ Morceau';
          btn.classList.remove('busy');
          this._highlightSection(-1);
        },
      });
    } catch (err) {
      console.error(err);
      btn.textContent = '▶ Morceau';
      btn.classList.remove('busy');
    }
  }

  _highlightSection(t) {
    const blocks = [...document.querySelectorAll('#cr-arr .sec-block')];
    let acc = 0.05;
    this.project.arrangement.forEach((s, i) => {
      const d = s.bars * 240 / this.project.bpm;
      blocks[i]?.classList.toggle('playing', t >= acc && t < acc + d);
      acc += d;
    });
  }

  save() {
    const ok = saveSong(projectToSong(this.project));
    this.status(ok ? `« ${this.project.title} » enregistré dans la discothèque.` : 'Impossible d’enregistrer (stockage plein ou bloqué).');
    if (ok) this.audio.ui('confirm');
  }

  async _export(kind) {
    const song = projectToSong(this.project);
    const btn = $(kind === 'wav' ? 'cr-wav' : 'cr-mid');
    if (kind === 'mid') {
      const r = this.songs.downloadMidi(song);
      this.status(`Partition MIDI exportée (${(r.bytes / 1024).toFixed(1)} Ko) : batterie, basse, lead et nappe sur 4 pistes, tempo et sections inclus.`);
      return;
    }
    const label = btn.innerHTML;
    btn.classList.add('busy'); btn.textContent = 'Mixage…';
    this.songs.onProgress = (x) => { btn.textContent = `${Math.round(x * 100)} %`; };
    try {
      const r = await this.songs.downloadWav(song);
      this.status(`Fichier audio exporté : ${fmtTime(r.seconds)} · ${(r.bytes / 1048576).toFixed(1)} Mo · WAV 44,1 kHz stéréo.`);
    } catch (err) {
      console.error(err);
      this.status('Export audio impossible dans ce navigateur.');
    } finally {
      btn.classList.remove('busy'); btn.innerHTML = label;
    }
  }

  // ───────────────────────────── rendu ─────────────────────────────

  renderAll() {
    const p = this.project;
    $('cr-title').value = p.title;
    $('cr-bpm').value = p.bpm;
    $('cr-style').value = p.style;
    $('cr-key').value = ((p.root % 12) + 12) % 12;
    $('cr-mode').value = p.mode;
    $('cr-prog').value = p.progId;
    this.renderChords();
    this.renderEditor();
    this.renderArrangement();
  }

  renderChords() {
    const wrap = $('cr-chords');
    wrap.textContent = '';
    const h = projectHarmony(this.project);
    const st = styleById(this.project.style);
    this.chordEls = [];
    for (let bar = 0; bar < 8; bar++) {
      const c = el('span', '', chordName(h, bar, st.sevenths));
      c.title = bar < 4 ? `Partie A, mesure ${bar + 1}` : `Partie B, mesure ${bar - 3}`;
      wrap.appendChild(c);
      this.chordEls.push(c);
    }
  }

  renderEditor() {
    for (const tab of document.querySelectorAll('.pat-tabs .tab')) tab.classList.toggle('active', tab.dataset.pat === this.pat);
    const wrap = $('cr-editor');
    wrap.textContent = '';
    const pattern = this.project.patterns[this.pat];
    const st = styleById(this.project.style);
    const root = getComputedStyle(document.documentElement);
    this.cells = {};
    this.now = -1;

    for (const id of TRACK_ORDER) {
      const tr = pattern[id];
      const melodic = isMelodic(id);
      const block = el('div', `ed-block${melodic ? '' : ' drum'}`);
      block.style.setProperty('--tc', root.getPropertyValue(TRACK_COLORS[id]).trim() || '#fff');
      const head = el('div', 'ed-head');
      head.appendChild(el('b', '', TRACK_DEFS[id].label));
      head.appendChild(el('small', '', INSTRUMENT_NAMES[id](st)));
      const echo = el('button', `mini${tr.mods.echo ? ' on' : ''}`, 'Écho');
      echo.title = 'Rejoue chaque note une double-croche plus tard, avec delay';
      echo.addEventListener('click', () => { tr.mods.echo = !tr.mods.echo; echo.classList.toggle('on', tr.mods.echo); });
      head.appendChild(echo);
      if (melodic) {
        const gen = el('button', 'mini', '✦ Inspirer');
        gen.title = 'Propose une nouvelle mélodie sur les mêmes rythmes';
        gen.addEventListener('click', () => {
          regenerateMotif(pattern, id, `${Date.now()}`);
          this.renderEditor();
          this.status('Nouvelle mélodie proposée. Ajuste les notes à ton goût.');
        });
        head.appendChild(gen);
      }
      const clear = el('button', 'mini', 'Vider');
      clear.addEventListener('click', () => { tr.steps.fill(false); this.renderEditor(); });
      head.appendChild(clear);
      block.appendChild(head);

      const rows = melodic ? PITCH_RANGE[id] : 1;
      this.cells[id] = [];
      for (let r = rows - 1; r >= 0; r--) {
        const row = el('div', 'ed-row');
        row.appendChild(el('div', `lbl${melodic && [0, 2, 4].includes(r) ? ' stable' : ''}`, melodic ? CHORD_TONE_LABELS[r] : ''));
        const rowCells = [];
        for (let s = 0; s < 16; s++) {
          const c = el('div', `ed-cell${s % 4 === 0 ? ' beat' : ''}`);
          const on = () => tr.steps[s] && (!melodic || tr.pitch[s] === r);
          c.classList.toggle('on', on());
          c.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (melodic) {
              if (on()) tr.steps[s] = false;
              else { tr.steps[s] = true; tr.pitch[s] = r; }
              for (const rc of this.cells[id]) rc[s].classList.toggle('on', tr.steps[s] && tr.pitch[s] === rc.pitch);
            } else {
              tr.steps[s] = !tr.steps[s];
              c.classList.toggle('on', tr.steps[s]);
            }
            if (tr.steps[s]) this._preview(id, s, melodic ? r : 0);
          });
          row.appendChild(c);
          rowCells.push(c);
        }
        rowCells.pitch = r;
        this.cells[id].push(rowCells);
        block.appendChild(row);
      }
      wrap.appendChild(block);
    }
  }

  _preview(id, step, pitch) {
    const g = this.game;
    previewNote(this.audio, this.ctx, id, step, pitch, g.clock.bar, g.clock.stepDur, this.audio.now + 0.01);
  }

  renderArrangement() {
    const p = this.project;
    const wrap = $('cr-arr');
    wrap.textContent = '';
    p.arrangement.forEach((sec, i) => {
      const b = el('div', `sec-block sec-${sec.type}`);
      const type = el('select');
      for (const t of SECTION_TYPES) type.appendChild(option(t, SECTION_LABELS[t]));
      type.value = sec.type;
      type.addEventListener('change', () => { sec.type = type.value; this.renderArrangement(); });
      const row = el('div', 'sec-row');
      const pat = el('select');
      for (const k of ['A', 'B']) pat.appendChild(option(k, `Pat. ${k}`));
      pat.value = sec.pattern;
      pat.addEventListener('change', () => { sec.pattern = pat.value; });
      const bars = el('select');
      for (const n of BAR_CHOICES) bars.appendChild(option(n, `${n} mes.`));
      bars.value = sec.bars;
      bars.addEventListener('change', () => { sec.bars = +bars.value; this.renderArrangement(); });
      row.append(pat, bars);
      const tools = el('div', 'sec-tools');
      const btn = (label, title, fn) => { const x = el('button', '', label); x.title = title; x.addEventListener('click', fn); tools.appendChild(x); };
      btn('←', 'Déplacer avant', () => { if (i > 0) { [p.arrangement[i - 1], p.arrangement[i]] = [p.arrangement[i], p.arrangement[i - 1]]; this.renderArrangement(); } });
      btn('⧉', 'Dupliquer', () => { p.arrangement.splice(i + 1, 0, { ...sec }); this.renderArrangement(); });
      btn('✕', 'Supprimer', () => { if (p.arrangement.length > 1) { p.arrangement.splice(i, 1); this.renderArrangement(); } });
      btn('→', 'Déplacer après', () => { if (i < p.arrangement.length - 1) { [p.arrangement[i + 1], p.arrangement[i]] = [p.arrangement[i], p.arrangement[i + 1]]; this.renderArrangement(); } });
      b.append(type, row, tools);
      wrap.appendChild(b);
    });
    const { seconds, bars } = songLength(projectToSong(p));
    $('cr-len').textContent = `${p.arrangement.length} sections · ${bars} mesures · ${fmtTime(seconds)}`;
  }

  // ───────────────────────────── tête de lecture ─────────────────────────────

  _clearPlayhead() {
    if (!this.cells || this.now < 0) return;
    for (const rows of Object.values(this.cells)) for (const r of rows) r[this.now]?.classList.remove('now');
    this.now = -1;
    for (const c of this.chordEls || []) c.classList.remove('now');
  }

  onStep(ev) {
    if (this.ui.screen !== 'create' || !this.looping || !this.cells) return;
    for (const rows of Object.values(this.cells)) {
      for (const r of rows) {
        if (this.now >= 0) r[this.now]?.classList.remove('now');
        r[ev.step]?.classList.add('now');
      }
    }
    this.now = ev.step;
    if (ev.step === 0 && this.chordEls) this.chordEls.forEach((c, i) => c.classList.toggle('now', i === ev.bar % 8));
  }

  // ───────────────────────────── discothèque ─────────────────────────────

  openLibrary() {
    this.renderLibrary();
    this.ui.backTarget = 'title';
    this.ui.show('library');
  }

  renderLibrary() {
    const list = loadLibrary();
    const wrap = $('lib-list');
    wrap.textContent = '';
    if (!list.length) {
      wrap.appendChild(el('div', 'lib-empty', 'Aucun morceau pour l’instant. Joue une partie ou ouvre le Studio de création.'));
      return;
    }
    for (const song of list) {
      const item = el('div', 'lib-item');
      const h = el('h4', '', song.title);
      h.appendChild(el('small', '', song.origin === 'studio' ? 'STUDIO' : 'PARTIE'));
      item.appendChild(h);
      const meta = el('div', 'song-meta', this.songs.describe(song));
      item.appendChild(meta);
      const structure = el('div', 'song-structure');
      this.songs.renderStructure(structure, song);
      item.appendChild(structure);

      const actions = el('div', 'lib-actions');
      const act = (label, fn, cls = 'btn btn-download') => {
        const b = el('button', cls, label);
        b.addEventListener('click', () => { this.audio.ui('click'); fn(b); });
        actions.appendChild(b);
        return b;
      };
      act('▶ Écouter', (b) => this.ui.toggleListen(song, b));
      act('⤓ .wav', async (b) => {
        const label = b.innerHTML; b.classList.add('busy'); b.textContent = 'Mixage…';
        this.songs.onProgress = (x) => { b.textContent = `${Math.round(x * 100)} %`; };
        try {
          const r = await this.songs.downloadWav(song);
          $('lib-status').textContent = `« ${song.title} » exporté : ${fmtTime(r.seconds)}, ${(r.bytes / 1048576).toFixed(1)} Mo.`;
        } finally { b.classList.remove('busy'); b.innerHTML = label; }
      });
      act('⤓ .mid', () => { this.songs.downloadMidi(song); $('lib-status').textContent = `Partition de « ${song.title} » exportée.`; });
      act('♫ Studio', () => this.open(song), 'btn');
      act('Supprimer', (b) => {
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmer ?'; return; }
        this.songs.stop();
        deleteSong(song.id);
        this.renderLibrary();
      }, 'btn btn-ghost');
      item.appendChild(actions);
      wrap.appendChild(item);
    }
  }
}
