/* The models and the figures behind the films. They run in Node with no browser, so
   every number a film shows can be checked like any other code. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../../src/core/kit.ts';
import * as Leonidas from '../../src/scenes/leonidas.sim.ts';
import * as Horse from '../../src/scenes/quarterhorse.sim.ts';
import * as Haze from '../../src/scenes/victus-haze.sim.ts';
import * as Fury from '../../src/scenes/fury.ts';
import * as Ward from '../../src/scenes/ward-250.ts';
import * as Talon from '../../src/scenes/talon-a2.ts';
import * as Varda from '../../src/scenes/varda-w5.ts';
import * as Lucas from '../../src/scenes/lucas.ts';
import * as Marauder from '../../src/scenes/marauder.ts';
import * as Beard from '../../src/scenes/blackbeard.ts';

const days = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

test('Leonidas: sixty-one drones in five scenarios, and the last forty-nine fall together', () => {
  const sim = Leonidas.simulate();
  const again = Leonidas.simulate();
  assert.deepEqual(sim.drones.map((d) => d.kill), again.drones.map((d) => d.kill), 'the run repeats exactly');
  assert.equal(Leonidas.TOTAL, 61);
  assert.deepEqual(Leonidas.SCENARIOS.map((s) => s.count), [6, 2, 1, 3, 49]);
  assert.equal(sim.drones.length, 61);
  for (let k = 0; k < 5; k++) assert.equal(sim.drones.filter((d) => d.scenario === k).length, Leonidas.SCENARIOS[k].count);
  for (const d of sim.drones) {
    assert.ok(Number.isFinite(d.kill) && d.kill > d.spawn, 'every drone flies, then is brought down');
    assert.ok(d.at[0] > 44 && d.at[0] < 884 && d.at[1] > 43 && d.at[1] < 477, 'and falls inside the plate');
  }
  assert.deepEqual(Leonidas.tally(sim, 0), { flying: 0, down: 0 });
  assert.deepEqual(Leonidas.tally(sim, Leonidas.GATE), { flying: 49, down: 12 }, 'at the viewer’s decision, twelve are down and forty-nine are flying');
  assert.deepEqual(Leonidas.tally(sim, Leonidas.DUR), { flying: 0, down: 61 });
  const swarm = sim.drones.filter((d) => d.scenario === 4).map((d) => d.kill);
  assert.ok(Math.min(...swarm) >= Leonidas.PULSE && Math.max(...swarm) - Math.min(...swarm) < 0.3, 'one pulse: the swarm falls inside a third of a second');
  const pair = sim.drones.filter((d) => d.scenario === 1);
  assert.ok(sim.drones[sim.picked].kill < Math.max(...pair.map((d) => d.kill)), 'the picked drone goes first and its neighbour is spared for a moment');
  const lone = sim.drones.find((d) => d.scenario === 2)!;
  assert.ok(Math.abs(lone.at[0] - Leonidas.SAFE[0]) < 20 && Math.abs(lone.at[1] - Leonidas.SAFE[1]) < 20, 'the third scenario ends inside the safe zone');
  assert.equal(sim.shots.length, 7);
  assert.equal(sim.shots[sim.shots.length - 1].at, Leonidas.PULSE);
});

test('Quarterhorse: the rings obey the Mach number', () => {
  assert.equal(Horse.MACH_TOP, 1.21);
  assert.equal(Horse.mach(0), 0.72);
  assert.equal(Horse.mach(Horse.DUR), 1.21);
  assert.equal(Horse.mach(9.5), 1, 'the film holds at Mach 1');
  assert.ok(Math.abs((Horse.halfAngle(1.21) * 180) / Math.PI - 55.7) < 0.1, 'the cone half-angle at Mach 1.21 is 55.7 degrees');
  assert.equal(Horse.halfAngle(0.9), Math.PI / 2);
  let last = -Infinity;
  for (let s = -5; s <= Horse.DUR + 30; s += 0.37) {
    const d = Horse.distance(s);
    assert.ok(d > last, 'the air only ever runs backward');
    last = d;
  }
  // Long before the film starts the speed is steady at Mach 0.72: every ring reaches ahead of the nose.
  for (const r of Horse.rings(0).filter((q) => q.age > 0)) assert.ok(r.radius > r.back, 'subsonic: sound outruns the aircraft');
  // Long after it ends the speed is steady at Mach 1.21: every ring is behind the nose, and tangent to the cone.
  const late = Horse.rings(Horse.DUR + 40);
  assert.ok(late.length >= Math.floor(Horse.LIFE / Horse.PERIOD) - 1);
  for (const r of late) {
    assert.ok(r.back > r.radius, 'supersonic: the aircraft outruns its sound');
    assert.ok(Math.abs(r.radius / r.back - Math.sin(Horse.halfAngle(1.21))) < 1e-6, 'each ring touches the cone');
  }
  // At a steady Mach 1 chosen by a viewer, every ring passes through the nose.
  for (const r of Horse.rings(50, (s) => s)) assert.ok(Math.abs(r.back - r.radius) < 1e-9);
});

test('Victus Haze: the reported times in the reported order, and a chase that closes every time', () => {
  assert.ok(Math.abs(Haze.NOTICE_HOURS - 16.7) < 1e-9, '16 hours 42 minutes');
  assert.ok(Haze.RECORD_HOURS - Haze.NOTICE_HOURS > 10, 'the old record is beaten by more than ten hours');
  assert.equal(Haze.SORTIE_LIMIT - Haze.SORTIE_HOURS, 11);
  assert.equal(Haze.PLAN_MIN, 30);
  assert.equal(Haze.INGRESS_MIN, 23);
  assert.ok(Haze.omega(Haze.R_JACKAL) > Haze.omega(Haze.R_PUMA) && Haze.omega(Haze.R_PUMA) > Haze.omega(Haze.R_RUN), 'the lower orbit is the faster one');
  const eras = Haze.story();
  assert.equal(eras.length, 2);
  assert.equal(Haze.puma(eras, Haze.INSERT - 0.01), null, 'Puma does not exist until it is launched');

  // First sortie: from a distance, onto the target, done, and home again.
  assert.equal(Haze.jackal(eras, 3).mode, 'waiting');
  assert.ok(Haze.separation(eras, Haze.CLOSE) > 60, 'the first approach starts from a distance');
  for (let s = Haze.ON_STATION; s < Haze.EGRESS; s += 0.2) assert.ok(Haze.separation(eras, s) < 22, 'on station, Jackal stays close');
  assert.equal(Haze.custody(eras, 5), false);
  assert.equal(Haze.custody(eras, Haze.ON_STATION + 1), true);
  assert.ok(Haze.DONE < Haze.EGRESS && Haze.HOME <= Haze.TASKED_AGAIN, 'the first sortie is over before the second is tasked');
  assert.equal(Haze.jackal(eras, Haze.HOME + 0.2).mode, 'waiting');
  assert.ok(Haze.separation(eras, Haze.HOME + 0.2) > 30, 'between the sorties Jackal is back in its own orbit');
  assert.equal(Haze.custody(eras, Haze.HOME + 0.2), false);

  // Second sortie, in the order True Anomaly reports it: tasked, a plan, an approach, and the burn comes during the approach.
  assert.ok(Haze.TASKED_AGAIN < Haze.PLANNED && Haze.PLANNED <= Haze.INGRESS && Haze.INGRESS < Haze.EVADE && Haze.EVADE < Haze.INGRESS_END);
  assert.equal(Haze.jackal(eras, Haze.EVADE - 0.1).mode, 'closing');
  assert.equal(Haze.custody(eras, Haze.EVADE - 0.1), true);
  const gap = Haze.EVADE + Haze.LAG;
  assert.ok(Haze.INGRESS_END < gap, 'the planned approach runs out before the new plan arrives');
  assert.ok(Haze.separation(eras, gap) > 40, 'the burn opens a real gap');
  assert.equal(Haze.custody(eras, gap), false);
  assert.equal(Haze.jackal(eras, Haze.INGRESS_END + 0.3).mode, 'blind');
  assert.equal(Haze.BACK, gap + Haze.CHASE);
  assert.ok(Haze.BACK < Haze.DUR - 2, 'the pursuit ends inside the film, with time to photograph');
  for (let s = Haze.BACK; s < Haze.BACK + 12; s += 0.2) assert.ok(Haze.separation(eras, s) < 22, 'and Jackal is back on it');
  assert.equal(Haze.custody(eras, Haze.BACK + 0.1), true);

  // Nothing jumps: neither satellite moves far in a twentieth of a second, across every hand-over between legs.
  for (let s = 0; s < Haze.DUR + 8; s += 0.05) {
    const a = Haze.jackal(eras, s).p;
    const b = Haze.jackal(eras, s + 0.05).p;
    assert.ok(K.dist(a[0], a[1], b[0], b[1]) < 9, `Jackal jumps at ${s.toFixed(2)}s`);
    const p = Haze.puma(eras, s);
    const q = Haze.puma(eras, s + 0.05);
    if (p && q) {
      const [x1, y1] = Haze.point(p);
      const [x2, y2] = Haze.point(q);
      assert.ok(K.dist(x1, y1, x2, y2) < 9, `Puma jumps at ${s.toFixed(2)}s`);
    }
    assert.ok(a[0] > 44 && a[0] < 884 && a[1] > 43 && a[1] < 477, 'Jackal stays on the plate');
  }
  // The viewer's turn: however often Puma runs, the chase closes and stays on the plate.
  let more = eras.slice();
  let at = Haze.DUR + 2;
  for (let k = 0; k < 9; k++) {
    assert.ok(Haze.settled(more, at));
    const next = Haze.R_CHOICES[(Haze.R_CHOICES.indexOf(more[more.length - 1].r1) + 1) % Haze.R_CHOICES.length];
    more = [...more, Haze.evade(more, at, next)];
    assert.equal(Haze.settled(more, at + 1), false, 'no second burn until the first chase is over');
    assert.ok(Haze.separation(more, at + Haze.LAG) > 12);
    at += Haze.LAG + Haze.CHASE + 0.6;
    assert.ok(Haze.separation(more, at) < 22);
    const p = Haze.point(Haze.puma(more, at)!);
    assert.ok(p[0] > 44 && p[0] < 884 && p[1] > 43 && p[1] < 477, 'Puma stays on the plate');
  }
});

test('the figures the films state are the reported ones, and the arithmetic holds', () => {
  assert.equal(Fury.DAYS, 556);
  // Ward 250: flown 15 Feb 2026, criticality announced 18 Jun, deadline 4 Jul.
  assert.equal(Ward.DAY_CRITICAL, days('2026-02-15', '2026-06-18'));
  assert.equal(Ward.DAY_DEADLINE, days('2026-02-15', '2026-07-04'));
  assert.equal(Ward.DAY_DEADLINE - Ward.DAY_CRITICAL, 16);
  assert.equal(Ward.MODULES, 8);
  assert.equal(Talon.YEARS, 56);
  assert.equal(Talon.SPAN_FT, 385);
  // Varda W-5: launched 28 Nov 2025, back 30 Jan 2026.
  assert.equal(Varda.DAYS, days('2025-11-28', '2026-01-30'));
  assert.equal(Lucas.PRICE_K, 35);
  // LUCAS: first ship launch 16 Dec 2025, first combat use 28 Feb 2026: ten weeks and four days.
  assert.equal(Math.floor(days('2025-12-16', '2026-02-28') / 7), 10);
  // Marauder: keel 22 Aug 2025, launch announced 29 May 2026.
  assert.equal(Marauder.MONTHS, Math.floor(days('2025-08-22', '2026-05-29') / 30.44));
  assert.equal(Marauder.PER_YEAR, 20);
  // Blackbeard: the dots are the missiles.
  assert.equal(Beard.COLS * Beard.ROWS, 12000);
  assert.equal(Beard.LOT_COLS * Beard.LOT_ROWS, 444);
  assert.ok(Number.isInteger(Beard.ROWS) && Number.isInteger(Beard.LOT_ROWS));
  assert.equal(Beard.PER_ROUND_K, 98);
  assert.equal(Beard.FRAMEWORK / Beard.YEARS, 2400);
  // The first order and the footage were eleven days apart.
  assert.equal(days('2026-09-14', '2026-09-25'), 11);
});
