/* Win 03 — Valar Atomics, Ward 250
   A reactor goes up the ramp of a C-17, flies from California to Utah, and goes
   critical 123 days later.

   Three pictures in one plate: a cutaway of the loading, a map of the flight, and a
   calendar in which every dot is a day. The dates and distances are reported; the
   aircraft, the module and the straight-line route are schematic. */
import * as K from '../core/kit.ts';
import type { Pt } from '../core/kit.ts';
import { DASH, Pen } from '../draw/pen.ts';
import * as C from '../draw/craft.ts';
import type { SceneDef } from '../core/types.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const DUR = 21;
const FLY = 7;
const ON = 14;
export const MILES = 700;
export const HOURS = 2;
export const MODULES = 8;
/** Days from the flight (15 Feb 2026) to the criticality announcement (18 Jun) and to the deadline (4 Jul). */
export const DAY_CRITICAL = 123;
export const DAY_DEADLINE = 139;

/* ---- The cutaway ---- */
const CS = 690;
const CX = 488;
const GROUND = 398;
const CY = GROUND - 0.098 * CS;
const at = (x: number, y: number): Pt => [CX + x * CS, CY + y * CS];
const FLOOR = CY + C.C17_HOLD.floor * CS;
/* The module comes to rest clear of both engine outlines, which hang in front of the hold. */
const WAY: Pt[] = [[104, GROUND], [at(...C.C17_RAMP[1])[0], GROUND], at(...C.C17_RAMP[0]), [at(-0.215, 0)[0], FLOOR], [at(0.16, 0)[0], FLOOR]];
const LEGS = WAY.slice(1).map((p, i) => K.dist(WAY[i][0], WAY[i][1], p[0], p[1]));
const WAY_LEN = LEGS.reduce((a, b) => a + b, 0);
/** A point a fraction `u` of the way along the loading path, by distance. */
const onWay = (u: number): Pt => {
  let d = K.clamp(u) * WAY_LEN;
  for (let i = 0; i < LEGS.length; i++) {
    if (d <= LEGS[i] || i === LEGS.length - 1) return [K.lerp(WAY[i][0], WAY[i + 1][0], d / LEGS[i]), K.lerp(WAY[i][1], WAY[i + 1][1], d / LEGS[i])];
    d -= LEGS[i];
  }
  return WAY[WAY.length - 1];
};
const MODULE_W = 64;
const MODULE_H = 24;
/* The hull with its cargo door open: the same outline, begun at the ramp hinge and
   stopped at the sill of the opening, so the module does not pass through a wall. */
const SILL: Pt = [-0.36, K.lerp(-0.03, 0.058, (0.495 - 0.36) / (0.495 - 0.24))];
const HULL_OPEN: C.Craft = [{ pts: [...C.C17[0].pts.slice(11), ...C.C17[0].pts.slice(0, 11), SILL], open: true }];
const HINGE = at(...C.C17_RAMP[0]);
const RAMP_DOWN = { a: Math.atan2(WAY[1][1] - HINGE[1], WAY[1][0] - HINGE[0]), len: K.dist(HINGE[0], HINGE[1], WAY[1][0], WAY[1][1]) };
const RAMP_SHUT = { a: Math.atan2(at(...SILL)[1] - HINGE[1], at(...SILL)[0] - HINGE[0]) + K.TAU, len: K.dist(HINGE[0], HINGE[1], ...at(...SILL)) };

/* ---- The map: a plain projection of the south-western states ---- */
const geo = (lon: number, lat: number): Pt => [FX + (lon + 124.6) * 36.8, FY + (42.4 - lat) * 47];
const line = (pts: Array<[number, number]>): Pt[] => pts.map(([lon, lat]) => geo(lon, lat));
const COAST = line([[-124.45, 42.5], [-124.2, 42], [-124.1, 41.2], [-124.4, 40.4], [-123.8, 39.8], [-123.7, 38.9], [-123, 38.3], [-122.5, 37.8], [-122.4, 37.2], [-121.9, 36.6], [-121.3, 35.7], [-120.6, 35.2], [-120.5, 34.5], [-119.3, 34.3], [-118.5, 34], [-118.4, 33.75], [-117.9, 33.6], [-117.3, 33], [-117.1, 32.55]]);
const BORDERS = [
  line([[-124.2, 42], [-111.05, 42], [-111.05, 41], [-109.05, 41], [-109.05, 31.3]]),
  line([[-120, 42], [-120, 39], [-114.63, 35]]),
  line([[-114.05, 42], [-114.05, 36.2], [-114.75, 36.1], [-114.63, 35], [-114.15, 34.3], [-114.5, 33], [-114.72, 32.72], [-117.1, 32.55]]),
  line([[-114.05, 37], [-109.05, 37]]),
  line([[-117.03, 42], [-117.03, 42.5]]),
  line([[-111.05, 42], [-111.05, 42.5]]),
];
const STATES: Array<[string, number, number]> = [['California', -121.4, 39.6], ['Nevada', -117.4, 40.3], ['Utah', -110.35, 38.2], ['Arizona', -112.4, 34.4]];
const MARCH = geo(-117.26, 33.88);
const HILL = geo(-111.97, 41.12);
const LAB = geo(-111.05, 39.23);
const HEADING = Math.atan2(HILL[1] - MARCH[1], HILL[0] - MARCH[0]);
/** While the flight is the subject the map sits this far right, so the route is in the middle of the plate. */
const PAN = 96;

/* ---- The calendar ---- */
const CAL_X = 652;
const CAL_Y = 262;
const CAL_COLS = 21;
const CAL_STEP = 10.2;

const def: SceneDef = {
  id: 'ward-250',
  duration: DUR,
  takeaway: 'A reactor used to be something you built where it stood. This one flew in and went critical in four months.',
  alt: 'A cutaway of a C-17 cargo aircraft with a reactor module moving up its ramp, beside the outline of a minivan for scale. Then a map of the route from March Air Reserve Base in California to Hill Air Force Base in Utah, crossed by three aircraft while a clock counts two hours. Then a calendar of dots counts 123 days from the flight to the reactor reaching criticality in Utah, sixteen days before a July 4 deadline set for three reactors.',
  acts: [
    { at: 0, label: 'Load' },
    { at: FLY, label: 'Fly' },
    { at: ON, label: 'Switch on' },
  ],
  captions: [
    { at: 0, text: 'March Air Reserve Base, California. A nuclear reactor the size of a minivan goes up the ramp of a C-17.' },
    { at: 3.8, text: 'It travels as eight modules in three aircraft, with no fuel on board.' },
    { at: FLY, text: 'Operation Windlord: nearly 700 miles to Hill Air Force Base, Utah, in about two hours.' },
    { at: 11, text: 'The Energy Secretary rides along. A critic calls it a dog-and-pony show.' },
    { at: ON, text: 'From Hill it goes to a state lab outside Orangeville. The fuel is loaded later.' },
    { at: 17.2, text: 'On June 18 the Energy Department says it has gone critical: the second of three reactors the White House wanted by July 4.' },
  ],

  setup(ctx) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);

    const rail = ctx.rail();
    const phase = rail.phase('Step', ['Load', 'Fly', 'Switch on']);
    // The instruments run top to bottom in the order the story uses them.
    const modules = rail.dots({ label: 'Reactor modules loaded', count: MODULES });
    const pair = rail.pair();
    const miles = pair.stat({ label: 'Miles flown, nearly', slots: 3, bar: true });
    const clock = pair.clock({ label: 'Hours in the air, about' });
    const days = rail.stat({ label: 'Days from the flight to critical', slots: 3, size: 'm', bar: true });
    rail.note('The reactor flew without fuel. Aircraft and module are schematic, and the route is a straight line, not the track flown.');

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        // The ground and the module are there from the first frame; the aircraft eases in around them.
        const stay = 1 - K.tween(t, FLY - 0.1, FLY + 0.4);
        const cut = K.tween(t, 0.1, 0.9) * stay;
        const map = K.tween(t, FLY + 0.25, FLY + 1, 'out');
        const loaded = K.tween(t, 1.3, 5.6, 'inOutSine');
        const shut = K.tween(t, 5.9, 6.7);
        const flown = K.tween(t, FLY + 1.3, 12.7, 'inOutSine');
        const landed = K.tween(t, 12.7, 13.6, 'out');
        const pan = PAN * (1 - K.tween(t, ON, ON + 1));
        const past = K.tween(t, ON + 0.1, ON + 1);
        const moved = K.tween(t, ON + 0.2, ON + 1.5);
        const counted = K.tween(t, ON + 1.5, 18.4, 'inOutSine');
        const day = Math.floor(DAY_CRITICAL * counted + 1e-6);
        const critical = K.tween(t, 18.4, 19.1, 'out');
        const flash = K.tween(t, 18.4, 19.7, 'out');

        pen.plate(FX, FY, FW, FH, {
          title: t < FLY + 0.3 ? 'Loading at March Air Reserve Base · cutaway · schematic' : 'California to Utah · the route is drawn straight · schematic',
          right: t < ON ? '15 Feb 2026' : '15 Feb to 18 Jun 2026',
        });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ================= 1. The cutaway ================= */
        if (stay > 0) {
          g.globalAlpha = stay;
          pen.stroke(col.wire, 1, 1).hline(FX + 16, FX + FW - 16, GROUND);
          pen.hatch(FX + 16, GROUND + 1, FW - 32, 7, col.wire, 0.5, 6);
          g.globalAlpha = cut;
          // A minivan, where the module starts, for scale.
          C.draw(pen, C.MINIVAN, WAY[0][0], GROUND, { size: MODULE_W, color: col.old, dash: DASH.fine, fill: null, width: 1.1 });
          C.rounds(pen, C.MINIVAN_WHEELS, WAY[0][0], GROUND, { size: MODULE_W, color: col.old, width: 1 });
          // The aircraft with its cargo door open, and the hold behind its skin.
          C.draw(pen, HULL_OPEN, CX, CY, { size: CS, color: col.bright, width: 1.3 });
          C.draw(pen, [C.C17[1], C.C17[2], C.C17[5]], CX, CY, { size: CS, color: col.bright, width: 1.3 });
          const h0 = at(C.C17_HOLD.x0, C.C17_HOLD.ceiling);
          const h1 = at(C.C17_HOLD.x1, C.C17_HOLD.floor);
          pen.stroke(col.dim, 0.9, 1, DASH.fine).box(h0[0], h0[1], h1[0] - h0[0], h1[1] - h0[1]);
          g.setLineDash([]);
          // The engines hang from the near wing, in front of the hold, so they hide its outline; the outer one hides the inner.
          for (const part of [C.C17[3], C.C17[4]]) {
            g.beginPath();
            part.pts.forEach((q, i) => {
              const s = at(q[0], q[1]);
              if (i) g.lineTo(s[0], s[1]);
              else g.moveTo(s[0], s[1]);
            });
            g.closePath();
            pen.stroke(col.stage, 1, 7);
            g.stroke();
            pen.fill(col.stage);
            g.fill();
            pen.stroke(col.bright, 0.6, 1);
            g.stroke();
          }
          C.rounds(pen, C.C17_WHEELS, CX, CY, { size: CS, color: col.bright });
          // The ramp: down for the loading, then raised to close the opening before the flight.
          const ra = K.lerp(RAMP_DOWN.a, RAMP_SHUT.a, shut);
          const rl = K.lerp(RAMP_DOWN.len, RAMP_SHUT.len, shut);
          pen.stroke(col.bright, 1, K.lerp(1.5, 1.3, shut)).line(HINGE[0], HINGE[1], HINGE[0] + Math.cos(ra) * rl, HINGE[1] + Math.sin(ra) * rl);
          // The module on its way in.
          g.globalAlpha = stay;
          const p = onWay(loaded);
          const q = onWay(loaded + 0.012);
          const tilt = loaded >= 0.988 ? 0 : Math.atan2(q[1] - p[1], q[0] - p[0]);
          g.save();
          g.translate(p[0], p[1]);
          g.rotate(tilt);
          pen.fill(col.stage).rect(-MODULE_W / 2, -MODULE_H - 3, MODULE_W, MODULE_H);
          g.fill();
          pen.hatch(-MODULE_W / 2, -MODULE_H - 3, MODULE_W, MODULE_H, col.live, 0.4, 5);
          pen.stroke(col.live, 1, 1.5).rect(-MODULE_W / 2, -MODULE_H - 3, MODULE_W, MODULE_H);
          g.stroke();
          pen.stroke(col.live, 1, 1.3).line(-MODULE_W / 2 - 4, -1.5, MODULE_W / 2 + 4, -1.5);
          g.restore();
          g.globalAlpha = 1;
          // Two labels above the aircraft, two below the ground line. The reactor's travels with it, clear of the airframe.
          pen.label(p[0] + 3 * Math.sin(tilt), p[1] - 3 * Math.cos(tilt), p[0] + 22, GROUND + 38, ['Ward 250 reactor', 'no fuel on board'], { color: col.live, u: stay * K.tween(t, 0.9, 1.6) });
          pen.label(WAY[0][0] - 8, GROUND - MODULE_H * 0.86, WAY[0][0] + 6, GROUND - 62, ['A minivan', 'for scale'], { color: col.old, u: cut * K.tween(t, 2.2, 3) });
          pen.label(at(0.42, -0.05)[0], at(0.42, -0.055)[1], at(0.3, 0)[0], at(0, -0.2)[1], ['C-17 Globemaster III', 'one of three on the mission'], { color: col.ink, u: cut * K.tween(t, 0.6, 1.4), align: 'right' });
          pen.label(at(-0.2, 0)[0], h0[1] + 6, at(-0.17, 0)[0], at(0, -0.2)[1], ['Cargo hold'], { color: col.mark, u: cut * K.tween(t, 3.4, 4.2) });
        }

        /* ================= 2. The map ================= */
        if (map > 0) {
          const sh = (q: Pt): Pt => [q[0] + pan, q[1]];
          const march = sh(MARCH);
          const hill = sh(HILL);
          const lab = sh(LAB);
          // Degree ticks on the frame, like the neatline of a chart. They slide with the map.
          pen.stroke(col.wire, 0.6 * map, 1);
          for (let lon = -128; lon <= -100; lon++) {
            const x = geo(lon, 0)[0] + pan;
            if (x < FX + 9 || x > FX + FW - 9) continue;
            const l = lon % 5 === 0 ? 7 : 4;
            pen.vline(x, FY, FY + l);
            pen.vline(x, FY + FH - l, FY + FH);
          }
          for (let lat = 34; lat <= 42; lat++) {
            const y = geo(0, lat)[1];
            const l = lat % 5 === 0 ? 7 : 4;
            pen.hline(FX, FX + l, y);
            pen.hline(FX + FW - l, FX + FW, y);
          }
          // The coast and the state lines draw themselves on.
          g.globalAlpha = map;
          BORDERS.forEach((b, i) => pen.stroke(col.line2, 1, 1).poly(b.map(sh), false, K.tween(t, FLY + 0.25 + i * 0.04, FLY + 1.2 + i * 0.04, 'out')));
          pen.stroke(col.wire, 1, 1.2).poly(COAST.map(sh), false, K.tween(t, FLY + 0.25, FLY + 1.2, 'out'));
          g.globalAlpha = 1;
          for (const [name, lon, lat] of STATES) pen.cap(name, ...sh(geo(lon, lat)), col.faint, map, 'center');
          pen.cap('Pacific', ...sh(geo(-123.2, 35)), col.faint, map * 0.8, 'center');

          // The flight. Once it is over it steps back, so the lab and the calendar lead.
          const route = map * (1 - 0.5 * past);
          pen.stroke(col.wire, map, 1, DASH.dot).line(march[0], march[1], hill[0], hill[1]);
          g.setLineDash([]);
          const tip: Pt = [K.lerp(march[0], hill[0], flown), K.lerp(march[1], hill[1], flown)];
          if (flown > 0) pen.stroke(col.bright, route, 1.6).line(march[0], march[1], tip[0], tip[1]);
          if (landed > 0 && landed < 1) pen.stroke(col.ink, (1 - landed) * 0.8, 1).ring(hill[0], hill[1], 6 + landed * 22);
          for (let k = 2; k >= 0; k--) {
            const u = K.clamp(flown * 1.16 - k * 0.08);
            if (u <= 0) continue;
            C.draw(pen, C.AIRLIFTER, K.lerp(march[0], hill[0], u), K.lerp(march[1], hill[1], u), { size: 27, angle: HEADING, color: col.bright, alpha: route, width: 1.1 });
          }
          pen.fill(col.stage, map).dot(march[0], march[1], 6);
          pen.stroke(col.ink, map, 1.3).ring(march[0], march[1], 4.5);
          pen.fill(col.stage, map).dot(hill[0], hill[1], 6);
          pen.stroke(col.ink, map, 1.3).ring(hill[0], hill[1], 4.5);
          if (flown >= 1) pen.fill(col.ink, map).dot(hill[0], hill[1], 2);
          pen.label(march[0] - 4, march[1] - 4, march[0] - 34, march[1] - 50, ['March Air Reserve Base', 'Riverside County, California'], { color: col.ink, u: map, align: 'right' });
          // Hill's label sits east of the state line, on open ground, so its backing does not cut the corner of Wyoming into a box.
          pen.label(hill[0] + 4, hill[1] - 3, hill[0] + 116, hill[1] - 22, ['Hill Air Force Base', 'Utah'], { color: col.ink, u: map * K.tween(t, FLY + 1.6, FLY + 2.4) });

          /* ================= 3. The lab, and the calendar ================= */
          if (moved > 0) {
            pen.stroke(col.mark, 0.9, 1.2, DASH.dash).line(hill[0], hill[1], K.lerp(hill[0], lab[0], moved), K.lerp(hill[1], lab[1], moved));
            g.setLineDash([]);
          }
          const found = K.tween(t, ON + 1.3, ON + 1.7, 'out');
          const hot = critical > 0 ? K.blend(col.ink, col.live, critical) : col.ink;
          if (found > 0) {
            if (flash > 0 && flash < 1) pen.stroke(col.live, (1 - flash) * 0.9, 1.3).ring(lab[0], lab[1], 9 + flash * 44);
            if (critical > 0) {
              for (let k = 0; k < 2; k++) {
                const u = (live * 0.45 + k * 0.5) % 1;
                pen.stroke(col.live, (1 - u) * 0.6 * critical, 1).ring(lab[0], lab[1], 8 + u * 30);
              }
            }
            pen.fill(col.stage, found).dot(lab[0], lab[1], 9);
            pen.brackets(lab[0], lab[1], K.lerp(15, 9, found), hot, found, 4);
            pen.fill(hot, found).dot(lab[0], lab[1], 2.6);
          }
          pen.label(lab[0] + 9, lab[1] - 7, lab[0] + 62, lab[1] - 22, critical > 0 ? ['Critical', 'Utah San Rafael Energy Lab'] : ['Utah San Rafael Energy Lab', 'outside Orangeville'], { color: hot, u: K.tween(t, ON + 1, ON + 1.9) });

          const cal = K.tween(t, ON + 0.9, ON + 1.6);
          if (cal > 0) {
            const rows = Math.ceil(DAY_DEADLINE / CAL_COLS);
            const spot = (i: number): Pt => [CAL_X + (i % CAL_COLS) * CAL_STEP + CAL_STEP / 2, CAL_Y + Math.floor(i / CAL_COLS) * CAL_STEP + CAL_STEP / 2];
            pen.cap('One dot a day, from the flight', CAL_X, CAL_Y - 14, col.muted, cal);
            for (let i = 0; i < DAY_DEADLINE; i++) {
              const [x, y] = spot(i);
              const n = i + 1;
              // The rows arrive one after another.
              const a = K.stagger(t, ON + 0.9, ON + 1.6, Math.floor(i / CAL_COLS), rows);
              if (n <= day) pen.fill(n === DAY_CRITICAL || n === day ? col.live : col.mark, a).dot(x, y, n === DAY_CRITICAL ? K.lerp(2.3, 3.2, critical) : 2.3);
              else if (n === DAY_DEADLINE) pen.stroke(col.muted, a, 1).ring(x, y, 2.5);
              else if (n > DAY_CRITICAL) pen.stroke(col.wire, a, 1).ring(x, y, 1.9);
              else pen.fill(col.line2, a).dot(x, y, 1.4);
            }
            if (critical > 0) {
              // The day it happened keeps time with the lab.
              const [x, y] = spot(DAY_CRITICAL - 1);
              const u = (live * 0.45) % 1;
              pen.stroke(col.live, (1 - u) * 0.55 * critical, 1).ring(x, y, 4 + u * 5);
            }
            // A tick ties the last ring to the word for it.
            const [dx, dy] = spot(DAY_DEADLINE - 1);
            pen.stroke(col.wire, cal, 1).vline(dx, dy + 5, dy + 11);
            pen.cap(critical > 0 ? `Day ${DAY_CRITICAL} · critical` : `Day ${day}`, CAL_X, CAL_Y + rows * CAL_STEP + 16, critical > 0 ? col.live : col.ink, cal);
            pen.cap(`Deadline · day ${DAY_DEADLINE}`, CAL_X + CAL_COLS * CAL_STEP, CAL_Y + rows * CAL_STEP + 16, col.faint, cal, 'right');
            pen.text('16 days before the deadline', CAL_X, CAL_Y + rows * CAL_STEP + 31, { size: 10.5, color: col.muted, alpha: cal * critical });
          }
        }
        g.restore();

        /* ================= Instruments ================= */
        phase.set(K.tween(t, FLY, FLY + 0.7) + K.tween(t, ON, ON + 0.7));
        miles.set(MILES * flown);
        miles.bar(flown);
        clock.set(HOURS * flown);
        for (let i = 0; i < MODULES; i++) {
          const u = K.seg(t, 1.6 + i * 0.5, 2.0 + i * 0.5);
          modules.set(i, u >= 1 ? 1 : u > 0 ? 6 : 0);
        }
        modules.legend(t < 1.6 ? 'eight modules, three aircraft' : t < 5.6 ? 'loading' : '8 modules · 3 aircraft · no fuel on board');
        days.set(DAY_CRITICAL * counted);
        days.bar((DAY_CRITICAL * counted) / DAY_DEADLINE);
        // An instrument waits, dimmed, until its part of the story begins.
        const flying = K.lerp(0.5, 1, K.tween(t, FLY + 0.6, FLY + 1.3));
        miles.alpha(flying);
        clock.el.style.opacity = String(flying);
        days.alpha(K.lerp(0.5, 1, K.tween(t, ON + 0.9, ON + 1.5)));
      },
    };
  },
};
export default def;
