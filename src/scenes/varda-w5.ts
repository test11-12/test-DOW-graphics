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
/** Kilometers an hour at entry, as reported; and Varda's Mach figure for its capsules. */
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
const R_EARTH = 34;
const R_ORBIT = 53;
const SEPARATE = 7.45;
const LAP = 1.7;
/** The spacecraft's angle round the Earth: it passes the bottom (Antarctica) exactly at separation. */
const lap = (s: number): number => Math.PI / 2 - ((s - SEPARATE) / LAP) * K.TAU;
const TOUCH = (32 * Math.PI) / 180;
/** While the days are counted the orbit plate is drawn large in the middle of the sky. Once the
    count is complete it docks in its corner, moving across first and then up, so that its title
    never passes over the row of days. */
const BIG = 1.6;
const BIG_X = FX + (FW - IW * BIG) / 2;
const BIG_Y = 126;
const DOCK = 6.15;

/* ---- The capsule under its parachute ---- */
const CAPSULE_TOP = 8;
/** Where the capsule is on the way down: the sideways drift dies out before the fall does. */
const descent = (s: number, from: Pt): Pt => [
  K.lerp(from[0], LANDING[0], K.tween(s, CHUTE, CHUTE + 2.6, 'inOutSine')),
  K.lerp(from[1], LANDING[1], K.tween(s, CHUTE, DOWN, 'inOutSine')),
];

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
    { at: 0, text: 'Launched from California on November 28, 2025, Varda’s W-5 capsule spends 63 days in orbit on the company’s own spacecraft.' },
    { at: 4.2, text: 'On board is a US Navy payload built to collect data during re-entry.' },
    { at: ENTRY, text: 'Early on January 30, 2026, Australian time, the capsule separates over Antarctica and hits the atmosphere at about 30,000 km/h.' },
    { at: 10.6, text: 'People in Koonibba and Ceduna watch it draw a line across the night.' },
    { at: RECOVERY, text: 'A parachute opens. It comes down on the Koonibba Test Range, more than 41,000 square kilometers of outback.' },
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
      const inDays = sky.ys[i] < FY + 52 && sky.xs[i] < FX + 580;
      star[i] = b > 0.84 && !inDays ? Math.pow((b - 0.84) / 0.16, 2.2) * 0.9 + 0.1 : 0;
    }

    const rail = ctx.rail();
    const phase = rail.phase('Phase', ['In orbit', 'Re-entry', 'Recovery']);
    const pair = rail.pair();
    const days = pair.stat({ label: 'Days in orbit', slots: 2, bar: true });
    const mach = pair.stat({ label: 'Mach at entry', slots: 2, unit: '+' });
    const speed = rail.stat({ label: 'Speed at entry, km/h, about', slots: 5, size: 'm' });
    const chips = rail.chips({ label: 'Flying on W-5', items: ['US Navy payload', 'Varda’s own spacecraft', 'In-house C-PICA heat shield', 'Varda’s fourth re-entry'] });
    rail.note('Speeds are the companies’ figures; Mach 25+ is what Varda gives for all its capsules. The sky, the track and the landing point are schematic.');

    const along = (s: number): number => K.tween(s, T_IN, T_OUT, 'out');
    /** The unit normal of the streak at u, pointing up and to the right of the direction of flight. */
    const normal = (v: number): Pt => {
      const p = K.bezier(STREAK, Math.max(0, v - 0.004));
      const q = K.bezier(STREAK, Math.min(1, v + 0.004));
      const d = K.dist(p[0], p[1], q[0], q[1]) || 1;
      return [(q[1] - p[1]) / d, -(q[0] - p[0]) / d];
    };
    /** How bright the pass was at u: quick to light, brightest in the first half, fading as it slows. */
    const exposure = (v: number): number => K.smooth(K.clamp(v / 0.18)) * (1 - 0.82 * K.smooth(K.clamp((v - 0.4) / 0.58)));
    const end = K.bezier(STREAK, 1);

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        // The first frame is already a picture: dim, then it comes up.
        const on = K.lerp(0.4, 1, K.tween(t, 0, 0.9));
        pen.plate(FX, FY, FW, FH, { title: 'Night sky over the Koonibba Test Range, South Australia · schematic', right: '30 Jan 2026' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- Where the orbit plate is now ---- */
        const sc = K.lerp(BIG, 1, K.tween(t, DOCK, DOCK + 0.85));
        const ix = K.lerp(BIG_X, IX, K.tween(t, DOCK, DOCK + 0.6));
        const iy = K.lerp(BIG_Y, IY, K.tween(t, DOCK + 0.25, DOCK + 0.85));
        const iw = IW * sc;
        const ih = IH * sc;
        const ex = ix + iw / 2;
        const ey = iy + ih / 2 + 4 * sc;
        const rE = R_EARTH * sc;
        const rO = R_ORBIT * sc;
        const bead = 0.6 + 0.4 * sc;
        // Once the capsule is in the sky, the accent belongs to the streak and then to the landing.
        const calm = K.tween(t, T_IN + 0.6, T_IN + 1.8);

        /* ---- Stars and the ground ---- */
        // The sky is the backdrop while the days are counted, and comes up when it becomes the subject.
        const night = K.lerp(0.55, 1, K.tween(t, DOCK, ENTRY + 0.8));
        for (let i = 0; i < sky.n; i++) {
          if (star[i]) {
            // No star sits under the orbit plate or its title, wherever the plate is.
            const dx = Math.max(ix - sky.xs[i], sky.xs[i] - ix - iw, 0);
            const dy = Math.max(iy - 16 - sky.ys[i], sky.ys[i] - iy - ih, 0);
            const clear = K.clamp((Math.max(dx, dy) - 3) / 8);
            sky.tone[i] = clear * star[i] * (0.72 + 0.28 * Math.sin(live * (0.8 + K.hash(i, 12) * 1.6) + K.hash(i, 13) * K.TAU));
          } else sky.tone[i] = 0;
          sky.shade[i] = 0;
        }
        sky.draw(pen, [col.mark], { min: 0.02, max: 0.17, gamma: 1, alpha: on * night });
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
          pen.cap('Koonibba Test Range · more than 41,000 sq km', 654, HORIZON + 64, col.mark, range, 'center');
        }
        EARLIER.forEach(([x, y], k) => {
          const third = K.tween(t, DOWN + 0.3 + k * 0.25, DOWN + 1.1 + k * 0.25);
          if (third <= 0) return;
          pen.stroke(col.dim, third, 1.2).ring(x, y, K.lerp(8, 4, third));
          pen.fill(col.dim, third).dot(x, y, 1.4);
        });

        /* ---- The streak: a long exposure ---- */
        const u = along(t);
        const settle = K.tween(t, DOWN, DOWN + 2);
        if (t > T_IN) {
          const n = 72;
          // What the camera has already recorded stays on the plate: a hairline the whole way…
          pen.stroke(col.mark, 0.46 - 0.14 * settle, 1);
          g.beginPath();
          for (let i = 0; i <= n; i++) {
            const p = K.bezier(STREAK, (u * i) / n);
            if (i) g.lineTo(p[0], p[1]);
            else g.moveTo(p[0], p[1]);
          }
          g.stroke();
          // …and over it the exposure itself, widest where the pass was brightest.
          const side: Pt[] = [];
          g.beginPath();
          for (let i = 0; i <= n; i++) {
            const v = (u * i) / n;
            const p = K.bezier(STREAK, v);
            const m = normal(v);
            const hw = 1.7 * exposure(v);
            if (i) g.lineTo(p[0] + m[0] * hw, p[1] + m[1] * hw);
            else g.moveTo(p[0] + m[0] * hw, p[1] + m[1] * hw);
            side.push([p[0] - m[0] * hw, p[1] - m[1] * hw]);
          }
          for (let i = n; i >= 0; i--) g.lineTo(side[i][0], side[i][1]);
          g.closePath();
          pen.fill(col.bright, 0.5 - 0.16 * settle);
          g.fill();
          // Equal steps of time, ticked across the track: the marks close up as the capsule slows.
          for (let s = T_IN + 0.3; s <= Math.min(t, T_OUT) + 1e-6; s += 0.3) {
            const v = along(s);
            const p = K.bezier(STREAK, v);
            const m = normal(v);
            const len = 5 * K.tween(t - s, 0, 0.35, 'out');
            pen.stroke(col.bright, 0.95 - 0.2 * settle, 1.3).line(p[0] - m[0] * len, p[1] - m[1] * len, p[0] + m[0] * len, p[1] + m[1] * len);
          }
          // The plasma behind the capsule, brightest in the middle of the pass. It is as long as
          // the last half second of flight, so it shortens as the capsule slows.
          const heat = K.pulse(u, 0.02, 0.86, 0.14);
          if (heat > 0) {
            let p = K.bezier(STREAK, u);
            for (let i = 0; i < 26; i++) {
              const q = K.bezier(STREAK, along(t - ((i + 1) / 26) * 0.55));
              pen.stroke(K.blend(col.live, col.bright, i / 26), heat * (1 - i / 26), 3.4 * (1 - i / 30)).line(q[0], q[1], p[0], p[1]);
              p = q;
            }
          }
          if (t < CHUTE) {
            const p = K.bezier(STREAK, u);
            pen.fill(col.live, 0.25 * heat).dot(p[0], p[1], 9);
            pen.fill(heat > 0.1 ? col.live : col.mark).dot(p[0], p[1], K.lerp(2.2, 3.4, heat));
          }
        }

        /* ---- The parachute ---- */
        if (t >= CHUTE) {
          const fall = K.tween(t, CHUTE, DOWN, 'inOutSine');
          const open = K.tween(t, CHUTE, CHUTE + 0.7, 'out');
          const landed = K.tween(t, DOWN, DOWN + 0.9);
          const sway = Math.sin((t - CHUTE) * 2.1) * 5 * (1 - fall);
          const at = descent(t, end);
          const x = at[0] + sway;
          const y = at[1];
          // The way down stays on the plate too, dotted: the exposure had ended.
          pen.stroke(col.mark, 0.62 - 0.12 * settle, 1, DASH.dot);
          g.beginPath();
          g.moveTo(end[0], end[1]);
          for (let i = 1; i <= 28; i++) {
            const p = descent(K.lerp(CHUTE, Math.min(t, DOWN), i / 28), end);
            g.lineTo(p[0], Math.min(p[1], y - CAPSULE_TOP));
          }
          g.stroke();
          g.setLineDash([]);
          // The canopy: it streams out, fills, and after the landing settles and fades.
          const lift = 44 * K.lerp(0.3, 1, open) * (1 - landed);
          if (lift > 1) {
            const w = 24 * open;
            const cx = x - sway * 0.5 + 10 * landed;
            const cy = y - CAPSULE_TOP - lift;
            g.beginPath();
            g.ellipse(cx, cy, w, w * 0.62, 0, Math.PI, K.TAU);
            g.closePath();
            pen.fill(col.stage, 1 - landed);
            g.fill();
            pen.stroke(col.bright, 1 - landed, 1.3);
            g.stroke();
            pen.stroke(col.bright, 0.55 * (1 - landed), 1);
            g.beginPath();
            g.ellipse(cx, cy, w * 0.42, w * 0.62, 0, Math.PI, K.TAU);
            g.stroke();
            for (const k of [-1, -0.42, 0, 0.42, 1]) pen.stroke(col.bright, (k === 0 ? 0.4 : 0.7) * (1 - landed), 1).line(cx + k * w, cy, x, y - CAPSULE_TOP);
          }
          // The capsule: a blunt cone, heat shield down. It grows out of the dot that ended the streak.
          const k = K.lerp(0.35, 1, open);
          g.beginPath();
          g.moveTo(x - 6.5 * k, y - CAPSULE_TOP * k);
          g.lineTo(x + 6.5 * k, y - CAPSULE_TOP * k);
          g.lineTo(x + 10.5 * k, y + 3 * k);
          g.lineTo(x - 10.5 * k, y + 3 * k);
          g.closePath();
          pen.fill(col.stage);
          g.fill();
          pen.stroke(K.blend(col.bright, col.live, landed), 1, 1.5);
          g.stroke();
          if (landed > 0) {
            pen.brackets(LANDING[0], LANDING[1] - 2.5, 17 + 9 * (1 - landed), col.live, landed, 5);
            for (let i = 0; i < 2; i++) {
              const beat = (live * 0.4 + i * 0.5) % 1;
              pen.stroke(col.live, (1 - beat) * 0.5 * landed, 1);
              g.beginPath();
              g.ellipse(LANDING[0], LANDING[1] + 3, 16 + beat * 44, 4 + beat * 10, 0, 0, K.TAU);
              g.stroke();
            }
          }
        }

        /* ---- The orbit ---- */
        pen.fill(col.stage, on).rect(ix, iy, iw, ih);
        g.fill();
        pen.plate(ix, iy, iw, ih, { title: 'Orbit, seen side-on', alpha: on });
        pen.fill(col.sheet2, on).dot(ex, ey, rE);
        pen.stroke(col.wire, on, 1).ring(ex, ey, rE);
        pen.stroke(col.line2, on, 1, DASH.dot).ring(ex, ey, rO);
        g.setLineDash([]);
        pen.stroke(col.ink, on, 1.2).vline(ex, ey + rE - 4 * bead, ey + rE + 3 * bead);
        const gone = K.tween(t, SEPARATE + 0.2, SEPARATE + 1.3);
        if (gone < 1) {
          // The spacecraft, and after separation the part of it that is not coming back.
          const a = lap(t);
          for (let k = 1; k < 9; k++) {
            const b = lap(t - k * 0.035);
            pen.fill(col.bright, on * (1 - gone) * (1 - k / 9) * 0.5).dot(ex + rO * Math.cos(b), ey + rO * Math.sin(b), 1.3 * bead);
          }
          pen.fill(K.blend(col.live, col.dim, K.tween(t, SEPARATE, SEPARATE + 0.3)), on * (1 - gone)).dot(ex + rO * Math.cos(a), ey + rO * Math.sin(a), 2.8 * bead);
        }
        if (t >= SEPARATE) {
          // The capsule comes in from the bottom of the orbit to the south of Australia.
          const fallIn = K.tween(t, SEPARATE, T_IN + 0.4, 'inOutSine');
          const a = K.lerp(Math.PI / 2, TOUCH, fallIn);
          const r = K.lerp(rO, rE, fallIn);
          pen.stroke(K.blend(col.live, col.mark, calm), 0.8, 1.2);
          g.beginPath();
          for (let i = 0; i <= 20; i++) {
            const v = (fallIn * i) / 20;
            const aa = K.lerp(Math.PI / 2, TOUCH, v);
            const rr = K.lerp(rO, rE, v);
            if (i) g.lineTo(ex + rr * Math.cos(aa), ey + rr * Math.sin(aa));
            else g.moveTo(ex + rr * Math.cos(aa), ey + rr * Math.sin(aa));
          }
          g.stroke();
          pen.fill(K.blend(col.live, col.bright, calm)).dot(ex + r * Math.cos(a), ey + r * Math.sin(a), 2.8);
        }
        pen.stroke(col.ink, on, 1.2).line(ex + (rE - 4 * bead) * Math.cos(TOUCH), ey + (rE - 4 * bead) * Math.sin(TOUCH), ex + (rE + 3 * bead) * Math.cos(TOUCH), ey + (rE + 3 * bead) * Math.sin(TOUCH));
        pen.cap(t < SEPARATE ? `Day ${Math.min(DAYS, Math.floor(DAYS * K.tween(t, 1, 6.2) + 1e-6))} of ${DAYS}` : 'Capsule separates', ix + 9, iy + 17, t < SEPARATE ? col.ink : K.blend(col.live, col.ink, calm), on);
        pen.cap('Antarctica', ix + 9, iy + ih - 9, col.faint, on);
        pen.cap('Australia', ix + iw - 9, iy + ih - 9, col.faint, on, 'right');

        /* ---- The mission as a row of days: launch at the left, re-entry at the right ---- */
        const lit = Math.floor(DAYS * K.tween(t, 1, 6.2) + 1e-6);
        for (let i = 0; i < DAYS; i++) {
          const x = FX + 18 + i * 8.6;
          const last = i === DAYS - 1;
          if (i < lit) pen.fill(last ? K.blend(col.live, col.bright, calm) : i === lit - 1 && t < ENTRY ? col.live : col.mark, on).dot(x, FY + 24, last ? 2.6 : 1.9);
          else pen.fill(col.wire, on).dot(x, FY + 24, 1.2);
        }
        pen.cap('Launch · 28 Nov 2025', FX + 14, FY + 43, col.muted, on);
        pen.cap('Re-entry · 30 Jan 2026', FX + 18 + (DAYS - 1) * 8.6 + 4, FY + 43, K.blend(K.blend(col.faint, col.live, K.tween(t, 6.2, 6.6)), col.ink, calm), on, 'right');
        pen.cap('One dot a day in orbit', FX + 18 + ((DAYS - 1) * 8.6) / 2, FY + 43, col.faint, on, 'center');
        g.restore();

        /* ---- Labels ---- */
        const mid = K.bezier(STREAK, 0.34);
        pen.label(mid[0], mid[1] + 5, mid[0] - 24, mid[1] + 86, ['Re-entry', 'about 30,000 km/h at the top'], { color: col.live, u: K.pulse(t, T_IN + 1.2, RECOVERY + 0.4, 0.5) });
        const late = K.bezier(STREAK, 0.9);
        const off = normal(0.9);
        pen.label(late[0] + off[0] * 8, late[1] + off[1] * 8, late[0] + 62, late[1] - 30, ['Equal steps of time', 'the marks close up as it slows'], { color: col.ink, u: K.pulse(t, T_IN + 3.4, RECOVERY + 0.4, 0.5) });
        pen.label(170, HORIZON - 2, 204, HORIZON - 54, ['Koonibba and Ceduna', 'where it was photographed'], { color: col.ink, u: K.pulse(t, 10.6, RECOVERY + 0.4, 0.5) });
        pen.label(LANDING[0] + 20, LANDING[1] - 22, LANDING[0] + 60, LANDING[1] - 68, ['W-5 capsule', 'down under a parachute'], { color: col.live, u: K.tween(t, DOWN + 0.2, DOWN + 1) });
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
