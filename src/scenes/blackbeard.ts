/* Win 10 — Castelion Blackbeard
   One hypersonic missile under the wing of a Super Hornet; then the first production
   lot of 444; then the framework agreement for 12,000.

   The plate ends as a field of exactly 12,000 dots, one for each missile in the
   framework, with the 444 on order lit in the corner. Count them and the number is
   true. What the Navy has not said about the weapon itself, the film does not draw. */
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
/** From the contract announcements. */
export const LOT = 444;
export const LOT_USD = 43.65e6;
export const FRAMEWORK = 12000;
export const YEARS = 5;
/** The contract divided by the rounds, in thousands of dollars: not an official unit price. */
export const PER_ROUND_K = Math.round(LOT_USD / LOT / 1000);

/* ---- The field: 160 x 75 dots is 12,000 ---- */
export const COLS = 160;
export const ROWS = FRAMEWORK / COLS;
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
const ROUND_SIZE = 0.25 * JET_SIZE;

const def: SceneDef = {
  id: 'blackbeard',
  duration: DUR,
  takeaway: 'Hypersonic used to mean exquisite and scarce. Twelve thousand is an ammunition number.',
  alt: 'A Super Hornet seen from above with one missile under its wing. The missile becomes the first of 444 dots that fill a block in the corner of the frame: the first production lot. The rest of the frame then fills with dimmer dots until there are 12,000, divided into five yearly bands: the size of the framework agreement.',
  acts: [
    { at: 0, label: 'On the wing' },
    { at: LOT_ACT, label: 'First lot' },
    { at: BOOK, label: 'The order book' },
  ],
  captions: [
    { at: 0, text: '25 September 2026. The Navy posts footage of a Super Hornet in flight with Castelion’s Blackbeard under its wing.' },
    { at: 3.4, text: 'It has not said how fast, how far, or whether one has left the rail.' },
    { at: LOT_ACT, text: 'Eleven days earlier it ordered the first production lot: 444 missiles for $43.65 million.' },
    { at: 10.3, text: 'That works out to roughly $98,000 a round.' },
    { at: BOOK, text: 'In May the Pentagon set the frame: 12,000 Blackbeards over five years.' },
    { at: 17.2, text: 'The Navy wants the first ones in service by 2028.' },
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
    const phase = rail.phase('Scale', ['One on the wing', 'First lot', 'The framework']);
    const pair = rail.pair();
    const lot = pair.stat({ label: 'First production lot', slots: 3, bar: true });
    const each = pair.stat({ label: 'Per round, about', prefix: '$', unit: 'thousand', slots: 2 });
    const book = rail.stat({ label: 'Framework, over five years', slots: 5, size: 'm', bar: true });
    const log = rail.log({ label: 'Paper trail, 2026', items: ['Framework for 12,000', 'Test loading on jets begins', 'First lot of 444 ordered', 'Flight footage released'] });
    rail.note('Cost per round is the contract divided by the rounds, not an official price. Speed, range and how many a jet carries were not released.');
    const STAMPS = ['May', 'Aug', '14 Sep', '25 Sep'];

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
          title: t < LOT_ACT ? 'Super Hornet with Blackbeard, seen from above · schematic' : t < BOOK ? 'First production lot · one dot is one missile' : 'The framework agreement · 12,000 dots, one for each missile',
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
          if (t < LOT_ACT + 0.5) C.draw(pen, C.GLIDER, ROUND[0], ROUND[1] + bob, { size: ROUND_SIZE, color: col.live, alpha: on * (1 - K.tween(t, LOT_ACT, LOT_ACT + 0.4)), width: 1.5 });
          C.draw(pen, C.HORNET, JET[0], JET[1] + bob, { size: JET_SIZE, color: col.bright, alpha: jet, width: 1.4, fillAlpha: 0.9 });
        }
        // The missile becomes the first dot.
        const hop = K.seg(t, LOT_ACT, LOT_ACT + 0.5);
        if (hop > 0 && hop < 1) {
          const e = K.ease.inOut(hop);
          pen.fill(col.live).dot(K.lerp(ROUND[0], field.xs[0], e), K.lerp(ROUND[1], field.ys[0], e), K.lerp(4, 2, e));
        }
        g.restore();

        /* ================= Labels ================= */
        pen.label(JET[0] + JET_SIZE * 0.3, JET[1] + 10, JET[0] + JET_SIZE * 0.36, JET[1] + 104, ['F/A-18 Super Hornet', 'Navy footage, released 25 Sep 2026'], { color: col.ink, u: K.pulse(t, 0.7, LOT_ACT - 0.2, 0.5) });
        pen.label(ROUND[0] + ROUND_SIZE * 0.3, ROUND[1] - 8, ROUND[0] + ROUND_SIZE * 0.3 + 54, ROUND[1] - 62, ['Blackbeard', 'Castelion · hypersonic: above Mach 5'], { color: col.live, u: K.pulse(t, 1.5, LOT_ACT - 0.2, 0.5) });
        pen.label(JET[0] - JET_SIZE * 0.08, JET[1] + JET_SIZE * 0.22, JET[0] - JET_SIZE * 0.2, JET[1] + JET_SIZE * 0.22 + 62, ['How many it carries, and where', 'not released'], { color: col.mark, u: K.pulse(t, 3.4, LOT_ACT - 0.2, 0.5), align: 'right' });
        const corner: Pt = [FX + LOT_COLS * PITCH + 2, TOP + (LOT_ROWS * PITCH) / 2];
        pen.label(corner[0], corner[1], corner[0] + 56, corner[1] + 62, ['First production lot', '444 rounds · $43.65 million · 14 Sep 2026'], { color: col.live, u: K.tween(t, LOT_ACT + 1.2, LOT_ACT + 2.1) });
        const mid: Pt = [FX + 2.5 * BAND * PITCH, TOP + ROWS * PITCH * 0.62];
        pen.label(mid[0], mid[1], mid[0] + 48, mid[1] + 46, ['Framework agreement', '12,000 over five years · announced May 2026'], { color: col.ink, u: K.tween(t, 15.4, 16.3) });
        if (banded > 0) pen.tag('Shown as an even split: 2,400 a year', FX + FW - 14, TOP + ROWS * PITCH - 14, { color: col.mark, alpha: banded, align: 'right' });

        /* ================= Instruments ================= */
        phase.set(K.tween(t, LOT_ACT, LOT_ACT + 0.7) + K.tween(t, BOOK, BOOK + 0.7));
        lot.set(count);
        lot.bar(filled);
        const told = K.tween(t, 10.3, 11.5, 'out');
        each.set(PER_ROUND_K * told);
        each.alpha(0.35 + 0.65 * K.tween(t, 10.2, 10.7));
        const booked = K.tween(t, BOOK + 0.2, 16.6, 'inOutSine');
        book.set(Math.max(count * (t >= BOOK ? 1 : 0), FRAMEWORK * booked));
        book.bar(t >= BOOK ? LOT / FRAMEWORK : 0);
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
