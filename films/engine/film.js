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

// sample sequences for the offline accumulation (deterministic)
const fract = x => x - Math.floor(x);
const R2G = 1.32471795724474602596;   // plastic number: R2 low-discrepancy sequence (k/g, k/g^2)
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
// uniform point on the unit disc from two numbers in [0, 1) (Shirley-Chiu concentric map)
const disc = (u, v) => { const a = 2 * u - 1, b = 2 * v - 1; if (a === 0 && b === 0) return [0, 0]; let r, th; if (Math.abs(a) > Math.abs(b)) { r = a; th = Math.PI / 4 * (b / a); } else { r = b; th = Math.PI / 2 - Math.PI / 4 * (a / b); } return [r * Math.cos(th), r * Math.sin(th)]; };
// point i of the R2 sequence, toroidally shifted by o (Cranley-Patterson rotation): well spread in 2D for any N
const r2 = (i, o) => [fract(o[0] + i / R2G), fract(o[1] + i / (R2G * R2G))];
// [0, 1) -> [-1, 1] with a tent density (importance-samples a 1-pixel-radius tent reconstruction filter)
const tent = u => u < 0.5 ? Math.sqrt(2 * u) - 1 : 1 - Math.sqrt(2 - 2 * u);
// 0..n-1 in a fixed shuffled order; seed picks the order
const hash32 = x => { x = Math.imul(x ^ (x >>> 16), 0x7feb352d); x = Math.imul(x ^ (x >>> 15), 0x846ca68b); return (x ^ (x >>> 16)) >>> 0; };
const shuffled = (n, seed = 0) => { const p = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(hash32((Math.imul(seed + 1, 0x9e3779b9) ^ Math.imul(n, 0x85ebca6b) ^ i) >>> 0) / 4294967296 * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } return p; };
const corr = (a, b) => { const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i] / n; mb += b[i] / n; } let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb || 1); };
// The N samples of one accumulated frame: sub-render k gets time stratum time[k], sub-pixel offset R2(k), lens point
// Halton(lens[k] + 1) and sun-disc and shadow-texel points R2(sun[k]), R2(texel[k]) (each with its own toroidal
// shift). Each dimension is low-discrepancy on its own; the orders pair them up. Of 64 candidate sets of orders the
// one whose worst correlation between any two dimensions is smallest is kept (about 0.39 at N = 16, 0.19 at 64), so
// no dimension leans on another (a sun offset that follows the pixel offset would sharpen penumbrae along one axis).
const SUN_O = [0.271, 0.613], TEX_O = [0.147, 0.889], plans = new Map();
function samplePlan(N) {
  if (plans.has(N)) return plans.get(N);
  let best = null;
  for (let s = 0; s < 64 && N > 2; s++) {
    const time = shuffled(N, 4 * s), sun = shuffled(N, 4 * s + 1), texel = shuffled(N, 4 * s + 2), lens = shuffled(N, 4 * s + 3), d = Array.from({ length: 9 }, () => []);
    for (let k = 0; k < N; k++) [(time[k] + 0.5) / N, fract(0.5 + k / R2G), fract(0.5 + k / (R2G * R2G)), halton(lens[k] + 1, 2), halton(lens[k] + 1, 3), ...r2(sun[k], SUN_O), ...r2(texel[k], TEX_O)].forEach((x, i) => d[i].push(x));
    let worst = 0;   // across dimensions (the two coordinates of one 2D point set do not depend on the order)
    for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) if (!(a % 2 === 1 && b === a + 1)) worst = Math.max(worst, Math.abs(corr(d[a], d[b])));
    if (!best || worst < best.worst) best = { time, sun, texel, lens, worst };
  }
  if (!best) { const id = Array.from({ length: N }, (_, i) => i); best = { time: id, sun: id, texel: id, lens: id, worst: 0 }; }
  plans.set(N, best);
  return best;
}

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
    this.W0 = W || 1280; this.H0 = H || 720; this.accum = null;   // output size; accumulation state while renderAccum runs
    if (P.has('prof')) this.pipe.prof = {};
    // a lost graphics context (tab backgrounded on a phone, driver reset) takes every baked table with it: say so, and start clean when it returns
    this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.playing = false; this.setStatus('Graphics were reset by the browser. Reloading…'); });
    this.canvas.addEventListener('webglcontextrestored', () => location.reload());
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

  // the shot's grade and lens at film time t (shot post over the film's, fades, dev switches)
  postOf(shot, lt, t) {
    let post = { ...(this.def.post || {}), ...(typeof shot.post === 'function' ? shot.post(lt, t, this) : (shot.post || {})) };
    let fade = post.fade ?? 1;
    if (shot.fadeIn) fade *= smooth(0, shot.fadeIn, lt);
    if (shot.fadeOut) fade *= 1 - smooth(shot.t1 - shot.fadeOut, shot.t1, t);
    fade *= smooth(0, this.def.fadeIn ?? 0.6, t) * (1 - smooth(this.duration - (this.def.fadeOut ?? 1.0), this.duration - 0.05, t));
    post.fade = fade; post.envKey = post.envKey ?? shot.id;
    if (this.off.size) { if (this.off.has('ao')) post.ao = false; if (this.off.has('cirrus')) post.cirrus = null; if (this.off.has('blur')) post.shutter = 0; if (this.off.has('dof')) post.dof = null; if (this.off.has('rays')) post.rays = 0; if (this.off.has('bloom')) post.bloom = 0; if (this.off.has('flare')) post.flare = null; if (this.off.has('ca')) post.ca = 0; if (this.params.get('debug')) post.debug = this.params.get('debug'); }
    return post;
  }

  // sub: one sub-render of renderAccum() (time already jittered; camera, lens and sun jitter below); omitted for a
  // normal frame
  renderFrame(t, sub) {
    t = clamp(t, 0, this.duration - 1e-4); this.t = t;
    const pipe = this.pipe, shot = this.shotAt(t), lt = t - shot.t0, dt = 1 / this.fps;
    if (shot !== this._shot) { this._shot = shot; this.def.onShot && this.def.onShot(shot, this); shot.enter && shot.enter(this); }
    // floating origin = camera position at this instant
    const c0 = this.cameraOf(shot, lt, t); this.origin.copy(c0.pos);
    const cp = this.applyShot(shot, lt - dt, t - dt); if (sub) this.subCamera(sub, cp); pipe.snapshotPrev();
    const c = this.applyShot(shot, lt, t); if (sub) this.subCamera(sub, c);
    pipe.origin.copy(this.origin); pipe.camAlt = this.origin.y;
    if (c.focus) { pipe.shadowFocus.set(c.focus.x - this.origin.x, c.focus.y - this.origin.y, c.focus.z - this.origin.z); pipe.shadowRadius = c.focusRadius ?? 12; }
    if (sub) pipe.placeSun(this.postOf(shot, lt, t));   // passes drawn from def.frame (sea reflection) see this sub-render's sun, not the last one's
    this.def.frame && this.def.frame(t, shot, lt, this, c);
    const post = this.postOf(shot, lt, t);
    if (sub) {
      // the lens replaces the DOF pass; the screen-space motion blur stays, but only across this sub-render's own slice
      // of the shutter (sub.stratum, a fraction of a frame), so the N slices join into one continuous smear
      if (!sub.plain) { post.shutter = sub.stratum || 0; post.dof = null; }
      else if (sub.ss > 1 && post.dof && post.dof.max) post.dof = { ...post.dof, max: post.dof.max * sub.ss };
      sub.post = post;
    }
    pipe.render(t, sub ? sub.frame : Math.floor(t * this.fps + 1e-6), post, sub ? sub.seed : undefined);
    if (!sub) this.updateOverlays(t, shot, lt);
  }
  // sub-render camera: thin-lens aperture offset (the frustum sheared so the focus plane stays put) plus sub-pixel jitter
  subCamera(s, c) {
    const cam = this.pipe.camera, P = this.pipe;
    if (s.plain) return;
    let ox = s.px || 0, oy = s.py || 0;
    if (s.lens) {
      cam.translateX(s.lens[0]); cam.translateY(s.lens[1]);
      const k = P.h / (2 * Math.tan(c.fov * Math.PI / 360)) / s.focus;   // px per metre of lens offset, at the focus plane
      ox -= s.lens[0] * k; oy += s.lens[1] * k;
    }
    cam.setViewOffset(P.w, P.h, ox, oy, P.w, P.h);
  }

  // ---------------------------------------------------------------- offline accumulation (tools: --accum=N --ss=K)
  // One output frame = the mean of N sub-renders of the shutter interval around t (the shot's post.accumShutter, else
  // post.shutter, as a fraction of a frame, centred, kept inside the shot), each jittered in time (stratified),
  // sub-pixel position (R2, tent filter), lens position over the aperture of post.dof (focus plane kept) and the
  // shadow light across the solar disc (R2), the dimensions decorrelated (samplePlan). Each sub-render keeps the
  // screen-space motion blur across its own 1/N slice of the shutter only, so fast motion is one continuous smear and
  // never N separate copies; the DOF pass is off (the lens does it). Ray-march dithering is seeded per sub-render so it
  // converges; grain, thermal noise and dither are drawn once, on the mean, with the frame's seed. Scene-referred HDR
  // (with bloom, rays, flare) is summed and graded once. ss = K renders everything at K x the size and filters down
  // (Lanczos-2). Deterministic: the same t, N and K give the same image, whatever was rendered before it (per-shot
  // caches are rebuilt and a discarded warm-up sub-render comes first; N + 1 renders in all).
  renderAccum(t, o = {}) {
    const N = Math.max(1, Math.round(+o.accum || 1)), K = Math.max(1, +o.ss || 1), pipe = this.pipe;
    t = clamp(t, 0, this.duration - 1e-4);
    pipe.setSupersample(K, this.W0, this.H0);
    const shot = this.shotAt(t), lt = t - shot.t0, next = this.shots[this.shots.indexOf(shot) + 1];
    const lo = shot.t0, hi = Math.min(next ? next.t0 : this.duration, this.duration) - 1e-4;
    const frame = Math.floor(t * this.fps + 1e-6), p0 = this.postOf(shot, lt, t);
    // o.shutter / o.dof / o.filter / o.stratumBlur override the defaults (look development:
    // tools/shot.mjs t:'{"accum":16,"dof":{"focus":3,"fstop":1}}'; stratumBlur:false shows the bare samples)
    const shutter = clamp(o.shutter ?? p0.accumShutter ?? p0.shutter ?? 0.5), lens = o.dof !== undefined ? o.dof : p0.dof;
    const win = N > 1 ? shutter / this.fps : 0, stratum = N > 1 && o.stratumBlur !== false ? shutter / N : 0;
    let a = t - win / 2; a = Math.max(lo, Math.min(a, hi - win));
    const dof = N > 1 && lens && lens.fstop > 0 && lens.focus > 0 ? lens : null, fr = o.filter ?? 1;
    const plan = samplePlan(N), SUN_R = 0.53 / 2 * Math.PI / 180;
    this.accum = { n: N, ss: K };
    pipe.accumBegin(frame);
    let fade = 0;
    // it = -1: a discarded warm-up of sub-render 0. Some passes read what the previous render left (the sea's
    // reflection pass runs before the sun, sky and reflection probe are updated; the sea and terrain read the cloud
    // layer's previous position), so without it the first sample would depend on whatever was rendered before.
    for (let it = -1; it < N; it++) {
      // a single sample (ss only) is the ordinary frame, supersampled: screen-space blurs on, the frame's noise seed
      const k = Math.max(it, 0), sub = { frame, ss: K, plain: N === 1 };
      let tk = t;
      pipe.accum.skip = it < 0;
      if (N > 1) {
        tk = Math.max(lo, Math.min(hi, a + win * (plan.time[k] + 0.5) / N));
        sub.stratum = stratum; sub.seed = frame * N + k;
        // sub-pixel offset in internal pixels: a tent of radius `filter` output pixels; supersampled, one internal
        // pixel (box), as the Lanczos filter down to the output size does the reconstruction
        const u = fract(0.5 + k / R2G), v = fract(0.5 + k / (R2G * R2G));
        if (K > 1) { sub.px = u - 0.5; sub.py = v - 0.5; } else { sub.px = tent(u) * fr; sub.py = tent(v) * fr; }
        if (dof) {
          // The DOF pass blurs by a disc whose radius is the circle of confusion of an f/N lens (its diameter on a
          // 24 mm-high sensor), capped at dof.max px. An aperture of radius f/N * S/(S - f) gives the thin lens the same
          // blur at every depth, so the art-directed look carries over; its blur at infinity is held to the same cap.
          const c = this.cameraOf(shot, tk - shot.t0, tk), th = Math.tan(c.fov * Math.PI / 360), f = 0.012 / th, S = dof.focus;
          const kInf = pipe.h / (2 * th) / S, maxC = Math.min(dof.max != null ? dof.max * K : 0.022 * pipe.h, 0.03 * pipe.h);
          const R = Math.min(f * S / (dof.fstop * Math.max(S - f, 1e-3)), maxC / kInf), d = disc(halton(plan.lens[k] + 1, 2), halton(plan.lens[k] + 1, 3));
          sub.lens = [d[0] * R, d[1] * R]; sub.focus = S;
        }
        const s = disc(...r2(plan.sun[k], SUN_O));
        pipe.sunJitter = { dir: [s[0] * SUN_R, s[1] * SUN_R], texel: r2(plan.texel[k], TEX_O).map(x => x - 0.5) };
      }
      this.accum.k = k;
      this.renderFrame(tk, sub);
      if (it >= 0) fade += sub.post.fade;
    }
    pipe.sunJitter = null;
    if (pipe.camera.view && pipe.camera.view.enabled) pipe.camera.clearViewOffset();
    pipe.accumEnd({ ...p0, fade: fade / N });
    this.accum = null;
    this.t = t; this.updateOverlays(t, shot, lt);
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
    if (this.pipe.ss !== 1) this.pipe.setSupersample(1, this.W0, this.H0);   // back from a supersampled render
    this.renderFrame(t);
    const gl = this.pipe.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (gl.isContextLost()) throw new Error('WebGL context lost');   // the canvas holds nothing; never let it be saved as a frame
    return true;
  }
  // o: { accum: N sub-renders, ss: K supersampling }; returns timings (ms, wall clock, GPU finished)
  offlineAccum(t, o) {
    const t0 = performance.now();
    this.renderAccum(t, o);
    const gl = this.pipe.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (gl.isContextLost()) throw new Error('WebGL context lost');
    const ms = performance.now() - t0, n = Math.max(1, Math.round(+o.accum || 1)), renders = n + 1;   // + the warm-up
    return { accum: n, ss: Math.max(1, +o.ss || 1), renders, ms: Math.round(ms), msPerSub: Math.round(ms / renders) };
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
    // renderFrame(t) as always; renderFrame(t, { accum: N, ss: K }) accumulates / supersamples (offline quality);
    // both throw if the WebGL context was lost
    renderFrame: (t, o) => o && ((+o.accum || 1) > 1 || (+o.ss || 1) > 1) ? film.offlineAccum(t, o) : film.offlineFrame(t),
    audioChunks: () => film.audioChunks(),
    shots: def.shots.map(s => ({ id: s.id, name: s.name, t0: s.t0, t1: s.t1, note: s.note || '' })),
  };
  film.ready.catch(e => { console.error(e); const s = document.getElementById('status'); if (s) s.textContent = 'This film needs WebGL 2 to play. ' + (e && e.message ? e.message : ''); });
  return film;
}
