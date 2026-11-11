/* Win 08 — Saronic Marauder
   A crewless ship goes from a keel to the water in nine months, the second hull
   follows with fewer labor hours, and the yard is sized for twenty a year.

   Three bands in one plate: the hull on the slip, a calendar under it, and a row of
   twenty small hulls that is the yard's stated yearly capacity. The dates, the specs
   and the labor figure are Saronic's; the hull form is schematic. */
import * as K from '../core/kit.ts';
import type { Pt } from '../core/kit.ts';
import { DASH, FONT, Halftone, Pen } from '../draw/pen.ts';
import * as C from '../draw/craft.ts';
import type { SceneDef } from '../core/types.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const DUR = 21;
const HULL = 6.5;
const WET = 9.9;
const REPEAT = 13.5;
/** Reported at launch. */
export const LENGTH_FT = 180;
export const MONTHS = 9;
export const SAVED = 8;
export const PER_YEAR = 20;

/* ---- The hull on the slip ---- */
const SIZE = 560;
const SX = FX + FW / 2;
const KEEL_Y = 224;
const SY = KEEL_Y - 0.05 * SIZE;
const WATER_Y = SY + 0.012 * SIZE;
const X0 = SX - SIZE / 2;
const at = (x: number, y: number): Pt => [SX + x * SIZE, SY + y * SIZE];
const PITCH = 7;

/* ---- The calendar: months from 1 Aug 2025 ---- */
const CAL_Y = 306;
const CAL_X = 86;
const MONTH_W = 50.4;
const month = (m: number): number => CAL_X + m * MONTH_W;
const KEEL_AT = 0.7; // 22 Aug 2025
const WATER_AT = 9.9; // 29 May 2026
const FLIP_AT = 7.5; // hull two turned over, March 2026
const SECOND_AT = 15.1; // 3 Nov 2026
const TICKS: Array<[number, string]> = [[0, 'Aug 2025'], [3, 'Nov'], [6, 'Feb 2026'], [9, 'May'], [12, 'Aug'], [15, 'Nov']];
const clock = K.keys([[0.8, KEEL_AT], [WET, WATER_AT, 'linear'], [REPEAT + 0.4, 10.4, 'linear'], [16.4, SECOND_AT, 'inOutSine']]);

/* ---- The yard's year ---- */
const ROW_Y = 388;
const ROW_GAP = 34;
const SLOT = 80;
const PER_ROW = PER_YEAR / 2;
const ROW_X = FX + (FW - (PER_ROW - 1) * SLOT) / 2;
const SMALL = 62;

const def: SceneDef = {
  id: 'marauder',
  duration: DUR,
  takeaway: 'The first ship proves the design. The second proves the yard.',
  alt: 'A side view of a ship on a building slip. Its keel is laid, frames rise along it, plating fills in as dots, a deckhouse and mast go on, and water rises around it nine months after the keel was laid. A calendar underneath marks the dates. A row of twenty small hulls then appears: two afloat, two under construction and sixteen outlined, the yearly output the yard is being sized for.',
  acts: [
    { at: 0, label: 'Keel' },
    { at: HULL, label: 'Hull one' },
    { at: REPEAT, label: 'Hull two' },
  ],
  captions: [
    { at: 0, text: 'Franklin, Louisiana, August 2025. Saronic lays the keel of a ship meant to sail with no one aboard.' },
    { at: 3.4, text: 'Saronic says the yard was closing when it took it over.' },
    { at: HULL, text: 'Frames, then plating. It is built to carry 150 metric tons and to range 5,400 nautical miles.' },
    { at: WET + 0.1, text: 'May 2026: in the water. Saronic says first design to sea trials took under a year.' },
    { at: REPEAT, text: 'November: hull two is afloat, built, Saronic says, with 8 percent fewer labor hours.' },
    { at: 17, text: 'Hulls three and four were already under construction in May. The yard is being sized for twenty a year.' },
  ],

  setup(ctx) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);
    // Plating: a lattice of dots, kept only where it falls inside the hull.
    const plates = new Halftone(X0, SY - 0.07 * SIZE, SIZE / PITCH, Math.ceil((0.125 * SIZE) / PITCH), PITCH);
    const inside = new Uint8Array(plates.n);
    for (let i = 0; i < plates.n; i++) {
      const xn = (plates.xs[i] - SX) / SIZE;
      const yn = (plates.ys[i] - SY) / SIZE;
      const [deck, keel] = C.marauderSection(xn);
      const stem = xn > 0.455 ? K.lerp(0.035, -0.066, (xn - 0.455) / 0.045) : 1;
      inside[i] = yn > deck + 0.004 && yn < Math.min(keel, stem) - 0.004 ? 1 : 0;
    }
    const FRAMES: number[] = [];
    for (let x = -0.47; x <= 0.44; x += 0.026) FRAMES.push(x);

    const rail = ctx.rail();
    const phase = rail.phase('Yard', ['Keel laid', 'Hull one', 'Hull two']);
    const pair = rail.pair();
    const months = pair.stat({ label: 'Months, keel to water', slots: 1, bar: true });
    const afloat = pair.stat({ label: 'Hulls afloat', slots: 1 });
    const hours = rail.chart({ label: 'Labor hours to build', height: 58 });
    const chips = rail.chips({ label: 'As launched', items: ['180 ft', '150 metric tons of payload', '5,400 nautical miles', '25+ knots', 'No crew'] });
    rail.note('Dates, specifications and the labor figure are Saronic’s. The design grew from 150 ft at keel-laying to 180 ft at launch. Hull form schematic.');

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        const on = K.tween(t, 0, 0.8);
        const keel = K.tween(t, 0.8, 2.6);
        const plated = K.tween(t, HULL, 9.2);
        const fitted = K.tween(t, 8.4, 9.7);
        const wet = K.tween(t, WET, WET + 1.6);
        // The one small overshoot in this film: the hull settles as it floats.
        const settle = t < WET ? 0 : 5 * K.ease.outBack(K.seg(t, WET, WET + 1.4)) - 5;
        const bob = wet * (1.2 * Math.sin(live * 0.9) + settle);
        pen.plate(FX, FY, FW, FH, { title: 'Building slip, Franklin, Louisiana · side view · hull form schematic', right: 'Aug 2025 to Nov 2026' });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ================= The hull ================= */
        g.save();
        g.translate(0, bob);
        // Keel blocks, until the water takes the weight.
        for (let k = 0; k < 9; k++) {
          const x = X0 + 40 + k * 60;
          const a = K.tween(t, 0.3 + k * 0.05, 0.9 + k * 0.05) * (1 - wet);
          pen.stroke(col.wire, a, 1).box(x - 7, KEEL_Y + 2 - bob, 14, 9);
        }
        // Frames rise from the middle outward.
        for (let i = 0; i < FRAMES.length; i++) {
          const x = FRAMES[i];
          const order = Math.abs(i - FRAMES.length / 2) / (FRAMES.length / 2);
          const up = K.tween(t, 2.6 + order * 2.6, 3.9 + order * 2.6, 'out');
          if (up <= 0) continue;
          const [deck, bottom] = C.marauderSection(x);
          const p = at(x, bottom);
          const q = at(x, K.lerp(bottom, deck, up));
          pen.stroke(col.mark, 0.5 - 0.22 * plated, 1).line(p[0], p[1], q[0], q[1]);
        }
        // Plating, stern to bow.
        if (plated > 0) {
          for (let i = 0; i < plates.n; i++) {
            if (!inside[i]) {
              plates.tone[i] = 0;
              continue;
            }
            const along = (plates.xs[i] - X0) / SIZE;
            const done = K.clamp((plated * 1.25 - along) / 0.25);
            const fresh = done > 0 && done < 1;
            plates.tone[i] = done * 0.74;
            plates.shade[i] = fresh ? 1 : 0;
          }
          plates.draw(pen, [K.rgba(col.mark, 0.62), col.live], { min: 0.05, max: 0.42, gamma: 0.9 });
        }
        // The keel, then the outline once it is plated.
        if (keel > 0) {
          const a0 = at(-0.44, 0.05);
          const a1 = at(0.44, 0.05);
          pen.stroke(keel < 1 ? col.live : col.bright, 1, 1.8).line(a0[0], a0[1], K.lerp(a0[0], a1[0], keel), a0[1]);
        }
        if (plated > 0.15) {
          const a = K.clamp((plated - 0.15) / 0.6);
          C.draw(pen, [C.MARAUDER[0]], SX, SY, { size: SIZE, color: col.bright, alpha: a, fill: null, width: 1.5 });
        }
        if (fitted > 0) {
          C.draw(pen, C.MARAUDER.slice(1), SX, SY, { size: SIZE, color: col.bright, alpha: fitted, width: 1.3 });
          // Four waterjets at the transom.
          for (let k = 0; k < 4; k++) pen.stroke(col.bright, fitted, 1.2).line(X0 - 5, SY + (0.012 + k * 0.007) * SIZE, X0, SY + (0.012 + k * 0.007) * SIZE);
          // The payload deck: two of the four forty-foot containers, drawn to the hull's scale.
          const w = (40 / LENGTH_FT) * SIZE;
          const h = (8.5 / LENGTH_FT) * SIZE;
          for (let k = 0; k < 2; k++) {
            pen.stroke(col.mark, 0.85 * fitted, 1, DASH.fine).box(X0 + 34 + k * (w + 6), SY - 0.043 * SIZE - h, w, h);
          }
          g.setLineDash([]);
        }
        g.restore();

        /* ---- The water ---- */
        if (wet > 0) {
          const edge = K.lerp(FX + FW, FX, wet);
          pen.stroke(col.mark, 0.8, 1).hline(edge, FX + FW, WATER_Y);
          for (let k = 0; k < 4; k++) {
            pen.stroke(col.wire, 0.75 - k * 0.14, 1, [8 + k * 3, 13 + k * 4], live * (9 + k * 3) + k * 23).hline(edge, FX + FW, WATER_Y + 7 + k * 8);
          }
          g.setLineDash([]);
        }

        /* ---- A scale ---- */
        const ruled = K.tween(t, 1.6, 2.6) * (1 - wet);
        if (ruled > 0) {
          const y = KEEL_Y + 26;
          pen.stroke(col.wire, ruled, 1).hline(X0, X0 + SIZE, y).vline(X0, y - 4, y + 4).vline(X0 + SIZE, y - 4, y + 4);
          pen.fill(col.stage, ruled).rect(SX - 26, y - 7, 52, 14);
          g.fill();
          pen.cap(`${LENGTH_FT} ft`, SX, y + 3.5, col.muted, ruled, 'center');
        }

        /* ================= The calendar ================= */
        pen.stroke(col.line2, on, 1).hline(month(0), month(15.6), CAL_Y);
        pen.stroke(col.wire, on, 1).ticks(month(0), CAL_Y, month(15), CAL_Y, 15, 4, 3);
        for (const [m, name] of TICKS) pen.cap(name, month(m), CAL_Y + 22, col.faint, on, 'center');
        const now = clock(t);
        if (t > 0.8) {
          pen.stroke(col.bright, 1, 2.4).hline(month(KEEL_AT), month(Math.min(now, WATER_AT)), CAL_Y);
          pen.fill(col.bright).dot(month(KEEL_AT), CAL_Y, 3);
          if (t >= WET) pen.fill(col.live).dot(month(WATER_AT), CAL_Y, 3.4);
          if (t < 16.4) {
            pen.stroke(col.ink, 1, 1).vline(month(now), CAL_Y - 9, CAL_Y + 9);
          }
        }
        const two = K.tween(t, REPEAT + 0.4, 16.4);
        if (two > 0) {
          // Hull two: when it was started was not reported, so its line begins where it was turned over.
          pen.stroke(col.mark, 0.9, 1.6, DASH.dash).hline(month(FLIP_AT), K.lerp(month(FLIP_AT), month(SECOND_AT), two), CAL_Y - 12);
          g.setLineDash([]);
          pen.fill(col.mark).dot(month(FLIP_AT), CAL_Y - 12, 2.4);
          if (two >= 1) pen.fill(col.live).dot(month(SECOND_AT), CAL_Y - 12, 3.4);
        }

        /* ================= The yard's year ================= */
        const row = K.tween(t, REPEAT + 0.2, REPEAT + 1);
        if (row > 0) {
          pen.cap('Twenty hulls: the yearly output the yard is being sized for', ROW_X - SMALL / 2, ROW_Y - 22, col.muted, row);
          for (let i = 0; i < PER_YEAR; i++) {
            const x = ROW_X + (i % PER_ROW) * SLOT;
            const base = ROW_Y + Math.floor(i / PER_ROW) * ROW_GAP;
            const a = K.tween(t, REPEAT + 0.3 + i * 0.07, REPEAT + 0.9 + i * 0.07);
            const floats = i === 0 || (i === 1 && two >= 1);
            const building = (i === 1 && two < 1) || i === 2 || i === 3;
            const y = base + (floats ? Math.sin(live * 0.9 + i) * 0.8 : 0);
            if (floats) {
              C.draw(pen, C.MARAUDER, x, y, { size: SMALL, color: i === 1 ? col.live : col.bright, fill: i === 1 ? col.live : col.mark, fillAlpha: 0.9, alpha: a, width: 1 });
              pen.stroke(col.wire, a, 1, [4, 4], live * 5).hline(x - SMALL / 2 - 4, x + SMALL / 2 + 4, base + 5);
              g.setLineDash([]);
            } else if (building) {
              C.draw(pen, [C.MARAUDER[0]], x, y, { size: SMALL, color: col.bright, fill: null, alpha: a, width: 1.1 });
              pen.hatch(x - SMALL * 0.46, y - 2, SMALL * 0.9, 4.5, col.bright, 0.7 * a, 3);
            } else {
              C.draw(pen, [C.MARAUDER[0]], x, y, { size: SMALL, color: col.wire, fill: null, alpha: a * 0.9, width: 1 });
            }
          }
          const key = K.tween(t, 17, 17.8);
          const ky = ROW_Y + ROW_GAP + 26;
          pen.cap(two >= 1 ? '2 afloat' : '1 afloat', ROW_X - SMALL / 2, ky, col.ink, row);
          pen.cap('· 2 under construction', ROW_X - SMALL / 2 + 62, ky, col.mark, key);
          pen.cap('16 more a year at full rate', ROW_X + (PER_ROW - 1) * SLOT + SMALL / 2, ky, col.faint, key, 'right');
        }
        g.restore();

        /* ================= Labels ================= */
        pen.label(at(-0.3, 0.05)[0], KEEL_Y, at(-0.3, 0)[0] - 20, KEEL_Y - 96, ['Keel laid', '22 Aug 2025'], { color: col.live, u: K.pulse(t, 1.2, HULL - 0.2, 0.5), align: 'right' });
        pen.label(at(0.1, 0)[0], at(0, -0.02)[1], at(0.16, 0)[0], KEEL_Y - 128, ['Frames', 'rising from the keel'], { color: col.mark, u: K.pulse(t, 3.6, HULL + 0.4, 0.5) });
        pen.label(at(-0.06, 0)[0], at(0, 0)[1] + bob, at(-0.12, 0)[0], KEEL_Y - 128, ['Plating', 'each dot fills as the hull closes'], { color: col.mark, u: K.pulse(t, HULL + 0.9, WET - 0.2, 0.4), align: 'right' });
        pen.label(at(-0.3, 0)[0], SY - 0.043 * SIZE - 26 + bob, at(-0.32, 0)[0], KEEL_Y - 150, ['Payload deck', 'room for four 40-ft containers'], { color: col.ink, u: K.pulse(t, 9, REPEAT - 0.3, 0.4) * fitted, align: 'right' });
        pen.label(at(0.2, -0.17)[0], at(0, -0.17)[1] + bob, at(0.29, 0)[0], at(0, -0.2)[1], ['Marauder, hull one', 'in the water, May 2026'], { color: col.live, u: K.tween(t, WET + 0.6, WET + 1.5) });
        pen.label(month(WATER_AT), CAL_Y - 5, month(WATER_AT) + 26, CAL_Y - 34, ['Nine months', 'keel to water'], { color: col.live, u: K.pulse(t, WET + 0.2, REPEAT + 0.3, 0.4) });
        pen.label(month(SECOND_AT), CAL_Y - 16, month(SECOND_AT) - 26, CAL_Y - 44, ['Hull two afloat', 'November 2026 · 8% fewer hours'], { color: col.live, u: K.tween(t, 16.4, 17.1), align: 'right' });

        /* ================= Instruments ================= */
        phase.set(K.tween(t, HULL, HULL + 0.7) + K.tween(t, REPEAT, REPEAT + 0.7));
        const span = K.clamp((now - KEEL_AT) / (WATER_AT - KEEL_AT));
        months.set(t > 0.8 ? MONTHS * span : 0);
        months.bar(span);
        afloat.set(K.tween(t, WET, WET + 0.6) + K.tween(t, 16.4, 17));
        [8.6, 8.9, 9.2, 9.5, 9.8].forEach((time, i) => chips.set(i, t >= time ? 1 : 0));

        hours.clear();
        const cg = hours.g;
        const first = K.tween(t, WET, WET + 0.9);
        const second = K.tween(t, 16.4, 17.4);
        const bar = (y: number, name: string, share: number, color: string, text: string): void => {
          cg.font = FONT.label;
          cg.textBaseline = 'alphabetic';
          cg.textAlign = 'left';
          cg.fillStyle = share > 0 ? color : col.faint;
          cg.fillText(name, 0, y - 5);
          cg.fillStyle = col.line2;
          cg.fillRect(0, y, hours.w, 7);
          cg.fillStyle = color;
          cg.fillRect(0, y, hours.w * share, 7);
          if (text) {
            cg.textAlign = 'right';
            cg.fillText(text, hours.w, y - 5);
          }
        };
        bar(14, 'HULL ONE', first, col.mark, '');
        bar(44, 'HULL TWO', second * (1 - SAVED / 100), col.live, second >= 1 ? `${SAVED}% FEWER` : '');
      },
    };
  },
};
export default def;
