/* Craft: the silhouettes the films share.

   Each is a handful of straight-sided outlines in unit coordinates: the craft is one
   unit long, centred on the origin, with its nose toward +x. Plan views are seen from
   above (y is the right wing). Side views have y pointing down, as on the canvas.

   They are marks, not portraits: proportions are right, details are left out. A film
   that needs a true dimension states it in a label; nothing here should be measured. */
import * as K from '../core/kit.ts';
import type { Pt } from '../core/kit.ts';
import type { Pen } from './pen.ts';

export interface Outline {
  pts: Pt[];
  /** An open line rather than a closed shape. */
  open?: boolean;
  /** Drawn but never filled: panel lines, masts, canopies. */
  detail?: boolean;
}
export type Craft = Outline[];

/** A closed outline from its right-hand half, listed nose to tail. */
const mirror = (half: Pt[]): Pt[] => [...half, ...half.slice(1, -1).reverse().map(([x, y]): Pt => [x, -y])];
/** The same detail on both sides of the centre line. */
const both = (pts: Pt[], o: Partial<Outline> = {}): Outline[] => [
  { pts, ...o },
  { pts: pts.map(([x, y]): Pt => [x, -y]), ...o },
];
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** The same outline on the left and on the right, for head-on views. */
const sides = (pts: Pt[], o: Partial<Outline> = {}): Outline[] => [
  { pts, ...o },
  { pts: pts.map(([x, y]): Pt => [-x, y]), ...o },
];

/* ---- Aircraft, seen from above --------------------------------------------- */

/** A small swept-wing jet with no cockpit: the YFQ-44A. */
export const FURY: Craft = [
  {
    pts: mirror([
      [0.5, 0], [0.42, 0.02], [0.3, 0.036], [0.15, 0.046],
      [-0.07, 0.36], [-0.15, 0.36], [-0.13, 0.056], [-0.26, 0.05],
      [-0.37, 0.19], [-0.43, 0.19], [-0.41, 0.04], [-0.5, 0.03], [-0.5, 0],
    ]),
  },
  { pts: [[0.3, 0], [-0.46, 0]], open: true, detail: true },
];

/** A twin-engined, twin-tailed carrier fighter: the F/A-18E/F. */
export const HORNET: Craft = [
  {
    pts: mirror([
      [0.5, 0], [0.43, 0.017], [0.34, 0.034], [0.26, 0.046], [0.07, 0.1],
      [-0.04, 0.37], [-0.11, 0.37], [-0.16, 0.1], [-0.24, 0.086], [-0.27, 0.088],
      [-0.4, 0.22], [-0.46, 0.22], [-0.44, 0.07], [-0.5, 0.06], [-0.5, 0.016], [-0.46, 0],
    ]),
  },
  ...both([[-0.2, 0.06], [-0.36, 0.112], [-0.4, 0.112], [-0.31, 0.06]], { detail: true }),
  { pts: [[0.38, 0], [0.33, 0.02], [0.24, 0.022], [0.2, 0], [0.24, -0.022], [0.33, -0.02]], detail: true },
];

/** A single-engined delta with no cockpit: Quarterhorse Mk 2.1. */
export const DELTA: Craft = [
  {
    pts: mirror([
      [0.5, 0], [0.36, 0.028], [0.22, 0.044], [0.12, 0.05],
      [-0.36, 0.33], [-0.42, 0.33], [-0.4, 0.06], [-0.5, 0.045], [-0.5, 0],
    ]),
  },
  { pts: [[-0.12, 0], [-0.47, 0]], open: true, detail: true },
];

/** A cropped delta flying wing with tip fins: the LUCAS one-way attack drone. */
export const LUCAS: Craft = [
  {
    pts: mirror([
      [0.5, 0], [0.34, 0.04], [0.28, 0.05],
      [-0.38, 0.4], [-0.5, 0.4], [-0.42, 0.05], [-0.5, 0.03], [-0.5, 0],
    ]),
  },
];

/** The Roc carrier aircraft: two fuselages under one very long wing. One unit is the wingspan. */
export const ROC: Craft = [
  { pts: mirror([[0.09, 0], [0.055, 0.5], [0.02, 0.5], [-0.005, 0]]) },
  ...both([[0.31, 0.123], [0.27, 0.139], [-0.2, 0.137], [-0.31, 0.127], [-0.31, 0.119], [-0.2, 0.109], [0.27, 0.107]]),
  ...both([[-0.245, 0.123], [-0.27, 0.19], [-0.3, 0.19], [-0.295, 0.123], [-0.3, 0.056], [-0.27, 0.056]]),
  ...both(box(0.066, 0.2, 0.116, 0.212)),
  ...both(box(0.062, 0.27, 0.11, 0.282)),
  ...both(box(0.056, 0.34, 0.102, 0.352)),
];

/** Roc seen head-on: the long wing, with a fuselage and a tail under each side. One unit is the wingspan; y points down. */
export const ROC_FRONT: Craft = [
  { pts: [[-0.5, -0.004], [0.5, -0.004], [0.5, 0.004], [0.14, 0.01], [-0.14, 0.01], [-0.5, 0.004]] },
  ...sides([[0.109, 0.004], [0.137, 0.004], [0.137, 0.046], [0.123, 0.052], [0.109, 0.046]]),
  ...sides([[0.12, -0.085], [0.126, -0.085], [0.128, 0.004], [0.118, 0.004]]),
  ...sides([[0.082, -0.04], [0.082, -0.034], [0.164, -0.034], [0.164, -0.04]], { detail: true }),
];
/** Roc's six engines, as [x, y, radius] in the same units. */
export const ROC_ENGINES: Array<[number, number, number]> = [-0.34, -0.27, -0.2, 0.2, 0.27, 0.34].map((x): [number, number, number] => [x, 0.022, 0.011]);

/** A four-engined military transport with a T-tail, seen from above: the C-17. */
export const AIRLIFTER: Craft = [
  {
    pts: mirror([
      [0.5, 0], [0.45, 0.034], [0.13, 0.04], [-0.12, 0.49], [-0.2, 0.49], [-0.07, 0.04], [-0.37, 0.034],
      [-0.47, 0.18], [-0.52, 0.18], [-0.5, 0.02], [-0.5, 0],
    ]),
  },
];

/* ---- Missiles and small vehicles ------------------------------------------- */

/** A slender air-to-air missile with mid-body wings and tail fins. */
export const MISSILE: Craft = [
  {
    pts: mirror([
      [0.5, 0], [0.44, 0.02], [0.4, 0.025], [0.07, 0.025], [-0.01, 0.085], [-0.06, 0.085], [-0.06, 0.025],
      [-0.37, 0.025], [-0.43, 0.09], [-0.49, 0.09], [-0.49, 0.025], [-0.5, 0.025], [-0.5, 0],
    ]),
  },
];

/** A boost-glide round: a blunt booster behind a sharp glide body. */
export const GLIDER: Craft = [
  {
    pts: mirror([
      [0.5, 0], [0.3, 0.03], [0.12, 0.05], [0.08, 0.034], [-0.38, 0.034],
      [-0.42, 0.085], [-0.5, 0.085], [-0.5, 0],
    ]),
  },
  { pts: [[0.08, 0.034], [0.08, -0.034]], open: true, detail: true },
];

/** A small rocket plane seen from the side: Talon-A. */
export const TALON: Craft = [
  {
    pts: [
      [0.5, 0.005], [0.26, -0.05], [-0.3, -0.056], [-0.43, -0.19], [-0.5, -0.19], [-0.47, -0.05],
      [-0.5, -0.04], [-0.5, 0.04], [0.2, 0.046],
    ],
  },
  { pts: [[0.04, 0.012], [-0.42, 0.022]], open: true, detail: true },
];

/* ---- Side elevations -------------------------------------------------------- */

/** A C-17 from the side, nose to the right. Ground level is y = 0.098. */
export const C17: Craft = [
  {
    pts: [
      [0.5, 0.005], [0.47, -0.035], [0.43, -0.055], [0.38, -0.062], [-0.22, -0.062], [-0.3, -0.075],
      [-0.415, -0.25], [-0.47, -0.25], [-0.455, -0.07], [-0.5, -0.045], [-0.495, -0.03],
      [-0.24, 0.058], [-0.05, 0.062], [-0.02, 0.078], [0.14, 0.078], [0.17, 0.062], [0.4, 0.058], [0.47, 0.035],
    ],
  },
  { pts: [[-0.36, -0.259], [-0.525, -0.259], [-0.525, -0.248], [-0.4, -0.246]] },
  { pts: [[0.11, -0.061], [-0.1, -0.04], [-0.16, -0.036], [-0.02, -0.058]] },
  { pts: [[0.2, -0.02], [0.185, -0.036], [0.09, -0.04], [0.075, -0.022], [0.09, -0.006], [0.185, -0.006]], detail: true },
  { pts: [[0.1, -0.006], [0.085, -0.022], [-0.01, -0.026], [-0.025, -0.008], [-0.01, 0.008], [0.085, 0.008]], detail: true },
  { pts: [[0.455, -0.03], [0.425, -0.046], [0.4, -0.046], [0.41, -0.03]], detail: true },
];
/** Where a C-17's wheels sit, as [x, y, radius]. */
export const C17_WHEELS: Array<[number, number, number]> = [[0.02, 0.086, 0.012], [0.062, 0.086, 0.012], [0.104, 0.086, 0.012], [0.4, 0.087, 0.011]];
/** The rear ramp of a C-17: hinge, and where its foot meets the ground. */
export const C17_RAMP: [Pt, Pt] = [[-0.24, 0.058], [-0.4, 0.098]];
/** The cargo hold: floor and ceiling, front and back. */
export const C17_HOLD = { x0: -0.24, x1: 0.36, floor: 0.046, ceiling: -0.026 };

/** An Independence-class littoral combat ship from the side, bow to the left. The waterline is y = 0. */
export const LCS: Craft = [
  {
    pts: [
      [-0.47, 0], [-0.5, -0.066], [-0.3, -0.082], [-0.22, -0.088], [-0.16, -0.172], [-0.03, -0.172],
      [-0.03, -0.155], [0.16, -0.155], [0.18, -0.1], [0.48, -0.1], [0.5, -0.084], [0.5, 0],
    ],
  },
  { pts: [[-0.45, -0.04], [0.5, -0.048]], open: true, detail: true },
  { pts: [[-0.08, -0.172], [-0.072, -0.262]], open: true, detail: true },
  { pts: [[-0.1, -0.23], [-0.045, -0.23]], open: true, detail: true },
  { pts: [[-0.365, -0.078], [-0.36, -0.104], [-0.325, -0.104], [-0.32, -0.08]], detail: true },
  { pts: [[-0.36, -0.097], [-0.41, -0.108]], open: true, detail: true },
  { pts: [[-0.155, -0.148], [-0.05, -0.148]], open: true, detail: true },
];
/** The flight deck of the LCS: its level, and where it starts and ends. */
export const LCS_DECK = { y: -0.1, x0: 0.18, x1: 0.48 };

/** Marauder from the side, bow to the right. The keel is y = 0.05 and the waterline y = 0.012. */
export const MARAUDER: Craft = [
  {
    pts: [
      [-0.5, 0.035], [-0.5, -0.04], [0.3, -0.05], [0.47, -0.062], [0.5, -0.066], [0.455, 0.035], [0.44, 0.05], [-0.44, 0.05],
    ],
  },
  { pts: [[0.12, -0.049], [0.14, -0.105], [0.27, -0.105], [0.3, -0.05]] },
  { pts: [[0.2, -0.105], [0.2, -0.17]], open: true, detail: true },
  { pts: [[0.175, -0.15], [0.225, -0.15]], open: true, detail: true },
  { pts: [[0.15, -0.092], [0.26, -0.092]], open: true, detail: true },
];
/** The top and bottom of Marauder's hull at a point along its length. */
export function marauderSection(x: number): [number, number] {
  const deck = x < 0.3 ? K.lerp(-0.04, -0.05, (x + 0.5) / 0.8) : x < 0.47 ? K.lerp(-0.05, -0.062, (x - 0.3) / 0.17) : K.lerp(-0.062, -0.066, (x - 0.47) / 0.03);
  const keel = x < -0.44 ? K.lerp(0.035, 0.05, (x + 0.5) / 0.06) : x <= 0.44 ? 0.05 : x <= 0.455 ? K.lerp(0.05, 0.035, (x - 0.44) / 0.015) : K.lerp(0.035, -0.066, (x - 0.455) / 0.045);
  return [deck, keel];
}

/** A minivan from the side, for scale. One unit is its length; the ground is y = 0. */
export const MINIVAN: Craft = [
  { pts: [[-0.5, -0.05], [-0.5, -0.22], [-0.44, -0.34], [0.12, -0.36], [0.3, -0.22], [0.47, -0.18], [0.5, -0.08], [0.5, -0.05]] },
];
export const MINIVAN_WHEELS: Array<[number, number, number]> = [[-0.3, -0.04, 0.075], [0.31, -0.04, 0.075]];

/* ---- Drawing ---------------------------------------------------------------- */
export interface CraftStyle {
  /** The craft's length on screen, in design pixels. */
  size: number;
  /** Heading, in radians. 0 points right. */
  angle?: number;
  color?: string;
  alpha?: number;
  /** What to fill closed outlines with, so the craft hides what is behind it. `null` leaves it hollow. */
  fill?: string | null;
  fillAlpha?: number;
  width?: number;
  dash?: readonly number[] | null;
  /** Mirror top to bottom, for a side view facing the other way. */
  flipY?: boolean;
  /** Mirror left to right. */
  flipX?: boolean;
}

/** Where a point of a craft lands on screen. */
export function place(p: Pt, x: number, y: number, o: CraftStyle): Pt {
  const px = p[0] * (o.flipX ? -1 : 1) * o.size;
  const py = p[1] * (o.flipY ? -1 : 1) * o.size;
  const a = o.angle ?? 0;
  if (!a) return [x + px, y + py];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x + px * c - py * s, y + px * s + py * c];
}

/** Draw a craft with its centre at (x, y). */
export function draw(pen: Pen, shape: Craft, x: number, y: number, o: CraftStyle): void {
  const alpha = o.alpha ?? 1;
  if (alpha <= 0) return;
  const g = pen.g;
  const color = o.color ?? pen.col.bright;
  const fill = o.fill === undefined ? pen.col.stage : o.fill;
  for (const part of shape) {
    g.beginPath();
    for (let i = 0; i < part.pts.length; i++) {
      const q = place(part.pts[i], x, y, o);
      if (i) g.lineTo(q[0], q[1]);
      else g.moveTo(q[0], q[1]);
    }
    if (!part.open) g.closePath();
    if (fill && !part.open && !part.detail) {
      g.fillStyle = K.rgba(fill, (o.fillAlpha ?? 0.94) * alpha);
      g.fill();
    }
    pen.stroke(color, alpha * (part.detail ? 0.6 : 1), part.detail ? 1 : (o.width ?? 1.3), o.dash ?? null);
    g.stroke();
  }
  g.setLineDash([]);
}

/** Wheels, engine faces and other round details given as [x, y, radius] in a craft's units. */
export function rounds(pen: Pen, list: Array<[number, number, number]>, x: number, y: number, o: CraftStyle): void {
  const alpha = o.alpha ?? 1;
  if (alpha <= 0) return;
  for (const [cx, cy, r] of list) {
    const q = place([cx, cy], x, y, o);
    pen.fill(o.fill === undefined || o.fill === null ? pen.col.stage : o.fill, alpha).dot(q[0], q[1], r * o.size);
    pen.stroke(o.color ?? pen.col.bright, alpha, o.width ?? 1.1).ring(q[0], q[1], r * o.size);
  }
}

/** Exhaust or smoke left along a path: dots that grow and fade with age. `at(age)` gives the point laid down that long ago. */
export function plume(pen: Pen, at: (age: number) => Pt | null, o: { life: number; step?: number; r0?: number; r1?: number; color?: string; alpha?: number; jitter?: number; seed?: number }): void {
  const step = o.step ?? 0.05;
  const color = o.color ?? pen.col.mark;
  const n = Math.floor(o.life / step);
  for (let i = 1; i <= n; i++) {
    const age = i * step;
    const q = at(age);
    if (!q) continue;
    const u = age / o.life;
    const j = o.jitter ?? 0;
    const dx = j ? (K.hash(i, (o.seed ?? 0) + 1) - 0.5) * j * u : 0;
    const dy = j ? (K.hash(i, (o.seed ?? 0) + 2) - 0.5) * j * u : 0;
    pen.fill(color, (o.alpha ?? 0.8) * (1 - u) * (1 - u)).dot(q[0] + dx, q[1] + dy, K.lerp(o.r0 ?? 1.2, o.r1 ?? 3.4, u));
  }
}
