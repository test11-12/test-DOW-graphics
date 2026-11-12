// Offline renderer: steps a built film frame by frame in headless Chromium and encodes an MP4.
//   node tools/render.mjs <film> [--w=1920 --h=1080 --fps=30 --from=0 --to=<s> --workers=2 --nres=4096]
//                                 [--quality=95 --crf=17 --out=out/<film>.mp4 --force --frames-only --encode-only]
//                                 [--accum=N --ss=K --filter=R] [--gpu --channel=chromium|chrome --angle=vulkan|gl-egl|d3d11 ...]
// Frames are cached in films/frames/<film>/<w>x<h>@<fps>/ so a re-run only renders what is missing (with --accum or
// --ss, in <w>x<h>@<fps>_a<N>_ss<K>/). --accum=N: every frame is the mean of N sub-renders jittered over the shutter,
// the pixel (tent filter of radius R output pixels, default 1), the lens aperture and the solar disc; --ss=K: rendered
// at K x the size and filtered down. --gpu: WebGL on the real GPU, refused if it turns out to be a software rasteriser
// (see tools/gpu.mjs); workers default to 4. A frame that fails (lost WebGL context, crashed browser) is retried once
// in a fresh browser; frames are written whole (temporary name, then rename), so a re-run resumes safely.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser, checkGL } from './gpu.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), film = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const s = a.slice(2), i = s.indexOf('='); return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]; }));   // values may hold '=' (--gpu-args)
const W = +(opt.w || 1920), H = +(opt.h || 1080), FPS = +(opt.fps || 30), workers = +(opt.workers || (opt.gpu ? 4 : 2)), Q = +(opt.quality || 95);
const ACC = Math.max(1, Math.round(+opt.accum || 1)), SS = Math.max(1, +opt.ss || 1), acc = ACC > 1 || SS > 1 ? { accum: ACC, ss: SS, ...(opt.filter ? { filter: +opt.filter } : {}) } : null;
const dir = path.join(root, 'frames', film, `${W}x${H}@${FPS}` + (acc ? `_a${ACC}_ss${SS}` + (opt.filter ? `_f${opt.filter}` : '') : '')); fs.mkdirSync(dir, { recursive: true });
const out = path.resolve(root, opt.out || `out/${film}.mp4`); fs.mkdirSync(path.dirname(out), { recursive: true });
const url = pathToFileURL(path.join(root, 'dist', `${film}.offline.html`)).href + '?' + new URLSearchParams({ render: '1', w: W, h: H, ...(opt.nres ? { nres: opt.nres } : {}), ...(opt.msaa ? { msaa: opt.msaa } : {}) });
const fname = i => path.join(dir, `f_${String(i).padStart(6, '0')}.jpg`);

let glShown = false;
// a browser with the film loaded; with --gpu the film's own WebGL context is checked every time (a browser that
// fell back to a software rasteriser after a GPU-process crash is refused, see tools/gpu.mjs)
async function open() {
  const browser = await launchBrowser(opt, ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']);
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  if (!glShown || opt.gpu) { await checkGL(page, opt, glShown ? '' : 'probe', glShown); }
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 600000 });
  await page.evaluate(() => window.FILM.ready);
  if (opt.gpu) await checkGL(page, opt, 'film', glShown);
  glShown = true;
  return { browser, page };
}
// one frame to disk: render, screenshot, write to a temporary name and rename, so a frame on disk is always complete
// (a re-run skips the frames that exist). renderFrame throws if the WebGL context was lost (driver reset, Windows
// TDR, GPU-process crash), so a black or stale canvas is never saved.
async function frameToDisk(page, i) {
  await page.evaluate(([t, o]) => window.FILM.renderFrame(t, o), [i / FPS, acc]);
  const buf = await page.screenshot({ type: 'jpeg', quality: Q });
  const tmp = fname(i) + '.tmp'; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, fname(i));
}

const t0 = Date.now();
const first = await open();
const duration = await first.page.evaluate(() => window.FILM.duration);
const from = Math.round(+(opt.from || 0) * FPS), to = Math.min(Math.round(+(opt.to || duration) * FPS), Math.floor(duration * FPS));
let todo = []; for (let i = from; i < to; i++) if (opt.force || !fs.existsSync(fname(i))) todo.push(i);
console.log(`${film}: ${W}x${H}@${FPS}${acc ? `, accum ${ACC}, ss ${SS}` : ''}, frames ${from}..${to - 1}, ${todo.length} to render, ${workers} worker(s)`);

if (!opt['encode-only'] && todo.length) {
  // contiguous chunks per worker keep per-shot caches (IBL, terrain sector) warm
  const chunks = Array.from({ length: workers }, () => []); const per = Math.ceil(todo.length / workers);
  todo.forEach((f, k) => chunks[Math.min(workers - 1, Math.floor(k / per))].push(f));
  let done = 0; const total = todo.length;
  const run = async (list, sess) => {
    let s = sess || await open(), n = 0;
    for (const i of list) {
      try { await frameToDisk(s.page, i); }
      catch (e) {
        // lost context, crashed page or browser: drop anything half-written, start a fresh browser (re-checked
        // under --gpu) and try the frame once more; a second failure stops the render
        console.error(`  frame ${i}: ${String(e.message || e).split('\n')[0]}; restarting the browser and retrying once`);
        for (const f of [fname(i), fname(i) + '.tmp']) if (fs.existsSync(f)) fs.rmSync(f);
        try { await s.browser.close(); } catch (e2) { /* already gone */ }
        s = await open();
        try { await frameToDisk(s.page, i); }
        catch (e2) { console.error(`  frame ${i} failed again (${String(e2.message || e2).split('\n')[0]}); stopping. Re-run to resume.`); try { await s.browser.close(); } catch (e3) { /* gone */ } process.exit(4); }
      }
      done++;
      if (opt.gpu && ++n % 200 === 0) await checkGL(s.page, opt, 'film', true);   // still on the GPU?
      if (done % 25 === 0 || done === total) { const el = (Date.now() - t0) / 1000; console.log(`  ${done}/${total}  ${(el / done).toFixed(2)} s/frame  eta ${Math.round((total - done) * el / done / 60)} min`); }
    }
    await s.browser.close();
  };
  await Promise.all(chunks.map((c, k) => c.length ? run(c, k === 0 ? first : null) : (k === 0 ? first.browser.close() : null)));
} else if (!opt['frames-only']) { /* keep `first` for audio */ }

if (opt['frames-only']) { try { await first.browser.close(); } catch (e) { /* closed */ } process.exit(0); }

// soundtrack
const wav = path.join(dir, 'audio.wav');
if (opt.force || opt.audio || !fs.existsSync(wav)) {
  const s = await open();
  const parts = await s.page.evaluate(() => window.FILM.audioChunks());
  fs.writeFileSync(wav, Buffer.concat(parts.map(p => Buffer.from(p, 'base64'))));
  await s.browser.close();
  console.log('audio', (fs.statSync(wav).size / 1e6).toFixed(1), 'MB');
}
try { await first.browser.close(); } catch (e) { /* closed */ }

const missing = []; for (let i = from; i < to; i++) if (!fs.existsSync(fname(i))) missing.push(i);
if (missing.length) { console.error('missing frames:', missing.slice(0, 20).join(','), missing.length > 20 ? '…' : ''); process.exit(1); }
const ff = ['-y', '-v', 'error', '-framerate', String(FPS), '-start_number', String(from), '-i', path.join(dir, 'f_%06d.jpg'), '-ss', String(from / FPS), '-i', wav,
  '-frames:v', String(to - from), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(opt.crf || 17), '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-af', 'alimiter=limit=0.82:attack=2:release=60:level=false', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out];
const r = spawnSync('ffmpeg', ff, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('wrote', out, (fs.statSync(out).size / 1e6).toFixed(1), 'MB in', Math.round((Date.now() - t0) / 1000), 's');
