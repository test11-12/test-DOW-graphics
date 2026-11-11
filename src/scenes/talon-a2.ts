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
/** Roc's drawn wingspan, and the length of the vehicle while it hangs under it. */
const ROC = 220;
const HUNG = 22;
/** Roc loiters over the release point for the whole film, its wingtip always clear of the plate's edge. */
const roc = (s: number): Pt => [174 + 5 * Math.sin(s * 0.35), 250 + 3 * Math.sin(s * 0.6)];
const line = (a: Pt, b: Pt): Bez => [a, [K.lerp(a[0], b[0], 1 / 3), K.lerp(a[1], b[1], 1 / 3)], [K.lerp(a[0], b[0], 2 / 3), K.lerp(a[1], b[1], 2 / 3)], b];

/** Where the vehicle hangs under Roc, relative to Roc's centre. */
const PYLON: Pt = [0, 11];
/** A flight that is released at `start`, climbs to `apex`, and comes down at `end`. `pace` stretches or shortens it.
    It falls away level under the wing, runs out past the wingtip and only then pulls up: `run` and `sink` say how far
    and how deep, `lead` how far before the apex it levels off, so the three climbs nest instead of lying on each other. */
function flight(start: number, apex: Pt, end: Pt, lands: boolean, pace = 1, run = 242, sink = 74, lead = 145): Leg[] {
  const [rx, ry] = roc(start);
  const drop: Pt = [rx + PYLON[0], ry + PYLON[1]];
  const burnt = start + 2.5 * pace;
  const up: Leg = { bez: [drop, [rx + run, ry + sink], [apex[0] - lead, apex[1] + 5], apex], from: start, to: burnt, ease: 'in' };
  if (!lands) return [up, { bez: [apex, [apex[0] + 110, apex[1] - 4], [end[0] - 46, end[1] - 170], end], from: burnt, to: burnt + 1.8 * pace, ease: 'linear' }];
  return [
    up,
    { bez: [apex, [apex[0] + 150, apex[1] - 6], [end[0] - 190, end[1] - 44], end], from: burnt, to: burnt + 3.1 * pace, ease: 'out' },
    { bez: line(end, [RUNWAY[1] - 22, SEA - 4]), from: burnt + 3.1 * pace, to: burnt + 3.9 * pace, ease: 'out' },
  ];
}
const FIRST = flight(1.3, [454, 150], [606, SEA], false, 1, 255, 86, 115);
const A = flight(ONE + 0.4, [480, 104], [RUNWAY[0] + 16, SEA - 4], true);
/** The second flight is drawn a little higher and quicker: it was the faster of the two. */
const B = flight(TWO + 1.1, [486, 82], [RUNWAY[0] + 16, SEA - 4], true, 0.84, 234, 60, 172);
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
/** The airframe is lifted off the runway and carried back to the pylon: low over the water, then up from beneath. */
const BACK: [number, number] = [TWO - 0.2, begin(B) - 0.15];
const HOME: Bez = ((): Bez => {
  const from = where(A, finish(A)).p;
  const to = roc(begin(B));
  return [from, [from[0] - 136, from[1] - 100], [to[0] + 56, to[1] + 170], [to[0] + PYLON[0], to[1] + PYLON[1]]];
})();

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
    const speed = rail.chart({ label: 'Speed reached', height: 106 });
    const chips = rail.chips({ label: 'What Talon-A2 did', items: ['Air-launched', 'Rocket-powered', 'Past Mach 5', 'Landed itself', 'Flew again'] });
    rail.note('The profile is schematic: Stratolaunch gave no exact speeds, and the reports give no altitudes or distances.');

    /** The path a flight has drawn by story time `s`. */
    const trace = (legs: Leg[], s: number, color: string, alpha: number, width: number, dash?: readonly number[], offset = 0): void => {
      if (s <= begin(legs) || alpha <= 0) return;
      const g = pen.g;
      pen.stroke(color, alpha, width, dash ?? null, offset);
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
    const vehicle = (legs: Leg[], s: number, color: string, flame: string, alpha = 1): void => {
      const { p, a: heading } = where(legs, K.clamp(s, begin(legs), finish(legs)));
      // It leaves the pylon level and at the size it hung there, and takes up its path as it draws away.
      const drop = legs[0].bez[0];
      const free = K.smooth(K.clamp(K.dist(p[0], p[1], drop[0], drop[1]) / 64));
      const size = K.lerp(HUNG, 27, free);
      const a = heading * free;
      const lit = K.pulse(s, begin(legs) + 0.45, legs[0].to, 0.15);
      if (lit > 0) {
        C.plume(pen, (age) => (s - age < begin(legs) + 0.45 ? null : where(legs, s - age).p), { life: 1.1, step: 0.03, r0: 0.9, r1: 3.6, color: col.mark, alpha: 0.7 * alpha, jitter: 7, seed: legs[0].from });
        pen.fill(flame, lit * alpha).dot(p[0] - Math.cos(a) * size * 0.56, p[1] - Math.sin(a) * size * 0.56, 3);
      }
      C.draw(pen, C.TALON, p[0], p[1], { size, angle: a, color, alpha, width: 1.3 });
    };

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        // The first flight steps back as the second is made ready.
        const second = K.tween(t, begin(B) - 1.3, begin(B) - 0.6);
        pen.plate(FX, FY, FW, FH, { title: 'Flight profile, the Pacific to Vandenberg · side view · no scale', right: 'Dec 2024 and Mar 2025' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- Ocean, shore and runway ---- */
        // The plate is there from the first frame; the swell stops short of the words under it.
        pen.stroke(col.wire, 1, 1).hline(FX, FX + FW, SEA);
        for (let k = 0; k < 5; k++) {
          pen.stroke(col.wire, 0.6 - k * 0.11, 1, [9 + k * 2, 15 + k * 3], live * (7 + k * 2.5) + k * 31).hline(FX, SHORE - 6, SEA + 9 + k * 9);
        }
        g.setLineDash([]);
        pen.hatch(SHORE, SEA + 1, FX + FW - SHORE, 9, col.wire, 0.6, 6);
        pen.stroke(col.wire, 1, 1).vline(SHORE, SEA - 5, SEA + 9);
        pen.stroke(col.bright, 1, 2.4).hline(RUNWAY[0], RUNWAY[1], SEA - 1);
        pen.stroke(col.bright, 0.7, 1).ticks(RUNWAY[0], SEA + 3, RUNWAY[1], SEA + 3, 8, 3, 4);
        pen.cap('Altitude ↑', FX + 14, FY + 22, col.faint);
        pen.cap('Pacific Ocean', FX + 14, FY + FH - 14, col.faint);
        pen.cap('Vandenberg Space Force Base', FX + FW - 14, FY + FH - 14, col.faint, 1, 'right');

        /* ---- The first Talon-A: one flight, into the sea ---- */
        const fade = 1 - 0.62 * K.tween(t, ONE - 0.3, ONE + 0.6);
        trace(FIRST, t, col.old, fade, 1.5, DASH.dash);
        if (t >= begin(FIRST) && t < finish(FIRST) + 0.05) vehicle(FIRST, t, col.old, col.old);
        if (t >= finish(FIRST)) {
          const end = where(FIRST, finish(FIRST)).p;
          const since = t - finish(FIRST);
          // Rings spread on the water and die away; the cross that stays is where it ended.
          for (let k = 0; k < 4; k++) {
            const u = K.seg(since, k * 0.24, 1.7 + k * 0.24);
            if (u > 0 && u < 1) {
              const e = K.ease.out(u);
              pen.stroke(col.old, (1 - u) * 0.9, 1.2);
              g.beginPath();
              g.ellipse(end[0], end[1], 6 + e * 44, 1.5 + e * 6, 0, 0, K.TAU);
              g.stroke();
            }
          }
          pen.cross(end[0], end[1], 1, col.old, fade * K.tween(since, 0.05, 0.5));
        }

        /* ---- Talon-A2: twice ---- */
        trace(A, t, col.bright, 1 - 0.58 * second, 1.6);
        trace(B, t, col.live, 1, 1.8);
        // Once the story has ended, breaks run along the second path the way it was flown, so the last frame is alive.
        if (t >= finish(B)) trace(B, t, col.stage, 0.85 * K.tween(f.idle, 0.3, 1.8), 2.6, [4, 150], -live * 70);
        // Carried back to the carrier between the flights: the route is laid first, then the airframe rides along it.
        const back = K.tween(t, BACK[0], BACK[1]);
        const route = K.tween(t, BACK[0], BACK[0] + 0.5, 'out') * (1 - K.tween(t, begin(B), begin(B) + 0.5));
        if (route > 0) {
          pen.stroke(col.mark, 0.6 * route, 1, DASH.fine).curve(HOME, K.tween(t, BACK[0], BACK[0] + 0.5, 'out'));
          g.setLineDash([]);
        }
        if (t >= BACK[0] && back < 1) {
          const p = K.bezier(HOME, back);
          C.draw(pen, C.TALON, p[0], p[1], { size: K.lerp(27, HUNG, K.tween(back, 0, 0.5)), color: K.blend(col.bright, col.live, K.tween(back, 0.6, 1)), width: 1.2 });
        }
        if (t >= begin(A) && t < BACK[0]) vehicle(A, t, col.bright, col.live);
        if (t >= begin(B)) vehicle(B, t, col.live, col.live);
        for (const [legs, at, color] of [[A, MACH5_A, K.blend(col.bright, col.mark, second)], [B, MACH5_B, col.live]] as const) {
          if (t < at) continue;
          const { p, a } = where(legs, at);
          const nx = Math.cos(a + Math.PI / 2);
          const ny = Math.sin(a + Math.PI / 2);
          // The threshold is struck across the path, and a ring opens from it once.
          const half = 7 * K.tween(t, at, at + 0.3, 'out');
          pen.stroke(color, 1, 1.5).line(p[0] - nx * half, p[1] - ny * half, p[0] + nx * half, p[1] + ny * half);
          const ring = K.seg(t, at, at + 0.9);
          if (ring < 1) pen.stroke(color, 0.8 * (1 - ring), 1).ring(p[0], p[1], 4 + 13 * K.ease.out(ring));
        }

        /* ---- Roc ---- */
        const [rx, ry] = roc(live);
        // Under the wing until release: before each flight the vehicle rides on the centre pylon.
        const carried = t < begin(FIRST) ? col.old : t >= ONE - 0.4 && t < begin(A) ? col.bright : t >= BACK[1] && t < begin(B) ? col.live : null;
        C.draw(pen, C.ROC_FRONT, rx, ry, { size: ROC, color: col.bright, width: 1.2 });
        C.rounds(pen, C.ROC_ENGINES, rx, ry, { size: ROC, color: col.bright, width: 1 });
        // The centre pylon, between the two fuselages: what the vehicle hangs from, and what is left when it has gone.
        pen.stroke(col.bright, 1, 1).poly([[rx - 4, ry + 2.5], [rx - 2.5, ry + PYLON[1] - 2.5], [rx + 2.5, ry + PYLON[1] - 2.5], [rx + 4, ry + 2.5]]);
        if (carried) C.draw(pen, C.TALON, rx + PYLON[0], ry + PYLON[1], { size: HUNG, color: carried, alpha: t < ONE ? 1 : K.tween(t, ONE - 0.4, ONE + 0.1), width: 1.2 });
        g.restore();

        /* ---- Labels ---- */
        pen.label(rx - 0.123 * ROC, ry - 0.085 * ROC - 3, rx - 16, ry - 76, ['Roc', `wingspan ${SPAN_FT} ft, seen head-on`], { color: col.ink, u: K.pulse(t, 0.5, ONE + 1.9, 0.5) });
        const lost = where(FIRST, finish(FIRST)).p;
        pen.label(lost[0], lost[1] - 5, lost[0] - 46, lost[1] - 70, ['First Talon-A', 'single use: a water landing'], { color: col.old, u: K.pulse(t, finish(FIRST) - 0.1, ONE + 2.2, 0.5), align: 'right' });
        const m5 = where(A, MACH5_A).p;
        pen.label(m5[0] - 5, m5[1] - 4, m5[0] - 34, m5[1] - 62, ['Mach 5 passed', 'exact speed not released'], { color: col.ink, u: K.pulse(t, MACH5_A, TWO + 0.4, 0.4), align: 'right' });
        const m5b = where(B, MACH5_B).p;
        pen.label(m5b[0] - 5, m5b[1] - 4, m5b[0] - 34, m5b[1] - 62, ['Mach 5 again', 'faster than the first flight'], { color: col.live, u: K.tween(t, MACH5_B, MACH5_B + 0.7), align: 'right' });
        pen.label(RUNWAY[1] - 16, SEA - 12, RUNWAY[1] - 46, SEA - 108, ['Runway landing', 'flown by the vehicle itself'], { color: col.ink, u: K.pulse(t, finish(A) - 0.9, TWO + 0.2, 0.4), align: 'right' });
        pen.label(RUNWAY[1] - 16, SEA - 12, RUNWAY[1] - 46, SEA - 108, ['Landed again', 'same airframe, second flight'], { color: col.live, u: K.tween(t, finish(B) - 0.9, finish(B) - 0.2), align: 'right' });
        const mid = K.bezier(HOME, 0.45);
        pen.label(mid[0], mid[1], mid[0] - 18, mid[1] - 42, ['Carried back', 'thermal protection refurbished'], { color: col.mark, u: K.pulse(t, TWO + 0.2, begin(B) + 0.5, 0.3), align: 'right' });

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
          cg.fillRect(0, y, w, 8);
          if (burn <= 0) return;
          cg.fillStyle = color;
          cg.fillRect(0, y, Math.min(x5, (x5 + over) * burn), 8);
          const past = (x5 + over) * burn - x5;
          // Beyond the threshold the bar is hatched, and fades: the true end is not known.
          for (let x = 0; x < past; x += 3) {
            cg.globalAlpha = 1 - (x / (over + 14)) * 0.75;
            cg.fillRect(x5 + x, y, 1.4, 8);
          }
          cg.globalAlpha = 1;
        };
        bar(18, 'FLIGHT 1 · DEC 2024', K.tween(t, begin(A) + 0.45, A[0].to, 'in'), 30, K.blend(col.bright, col.mark, K.tween(t, begin(B), begin(B) + 0.6)));
        bar(54, 'FLIGHT 2 · MAR 2025', K.tween(t, begin(B) + 0.45, B[0].to, 'in'), 58, col.live);
        cg.fillStyle = col.wire;
        for (let m = 1; m <= 5; m++) cg.fillRect(Math.round((x5 * m) / 5), 72, 1, m === 5 ? 9 : 5);
        cg.fillStyle = col.ink;
        cg.fillRect(Math.round(x5), 9, 1, 63);
        cg.font = FONT.tick;
        cg.fillStyle = col.faint;
        cg.textAlign = 'center';
        for (let m = 1; m <= 4; m++) cg.fillText(String(m), (x5 * m) / 5, 94);
        cg.fillStyle = col.ink;
        cg.fillText('Mach 5', x5, 94);
      },
    };
  },
};
export default def;
