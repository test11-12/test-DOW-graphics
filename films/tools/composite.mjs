// Final frames with the Cycles heroes composited into the engine's own frame (engine/hero.js does the compositing,
// in linear light with depth, before atmosphere, effects, depth of field, motion blur, bloom and grade).
//   node tools/composite.mjs <film> --hero=<folder of hero_<frame>.bin> [--w=1920 --h=1080] [--nres=4096] [--heroes=1]
//                                   [--fps=<export fps>] [--out=<prefix>] [--compare] [--canvas] t1 t2 …
// Writes <prefix>_<nn>.png per time. --compare also renders the film as built (engine heroes) and the plate (no
// heroes) and writes <prefix>_<nn>_engine.png, _plate.png, _comp.png and _sheet.png (engine | composite).
// For a whole sequence and the MP4: node tools/render.mjs <film> --hero=<folder> (same switch, frame cache apart).
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), film = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const s = a.slice(2), i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));
const times = args.filter(a => !a.startsWith('--') && a !== film).map(Number);
if (!film || !opt.hero || !times.length) { console.error('usage: node tools/composite.mjs <film> --hero=<folder> [--w --h --nres --heroes --out --compare --canvas] t1 t2 …'); process.exit(2); }
const W = +(opt.w || 1920), H = +(opt.h || 1080);
const heroDir = path.resolve(process.cwd(), opt.hero), prefix = path.resolve(process.cwd(), opt.out || path.join(heroDir, '..', 'comp', film));
fs.mkdirSync(path.dirname(prefix), { recursive: true });

const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' || /hero/i.test(m.text())) console.error('[console]', m.text()); });
const q = new URLSearchParams({ render: '1', w: W, h: H, nohero: opt.heroes || '1', herolayer: pathToFileURL(heroDir).href + '/', ...(opt.fps ? { herofps: opt.fps } : {}), ...(opt.nres ? { nres: opt.nres } : {}), ...(opt.q ? Object.fromEntries(new URLSearchParams(opt.q)) : {}) });
const t0 = Date.now();
await page.goto(pathToFileURL(path.join(root, 'dist', `${film}.offline.html`)).href + '?' + q);
await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 1800000 });
await page.evaluate(() => window.FILM.ready);
console.log(`${film}: page ready in ${Math.round((Date.now() - t0) / 1000)} s`);
const grab = async file => {
  if (opt.canvas) { const b64 = await page.evaluate(() => document.getElementById('view').toDataURL('image/png').split(',')[1]); fs.writeFileSync(file, Buffer.from(b64, 'base64')); }
  else await page.screenshot({ path: file });
};
const shot = async (t, mode, file) => {
  await page.evaluate(m => window.FILM.heroMode(m), mode);
  const t1 = Date.now(); await page.evaluate(t => window.FILM.renderFrame(t), t); const ms = Date.now() - t1;
  await grab(file); console.log(`  ${path.relative(process.cwd(), file)}  t=${t}  ${mode}  ${ms} ms`);
};
let i = 0;
for (const t of times) {
  const p = `${prefix}_${String(i++).padStart(2, '0')}`;
  if (!opt.compare) { await shot(t, 'composite', `${p}.png`); continue; }
  await shot(t, 'off', `${p}_engine.png`); await shot(t, 'plate', `${p}_plate.png`); await shot(t, 'composite', `${p}_comp.png`);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', `${p}_engine.png`, '-i', `${p}_comp.png`, '-filter_complex', 'hstack=inputs=2', `${p}_sheet.png`], { stdio: 'inherit' });
  if (r.status === 0) console.log(`  ${path.relative(process.cwd(), p)}_sheet.png  (engine | composite)`);
}
await browser.close();
