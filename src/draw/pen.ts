/* The pen: a small drafting kit on Canvas 2D.

   The look it is built for: true one-device-pixel hairlines, dashed construction
   lines, halftone dot fields, monospace labels tied to marks by leader lines.
   Everything is in design pixels (1280 x 520); call frame() first each update. */
import * as K from '../core/kit.ts';
import type { Bez, Pt } from '../core/kit.ts';
import type { Layer, Palette, View } from '../core/types.ts';

export type FontRole = 'mono' | 'sans' | 'display';
export interface TextStyle {
  font?: FontRole;
  size?: number;
  weight?: number;
  color?: string;
  alpha?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  track?: number;
}

const SANS = '"Field Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
const FAMILY: Record<FontRole, string> = {
  /** Numerals, axis ticks and key hints. */
  mono: '"Field Mono", ui-monospace, "SF Mono", Menlo, monospace',
  /** Everything else. `display` is the same face, kept as a role for large type. */
  sans: SANS,
  display: SANS,
};
/** Canvas fonts for the small charts films draw in the rail. */
export const FONT = {
  tick: '400 9.5px "Field Mono", ui-monospace, monospace',
  word: '400 10.5px "Field Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  label: '500 9.5px "Field Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
};
export const DASH = { dot: [1.2, 4.2], dash: [5, 4], long: [9, 5], fine: [2, 3] } as const;
/** The two voices of an annotation: a small uppercase name, and a plain detail line. */
const CAP: TextStyle = { font: 'sans', size: 10, weight: 500, track: 0.42 };
const DETAIL: TextStyle = { font: 'sans', size: 10.5, weight: 400, track: -0.05 };

export class Pen {
  g: CanvasRenderingContext2D;
  col: Palette;
  /** One device pixel in design units. */
  px = 1;

  constructor(layer: Layer, col: Palette) {
    this.g = layer.g;
    this.col = col;
  }
  /** Call once at the start of every update. */
  frame(view: View): this {
    this.px = view.px;
    this.g.lineCap = 'round';
    this.g.lineJoin = 'round';
    this.g.setLineDash([]);
    this.g.globalAlpha = 1;
    return this;
  }
  /** A line width that never falls below one device pixel. */
  lw(w = 1): number {
    return Math.max(w, this.px);
  }
  /** Snap a coordinate to the centre of a device pixel, so thin rules stay crisp. */
  snap(v: number): number {
    return (Math.round(v / this.px - 0.5) + 0.5) * this.px;
  }

  /* ---- Styles ------------------------------------------------------------- */
  stroke(color: string, alpha = 1, width = 1, dash?: readonly number[] | null, offset = 0): this {
    const g = this.g;
    g.strokeStyle = alpha >= 1 ? color : K.rgba(color, alpha);
    g.lineWidth = this.lw(width);
    g.setLineDash(dash ? (dash as number[]) : []);
    g.lineDashOffset = offset;
    return this;
  }
  fill(color: string, alpha = 1): this {
    this.g.fillStyle = alpha >= 1 ? color : K.rgba(color, alpha);
    return this;
  }

  /* ---- Marks -------------------------------------------------------------- */
  line(x1: number, y1: number, x2: number, y2: number): this {
    const g = this.g;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    return this;
  }
  /** A crisp horizontal rule. */
  hline(x1: number, x2: number, y: number): this {
    return this.line(x1, this.snap(y), x2, this.snap(y));
  }
  /** A crisp vertical rule. */
  vline(x: number, y1: number, y2: number): this {
    return this.line(this.snap(x), y1, this.snap(x), y2);
  }
  poly(pts: Pt[], close = false, u = 1): this {
    const g = this.g;
    if (pts.length < 2 || u <= 0) return this;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    const s = K.clamp(u) * (pts.length - 1);
    for (let i = 1; i < pts.length; i++) {
      if (i <= s) g.lineTo(pts[i][0], pts[i][1]);
      else {
        const q = K.along(pts, u);
        g.lineTo(q[0], q[1]);
        break;
      }
    }
    if (close && u >= 1) g.closePath();
    g.stroke();
    return this;
  }
  /** The first u of a cubic curve. */
  curve(p: Bez, u = 1): this {
    if (u <= 0) return this;
    const g = this.g;
    g.beginPath();
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const q = K.bezier(p, (i / n) * K.clamp(u));
      if (i) g.lineTo(q[0], q[1]);
      else g.moveTo(q[0], q[1]);
    }
    g.stroke();
    return this;
  }
  /** Small lights travelling along a curve. */
  flow(p: Bez, time: number, n = 2, speed = 0.3, r = 1.6): this {
    const g = this.g;
    for (let i = 0; i < n; i++) {
      const u = (((time * speed + i / n) % 1) + 1) % 1;
      const q = K.bezier(p, u);
      g.beginPath();
      g.arc(q[0], q[1], r, 0, K.TAU);
      g.fill();
    }
    return this;
  }
  /** Path only: follow with g.fill() and/or g.stroke(). */
  rect(x: number, y: number, w: number, h: number, r = 0): this {
    const g = this.g;
    g.beginPath();
    if (r > 0 && g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
    return this;
  }
  /** A stroked box whose edges sit on device pixels. */
  box(x: number, y: number, w: number, h: number, r = 0): this {
    const x0 = this.snap(x);
    const y0 = this.snap(y);
    this.rect(x0, y0, this.snap(x + w) - x0, this.snap(y + h) - y0, r);
    this.g.stroke();
    return this;
  }
  circle(x: number, y: number, r: number): this {
    this.g.beginPath();
    this.g.arc(x, y, Math.max(0, r), 0, K.TAU);
    return this;
  }
  dot(x: number, y: number, r: number): this {
    this.circle(x, y, r);
    this.g.fill();
    return this;
  }
  ring(x: number, y: number, r: number): this {
    this.circle(x, y, r);
    this.g.stroke();
    return this;
  }

  /** Diagonal hatching inside a rectangle: the drafting fill. The pattern is fixed in space, so a growing bar does not swim. */
  hatch(x: number, y: number, w: number, h: number, color: string, alpha = 0.5, gap = 5): this {
    if (w <= 0 || h <= 0) return this;
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    this.stroke(color, alpha, 1);
    g.beginPath();
    for (let c = Math.ceil((x + y) / gap) * gap; c < x + w + y + h; c += gap) {
      g.moveTo(c - (y + h), y + h);
      g.lineTo(c - y, y);
    }
    g.stroke();
    g.restore();
    return this;
  }
  /** A small solid arrow head with its tip at (x, y), pointing along `angle`. */
  head(x: number, y: number, angle: number, size = 5): this {
    const g = this.g;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - size * Math.cos(angle - 0.42), y - size * Math.sin(angle - 0.42));
    g.lineTo(x - size * Math.cos(angle + 0.42), y - size * Math.sin(angle + 0.42));
    g.closePath();
    g.fill();
    return this;
  }

  /* ---- Type --------------------------------------------------------------- */
  text(str: string, x: number, y: number, st: TextStyle = {}): this {
    const g = this.g;
    g.font = `${st.weight ?? 400} ${st.size ?? 11}px ${FAMILY[st.font ?? 'sans']}`;
    g.fillStyle = K.rgba(st.color ?? this.col.muted, st.alpha ?? 1);
    g.textAlign = st.align ?? 'left';
    g.textBaseline = st.baseline ?? 'alphabetic';
    if ('letterSpacing' in g) (g as any).letterSpacing = `${st.track ?? 0}px`;
    g.fillText(str, x, y);
    return this;
  }
  measure(str: string, st: TextStyle = {}): number {
    const g = this.g;
    g.font = `${st.weight ?? 400} ${st.size ?? 11}px ${FAMILY[st.font ?? 'sans']}`;
    if ('letterSpacing' in g) (g as any).letterSpacing = `${st.track ?? 0}px`;
    return g.measureText(str).width;
  }
  /** A small uppercase label: the voice of every annotation. */
  cap(str: string, x: number, y: number, color?: string, alpha = 1, align: CanvasTextAlign = 'left'): this {
    return this.text(str.toUpperCase(), x, y, { ...CAP, color: color ?? this.col.muted, alpha, align });
  }
  /** A mono value. */
  val(str: string, x: number, y: number, color?: string, alpha = 1, align: CanvasTextAlign = 'left', size = 11): this {
    return this.text(str, x, y, { font: 'mono', size, weight: 500, color: color ?? this.col.text, alpha, align });
  }

  /* ---- Annotation --------------------------------------------------------- */
  /**
   * A label tied to a mark by a dashed leader line.
   * lines[0] is the name; the rest are details. `u` draws it on (0..1).
   */
  label(x: number, y: number, lx: number, ly: number, lines: string[], o: { color?: string; u?: number; align?: 'left' | 'right' } = {}): this {
    const u = K.clamp(o.u ?? 1);
    if (u <= 0) return this;
    const color = o.color ?? this.col.ink;
    const right = o.align === 'right';
    this.stroke(color, 0.7 * u, 1, DASH.fine);
    this.line(x, y, K.lerp(x, lx, K.ease.out(u)), K.lerp(y, ly, K.ease.out(u)));
    this.g.setLineDash([]);
    this.fill(color, u).dot(x, y, 1.8);
    const a = K.clamp(u * 2 - 1);
    const tx = lx + (right ? -6 : 6);
    if (a > 0) {
      let w = 0;
      lines.forEach((s, i) => (w = Math.max(w, this.measure(i ? s : s.toUpperCase(), i ? DETAIL : CAP))));
      this.rect(right ? tx - w - 6 : tx - 6, ly - 8, w + 12, 9 + lines.length * 13.5);
      this.g.fillStyle = K.rgba(this.col.stage, 0.9 * a);
      this.g.fill();
    }
    lines.forEach((s, i) => {
      if (i === 0) this.text(s.toUpperCase(), tx, ly + 3.5, { ...CAP, color, alpha: a, align: right ? 'right' : 'left' });
      else this.text(s, tx, ly + 3.5 + i * 13.5, { ...DETAIL, color: this.col.muted, alpha: a, align: right ? 'right' : 'left' });
    });
    return this;
  }
  /** An outlined tag. Returns its width. */
  tag(str: string, x: number, y: number, o: { color?: string; fill?: string; alpha?: number; align?: 'left' | 'center' | 'right'; solid?: boolean } = {}): number {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0) return 0;
    const color = o.color ?? this.col.mark;
    const st: TextStyle = CAP;
    const s = str.toUpperCase();
    const w = this.measure(s, st) + 14;
    const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    const g = this.g;
    this.rect(this.snap(x0), this.snap(y - 9.5), Math.round(w), 19);
    g.fillStyle = o.solid ? K.rgba(color, alpha) : K.rgba(o.fill ?? this.col.stage, 0.92 * alpha);
    g.fill();
    this.stroke(color, 0.75 * alpha, 1);
    g.stroke();
    this.text(s, x0 + 7, y + 3.6, { ...st, color: o.solid ? this.col.bg : color, alpha });
    return w;
  }
  /** Tick marks along a straight edge, like a ruler. */
  ticks(x1: number, y1: number, x2: number, y2: number, n: number, len = 4, major = 5): this {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d;
    const ny = dx / d;
    const g = this.g;
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = x1 + (dx * i) / n;
      const y = y1 + (dy * i) / n;
      const l = i % major === 0 ? len * 1.9 : len;
      g.moveTo(x, y);
      g.lineTo(x + nx * l, y + ny * l);
    }
    g.stroke();
    return this;
  }
  /**
   * The frame of a field: hairline border, corner brackets, ruler ticks and
   * optional grid references (letters along the top, numbers down the side).
   */
  plate(x: number, y: number, w: number, h: number, o: { title?: string; right?: string; cols?: number; rows?: number; alpha?: number } = {}): this {
    const a = o.alpha ?? 1;
    const c = this.col;
    this.stroke(c.line2, a, 1).box(x, y, w, h);
    this.stroke(c.wire, 0.9 * a, 1);
    const b = 7;
    const g = this.g;
    g.beginPath();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
      g.moveTo(this.snap(cx), cy + sy * b);
      g.lineTo(this.snap(cx), this.snap(cy));
      g.lineTo(cx + sx * b, this.snap(cy));
    }
    g.stroke();
    if (o.cols) {
      this.stroke(c.wire, 0.55 * a, 1).ticks(x, y + h, x + w, y + h, o.cols * 5, -3);
      for (let i = 0; i < o.cols; i++) this.text(String.fromCharCode(65 + i), x + (w * (i + 0.5)) / o.cols, y + h + 15, { font: 'mono', size: 9, color: c.faint, alpha: a, align: 'center' });
    }
    if (o.rows) {
      this.stroke(c.wire, 0.55 * a, 1).ticks(x, y, x, y + h, o.rows * 5, -3);
      for (let i = 0; i < o.rows; i++) this.text(String(i + 1), x - 11, y + (h * (i + 0.5)) / o.rows + 3, { font: 'mono', size: 9, color: c.faint, alpha: a, align: 'center' });
    }
    if (o.title) this.cap(o.title, x, y - 9, c.muted, a);
    if (o.right) this.cap(o.right, x + w, y - 9, c.faint, a, 'right');
    return this;
  }

  /* ---- Glyphs ------------------------------------------------------------- */
  /** A check mark that draws itself as u goes 0..1. */
  check(x: number, y: number, s = 1, color?: string, u = 1, alpha = 1): this {
    if (u <= 0) return this;
    const g = this.g;
    this.stroke(color ?? this.col.bright, alpha, 1.6);
    g.beginPath();
    g.moveTo(x - 5 * s, y);
    const u1 = Math.min(1, u * 2.5);
    g.lineTo(x - 5 * s + 3.6 * s * u1, y + 3.6 * s * u1);
    if (u > 0.4) {
      const u2 = Math.min(1, (u - 0.4) / 0.6);
      g.lineTo(x - 1.4 * s + 6.6 * s * u2, y + 3.6 * s - 8.6 * s * u2);
    }
    g.stroke();
    return this;
  }
  cross(x: number, y: number, s = 1, color?: string, alpha = 1): this {
    this.stroke(color ?? this.col.alert, alpha, 1.6);
    this.line(x - 4 * s, y - 4 * s, x + 4 * s, y + 4 * s).line(x + 4 * s, y - 4 * s, x - 4 * s, y + 4 * s);
    return this;
  }
  person(x: number, y: number, s = 1, color?: string, alpha = 1): this {
    const g = this.g;
    this.stroke(color ?? this.col.text, alpha, 1.3);
    this.ring(x, y - 7 * s, 5.2 * s);
    g.beginPath();
    g.moveTo(x - 11 * s, y + 13 * s);
    g.bezierCurveTo(x - 11 * s, y - 1 * s, x + 11 * s, y - 1 * s, x + 11 * s, y + 13 * s);
    g.stroke();
    return this;
  }
  doc(x: number, y: number, s = 1, color?: string, alpha = 1, fill?: string): this {
    const g = this.g;
    g.beginPath();
    g.moveTo(x - 8 * s, y - 11 * s);
    g.lineTo(x + 3 * s, y - 11 * s);
    g.lineTo(x + 8 * s, y - 6 * s);
    g.lineTo(x + 8 * s, y + 11 * s);
    g.lineTo(x - 8 * s, y + 11 * s);
    g.closePath();
    g.fillStyle = K.rgba(fill ?? this.col.stage, alpha);
    g.fill();
    this.stroke(color ?? this.col.text, alpha, 1.2);
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      g.moveTo(x - 4.5 * s, y - 3 * s + i * 4.6 * s);
      g.lineTo(x + (i === 2 ? 1 : 4.5) * s, y - 3 * s + i * 4.6 * s);
    }
    g.stroke();
    return this;
  }
  /** A small quadcopter seen from above, nose along `angle`. */
  drone(x: number, y: number, angle: number, s = 1, color?: string, alpha = 1): this {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    this.stroke(color ?? this.col.bright, alpha, 1.4);
    g.beginPath();
    g.moveTo(-6 * s, -6 * s);
    g.lineTo(6 * s, 6 * s);
    g.moveTo(6 * s, -6 * s);
    g.lineTo(-6 * s, 6 * s);
    g.stroke();
    g.lineWidth = this.lw(1);
    for (let q = 0; q < 4; q++) {
      g.beginPath();
      g.arc((q & 1 ? 7.4 : -7.4) * s, (q & 2 ? 7.4 : -7.4) * s, 3.3 * s, 0, K.TAU);
      g.stroke();
    }
    g.fillStyle = K.rgba(color ?? this.col.bright, alpha);
    g.beginPath();
    g.moveTo(5 * s, 0);
    g.lineTo(0, 2.6 * s);
    g.lineTo(-2.2 * s, 0);
    g.lineTo(0, -2.6 * s);
    g.closePath();
    g.fill();
    g.restore();
    return this;
  }
  /** A pointer, for showing a person acting on the interface. */
  cursor(x: number, y: number, alpha = 1): this {
    const g = this.g;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + 14);
    g.lineTo(x + 3.8, y + 10.4);
    g.lineTo(x + 9.4, y + 10.4);
    g.closePath();
    g.fillStyle = K.rgba(this.col.ink, alpha);
    g.fill();
    this.stroke(this.col.bg, alpha, 1);
    g.stroke();
    return this;
  }
  /** Corner brackets around a point: "this is the thing". */
  brackets(x: number, y: number, r: number, color?: string, alpha = 1, len = 4): this {
    const g = this.g;
    this.stroke(color ?? this.col.bright, alpha, 1.3);
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      g.moveTo(x + sx * r, y + sy * (r - len));
      g.lineTo(x + sx * r, y + sy * r);
      g.lineTo(x + sx * (r - len), y + sy * r);
    }
    g.stroke();
    return this;
  }
}

/* ---- Halftone ---------------------------------------------------------------
   A field of dots on a regular lattice. The film writes a tone (0..1) and a
   palette index for every dot each frame; size carries the tone. */
export class Halftone {
  readonly cols: number;
  readonly rows: number;
  readonly n: number;
  readonly pitch: number;
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly tone: Float32Array;
  readonly shade: Uint8Array;

  constructor(x: number, y: number, cols: number, rows: number, pitch: number, o: { stagger?: boolean } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.n = cols * rows;
    this.pitch = pitch;
    this.xs = new Float32Array(this.n);
    this.ys = new Float32Array(this.n);
    this.tone = new Float32Array(this.n);
    this.shade = new Uint8Array(this.n);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        this.xs[i] = x + (c + 0.5) * pitch + (o.stagger && r % 2 ? pitch / 2 : 0);
        this.ys[i] = y + (r + 0.5) * pitch;
      }
    }
  }
  /** Index of the dot nearest a point, or -1 outside the field. */
  at(x: number, y: number): number {
    const c = Math.floor((x - (this.xs[0] - this.pitch / 2)) / this.pitch);
    const r = Math.floor((y - (this.ys[0] - this.pitch / 2)) / this.pitch);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }
  /**
   * Draw the field. `palette[shade]` colours each dot; radius = pitch * (min + span * tone^gamma).
   * Dots smaller than about a device pixel are drawn as squares, which is both faster and crisper.
   */
  draw(pen: Pen, palette: string[], o: { min?: number; max?: number; gamma?: number; alpha?: number } = {}): void {
    const g = pen.g;
    const min = (o.min ?? 0.07) * this.pitch;
    const span = (o.max ?? 0.46) * this.pitch - min;
    const gamma = o.gamma ?? 0.7;
    const small = 1.25 * pen.px;
    g.globalAlpha = o.alpha ?? 1;
    for (let k = 0; k < palette.length; k++) {
      g.fillStyle = palette[k];
      g.beginPath();
      let any = false;
      for (let i = 0; i < this.n; i++) {
        if (this.shade[i] !== k) continue;
        const tn = this.tone[i];
        if (tn <= 0) continue;
        const r = min + span * (gamma === 1 ? tn : Math.pow(tn, gamma));
        const x = this.xs[i];
        const y = this.ys[i];
        if (r <= small) g.rect(x - r, y - r, r * 2, r * 2);
        else {
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, K.TAU);
        }
        any = true;
      }
      if (any) g.fill();
    }
    g.globalAlpha = 1;
  }
}

/* ---- Isometric ------------------------------------------------------------- */
/** An isometric projector: iso(ox, oy, s)(x, y, z) -> screen point. */
export const iso =
  (ox: number, oy: number, s = 1) =>
  (x: number, y: number, z = 0): Pt => [ox + (x - y) * 0.866 * s, oy + (x + y) * 0.5 * s - z * s];

/** A wireframe box in isometric view: near edges solid, far edges dashed. */
export function isoBox(pen: Pen, P: (x: number, y: number, z?: number) => Pt, x: number, y: number, z: number, w: number, d: number, h: number, o: { hidden?: boolean; fill?: string; fillAlpha?: number } = {}): void {
  const g = pen.g;
  const p = (a: number, b: number, c: number): Pt => P(x + a * w, y + b * d, z + c * h);
  const path = (pts: Pt[]): void => {
    g.beginPath();
    pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
  };
  if (o.fill) {
    g.fillStyle = K.rgba(o.fill, o.fillAlpha ?? 0.08);
    path([p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]);
    g.fill();
    path([p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)]);
    g.fill();
    path([p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1)]);
    g.fill();
  }
  // Visible: top face, and the two faces toward the viewer (+x and +y).
  path([p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), p(0, 0, 1)]);
  g.stroke();
  path([p(1, 0, 1), p(1, 0, 0), p(1, 1, 0), p(1, 1, 1)]);
  g.stroke();
  path([p(1, 1, 0), p(0, 1, 0), p(0, 1, 1)]);
  g.stroke();
  if (o.hidden) {
    const dash = g.getLineDash();
    g.setLineDash(DASH.fine as unknown as number[]);
    path([p(0, 0, 1), p(0, 0, 0), p(1, 0, 0)]);
    g.stroke();
    path([p(0, 0, 0), p(0, 1, 0)]);
    g.stroke();
    g.setLineDash(dash);
  }
}
