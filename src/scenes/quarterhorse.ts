/* Win 07 — Hermeus Quarterhorse Mk 2.1
   An uncrewed jet goes from subsonic, through Mach 1, to Mach 1.21.

   The picture is fixed to the aircraft and shows the one thing that changes at the
   speed of sound: where the aircraft's own noise goes. Every ring is a beat of sound
   leaving the nose. The geometry is exact for the Mach number shown, and when the
   story is over the viewer can set the speed. */
import * as K from '../core/kit.ts';
import { DASH, Pen } from '../draw/pen.ts';
import * as C from '../draw/craft.ts';
import type { SceneDef } from '../core/types.ts';
import * as S from './quarterhorse.sim.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const { DUR, MACH_1, TOP, MACH_TOP, LIFE, PERIOD } = S;
const NX = 596;
const NY = FY + FH / 2;
const SIZE = 138;
const CHOICES = [0.8, 1, MACH_TOP];
/** A change of speed chosen by the viewer: Mach eases from one value to the next over a moment. */
interface Epoch {
  at: number;
  from: number;
  to: number;
  d0: number;
}
const BLEND = 0.9;
/** Radius of the arc that dimensions the cone's half-angle. */
const ARC = 166;
/** The direction, off the nose, in which the label for the sound ahead finds its rings. */
const AHEAD = 0.63;

const def: SceneDef = {
  id: 'quarterhorse',
  duration: DUR,
  takeaway: 'Hermeus calls it the first privately developed uncrewed jet to go supersonic. The next airframe is already being built.',
  alt: 'A delta-winged jet seen from above, held near the right of the frame. Rings of sound spread from its nose and drift back as it accelerates. Below Mach 1 the rings reach ahead of the jet. At Mach 1 they stack into a wall at the nose. At Mach 1.21 they trail behind inside a cone whose half-angle is 56 degrees.',
  acts: [
    { at: 0, label: 'Subsonic' },
    { at: MACH_1, label: 'Mach 1' },
    { at: TOP, label: 'Mach 1.21' },
  ],
  captions: [
    { at: 0, text: 'Quarterhorse Mk 2.1: one fighter engine, a delta wing and nobody on board.' },
    { at: 2.6, text: 'Below the speed of sound, its noise runs out ahead of it.' },
    { at: MACH_1, text: 'At Mach 1 the jet catches its own sound. The waves pile into a wall.' },
    { at: 10.6, text: 'Push through, and the wall folds back into a cone.' },
    { at: TOP, text: 'Mach 1.21 over White Sands, on its third flight.' },
    { at: 16.8, text: 'That was 364 days after Hermeus first flew anything at all.' },
  ],

  setup(ctx) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);

    const rail = ctx.rail();
    const phase = rail.phase('Regime', ['Subsonic', 'At the speed of sound', 'Supersonic']);
    const speed = rail.stat({ label: 'Mach number', slots: 3, decimals: 2 });
    const pair = rail.pair();
    const crew = pair.stat({ label: 'Crew on board', slots: 1 });
    const cone = pair.stat({ label: 'Cone half-angle', slots: 3, decimals: 1, unit: '°' });
    const log = rail.log({ label: 'From first flight to supersonic', items: ['Mk 1 flies: day 0', 'Mk 2.1 flies', 'Mk 2.1 goes supersonic: day 364'] });
    rail.note('The rings and the cone follow from the Mach number alone. The altitude and length of the flight were not released.');
    const STAMPS = ['May 2025', 'Mar 2026', 'May 2026'];

    /* The viewer's turn: pick a speed and watch the sound rearrange itself. */
    let manual: Epoch[] | null = null;
    let lastLive = 0;
    const state = (s: number): { m: number; d: number } => {
      if (manual && s >= manual[0].at) {
        let e = manual[0];
        for (const x of manual) if (s >= x.at) e = x;
        const tau = s - e.at;
        const u = K.clamp(tau / BLEND);
        const eased = BLEND * (u * u * u - (u * u * u * u) / 2);
        return {
          m: K.lerp(e.from, e.to, K.smooth(u)),
          d: e.d0 + e.from * Math.min(tau, BLEND) + (e.to - e.from) * eased + (tau > BLEND ? e.to * (tau - BLEND) : 0),
        };
      }
      return { m: S.mach(Math.min(s, DUR)), d: S.distance(s) };
    };
    const choice = ctx.options(['Mach 0.8', 'Mach 1.0', `Mach ${MACH_TOP}`], 2, (i) => {
      const now = state(lastLive);
      manual = [...(manual ?? []), { at: lastLive, from: now.m, to: CHOICES[i], d0: now.d }];
      ctx.player.refresh();
    });
    choice.el.hidden = true;

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        lastLive = live;
        const g = pen.frame(f.view).g;
        if (t < TOP && manual) {
          manual = null;
          choice.set(2);
        }
        choice.el.hidden = t < TOP + 2.2;
        const { m } = state(live);
        /* The speed the viewer last chose, once the choice is in force. */
        let pick: Epoch | null = null;
        if (manual) for (const x of manual) if (live >= x.at) pick = x;
        pen.plate(FX, FY, FW, FH, { title: 'Sound leaving the nose · the picture moves with the aircraft · geometry exact for the Mach shown', right: 'May 2026' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- The line of flight: there from the first frame, with the aircraft on it ---- */
        pen.stroke(col.line2, 1, 1, DASH.dot).hline(FX, FX + FW, NY);
        g.setLineDash([]);

        /* ---- Rings: one beat of sound each ----
           Oldest first, so the newest beat is never buried where they pile up. They open
           outward from the nose, the newest hands its lime to the next over a fifth of a
           beat, and the oldest fades out instead of stopping. */
        const list = S.rings(live, (s) => state(s).d);
        for (let i = list.length - 1; i >= 0; i--) {
          const r = list[i];
          const from = 0.1 + 0.95 * (r.age / LIFE);
          const enter = K.tween(t, from, from + 0.6, 'out');
          if (enter <= 0) continue;
          const beat = r.age / PERIOD;
          const old = K.smooth(K.clamp((beat - 0.8) / 0.4));
          const a = Math.pow(1 - r.age / LIFE, 1.3);
          const tail = K.clamp((LIFE - r.age) / 1.6);
          pen.stroke(K.blend(col.live, col.mark, old), enter * tail * K.lerp(1, 0.16 + 0.6 * a, old), K.lerp(1.5, 1, old)).ring(NX - r.back, NY, r.radius);
        }

        /* ---- The wall, then the cone: one pair of lines ----
           Near Mach 1 they grow out of the nose as a wall; past it the same two lines fold
           back to the half-angle, so the wall is seen to become the cone. */
        const mu = S.halfAngle(m);
        const sharp = K.clamp((m - 1.02) / 0.05);
        const front = K.clamp(1 - (1 - m) / 0.035);
        if (front > 0) {
          const reach = K.lerp((FH / 2 - 26) * K.smooth(front), FH / 2 + 24, K.smooth(K.clamp((m - 1) / 0.07)));
          const len = reach / Math.sin(mu);
          for (const side of [-1, 1]) {
            pen.stroke(col.ink, 0.88 * front, 1.4).line(NX, NY, NX - len * Math.cos(mu), NY + side * len * Math.sin(mu));
          }
        }
        /* The half-angle, dimensioned: a hairline arc from the line of flight to the cone. */
        const swept = K.smooth(sharp);
        if (sharp > 0) {
          pen.stroke(col.ink, 0.7 * sharp, 1).hline(NX - ARC - 5, NX - ARC + 5, NY);
          g.beginPath();
          g.arc(NX, NY, ARC, Math.PI, Math.PI + mu * swept);
          g.stroke();
        }

        /* ---- The aircraft ---- */
        C.draw(pen, C.DELTA, NX - SIZE / 2, NY, { size: SIZE, color: col.bright, width: 1.4 });
        pen.fill(col.live, K.tween(t, 0, 0.5)).dot(NX, NY, 2.2);
        g.restore();

        /* ---- Labels ---- */
        pen.label(NX - SIZE * 0.72, NY + SIZE * 0.2, NX - SIZE * 0.62, NY + 150, ['Quarterhorse Mk 2.1', 'the size of an F-16, with nobody in it'], { color: col.ink, u: K.pulse(t, 0.7, 6.4, 0.5), align: 'right' });
        /* The leader ends on sound that is really ahead of the nose: how far the rings reach
           along a line 36° off the nose, sampled at fixed ages so it moves without stepping. */
        const here = state(live).d;
        let lead = 0;
        for (let j = 1; j <= 24; j++) {
          const age = ((LIFE - 1.6) * j) / 24;
          const back = S.SOUND * (here - state(live - age).d);
          const radius = S.SOUND * age;
          if (radius <= back) continue;
          const off = back * Math.sin(AHEAD);
          lead = Math.max(lead, Math.sqrt(radius * radius - off * off) - back * Math.cos(AHEAD));
        }
        const out = Math.min(72, 0.6 * lead);
        /* In the viewer's hands the labels follow the speed chosen, not the clock. */
        const aheadU = pick ? K.clamp((0.9 - m) / 0.06) * K.clamp((lead - 34) / 18) : K.pulse(t, 2.6, 6.6, 0.5);
        pen.label(NX + out * Math.cos(AHEAD), NY - out * Math.sin(AHEAD), NX + 128, NY - 132, ['Sound ahead of the jet', 'you would hear it coming'], { color: col.mark, u: aheadU });
        const atOne = pick ? (Math.abs(pick.to - 1) < 0.001 || Math.abs(pick.from - 1) < 0.02 ? K.clamp(1 - Math.abs(m - 1) / 0.02) : 0) : K.pulse(t, 8.4, 10.8, 0.4);
        pen.label(NX, NY - 150, NX + 46, NY - 172, ['Mach 1', 'every wave arrives at once'], { color: col.ink, u: atOne });
        /* The figure sits on its arc, on a backing that breaks the arc and the rings behind it. */
        const figure = K.clamp((sharp - 0.55) / 0.45);
        if (figure > 0) {
          const deg = `${((mu * 180) / Math.PI).toFixed(1)}°`;
          const ax = NX - ARC * Math.cos(mu / 2);
          const ay = NY - ARC * Math.sin(mu / 2);
          const w = pen.measure(deg, { font: 'mono', size: 11, weight: 500 });
          pen.fill(col.stage, figure);
          g.fillRect(Math.round(ax - w / 2 - 6), Math.round(ay - 9), Math.round(w + 12), 18);
          pen.val(deg, ax, ay + 4, col.ink, figure, 'center', 11);
        }
        const lx = NX - 150 * Math.cos(mu);
        const ly = NY - 150 * Math.sin(mu);
        pen.label(lx, ly, NX + 44, ly - 22, ['Mach cone', 'nothing is heard ahead of this line'], { color: col.ink, u: pick ? sharp : K.tween(t, 12.6, 13.6) });

        /* ---- Instruments ---- */
        phase.set(K.clamp((m - 0.9) / 0.1) + K.clamp((m - 1.02) / 0.12));
        speed.set(m);
        crew.set(0);
        cone.set((mu * 180) / Math.PI);
        cone.alpha(0.35 + 0.65 * sharp);
        log.set(0, K.tween(t, 1.2, 1.6), STAMPS[0]);
        log.set(1, K.tween(t, 4.4, 4.8), STAMPS[1]);
        log.set(2, K.tween(t, 13.3, 13.7), STAMPS[2]);
      },
    };
  },
};
export default def;
