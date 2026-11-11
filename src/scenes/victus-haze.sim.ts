/* Victus Haze as a small model of two satellites, with no DOM in it.

   What is reported: the order of events and five durations. The launch came 16 h 42 min
   after the notice, against a record of 27 h. Jackal's first sortie was finished in 61
   of the 72 hours allowed. In the second, a validated plan was ready in under 30 minutes
   from tasking, the ingress and burn sequence to close on Puma took 23 minutes, Puma
   maneuvered away during that approach, the ground replanned, and Jackal closed again.

   What is not reported: every altitude and distance, and how long the replanning took.
   So the orbits here are schematic. They do obey the one rule that makes a chase in
   orbit strange: the lower satellite goes round faster. To catch up you drop lower; to
   fall back you climb.

   The target's flight is a list of eras. Each era begins with a burn that moves it to
   a new orbit. The story supplies the first two; the viewer can add more. */
import * as K from '../core/kit.ts';
import type { Pt } from '../core/kit.ts';

export const DUR = 24;
export const HUNT = 7;
export const ROUND_TWO = 14.5;
export const CENTRE: Pt = [430, 262];
export const R_EARTH = 84;
/** Jackal's waiting orbit, Puma's first orbit, and where Puma runs to in the story. */
export const R_JACKAL = 118;
export const R_PUMA = 150;
export const R_RUN = 188;
/** The orbits a viewer's extra burns cycle through. */
export const R_CHOICES = [R_PUMA, 170, 132, R_RUN];

/* ---- Reported figures ---- */
export const NOTICE_HOURS = 16 + 42 / 60;
export const RECORD_HOURS = 27;
export const SORTIE_HOURS = 61;
export const SORTIE_LIMIT = 72;
export const PLAN_MIN = 30;
export const INGRESS_MIN = 23;

/* ---- The story's clock ---- */
export const NOTICE = 0.8;
export const LIFTOFF = 5.4;
export const INSERT = 6.9;
/* First sortie: find it, close on it, fly round it, photograph it, go home. */
export const TASKED = 7.3;
export const CLOSE = 8.4;
export const ON_STATION = 10.6;
export const DONE = 12.6;
export const EGRESS = 12.9;
export const HOME = 14;
/* Second sortie: tasked, a plan, an approach, and during the approach the target runs. */
export const TASKED_AGAIN = ROUND_TWO;
export const PLANNED = 15;
export const INGRESS = 15.3;
export const INGRESS_END = 17.4;
export const EVADE = 17;
/** How long a burn lasts, how long Jackal is without its target afterwards, and how long it takes to close again. */
export const BURN = 0.9;
export const LAG = 1.6;
export const CHASE = 2.2;
/** When the story's chase ends with Jackal back on its target. */
export const BACK = EVADE + LAG + CHASE;

const SITE = 2.4;
const ARC = 0.9;
/** Angular speed on a circular orbit of radius r: lower is faster. */
export const omega = (r: number): number => 0.62 * Math.pow(R_JACKAL / r, 1.5);
const LOOP = 2.6;
const ALONG = 17;
const RADIAL = 9;

export interface Polar {
  theta: number;
  r: number;
}
export interface Era {
  at: number;
  r0: number;
  r1: number;
  /** Puma's angle when the era begins, and how far it swings during the burn. */
  phi0: number;
  swing: number;
}
export const point = (q: Polar): Pt => [CENTRE[0] + q.r * Math.cos(q.theta), CENTRE[1] + q.r * Math.sin(q.theta)];

const radiusIn = (e: Era, tau: number): number => K.lerp(e.r0, e.r1, K.smooth(K.clamp(tau / BURN)));
/** The angle swept during the first `tau` seconds of an era's burn. */
function swept(e: Era, tau: number): number {
  const n = 24;
  const h = Math.min(tau, BURN) / n;
  let a = 0;
  for (let i = 0; i < n; i++) a += omega(radiusIn(e, (i + 0.5) * h)) * h;
  return a;
}
function era(at: number, r0: number, r1: number, phi0: number): Era {
  const e: Era = { at, r0, r1, phi0, swing: 0 };
  e.swing = swept(e, BURN);
  return e;
}

/** Where Puma is in an era at time `s`. */
function inEra(e: Era, s: number): Polar {
  const tau = s - e.at;
  if (tau >= BURN) return { theta: e.phi0 + e.swing + omega(e.r1) * (tau - BURN), r: e.r1 };
  return { theta: e.phi0 + swept(e, tau), r: radiusIn(e, tau) };
}
/** Where Puma would have been had it not burned: the place Jackal is still heading for, or watching. */
const phantom = (e: Era, s: number): Polar => ({ theta: e.phi0 + omega(e.r0) * (s - e.at), r: e.r0 });
const current = (eras: Era[], s: number): number => {
  let i = 0;
  for (let k = 0; k < eras.length; k++) if (s >= eras[k].at) i = k;
  return i;
};

/** The story: Puma arrives in its orbit, and in the second sortie runs to a higher one. */
export function story(): Era[] {
  const first = era(INSERT, R_PUMA, R_PUMA, SITE + ARC);
  return [first, evade([first], EVADE, R_RUN)];
}
/** A new burn, starting from wherever Puma is at `at`. */
export function evade(eras: Era[], at: number, r1: number): Era {
  const now = inEra(eras[eras.length - 1], at);
  return era(at, now.r, r1, now.theta);
}
/** True when Jackal is settled around Puma after the latest burn, so that another makes sense. */
export const settled = (eras: Era[], s: number): boolean => eras.length > 1 && s >= eras[eras.length - 1].at + LAG + CHASE + 0.3;

/** Puma at time `s`, or null before it reaches orbit. */
export function puma(eras: Era[], s: number): Polar | null {
  return s < INSERT ? null : inEra(eras[current(eras, s)], s);
}
/** The rocket's climb from the launch site to Puma's orbit. */
export function ascent(s: number): Polar {
  const v = K.ease.inOutSine(K.seg(s, LIFTOFF, INSERT));
  return { theta: SITE + ARC * v * v, r: K.lerp(R_EARTH, R_PUMA, Math.pow(v, 0.8)) };
}
export const SITE_POINT: Pt = point({ theta: SITE, r: R_EARTH });

/** Puma's angle on its first orbit, had it never burned. */
const first = (s: number): number => SITE + ARC + omega(R_PUMA) * (s - INSERT);
/** Jackal's waiting orbit before the first sortie: lower, and behind, so that it catches up. */
const J_BEFORE = first(CLOSE) - 0.75 - omega(R_JACKAL) * CLOSE;
/** And between the sorties: lower again, and by now ahead, so that the second approach has to climb and fall back. */
const J_BETWEEN = first(INGRESS) + 0.5 - omega(R_JACKAL) * INGRESS;
const waiting = (phase: number, s: number): Pt => point({ theta: phase + omega(R_JACKAL) * s, r: R_JACKAL });
/** Circling a point in orbit: ahead and behind along the track, a little above and below. */
function around(q: Polar, s: number): Pt {
  const phi = LOOP * s;
  return point({ theta: q.theta + (ALONG * Math.cos(phi)) / q.r, r: q.r + RADIAL * Math.sin(phi) });
}
const mix = (a: Pt, b: Pt, u: number, bulge: number): Pt => {
  const x = K.lerp(a[0], b[0], u);
  const y = K.lerp(a[1], b[1], u);
  const d = Math.hypot(x - CENTRE[0], y - CENTRE[1]) || 1;
  const push = bulge * Math.sin(Math.PI * u);
  return [x + ((x - CENTRE[0]) / d) * push, y + ((y - CENTRE[1]) / d) * push];
};

export type Mode = 'waiting' | 'closing' | 'station' | 'leaving' | 'blind';
export interface Hunter {
  p: Pt;
  mode: Mode;
  /** Progress of the approach under way, 0..1. */
  u: number;
}
/** The second approach, toward wherever Jackal believes Puma to be. */
const approach = (target: Polar, s: number): Pt => mix(waiting(J_BETWEEN, s), around(target, s), K.smooth(K.seg(s, INGRESS, INGRESS_END)), 10);

/** Jackal at time `s`. */
export function jackal(eras: Era[], s: number): Hunter {
  const i = current(eras, s);
  const e = eras[i];
  if (i === 0) {
    if (s < CLOSE) return { p: waiting(J_BEFORE, s), mode: 'waiting', u: 0 };
    if (s < ON_STATION) {
      const u = K.seg(s, CLOSE, ON_STATION);
      return { p: mix(waiting(J_BEFORE, s), around(inEra(e, s), s), K.smooth(u), 0), mode: 'closing', u };
    }
    if (s < EGRESS) return { p: around(inEra(e, s), s), mode: 'station', u: 1 };
    if (s < HOME) {
      const u = K.seg(s, EGRESS, HOME);
      return { p: mix(around(inEra(e, s), s), waiting(J_BETWEEN, s), K.smooth(u), 0), mode: 'leaving', u };
    }
    if (s < INGRESS) return { p: waiting(J_BETWEEN, s), mode: 'waiting', u: 0 };
    if (s < INGRESS_END) return { p: approach(inEra(e, s), s), mode: 'closing', u: K.seg(s, INGRESS, INGRESS_END) };
    return { p: around(inEra(e, s), s), mode: 'station', u: 1 };
  }
  // Puma has burned. Until a new plan arrives Jackal carries on toward, or keeps circling, the place it expected.
  const ghost = phantom(e, s);
  const arriving = i === 1 && s < INGRESS_END;
  const before = arriving ? approach(ghost, s) : around(ghost, s);
  if (s < e.at + LAG) return { p: before, mode: arriving ? 'closing' : 'blind', u: arriving ? K.seg(s, INGRESS, INGRESS_END) : 0 };
  const u = K.seg(s, e.at + LAG, e.at + LAG + CHASE);
  if (u >= 1) return { p: around(inEra(e, s), s), mode: 'station', u: 1 };
  // To fall back in orbit you climb; to catch up you drop. The path bows the way the chase goes.
  return { p: mix(before, around(inEra(e, s), s), K.smooth(u), e.r1 > e.r0 ? 9 : -9), mode: 'closing', u };
}
/** Where Jackal last expected Puma, while it has lost it. */
export function lastSeen(eras: Era[], s: number): Polar | null {
  const i = current(eras, s);
  return i > 0 && s < eras[i].at + LAG + CHASE ? phantom(eras[i], s) : null;
}
/** Does Jackal have Puma in view? Only while tasked, and not between a burn and the end of the chase that follows. */
export function custody(eras: Era[], s: number): boolean {
  if (s < TASKED + 0.4) return false;
  if (s < EGRESS) return true;
  if (s < TASKED_AGAIN + 0.4) return false;
  const i = current(eras, s);
  return i === 0 || s < eras[i].at + 0.15 || s >= eras[i].at + LAG + CHASE * 0.8;
}
export const separation = (eras: Era[], s: number): number => {
  const q = puma(eras, s);
  if (!q) return Infinity;
  const a = point(q);
  const b = jackal(eras, s).p;
  return K.dist(a[0], a[1], b[0], b[1]);
};
