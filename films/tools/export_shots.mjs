// Exports what blender/hero_shot.py needs to path-trace a film's heroes with the film's own cameras and light:
//   node tools/export_shots.mjs <film> [--from=<s> --to=<s> | --times=17,48.6] [--fps=<film fps>] [--w=1920 --h=1080]
//                                      [--nres=4096] [--heroes=1] [--env=1024] [--pad=1] [--out=heroes/<film>]
// Runs the built page (dist/<film>.offline.html) headless at a small size with the target aspect and, for every frame
// on the fps grid in [from, to) (or at each of --times), plus --pad frames either side (motion-blur keys), writes
//   frame_<frame>.json   camera (absolute position = floating origin + local, quaternion, vertical fov, aspect,
//                        near, far), sun (direction, linear irradiance), ground or sea level under the camera and the
//                        heroes, the shot's grade numbers (exposure, shutter, dof), every visible glTF node instance
//                        (asset, node index, absolute world matrix, hero or set piece, emissive state), and every
//                        registered moving object as a named transform (also the code-built ones)
//   env_<key>.hdr        the engine's reflection environment for that shot, equirectangular (see engine/hero.js)
//   shots.json           the index: film, fps, size, frames, assets
// Matrices are three.js column-major arrays in the engine's axes (+x east, +y up, +z south), metres.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), film = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const s = a.slice(2), i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));
if (!film) { console.error('usage: node tools/export_shots.mjs <film> [--from --to | --times=a,b] [--fps --w --h --nres --heroes --env --pad --out]'); process.exit(2); }
const W = +(opt.w || 1920), H = +(opt.h || 1080), PW = 320, PH = Math.max(2, Math.round(PW * H / W));
const out = path.resolve(root, opt.out || `heroes/${film}`); fs.mkdirSync(out, { recursive: true });
const pad = +(opt.pad ?? 1), envW = +(opt.env || 1024), select = opt.heroes || '1';

// Radiance RGBE, flat scanlines, top row first. rgba: Float32Array, rows bottom to top.
function writeHDR(file, w, h, rgba) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii'), body = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((h - 1 - y) * w + x) * 4, d = (y * w + x) * 4, r = Math.max(0, rgba[s]), g = Math.max(0, rgba[s + 1]), b = Math.max(0, rgba[s + 2]), m = Math.max(r, g, b);
    if (!(m > 1e-32) || !isFinite(m)) continue;
    const e = Math.floor(Math.log2(m)) + 1, k = Math.pow(2, -e) * 256;
    body[d] = Math.min(255, Math.floor(r * k)); body[d + 1] = Math.min(255, Math.floor(g * k)); body[d + 2] = Math.min(255, Math.floor(b * k)); body[d + 3] = e + 128;
  }
  fs.writeFileSync(file, Buffer.concat([head, body]));
}

const t0 = Date.now();
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: PW, height: PH }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
const q = new URLSearchParams({ render: '1', w: PW, h: PH, ...(opt.nres ? { nres: opt.nres } : {}), ...(opt.q ? Object.fromEntries(new URLSearchParams(opt.q)) : {}) });
await page.goto(pathToFileURL(path.join(root, 'dist', `${film}.offline.html`)).href + '?' + q);
await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 1800000 });
await page.evaluate(() => window.FILM.ready);
const info = await page.evaluate(() => ({ duration: window.FILM.duration, fps: window.FILM.fps }));
const fps = +(opt.fps || info.fps), last = Math.floor(info.duration * fps - 1e-6);
console.log(`${film}: page ready in ${Math.round((Date.now() - t0) / 1000)} s; ${W}x${H}@${fps}`);

const want = new Set();
if (opt.times) for (const s of opt.times.split(',')) want.add(Math.floor(+s * fps + 1e-6));
else { const a = Math.round(+(opt.from || 0) * fps), b = Math.min(Math.round(+(opt.to ?? info.duration) * fps), last + 1); for (let i = a; i < b; i++) want.add(i); }
const all = new Set(); for (const i of want) for (let k = -pad; k <= pad; k++) if (i + k >= 0 && i + k <= last) all.add(i + k);
const frames = [...all].sort((a, b) => a - b), envDone = new Set(), assets = new Set(), index = [];
for (const i of frames) {
  const t = i / fps;
  await page.evaluate(t => window.FILM.renderFrame(t), t);
  const st = await page.evaluate(s => window.FILM.heroState(s), select);
  st.frame = i; st.t = t; st.pad = !want.has(i); st.size = [W, H]; st.camera.aspect = W / H;
  const key = String(st.envKey).replace(/[^\w.-]/g, '_');
  if (!envDone.has(key)) {
    const e = await page.evaluate(w => window.FILM.heroEnv(w), envW);
    const b = Buffer.from(e.b64, 'base64'); writeHDR(path.join(out, `env_${key}.hdr`), e.w, e.h, new Float32Array(b.buffer, b.byteOffset, b.length / 4));
    envDone.add(key);
  }
  st.env = `env_${key}.hdr`;
  for (const n of st.nodes) assets.add(n.asset);
  const file = `frame_${String(i).padStart(6, '0')}.json`;
  fs.writeFileSync(path.join(out, file), JSON.stringify(st));
  index.push({ frame: i, t, shot: st.shot, pad: st.pad, file, heroes: st.nodes.filter(n => n.role === 'hero').length });
  console.log(`  ${file}  t=${t.toFixed(3)}  shot ${st.shot}  heroes ${index[index.length - 1].heroes}  set ${st.nodes.length - index[index.length - 1].heroes}  ground ${st.ground.kind} ${st.ground.level ?? ''}${st.pad ? '  (pad)' : ''}`);
}
const prev = fs.existsSync(path.join(out, 'shots.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'shots.json'), 'utf8')) : null;
const merged = new Map((prev && prev.film === film && prev.fps === fps && prev.size[0] === W && prev.size[1] === H ? prev.frames : []).map(f => [f.frame, f]));
for (const f of index) { const o = merged.get(f.frame); merged.set(f.frame, o && !o.pad ? { ...f, pad: false } : f); }
fs.writeFileSync(path.join(out, 'shots.json'), JSON.stringify({ film, fps, size: [W, H], select, assets: [...new Set([...(prev?.assets || []), ...assets])].sort(), frames: [...merged.values()].sort((a, b) => a.frame - b.frame) }, null, 1));
await browser.close();
console.log(`wrote ${frames.length} frame(s) to ${path.relative(process.cwd(), out) || '.'} in ${Math.round((Date.now() - t0) / 1000)} s`);
