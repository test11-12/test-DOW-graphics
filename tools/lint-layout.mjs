#!/usr/bin/env node
// Find text that is clipped or sits on top of other text, in every film, automatically.
//
//   node tools/lint-layout.mjs                    all ten films, every 0.25 s
//   node tools/lint-layout.mjs --scene si-tools   one film
//   options: --step 0.25  --width 1440 --height 900  --verbose
//
// It records every piece of text a film draws on its canvases, and measures the text
// in the instrument rail and in mock interfaces, then reports:
//   clipped   text that runs past the edge of its canvas, or a rail or panel element
//             whose text is wider than its box
//   overlap   two pieces of text whose boxes intersect
// It cannot judge whether text sits badly on a line or a dot: look at frames for that.
import { PROJECT_IDS, args, buildSingle, cleanup, open, show } from './lib.mjs';

const a = args({ step: 0.25 });
const ids = a.scene ? [String(a.scene)] : PROJECT_IDS;
const file = buildSingle();
const { browser, page, errors } = await open(file, a);

/* In the page: wrap fillText so each call leaves a record of where the text landed. */
await page.evaluate(() => {
  const log = (window.__texts = []);
  const original = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
    try {
      const str = String(text);
      const alpha = this.globalAlpha * (/rgba\([^)]*,\s*([\d.]+)\)/.exec(String(this.fillStyle))?.[1] ?? 1);
      if (str.trim() && alpha >= 0.35) {
        const size = parseFloat(/([\d.]+)px/.exec(this.font)?.[1] ?? '10');
        const w = this.measureText(str).width;
        const x0 = this.textAlign === 'center' ? x - w / 2 : this.textAlign === 'right' || this.textAlign === 'end' ? x - w : x;
        const up = this.textBaseline === 'middle' ? size * 0.5 : this.textBaseline === 'top' ? 0 : size * 0.76;
        const m = this.getTransform();
        const pts = [[x0, y - up], [x0 + w, y - up], [x0, y - up + size * 0.98], [x0 + w, y - up + size * 0.98]].map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        log.push({ str, canvas: this.canvas, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      }
    } catch {
      /* never let the lint break a film */
    }
    return original.call(this, text, x, y, ...rest);
  };
  window.__frame = (t, idle) => {
    log.length = 0;
    window.WINS.debug.seek(t, idle);
    const scene = document.querySelector('.scene:not(.is-leaving)');
    const stage = document.getElementById('stage').getBoundingClientRect();
    const out = [];
    // Canvas text, mapped to page pixels.
    const seen = new Set();
    for (const rec of log) {
      const r = rec.canvas.getBoundingClientRect();
      if (!r.width) continue;
      const k = r.width / rec.canvas.width;
      const box = [r.left + rec.box[0] * k, r.top + rec.box[1] * k, r.left + rec.box[2] * k, r.top + rec.box[3] * k];
      const key = rec.str + '|' + box.map((v) => Math.round(v)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const clipped = box[0] < r.left - 0.5 || box[2] > r.right + 0.5 || box[1] < r.top - 0.5 || box[3] > r.bottom + 0.5;
      out.push({ kind: 'canvas', str: rec.str, box, clipped });
    }
    // Text in the rail and in mock interfaces.
    const walker = document.createTreeWalker(scene, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      const str = node.textContent.trim().replace(/\s+/g, ' ');
      if (!str || !el) continue;
      const cs = getComputedStyle(el);
      let op = 1;
      for (let e = el; e && e !== scene; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      if (cs.visibility === 'hidden' || cs.display === 'none' || op < 0.35) continue;
      if (el.closest('.odo-strip')) continue; // rolling digits are clipped on purpose
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter((q) => q.width > 0.5 && q.height > 0.5).map((q) => [q.left, q.top, q.right, q.bottom]);
      if (!lines.length) continue;
      // What is actually visible of each line, after every clipping ancestor inside the film.
      let wide = false;
      const shown = lines.map((b) => {
        let v = [Math.max(b[0], stage.left), Math.max(b[1], stage.top), Math.min(b[2], stage.right), Math.min(b[3], stage.bottom)];
        for (let e = el; e && e !== scene; e = e.parentElement) {
          const r = e.getBoundingClientRect();
          const hides = getComputedStyle(e).overflow !== 'visible';
          const holder = e.classList.contains('rail') || e.classList.contains('ins') || e.classList.contains('ui-panel');
          if ((holder || hides) && (b[2] > r.right + 1 || b[0] < r.left - 1)) wide = true;
          if (hides) v = [Math.max(v[0], r.left), Math.max(v[1], r.top), Math.min(v[2], r.right), Math.min(v[3], r.bottom)];
        }
        return v;
      });
      const full = lines.reduce((n, b) => n + (b[2] - b[0]) * (b[3] - b[1]), 0);
      const seenArea = shown.reduce((n, b) => n + Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]), 0);
      // A phase label slides through its window on purpose: only its width can be wrong.
      const sliding = !!el.closest('.phase-window');
      for (const v of shown) if (v[2] - v[0] > 0.5 && v[3] - v[1] > 0.5) out.push({ kind: 'html', str, box: v, clipped: wide || (!sliding && seenArea < 0.8 * full) });
    }
    const rail = scene.querySelector('.rail');
    const tall = rail ? rail.scrollHeight - rail.clientHeight : 0;
    return { texts: out.map((o) => ({ ...o, box: o.box.map((v) => Math.round(v * 10) / 10) })), tall };
  };
});

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const meet = (p, q) => area([Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.min(p[2], q[2]), Math.min(p[3], q[3])]);
let total = 0;
for (const id of ids) {
  const duration = await show(page, id, 0);
  const found = new Map(); // message -> [first time, last time, count]
  const note = (msg, t) => {
    const cur = found.get(msg);
    if (cur) (cur[1] = t), cur[2]++;
    else found.set(msg, [t, t, 1]);
  };
  const times = [];
  for (let t = 0; t < duration; t += Number(a.step)) times.push([+t.toFixed(2), 0]);
  times.push([duration, 0], [duration, 4], [duration, 60]);
  for (const [t, idle] of times) {
    const { texts, tall } = await page.evaluate(([tt, ii]) => window.__frame(tt, ii), [t, idle]);
    const label = idle ? t + idle : t;
    if (tall > 1) note(`rail     the instruments are ${tall}px taller than the rail`, label);
    for (const x of texts) if (x.clipped) note(`clipped  ${x.kind}  "${x.str.slice(0, 48)}"`, label);
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const p = texts[i];
        const q = texts[j];
        const shared = meet(p.box, q.box);
        if (p.str !== q.str && shared > 0.22 * Math.min(area(p.box), area(q.box)) && shared > 12) note(`overlap  "${p.str.slice(0, 34)}"  ×  "${q.str.slice(0, 34)}"`, label);
      }
    }
  }
  if (found.size) console.log(`\n${id}`);
  for (const [msg, [from, to, count]] of found) {
    total++;
    console.log(`  ${msg}   [${from === to ? from + 's' : `${from}–${to}s`}, ${count} frame${count > 1 ? 's' : ''}]`);
  }
  if (!found.size && a.verbose) console.log(`\n${id}\n  clean`);
}
if (errors.length) console.log(`\nConsole errors: ${errors.slice(0, 3).join(' | ')}`);
console.log(total ? `\n${total} layout problem${total > 1 ? 's' : ''} found.` : '\nNo clipped or overlapping text in any film.');
await browser.close();
cleanup(file);
process.exit(total || errors.length ? 1 : 0);
