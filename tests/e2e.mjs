#!/usr/bin/env node
// Browser tests: build everything into a temp folder, then drive it headless.
//   node tests/e2e.mjs            (needs Playwright with Chromium available)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, PROJECT_IDS, SINGLE, open, seek, settle, show } from '../tools/lib.mjs';

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push([true, name]);
  } catch (err) {
    results.push([false, name, String(err && err.message ? err.message : err).split('\n')[0]]);
  }
};
const ok = (cond, message) => {
  if (!cond) throw new Error(message);
};
const wait = (page, ms) => page.waitForTimeout(ms);

const dir = mkdtempSync(join(tmpdir(), 'wins-e2e-'));
execFileSync('node', [join(ROOT, 'scripts', 'build.mjs'), '--out', dir, '--quiet'], { stdio: 'inherit' });
const single = join(dir, SINGLE);
const report = JSON.parse(readFileSync(join(dir, 'build-report.json'), 'utf8'));
const KB = 1024;

/* ---- Size budgets ----------------------------------------------------------- */
await check('budget: first load of the site stays under 32 KB compressed', () => ok(report.site.firstLoad.brotli < 32 * KB, `${report.site.firstLoad.brotli} bytes`));
await check('budget: every film on demand stays under 24 KB', () => {
  const big = Object.entries(report.site.lazyChunks).filter(([, n]) => n > 24 * KB);
  ok(Object.keys(report.site.lazyChunks).length >= 9, 'films are split into their own files');
  ok(!big.length, `too big: ${JSON.stringify(big)}`);
});
await check('budget: the single file stays under 320 KB', () => ok(report.single.bytes < 320 * KB, `${report.single.bytes} bytes`));
await check('budget: fonts stay under 70 KB in total', () => ok(Object.values(report.site.fonts).reduce((a, b) => a + b, 0) < 70 * KB, 'fonts grew'));
await check('budget: the embed script stays under 300 KB', () => ok(report.embed.bytes < 300 * KB, `${report.embed.bytes} bytes`));

/* ---- The page ---------------------------------------------------------------- */
const { browser, context, page, errors } = await open(single);
const state = () => page.evaluate(() => ({ ...window.WINS.player.state, def: null, waiting: !!window.WINS.player.state.waiting }));
const pixels = () => page.evaluate(() => [...document.querySelectorAll('.scene:not(.is-leaving) canvas.scene-canvas')].map((c) => c.toDataURL()).join('|'));
const header = () => page.evaluate(() => document.getElementById('project-title').textContent);

await check('the page opens and the first film plays by itself', async () => {
  ok((await page.locator('#project-tabs button').count()) === 10, 'ten tabs');
  await wait(page, 500);
  const st = await state();
  ok(st.id === 'fury' && st.playing && st.t > 0.1, JSON.stringify(st));
});

for (const id of PROJECT_IDS) {
  await check(`${id}: draws, repeats exactly, ends on its takeaway`, async () => {
    const duration = await show(page, id, 0);
    const meta = await page.evaluate(() => {
      const d = window.WINS.player.state.def;
      return { acts: d.acts.length, captions: d.captions.length, takeaway: d.takeaway, alt: d.alt, label: document.getElementById('stage').getAttribute('aria-label') };
    });
    ok(meta.acts >= 3 && meta.captions >= 3, 'three acts and captions');
    ok(meta.alt.length > 60 && meta.label.includes(meta.alt), 'a description for people who cannot see it');
    await seek(page, duration * 0.55);
    const a = await pixels();
    ok(a.length > 20000, 'the canvas has a picture');
    await seek(page, duration * 0.2);
    const other = await pixels();
    ok(other !== a, 'the picture changes over time');
    await seek(page, duration * 0.55);
    ok((await pixels()) === a, 'the same time gives the same picture');
    await seek(page, duration, 1);
    ok((await page.evaluate(() => document.getElementById('caption').textContent)) === meta.takeaway, 'the takeaway closes the film');
    await seek(page, duration, 5);
    const later = await pixels();
    await seek(page, duration, 1);
    ok((await pixels()) !== later, 'the last frame is alive');
    ok(!(await page.locator('.scene-error').count()), 'no drawing error');
  });
}

await check('each win names its source, and the link goes there', async () => {
  for (const id of PROJECT_IDS) {
    await show(page, id, 0);
    const got = await page.evaluate((pid) => {
      const p = window.WINS.projects.find((q) => q.id === pid);
      const a = document.getElementById('source-link');
      return { href: a.getAttribute('href'), text: a.textContent, want: p.sources[0], more: document.querySelectorAll('#source-more a').length, extra: p.sources.length - 1, target: a.target, rel: a.rel };
    }, id);
    ok(got.href === got.want.url && got.text === got.want.label, `${id}: ${got.href}`);
    ok(got.more === got.extra, `${id}: every other source is linked too`);
    ok(got.target === '_blank' && /noopener/.test(got.rel), 'links open outside the page');
  }
});

await check('clicking a tab starts that film', async () => {
  await page.locator('#project-tabs button').nth(3).click();
  await wait(page, 700);
  const st = await state();
  ok(st.id === 'talon-a2' && st.playing && st.t > 0.05, JSON.stringify(st));
  ok((await header()) === 'Talon-A2', await header());
});

await check('keys: numbers, arrows, space and speed', async () => {
  await page.keyboard.press('2');
  await wait(page, 600);
  ok((await state()).id === 'leonidas', 'number keys choose a win');
  await page.keyboard.press('ArrowRight');
  await wait(page, 600);
  ok((await state()).id === 'ward-250', 'arrow keys move between them');
  await page.keyboard.press('0');
  await wait(page, 600);
  ok((await state()).id === 'blackbeard', 'zero is the tenth');
  await page.keyboard.press('Space');
  ok(!(await state()).playing, 'space pauses');
  await page.keyboard.press('Space');
  ok((await state()).playing, 'space plays');
  await page.keyboard.press('s');
  ok((await state()).rate === 1.5, 'S changes the speed');
  await page.keyboard.press('s');
  await page.keyboard.press('s');
  ok((await state()).rate === 1, 'and comes back round');
});

await check('fast switching leaves the heading and the film in step', async () => {
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) await page.keyboard.press(key);
  await wait(page, 900);
  const st = await state();
  const name = await page.evaluate((id) => window.WINS.projects.find((p) => p.id === id).name, st.id);
  ok((await header()) === name, `${await header()} vs ${name}`);
});

await check('the domain filter narrows the tabs', async () => {
  await page.locator('[data-filter="Space"]').click();
  await wait(page, 700);
  ok((await page.locator('#project-tabs button').count()) === 2, 'two wins in space');
  ok((await state()).id === 'varda-w5', 'and the first of them plays');
  await page.locator('[data-filter="All"]').click();
  await wait(page, 400);
  ok((await page.locator('#project-tabs button').count()) === 10, 'all ten are back');
});

await check('scrubbing moves the story', async () => {
  await show(page, 'fury', 0);
  await page.evaluate(() => {
    const el = document.getElementById('scrub');
    el.value = '250';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(page, 900);
  const st = await state();
  ok(Math.abs(st.t - st.duration / 4) < 1.5, `t = ${st.t}`);
});

for (const [id, before, label] of [['fury', 9.6, 'Authorize release'], ['leonidas', 13.4, 'Fire the pulse']]) {
  await check(`${id}: the story waits for the viewer, then carries on`, async () => {
    await show(page, id, before);
    await page.evaluate(() => window.WINS.player.play());
    await wait(page, 1000);
    ok((await state()).waiting, 'the story stops at the decision');
    const held = (await state()).t;
    const frame = await pixels();
    await wait(page, 300);
    ok((await pixels()) !== frame, 'the picture keeps moving while it waits');
    const button = page.locator('#controls button.is-waiting');
    ok((await button.textContent()) === label, await button.textContent());
    await button.click();
    await wait(page, 600);
    const st = await state();
    ok(!st.waiting && st.t > held + 0.2, 'the viewer releases it');
  });
}

await check('Quarterhorse: the viewer can set the speed', async () => {
  const end = await show(page, 'quarterhorse', 0);
  await seek(page, end, 2);
  const options = page.locator('#controls .control-group button');
  ok((await options.count()) === 3 && (await options.first().isVisible()), 'three speeds are offered once the story is told');
  await seek(page, end, 9);
  const supersonic = await pixels();
  await seek(page, end, 2);
  await options.nth(0).click();
  await settle(page);
  ok((await options.nth(0).getAttribute('aria-pressed')) === 'true', 'the choice is marked');
  await seek(page, end, 9);
  ok((await pixels()) !== supersonic, 'and the sound rearranges itself');
  // A viewer who scrubs to the end is paused there: no clock is running. A choice must still be answered.
  await seek(page, end, 2);
  const still = await pixels();
  await options.nth(1).click();
  await wait(page, 700);
  ok((await pixels()) !== still, 'a choice made while paused at the end still plays out');
  await seek(page, 5);
  ok(await options.first().isHidden(), 'scrubbing back puts the story in charge again');
});

await check('Victus Haze: the viewer can make the target run again', async () => {
  const end = await show(page, 'victus-haze', 0);
  await seek(page, end - 3);
  const run = page.locator('#controls button');
  ok(await run.isHidden(), 'no button while the story is still being told');
  await seek(page, end, 6);
  ok(await run.isVisible(), 'the button is offered at the end');
  await seek(page, end, 9);
  const calm = await pixels();
  await seek(page, end, 6);
  await run.click();
  await seek(page, end, 9);
  ok((await pixels()) !== calm, 'the target burns and the hunter follows');
  ok(await run.isDisabled(), 'no second burn until the chase is over');
  await seek(page, end, 14);
  ok(await run.isEnabled(), 'then it can run again');
  await seek(page, end - 3);
  await seek(page, end, 9);
  ok((await pixels()) === calm, 'scrubbing back forgets the extra burn');
});

await check('no console errors on the page', () => ok(!errors.length, errors.slice(0, 3).join(' | ')));

await check('phone width: nothing overflows sideways', async () => {
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto('file://' + single);
  await phone.waitForFunction(() => window.WINS && window.WINS.ready);
  await wait(phone, 400);
  for (const id of ['fury', 'victus-haze']) {
    await phone.evaluate((pid) => window.WINS.debug.show(pid, 20), id);
    const over = await phone.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    ok(over <= 1, `${id} overflows by ${over}px`);
  }
  const gutter = await phone.evaluate(() => document.getElementById('stage').getBoundingClientRect().left);
  // Held upright, a phone gets the plate alone, filling the frame, not the whole stage in miniature.
  const plate = await phone.evaluate(() => {
    const frame = document.querySelector('.stage-frame');
    const r = frame.getBoundingClientRect();
    const rail = document.querySelector('.scene:not(.is-leaving) .rail');
    return { on: frame.classList.contains('is-plate'), ratio: r.width / r.height, railHidden: !rail || getComputedStyle(rail).visibility === 'hidden' };
  });
  ok(plate.on && Math.abs(plate.ratio - 872 / 478) < 0.03 && plate.railHidden, `upright phone shows the plate alone (${JSON.stringify(plate)})`);
  await phone.setViewportSize({ width: 844, height: 390 });
  await wait(phone, 300);
  const wide = await phone.evaluate(() => document.querySelector('.stage-frame').classList.contains('is-plate'));
  ok(!wide, 'turned sideways, the whole stage comes back');
  await phone.close();
  ok(gutter >= 16, `side gutter is ${gutter}px`);
});

await check('the stage keeps one size from win to win', async () => {
  // The footer and the caption band are fixed in height by design (a hidden copy of every
  // source list sizes the footer), so the picture does not jump when the film changes.
  for (const [width, height] of [[1280, 720], [1440, 900]]) {
    const desk = await context.newPage();
    await desk.setViewportSize({ width, height });
    await desk.goto('file://' + single);
    await desk.waitForFunction(() => window.WINS && window.WINS.ready);
    const sizes = [];
    for (const id of PROJECT_IDS) {
      await desk.evaluate((pid) => window.WINS.debug.show(pid, 12), id);
      sizes.push(await desk.evaluate(() => Math.round(document.querySelector('.stage-frame').getBoundingClientRect().height * 2) / 2));
    }
    await desk.close();
    ok(new Set(sizes).size === 1, `at ${width} x ${height} the stage is ${[...new Set(sizes)].join(', ')} px tall`);
  }
});

/* ---- The other builds -------------------------------------------------------- */
await check('the split site loads films on demand', async () => {
  const { createServer } = await import('node:http');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
  const server = createServer((req, res) => {
    try {
      const path = join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
      res.writeHead(200, { 'content-type': types[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' });
      res.end(readFileSync(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = await context.newPage();
  const asked = [];
  site.on('request', (r) => asked.push(r.url()));
  await site.goto(`http://127.0.0.1:${server.address().port}/`);
  await site.waitForFunction(() => window.WINS && window.WINS.ready);
  await site.evaluate(() => window.WINS.debug.show('blackbeard', 5));
  ok(asked.some((u) => /blackbeard-[A-Z0-9]+\.js$/i.test(u)), 'the film arrives as its own file');
  ok((await site.evaluate(() => window.WINS.player.state.id)) === 'blackbeard', 'and plays');
  await site.close();
  server.close();
});

await check('the page fragment has no document of its own', () => {
  const fragment = readFileSync(join(dir, 'ten-wins-page.html'), 'utf8');
  ok(/^<title>Ten Wins in Motion<\/title>/.test(fragment), 'it starts with the title');
  ok(!/<(!doctype|html|head|body)[\s>]/i.test(fragment.replace(/<script>[\s\S]*<\/script>/, '')), 'no doctype, html, head or body');
  ok(fragment.includes('id="stage"') && fragment.includes('@font-face'), 'the page and its fonts are inside');
});

await check('the embed follows the host page', async () => {
  const host = await context.newPage();
  const hostErrors = [];
  host.on('pageerror', (e) => hostErrors.push(String(e)));
  await host.goto('file://' + join(dir, 'embed', 'demo.html'));
  await host.waitForFunction(() => window.WinsMotion && document.querySelector('[data-wins-motion]').shadowRoot);
  await wait(host, 600);
  await host.click('#next');
  await wait(host, 900);
  const got = await host.evaluate(() => window.WinsMotion.mount('[data-wins-motion]').state);
  await host.close();
  ok(got.project === 'leonidas' && got.playing, JSON.stringify(got));
  ok(!hostErrors.length, hostErrors[0]);
});

/* ---- Housekeeping ------------------------------------------------------------ */
await check('films keep no clock of their own', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const hits = files.filter((f) => /Math\.random\(|Date\.now\(|performance\.now\(/.test(readFileSync(join(ROOT, f), 'utf8')) && !f.endsWith('core/player.ts'));
  ok(files.length > 20, 'the source files were found');
  ok(!hits.length, `uses a clock or a random source: ${hits.join(', ')}`);
});

await browser.close();
rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r[0]);
for (const [pass, name, why] of results) console.log(`${pass ? '  ok  ' : 'FAIL  '}${name}${why ? `\n        ${why}` : ''}`);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
