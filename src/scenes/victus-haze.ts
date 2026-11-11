/* Win 09 — Victus Haze
   A launch 16 hours and 42 minutes after the order; a satellite that finds, closes on
   and photographs the one just launched; then a second sortie in which the target runs
   during the approach and is run down.

   There is almost no footage of any of this, so this is the film that draws it. The
   clock in the rail is the first act. The chase is a small model (victus-haze.sim.ts):
   two satellites round the Earth, with every reported duration and no invented
   distance. When the story ends the viewer can make the target run again. */
import * as K from '../core/kit.ts';
import type { Pt } from '../core/kit.ts';
import { DASH, FONT, Halftone, Pen } from '../draw/pen.ts';
import type { SceneDef } from '../core/types.ts';
import * as S from './victus-haze.sim.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const { DUR, HUNT, ROUND_TWO, CENTRE, R_EARTH } = S;
const [CX, CY] = CENTRE;
const PITCH = 8;
const ORDER: Pt = [FX + 24, FY + 30];
/** Moments when Jackal photographs Puma from a new side: three in the first sortie, two at the end of the second. */
const FRAMES = [11, 11.55, 12.1, S.BACK + 0.7, S.BACK + 1.5];

const def: SceneDef<S.Era[]> = {
  id: 'victus-haze',
  duration: DUR,
  takeaway: 'Launch on a day’s notice is the first half. Catching a target that does not want to be caught is the half that matters.',
  alt: 'A schematic of the Earth seen from above with two satellites in low orbit. A clock runs to 16 hours 42 minutes beside a bar that stops well short of the previous record of 27 hours, and a rocket climbs from New Zealand to release a white satellite, Puma. A lime satellite, Jackal, leaves its lower orbit, closes on Puma and circles it. Jackal returns to its own orbit. In a second sortie it approaches again; Puma burns away, drawn here as a climb to a higher orbit, and fades from view, and Jackal follows a new path and closes on it once more.',
  acts: [
    { at: 0, label: 'The order' },
    { at: HUNT, label: 'The hunt' },
    { at: ROUND_TWO, label: 'Round two' },
  ],
  captions: [
    { at: 0, text: 'The Space Force sends Rocket Lab a notice to launch, into an orbit it did not know in advance.' },
    { at: 3.2, text: 'The record, set in 2023, was 27 hours. Electron lifts off from New Zealand at 16 hours 42 minutes.' },
    { at: HUNT, text: 'The satellite is Puma. True Anomaly has eyes on it within hours. Its Jackal, in orbit since May, gets 72 hours to close in and photograph it.' },
    { at: 10.7, text: 'Jackal circles its target and images it from several sides. Done in 61.' },
    { at: ROUND_TWO, text: 'Round two, July 14: a validated plan in under 30 minutes, then a 23-minute ingress and burn sequence to close in.' },
    { at: S.EVADE + 0.2, text: 'This time Puma fires its thrusters and slips out of view.' },
    { at: S.EVADE + S.LAG + 0.6, text: 'The ground replans. Fresh burns put Jackal back on its target.' },
    { at: S.BACK + 1, text: 'True Anomaly calls it the first pursuit of an evading target in orbit by any company.' },
  ],
  prepare: S.story,

  setup(ctx, told) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);
    // The Earth: a disc of dots, lit from one side.
    const globe = new Halftone(CX - R_EARTH, CY - R_EARTH, Math.ceil((R_EARTH * 2) / PITCH), Math.ceil((R_EARTH * 2) / PITCH), PITCH, { stagger: true });
    for (let i = 0; i < globe.n; i++) {
      const dx = globe.xs[i] - CX;
      const dy = globe.ys[i] - CY;
      const inside = Math.hypot(dx, dy) < R_EARTH - 3;
      const land = K.noise2(globe.xs[i] / 34, globe.ys[i] / 30, 8) > 0.05 ? 0.3 : 0;
      globe.tone[i] = inside ? K.clamp(0.2 + land + (dx - dy) / (R_EARTH * 3.4)) : 0;
    }

    const rail = ctx.rail();
    const phase = rail.phase('Mission', ['Notice to launch', 'First sortie', 'Second sortie']);
    const clock = rail.clock({ label: 'From the order to liftoff', unit: 'h : min' });
    const race = rail.chart({ label: 'Notice to launch', height: 56 });
    const pair = rail.pair();
    const sortie = pair.stat({ label: 'First sortie, hours', slots: 2, bar: true });
    const plan = pair.stat({ label: 'Round two: plan, min', prefix: 'under', slots: 2 });
    rail.note('Times are from the Space Force, Rocket Lab and True Anomaly. Orbits are schematic: no altitude or distance was released.');

    /* The viewer's turn: every press is another burn, and another chase. */
    let eras = told.slice();
    let lastLive = 0;
    const run = ctx.button('Make Puma run', () => {
      if (!S.settled(eras, lastLive)) return;
      const now = eras[eras.length - 1].r1;
      const next = S.R_CHOICES[(S.R_CHOICES.indexOf(now) + 1 + S.R_CHOICES.length) % S.R_CHOICES.length];
      eras = [...eras, S.evade(eras, lastLive, next === now ? S.R_CHOICES[0] : next)];
      ctx.player.refresh();
    });
    run.hidden = true;

    const satellite = (p: Pt, heading: number, color: string, alpha: number, hunter: boolean): void => {
      const g = pen.g;
      pen.fill(col.stage, 0.9 * Math.min(1, alpha * 2)).dot(p[0], p[1], 9);
      g.save();
      g.translate(p[0], p[1]);
      g.rotate(heading);
      g.beginPath();
      if (hunter) {
        g.moveTo(7, 0);
        g.lineTo(-5, 4.6);
        g.lineTo(-2.6, 0);
        g.lineTo(-5, -4.6);
      } else {
        g.moveTo(5.4, 0);
        g.lineTo(0, 5.4);
        g.lineTo(-5.4, 0);
        g.lineTo(0, -5.4);
      }
      g.closePath();
      pen.fill(hunter ? color : col.stage, alpha);
      g.fill();
      pen.stroke(color, alpha, 1.5);
      g.stroke();
      g.restore();
    };

    return {
      update(f) {
        const t = f.t;
        const s = f.live;
        lastLive = s;
        const g = pen.frame(f.view).g;
        if (t < DUR - 1e-3 && eras.length > told.length) eras = told.slice();
        run.hidden = !f.ended;
        const ready = S.settled(eras, s);
        K.toggle(run, 'is-waiting', f.ended && ready);
        run.disabled = !ready;
        const on = K.tween(t, 0, 0.9);
        const extra = eras.length > told.length;
        pen.plate(FX, FY, FW, FH, { title: 'Low Earth orbit, seen from above · orbits exaggerated · not to scale', right: 'Jun and Jul 2026' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ---- The Earth ---- */
        globe.draw(pen, [K.rgba(col.dim, 0.75)], { min: 0.04, max: 0.4, gamma: 1, alpha: on });
        pen.stroke(col.wire, on, 1).ring(CX, CY, R_EARTH);

        /* ---- The first act's clock: a dial on which once round is the old record ---- */
        const dial = on * (1 - K.tween(t, S.INSERT - 0.2, S.INSERT + 1));
        if (dial > 0) {
          const R = 174;
          const start = -Math.PI / 2;
          const hours = S.NOTICE_HOURS * K.seg(t, S.NOTICE + 0.9, S.LIFTOFF);
          const angle = (h: number): number => start + (h / S.RECORD_HOURS) * K.TAU;
          pen.stroke(col.line2, dial, 1).ring(CX, CY, R);
          for (let h = 0; h < S.RECORD_HOURS; h++) {
            const a = angle(h);
            const long = h % 3 === 0;
            pen.stroke(col.wire, dial, 1).line(CX + R * Math.cos(a), CY + R * Math.sin(a), CX + (R + (long ? 8 : 4)) * Math.cos(a), CY + (R + (long ? 8 : 4)) * Math.sin(a));
            if (long && h) pen.text(String(h), CX + (R + 19) * Math.cos(a), CY + (R + 19) * Math.sin(a) + 3.5, { font: 'mono', size: 9.5, color: col.faint, alpha: dial, align: 'center' });
          }
          if (hours > 0) {
            pen.stroke(hours >= S.NOTICE_HOURS ? col.live : col.bright, dial, 2.2);
            g.beginPath();
            g.arc(CX, CY, R, start, angle(hours));
            g.stroke();
            pen.fill(hours >= S.NOTICE_HOURS ? col.live : col.bright, dial).dot(CX + R * Math.cos(angle(hours)), CY + R * Math.sin(angle(hours)), 3.2);
          }
          pen.stroke(col.old, dial, 1.6).line(CX, CY - R - 12, CX, CY - R + 6);
          pen.cap('27 h · the record', CX + 8, CY - R - 6, col.old, dial);
          pen.cap('Hours since the order', CX - 8, CY - R - 6, col.faint, dial, 'right');
        }

        /* ---- Orbits ---- */
        pen.stroke(col.live, 0.3 * on, 1, DASH.dot).ring(CX, CY, S.R_JACKAL);
        const P = S.puma(eras, s);
        const seen = S.custody(eras, s);
        const dark = S.lastSeen(eras, s);
        if (P) {
          pen.stroke(col.mark, 0.4, 1, DASH.dot).ring(CX, CY, P.r);
          if (dark) pen.stroke(col.wire, 0.5, 1, DASH.dot).ring(CX, CY, dark.r);
        }
        g.setLineDash([]);

        /* ---- The order, the pad and the climb ---- */
        const sent = K.tween(t, S.NOTICE, S.NOTICE + 0.9);
        pen.stroke(col.mark, 0.5 * on * (1 - K.tween(t, HUNT, HUNT + 1)), 1, DASH.fine).line(ORDER[0] + 6, ORDER[1] + 10, S.SITE_POINT[0], S.SITE_POINT[1]);
        g.setLineDash([]);
        if (sent > 0 && sent < 1) pen.fill(col.ink).dot(K.lerp(ORDER[0] + 6, S.SITE_POINT[0], sent), K.lerp(ORDER[1] + 10, S.SITE_POINT[1], sent), 3);
        pen.fill(col.stage, on).dot(S.SITE_POINT[0], S.SITE_POINT[1], 5);
        pen.stroke(t >= S.NOTICE + 0.9 && t < S.LIFTOFF ? col.ink : col.mark, on, 1.4).ring(S.SITE_POINT[0], S.SITE_POINT[1], 4);
        if (t >= S.NOTICE + 0.9 && t < S.LIFTOFF) {
          // On the pad, counting.
          const beat = (s * 1.4) % 1;
          pen.stroke(col.ink, (1 - beat) * 0.7, 1).ring(S.SITE_POINT[0], S.SITE_POINT[1], 5 + beat * 14);
        }
        if (t >= S.LIFTOFF) {
          const fadeOut = 1 - K.tween(t, S.INSERT + 0.6, S.INSERT + 2.2);
          if (fadeOut > 0) {
            pen.stroke(col.bright, 0.8 * fadeOut, 1.3);
            g.beginPath();
            for (let x = S.LIFTOFF; x <= Math.min(t, S.INSERT) + 1e-6; x += 0.04) {
              const q = S.point(S.ascent(x));
              if (x === S.LIFTOFF) g.moveTo(q[0], q[1]);
              else g.lineTo(q[0], q[1]);
            }
            g.stroke();
            if (t < S.INSERT) {
              const q = S.point(S.ascent(t));
              pen.fill(col.bright, 0.3).dot(q[0], q[1], 7);
              pen.fill(col.bright).dot(q[0], q[1], 3);
            }
          }
        }

        /* ---- Jackal and Puma ---- */
        const J = S.jackal(eras, s);
        const J2 = S.jackal(eras, s + 0.06).p;
        // Where Jackal has just been: on station this draws the loop it flies round its target.
        for (let k = 1; k <= 22; k++) {
          const q = S.jackal(eras, s - k * 0.09).p;
          pen.fill(col.live, on * 0.5 * (1 - k / 22)).dot(q[0], q[1], 1.3);
        }
        if (dark && J.mode !== 'station') {
          const q = S.point(dark);
          pen.stroke(col.wire, 0.9, 1, DASH.fine).ring(q[0], q[1], 9);
          g.setLineDash([]);
        }
        // The plan: once Jackal has one, the path it is about to fly.
        const e = eras[eras.length - 1];
        const drafted = K.seg(t, S.PLANNED, S.INGRESS);
        if (drafted > 0 && t < S.EVADE) {
          // Round two's approach, as planned: it aims at where Puma will be if Puma does nothing.
          pen.stroke(col.live, 0.75, 1.1, DASH.fine);
          g.beginPath();
          const from = Math.max(t, S.INGRESS);
          const to = K.lerp(S.INGRESS, S.INGRESS_END, drafted);
          for (let x = from; x <= to + 1e-6; x += 0.05) {
            const q = S.jackal(told.slice(0, 1), x).p;
            if (x === from) g.moveTo(q[0], q[1]);
            else g.lineTo(q[0], q[1]);
          }
          g.stroke();
          g.setLineDash([]);
        }
        if (eras.length > 1 && s >= e.at) {
          const planned = K.seg(s, e.at + 0.9, e.at + S.LAG);
          const flown = K.seg(s, e.at + S.LAG, e.at + S.LAG + S.CHASE);
          if (planned > 0 && flown < 1) {
            pen.stroke(col.live, 0.75, 1.1, DASH.fine);
            g.beginPath();
            const from = Math.max(s, e.at + S.LAG);
            const to = e.at + S.LAG + S.CHASE * (flown > 0 ? 1 : planned);
            for (let x = from; x <= to + 1e-6; x += 0.05) {
              const q = S.jackal(eras, x).p;
              if (x === from) g.moveTo(q[0], q[1]);
              else g.lineTo(q[0], q[1]);
            }
            g.stroke();
            g.setLineDash([]);
          }
        }
        if (P) {
          const p = S.point(P);
          const p2 = S.point(S.puma(eras, s + 0.06)!);
          const born = K.tween(s, S.INSERT, S.INSERT + 0.5);
          // In view, Puma is tied to its hunter by a sight line. Out of view it is only where it is.
          if (seen && J.mode !== 'station') {
            pen.stroke(col.live, 0.55, 1, DASH.fine).line(J.p[0], J.p[1], p[0], p[1]);
            g.setLineDash([]);
          }
          const burning = eras.length > 1 && s >= e.at && s < e.at + S.BURN;
          if (burning) {
            const back = Math.atan2(p[1] - p2[1], p[0] - p2[0]) + (e.r1 > e.r0 ? -0.5 : 0.5);
            pen.fill(col.bright, 0.35).dot(p[0] + Math.cos(back) * 9, p[1] + Math.sin(back) * 9, 6);
            pen.fill(col.bright).dot(p[0] + Math.cos(back) * 8, p[1] + Math.sin(back) * 8, 2.6);
          }
          const shown = seen ? 1 : K.lerp(1, 0.32, K.tween(s, e.at + 0.15, e.at + 0.8));
          satellite(p, Math.atan2(p2[1] - p[1], p2[0] - p[0]), col.bright, born * shown, false);
          for (const at of FRAMES) {
            const snap = K.pulse(t, at, at + 0.45, 0.12);
            if (snap > 0) {
              pen.stroke(col.live, snap, 1.2).line(J.p[0], J.p[1], p[0], p[1]);
              pen.brackets(p[0], p[1], 12, col.live, snap, 4);
            }
          }
          if (J.mode === 'station' && eras.length > 1) pen.brackets(p[0], p[1], 12 + 8 * (1 - K.tween(s, e.at + S.LAG + S.CHASE, e.at + S.LAG + S.CHASE + 0.5, 'out')), col.live, K.pulse(s, e.at + S.LAG + S.CHASE, e.at + S.LAG + S.CHASE + 2.4, 0.4), 4);
        }
        satellite(J.p, Math.atan2(J2[1] - J.p[1], J2[0] - J.p[0]), col.live, on, true);
        g.restore();

        /* ---- Labels ---- */
        /** A label beside a moving mark, placed on whichever side has room. */
        const tie = (p: Pt, lines: string[], color: string, u: number): void => {
          if (u <= 0) return;
          const left = p[0] > FX + FW - 250;
          const up = p[1] > CY + 40;
          pen.label(p[0] + (left ? -9 : 9), p[1] + (up ? -7 : 7), p[0] + (left ? -46 : 46), p[1] + (up ? -42 : 44), lines, { color, u, align: left ? 'right' : 'left' });
        };
        pen.cap('US Space Force', ORDER[0], ORDER[1], col.ink, on * (1 - K.tween(t, HUNT, HUNT + 1)));
        pen.text('notice to launch', ORDER[0], ORDER[1] + 14, { size: 10.5, color: col.muted, alpha: on * (1 - K.tween(t, HUNT, HUNT + 1)) });
        pen.label(S.SITE_POINT[0] - 5, S.SITE_POINT[1] + 4, S.SITE_POINT[0] - 62, S.SITE_POINT[1] + 74, t >= S.LIFTOFF ? ['Liftoff', '16 h 42 min after the order'] : ['Mahia, New Zealand', 'Rocket Lab Launch Complex 1'], { color: t >= S.LIFTOFF ? col.live : col.ink, u: K.pulse(t, 1.4, HUNT + 1.4, 0.5), align: 'right' });
        // The two satellites never hold still, so their names sit in the corner rather than chase them.
        const kx = FX + FW - 18;
        const ky = FY + FH - 40;
        const named = K.tween(t, 1.2, 2);
        satellite([kx - 212, ky - 3.5], 0, col.live, named, true);
        pen.cap('Jackal', kx - 198, ky, col.live, named);
        pen.text('True Anomaly · in orbit since May', kx, ky, { size: 10.5, color: col.muted, alpha: named, align: 'right' });
        const met = K.tween(t, S.INSERT, S.INSERT + 0.6);
        satellite([kx - 212, ky + 14.5], 0, col.bright, met, false);
        pen.cap('Puma', kx - 198, ky + 18, col.ink, met);
        pen.text('Rocket Lab · the target', kx, ky + 18, { size: 10.5, color: col.muted, alpha: met, align: 'right' });
        if (P) {
          const p = S.point(P);
          tie(p, ['Sortie complete in 61 hours', '72 were allowed'], col.live, K.pulse(t, S.DONE, S.HOME, 0.4));
          tie(p, ['Puma burns', 'and slips out of view'], col.ink, K.pulse(t, S.EVADE + 0.1, S.EVADE + 2.2, 0.3));
          if (!extra) tie(p, ['Back in view', 'Jackal images it again'], col.live, K.tween(t, S.BACK + 0.1, S.BACK + 0.9));
        }
        /* The second sortie as a short log in the corner: what happened, in the order it is reported. */
        const e0 = e.at;
        const chased: Array<[number, string, string]> = [
          [e0 + 0.45, 'Puma maneuvers · out of view', col.ink],
          [e0 + S.LAG - 0.6, 'New plan from the ground', col.live],
          [e0 + S.LAG + S.CHASE * 0.8, 'Back in view', col.live],
        ];
        const log: Array<[number, string, string]> = extra
          ? chased
          : [[S.TASKED_AGAIN + 0.2, 'Tasked again · July 14', col.ink], [S.PLANNED, 'Plan validated · under 30 minutes', col.live], [S.INGRESS, 'Ingress and burns · 23 minutes', col.live], ...chased];
        if (s >= log[0][0]) {
          const shown = 1 - K.tween(s, e0 + S.LAG + S.CHASE + 3.2, e0 + S.LAG + S.CHASE + 4.2);
          log.forEach(([at, text, color], i) => {
            const a = K.tween(s, at, at + 0.3) * (extra ? shown : 1);
            const done = i < log.length - 1 && s >= log[i + 1][0];
            pen.cap(text, FX + FW - 18, FY + 30 + i * 16, done ? col.faint : color, a, 'right');
          });
        }

        /* ---- Instruments ---- */
        phase.set(K.tween(t, HUNT, HUNT + 0.7) + K.tween(t, ROUND_TWO, ROUND_TWO + 0.7));
        const counted = K.seg(t, S.NOTICE + 0.9, S.LIFTOFF);
        clock.set(S.NOTICE_HOURS * counted);
        const hunted = K.seg(t, S.TASKED, S.DONE);
        sortie.set(S.SORTIE_HOURS * hunted);
        sortie.bar((S.SORTIE_HOURS * hunted) / S.SORTIE_LIMIT);
        sortie.alpha(0.35 + 0.65 * K.tween(t, S.TASKED - 0.3, S.TASKED + 0.2));
        plan.set(S.PLAN_MIN * K.tween(t, S.PLANNED, S.PLANNED + 0.9, 'out'));
        plan.alpha(0.35 + 0.65 * K.tween(t, S.PLANNED - 0.1, S.PLANNED + 0.3));

        /* The record and the new time, on one scale of hours. */
        race.clear();
        const cg = race.g;
        const w = race.w;
        const px = (h: number): number => (h / S.RECORD_HOURS) * w;
        const bar = (y: number, name: string, hours: number, color: string, text: string): void => {
          cg.font = FONT.label;
          cg.textBaseline = 'alphabetic';
          cg.textAlign = 'left';
          cg.fillStyle = color;
          cg.fillText(name, 0, y - 5);
          cg.fillStyle = col.line2;
          cg.fillRect(0, y, w, 7);
          cg.fillStyle = color;
          cg.fillRect(0, y, px(hours), 7);
          cg.textAlign = 'right';
          cg.fillText(text, w, y - 5);
        };
        bar(13, 'VICTUS NOX · 2023', S.RECORD_HOURS * K.tween(t, 0.3, 1.1), col.old, '27 H');
        bar(42, 'VICTUS HAZE · 2026', S.NOTICE_HOURS * counted, counted >= 1 ? col.live : col.bright, counted >= 1 ? '16 H 42 MIN' : '');
      },
    };
  },
};
export default def;
