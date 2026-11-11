// Film runtime: deterministic timeline of shots -> frames, timed overlays, soundtrack and the player UI.
// Every frame is a pure function of film time, so the same code drives live playback, scrubbing and the
// offline frame-by-frame renderer (tools/render.mjs).
import * as THREE from 'three';
import { Pipeline } from './pipeline.js';
import { renderSoundtrack, wavBytes } from './audio.js';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = t => Math.pow(clamp(t), 3);
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// piecewise-linear lookup through [[x, y], ...]
export const curve = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };
// smooth deterministic wobble in [-1, 1]
export const wobble = (t, seed = 0) => (Math.sin(t * 1.0 + seed * 12.9) + Math.sin(t * 2.31 + seed * 4.7 + 1.3) * 0.55 + Math.sin(t * 5.17 + seed * 9.1 + 0.4) * 0.28 + Math.sin(t * 11.3 + seed * 3.3 + 2.1) * 0.13) / 1.96;
// heading unit vector (deg clockwise from north) in world axes (+x east, +z south)
export const hdgVec = (deg, out = new THREE.Vector3()) => out.set(Math.sin(deg * Math.PI / 180), 0, -Math.cos(deg * Math.PI / 180));

const fmt = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class Film {
  constructor(def) {
    this.def = def; this.fps = def.fps || 30; this.duration = def.duration;
    this.shots = def.shots; this.params = new URLSearchParams(location.search);
    this.renderMode = this.params.has('render');
    this.narration = (def.narration && def.narration.lines) || [];
    this.t = 0; this.playing = false; this.captionsOn = true; this.muted = false; this.scale = 1;
    this.origin = new THREE.Vector3(); this._cam = {}; this._p = new THREE.Vector3();
    this.ready = this.init();
  }

  async init() {
    const def = this.def, P = this.params;
    this.frame = document.getElementById('frame'); this.canvas = document.getElementById('view'); this.ov = document.getElementById('ov');
    const W = +(P.get('w') || 0), H = +(P.get('h') || 0);
    let quality = { ...(def.quality || {}) };
    if (P.get('msaa')) quality.msaa = +P.get('msaa');
    if (!this.renderMode) {
      // lighter defaults on phones / software GL
      const small = Math.min(screen.width, screen.height) < 700 || navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900;
      if (small) { quality = { ...quality, msaa: 2, shadow: 1024, lowTerrain: true }; this.maxH = 720; }
    }
    this.quality = quality;
    this.pipe = new Pipeline(this.canvas, { width: W || 1280, height: H || 720, quality });
    if (P.has('prof')) this.pipe.prof = {};
    this.off = new Set((P.get('off') || '').split(',').filter(Boolean));   // dev: ?off=shadow,env,... disables features for profiling
    if (this.off.has('shadow')) this.pipe.sun.castShadow = false;
    if (P.get('aniso')) this.pipe.detail.anisotropy = +P.get('aniso');
    if (this.renderMode) { this.frame.style.width = (W || 1280) + 'px'; this.frame.style.height = (H || 720) + 'px'; document.body.classList.add('render'); }
    this.setStatus('Loading typefaces');
    try { await Promise.all(['700 64px "Saira Condensed"', '500 32px "Saira Condensed"', '400 20px "B612"', '700 20px "B612"', '400 20px "B612 Mono"', '700 20px "B612 Mono"'].map(f => document.fonts.load(f))); } catch (e) { /* fall back to system faces */ }
    this.setStatus('Building scene');
    await new Promise(r => setTimeout(r, 30));
    this.world = await def.build(this);
    this.buildOverlays();
    if (!this.renderMode) this.buildPlayer();
    this.resize();
    this.setStatus('Rendering first frame');
    await new Promise(r => setTimeout(r, 30));
    this.renderFrame(this.renderMode ? 0 : (def.poster ?? 0));
    this.setStatus('');
    document.body.classList.add('ready');
    if (!this.renderMode) document.body.classList.add('prestart');
    this.soundtrack = null;
    this.soundReady = renderSoundtrack(this.duration, def.score || (() => {}), this.narration).then(b => { this.soundtrack = b; return b; }).catch(e => { console.warn('soundtrack failed', e); return null; });
    return true;
  }
  setStatus(s) { const e = document.getElementById('status'); if (e) e.textContent = s; }

  shotAt(t) { const s = this.shots; for (let i = s.length - 1; i >= 0; i--) if (t >= s[i].t0) return s[i]; return s[0]; }

  place(obj, w) { obj.position.set(w.x - this.origin.x, w.y - this.origin.y, w.z - this.origin.z); }

  // the shot's camera; ?cam=x,y,z,lookx,looky,lookz,fov replaces it (look development only)
  cameraOf(shot, lt, t) {
    const c = shot.camera(lt, t, this), o = this.params.get('cam');
    if (!o) return c;
    const v = o.split(',').map(Number);
    return { ...c, pos: v3(v[0], v[1], v[2]), look: v3(v[3], v[4], v[5]), fov: v[6] || c.fov, up: undefined, shake: null };
  }
  applyShot(shot, lt, t) {
    const cam = this.pipe.camera, O = this.origin;
    shot.pose && shot.pose(lt, t, this);
    const c = this.cameraOf(shot, lt, t);
    cam.position.set(c.pos.x - O.x, c.pos.y - O.y, c.pos.z - O.z);
    cam.up.set(0, 1, 0);
    if (c.up) cam.up.copy(c.up);
    this._p.set(c.look.x - O.x, c.look.y - O.y, c.look.z - O.z);
    cam.lookAt(this._p);
    const sh = c.shake;
    if (sh) {
      const f = sh.freq ?? 1, s = sh.seed ?? 1, a = (sh.rot ?? 0) * Math.PI / 180;
      cam.rotateX(wobble(t * f * 6.3, s) * a); cam.rotateY(wobble(t * f * 6.3, s + 7) * a); cam.rotateZ(wobble(t * f * 4.1, s + 13) * a * 0.6 + (c.roll || 0) * Math.PI / 180);
      if (sh.jolt) { const j = sh.jolt * Math.PI / 180; cam.rotateX(wobble(t * 61, s + 3) * j); cam.rotateY(wobble(t * 53, s + 5) * j); }
    } else if (c.roll) cam.rotateZ(c.roll * Math.PI / 180);
    if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    return c;
  }

  renderFrame(t) {
    t = clamp(t, 0, this.duration - 1e-4); this.t = t;
    const pipe = this.pipe, shot = this.shotAt(t), lt = t - shot.t0, dt = 1 / this.fps;
    if (shot !== this._shot) { this._shot = shot; this.def.onShot && this.def.onShot(shot, this); shot.enter && shot.enter(this); }
    // floating origin = camera position at this instant
    const c0 = this.cameraOf(shot, lt, t); this.origin.copy(c0.pos);
    this.applyShot(shot, lt - dt, t - dt); pipe.snapshotPrev();
    const c = this.applyShot(shot, lt, t);
    pipe.origin.copy(this.origin); pipe.camAlt = this.origin.y;
    if (c.focus) { pipe.shadowFocus.set(c.focus.x - this.origin.x, c.focus.y - this.origin.y, c.focus.z - this.origin.z); pipe.shadowRadius = c.focusRadius ?? 12; }
    this.def.frame && this.def.frame(t, shot, lt, this, c);
    let post = { ...(this.def.post || {}), ...(typeof shot.post === 'function' ? shot.post(lt, t, this) : (shot.post || {})) };
    let fade = post.fade ?? 1;
    if (shot.fadeIn) fade *= smooth(0, shot.fadeIn, lt);
    if (shot.fadeOut) fade *= 1 - smooth(shot.t1 - shot.fadeOut, shot.t1, t);
    fade *= smooth(0, this.def.fadeIn ?? 0.6, t) * (1 - smooth(this.duration - (this.def.fadeOut ?? 1.0), this.duration - 0.05, t));
    post.fade = fade; post.envKey = post.envKey ?? shot.id;
    if (this.off.size) { if (this.off.has('ao')) post.ao = false; if (this.off.has('cirrus')) post.cirrus = null; if (this.off.has('blur')) post.shutter = 0; if (this.off.has('dof')) post.dof = null; if (this.params.get('debug')) post.debug = this.params.get('debug'); }
    pipe.render(t, Math.floor(t * this.fps + 1e-6), post);
    this.updateOverlays(t, shot, lt);
  }

  // ---------------------------------------------------------------- overlays
  buildOverlays() {
    const ov = this.ov, def = this.def; ov.innerHTML = '';
    this.oTag = el('div', 'ov-tag', `<i></i><span>${def.simTag || 'SIMULATED VISUALIZATION'}</span><b>NOT ACTUAL FOOTAGE</b>`); ov.append(this.oTag);
    this.oHud = el('div', 'ov-hud'); ov.append(this.oHud);
    this.cues = (def.cues || []).map(c => {
      let e;
      if (c.type === 'l3') e = el('div', 'ov-l3', `<div class="k">${c.kicker || ''}</div><div class="t">${c.title || ''}</div>${c.sub ? `<div class="s">${c.sub}</div>` : ''}`);
      else if (c.type === 'title') e = el('div', 'ov-title', `${c.kicker ? `<div class="k">${c.kicker}</div>` : ''}<div class="t">${c.title}</div>${c.sub ? `<div class="s">${c.sub}</div>` : ''}`);
      else if (c.type === 'stat') e = el('div', 'ov-stat' + (c.side === 'left' ? ' left' : ''), `<div class="n">${c.value}</div><div class="l">${c.label}</div>`);
      else if (c.type === 'quote') e = el('div', 'ov-quote', `<blockquote>${c.text}</blockquote><cite>${c.cite}</cite>`);
      else e = el('div', 'ov-card', c.html);
      e.style.opacity = 0; ov.append(e); return { ...c, e };
    });
    this.oCap = el('div', 'ov-cap'); this.oCapT = el('span'); this.oCap.append(this.oCapT); ov.append(this.oCap);
    def.buildHud && def.buildHud(this.oHud, this);
    this._capId = null;
  }
  updateOverlays(t, shot, lt) {
    for (const c of this.cues) {
      const fi = c.fadeIn ?? 0.45, fo = c.fadeOut ?? 0.45;
      const a = smooth(c.t0, c.t0 + fi, t) * (1 - smooth(c.t1 - fo, c.t1, t));
      if (a !== c._a) { c._a = a; c.e.style.opacity = a.toFixed(3); c.e.style.visibility = a > 0.001 ? 'visible' : 'hidden'; const k = (1 - easeOut(clamp((t - c.t0) / 0.9))) * 1.2; c.e.style.setProperty('--slide', k.toFixed(3)); }
    }
    // captions follow the narration
    let line = null;
    for (const l of this.narration) if (t >= l.t - 0.02 && t < l.t + (l.dur || 2) + 0.35) line = l;
    const id = line ? line.id : null;
    if (id !== this._capId) { this._capId = id; this.oCapT.textContent = line ? line.text : ''; }
    const ca = line && this.captionsOn ? smooth(line.t - 0.02, line.t + 0.14, t) * (1 - smooth(line.t + line.dur + 0.15, line.t + line.dur + 0.35, t)) : 0;
    this.oCap.style.opacity = ca.toFixed(3);
    this.oTag.style.opacity = (this.def.tagOpacity ? this.def.tagOpacity(t) : 0.78).toFixed(3);
    this.def.updateHud && this.def.updateHud(t, shot, lt, this);
  }

  // ---------------------------------------------------------------- player
  buildPlayer() {
    const def = this.def, ui = document.getElementById('ui');
    this.btnPlay = document.getElementById('btn-play'); this.seekEl = document.getElementById('seek'); this.timeEl = document.getElementById('time');
    this.btnCC = document.getElementById('btn-cc'); this.btnMute = document.getElementById('btn-mute'); this.btnFs = document.getElementById('btn-fs');
    this.startEl = document.getElementById('start'); this.btnStart = document.getElementById('btn-start');
    this.seekEl.max = String(Math.round(this.duration * 100)); this.seekEl.value = '0';
    const ticks = document.getElementById('ticks');
    if (ticks) ticks.innerHTML = this.shots.slice(1).map(s => `<i style="left:${(s.t0 / this.duration * 100).toFixed(3)}%"></i>`).join('');
    const begin = () => { this.startEl.hidden = true; document.body.classList.remove('prestart'); };
    this.begin = begin;
    this.btnStart.addEventListener('click', () => { begin(); this.seek(0); this.play(); });
    this.btnPlay.addEventListener('click', () => this.toggle());
    this.canvas.addEventListener('click', () => { if (this.startEl.hidden) this.toggle(); });
    this.seekEl.addEventListener('input', () => { begin(); this.seek(+this.seekEl.value / 100); });
    this.btnCC.addEventListener('click', () => { this.captionsOn = !this.captionsOn; this.btnCC.setAttribute('aria-pressed', this.captionsOn); if (!this.playing) this.renderFrame(this.t); });
    this.btnMute.addEventListener('click', () => { this.muted = !this.muted; this.btnMute.setAttribute('aria-pressed', this.muted); if (this.gainNode) this.gainNode.gain.value = this.muted ? 0 : 1; });
    this.btnFs.addEventListener('click', () => { const s = document.getElementById('stage'); try { (document.fullscreenElement ? document.exitFullscreen() : s.requestFullscreen()).catch(() => {}); } catch (e) { /* optional */ } });
    window.addEventListener('keydown', e => {
      if (e.target && /INPUT|BUTTON/.test(e.target.tagName) && e.key === ' ') return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (!this.startEl.hidden) { begin(); this.seek(0); this.play(); } else this.toggle(); }
      else if (e.key === 'ArrowRight') this.seek(this.t + 2); else if (e.key === 'ArrowLeft') this.seek(this.t - 2);
      else if (e.key === 'c') this.btnCC.click(); else if (e.key === 'm') this.btnMute.click(); else if (e.key === 'f') this.btnFs.click();
    });
    let idle; const wake = () => { ui.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => { if (this.playing) ui.classList.add('idle'); }, 2600); };
    ['mousemove', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, wake, { passive: true }));
    window.addEventListener('resize', () => { this.resize(); if (!this.playing) this.renderFrame(this.t); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.playing) this.pause(); });
    this.syncUi();
  }
  resize() {
    if (this.renderMode) return;
    const r = this.frame.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    let h = Math.min(r.height * dpr, this.maxH || 1080) * this.scale, w = h * 16 / 9;
    this.pipe.setSize(w, h);
  }
  syncUi() {
    if (!this.btnPlay) return;
    this.btnPlay.setAttribute('aria-label', this.playing ? 'Pause' : 'Play'); this.btnPlay.dataset.state = this.playing ? 'pause' : 'play';
    this.seekEl.value = String(Math.round(this.t * 100)); this.seekEl.style.setProperty('--p', (this.t / this.duration * 100).toFixed(2) + '%');
    this.timeEl.textContent = `${fmt(this.t)} / ${fmt(this.duration)}`;
  }
  async startAudio(at) {
    this.stopAudio();
    if (!this.audio) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.audio = new AC(); this.gainNode = this.audio.createGain(); this.gainNode.connect(this.audio.destination); this.gainNode.gain.value = this.muted ? 0 : 1; }
    try { await this.audio.resume(); } catch (e) { /* stays silent */ }
    if (!this.soundtrack) return; // still rendering: play picture first, sound joins on next seek/play
    const s = this.audio.createBufferSource(); s.buffer = this.soundtrack; s.connect(this.gainNode); s.start(0, clamp(at, 0, this.duration - 0.01)); this.source = s;
    this.audioT0 = this.audio.currentTime - at;
  }
  stopAudio() { if (this.source) { try { this.source.stop(); } catch (e) { /* already stopped */ } this.source.disconnect(); this.source = null; } }
  async play() {
    if (this.playing) return;
    if (this.t >= this.duration - 0.05) this.t = 0;
    this.playing = true; this.wall0 = performance.now() - this.t * 1000;
    await this.startAudio(this.t);
    if (this.soundtrack === null) this.soundReady.then(() => { if (this.playing && !this.source) this.startAudio(this.t); });
    this.syncUi(); this._ft = performance.now(); this._slow = 0;
    const loop = () => {
      if (!this.playing) return;
      const now = performance.now();
      const t = this.source && this.audio ? this.audio.currentTime - this.audioT0 : (now - this.wall0) / 1000;
      if (t >= this.duration) { this.pause(); this.t = this.duration; this.renderFrame(this.duration); this.syncUi(); document.getElementById('ui').classList.remove('idle'); return; }
      this.renderFrame(t); this.syncUi();
      // adaptive resolution: step down if frames run long, back up when there is headroom
      const ft = now - this._ft; this._ft = now; this._acc = (this._acc || 16) * 0.9 + ft * 0.1; this._n = (this._n || 0) + 1;
      if (this._n > 40) { this._n = 0; if (this._acc > 36 && this.scale > 0.5) { this.scale = Math.max(0.5, this.scale - 0.125); this.resize(); } else if (this._acc < 19 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.125); this.resize(); } }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  pause() { this.playing = false; this.stopAudio(); this.syncUi(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t) { t = clamp(t, 0, this.duration); this.t = t; this.wall0 = performance.now() - t * 1000; if (this.playing) this.startAudio(t); this.renderFrame(t); this.syncUi(); }

  // ---------------------------------------------------------------- offline API (tools/render.mjs)
  offlineFrame(t) {
    this.renderFrame(t);
    const gl = this.pipe.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return true;
  }
  async audioChunks() {
    const buf = await this.soundReady; if (!buf) return [];
    const bytes = wavBytes(buf), out = []; const CH = 3 * 1024 * 256;
    for (let i = 0; i < bytes.length; i += CH) { let s = ''; const sub = bytes.subarray(i, i + CH); for (let j = 0; j < sub.length; j += 8192) s += String.fromCharCode.apply(null, sub.subarray(j, j + 8192)); out.push(btoa(s)); }
    return out;
  }
}

export function startFilm(def) {
  const film = new Film(def);
  window.FILM = {
    ready: film.ready, duration: def.duration, fps: film.fps, film,
    renderFrame: t => film.offlineFrame(t),
    audioChunks: () => film.audioChunks(),
    shots: def.shots.map(s => ({ id: s.id, name: s.name, t0: s.t0, t1: s.t1, note: s.note || '' })),
  };
  film.ready.catch(e => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'This film needs WebGL 2 to play. ' + (e && e.message ? e.message : ''); });
  return film;
}
