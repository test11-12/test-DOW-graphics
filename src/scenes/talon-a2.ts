/* Win 04 — Stratolaunch Talon-A2
   A rocket plane is dropped from Roc, passes Mach 5, lands itself on a runway at
   Vandenberg, and then the same airframe does it again.

   A flight profile: height against distance, with the Pacific under most of it. The
   first Talon-A is drawn first, in the color of the old way, because it ended where
   hypersonic test vehicles usually end. Stratolaunch has released no altitudes, ranges
   or top speeds, so the profile has no numbers on it: only the order of events and the
   one threshold both flights are known to have crossed. */
import * as K from '../core/kit.ts';
import type { Bez, Ease, Pt } from '../core/kit.ts';
import { DASH, FONT, Pen } from '../draw/pen.ts';
import * as C from '../draw/craft.ts';
import type { SceneDef } from '../core/types.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const DUR = 21;
const ONE = 6.5;
const TWO = 14;
const SEA = 404;
const SHORE = 700;
const RUNWAY: [number, number] = [742, 858];
/** Roc's wingspan, and the year the X-15 program ended. */
export const SPAN_FT = 385;
export const X15_END = 1968;
export const YEARS = 2024 - X15_END;

interface Leg {
  bez: Bez;
  from: number;
  to: number;
  ease: Ease;
}
/** Roc loiters over the release point for the whole film. */
const roc = (s: number): Pt => [150 + 10 * Math.sin(s * 0.35), 250 + 3 * Math.sin(s * 0.6)];
const line = (a: Pt, b: Pt): Bez => [a, [K.lerp(a[0], b[0], 1 / 3), K.lerp(a[1], b[1], 1 / 3)], [K.lerp(a[0], b[0], 2 / 3), K.lerp(a[1], b[1], 2 / 3)], b];

/** Where the vehicle hangs under Roc, relative to Roc's centre. */
const PYLON: Pt = [0, 17];
/** A flight that is released at `start`, climbs to `apex`, and comes down at `end`. `pace` stretches or shortens it. */
function flight(start: number, apex: Pt, end: Pt, lands: boolean, pace = 1): Leg[] {
  const [rx, ry] = roc(start);
  const drop: Pt = [rx + PYLON[0], ry + PYLON[1]];
  const burnt = start + 2.5 * pace;
  const up: Leg = { bez: [drop, [rx + 96, ry + 96], [apex[0] - 150, apex[1] + 6], apex], from: start, to: burnt, ease: 'in' };
  if (!lands) return [up, { bez: [apex, [apex[0] + 110, apex[1] - 4], [end[0] - 46, end[1] - 170], end], from: burnt, to: burnt + 1.8 * pace, ease: 'linear' }];
  return [
    up,
    { bez: [apex, [apex[0] + 150, apex[1] - 6], [end[0] - 190, end[1] - 44], end], from: burnt, to: burnt + 3.1 * pace, ease: 'out' },
    { bez: line(end, [RUNWAY[1] - 22, SEA - 4]), from: burnt + 3.1 * pace, to: burnt + 3.9 * pace, ease: 'out' },
  ];
}
const FIRST = flight(1.3, [404, 150], [600, SEA], false);
const A = flight(ONE + 0.4, [430, 104], [RUNWAY[0] + 16, SEA - 4], true);
/** The second flight is drawn a little higher and quicker: it was the faster of the two. */
const B = flight(TWO + 1.1, [436, 82], [RUNWAY[0] + 16, SEA - 4], true, 0.84);
const begin = (legs: Leg[]): number => legs[0].from;
const finish = (legs: Leg[]): number => legs[legs.length - 1].to;
/** Where a flight is at story time `s`, and which way it points. */
function where(legs: Leg[], s: number): { p: Pt; a: number } {
  let leg = legs[0];
  for (const l of legs) if (s >= l.from) leg = l;
  const u = K.tween(s, leg.from, leg.to, leg.ease);
  const p = K.bezier(leg.bez, u);
  const q = K.bezier(leg.bez, Math.min(1, u + 0.012));
  const r = K.bezier(leg.bez, Math.max(0, u - 0.012));
  return { p, a: Math.atan2(q[1] - r[1], q[0] - r[0]) };
}
/** When each flight passes Mach 5: late in the burn, and a little earlier on the faster second flight. */
const MACH5_A = begin(A) + 2.05;
const MACH5_B = begin(B) + 1.6;

const def: SceneDef = {
  id: 'talon-a2',
  duration: DUR,
  takeaway: 'A hypersonic test bed that lands and flies again turns a rare event into a schedule.',
  alt: 'A side-on flight profile over the Pacific. A first test vehicle is released, climbs, and comes down in the ocean. Then the Roc carrier aircraft releases Talon-A2, which climbs under rocket power, passes a mark labeled Mach 5, glides down and lands on a runway at Vandenberg. The same vehicle is carried back and flies the profile a second time, faster; the second path is drawn slightly higher.',
  acts: [
    { at: 0, label: 'Single use' },
    { at: ONE, label: 'Flight one' },
    { at: TWO, label: 'Flight two' },
  ],
  captions: [
    { at: 0, text: 'Stratolaunch’s first Talon-A was built to fly once. Its powered flight ended in the ocean.' },
    { at: 3.5, text: 'One flight, one airframe.' },
    { at: ONE, text: 'December 2024. Roc, the widest aircraft ever flown, releases Talon-A2 over the Pacific.' },
    { at: 9.4, text: 'The rocket lights. It passes Mach 5, flies itself to Vandenberg and lands on the runway.' },
    { at: TWO, text: 'March 2025. The same airframe goes again, faster.' },
    { at: 18, text: 'The Pentagon’s test office calls it the first reusable hypersonic flight testing since the X-15 stopped in 1968.' },
  ],

  setup(ctx) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);

    const rail = ctx.rail();
    const phase = rail.phase('Vehicle', ['Single use', 'Flight one', 'Flight two']);
    const pair = rail.pair();
    const flights = pair.stat({ label: 'Flights, one airframe', slots: 1 });
    const years = pair.stat({ label: 'Years since the X-15', slots: 2 });
    const speed = rail.chart({ label: 'Speed reached', height: 88 });
    const chips = rail.chips({ label: 'What Talon-A2 did', items: ['Air-launched', 'Rocket-powered', 'Past Mach 5', 'Landed itself', 'Flew again'] });
    rail.note('The profile is schematic: Stratolaunch gave no exact speeds, and the reports give no altitudes or distances.');

    /** The path a flight has drawn by story time `s`. */
    const trace = (legs: Leg[], s: number, color: string, alpha: number, width: number, dash?: readonly number[]): void => {
      if (s <= begin(legs) || alpha <= 0) return;
      const g = pen.g;
      pen.stroke(color, alpha, width, dash ?? null);
      g.beginPath();
      const to = Math.min(s, finish(legs));
      for (let x = begin(legs); x <= to + 1e-6; x += 0.04) {
        const { p } = where(legs, x);
        if (x === begin(legs)) g.moveTo(p[0], p[1]);
        else g.lineTo(p[0], p[1]);
      }
      const { p } = where(legs, to);
      g.lineTo(p[0], p[1]);
      g.stroke();
      g.setLineDash([]);
    };
    /** The vehicle on a flight, with its exhaust while the rocket burns. */
    const vehicle = (legs: Leg[], s: number, color: string, alpha = 1): void => {
      const { p, a } = where(legs, K.clamp(s, begin(legs), finish(legs)));
      const lit = K.pulse(s, begin(legs) + 0.45, legs[0].to, 0.15);
      if (lit > 0) {
        C.plume(pen, (age) => (s - age < begin(legs) + 0.45 ? null : where(legs, s - age).p), { life: 1.1, step: 0.03, r0: 0.9, r1: 3.6, color: col.mark, alpha: 0.7 * alpha, jitter: 7, seed: legs[0].from });
        pen.fill(col.live, lit * alpha).dot(p[0] - Math.cos(a) * 15, p[1] - Math.sin(a) * 15, 3);
      }
      C.draw(pen, C.TALON, p[0], p[1], { size: 27, angle: a, color, alpha, width: 1.3 });
    };

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        const on = K.tween(t, 0, 0.8);
        const second = t >= begin(B) - 1.3;
        pen.plate(FX, FY, FW, FH, { title: 'Flight profile, the Pacific to Vandenberg · side view · no scale', right: 'Dec 2024 and Mar 2025' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- Ocean, shore and runway ---- */
        pen.stroke(col.wire, on, 1).hline(FX, FX + FW, SEA);
        for (let k = 0; k < 6; k++) {
          pen.stroke(col.wire, on * (0.6 - k * 0.09), 1, [9 + k * 2, 15 + k * 3], live * (7 + k * 2.5) + k * 31).hline(FX, SHORE - 6, SEA + 9 + k * 10);
        }
        g.setLineDash([]);
        pen.hatch(SHORE, SEA + 1, FX + FW - SHORE, 9, col.wire, 0.6 * on, 6);
        pen.stroke(col.wire, on, 1).vline(SHORE, SEA - 5, SEA + 9);
        pen.stroke(col.bright, on, 2.4).hline(RUNWAY[0], RUNWAY[1], SEA - 1);
        pen.stroke(col.bright, 0.7 * on, 1).ticks(RUNWAY[0], SEA + 3, RUNWAY[1], SEA + 3, 8, 3, 4);
        pen.cap('Altitude ↑', FX + 14, FY + 22, col.faint, on);
        pen.cap('Pacific Ocean', FX + 14, FY + FH - 12, col.faint, on);
        pen.cap('Vandenberg Space Force Base', FX + FW - 12, FY + FH - 12, col.faint, on, 'right');

        /* ---- The first Talon-A: one flight, into the sea ---- */
        const fade = 1 - 0.62 * K.tween(t, ONE - 0.3, ONE + 0.6);
        trace(FIRST, t, col.old, fade, 1.3, DASH.dash);
        if (t >= begin(FIRST) && t < finish(FIRST) + 0.05) vehicle(FIRST, t, col.old);
        if (t >= finish(FIRST)) {
          const end = where(FIRST, finish(FIRST)).p;
          const since = t - finish(FIRST);
          for (let k = 0; k < 3; k++) {
            const u = K.seg(since, k * 0.22, 1.5 + k * 0.22);
            if (u > 0 && u < 1) {
              pen.stroke(col.old, (1 - u) * 0.9, 1.2);
              g.beginPath();
              g.ellipse(end[0], end[1], 6 + u * 34, 1.5 + u * 5, 0, 0, K.TAU);
              g.stroke();
            }
          }
          pen.cross(end[0], end[1], 0.8, col.old, fade);
        }

        /* ---- Talon-A2: twice ---- */
        trace(A, t, col.bright, second ? 0.42 : 1, 1.6);
        trace(B, t, col.live, 1, 1.8);
        // Carried back to the carrier between the flights.
        const back = K.seg(t, TWO + 0.15, begin(B) - 0.15);
        if (back > 0 && back < 1) {
          const from = where(A, finish(A)).p;
          const to = roc(begin(B));
          const home: Bez = [from, [from[0] - 120, from[1] - 190], [to[0] + 170, to[1] + 150], [to[0] + PYLON[0], to[1] + PYLON[1]]];
          pen.stroke(col.mark, 0.7, 1, DASH.fine).curve(home, K.ease.inOut(back));
          g.setLineDash([]);
          const p = K.bezier(home, K.ease.inOut(back));
          C.draw(pen, C.TALON, p[0], p[1], { size: 22, color: col.mark, alpha: 0.9, width: 1.1 });
        }
        if (t >= begin(A) && t < TWO + 0.2) vehicle(A, t, col.bright);
        if (t >= begin(B)) vehicle(B, t, col.live);
        for (const [legs, at, color] of [[A, MACH5_A, second ? col.mark : col.bright], [B, MACH5_B, col.live]] as const) {
          if (t < at) continue;
          const { p, a } = where(legs, at);
          const nx = Math.cos(a + Math.PI / 2);
          const ny = Math.sin(a + Math.PI / 2);
          pen.stroke(color, 1, 1.5).line(p[0] - nx * 7, p[1] - ny * 7, p[0] + nx * 7, p[1] + ny * 7);
        }

        /* ---- Roc ---- */
        const [rx, ry] = roc(live);
        // Under the wing until release: before each flight the vehicle rides on the centre pylon.
        const carried = t < begin(FIRST) ? col.old : t >= ONE - 0.4 && t < begin(A) ? col.bright : t >= begin(B) - 0.15 && t < begin(B) ? col.live : null;
        C.draw(pen, C.ROC_FRONT, rx, ry, { size: 190, color: col.bright, alpha: on, width: 1.2 });
        C.rounds(pen, C.ROC_ENGINES, rx, ry, { size: 190, color: col.bright, alpha: on, width: 1 });
        if (carried) C.draw(pen, C.TALON, rx + PYLON[0], ry + PYLON[1], { size: 22, color: carried, alpha: on, width: 1.1 });
        g.restore();

        /* ---- Labels ---- */
        pen.label(rx + 60, ry - 3, rx + 92, ry - 62, ['Roc', `wingspan ${SPAN_FT} ft, seen head-on`], { color: col.ink, u: K.pulse(t, 0.5, ONE + 1.9, 0.5) });
        const lost = where(FIRST, finish(FIRST)).p;
        pen.label(lost[0], lost[1] - 5, lost[0] - 46, lost[1] - 70, ['First Talon-A', 'single use: a water landing'], { color: col.old, u: K.pulse(t, finish(FIRST) - 0.1, ONE + 2.2, 0.5), align: 'right' });
        const m5 = where(A, MACH5_A).p;
        pen.label(m5[0] + 5, m5[1] + 4, m5[0] + 50, m5[1] + 44, ['Mach 5 passed', 'exact speed not released'], { color: col.ink, u: K.pulse(t, MACH5_A, TWO + 0.4, 0.4) });
        const m5b = where(B, MACH5_B).p;
        pen.label(m5b[0] + 5, m5b[1] + 4, m5b[0] + 62, m5b[1] + 62, ['Mach 5 again', 'faster than the first flight'], { color: col.live, u: K.tween(t, MACH5_B, MACH5_B + 0.7) });
        pen.label(RUNWAY[0] + 40, SEA - 9, RUNWAY[0] + 4, SEA - 86, ['Runway landing', 'flown by the vehicle itself'], { color: col.ink, u: K.pulse(t, finish(A) - 0.9, TWO + 0.2, 0.4), align: 'right' });
        pen.label(RUNWAY[0] + 40, SEA - 9, RUNWAY[0] + 4, SEA - 86, ['Landed again', 'same airframe, second flight'], { color: col.live, u: K.tween(t, finish(B) - 0.9, finish(B) - 0.2), align: 'right' });
        pen.label(574, 252, 606, 204, ['Carried back', 'thermal protection refurbished'], { color: col.mark, u: K.pulse(t, TWO + 0.2, begin(B) + 0.5, 0.3) });

        /* ---- Instruments ---- */
        phase.set(K.tween(t, ONE, ONE + 0.7) + K.tween(t, TWO, TWO + 0.7));
        flights.set((t >= finish(A) - 0.9 ? 1 : 0) + K.tween(t, finish(B) - 0.9, finish(B) - 0.3));
        years.set(YEARS * K.tween(t, 18, 19.4, 'out'));
        years.alpha(0.35 + 0.65 * K.tween(t, 18, 18.5));
        const did = [begin(A), begin(A) + 0.45, MACH5_A, finish(A) - 0.9, finish(B) - 0.9];
        did.forEach((at, i) => chips.set(i, t >= at ? (t < at + 1.2 ? 5 : 2) : 0));

        /* How fast: both flights cross Mach 5. How far past it is not public, so the bars end open. */
        speed.clear();
        const cg = speed.g;
        const w = speed.w;
        const x5 = w * 0.74;
        const bar = (y: number, name: string, burn: number, over: number, color: string): void => {
          cg.font = FONT.label;
          cg.textAlign = 'left';
          cg.textBaseline = 'alphabetic';
          cg.fillStyle = burn > 0 ? color : col.faint;
          cg.fillText(name, 0, y - 5);
          cg.fillStyle = col.line2;
          cg.fillRect(0, y, w, 7);
          if (burn <= 0) return;
          cg.fillStyle = color;
          cg.fillRect(0, y, Math.min(x5, (x5 + over) * burn), 7);
          const past = (x5 + over) * burn - x5;
          // Beyond the threshold the bar is hatched, and fades: the true end is not known.
          for (let x = 0; x < past; x += 3) {
            cg.globalAlpha = 1 - (x / (over + 14)) * 0.75;
            cg.fillRect(x5 + x, y, 1.4, 7);
          }
          cg.globalAlpha = 1;
        };
        bar(16, 'FLIGHT 1 · DEC 2024', K.tween(t, begin(A) + 0.45, A[0].to, 'in'), 30, t >= begin(B) ? col.mark : col.bright);
        bar(46, 'FLIGHT 2 · MAR 2025', K.tween(t, begin(B) + 0.45, B[0].to, 'in'), 58, col.live);
        cg.fillStyle = col.wire;
        for (let m = 1; m <= 5; m++) cg.fillRect(Math.round((x5 * m) / 5), 58, 1, m === 5 ? 9 : 5);
        cg.fillStyle = col.ink;
        cg.fillRect(Math.round(x5), 9, 1, 49);
        cg.font = FONT.tick;
        cg.fillStyle = col.faint;
        cg.textAlign = 'center';
        for (let m = 1; m <= 4; m++) cg.fillText(String(m), (x5 * m) / 5, 78);
        cg.fillStyle = col.ink;
        cg.fillText('Mach 5', x5, 78);
      },
    };
  },
};
export default def;
