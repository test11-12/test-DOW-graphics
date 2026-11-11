/* Win 01 — Fury (YFQ-44A)
   A pilotless jet fires a live AMRAAM at a digital target, and a human gives the order.

   The picture is fixed to the aircraft: the jet holds its place and the desert runs
   past underneath. That keeps the one thing that matters in the middle of the plate,
   and lets the story stop at the human's decision while the flight carries on. */
import * as K from '../core/kit.ts';
import type { Bez, Pt } from '../core/kit.ts';
import { DASH, Halftone, Pen } from '../draw/pen.ts';
import * as C from '../draw/craft.ts';
import type { SceneDef } from '../core/types.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const DUR = 21;
const CONSENT = 7;
const GATE = 10;
const AWAY = 13.5;
const FIRE = 14.1;
const HIT = 18.3;
/** Days from a clean-sheet design to first flight: Anduril’s own count. */
export const DAYS = 556;

const AX = 236;
const AY = 286;
const SIZE = 172;
/** The AMRAAM is about three fifths the length of the jet that carries it. */
const ROUND = SIZE * 0.58;
const RAIL: Pt = [AX + SIZE * 0.05, AY - SIZE * 0.215];
const NOSE: Pt = [AX + SIZE * 0.5, AY];
const TARGET: Pt = [748, 172];
const OPERATOR: Pt = [112, 436];
const SCROLL = 44;
const PITCH = 12;

const def: SceneDef = {
  id: 'fury',
  duration: DUR,
  takeaway: 'First flight in October. A live missile by July. The Air Force wants about a thousand uncrewed fighters, and this is one of the first two designs.',
  alt: 'A view from above of an uncrewed YFQ-44A jet, held in the middle of the frame while desert passes beneath it, with one missile under its wing. A dashed link runs to a human operator. The jet requests release, the operator authorizes it, and the missile leaves the wing and flies to a digital target marked by brackets. A grid of 556 dots counts the days from the start of development to first flight.',
  acts: [
    { at: 0, label: 'Sortie' },
    { at: CONSENT, label: 'Consent' },
    { at: AWAY, label: 'Weapon away' },
  ],
  captions: [
    { at: 0, text: 'A YFQ-44A over the Mojave with a live AMRAAM under its wing. Nobody is on board.' },
    { at: 3.6, text: 'Anduril says it went from a clean sheet to first flight in 556 days.' },
    { at: CONSENT, text: 'The jet can run the firing sequence itself, inside limits a pilot sets. It cannot say yes.' },
    { at: GATE + 0.05, text: 'A human operator says yes.' },
    { at: AWAY, text: 'Missile away. The target is digital. The missile is not.' },
  ],
  gates: [{ id: 'consent', at: GATE, label: 'Authorize release', auto: 6 }],

  setup(ctx) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);
    const ground = new Halftone(FX, FY, FW / PITCH, Math.floor(FH / PITCH), PITCH, { stagger: true });

    const rail = ctx.rail();
    const phase = rail.phase('Sequence', ['Sortie', 'Awaiting consent', 'Weapon away']);
    const pair = rail.pair();
    const crew = pair.stat({ label: 'Crew on board', slots: 1 });
    const days = pair.stat({ label: 'Days to first flight', slots: 3, bar: true });
    const calendar = rail.chart({ label: 'One dot a day, clean sheet to first flight', height: 60 });
    const log = rail.log({ label: 'Then', items: ['First flight', 'Missile carried, inert', 'Production contract', 'Live fire announced'] });
    rail.note('A real test, drawn as a diagram. The range of the shot, the altitude and where the operator sat were not released.');
    const STAMPS = ['31 Oct 2025', 'Feb 2026', 'Jun 2026', '15 Jul 2026'];
    const LOG_AT = [6.6, 7.6, 8.6, FIRE];

    const bearing = Math.atan2(TARGET[1] - NOSE[1], TARGET[0] - NOSE[0]);
    const reach = K.dist(NOSE[0], NOSE[1], TARGET[0], TARGET[1]);
    const flight: Bez = [RAIL, [RAIL[0] + 190, RAIL[1] - 6], [TARGET[0] - 150, TARGET[1] + 46], TARGET];
    const along = K.keys([[FIRE, 0], [FIRE + 0.5, 0.05, 'in'], [HIT, 1, 'out']]);
    /** Where the missile is at story time `s`, and which way it points. */
    const round = (s: number): { p: Pt; a: number } => {
      const u = along(s);
      const p = K.bezier(flight, u);
      const q = K.bezier(flight, Math.min(1, u + 0.01));
      return { p, a: u >= 0.99 ? bearing : Math.atan2(q[1] - p[1], q[0] - p[0]) };
    };

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        const waiting = !!f.gate;
        const arrive = K.tween(t, 0, 1.7, 'out');
        const ax = K.lerp(FX - SIZE, AX, arrive);
        const ay = AY + 1.6 * Math.sin(live * 0.8);
        const shift = ax - AX;
        const envelope = K.tween(t, CONSENT + 0.2, CONSENT + 1.5);
        const asked = K.tween(t, CONSENT + 1.7, CONSENT + 2.9);
        const granted = K.tween(t, GATE + 0.05, GATE + 1.3);
        const fired = t >= FIRE;
        const there = K.tween(t, HIT - 0.15, HIT + 0.5, 'out');

        pen.plate(FX, FY, FW, FH, { title: 'Over the Mojave · the picture moves with the aircraft · not to scale', right: 'Announced 15 Jul 2026' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- The desert, passing underneath ---- */
        const drift = live * SCROLL;
        for (let i = 0; i < ground.n; i++) {
          const x = ground.xs[i] + drift;
          const y = ground.ys[i];
          const relief = K.noise2(x / 130, y / 90, 3) * 0.7 + K.noise2(x / 41, y / 37, 5) * 0.3;
          ground.tone[i] = K.clamp(relief * 0.9 + 0.22);
          ground.shade[i] = 0;
        }
        ground.draw(pen, [K.rgba(col.wire, 0.8)], { min: 0.03, max: 0.25, gamma: 1.1 });

        /* ---- Range arcs ahead of the nose: distance without a number ---- */
        for (let k = 1; k <= 4; k++) {
          pen.stroke(col.wire, 0.7 * arrive, 1, DASH.dot);
          g.beginPath();
          g.arc(NOSE[0] + shift, NOSE[1], k * (reach / 3.4), bearing - 0.62, bearing + 0.62);
          g.stroke();
        }
        g.setLineDash([]);

        /* ---- The limits a pilot sets: the jet may act inside them ---- */
        if (envelope > 0) {
          const half = 0.2;
          const far = reach * 1.2 * envelope;
          pen.stroke(col.mark, 0.62, 1, DASH.dash, -live * 5);
          g.beginPath();
          g.moveTo(NOSE[0], NOSE[1]);
          g.lineTo(NOSE[0] + far * Math.cos(bearing - half), NOSE[1] + far * Math.sin(bearing - half));
          g.arc(NOSE[0], NOSE[1], far, bearing - half, bearing + half);
          g.closePath();
          g.stroke();
          g.setLineDash([]);
          pen.fill(col.mark, 0.045 * envelope);
          g.fill();
        }

        /* ---- The link to the person ---- */
        const tail: Pt = [ax - SIZE * 0.42, ay + SIZE * 0.06];
        const link: Bez = K.link(OPERATOR[0] + 14, OPERATOR[1] - 16, tail[0], tail[1]);
        pen.stroke(granted > 0 ? K.blend(col.mark, col.live, granted) : col.mark, 0.6 * arrive, 1, DASH.fine).curve(link, arrive);
        g.setLineDash([]);
        if (asked > 0 && granted < 1) {
          // The request goes down the link; while the answer is awaited it keeps asking.
          const beat = waiting ? (live * 0.9) % 1 : asked;
          const q = K.bezier(link, 1 - beat);
          pen.fill(col.ink, waiting ? Math.sin(beat * Math.PI) : 1 - K.tween(t, GATE, GATE + 0.2)).dot(q[0], q[1], 2.6);
        }
        if (granted > 0 && granted < 1) {
          const q = K.bezier(link, granted);
          pen.fill(col.live).dot(q[0], q[1], 3.2);
          pen.stroke(col.live, 0.5, 1).ring(q[0], q[1], 7);
        }

        /* ---- The target: a position in software ---- */
        const seen = K.tween(t, CONSENT + 0.9, CONSENT + 1.6, 'out');
        if (seen > 0) {
          pen.brackets(TARGET[0], TARGET[1], 13 + 9 * (1 - seen), col.ink, seen, 5);
          pen.stroke(col.ink, 0.8 * seen, 1, DASH.fine).ring(TARGET[0], TARGET[1], 5);
          g.setLineDash([]);
          if (there > 0) {
            for (let q = 0; q < 2; q++) {
              const u = (((f.ended ? live : t) - HIT) * 0.5 + q * 0.5 + 8) % 1;
              pen.stroke(col.live, (1 - u) * 0.7 * there, 1).ring(TARGET[0], TARGET[1], 6 + u * 34);
            }
          }
        }

        /* ---- The missile once it has left the wing ---- */
        if (fired) {
          const { p, a } = round(t);
          C.plume(pen, (age) => {
            const s = t - age;
            if (s < FIRE + 0.25 || s > HIT) return null;
            const q = round(s).p;
            return [q[0] - SCROLL * 0.5 * age, q[1]];
          }, { life: 2.3, step: 0.035, r0: 1, r1: 4.2, color: col.mark, alpha: 0.75, jitter: 9, seed: 4 });
          if (t < HIT + 0.2) {
            const burn = K.pulse(t, FIRE + 0.3, FIRE + 2.4, 0.2);
            if (burn > 0) pen.fill(col.live, burn).dot(p[0] - Math.cos(a) * ROUND * 0.56, p[1] - Math.sin(a) * ROUND * 0.56, 3.4);
            C.draw(pen, C.MISSILE, p[0], p[1], { size: ROUND * K.lerp(1, 0.5, along(t)), angle: a, color: col.live, alpha: 1 - K.tween(t, HIT - 0.1, HIT + 0.2) });
          }
        }

        /* ---- The aircraft ---- */
        if (!fired) C.draw(pen, C.MISSILE, RAIL[0] + shift, RAIL[1] + (ay - AY), { size: ROUND, color: col.live, fill: col.stage });
        C.draw(pen, C.FURY, ax, ay, { size: SIZE, color: col.bright, width: 1.4 });
        g.restore();

        /* ---- The person, outside the picture ---- */
        pen.fill(col.stage, 0.92).dot(OPERATOR[0], OPERATOR[1] - 4, 17);
        pen.person(OPERATOR[0], OPERATOR[1] - 4, 0.72, granted > 0 ? K.blend(col.text, col.live, K.pulse(t, GATE, GATE + 2.4, 0.5)) : col.text, arrive);
        const state = granted > 0 ? 'Release authorized' : waiting || asked >= 1 ? 'Release requested' : 'Human operator';
        pen.cap(state, OPERATOR[0] + 24, OPERATOR[1] - 6, granted > 0 ? col.live : col.ink, arrive * (waiting ? 0.6 + 0.4 * Math.sin(live * 4) ** 2 : 1));
        pen.text('position not released', OPERATOR[0] + 24, OPERATOR[1] + 8, { size: 10.5, color: col.muted, alpha: arrive });

        /* ---- Labels ---- */
        pen.label(ax + SIZE * 0.36, ay - 4, ax + SIZE * 0.5, ay + 78, ['YFQ-44A Fury', 'no cockpit, no crew'], { color: col.ink, u: K.pulse(t, 1.4, CONSENT - 0.2, 0.6) });
        pen.label(RAIL[0] + ROUND * 0.3, RAIL[1] - 5, RAIL[0] + ROUND * 0.3 + 46, RAIL[1] - 62, ['AIM-120 AMRAAM', 'a live round, on the wing'], { color: col.live, u: K.pulse(t, 2.2, CONSENT - 0.2, 0.6) });
        pen.label(NOSE[0] + reach * 0.8 * Math.cos(bearing + 0.2), NOSE[1] + reach * 0.8 * Math.sin(bearing + 0.2), 596, 352, ['Limits set by a pilot', 'inside them the jet runs the sequence'], { color: col.mark, u: K.pulse(t, CONSENT + 1.4, AWAY + 0.4, 0.5) });
        pen.label(TARGET[0] + 12, TARGET[1] - 10, TARGET[0] + 34, TARGET[1] - 58, there > 0 ? ['Digital target', 'result not released'] : ['Digital target', 'simulated: nothing is there'], { color: col.ink, u: K.tween(t, CONSENT + 1.5, CONSENT + 2.3), align: 'right' });
        pen.cap('Range not released', NOSE[0] + (reach / 3.4) * 4 * Math.cos(bearing + 0.58) - 6, NOSE[1] + (reach / 3.4) * 4 * Math.sin(bearing + 0.58) + 16, col.faint, arrive, 'right');

        /* ---- Instruments ---- */
        phase.set(K.tween(t, CONSENT, CONSENT + 0.7) + K.tween(t, AWAY, AWAY + 0.7));
        crew.set(0);
        const counted = K.tween(t, 3.6, 6.4, 'inOutSine');
        days.set(DAYS * counted);
        days.bar(counted);
        LOG_AT.forEach((at, i) => log.set(i, t >= at, STAMPS[i]));

        calendar.clear();
        const cg = calendar.g;
        const cols = 56;
        const step = calendar.w / cols;
        const lit = Math.floor(DAYS * counted + 1e-6);
        for (let i = 0; i < DAYS; i++) {
          const x = (i % cols) * step + step / 2;
          const y = Math.floor(i / cols) * step + step / 2;
          const last = i === DAYS - 1;
          cg.fillStyle = i < lit ? (last || i === lit - 1 ? col.live : col.mark) : col.line2;
          cg.beginPath();
          cg.arc(x, y, i < lit ? (last ? 2.3 : 1.7) : 1, 0, K.TAU);
          cg.fill();
        }
      },
    };
  },
};
export default def;
