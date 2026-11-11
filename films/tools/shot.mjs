// Dev helper: render single frames of a built film at given times and save PNGs.
//   node tools/shot.mjs <film> <outPrefix> [--w=960 --h=540] [--msaa=4] t1[:json] t2[:json] ...
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const film = args.shift(), prefix = args.shift();
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const s = a.slice(2), i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));
const times = args.filter(a => !a.startsWith('--'));
const W = +(opt.w || 960), H = +(opt.h || 540);
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { const t = m.text(); if (!/GPU stall|GL Driver Message/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
const q = new URLSearchParams({ render: '1', w: W, h: H, ...(opt.q ? Object.fromEntries(new URLSearchParams(opt.q)) : {}), ...(opt.cam ? { cam: opt.cam } : {}), ...(opt.haze ? { haze: opt.haze } : {}), ...(opt.cdiv ? { cdiv: opt.cdiv } : {}), ...(opt.msaa ? { msaa: opt.msaa } : {}), ...(opt.nres ? { nres: opt.nres } : {}), ...(opt.prof ? { prof: 1 } : {}), ...(opt.off ? { off: opt.off } : {}), ...(opt.aniso ? { aniso: opt.aniso } : {}), ...(opt.debug ? { debug: opt.debug } : {}) });
const t0 = Date.now();
await page.goto('file://' + path.join(root, 'dist', `${film}.offline.html`) + '?' + q);
await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 900000 });
await page.evaluate(() => window.FILM.ready);
console.log('ready in', Date.now() - t0, 'ms');
let i = 0;
for (const spec of times) {
  const k = spec.indexOf(':');
  const t = parseFloat(k < 0 ? spec : spec.slice(0, k));
  const o = k < 0 ? {} : JSON.parse(spec.slice(k + 1));
  const t1 = Date.now();
  await page.evaluate(([t, o]) => window.FILM.renderFrame(t, o), [t, o]);
  const ms = Date.now() - t1;
  if (opt.prof) console.log('  prof', JSON.stringify(await page.evaluate(() => { const p = window.FILM.film.pipe.prof; return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v)])); })));
  const out = `${prefix}_${String(i++).padStart(2, '0')}.png`;
  if (opt.canvas) { const b64 = await page.evaluate(() => document.getElementById('view').toDataURL('image/png').split(',')[1]); fs.writeFileSync(out, Buffer.from(b64, 'base64')); }
  else await page.screenshot({ path: out });
  console.log(out, 't=' + t, ms + 'ms');
}
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
