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
import { DASH, Halftone, Pen } from '../draw/pen.ts';
import * as C from '../draw/craft.ts';
import type { SceneDef } from '../core/types.ts';

const FX = 44;
const FY = 43;
const FW = 840;
const FH = 434;
const DUR = 21;
const LOT_ACT = 6.5;
const BOOK = 13;
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
const PITCH = FW / COLS;
const TOP = FY + 30;
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
    const field = new Halftone(FX, TOP, COLS, ROWS, PITCH);
    // How far each dot is from the corner where the first lot sits: the order they appear in.
    const far = new Float32Array(field.n);
    const reach = Math.hypot(COLS, ROWS);
    for (let i = 0; i < field.n; i++) far[i] = Math.hypot(i % COLS, Math.floor(i / COLS)) / reach;

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
        const on = K.tween(t, 0, 0.9);
        const jet = on * K.lerp(1, 0.2, K.tween(t, LOT_ACT, LOT_ACT + 1.1)) * (1 - K.tween(t, BOOK - 0.2, BOOK + 0.8));
        const filled = K.tween(t, LOT_ACT + 0.5, 10, 'inOutSine');
        const count = Math.floor(LOT * filled + 1e-6);
        const wave = K.tween(t, BOOK + 0.2, 16.6, 'inOutSine') * 1.08;
        const banded = K.tween(t, 16.6, 17.5);
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
          for (let i = 0; i < field.n; i++) {
            const c = i % COLS;
            const r = (i - c) / COLS;
            if (c < LOT_COLS && r < LOT_ROWS) {
              const k = r * LOT_COLS + c;
              field.tone[i] = k < count ? (k >= count - 3 && filled < 1 ? 1 : 0.8) : 0;
              field.shade[i] = 1;
            } else {
              const u = K.clamp((wave - far[i]) / 0.08);
              // After the story a slow light crosses the field, so the last frame is alive.
              const glint = f.ended ? 0.2 * Math.pow(Math.max(0, Math.sin((c + r * 1.4) * 0.05 - live * 0.9)), 10) : 0;
              field.tone[i] = u * (0.27 + glint);
              field.shade[i] = 0;
            }
          }
          field.draw(pen, [K.rgba(col.dim, 0.9), col.live], { min: 0.06, max: 0.44, gamma: 0.85 });
          if (banded > 0) {
            for (let y = 1; y < YEARS; y++) {
              pen.stroke(col.ink, 0.5 * banded, 1, DASH.fine).vline(FX + y * BAND * PITCH, TOP - 6, TOP + (ROWS * PITCH + 6) * banded);
            }
            g.setLineDash([]);
            for (let y = 0; y < YEARS; y++) pen.cap(`Year ${y + 1}`, FX + (y + 0.5) * BAND * PITCH, TOP - 9, col.muted, banded, 'center');
          }
        }

        /* ================= The aircraft ================= */
        if (jet > 0) {
          // Air going past: the footage is of a jet in flight.
          for (let k = 0; k < 7; k++) {
            const y = FY + 54 + k * 58 + (k % 2) * 13;
            pen.stroke(col.wire, 0.5 * jet, 1, [16 + k * 3, 60 + k * 9], live * (150 + k * 22) + k * 40).hline(FX, FX + FW, y);
          }
          g.setLineDash([]);
          const bob = 1.4 * Math.sin(live * 0.8);
          if (t < LOT_ACT + 0.5) {
            for (const r of [ROUND, ROUND_B]) C.draw(pen, C.GLIDER, r[0], r[1] + bob, { size: ROUND_SIZE, color: col.live, alpha: on * (1 - K.tween(t, LOT_ACT, LOT_ACT + 0.4)), width: 1.5 });
          }
          C.draw(pen, C.HORNET, JET[0], JET[1] + bob, { size: JET_SIZE, color: col.bright, alpha: jet, width: 1.4, fillAlpha: 0.9 });
        }
        // The missiles become the first dots.
        const hop = K.seg(t, LOT_ACT, LOT_ACT + 0.5);
        if (hop > 0 && hop < 1) {
          const e = K.ease.inOut(hop);
          [ROUND, ROUND_B].forEach((r, i) => pen.fill(col.live).dot(K.lerp(r[0], field.xs[i], e), K.lerp(r[1], field.ys[i], e), K.lerp(4, 2, e)));
        }
        g.restore();

        /* ================= Labels ================= */
        pen.label(JET[0] + JET_SIZE * 0.3, JET[1] + 10, JET[0] + JET_SIZE * 0.36, JET[1] + 104, ['F/A-18 Super Hornet', 'Navy footage, released 25 Sep 2026'], { color: col.ink, u: K.pulse(t, 0.7, LOT_ACT - 0.2, 0.5) });
        pen.label(ROUND[0] + ROUND_SIZE * 0.3, ROUND[1] - 8, ROUND[0] + ROUND_SIZE * 0.3 + 54, ROUND[1] - 62, ['Blackbeard', 'Castelion · hypersonic: above Mach 5'], { color: col.live, u: K.pulse(t, 1.5, LOT_ACT - 0.2, 0.5) });
        pen.label(JET[0] - JET_SIZE * 0.08, JET[1] + JET_SIZE * 0.22, JET[0] - JET_SIZE * 0.2, JET[1] + JET_SIZE * 0.22 + 62, ['Carried under the wings', 'how many a jet will carry: not released'], { color: col.mark, u: K.pulse(t, 3.4, LOT_ACT - 0.2, 0.5), align: 'right' });
        const corner: Pt = [FX + LOT_COLS * PITCH + 2, TOP + (LOT_ROWS * PITCH) / 2];
        pen.label(corner[0], corner[1], corner[0] + 56, corner[1] + 62, ['First production lot', '444 rounds · first award $43.65 million · 14 Sep 2026'], { color: col.live, u: K.tween(t, LOT_ACT + 1.2, LOT_ACT + 2.1) });
        const mid: Pt = [FX + 2.5 * BAND * PITCH, TOP + ROWS * PITCH * 0.62];
        pen.label(mid[0], mid[1], mid[0] + 48, mid[1] + 46, ['What the Pentagon is seeking', 'more than 12,000 over five years · 13 May 2026'], { color: col.ink, u: K.tween(t, 15.4, 16.3) });
        if (banded > 0) pen.tag('Shown as an even split: 2,400 a year', FX + FW - 14, TOP + ROWS * PITCH - 14, { color: col.mark, alpha: banded, align: 'right' });
        const floor = K.tween(t, 15.8, 16.6);
        if (floor > 0) pen.tag(`Committed so far: at least ${FLOOR_PER_YEAR} a year, once tested`, FX + 14, TOP + ROWS * PITCH - 14, { color: col.ink, alpha: floor });
        const priced = K.tween(t, 10.3, 11.1) * (1 - K.tween(t, BOOK - 0.4, BOOK + 0.1));
        if (priced > 0) pen.tag(`Order worth up to $${ORDER_MAX_USD / 1e6} million · no price per round published`, corner[0] + 56, corner[1] + 112, { color: col.mark, alpha: priced });

        /* ================= Instruments ================= */
        phase.set(K.tween(t, LOT_ACT, LOT_ACT + 0.7) + K.tween(t, BOOK, BOOK + 0.7));
        lot.set(count);
        lot.bar(filled);
        least.set(FLOOR_PER_YEAR * K.tween(t, 15.6, 16.6, 'out'));
        least.alpha(0.35 + 0.65 * K.tween(t, 15.5, 16));
        const booked = K.tween(t, BOOK + 0.2, 16.6, 'inOutSine');
        book.set(Math.max(count * (t >= BOOK ? 1 : 0), SOUGHT * booked));
        book.bar(t >= BOOK ? LOT / SOUGHT : 0);
        book.alpha(0.35 + 0.65 * K.tween(t, BOOK - 0.1, BOOK + 0.4));
        log.set(0, t >= BOOK, STAMPS[0]);
        log.set(1, t >= 4.6, STAMPS[1]);
        log.set(2, t >= LOT_ACT, STAMPS[2]);
        log.set(3, t >= 0.9, STAMPS[3]);
      },
    };
  },
};
export default def;
