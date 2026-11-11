#!/usr/bin/env node
// Write every word the films show to docs/COPY.md, so the text can be read, edited
// and lifted without opening a film. The page and this file share one source: the
// projects list and each film's own captions.
//   node tools/copy.mjs [--out docs/COPY.md] [--check]
// It needs nothing but Node: no build and no browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projects } from '../src/projects.ts';
import { loaders } from '../src/scenes/registry.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const a = { check: argv.includes('--check'), out: argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : '' };
const out = resolve(a.out || join(ROOT, 'docs', 'COPY.md'));
const pad = (n) => String(n).padStart(2, '0');
const at = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;

const parts = [
  '# The copy',
  '',
  'Every word the ten films put on screen, in the order a viewer meets it. This file is',
  'written by `npm run copy` from `src/projects.ts` and each film in `src/scenes/`, so',
  'edit the text there, not here.',
  '',
  'For each win: the headline and the line under it, what the viewer is told to watch',
  'for, the captions with the time each one appears, the takeaway that closes the',
  'film, the description read to people who cannot see it, what the film cannot show,',
  'and the sources.',
  '',
];
for (const [i, p] of projects.entries()) {
  const def = await loaders[p.id]();
  const acts = (s) => {
    let name = def.acts[0].label;
    for (const act of def.acts) if (s >= act.at - 1e-6) name = act.label;
    return name;
  };
  parts.push(
    `## ${pad(i + 1)} · ${p.name}`,
    '',
    `${p.maker} · ${p.place} · ${p.when} · ${p.category}`,
    '',
    `**Headline.** ${p.title}`,
    '',
    `**Under the name.** ${p.description}`,
    '',
    `**Watch for.** ${p.prompt}`,
    '',
    '| At | Act | Caption |',
    '| --- | --- | --- |',
    ...def.captions.map((c) => `| ${at(c.at)} | ${acts(c.at)} | ${c.text} |`),
    '',
    ...(def.gates ?? []).map((g) => `**The viewer acts at ${at(g.at)}.** Button: “${g.label}”. It releases itself after ${g.auto} seconds.\n`),
    `**Takeaway.** ${def.takeaway}`,
    '',
    `**For people who cannot see it.** ${def.alt}`,
    '',
    `**What it cannot show.** ${p.caveat}`,
    '',
    `**Sources.** ${p.sources.map((s) => `[${s.label}](${s.url})`).join(' · ')}`,
    '',
  );
}
const text = parts.join('\n');
if (a.check) {
  const same = readFileSync(out, 'utf8') === text;
  console.log(same ? 'docs/COPY.md is up to date.' : 'docs/COPY.md is out of date: run `npm run copy`.');
  process.exit(same ? 0 : 1);
}
writeFileSync(out, text);
console.log(`Wrote ${out} (${projects.length} films)`);
