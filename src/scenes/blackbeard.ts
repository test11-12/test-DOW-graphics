/* Win 10 — Castelion Blackbeard
   Hypersonic missiles under the wings of a Super Hornet; then the first production
   lot of 444; then the 12,000 the Pentagon says it is seeking to buy.

   The plate ends as a field of exactly 12,000 dots, one for each missile the
   Department said in May 2026 that it wants, with the 444 on order lit in the corner.
   Count them and the number is true. The 12,000 is an ask, not an order: what the
   Department has committed to is at least 500 a year once testing is done, and the
   film says so. No price per round has been published, so the film gives none. */
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
const LOT_ACT = 6.5;
const BOOK = 13;
/** The first lot counts up between these two moments. */
const FILL_FROM = LOT_ACT + 0.5;
const FILL_TO = 10;
/** The Pentagon's contract notice of 14 September 2026, and the Navy's release the next day. */
export const LOT = 444;
export const FIRST_AWARD_USD = 43.65e6;
export const ORDER_MAX_USD = 200e6;
/** The Department's release of 13 May 2026: what it is seeking, and what it has committed to. */
export const SOUGHT = 12000;
export const FLOOR_PER_YEAR = 500;
export const YEARS = 5;

/* ---- The field: 160 x 75 dots is 12,000 ---- */
export const COLS = 160;
export const ROWS = SOUGHT / COLS;
/** The field keeps the plate's 14 px margin on both sides. */
const FIELD_X = FX + 14;
const PITCH = (FW - 28) / COLS;
const TOP = FY + 37;
const FIELD_W = COLS * PITCH;
const FIELD_H = ROWS * PITCH;
/** Dot diameters in design pixels. Each is rounded to whole device pixels when drawn. */
const DIM_D = 1.9;
const LOT_D = 3.7;
/** How many shades a dot can take between dark and its resting tone: brightness moves, size never does. */
const STEPS = 10;
const LOT_STEPS = 6;
/** The first lot is a block in the corner: 37 x 12 is 444. */
export const LOT_COLS = 37;
export const LOT_ROWS = LOT / LOT_COLS;
const BAND = COLS / YEARS;

/* ---- The aircraft ---- */
const JET: Pt = [FX + FW / 2 - 16, FY + FH / 2 + 12];
const JET_SIZE = 430;
const ROUND: Pt = [JET[0] - 0.01 * JET_SIZE, JET[1] - 0.215 * JET_SIZE];
/** The footage shows them under both wings; how many a jet will carry was not released. */
const ROUND_B: Pt = [ROUND[0], JET[1] + 0.215 * JET_SIZE];
const ROUND_SIZE = 0.25 * JET_SIZE;
/** Each missile leaves the wing at the act and lands as the counter reaches 1, then 2. */
const LEAVE = [LOT_ACT, LOT_ACT + 0.05];
const LAND = [1, 2].map((k) => FILL_FROM + ((FILL_TO - FILL_FROM) * Math.acos(1 - (2 * k) / LOT)) / Math.PI);

const def: SceneDef = {
  id: 'blackbeard',
  duration: DUR,
  takeaway: 'Hypersonic used to mean exquisite and scarce. Twelve thousand, even as an ask, is an ammunition number.',
  alt: 'A Super Hornet seen from above with a missile under each wing. The missiles become the first of 444 dots that fill a block in the corner of the frame: the first production lot. The rest of the frame then fills with dimmer dots until there are 12,000, divided into five yearly bands: the number the Pentagon said in May that it is seeking to buy.',
  acts: [
    { at: 0, label: 'On the wing' },
    { at: LOT_ACT, label: 'First lot' },
    { at: BOOK, label: 'The ask' },
  ],
  captions: [
    { at: 0, text: 'September 25, 2026. The Navy posts footage of a Super Hornet in flight with Castelion’s Blackbeards under its wings.' },
    { at: 3.4, text: 'It has not given a speed, or said whether one has yet left the rail.' },
    { at: LOT_ACT, text: 'Eleven days earlier the Pentagon announced the first production lot: 444 missiles, with a first award of $43.65 million.' },
    { at: 10.3, text: 'The Navy says the order could reach $200 million. It has not published a price per round.' },
    { at: BOOK, text: 'In May the Pentagon said it was seeking the money to buy more than 12,000 Blackbeards over five years.' },
    { at: 15.6, text: 'What it committed to: at least 500 a year for two years, once the missile passes testing.' },
    { at: 18.3, text: 'The Navy wants the first ones in service by 2028.' },
  ],

  setup(ctx) {
    const col = ctx.colors;
    const pen = new Pen(ctx.canvas(), col);
    const n = COLS * ROWS;
    // How far each dot is from the corner where the first lot sits: the order they appear in.
    const far = new Float32Array(n);
    const reach = Math.hypot(COLS, ROWS);
    for (let i = 0; i < n; i++) far[i] = Math.hypot(i % COLS, Math.floor(i / COLS)) / reach;
    // Scratch for one frame, refilled every frame: the shade of each dot, and where each column and row lands.
    const shade = new Uint8Array(n);
    const used = new Uint8Array(2 * STEPS + 1);
    const ex = new Float64Array(COLS);
    const ey = new Float64Array(ROWS);
    const lx = new Float64Array(LOT_COLS);
    const ly = new Float64Array(LOT_ROWS);
    const lotShade = new Uint8Array(LOT);
    // Shades 1..STEPS fade a dot in; the ones above lift it toward white as a light passes.
    const tones: string[] = [];
    for (let k = 0; k <= 2 * STEPS; k++) {
      const b = k / STEPS;
      tones.push(b <= 1 ? K.rgba(col.dim, 0.9 * b) : K.rgba(K.blend(col.dim, col.mark, b - 1), 0.9 + 0.1 * (b - 1)));
    }
    const limes: string[] = [];
    for (let k = 0; k <= LOT_STEPS; k++) limes.push(K.blend(col.live, col.bright, (0.75 * k) / LOT_STEPS));
    /** Put a row of dots on whole device pixels, so every dot is the same picture and the field cannot shimmer. */
    const land = (out: Float64Array, origin: number, pitch: number, d: number, px: number, shift: number): void => {
      for (let i = 0; i < out.length; i++) out[i] = (Math.round((origin + (i + 0.5) * pitch - d / 2) / px + shift) - shift) * px;
    };

    const rail = ctx.rail();
    const phase = rail.phase('Scale', ['On the wing', 'First lot', 'The ask']);
    const pair = rail.pair();
    const lot = pair.stat({ label: 'First production lot', slots: 3, bar: true });
    const least = pair.stat({ label: 'Minimum per year', slots: 3 });
    const book = rail.stat({ label: 'Sought, over five years', slots: 5, size: 'm', bar: true });
    const log = rail.log({ label: 'Paper trail, 2026', items: ['Framework: at least 500 a year', 'Test loading on jets confirmed', 'First lot of 444 announced', 'Flight footage released'] });
    rail.note('No price per round has been published. The 12,000 is what the Pentagon said it is seeking, not an order. Speed and how many a jet will carry were not released.');
    const STAMPS = ['13 May', 'Aug', '14 Sep', '25 Sep'];

    return {
      update(f) {
        const t = f.t;
        const live = f.live;
        const g = pen.frame(f.view).g;
        // The first frame is not empty: the jet is already there, dim, and flies in to its place.
        const on = 0.3 + 0.7 * K.tween(t, 0, 0.9);
        const slide = -36 * (1 - K.tween(t, 0, 0.9, 'outQuart'));
        const jet = on * K.lerp(1, 0.16, K.tween(t, LOT_ACT, LOT_ACT + 1.1)) * (1 - K.tween(t, BOOK - 0.2, BOOK + 0.8));
        const filled = K.tween(t, FILL_FROM, FILL_TO, 'inOutSine');
        const count = Math.floor(LOT * filled + 1e-6);
        const wave = K.tween(t, BOOK + 0.2, 16.6, 'inOutSine') * 1.08;
        const banded = K.tween(t, 16.6, 17.5);
        // A slow light crosses the dots once they have settled, and goes on after the story ends.
        const fieldLight = K.tween(t, 17.3, 18.5);
        const lotLight = K.tween(t, FILL_TO, FILL_TO + 1) * (1 - K.tween(t, BOOK, BOOK + 0.6)) + fieldLight;
        const crest = 1 - K.tween(t, 16.6, 17.3);
        // Dot sizes in whole device pixels, with at least one pixel of dark between neighbours.
        const px = pen.px;
        // The lattice steps a whole number of device pixels from dot to dot, so every gap is
        // the same at every window size. Rounding each dot separately left gaps of four and
        // five pixels by turns, which read as a faint plaid. The field is centred in the box
        // it would fill at the nominal pitch, so it is a little smaller on some screens.
        const pitch = Math.max(2 * px, Math.floor(PITCH / px + 1e-6) * px);
        const fieldX = FIELD_X + (FIELD_W - COLS * pitch) / 2;
        const top = TOP + (FIELD_H - ROWS * pitch) / 2;
        const room = Math.max(1, Math.floor(pitch / px) - 1);
        const dimN = Math.min(room, Math.max(1, Math.round(DIM_D / px)));
        const lotN = Math.min(room, Math.max(dimN + 1, Math.round(LOT_D / px)));
        const dDim = dimN * px;
        const dLot = lotN * px;
        // Where the canvas itself starts, in device pixels: it need not be a whole number.
        const sx = f.view.dpr * f.view.ox;
        const sy = f.view.dpr * f.view.oy;
        land(ex, fieldX, pitch, dDim, px, sx);
        land(ey, top, pitch, dDim, px, sy);
        land(lx, fieldX, pitch, dLot, px, sx);
        land(ly, top, pitch, dLot, px, sy);
        pen.plate(FX, FY, FW, FH, {
          title: t < LOT_ACT ? 'Super Hornet with Blackbeards, seen from above · schematic' : t < BOOK ? 'First production lot · one dot is one missile' : 'What the Pentagon is seeking · 12,000 dots, one for each missile',
          right: '2026',
        });
        g.save();
        g.beginPath();
        g.rect(FX + 0.5, FY + 0.5, FW - 1, FH - 1);
        g.clip();

        /* ================= The field ================= */
        if (t >= LOT_ACT) {
          // The 11,556 still only sought: dim, and all one size.
          if (wave > 0) {
            used.fill(0);
            for (let i = 0; i < n; i++) {
              const c = i % COLS;
              const r = (i - c) / COLS;
              let k = 0;
              if (c >= LOT_COLS || r >= LOT_ROWS) {
                const s = (wave - far[i]) / 0.08;
                if (s > 0) {
                  // The newest dots arrive bright and settle, so the eye follows the front.
                  let b = Math.min(1, s) * (1 + 0.6 * crest * K.clamp(2 - s));
                  if (fieldLight > 0) b += 0.9 * fieldLight * Math.pow(Math.max(0, Math.sin((c + r * 1.4) * 0.05 - live * 0.9)), 10);
                  k = Math.min(2 * STEPS, Math.round(b * STEPS));
                }
              }
              shade[i] = k;
              used[k] = 1;
            }
            const round = dimN > 2;
            for (let k = 1; k <= 2 * STEPS; k++) {
              if (!used[k]) continue;
              g.fillStyle = tones[k];
              g.beginPath();
              for (let i = 0; i < n; i++) {
                if (shade[i] !== k) continue;
                const c = i % COLS;
                const x = ex[c];
                const y = ey[(i - c) / COLS];
                if (round) {
                  g.moveTo(x + dDim, y + dDim / 2);
                  g.arc(x + dDim / 2, y + dDim / 2, dDim / 2, 0, K.TAU);
                } else g.rect(x, y, dDim, dDim);
              }
              g.fill();
            }
          }
          // The 444 on order: lime, the three newest brighter while the count runs.
          for (let k = 0; k < LOT; k++) {
            const c = k % LOT_COLS;
            const r = (k - c) / LOT_COLS;
            const lead = filled < 1 && k >= count - 3;
            lotShade[k] = k >= count ? 255 : lead ? LOT_STEPS : Math.round((LOT_STEPS - 1) * Math.min(1, lotLight) * Math.pow(Math.max(0, Math.sin((c + r * 1.4) * 0.05 - live * 0.9)), 10));
          }
          for (let q = 0; q <= LOT_STEPS; q++) {
            g.fillStyle = limes[q];
            g.beginPath();
            for (let k = 0; k < count; k++) {
              if (lotShade[k] !== q) continue;
              const c = k % LOT_COLS;
              const x = lx[c];
              const y = ly[(k - c) / LOT_COLS];
              if (lotN > 3) {
                g.moveTo(x + dLot, y + dLot / 2);
                g.arc(x + dLot / 2, y + dLot / 2, dLot / 2, 0, K.TAU);
              } else g.rect(x, y, dLot, dLot);
            }
            g.fill();
          }
          if (banded > 0) {
            const y0 = top - 17;
            const y1 = y0 + (Math.min(top + (ROWS * pitch) + 3, FY + FH - 14) - y0) * banded;
            pen.stroke(col.ink, 0.5 * banded, 1, DASH.fine);
            for (let y = 1; y < YEARS; y++) {
              const cb = y * BAND;
              // The rule runs in the dark between two columns of dots.
              const x = (ex[cb - 1] + dDim + ex[cb]) / 2;
              if (cb < LOT_COLS) {
                // The first lot is not a year's worth, so the rule steps over it.
                const skip = top + LOT_ROWS * pitch + 3;
                pen.vline(x, y0, Math.min(y1, top - 3));
                if (y1 > skip) pen.vline(x, skip, y1);
              } else pen.vline(x, y0, y1);
            }
            g.setLineDash([]);
            for (let y = 0; y < YEARS; y++) pen.cap(`Year ${y + 1}`, fieldX + (y + 0.5) * BAND * pitch, top - 9, col.muted, banded, 'center');
          }
        }

        /* ================= The aircraft ================= */
        const bob = 1.4 * Math.sin(live * 0.8);
        if (jet > 0) {
          // Air going past: the footage is of a jet in flight.
          for (let k = 0; k < 7; k++) {
            const y = FY + 54 + k * 58 + (k % 2) * 13;
            pen.stroke(col.wire, 0.9 * jet, 1, [16 + k * 3, 60 + k * 9], live * (150 + k * 22) + k * 40).hline(FX, FX + FW, y);
          }
          g.setLineDash([]);
          const armed = 0.3 + 0.7 * K.tween(t, 0.3, 1.2);
          [ROUND, ROUND_B].forEach((r, i) => {
            if (t < LEAVE[i]) C.draw(pen, C.GLIDER, r[0] + slide, r[1] + bob, { size: ROUND_SIZE, color: col.live, alpha: armed, width: 1.5 });
          });
          // The wing hides what is under it however faint its outline is.
          C.draw(pen, C.HORNET, JET[0] + slide, JET[1] + bob, { size: JET_SIZE, color: col.bright, alpha: jet, width: 1.4, fillAlpha: 0.9 / jet });
        }
        // The missiles become the first dots: each one shrinks to a dot on its way to the corner.
        [ROUND, ROUND_B].forEach((r, i) => {
          const hop = K.seg(t, LEAVE[i], LAND[i]);
          if (hop <= 0 || hop >= 1) return;
          const e = K.ease.inOut(hop);
          const x = K.lerp(r[0], lx[i] + dLot / 2, e);
          const y = K.lerp(r[1] + bob, ly[0] + dLot / 2, e);
          pen.stroke(col.live, 0.5 * (1 - K.tween(hop, 0.6, 1)), 1, DASH.fine).line(r[0], r[1] + bob, x, y);
          g.setLineDash([]);
          C.draw(pen, C.GLIDER, x, y, { size: K.lerp(ROUND_SIZE, dLot * 2.5, e), color: col.live, alpha: 1 - K.tween(hop, 0.55, 0.85), width: 1.5 });
          pen.fill(col.live, K.tween(hop, 0.45, 0.8)).dot(x, y, K.lerp(3.2, dLot / 2, e));
        });
        g.restore();

        /* ================= Labels ================= */
        pen.label(JET[0] + JET_SIZE * 0.3, JET[1] + 10, JET[0] + JET_SIZE * 0.36, JET[1] + 104, ['F/A-18 Super Hornet', 'Navy footage, released 25 Sep 2026'], { color: col.ink, u: K.pulse(t, 0.7, LOT_ACT - 0.2, 0.5) });
        pen.label(ROUND[0] + ROUND_SIZE * 0.3, ROUND[1] - 8, ROUND[0] + ROUND_SIZE * 0.3 + 54, ROUND[1] - 62, ['Blackbeard', 'Castelion · hypersonic: above Mach 5'], { color: col.live, u: K.pulse(t, 1.5, LOT_ACT - 0.2, 0.5) });
        pen.label(JET[0] - JET_SIZE * 0.08, JET[1] + JET_SIZE * 0.22, JET[0] - JET_SIZE * 0.2, JET[1] + JET_SIZE * 0.22 + 62, ['Carried under the wings', 'how many a jet will carry: not released'], { color: col.mark, u: K.pulse(t, 3.4, LOT_ACT - 0.2, 0.5), align: 'right' });
        const corner: Pt = [fieldX + LOT_COLS * pitch + 2, top + (LOT_ROWS * pitch) / 2];
        pen.label(corner[0], corner[1], corner[0] + 56, corner[1] + 62, ['First production lot', '444 rounds · first award $43.65 million · 14 Sep 2026'], { color: col.live, u: K.tween(t, LOT_ACT + 1.2, LOT_ACT + 2.1) });
        const mid: Pt = [fieldX + (2.5 * BAND + 0.5) * pitch, top + (Math.floor(ROWS * 0.62) + 0.5) * pitch];
        pen.label(mid[0], mid[1], mid[0] + 48, mid[1] + 46, ['What the Pentagon is seeking', 'more than 12,000 over five years · 13 May 2026'], { color: col.ink, u: K.tween(t, 15.4, 16.3) });
        if (banded > 0) pen.tag('Shown as an even split: 2,400 a year', fieldX + (COLS * pitch) - 10, top + (ROWS * pitch) - 20, { color: col.mark, alpha: banded, align: 'right' });
        const floor = K.tween(t, 15.8, 16.6);
        if (floor > 0) pen.tag(`Committed so far: at least ${FLOOR_PER_YEAR} a year, once tested`, fieldX + 10, top + (ROWS * pitch) - 20, { color: col.ink, alpha: floor });
        const priced = K.tween(t, 10.3, 11.1) * (1 - K.tween(t, BOOK - 0.4, BOOK + 0.1));
        if (priced > 0) pen.tag(`Order worth up to $${ORDER_MAX_USD / 1e6} million · no price per round published`, corner[0] + 56, corner[1] + 112, { color: col.mark, alpha: priced });

        /* ================= Instruments ================= */
        phase.set(K.tween(t, LOT_ACT, LOT_ACT + 0.7) + K.tween(t, BOOK, BOOK + 0.7));
        lot.set(count);
        lot.bar(filled);
        lot.alpha(0.35 + 0.65 * K.tween(t, LOT_ACT - 0.1, LOT_ACT + 0.4));
        least.set(FLOOR_PER_YEAR * K.tween(t, 15.6, 16.6, 'out'));
        least.alpha(0.35 + 0.65 * K.tween(t, 15.5, 16));
        const booked = K.tween(t, BOOK + 0.2, 16.6, 'inOutSine');
        book.set(Math.max(count * (t >= BOOK ? 1 : 0), SOUGHT * booked));
        book.bar(t >= BOOK ? LOT / SOUGHT : 0);
        book.alpha(0.35 + 0.65 * K.tween(t, BOOK - 0.1, BOOK + 0.4));
        log.set(0, K.tween(t, BOOK, BOOK + 0.4), STAMPS[0]);
        log.set(1, K.tween(t, 4.6, 5), STAMPS[1]);
        log.set(2, K.tween(t, LOT_ACT, LOT_ACT + 0.4), STAMPS[2]);
        log.set(3, K.tween(t, 0.9, 1.3), STAMPS[3]);
      },
    };
  },
};
export default def;
