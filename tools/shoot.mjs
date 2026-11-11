#!/usr/bin/env node
// Capture exact frames of one film, plus a contact sheet for reviewing motion.
//
//   node tools/shoot.mjs --scene victus-haze                 12 evenly spaced frames of the stage
//   node tools/shoot.mjs --scene victus-haze --t 0,4.5,9     chosen story times (seconds)
//   node tools/shoot.mjs --scene victus-haze --page          the whole page instead of the stage
//   node tools/shoot.mjs --scene fury --gate 2               also each gate, after waiting 2 s
//   Options: --count 12, --idle 3, --out dir, --width 1440, --height 900, --scale 1
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, args, buildSingle, cleanup, hold, open, seek, show } from './lib.mjs';

const a = args({ count: 12 });
if (!a.scene) {
  console.error('Usage: node tools/shoot.mjs --scene <id> [--t 0,3,6] [--count 12] [--page] [--out dir]');
  process.exit(2);
}
const outDir = resolve(a.out || join(ROOT, 'out', 'frames', a.scene));
mkdirSync(outDir, { recursive: true });
const file = buildSingle();
const { browser, context, page, errors } = await open(file, a);
try {
  const duration = await show(page, a.scene, 0);
  const idle = Number(a.idle) || 0;
  const times = a.t ? String(a.t).split(',').map(Number) : Array.from({ length: Number(a.count) }, (_, i) => +((duration * i) / (Number(a.count) - 1)).toFixed(2));
  const target = a.page ? page.locator('#app') : page.locator('.stage-frame');
  const shots = [];
  for (const t of times) {
    await seek(page, t, t >= duration ? idle : 0);
    const caption = await page.evaluate(() => document.getElementById('caption').textContent);
    const name = `${a.scene}@${t.toFixed(2).padStart(5, '0')}.png`;
    await target.screenshot({ path: join(outDir, name) });
    shots.push({ t, name, caption });
  }
  // The states a time alone cannot reach: the film standing at a gate, waiting for the viewer.
  if (a.gate != null && a.gate !== false) {
    const waited = Number(a.gate) || 1.5;
    for (let from = 0, at; (at = await hold(page, from, waited)) != null; from = at + 0.01) {
      const name = `${a.scene}@gate-${at.toFixed(2).padStart(5, '0')}.png`;
      await target.screenshot({ path: join(outDir, name) });
      shots.push({ t: at, name, caption: `waiting at the gate (${waited} s)` });
    }
  }
  const sheet = await context.newPage();
  const cols = shots.length <= 4 ? 2 : shots.length <= 12 ? 3 : 4;
  const cells = shots.map((s) => `<figure><img src="data:image/png;base64,${readFileSync(join(outDir, s.name)).toString('base64')}"><figcaption><b>${s.t.toFixed(1)}s</b> ${s.caption.replace(/</g, '&lt;')}</figcaption></figure>`).join('');
  await sheet.setViewportSize({ width: cols * 640, height: 800 });
  await sheet.setContent(`<style>body{margin:0;padding:8px;background:#000;display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;font:12px/1.3 system-ui;color:#9fb3c4}figure{margin:0}img{width:100%;display:block;border:1px solid #1b2f41}figcaption{padding:4px 2px 2px}b{color:#fff;margin-right:6px}</style>${cells}`);
  const sheetPath = join(outDir, `${a.scene}-sheet.png`);
  await sheet.screenshot({ path: sheetPath, fullPage: true });
  console.log(`${a.scene}: ${duration}s, ${shots.length} frames -> ${outDir}\nSheet: ${sheetPath}`);
  if (errors.length) {
    console.log(`Console errors (${errors.length}):`);
    errors.slice(0, 8).forEach((e) => console.log('  ' + e.split('\n').slice(0, 2).join(' | ')));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  cleanup(file);
}
