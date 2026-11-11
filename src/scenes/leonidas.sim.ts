/* The Leonidas demonstration as a schedule: 61 drones in five scenarios, as Epirus
   described them, and the seven engagements that brought them down.

   The counts are from the company's account, and so is the order: its release lists the
   four set pieces without numbering them and puts the swarm last. Where each drone flies and
   exactly when is invented to make the sequence legible. No DOM in here, so the counts
   can be tested without a browser. */
import * as K from '../core/kit.ts';
import type { Pt } from '../core/kit.ts';

export const DUR = 21;
export const SWARM_ACT = 7.4;
export const GATE = 13.8;
export const PULSE = 14.35;
/** How fast a pulse crosses the plate, in design pixels a second. */
export const WAVE = 1500;
export const EMITTER: Pt = [464, 446];
export const SAFE: Pt = [700, 226];
/** The five scenarios and how many drones flew in each: 6 + 2 + 1 + 3 + 49. */
export const SCENARIOS = [
  { name: 'Two groups from opposite sides', count: 6 },
  { name: 'One of a pair, chosen by the audience', count: 2 },
  { name: 'One brought down inside a safe zone', count: 1 },
  { name: 'Three at three ranges, at once', count: 3 },
  { name: 'A swarm of forty-nine', count: 49 },
];
export const TOTAL = SCENARIOS.reduce((n, s) => n + s.count, 0);

export interface Drone {
  scenario: number;
  spawn: number;
  arrive: number;
  from: Pt;
  to: Pt;
  /** When the pulse reaches it. */
  kill: number;
  /** Where it was at that moment. */
  at: Pt;
  spin: number;
}
export interface Shot {
  at: number;
  aim: number;
  half: number;
  reach: number;
}
export interface Sim {
  drones: Drone[];
  shots: Shot[];
  /** Which drone the audience picks in the second scenario. */
  picked: number;
}

const ease = (u: number): number => K.ease.inOutSine(u);
/** Where a drone is at story time `s`, ignoring whether it has been hit. */
export function path(d: Drone, s: number): Pt {
  const u = ease(K.seg(s, d.spawn, d.arrive));
  // The swarm keeps closing on the emitter once it has formed up.
  const creep = d.scenario === 4 ? 46 * K.seg(s, d.arrive, PULSE + 1) : 0;
  return [K.lerp(d.from[0], d.to[0], u), K.lerp(d.from[1], d.to[1], u) + creep];
}

export function simulate(): Sim {
  const drones: Drone[] = [];
  const shots: Shot[] = [];
  const add = (scenario: number, spawn: number, arrive: number, from: Pt, to: Pt): Drone => {
    const d: Drone = { scenario, spawn, arrive, from, to, kill: Infinity, at: to, spin: K.hash(drones.length, 9) * K.TAU };
    drones.push(d);
    return d;
  };
  /** Fire at a group: aim at its centre at that moment, and mark each member with the time the wave reaches it. */
  const fire = (at: number, group: Drone[], half: number): void => {
    const pts = group.map((d) => path(d, at));
    const cx = pts.reduce((n, p) => n + p[0], 0) / pts.length;
    const cy = pts.reduce((n, p) => n + p[1], 0) / pts.length;
    let reach = 0;
    group.forEach((d, i) => {
      const r = K.dist(EMITTER[0], EMITTER[1], pts[i][0], pts[i][1]);
      reach = Math.max(reach, r);
      d.kill = at + r / WAVE;
      d.at = path(d, d.kill);
    });
    shots.push({ at, aim: Math.atan2(cy - EMITTER[1], cx - EMITTER[0]), half, reach: reach + 46 });
  };

  /* 1. Two groups of three, from opposite sides: the left, then the right. */
  const left = [0, 1, 2].map((i) => add(0, 1.0 + i * 0.08, 3.3, [62, 118 + i * 30], [318 + i * 8, 300 + i * 22]));
  const right = [0, 1, 2].map((i) => add(0, 1.15 + i * 0.08, 3.6, [866, 118 + i * 30], [610 - i * 8, 300 + i * 22]));
  fire(2.3, left, 0.2);
  fire(3.0, right, 0.2);

  /* 2. Two close together. The audience picks one; the other is left alone, then taken too. */
  const pair = [0, 1].map((i) => add(1, 3.35, 5.3, [446 + i * 30, 58], [446 + i * 30, 300]));
  fire(4.15, [pair[1]], 0.035);
  fire(4.8, [pair[0]], 0.035);

  /* 3. One drone, brought down as it crosses a marked safe zone. */
  const lone = add(2, 4.95, 6.65, [SAFE[0] + 70, SAFE[1] - 156], [SAFE[0] - 70, SAFE[1] + 156]);
  fire(5.8 - K.dist(EMITTER[0], EMITTER[1], SAFE[0], SAFE[1]) / WAVE, [lone], 0.05);

  /* 4. Three at different ranges on one bearing, taken together. */
  const bearing = -2.18;
  const line = [150, 245, 340].map((r, i) =>
    add(3, 6.0 + i * 0.05, 7.05, [EMITTER[0] + (r + 130) * Math.cos(bearing), EMITTER[1] + (r + 130) * Math.sin(bearing)], [EMITTER[0] + r * Math.cos(bearing), EMITTER[1] + r * Math.sin(bearing)]),
  );
  fire(6.9, line, 0.075);

  /* 5. Forty-nine in one formation: scattered, but never closer than a rotor's width. */
  const r = K.rng(49);
  const spots: Pt[] = [];
  while (spots.length < SCENARIOS[4].count) {
    const a = r() * K.TAU;
    const m = Math.sqrt(r());
    const p: Pt = [464 + Math.cos(a) * m * 318, 168 + Math.sin(a) * m * 88];
    if (spots.every((q) => K.dist(p[0], p[1], q[0], q[1]) > 27)) spots.push(p);
  }
  spots.sort((a, b) => a[0] - b[0]);
  const swarm = spots.map((p, i) => add(4, SWARM_ACT + 0.3 + K.hash(i, 3) * 1.9, 11.4 + K.hash(i, 4) * 0.5, [p[0] + (K.hash(i, 5) - 0.5) * 120, 22], p));
  fire(PULSE, swarm, 1.02);

  return { drones, shots, picked: drones.indexOf(pair[1]) };
}

/** How many are flying, and how many have been brought down, at story time `t`. */
export function tally(sim: Sim, t: number): { flying: number; down: number } {
  let flying = 0;
  let down = 0;
  for (const d of sim.drones) {
    if (t >= d.kill) down++;
    else if (t >= d.spawn) flying++;
  }
  return { flying, down };
}
