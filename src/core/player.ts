/* The player: one clock, one animation loop, one mounted film.

   Films are loaded on demand and can be prepared ahead of time (prewarm), so that
   opening one costs a single frame. The time model is in types.ts (Frame). */
import * as K from './kit.ts';
import { createRail } from '../ui/instruments.ts';
import type { Rail } from '../ui/instruments.ts';
import type { Choice, Frame, Gate, Layer, Palette, PlayerApi, SceneContext, SceneDef, SceneInstance, Toggles, View } from './types.ts';

type Loader = () => Promise<SceneDef<any>>;
interface Mounted {
  id: string;
  def: SceneDef<any>;
  root: HTMLElement;
  layers: Layer[];
  html: HTMLElement | null;
  inst: SceneInstance;
  failed: boolean;
}

const TOKENS: Record<keyof Palette, [string, string]> = {
  bg: ['--bg', '#000000'],
  stage: ['--stage', '#050505'],
  sheet: ['--sheet', '#0e0f0f'],
  sheet2: ['--sheet-2', '#1a1b1b'],
  line: ['--line', '#1c1d1e'],
  line2: ['--line-2', '#2f3234'],
  wire: ['--wire', '#565654'],
  mark: ['--mark', '#d8d8d4'],
  bright: ['--bright', '#ffffff'],
  dim: ['--dim', '#8e9291'],
  live: ['--live', '#dff140'],
  ink: ['--ink', '#ffffff'],
  text: ['--text', '#d8d8d4'],
  muted: ['--muted', '#9d9f9a'],
  faint: ['--faint', '#6c6e6b'],
  old: ['--old', '#bdad96'],
  alert: ['--alert', '#ff3535'],
};

export const colors = {} as Palette;
function readColors(el: Element): void {
  const css = getComputedStyle(el);
  for (const k of Object.keys(TOKENS) as Array<keyof Palette>) {
    const v = css.getPropertyValue(TOKENS[k][0]).trim();
    colors[k] = /^#[0-9a-f]{6}$/i.test(v) ? v : TOKENS[k][1];
  }
}

const loaders = new Map<string, Loader>();
const defs = new Map<string, SceneDef<any>>();
const loading = new Map<string, Promise<SceneDef<any>>>();
const prepared = new Map<string, unknown>();
const listeners: Record<string, Array<(arg?: any) => void>> = {};
const emit = (name: string, arg?: unknown): void => (listeners[name] || []).forEach((f) => f(arg));

export const view: View = { width: 0, height: 0, scale: 1, ox: 0, oy: 0, x0: 0, y0: 0, x1: K.W, y1: K.H, dpr: 1, px: 1 };
const s = {
  stage: null as HTMLElement | null,
  controls: null as HTMLElement | null,
  cur: null as Mounted | null,
  want: '' as string,
  duration: 1,
  t: 0,
  idle: 0,
  rate: 1,
  playing: false,
  glide: null as null | { from: number; to: number; idleFrom: number; u: number; dur: number; then: 'play' | 'stay' },
  scrub: null as number | null,
  scrubRelease: false,
  resume: false,
  released: new Set<string>(),
  waiting: null as Gate | null,
  gateWait: 0,
  snap: true,
  dirty: true,
  onscreen: true,
  token: 0,
};
const frame: Frame = { t: 0, dt: 0, idle: 0, live: 0, duration: 1, progress: 0, act: 0, actT: 0, ended: false, playing: false, snap: true, gate: null, view };
const stats = { frames: 0, total: 0, max: 0 };

/* ---- Layers ---------------------------------------------------------------- */
function sizeCanvas(layer: Layer): void {
  const w = Math.max(1, Math.round(view.width * view.dpr));
  const h = Math.max(1, Math.round(view.height * view.dpr));
  if (layer.el.width !== w) layer.el.width = w;
  if (layer.el.height !== h) layer.el.height = h;
}
function placeHtml(el: HTMLElement): void {
  el.style.transform = `translate(${view.ox}px,${view.oy}px) scale(${view.scale})`;
}
/** The part of the design space every film keeps its plate in, with a little air and
    room for the plate's title above it. */
const PLATE = { x: 28, y: 16, w: 872, h: 478 };
/** A frame narrower than this, in CSS pixels, shows the plate alone. The whole stage at
    that width would be a postage stamp; the instruments wait off the right-hand edge
    until the frame is wide enough, which on a phone means turning it sideways. */
const NARROW = 520;
function measure(): void {
  if (!s.stage) return;
  const r = s.stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const plate = r.width < NARROW;
  // The style sheet gives the frame the plate's proportions, so its height follows and
  // this runs once more through the resize observer.
  s.stage.closest('.stage-frame')?.classList.toggle('is-plate', plate);
  const win = plate ? PLATE : { x: 0, y: 0, w: K.W, h: K.H };
  const scale = Math.min(r.width / win.w, r.height / win.h);
  view.width = r.width;
  view.height = r.height;
  view.scale = scale;
  view.ox = (r.width - win.w * scale) / 2 - win.x * scale;
  view.oy = (r.height - win.h * scale) / 2 - win.y * scale;
  view.x0 = -view.ox / scale;
  view.y0 = -view.oy / scale;
  view.x1 = (r.width - view.ox) / scale;
  view.y1 = (r.height - view.oy) / scale;
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  view.px = 1 / (scale * view.dpr);
  const sc = s.cur;
  if (sc) {
    sc.layers.forEach(sizeCanvas);
    if (sc.html) placeHtml(sc.html);
    if (sc.inst.resize) sc.inst.resize(view);
  }
  s.dirty = true;
}

function fail(sc: Mounted, err: unknown): void {
  console.error(`[wins] film "${sc.id}" failed:`, err);
  sc.failed = true;
  K.h('div', 'scene-error', sc.root, `This film could not be drawn. Details are in the console.`);
}

function createScene(id: string, def: SceneDef<any>): Mounted {
  const root = K.h('div', 'scene');
  root.dataset.scene = id;
  const sc: Mounted = { id, def, root, layers: [], html: null, inst: { update() {} }, failed: false };
  let rail: Rail | null = null;
  const html = (): HTMLElement => {
    if (!sc.html) {
      sc.html = K.h('div', 'scene-html', root);
      placeHtml(sc.html);
    }
    return sc.html;
  };
  const ctx: SceneContext = {
    id,
    root,
    colors,
    view,
    player,
    canvas() {
      const el = K.h('canvas', 'scene-canvas', root);
      el.setAttribute('aria-hidden', 'true');
      // Canvases always sit behind the HTML layer, in creation order.
      if (sc.html) root.insertBefore(el, sc.html);
      const layer: Layer = { el, g: el.getContext('2d')! };
      sc.layers.push(layer);
      sizeCanvas(layer);
      return layer;
    },
    html,
    rail() {
      if (!rail) rail = createRail(html());
      return rail;
    },
    button(label, onClick) {
      const b = K.h('button', 'primary-control', s.controls, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        onClick();
        wake();
      });
      return b;
    },
    options(labels, selected, onChange) {
      const el = K.h('div', 'control-group', s.controls);
      el.setAttribute('role', 'group');
      let value = selected;
      const buttons = labels.map((label, i) => {
        const b = K.h('button', '', el, label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(i === value));
        b.addEventListener('click', () => {
          api.set(i);
          onChange(i);
          wake();
        });
        return b;
      });
      const api: Choice = {
        el,
        set(i) {
          value = i;
          buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
        },
        get value() {
          return value;
        },
      };
      return api;
    },
    toggles(labels, onChange) {
      const el = K.h('div', 'control-group', s.controls);
      el.setAttribute('role', 'group');
      const state = labels.map(() => false);
      const buttons = labels.map((label, i) => {
        const b = K.h('button', '', el, label);
        b.type = 'button';
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          api.set(i, !state[i]);
          onChange(i, state[i]);
          wake();
        });
        return b;
      });
      const api: Toggles = {
        el,
        set(i, on) {
          state[i] = on;
          buttons[i].setAttribute('aria-pressed', String(on));
        },
        get: (i) => state[i],
      };
      return api;
    },
  };
  s.stage!.appendChild(root);
  try {
    if (def.prepare && !prepared.has(id)) prepared.set(id, def.prepare());
    sc.inst = def.setup(ctx, prepared.get(id));
  } catch (err) {
    fail(sc, err);
  }
  return sc;
}

function destroy(sc: Mounted): void {
  try {
    sc.inst.destroy?.();
  } catch (err) {
    console.error(err);
  }
  sc.root.remove();
}

/* ---- Gates ----------------------------------------------------------------- */
const gates = (): Gate[] => s.cur?.def.gates ?? [];
const nextGate = (): Gate | null => gates().find((g) => !s.released.has(g.id) && g.at >= s.t - 1e-6) ?? null;
function syncGates(): void {
  s.released = new Set(gates().filter((g) => g.at < s.t - 1e-6).map((g) => g.id));
  s.gateWait = 0;
  if (s.waiting) {
    s.waiting = null;
    emit('state');
  }
}
function release(auto: boolean): void {
  const g = s.waiting ?? nextGate();
  if (!g) return;
  s.released.add(g.id);
  s.waiting = null;
  s.gateWait = 0;
  s.cur?.inst.onGate?.(g.id, { auto });
  emit('state');
}

/** A viewer who acts after the story has ended expects the picture to answer. Films
    animate that answer on idle time, which only runs while playing, so start it even if
    the viewer arrived at the end by scrubbing or had paused there. */
function wake(): void {
  if (s.cur && !s.playing && !s.glide && s.scrub == null && s.t >= s.duration - 1e-6) {
    s.playing = true;
    emit('state');
  }
}

/* ---- Frame ----------------------------------------------------------------- */
function render(dt: number): void {
  const sc = s.cur;
  if (!sc) return;
  const D = s.duration;
  const acts = sc.def.acts;
  let act = 0;
  for (let i = 0; i < acts.length; i++) if (s.t >= acts[i].at - 1e-6) act = i;
  frame.t = s.t;
  frame.dt = dt;
  frame.idle = s.idle;
  frame.live = s.t + s.idle;
  frame.duration = D;
  frame.progress = D ? s.t / D : 0;
  frame.act = act;
  frame.actT = acts.length ? s.t - acts[act].at : s.t;
  frame.ended = s.t >= D - 1e-6;
  frame.playing = s.playing;
  frame.snap = s.snap;
  frame.gate = s.waiting ? { id: s.waiting.id, waited: s.gateWait, auto: s.waiting.auto } : null;

  const k = view.dpr * view.scale;
  for (const layer of sc.layers) {
    layer.g.setTransform(k, 0, 0, k, view.dpr * view.ox, view.dpr * view.oy);
    layer.g.clearRect(view.x0 - 1, view.y0 - 1, view.x1 - view.x0 + 2, view.y1 - view.y0 + 2);
  }
  if (!sc.failed) {
    const t0 = performance.now();
    try {
      sc.inst.update(frame);
    } catch (err) {
      fail(sc, err);
    }
    const ms = performance.now() - t0;
    stats.frames++;
    stats.total += ms;
    if (ms > stats.max) stats.max = ms;
  }
  s.snap = false;
  s.dirty = false;
  emit('frame', frame);
}

function advance(raw: number): void {
  const D = s.duration;
  const dt = raw * s.rate;
  let active = false;
  if (s.glide) {
    const g = s.glide;
    g.u = Math.min(1, g.u + raw / g.dur);
    const e = K.ease.inOut(g.u);
    s.t = K.lerp(g.from, g.to, e);
    s.idle = K.lerp(g.idleFrom, 0, e);
    syncGates();
    if (g.u >= 1) {
      s.glide = null;
      s.t = g.to;
      s.idle = 0;
      s.playing = g.then === 'play';
      emit('state');
    }
    active = true;
  } else if (s.scrub != null) {
    const before = s.t;
    const idleBefore = s.idle;
    s.t = Math.abs(s.t - s.scrub) < 0.004 ? s.scrub : K.damp(s.t, s.scrub, 18, raw);
    s.idle = s.idle < 0.004 ? 0 : K.damp(s.idle, 0, 18, raw);
    syncGates();
    active = s.t !== before || s.idle !== idleBefore;
    if (!active && s.scrubRelease) {
      s.scrub = null;
      s.scrubRelease = false;
      s.playing = s.resume && s.t < D - 1e-6;
      emit('state');
    }
  } else if (s.playing) {
    const gate = nextGate();
    if (gate && s.t >= gate.at - 1e-6) {
      s.t = gate.at;
      s.gateWait += raw;
      s.idle += raw;
      if (!s.waiting) {
        s.waiting = gate;
        emit('state');
      }
      if (gate.auto != null && s.gateWait >= gate.auto) release(true);
    } else if (s.t < D) {
      let nt = s.t + dt;
      if (gate && nt >= gate.at) nt = gate.at;
      s.t = Math.min(D, nt);
      if (s.t >= D) {
        emit('state');
        emit('end');
      }
    } else {
      s.idle += raw;
    }
    active = true;
  }
  if (active || s.dirty) render(active ? dt : 0);
}

let last = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
  last = now;
  if (document.hidden || !s.onscreen || !s.cur) {
    last = 0;
    return;
  }
  advance(dt);
}

function show(id: string, def: SceneDef<any>, opts: { instant?: boolean; autoplay?: boolean }): void {
  const old = s.cur;
  if (old) {
    if (opts.instant) destroy(old);
    else {
      old.root.classList.add('is-leaving');
      setTimeout(() => destroy(old), 420);
    }
  }
  s.controls!.replaceChildren();
  measure();
  const sc = createScene(id, def);
  s.cur = sc;
  s.duration = def.duration;
  s.t = 0;
  s.idle = 0;
  s.glide = null;
  s.scrub = null;
  s.scrubRelease = false;
  s.released = new Set();
  s.waiting = null;
  s.gateWait = 0;
  s.snap = true;
  s.dirty = true;
  stats.frames = 0;
  stats.total = 0;
  stats.max = 0;
  s.playing = opts.autoplay !== false;
  if (!opts.instant) {
    sc.root.classList.add('is-entering');
    void sc.root.offsetWidth;
    sc.root.classList.remove('is-entering');
  }
  emit('mount', def);
  render(0);
  emit('state');
}

const clampT = (t: number): number => K.clamp(t, 0, s.duration);

export interface Player extends PlayerApi {
  init(stage: HTMLElement, controls: HTMLElement): void;
  register(id: string, loader: Loader | SceneDef<any>): void;
  /** Load a film and run its precomputation, without showing it. */
  prewarm(id: string): Promise<SceneDef<any> | null>;
  /** The definition if it is already loaded. */
  def(id: string): SceneDef<any> | null;
  mount(id: string, opts?: { instant?: boolean; autoplay?: boolean }): Promise<void>;
  on(name: 'frame' | 'state' | 'mount' | 'end' | 'loading', f: (arg?: any) => void): void;
  scrubStart(): void;
  scrubTo(t: number): void;
  scrubEnd(): void;
  setRate(rate: number): void;
  refresh(): void;
  /** For tools: stand at the next gate at or after `from`, paused, as if the story had
      waited there for `waited` seconds. Returns the gate's time, or null if there is none. */
  hold(from?: number, waited?: number): number | null;
  readonly state: {
    id: string | null;
    t: number;
    idle: number;
    duration: number;
    rate: number;
    playing: boolean;
    ended: boolean;
    scrubbing: boolean;
    waiting: Gate | null;
    def: SceneDef<any> | null;
  };
  stats(): { frames: number; avg: number; max: number };
}

export const player: Player = {
  init(stage, controls) {
    s.stage = stage;
    s.controls = controls;
    readColors(stage);
    measure();
    new ResizeObserver(measure).observe(stage);
    new IntersectionObserver(([entry]) => {
      s.onscreen = entry.isIntersecting;
    }).observe(stage);
    window.addEventListener('resize', measure);
    requestAnimationFrame(loop);
  },
  register(id, loader) {
    if (typeof loader === 'function') loaders.set(id, loader);
    else defs.set(id, loader);
  },
  def: (id) => defs.get(id) ?? null,
  prewarm(id) {
    const have = defs.get(id);
    const done = (def: SceneDef<any>): SceneDef<any> => {
      if (def.prepare && !prepared.has(id)) {
        try {
          prepared.set(id, def.prepare());
        } catch (err) {
          console.error(`[wins] film "${id}" could not prepare:`, err);
        }
      }
      return def;
    };
    if (have) return Promise.resolve(done(have));
    let p = loading.get(id);
    if (!p) {
      const loader = loaders.get(id);
      if (!loader) return Promise.resolve(null);
      p = loader().then((def) => {
        defs.set(id, def);
        return def;
      });
      loading.set(id, p);
    }
    return p.then(done, (err) => {
      console.error(`[wins] film "${id}" could not load:`, err);
      loading.delete(id);
      return null;
    });
  },
  async mount(id, opts = {}) {
    const token = ++s.token;
    s.want = id;
    let def = defs.get(id) ?? null;
    if (!def) {
      emit('loading', id);
      def = await this.prewarm(id);
      if (token !== s.token) return; // a newer request won
    }
    if (!def) return;
    show(id, def, opts);
  },
  on(name, f) {
    (listeners[name] = listeners[name] || []).push(f);
  },
  play() {
    if (s.glide) return;
    s.scrub = null;
    s.playing = true;
    emit('state');
  },
  pause() {
    s.playing = false;
    if (s.glide) s.glide.then = 'stay';
    emit('state');
  },
  toggle() {
    if (s.playing) this.pause();
    else if (s.t >= s.duration - 1e-6) this.replay();
    else this.play();
  },
  replay() {
    this.glideTo(0, { then: 'play' });
  },
  hold(from = 0, waited = 0) {
    const g = gates().find((x) => x.at >= from - 1e-6);
    if (!g) return null;
    this.pause();
    this.seek(g.at, waited);
    s.waiting = g;
    s.gateWait = waited;
    render(0);
    emit('state');
    return g.at;
  },
  seek(t, idle = 0) {
    s.t = clampT(t);
    s.idle = Math.max(0, idle);
    s.glide = null;
    s.scrub = null;
    s.scrubRelease = false;
    syncGates();
    s.snap = true;
    render(0);
    emit('state');
  },
  glideTo(t, opts = {}) {
    const to = clampT(t);
    const then = opts.then ?? (s.playing ? 'play' : 'stay');
    const span = Math.abs(to - s.t) + Math.min(s.idle, 4) * 0.5;
    s.glide = { from: s.t, to, idleFrom: s.idle, u: 0, dur: K.clamp(0.4 + span * 0.035, 0.45, 0.95), then };
    s.scrub = null;
    s.playing = false;
    emit('state');
  },
  gotoAct(i) {
    const acts = s.cur?.def.acts ?? [];
    if (acts[i]) this.glideTo(acts[i].at, { then: 'play' });
  },
  scrubStart() {
    if (s.scrub == null) s.resume = s.playing || s.glide?.then === 'play';
    s.glide = null;
    s.playing = false;
    s.scrub = s.t;
    s.scrubRelease = false;
    emit('state');
  },
  scrubTo(t) {
    if (s.scrub == null) this.scrubStart();
    s.scrub = clampT(t);
  },
  scrubEnd() {
    if (s.scrub != null) s.scrubRelease = true;
  },
  release() {
    release(false);
  },
  setRate(rate) {
    s.rate = K.clamp(rate, 0.25, 4);
    emit('state');
  },
  refresh() {
    s.dirty = true;
    if (s.cur) {
      measure();
      if (!s.playing) {
        s.snap = true;
        render(0);
      }
    }
  },
  get state() {
    return {
      id: s.cur ? s.cur.id : null,
      t: s.t,
      idle: s.idle,
      duration: s.duration,
      rate: s.rate,
      playing: s.playing || s.glide?.then === 'play',
      ended: s.t >= s.duration - 1e-6,
      scrubbing: s.scrub != null,
      waiting: s.waiting,
      def: s.cur ? s.cur.def : null,
    };
  },
  stats: () => ({ frames: stats.frames, avg: stats.frames ? stats.total / stats.frames : 0, max: stats.max }),
};
