// Final frames with the Cycles heroes composited into the engine's own frame (engine/hero.js does the compositing,
// in linear light with depth, before atmosphere, effects, depth of field, motion blur, bloom and grade).
//   node tools/composite.mjs <film> --hero=<folder of hero_<frame>.bin> [--w=1920 --h=1080] [--nres=4096] [--heroes=1]
//                                   [--fps=<export fps>] [--out=<prefix>] [--compare] [--canvas] [--gpu ...] t1 t2 …
// --heroes and --fps default to what the layers were rendered for (layer.json); a different --heroes is refused, and
// each time is snapped to the layers' frame grid. Writes <prefix>_<nn>.png per time. --compare also renders the film
// as built (engine heroes) and the plate (no heroes) and writes <prefix>_<nn>_engine.png, _plate.png, _comp.png and
// _sheet.png (engine | composite).
// For a whole sequence and the MP4: node tools/render.mjs <film> --hero=<folder> (same switch, frame cache apart).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, checkGL } from './gpu.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), film = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const s = a.slice(2), i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));
const times = args.filter(a => !a.startsWith('--') && a !== film).map(Number);
if (!film || !opt.hero || !times.length) { console.error('usage: node tools/composite.mjs <film> --hero=<folder> [--w --h --nres --heroes --out --compare --canvas] t1 t2 …'); process.exit(2); }
const W = +(opt.w || 1920), H = +(opt.h || 1080);
const heroDir = path.resolve(process.cwd(), opt.hero), prefix = path.resolve(process.cwd(), opt.out || path.join(heroDir, '..', 'comp', film));
fs.mkdirSync(path.dirname(prefix), { recursive: true });
// What the layers were rendered for: blender/hero_shot.py's layer.json beside them, else the export's shots.json above.
// The hero selection must be the export's (else the engine hides meshes Cycles did not render, or draws ones it did);
// 'all' is refused because Cycles never renders code-built meshes, which it would hide.
const canon = v => { const s = String(v || '1'); return s === '1' || s === 'all' ? s : [...new Set(s.split(',').filter(Boolean))].sort().join(','); };
const die = m => { console.error(m); process.exit(2); };
function layerInfo(dir) {
  for (const f of [path.join(dir, 'layer.json'), path.join(dir, '..', 'shots.json')]) {
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { file: f, film: j.film, fps: +j.fps, size: j.size, select: canon(j.select) };
  }
  return null;
}
function heroSelect(heroDir, film, wanted) {
  const info = layerInfo(heroDir), select = canon(wanted || info?.select);
  if (select === 'all') die('--heroes=all would hide the code-built moving meshes too, which Cycles never renders (they have no .glb): they would vanish. Use it for a plate only (?nohero=all).');
  if (info && info.film && info.film !== film) die(`${info.file} is an export of ${info.film}, not ${film}`);
  if (info && select !== info.select) die(`--heroes=${select} differs from the selection the layers were rendered for (--heroes=${info.select}, ${info.file}). Leave --heroes out, or export and render again with it.`);
  if (!info) console.warn(`note: no layer.json or ../shots.json beside ${heroDir}; the selection is not checked here (each layer's header still is)`);
  return { info, select };
}
const { info, select } = heroSelect(heroDir, film, opt.heroes);
const FPS = +(opt.fps || info?.fps || 0);   // the frame grid the layers are numbered on (0: the film's own, read below)

const browser = await launchBrowser(opt, ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], ['--allow-file-access-from-files']);   // --gpu: WebGL on the real GPU (tools/gpu.mjs)
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
if (opt.gpu) await checkGL(page, opt);
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' || /hero/i.test(m.text())) console.error('[console]', m.text()); });
const q = new URLSearchParams({ render: '1', w: W, h: H, nohero: select, herolayer: pathToFileURL(heroDir).href + '/', ...(FPS ? { herofps: FPS } : {}), ...(opt.nres ? { nres: opt.nres } : {}), ...(opt.q ? Object.fromEntries(new URLSearchParams(opt.q)) : {}) });
const t0 = Date.now();
await page.goto(pathToFileURL(path.join(root, 'dist', `${film}.offline.html`)).href + '?' + q);
await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 1800000 });
await page.evaluate(() => window.FILM.ready);
console.log(`${film}: page ready in ${Math.round((Date.now() - t0) / 1000)} s`);
// a still is rendered on the layers' frame grid: off the grid the engine would pose the scene up to a frame later
// than the Cycles hero it loads (floor(t * fps)), misregistering it against the plate and the smoke
const fps = FPS || await page.evaluate(() => window.FILM.fps);
const snap = t => { const s = Math.floor(t * fps + 1e-6) / fps; if (Math.abs(s - t) > 1e-6) console.log(`  t=${t} snapped to the ${fps} fps frame grid: t=${+s.toFixed(6)} (frame ${Math.round(s * fps)})`); return s; };
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
for (const t0 of times) {
  const t = snap(t0), p = `${prefix}_${String(i++).padStart(2, '0')}`;
  if (!opt.compare) { await shot(t, 'composite', `${p}.png`); continue; }
  await shot(t, 'off', `${p}_engine.png`); await shot(t, 'plate', `${p}_plate.png`); await shot(t, 'composite', `${p}_comp.png`);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', `${p}_engine.png`, '-i', `${p}_comp.png`, '-filter_complex', 'hstack=inputs=2', `${p}_sheet.png`], { stdio: 'inherit' });
  if (r.status === 0) console.log(`  ${path.relative(process.cwd(), p)}_sheet.png  (engine | composite)`);
}
await browser.close();
