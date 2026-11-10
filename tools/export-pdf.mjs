#!/usr/bin/env node
// A leave-behind: one landscape page per win, with a late frame of its film, its
// takeaway and its source.
//   node tools/export-pdf.mjs [--out dist/ten-wins-in-motion.pdf] [--at 0.93]
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PROJECT_IDS, ROOT, args, buildSingle, cleanup, open, seek, show } from './lib.mjs';

const a = args({ at: 0.93 });
const font = (family, file, weight) => `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(join(ROOT, 'assets', 'fonts', file)).toString('base64')}) format("woff2")}`;
const FONTS = font('Field Sans', 'sans-400.woff2', '400 600') + font('Field Sans', 'sans-700.woff2', '700') + font('Field Mono', 'mono-400.woff2', '400');
const out = resolve(a.out || join(ROOT, 'dist', 'ten-wins-in-motion.pdf'));
mkdirSync(dirname(out), { recursive: true });
const file = buildSingle();
const { browser, context, page } = await open(file, { width: 1600, height: 900, scale: 2 });
try {
  const sheets = [];
  for (const id of PROJECT_IDS) {
    const duration = await show(page, id, 0);
    await seek(page, duration * Number(a.at));
    const shot = await page.locator('.stage-frame').screenshot();
    const info = await page.evaluate((pid) => {
      const p = window.WINS.projects.find((q) => q.id === pid);
      const i = window.WINS.projects.indexOf(p);
      return { name: p.name, number: `Win ${String(i + 1).padStart(2, '0')} · ${p.category} · ${p.maker} · ${p.place} · ${p.when}`, description: p.description, title: p.title, takeaway: window.WINS.player.state.def.takeaway, source: p.sources.map((q) => q.label).join(' · ') };
    }, id);
    sheets.push({ ...info, image: shot.toString('base64') });
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const doc = await context.newPage();
  await doc.setContent(`<!doctype html><meta charset="utf-8"><style>${FONTS}
    @page { size: 13.333in 7.5in; margin: 0 }
    * { box-sizing: border-box }
    body { margin: 0; background: #000; color: #fff; font: 400 15px/1.2 "Field Sans", Helvetica, Arial, sans-serif; letter-spacing: -.01em; -webkit-print-color-adjust: exact; print-color-adjust: exact }
    section { width: 13.333in; height: 7.5in; padding: .5in .6in; display: flex; flex-direction: column; gap: .16in; page-break-after: always; background: #000 }
    .n { font-weight: 500; font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; color: #9d9f9a }
    h1 { margin: 0 0 0 -.04em; font-weight: 700; font-size: 66px; line-height: .92; letter-spacing: -.035em; color: #fff }
    .row { display: flex; justify-content: space-between; align-items: end; gap: .5in }
    .row p { margin: 0 0 .5em; max-width: 4.2in; font-weight: 500; font-size: 11.5px; line-height: 1.1; letter-spacing: .04em; text-transform: uppercase; color: #fff }
    img { display: block; width: 100%; height: auto; margin-top: .06in; border: 1px solid #2f3234 }
    .foot { display: flex; justify-content: space-between; align-items: baseline; gap: .4in; margin-top: auto; font-size: 20px; letter-spacing: -.015em; color: #fff }
    .foot small { font: 500 10px/1.4 "Field Sans", Helvetica, Arial, sans-serif; letter-spacing: .04em; text-transform: uppercase; color: #6c6e6b; text-align: right; max-width: 4.6in }
  </style>${sheets
    .map((s, i) => `<section><div class="n">${esc(s.number)}</div><div class="row"><h1>${esc(s.name)}</h1><p>${esc(s.description)}</p></div><img src="data:image/png;base64,${s.image}"><div class="foot"><span>${esc(s.takeaway)}</span><small>Source: ${esc(s.source)} · real event, schematic drawing · ${String(i + 1).padStart(2, '0')} / ${String(sheets.length).padStart(2, '0')}</small></div></section>`)
    .join('')}`);
  await doc.evaluate(() => document.fonts.ready);
  await doc.pdf({ path: out, width: '13.333in', height: '7.5in', printBackground: true });
  console.log(`Wrote ${out} (${sheets.length} pages)`);
} finally {
  await browser.close();
  cleanup(file);
}
