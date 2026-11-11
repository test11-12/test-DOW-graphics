// Dev helper: cost of a film frame under different settings, measured as CPU seconds spent by the
// browser's processes (the software GPU renders on every core), which holds up when other work shares
// the machine; wall time is printed too.
//   node tools/bench.mjs <film> <t> [--w=960 --h=540 --n=3] "<query>" "<query>" ...
// Each query is a URL parameter string (e.g. "off=refl,wake" or "waves=6"); "" is the baseline.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const film = args.shift(), T = parseFloat(args.shift());
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const s = a.slice(2), i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));
const queries = args.filter(a => !a.startsWith('--'));
if (!queries.length) queries.push('');
const W = +(opt.w || 960), H = +(opt.h || 540), N = +(opt.n || 3);
const TICK = 100;   // USER_HZ

const stat = pid => { try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'), f = s.slice(s.lastIndexOf(')') + 2).split(' '); return { ppid: +f[1], cpu: (+f[11] + +f[12]) / TICK }; } catch { return null; } };
// CPU seconds used so far by every process descended from this one
function treeCPU() {
  const procs = new Map();
  for (const d of fs.readdirSync('/proc')) if (/^\d+$/.test(d)) { const s = stat(d); if (s) procs.set(+d, s); }
  const kids = new Map(); for (const [pid, s] of procs) { if (!kids.has(s.ppid)) kids.set(s.ppid, []); kids.get(s.ppid).push(pid); }
  let sum = 0; const walk = p => { for (const c of kids.get(p) || []) { sum += procs.get(c).cpu; walk(c); } };
  walk(process.pid); return sum;
}

const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const rows = [];
for (const qs of queries) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const q = new URLSearchParams({ render: '1', w: W, h: H, ...Object.fromEntries(new URLSearchParams(qs)) });
  await page.goto('file://' + path.join(root, 'dist', `${film}.offline.html`) + '?' + q);
  await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 900000 });
  await page.evaluate(() => window.FILM.ready);
  await page.evaluate(t => window.FILM.renderFrame(t, {}), T);                  // warm-up: shader compiles, caches
  await page.evaluate(() => { const gl = window.FILM.film.pipe.renderer.getContext(); gl.finish(); });
  const c0 = treeCPU(), w0 = Date.now();
  for (let i = 0; i < N; i++) await page.evaluate(t => { window.FILM.renderFrame(t, {}); const gl = window.FILM.film.pipe.renderer.getContext(); gl.finish(); }, T);
  const cpu = (treeCPU() - c0) / N, wall = (Date.now() - w0) / N / 1000;
  rows.push({ qs, cpu, wall });
  console.log(`${(qs || '(baseline)').padEnd(48)} cpu ${cpu.toFixed(2).padStart(6)} s/frame   wall ${wall.toFixed(2).padStart(6)} s/frame`);
  await page.close();
}
if (rows.length > 1) { const b = rows[0].cpu; for (const r of rows.slice(1)) console.log(`  ${(r.qs).padEnd(46)} saves ${(b - r.cpu).toFixed(2)} cpu-s (${Math.round(100 * (b - r.cpu) / b)}%)`); }
await browser.close();
