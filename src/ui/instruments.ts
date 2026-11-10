/* The instrument rail: small coordinated readouts beside a film's main field.

   Instruments are plain DOM (real text, readable by assistive technology) inside
   the film's HTML layer, so they scale with the stage. Every setter is cheap and
   idempotent: a film calls them each frame with values derived from time. */
import * as K from '../core/kit.ts';

export type Tone = 'mark' | 'old' | 'ink' | 'muted' | 'alert';
/** 0 empty, 1 mark, 2 old, 3 ink, 4 ring, 5 alert, 6 live */
export type DotState = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** 0 idle, 1 active, 2 done, 3 old way, 4 failed, 5 needs attention */
export type ChipState = 0 | 1 | 2 | 3 | 4 | 5;

/* ---- Odometer: digits that roll as the value changes -----------------------
   The picture is a pure function of the value, so it scrubs like everything else. */
const ROLL = 0.32;
/** The width of one tabular numeral, in ems of the display face. */
const DIGIT = 0.64;
export class Odometer {
  el: HTMLElement;
  private strips: HTMLElement[] = [];
  private cols: HTMLElement[] = [];
  private slots: number;
  private decimals: number;
  private pad: boolean;
  private last = NaN;

  constructor(parent: Element, o: { slots?: number; decimals?: number; pad?: boolean } = {}) {
    this.slots = o.slots ?? 3;
    this.decimals = o.decimals ?? 0;
    this.pad = !!o.pad;
    this.el = K.h('span', 'odo', parent);
    this.el.setAttribute('role', 'text');
    for (let p = this.slots - 1; p >= 0; p--) {
      if (this.decimals && p === this.decimals - 1) K.h('span', 'odo-point', this.el, '.');
      const col = K.h('span', 'odo-col', this.el);
      const strip = K.h('span', 'odo-strip', col, '0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n0');
      strip.setAttribute('aria-hidden', 'true');
      this.cols[p] = col;
      this.strips[p] = strip;
    }
  }
  set(value: number): void {
    const v = Math.max(0, value) * Math.pow(10, this.decimals);
    if (Math.abs(v - this.last) < 1e-4) return;
    this.last = v;
    for (let p = 0; p < this.slots; p++) {
      const unit = Math.pow(10, p);
      const base = Math.floor(v / unit + 1e-9) % 10;
      // A digit rests on a whole number and turns in the last part of each step; higher
      // digits turn with the 9-to-0 roll beneath them.
      const lower = v % unit;
      const turn = K.ease.inOut(K.clamp((lower - (unit - ROLL)) / ROLL));
      const offset = base + turn;
      K.style(this.strips[p], 'transform', `translateY(${(-offset).toFixed(3)}em)`);
      const always = this.pad || p <= this.decimals;
      const presence = always ? 1 : K.clamp(v - (unit - 1));
      K.style(this.cols[p], 'width', `${(presence * DIGIT).toFixed(3)}em`);
      K.style(this.cols[p], 'opacity', presence.toFixed(3));
    }
    K.attr(this.el, 'aria-label', (v / Math.pow(10, this.decimals)).toFixed(this.decimals));
  }
}

export interface Stat {
  el: HTMLElement;
  set(value: number): void;
  /** Fill the bar under the number, 0..1. */
  bar(u: number): void;
  tone(t: Tone): void;
  alpha(a: number): void;
  /** Change the small text after the number. */
  unit(text: string): void;
}
export interface Rail {
  el: HTMLElement;
  /** A tag naming the current phase; pass a fractional position to slide between labels. */
  phase(label: string, names: string[]): { set(position: number): void };
  stat(o: { label: string; unit?: string; prefix?: string; tone?: Tone; slots?: number; decimals?: number; bar?: boolean; size?: 'l' | 'm' | 's' }): Stat;
  /** Hours and minutes, as 00:00. */
  clock(o: { label: string; tone?: Tone; unit?: string }): { el: HTMLElement; set(hours: number): void };
  /** A row of small dots, one per thing. */
  dots(o: { label: string; count: number; legend?: string }): { el: HTMLElement; set(i: number, state: DotState): void; legend(text: string): void };
  chips(o: { label: string; items: string[] }): { el: HTMLElement; set(i: number, state: ChipState): void };
  /** A short record of events: each row lights when it happens and can carry a time stamp. */
  log(o: { label: string; items: string[] }): { el: HTMLElement; set(i: number, on: boolean, stamp?: string): void };
  /** A small canvas for a chart drawn by the film, in CSS pixels. */
  chart(o: { label: string; height: number }): { el: HTMLElement; g: CanvasRenderingContext2D; w: number; h: number; clear(): void };
  /** Two columns of stats side by side. */
  pair(): Rail;
  note(text: string): HTMLElement;
  /** An empty section for custom content. */
  group(label?: string): HTMLElement;
}

export const RAIL_W = 332;

function build(el: HTMLElement, width: number): Rail {
  const section = (cls: string, label?: string): HTMLElement => {
    const s = K.h('div', 'ins ' + cls, el);
    if (label) K.h('span', 'ins-label', s, label);
    return s;
  };
  const rail: Rail = {
    el,
    phase(label, names) {
      const s = section('ins-phase', label);
      const win = K.h('div', 'phase-window', s);
      const items = names.map((n) => K.h('span', '', win, n));
      return {
        set(position) {
          items.forEach((it, i) => {
            const d = i - position;
            K.set(it, { y: d * 30, opacity: 1 - Math.min(1, Math.abs(d) * 1.7) });
          });
        },
      };
    },
    stat(o) {
      const s = section(`ins-stat tone-${o.tone ?? 'mark'} size-${o.size ?? 'l'}`, o.label);
      const row = K.h('div', 'ins-value', s);
      if (o.prefix) K.h('small', 'ins-prefix', row, o.prefix);
      const odo = new Odometer(row, { slots: o.slots ?? 3, decimals: o.decimals });
      const unit = K.h('small', 'ins-unit', row, o.unit ?? '');
      const fill = o.bar ? K.h('i', '', K.h('div', 'ins-bar', s)) : null;
      let tone = o.tone ?? 'mark';
      return {
        el: s,
        set: (v) => odo.set(v),
        bar(u) {
          if (fill) K.style(fill, 'transform', `scaleX(${K.clamp(u).toFixed(4)})`);
        },
        tone(t) {
          if (t === tone) return;
          s.classList.remove('tone-' + tone);
          s.classList.add('tone-' + t);
          tone = t;
        },
        alpha: (a) => K.set(s, { opacity: a }),
        unit: (text) => K.text(unit, text),
      };
    },
    clock(o) {
      const s = section(`ins-stat tone-${o.tone ?? 'mark'} size-l`, o.label);
      const row = K.h('div', 'ins-value', s);
      const hh = new Odometer(row, { slots: 2, pad: true });
      K.h('span', 'odo-point', row, ':');
      const mm = new Odometer(row, { slots: 2, pad: true });
      K.h('small', 'ins-unit', row, o.unit ?? 'h');
      return {
        el: s,
        set(hours) {
          const total = Math.floor(Math.max(0, hours) * 60 + 1e-6);
          hh.set(Math.floor(total / 60));
          mm.set(total % 60);
        },
      };
    },
    dots(o) {
      const s = section('ins-dots', o.label);
      const row = K.h('div', 'dots', s);
      const items = Array.from({ length: o.count }, () => K.h('i', '', row));
      const legend = K.h('span', 'dots-legend', s, o.legend ?? '');
      return {
        el: s,
        set: (i, state) => {
          if (items[i]) K.attr(items[i], 'data-s', String(state));
        },
        legend: (text) => K.text(legend, text),
      };
    },
    chips(o) {
      const s = section('ins-chips', o.label);
      const row = K.h('div', 'chips', s);
      const items = o.items.map((name) => K.h('span', 'chip', row, name));
      return { el: s, set: (i, state) => items[i] && K.attr(items[i], 'data-s', String(state)) };
    },
    log(o) {
      const s = section('ins-log', o.label);
      const list = K.h('div', 'log', s);
      const rows = o.items.map((text) => {
        const row = K.h('div', 'log-row', list);
        K.h('i', '', row);
        K.h('span', '', row, text);
        return { row, stamp: K.h('em', '', row) };
      });
      return {
        el: s,
        set(i, on, stamp) {
          if (!rows[i]) return;
          K.attr(rows[i].row, 'data-on', on ? '1' : '0');
          K.text(rows[i].stamp, on && stamp ? stamp : '');
        },
      };
    },
    chart(o) {
      const s = section('ins-chart', o.label);
      const c = K.h('canvas', '', s);
      c.setAttribute('aria-hidden', 'true');
      const ratio = 2;
      c.width = width * ratio;
      c.height = o.height * ratio;
      c.style.width = width + 'px';
      c.style.height = o.height + 'px';
      const g = c.getContext('2d')!;
      return {
        el: s,
        g,
        w: width,
        h: o.height,
        clear() {
          g.setTransform(ratio, 0, 0, ratio, 0, 0);
          g.clearRect(0, 0, width, o.height);
        },
      };
    },
    pair() {
      const row = K.h('div', 'ins ins-pair', el);
      return build(row, (width - 20) / 2);
    },
    note: (text) => K.h('p', 'ins-note', el, text),
    group: (label) => section('ins-group', label),
  };
  return rail;
}

/** Create the rail inside a film's HTML layer. */
export function createRail(html: HTMLElement): Rail {
  const el = K.h('div', 'rail', html);
  return build(el, RAIL_W);
}
