// Shared helpers for the tools: build a private copy, open it headless, drive it
// through the deterministic WINS.debug hooks.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Playwright is a tool dependency, not a build dependency: use a global install if there is one.
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export const PROJECT_IDS = ['fury', 'leonidas', 'ward-250', 'talon-a2', 'varda-w5', 'lucas', 'quarterhorse', 'marauder', 'victus-haze', 'blackbeard'];
export const SINGLE = 'ten-wins-in-motion.html';

/** Build the single-file page into a private temp folder; returns the file path. */
export function buildSingle() {
  const dir = mkdtempSync(join(tmpdir(), 'wins-build-'));
  execFileSync('node', [join(ROOT, 'scripts', 'build.mjs'), '--out', dir, '--single', '--quiet'], { stdio: 'inherit' });
  return join(dir, SINGLE);
}
export const cleanup = (file) => rmSync(dirname(file), { recursive: true, force: true });

/** Parse `--name value` and `--flag` arguments. */
export function args(defaults = {}) {
  const out = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) out[argv[i].slice(2)] = true;
    else out[argv[i++].slice(2)] = next;
  }
  return out;
}

export async function open(url, opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: Number(opts.width) || 1440, height: Number(opts.height) || 900 },
    deviceScaleFactor: Number(opts.scale) || 1,
    reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e && e.stack ? e.stack : e)));
  await page.goto(url.startsWith('http') ? url : 'file://' + url);
  await page.waitForFunction(() => window.WINS && window.WINS.ready);
  await page.evaluate(() => window.WINS.ready);
  return { browser, context, page, errors };
}

/** Put a film on an exact frame and wait for it to be painted. Returns its duration. */
export async function show(page, id, t, idle = 0) {
  const duration = await page.evaluate(([i, tt, ii]) => window.WINS.debug.show(i, tt, ii), [id, t, idle]);
  await settle(page);
  return duration;
}
export async function seek(page, t, idle = 0) {
  await page.evaluate(([tt, ii]) => window.WINS.debug.seek(tt, ii), [t, idle]);
  await settle(page);
}
export const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
