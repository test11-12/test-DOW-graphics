/* Win 06 — LUCAS off USS Santa Barbara
   A one-way attack drone leaves the flight deck of a Navy warship on a rocket, the
   booster falls into the sea, and the drone flies out of the picture.

   The ship is seen from the beam. The sea is a halftone that never stops moving, so
   the last frame is alive. What the Navy did not release, the plate says it did not. */
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
const ROCKET = 7;
const AWAY = 13.5;
/** The reported unit price in thousands of dollars, and the drone's approximate size in feet. */
export const PRICE_K = 35;
export const LENGTH_FT = 10;
export const SPAN_FT = 8;

const WL = 350;
const SHIP_X = 326;
const SHIP = 536;
const DECK_Y = WL + C.LCS_DECK.y * SHIP;
const RAIL: Pt = [SHIP_X + 0.37 * SHIP, DECK_Y - 13];
const TILT = -0.44;
const LIGHT = 7.5;
const SEPARATE = 9.4;
const FAR = 17;
const CLIMB: Bez = [RAIL, [RAIL[0] + 70, RAIL[1] - 36], [640, 150], [716, 116]];
const CRUISE: Bez = [[716, 116], [772, 92], [820, 150], [838, 238]];
const PITCH = 10;

const def: SceneDef = {
  id: 'lucas',
  duration: DUR,
  takeaway: 'A cheap drone the enemy invented, a ship the Navy already owns, and a rocket to join them.',
  alt: 'A side view of a littoral combat ship on a moving sea. A small delta-winged drone sits on a short rail on the flight deck. A rocket fires and the drone climbs away trailing smoke. The spent booster tumbles into the water and the drone shrinks toward the horizon.',
  acts: [
    { at: 0, label: 'On deck' },
    { at: ROCKET, label: 'Rocket-assisted' },
    { at: AWAY, label: 'Away' },
  ],
  captions: [
    { at: 0, text: 'USS Santa Barbara, a littoral combat ship, in the Arabian Gulf. On its flight deck sits a drone about ten feet long.' },
    { at: 3.6, text: 'LUCAS is an American copy of Iran’s Shahed-136, built by SpektreWorks. Reported price: about $35,000.' },
    { at: ROCKET, text: '16 December 2025. A rocket kicks it off the deck.' },
    { at: 9.8, text: 'The booster falls away and the engine takes over.' },
    { at: AWAY, text: 'Central Command calls it the first one-way attack drone launched from a Navy ship at sea. It did not say how far it flew.' },
    { at: 17.2, text: 'Ten weeks later it confirmed the drone’s first use in combat, in strikes on Iran.' },
  ],

  setup(ctx) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);
    const sea = new Halftone(FX, WL + 4, FW / PITCH, Math.floor((FY + FH - WL - 4) / PITCH), PITCH, { stagger: true });

    const rail = ctx.rail();
    const phase = rail.phase('Launch', ['On deck', 'Rocket-assisted', 'Away']);
    const pair = rail.pair();
    const price = pair.stat({ label: 'Reported price', prefix: '$', unit: 'thousand', slots: 2 });
    const length = pair.stat({ label: 'Length, about', unit: 'ft', slots: 2 });
    const log = rail.log({ label: 'How fast it moved', items: ['Drone squadron announced', 'First launch from a ship', 'First use in combat'] });
    const ways = rail.chips({ label: 'Ways to launch it', items: ['Rocket-assisted', 'Catapult', 'Vehicle', 'Mobile ground station'] });
    rail.note('Ship and drone are schematic. Range, payload and target were not released, and the price is a reported figure.');
    const STAMPS = ['3 Dec 2025', '16 Dec 2025', '28 Feb 2026'];

    /** Where the drone is at story time `s`, which way it points and how large it looks. */
    const drone = (s: number): { p: Pt; a: number; size: number } => {
      if (s < LIGHT) return { p: RAIL, a: TILT, size: 30 };
      const leg = s < SEPARATE ? CLIMB : CRUISE;
      const u = s < SEPARATE ? K.tween(s, LIGHT, SEPARATE, 'in') : K.tween(s, SEPARATE, FAR, 'out');
      const p = K.bezier(leg, u);
      const q = K.bezier(leg, Math.min(1, u + 0.015));
      const r = K.bezier(leg, Math.max(0, u - 0.015));
      // Climbing, it points where it is going. Flying away, it levels off and simply gets smaller.
      const a = s < LIGHT + 0.25 ? TILT : s < SEPARATE ? Math.atan2(q[1] - r[1], q[0] - r[0]) : K.lerp(Math.atan2(q[1] - r[1], q[0] - r[0]), -0.12, K.ease.out(K.seg(s, SEPARATE, SEPARATE + 3.5)));
      return { p, a, size: s < SEPARATE ? 30 : K.lerp(30, 7, K.ease.out(K.seg(s, SEPARATE, FAR))) };
    };
    /** The spent booster: it keeps the drone's speed for a moment, then falls. */
    const booster = (s: number): { p: Pt; a: number; wet: boolean } => {
      const tau = s - SEPARATE;
      const y = 116 - 52 * tau + 92 * tau * tau;
      return { p: [716 + 58 * tau, Math.min(y, WL)], a: TILT + tau * 3.1, wet: y >= WL };
    };

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        const on = K.tween(t, 0, 0.9);
        const heave = 1.3 * Math.sin(live * 0.9);
        pen.plate(FX, FY, FW, FH, { title: 'Arabian Gulf · USS Santa Barbara (LCS 32), seen from the beam · not to scale', right: '16 Dec 2025' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- The sea ---- */
        for (let i = 0; i < sea.n; i++) {
          const depth = (sea.ys[i] - WL) / (FY + FH - WL);
          const swell = K.noise2(sea.xs[i] / (46 + depth * 60) - live * 0.42, sea.ys[i] / 15 + live * 0.16, 6);
          sea.tone[i] = K.clamp(0.16 + swell * 0.6 + depth * 0.1);
          sea.shade[i] = 0;
        }
        sea.draw(pen, [K.rgba(col.wire, 0.9)], { min: 0.04, max: 0.34, gamma: 1.1, alpha: on });
        pen.stroke(col.wire, on, 1).hline(FX, FX + FW, WL);

        /* ---- Smoke and the drone ---- */
        const d = drone(t);
        if (t >= LIGHT) {
          C.plume(pen, (age) => {
            const s = t - age;
            if (s < LIGHT || s > SEPARATE) return null;
            const q = drone(s).p;
            return [q[0] - 9 * age, q[1] - 4 * age];
          }, { life: 3.4, step: 0.04, r0: 1.4, r1: 9, color: col.mark, alpha: 0.62, jitter: 16, seed: 2 });
          const burn = K.pulse(t, LIGHT, SEPARATE + 0.1, 0.12);
          if (burn > 0) {
            const bx = d.p[0] - Math.cos(d.a) * 19;
            const by = d.p[1] - Math.sin(d.a) * 19;
            pen.fill(col.live, 0.3 * burn).dot(bx, by, 8 + 2 * Math.sin(t * 40));
            pen.fill(col.live, burn).dot(bx, by, 3.6);
          }
        }
        if (t >= SEPARATE) {
          const b = booster(t);
          if (!b.wet) {
            g.save();
            g.translate(b.p[0], b.p[1]);
            g.rotate(b.a);
            pen.fill(col.stage).rect(-8, -2.2, 16, 4.4);
            g.fill();
            pen.stroke(col.mark, 1, 1.2).rect(-8, -2.2, 16, 4.4);
            g.stroke();
            g.restore();
          } else {
            const since = t - (SEPARATE + 1.93);
            for (let k = 0; k < 3; k++) {
              const u = K.seg(since, k * 0.2, 1.6 + k * 0.2);
              if (u > 0 && u < 1) {
                pen.stroke(col.mark, (1 - u) * 0.9, 1.1);
                g.beginPath();
                g.ellipse(b.p[0], WL, 5 + u * 30, 1.2 + u * 4, 0, 0, K.TAU);
                g.stroke();
              }
            }
          }
        }
        // Before it lights, the booster is under the drone's tail.
        if (t < SEPARATE) {
          g.save();
          g.translate(d.p[0] - Math.cos(d.a) * 13, d.p[1] - Math.sin(d.a) * 13 + 4);
          g.rotate(d.a);
          pen.stroke(col.mark, on, 1.2).rect(-8, -2.2, 16, 4.4);
          g.stroke();
          g.restore();
        }
        C.draw(pen, C.LUCAS, d.p[0], d.p[1] + (t < LIGHT ? heave : 0), { size: d.size, angle: d.a, color: col.live, alpha: on, width: 1.4 });
        if (t >= FAR) {
          const beat = (live * 0.5) % 1;
          pen.stroke(col.live, (1 - beat) * 0.6, 1).ring(d.p[0], d.p[1], 5 + beat * 16);
        }

        /* ---- The ship ---- */
        // A little wake astern.
        pen.stroke(col.mark, 0.5 * on, 1, [7, 9], -live * 16).hline(SHIP_X + SHIP * 0.5, SHIP_X + SHIP * 0.5 + 92, WL + 3);
        g.setLineDash([]);
        C.draw(pen, C.LCS, SHIP_X, WL + heave, { size: SHIP, color: col.bright, alpha: on, width: 1.3 });
        // The launch rail on the flight deck.
        const rx = RAIL[0];
        const ry = RAIL[1] + heave;
        pen.stroke(col.bright, on, 1.4).line(rx - 20 * Math.cos(TILT), ry - 20 * Math.sin(TILT) + 6, rx + 18 * Math.cos(TILT), ry + 18 * Math.sin(TILT) + 6);
        pen.stroke(col.bright, on, 1.1).line(rx + 10, ry + 2, rx + 10, DECK_Y + heave).line(rx - 14, ry + 12, rx - 14, DECK_Y + heave);
        g.restore();

        /* ---- Labels ---- */
        pen.label(SHIP_X - 0.095 * SHIP, WL - 0.172 * SHIP, SHIP_X - 0.2 * SHIP, WL - 0.33 * SHIP, ['USS Santa Barbara', 'Independence-class littoral combat ship'], { color: col.ink, u: K.pulse(t, 0.6, ROCKET - 0.3, 0.5), align: 'right' });
        pen.label(SHIP_X + 0.25 * SHIP, DECK_Y - 2, SHIP_X + 0.2 * SHIP, WL - 0.33 * SHIP, ['Flight deck', 'built for helicopters'], { color: col.ink, u: K.pulse(t, 1.4, ROCKET - 0.3, 0.5), align: 'right' });
        pen.label(RAIL[0] + 4, RAIL[1] - 12, RAIL[0] + 54, RAIL[1] - 76, ['LUCAS', `about ${LENGTH_FT} ft long, ${SPAN_FT} ft across`], { color: col.live, u: K.pulse(t, 2.2, ROCKET - 0.3, 0.5) });
        const top = K.bezier(CLIMB, 0.62);
        pen.label(top[0] - 10, top[1] + 8, top[0] - 78, top[1] - 34, ['Rocket-assisted takeoff', 'from the deck to flying speed'], { color: col.ink, u: K.pulse(t, LIGHT + 0.9, AWAY, 0.4), align: 'right' });
        const drop = booster(SEPARATE + 0.9).p;
        pen.label(drop[0] + 6, drop[1], drop[0] + 26, drop[1] - 52, ['Booster', 'falls away'], { color: col.mark, u: K.pulse(t, SEPARATE + 0.3, AWAY, 0.4) });
        const gone = K.bezier(CRUISE, 1);
        pen.label(gone[0] - 6, gone[1] - 5, gone[0] - 74, gone[1] - 70, ['Out of the picture', 'range and target not released'], { color: col.live, u: K.tween(t, AWAY + 1.4, AWAY + 2.3), align: 'right' });

        /* ---- Instruments ---- */
        phase.set(K.tween(t, ROCKET, ROCKET + 0.7) + K.tween(t, AWAY, AWAY + 0.7));
        const told = K.tween(t, 3.6, 4.9, 'out');
        price.set(PRICE_K * told);
        price.alpha(0.35 + 0.65 * K.tween(t, 3.5, 4));
        length.set(LENGTH_FT * K.tween(t, 2.2, 3.2, 'out'));
        log.set(0, t >= 1.2, STAMPS[0]);
        log.set(1, t >= LIGHT, STAMPS[1]);
        log.set(2, t >= 17.2, STAMPS[2]);
        ways.set(0, t >= LIGHT ? (t < SEPARATE + 1 ? 5 : 2) : 1);
        for (let i = 1; i < 4; i++) ways.set(i, t >= 4.2 + i * 0.3 ? 1 : 0);
      },
    };
  },
};
export default def;
