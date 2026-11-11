#!/usr/bin/env node
// A quick health report: play every film from start to finish (at four times speed)
// and print what each frame cost to draw. Fails on console errors or slow films.
//   node tools/verify.mjs [--limit 6]
import { PROJECT_IDS, args, buildSingle, cleanup, open, show } from './lib.mjs';

const a = args({ limit: 6 });
const file = buildSingle();
const { browser, page, errors } = await open(file);
let slow = 0;
try {
  console.log('film                  length   frames   average    worst');
  for (const id of PROJECT_IDS) {
    const duration = await show(page, id, 0);
    await page.evaluate(() => {
      window.WINS.player.setRate(4);
      window.WINS.player.play();
    });
    await page.waitForTimeout(Math.ceil((duration / 4) * 1000) + 400);
    const st = await page.evaluate(() => window.WINS.debug.stats());
    if (st.avg > Number(a.limit)) slow++;
    console.log(`${id.padEnd(20)} ${String(duration).padStart(5)} s ${String(st.frames).padStart(7)} ${st.avg.toFixed(2).padStart(7)} ms ${st.max.toFixed(1).padStart(6)} ms${st.avg > Number(a.limit) ? '   SLOW' : ''}`);
  }
  if (errors.length) {
    console.log(`\nConsole errors (${errors.length}):`);
    errors.slice(0, 8).forEach((e) => console.log('  ' + e.split('\n')[0]));
  }
  console.log(errors.length || slow ? '\nProblems found.' : '\nAll ten films play cleanly.');
  process.exitCode = errors.length || slow ? 1 : 0;
} finally {
  await browser.close();
  cleanup(file);
}
