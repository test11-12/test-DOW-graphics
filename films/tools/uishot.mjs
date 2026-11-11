// Dev helper: screenshot the interactive player page (not render mode) at a given viewport.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [film, out, w = '1280', h = '720', action = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = []; page.on('console', m => { if (m.type() !== 'log' && !/deprecated|GPU stall/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); }); page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto('file://' + path.join(root, 'dist', `${film}.offline.html`) + '?nres=1024');
await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 600000 });
await page.screenshot({ path: out + '_start.png' });
if (action === 'play') {
  await page.click('#btn-start'); await page.waitForTimeout(6000);
  const st = await page.evaluate(() => ({ t: window.FILM.film.t, playing: window.FILM.film.playing, scale: window.FILM.film.scale, w: window.FILM.film.pipe.w, h: window.FILM.film.pipe.h, sound: !!window.FILM.film.soundtrack }));
  console.log(JSON.stringify(st));
  await page.mouse.move(200, 200); await page.waitForTimeout(300);
  await page.screenshot({ path: out + '_play.png' });
}
console.log(logs.slice(0, 20).join('\n') || 'no console errors');
await browser.close();
