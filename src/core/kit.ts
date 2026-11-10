/* The kit: small, dependency-free helpers shared by every film.
   Everything here is deterministic: no Math.random, no clocks. */

/* ---- Design space ---------------------------------------------------------- */
export const W = 1280;
export const H = 520;
export const TAU = Math.PI * 2;

/* ---- Math ------------------------------------------------------------------ */
export const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
/** Linear progress (0..1) of t through the window [a, b]. */
export const seg = (t: number, a: number, b: number): number => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
export const dist = (x1: number, y1: number, x2: number, y2: number): number => Math.hypot(x2 - x1, y2 - y1);
export const smooth = (u: number): number => u * u * (3 - 2 * u);

export type EaseName = 'linear' | 'in' | 'out' | 'inOut' | 'outQuart' | 'inOutQuart' | 'outExpo' | 'inOutSine' | 'outBack';
export type Ease = EaseName | ((x: number) => number);
export const ease: Record<EaseName, (x: number) => number> = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - Math.pow(1 - x, 3),
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  inOutQuart: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  /** A touch of overshoot. Use once per film at most. */
  outBack: (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2),
};
const fn = (e?: Ease): ((x: number) => number) => (typeof e === 'function' ? e : ease[e ?? 'inOut']);

/** Eased 0..1 as t passes from a to b. The workhorse of every film. */
export const tween = (t: number, a: number, b: number, e?: Ease): number => fn(e)(seg(t, a, b));
/** 0 -> 1 -> 0: rises over [a, a+fade], holds, falls over [b-fade, b]. */
export const pulse = (t: number, a: number, b: number, fade = 0.4, e?: Ease): number =>
  fn(e)(Math.min(seg(t, a, a + fade), 1 - seg(t, b - fade, b)));
/** Keyframes: keys([[0, 0], [2, 1, 'out'], [5, 1]])(t). The ease belongs to the segment arriving at that key. */
export const keys =
  (frames: Array<[number, number, Ease?]>) =>
  (t: number): number => {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      const [tb, vb, e] = frames[i];
      if (t <= tb) {
        const [ta, va] = frames[i - 1];
        return va + (vb - va) * fn(e)(seg(t, ta, tb));
      }
    }
    return frames[frames.length - 1][1];
  };
/** Per-item delayed progress: item i of n starts later; all finish by b. */
export const stagger = (t: number, a: number, b: number, i: number, n: number, overlap = 0.6, e?: Ease): number => {
  const each = (b - a) / (1 + (n - 1) * (1 - overlap));
  const start = a + i * each * (1 - overlap);
  return fn(e)(seg(t, start, start + each));
};
/** Frame-rate independent smoothing toward a target. */
export const damp = (cur: number, target: number, rate: number, dt: number): number => target + (cur - target) * Math.exp(-rate * dt);

/* ---- Deterministic randomness ---------------------------------------------- */
/** Seeded generator: const r = rng(7); r() -> 0..1 */
export const rng = (seed = 1): (() => number) => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
/** Stable 0..1 value for an index (and optional salt). */
export const hash = (i: number, salt = 0): number => {
  let h = (Math.imul(i + 1, 374761393) + Math.imul(salt + 1, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Smooth 1-D value noise in -1..1. */
export const noise = (x: number, salt = 0): number => {
  const i = Math.floor(x);
  const u = x - i;
  return (hash(i, salt) * (1 - smooth(u)) + hash(i + 1, salt) * smooth(u)) * 2 - 1;
};
/** Smooth 2-D value noise in -1..1. */
export const noise2 = (x: number, y: number, salt = 0): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const h = (a: number, b: number) => hash(a * 73 + b * 151, salt);
  return (lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v)) * 2 - 1;
};

/* ---- Geometry -------------------------------------------------------------- */
export type Pt = [number, number];
export type Bez = [Pt, Pt, Pt, Pt];
export const bezier = (p: Bez, u: number): Pt => {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
};
/** Control points for an S-curve between two points with horizontal tangents. */
export const link = (x1: number, y1: number, x2: number, y2: number): Bez => {
  const m = (x1 + x2) / 2;
  return [[x1, y1], [m, y1], [m, y2], [x2, y2]];
};
/** Point at fraction u along a polyline, by segment count (not length). */
export const along = (p: Pt[], u: number): Pt => {
  const s = clamp(u) * (p.length - 1);
  const i = Math.min(p.length - 2, Math.floor(s));
  return [lerp(p[i][0], p[i + 1][0], s - i), lerp(p[i][1], p[i + 1][1], s - i)];
};

/* ---- Colour ---------------------------------------------------------------- */
const channels = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgba = (hex: string, a = 1): string => {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${Math.round(clamp(a) * 1000) / 1000})`;
};
export const blend = (hexA: string, hexB: string, u: number): string => {
  const a = channels(hexA);
  const b = channels(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * clamp(u)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/* ---- DOM ------------------------------------------------------------------- */
export const h = <T extends keyof HTMLElementTagNameMap>(tag: T, cls?: string, parent?: Element | null, text?: string): HTMLElementTagNameMap[T] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
};
const SVG_NS = 'http://www.w3.org/2000/svg';
export const svg = (tag: string, attrs?: Record<string, string | number>, parent?: Element | null): SVGElement => {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(el);
  return el;
};

type Memo = Record<string, unknown>;
const cache = new WeakMap<Element, Memo>();
const memo = (el: Element): Memo => {
  let m = cache.get(el);
  if (!m) cache.set(el, (m = {}));
  return m;
};
/** Write transform and opacity cheaply; skips the DOM when nothing changed. */
export const set = (el: HTMLElement | SVGElement, p: { x?: number; y?: number; scale?: number; rotate?: number; opacity?: number }): void => {
  const m = memo(el);
  if (p.opacity != null) {
    const o = Math.round(clamp(p.opacity) * 1000) / 1000;
    if (m.o !== o) {
      m.o = o;
      el.style.opacity = String(o);
      el.style.visibility = o === 0 ? 'hidden' : 'visible';
    }
  }
  if (p.x != null || p.y != null || p.scale != null || p.rotate != null) {
    const x = Math.round((p.x ?? (m.x as number) ?? 0) * 100) / 100;
    const y = Math.round((p.y ?? (m.y as number) ?? 0) * 100) / 100;
    const s = Math.round((p.scale ?? (m.s as number) ?? 1) * 1000) / 1000;
    const r = Math.round((p.rotate ?? (m.r as number) ?? 0) * 100) / 100;
    if (m.x !== x || m.y !== y || m.s !== s || m.r !== r) {
      m.x = x;
      m.y = y;
      m.s = s;
      m.r = r;
      el.style.transform = `translate(${x}px,${y}px)` + (r ? ` rotate(${r}deg)` : '') + (s !== 1 ? ` scale(${s})` : '');
    }
  }
};
/** Cached textContent. */
export const text = (el: Element, value: string | number): void => {
  const m = memo(el);
  const v = String(value);
  if (m.t !== v) {
    m.t = v;
    el.textContent = v;
  }
};
/** Cached attribute. */
export const attr = (el: Element, name: string, value: string): void => {
  const m = memo(el);
  if (m['a:' + name] !== value) {
    m['a:' + name] = value;
    el.setAttribute(name, value);
  }
};
/** Cached class toggle. */
export const toggle = (el: Element, cls: string, on: boolean): void => {
  const m = memo(el);
  if (m['c:' + cls] !== on) {
    m['c:' + cls] = on;
    el.classList.toggle(cls, on);
  }
};
/** Cached inline style property. */
export const style = (el: HTMLElement | SVGElement, name: string, value: string): void => {
  const m = memo(el);
  if (m['s:' + name] !== value) {
    m['s:' + name] = value;
    el.style.setProperty(name, value);
  }
};

/* ---- Formatting ------------------------------------------------------------ */
export const pad = (n: number, w = 2): string => String(Math.floor(n)).padStart(w, '0');
export const mmss = (s: number): string => `${Math.floor(s / 60)}:${pad(s % 60)}`;
export const num = (n: number): string => Math.round(n).toLocaleString('en-US');
