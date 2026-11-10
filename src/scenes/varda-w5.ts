/* Win 05 — Varda W-5
   Sixty-three days in orbit, then a bright line across the night over South Australia,
   a parachute, and a capsule on the ground.

   The plate is the sky the people of Koonibba and Ceduna photographed: stars as dots,
   the re-entry as a long exposure. Marks along the streak are laid down at equal
   intervals, so the slowing shows without inventing any speeds. A small second plate
   keeps the orbit in view. */
import * as K from '../core/kit.ts';
import type { Bez, Pt } from '../core/kit.ts';
import { DASH, Halftone, Pen } from '../draw/pen.ts';
import type { SceneDef } from '../core/types.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const DUR = 21;
const ENTRY = 7;
const RECOVERY = 14;
export const DAYS = 63;
/** Thousands of kilometres an hour at entry, as reported; and Varda's Mach figure. */
export const KMH = 30000;
export const MACH = 25;

const HORIZON = 392;
const PITCH = 12;
const STREAK: Bez = [[84, 162], [262, 92], [468, 176], [598, 312]];
const T_IN = 8.3;
const T_OUT = 13.5;
const CHUTE = 14.2;
const DOWN = 17.9;
const LANDING: Pt = [646, HORIZON - 3];
/** Earlier capsules that came down on the same range inside twelve months: positions are illustrative. */
const EARLIER: Pt[] = [[556, HORIZON + 22], [742, HORIZON + 30]];

/* ---- The orbit, in a small plate of its own ---- */
const IX = 694;
const IY = 70;
const IW = 174;
const IH = 148;
const EARTH: Pt = [IX + IW / 2, IY + IH / 2 + 4];
const R_EARTH = 34;
const R_ORBIT = 53;
const SEPARATE = 7.45;
const LAP = 1.7;
/** The spacecraft's angle round the Earth: it passes the bottom (Antarctica) exactly at separation. */
const lap = (s: number): number => Math.PI / 2 - ((s - SEPARATE) / LAP) * K.TAU;
const TOUCH = (32 * Math.PI) / 180;

const def: SceneDef = {
  id: 'varda-w5',
  duration: DUR,
  takeaway: 'A capsule that comes home on purpose is a hypersonic test range you can book.',
  alt: 'A night sky over South Australia, with stars drawn as dots above a flat horizon. A small inset shows a spacecraft circling the Earth while a counter reaches 63 days, then a capsule leaving it over Antarctica. In the main picture the capsule crosses the sky as a bright streak, slowing as it goes, then descends under a parachute and lands inside a marked test range.',
  acts: [
    { at: 0, label: 'Orbit' },
    { at: ENTRY, label: 'Re-entry' },
    { at: RECOVERY, label: 'Recovery' },
  ],
  captions: [
    { at: 0, text: 'Launched from California on 28 November 2025, Varda’s W-5 capsule spends 63 days in orbit on the company’s own spacecraft.' },
    { at: 4.2, text: 'On board is a US Navy payload built to take data on the way down.' },
    { at: ENTRY, text: '30 January 2026. The capsule separates over Antarctica and hits the atmosphere at about 30,000 km/h.' },
    { at: 10.6, text: 'People in Koonibba and Ceduna watch it draw a line across the night.' },
    { at: RECOVERY, text: 'A parachute opens. It comes down on the Koonibba Test Range, 41,000 square kilometres of outback.' },
    { at: DOWN + 0.2, text: 'It is the third capsule to land here in under twelve months.' },
  ],

  setup(ctx) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);
    const sky = new Halftone(FX, FY, FW / PITCH, Math.floor((HORIZON - FY) / PITCH), PITCH, { stagger: true });
    // Fix the stars once: most of the lattice is empty, a few points are bright.
    const star = new Float32Array(sky.n);
    for (let i = 0; i < sky.n; i++) {
      const b = K.hash(i, 11);
      const inInset = sky.xs[i] > IX - 8 && sky.xs[i] < IX + IW + 8 && sky.ys[i] > IY - 18 && sky.ys[i] < IY + IH + 8;
      const inDays = sky.ys[i] < FY + 52 && sky.xs[i] < FX + 580;
      star[i] = b > 0.84 && !inInset && !inDays ? Math.pow((b - 0.84) / 0.16, 2.2) * 0.9 + 0.1 : 0;
    }

    const rail = ctx.rail();
    const phase = rail.phase('Phase', ['In orbit', 'Re-entry', 'Recovery']);
    const pair = rail.pair();
    const days = pair.stat({ label: 'Days in orbit', slots: 2, bar: true });
    const mach = pair.stat({ label: 'Mach at entry', slots: 2, unit: '+' });
    const speed = rail.stat({ label: 'Speed at entry, km/h, about', slots: 5, size: 'm' });
    const chips = rail.chips({ label: 'Flying on W-5', items: ['US Navy payload', 'AFRL Prometheus', 'Varda’s own spacecraft', 'C-PICA heat shield'] });
    rail.note('Speeds are Varda’s and Southern Launch’s figures. The sky, the track and the landing point are schematic.');

    const along = (s: number): number => K.tween(s, T_IN, T_OUT, 'out');

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        const on = K.tween(t, 0, 1);
        pen.plate(FX, FY, FW, FH, { title: 'Night sky over the Koonibba Test Range, South Australia · schematic', right: '30 Jan 2026' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- Stars and the ground ---- */
        for (let i = 0; i < sky.n; i++) {
          sky.tone[i] = star[i] ? star[i] * (0.72 + 0.28 * Math.sin(live * (0.8 + K.hash(i, 12) * 1.6) + K.hash(i, 13) * K.TAU)) : 0;
          sky.shade[i] = 0;
        }
        sky.draw(pen, [col.mark], { min: 0.02, max: 0.17, gamma: 1, alpha: on });
        pen.stroke(col.wire, on, 1);
        g.beginPath();
        for (let x = FX; x <= FX + FW; x += 14) {
          const y = HORIZON + K.noise(x / 90, 4) * 2.2;
          if (x === FX) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        pen.hatch(FX, HORIZON + 4, FW, FY + FH - HORIZON - 4, col.wire, 0.22 * on, 7);

        /* ---- The range, and the capsules that landed here before ---- */
        const range = K.tween(t, RECOVERY + 0.4, RECOVERY + 1.4);
        if (range > 0) {
          pen.stroke(col.mark, 0.8 * range, 1, DASH.dash).hline(K.lerp(660, 470, range), K.lerp(660, 838, range), HORIZON + 46);
          g.setLineDash([]);
          pen.stroke(col.mark, 0.8 * range, 1).vline(470, HORIZON + 41, HORIZON + 51).vline(838, HORIZON + 41, HORIZON + 51);
          pen.cap('Koonibba Test Range · 41,000 sq km', 654, HORIZON + 64, col.mark, range, 'center');
        }
        const third = K.tween(t, DOWN + 0.3, DOWN + 1.1);
        for (const [x, y] of EARLIER) {
          pen.stroke(col.dim, third, 1.2).ring(x, y, 4);
          pen.fill(col.dim, third).dot(x, y, 1.4);
        }

        /* ---- The streak: a long exposure ---- */
        const u = along(t);
        if (t > T_IN) {
          const n = 60;
          // What the camera has already recorded stays on the plate.
          pen.stroke(col.mark, 0.5 - 0.22 * K.tween(t, DOWN, DOWN + 2), 1.2);
          g.beginPath();
          for (let i = 0; i <= n; i++) {
            const p = K.bezier(STREAK, (u * i) / n);
            if (i) g.lineTo(p[0], p[1]);
            else g.moveTo(p[0], p[1]);
          }
          g.stroke();
          // Equal steps of time: the marks close up as the capsule slows.
          for (let s = T_IN + 0.3; s <= Math.min(t, T_OUT) + 1e-6; s += 0.3) {
            const p = K.bezier(STREAK, along(s));
            pen.fill(col.bright, 0.9).dot(p[0], p[1], 1.6);
          }
          // The plasma behind the capsule, brightest in the middle of the pass.
          const heat = K.pulse(u, 0.02, 0.86, 0.14);
          if (heat > 0) {
            for (let i = 0; i < 26; i++) {
              const back = u - (i / 26) * 0.2;
              if (back < 0) break;
              const p = K.bezier(STREAK, back);
              const q = K.bezier(STREAK, Math.max(0, back - 0.008));
              pen.stroke(K.blend(col.live, col.bright, i / 26), heat * (1 - i / 26), 3.2 * (1 - i / 30)).line(q[0], q[1], p[0], p[1]);
            }
          }
          if (t < CHUTE) {
            const p = K.bezier(STREAK, u);
            pen.fill(col.live, 0.25 * heat).dot(p[0], p[1], 9);
            pen.fill(heat > 0.1 ? col.live : col.mark).dot(p[0], p[1], K.lerp(2.2, 3.4, heat));
          }
        }

        /* ---- The parachute ---- */
        const end = K.bezier(STREAK, 1);
        if (t >= CHUTE) {
          const fall = K.tween(t, CHUTE, DOWN, 'inOutSine');
          const open = K.tween(t, CHUTE, CHUTE + 0.7, 'out');
          const sway = Math.sin(t * 2.1) * 5 * (1 - fall);
          const x = K.lerp(end[0], LANDING[0], fall) + sway;
          const y = K.lerp(end[1], LANDING[1], fall);
          const landed = K.tween(t, DOWN, DOWN + 0.9);
          const lift = 26 * (1 - landed);
          if (lift > 1) {
            const w = 15 * open;
            pen.stroke(col.bright, 1 - landed, 1.2);
            g.beginPath();
            g.ellipse(x - sway * 0.5, y - lift, w, w * 0.62, 0, Math.PI, K.TAU);
            g.closePath();
            g.stroke();
            pen.stroke(col.bright, 0.7 * (1 - landed), 1).line(x - sway * 0.5 - w, y - lift, x, y - 4).line(x - sway * 0.5 + w, y - lift, x, y - 4).line(x - sway * 0.5, y - lift, x, y - 4);
          }
          g.beginPath();
          g.moveTo(x - 4, y - 5);
          g.lineTo(x + 4, y - 5);
          g.lineTo(x + 6.5, y + 2);
          g.lineTo(x - 6.5, y + 2);
          g.closePath();
          pen.fill(col.stage);
          g.fill();
          pen.stroke(landed > 0 ? col.live : col.bright, 1, 1.4);
          g.stroke();
          if (landed > 0) {
            pen.brackets(LANDING[0], LANDING[1] - 1, 13 + 8 * (1 - landed), col.live, landed, 4);
            for (let k = 0; k < 2; k++) {
              const beat = (live * 0.4 + k * 0.5) % 1;
              pen.stroke(col.live, (1 - beat) * 0.5 * landed, 1);
              g.beginPath();
              g.ellipse(LANDING[0], LANDING[1] + 2, 12 + beat * 40, 3 + beat * 9, 0, 0, K.TAU);
              g.stroke();
            }
          }
        }

        /* ---- The orbit ---- */
        pen.fill(col.stage, 0.9 * on).rect(IX, IY, IW, IH);
        g.fill();
        pen.plate(IX, IY, IW, IH, { title: 'Orbit, seen side-on', alpha: on });
        pen.fill(col.sheet2, on).dot(EARTH[0], EARTH[1], R_EARTH);
        pen.stroke(col.wire, on, 1).ring(EARTH[0], EARTH[1], R_EARTH);
        pen.stroke(col.line2, on, 1, DASH.dot).ring(EARTH[0], EARTH[1], R_ORBIT);
        g.setLineDash([]);
        pen.stroke(col.ink, on, 1.2).vline(EARTH[0], EARTH[1] + R_EARTH - 4, EARTH[1] + R_EARTH + 3);
        const gone = K.tween(t, SEPARATE + 0.2, SEPARATE + 1.3);
        if (gone < 1) {
          // The spacecraft, and after separation the part of it that is not coming back.
          const a = lap(t);
          const x = EARTH[0] + R_ORBIT * Math.cos(a);
          const y = EARTH[1] + R_ORBIT * Math.sin(a);
          for (let k = 1; k < 9; k++) {
            const b = lap(t - k * 0.035);
            pen.fill(col.bright, on * (1 - gone) * (1 - k / 9) * 0.5).dot(EARTH[0] + R_ORBIT * Math.cos(b), EARTH[1] + R_ORBIT * Math.sin(b), 1.3);
          }
          pen.fill(t < SEPARATE ? col.live : col.dim, on * (1 - gone)).dot(x, y, 2.8);
        }
        if (t >= SEPARATE) {
          // The capsule comes in from the bottom of the orbit to the south of Australia.
          const fallIn = K.tween(t, SEPARATE, T_IN + 0.4, 'inOutSine');
          const a = K.lerp(Math.PI / 2, TOUCH, fallIn);
          const r = K.lerp(R_ORBIT, R_EARTH, fallIn);
          pen.stroke(col.live, 0.8, 1.2);
          g.beginPath();
          for (let i = 0; i <= 20; i++) {
            const v = (fallIn * i) / 20;
            const aa = K.lerp(Math.PI / 2, TOUCH, v);
            const rr = K.lerp(R_ORBIT, R_EARTH, v);
            if (i) g.lineTo(EARTH[0] + rr * Math.cos(aa), EARTH[1] + rr * Math.sin(aa));
            else g.moveTo(EARTH[0] + rr * Math.cos(aa), EARTH[1] + rr * Math.sin(aa));
          }
          g.stroke();
          pen.fill(col.live).dot(EARTH[0] + r * Math.cos(a), EARTH[1] + r * Math.sin(a), 2.8);
        }
        pen.stroke(col.ink, on, 1.2).line(EARTH[0] + (R_EARTH - 4) * Math.cos(TOUCH), EARTH[1] + (R_EARTH - 4) * Math.sin(TOUCH), EARTH[0] + (R_EARTH + 3) * Math.cos(TOUCH), EARTH[1] + (R_EARTH + 3) * Math.sin(TOUCH));
        pen.cap(t < SEPARATE ? `Day ${Math.min(DAYS, Math.floor(DAYS * K.tween(t, 1, 6.2) + 1e-6))} of ${DAYS}` : 'Capsule separates', IX + 9, IY + 17, t < SEPARATE ? col.ink : col.live, on);
        pen.cap('Antarctica', IX + 9, IY + IH - 9, col.faint, on);
        pen.cap('Australia', IX + IW - 9, IY + IH - 9, col.faint, on, 'right');

        /* ---- The mission as a row of days: launch at the left, re-entry at the right ---- */
        const lit = Math.floor(DAYS * K.tween(t, 1, 6.2) + 1e-6);
        for (let i = 0; i < DAYS; i++) {
          const x = FX + 18 + i * 8.6;
          const last = i === DAYS - 1;
          if (i < lit) pen.fill(last || (i === lit - 1 && t < ENTRY) ? col.live : col.mark, on).dot(x, FY + 24, last ? 2.6 : 1.9);
          else pen.fill(col.wire, on).dot(x, FY + 24, 1.2);
        }
        pen.cap('Launch · 28 Nov 2025', FX + 14, FY + 43, col.muted, on);
        pen.cap('Re-entry · 30 Jan 2026', FX + 18 + (DAYS - 1) * 8.6 + 4, FY + 43, lit >= DAYS ? col.live : col.faint, on, 'right');
        pen.cap('One dot a day in orbit', FX + 18 + ((DAYS - 1) * 8.6) / 2, FY + 43, col.faint, on, 'center');
        g.restore();

        /* ---- Labels ---- */
        const mid = K.bezier(STREAK, 0.34);
        pen.label(mid[0], mid[1] + 5, mid[0] - 24, mid[1] + 86, ['Re-entry', 'about 30,000 km/h at the top'], { color: col.live, u: K.pulse(t, T_IN + 1.2, RECOVERY + 0.4, 0.5) });
        const late = K.bezier(STREAK, 0.9);
        pen.label(late[0] - 5, late[1] - 4, late[0] - 80, late[1] + 48, ['Equal steps of time', 'the marks close up as it slows'], { color: col.ink, u: K.pulse(t, T_IN + 3.4, RECOVERY + 0.4, 0.5), align: 'right' });
        pen.label(170, HORIZON - 2, 204, HORIZON - 54, ['Koonibba and Ceduna', 'where it was photographed'], { color: col.ink, u: K.pulse(t, 10.6, RECOVERY + 0.4, 0.5) });
        pen.label(LANDING[0] + 12, LANDING[1] - 12, LANDING[0] + 58, LANDING[1] - 64, ['W-5 capsule', 'down under a parachute'], { color: col.live, u: K.tween(t, DOWN + 0.2, DOWN + 1) });
        pen.label(EARLIER[0][0] - 5, EARLIER[0][1] - 4, EARLIER[0][0] - 42, EARLIER[0][1] - 62, ['Two earlier capsules', 'inside twelve months'], { color: col.dim, u: K.tween(t, DOWN + 0.6, DOWN + 1.4), align: 'right' });

        /* ---- Instruments ---- */
        phase.set(K.tween(t, ENTRY, ENTRY + 0.7) + K.tween(t, RECOVERY, RECOVERY + 0.7));
        const orbited = K.tween(t, 1, 6.2);
        days.set(DAYS * orbited);
        days.bar(orbited);
        const hit = K.tween(t, T_IN, T_IN + 1.3, 'out');
        mach.set(MACH * hit);
        mach.alpha(0.35 + 0.65 * K.tween(t, T_IN - 0.2, T_IN + 0.3));
        speed.set(KMH * hit);
        speed.alpha(0.35 + 0.65 * K.tween(t, T_IN - 0.2, T_IN + 0.3));
        [2.2, 2.9, 3.6, 4.3].forEach((at, i) => chips.set(i, t >= at ? (i === 0 && t >= 4.2 && t < ENTRY ? 5 : 1) : 0));
      },
    };
  },
};
export default def;
