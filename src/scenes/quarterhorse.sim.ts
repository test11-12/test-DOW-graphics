/* The geometry of going supersonic, with no DOM in it.

   In a picture that moves with the aircraft, the air runs backward at the aircraft's
   speed. A beat of sound that left the nose some time ago is now a circle whose radius
   is the distance sound has travelled since, centred on the place the nose was then.
   Below Mach 1 the circles reach ahead of the nose; at Mach 1 they all touch it; above
   Mach 1 they fall behind inside a cone whose half-angle is the arcsine of 1 / Mach.

   Only the top speed, Mach 1.21, is reported. The acceleration up to it is schematic. */
import * as K from '../core/kit.ts';

export const DUR = 21;
export const MACH_1 = 7;
export const TOP = 13.5;
/** Reported top speed of the flight. */
export const MACH_TOP = 1.21;
/** How fast a ring grows on screen, in design pixels a second: the speed of sound at the film's scale. */
export const SOUND = 34;
/** Seconds between rings, and how long each is kept. */
export const PERIOD = 0.42;
export const LIFE = 13;

/** The Mach number at story time `s`. Before the film it is the opening speed; after it, the top speed. */
export const mach = K.keys([
  [0, 0.72],
  [2.4, 0.72],
  [MACH_1, 0.96, 'inOutSine'],
  [8.3, 1, 'inOutSine'],
  [10.6, 1],
  [13.3, MACH_TOP, 'inOutSine'],
  [DUR, MACH_TOP],
]);

const STEP = 0.02;
const TABLE = (() => {
  const n = Math.round(DUR / STEP);
  const d = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) d[i] = d[i - 1] + ((mach((i - 1) * STEP) + mach(i * STEP)) / 2) * STEP;
  return d;
})();
/** How far the air has run past the aircraft by story time `s`, in units of (speed of sound x seconds). */
export function distance(s: number): number {
  if (s <= 0) return mach(0) * s;
  if (s >= DUR) return TABLE[TABLE.length - 1] + MACH_TOP * (s - DUR);
  const f = s / STEP;
  const i = Math.floor(f);
  return K.lerp(TABLE[i], TABLE[Math.min(TABLE.length - 1, i + 1)], f - i);
}

/** Half-angle of the Mach cone, in radians. At or below Mach 1 there is no cone: the waves are a flat wall or run ahead. */
export const halfAngle = (m: number): number => (m > 1 ? Math.asin(1 / m) : Math.PI / 2);

export interface Ring {
  /** How far behind the nose the ring's centre is, and its radius, in design pixels. */
  back: number;
  radius: number;
  age: number;
}
/**
 * The rings on screen at time `now`. `travelled(s)` is the distance function in force:
 * the story's, or the viewer's choice of speed.
 */
export function rings(now: number, travelled: (s: number) => number = distance): Ring[] {
  const out: Ring[] = [];
  const here = travelled(now);
  for (let k = Math.floor(now / PERIOD); k * PERIOD > now - LIFE; k--) {
    const age = now - k * PERIOD;
    out.push({ back: SOUND * (here - travelled(k * PERIOD)), radius: SOUND * age, age });
  }
  return out;
}
