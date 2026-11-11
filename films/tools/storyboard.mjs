// Storyboard builder: one still per shot plus a markdown shot list with the narration.
//   node tools/storyboard.mjs <film> [--w=960 --h=540 --nres=2048]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), film = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
const W = +(opt.w || 960), H = +(opt.h || 540);
const dir = path.join(root, 'storyboards', film); fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(root, 'dist', `${film}.offline.html`) + '?' + new URLSearchParams({ render: '1', w: W, h: H, nres: opt.nres || 2048 }));
await page.waitForFunction(() => window.FILM && window.FILM.ready, null, { timeout: 600000 });
await page.evaluate(() => window.FILM.ready);
const { shots, duration } = await page.evaluate(() => ({ shots: window.FILM.shots, duration: window.FILM.duration }));
const meta = JSON.parse(fs.readFileSync(path.join(root, 'src', `${film}.meta.json`), 'utf8'));
const narr = JSON.parse(fs.readFileSync(path.join(root, 'narration', `${film}.json`), 'utf8')).lines;
const tc = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
let md = `# ${meta.headline} — storyboard\n\n${meta.kicker}. Runtime ${tc(duration)}. ${meta.dek}\n\nStills are frames from the film (simulated visualization, not actual footage).\n\n| # | Time | Shot | Picture | Narration |\n|---|---|---|---|---|\n`;
const files = [];
for (let i = 0; i < shots.length; i++) {
  const s = shots[i], t = s.t0 + (s.t1 - s.t0) * (s.still ?? 0.55), f = path.join(dir, `${String(i + 1).padStart(2, '0')}_${s.id}.jpg`);
  await page.evaluate(t => window.FILM.renderFrame(t), t);
  await page.screenshot({ path: f, type: 'jpeg', quality: 88 });
  files.push(f);
  const vo = narr.filter(l => l.t >= s.t0 - 0.01 && l.t < s.t1).map(l => l.text).join(' ');
  md += `| ${i + 1} | ${tc(s.t0)}–${tc(s.t1)} | **${s.name}**<br>![${s.name}](${film}/${path.basename(f)}) | ${s.note} | ${vo || '—'} |\n`;
  console.log(path.basename(f));
}
await browser.close();
fs.writeFileSync(path.join(root, 'storyboards', `${film}.md`), md);
// contact sheet
const cols = 4, rows = Math.ceil(files.length / cols);
const inputs = files.flatMap(f => ['-i', f]);
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', `${files.map((_, i) => `[${i}:v]scale=640:360[v${i}]`).join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join('|')}:fill=black`, '-q:v', '3', path.join(root, 'storyboards', `${film}_sheet.jpg`)], { stdio: 'inherit' });
console.log('wrote storyboards/' + film + '.md', r.status === 0 ? 'and contact sheet' : '(contact sheet failed)');
