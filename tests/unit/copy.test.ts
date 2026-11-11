/* The words: every film has a full set of them, in order, and nothing the bundled
   fonts cannot draw. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projects } from '../../src/projects.ts';
import { loaders } from '../../src/scenes/registry.ts';

/* The characters kept in the subset fonts (tools/subset-fonts.py). */
const DRAWABLE = new Set([...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)), ...' ©·×°±–—‘’“”…™→←↑↓≠−≈•']);
const strange = (s: string): string[] => [...new Set([...s].filter((c) => !DRAWABLE.has(c)))];

test('ten wins, each with a source and a caveat', () => {
  assert.equal(projects.length, 10);
  assert.equal(new Set(projects.map((p) => p.id)).size, 10);
  assert.deepEqual(Object.keys(loaders), projects.map((p) => p.id), 'every win has a film, in the same order');
  for (const p of projects) {
    assert.ok(p.name.length <= 12, `${p.name}: the title sits on one line at full size`);
    assert.ok(p.sources.length >= 1 && p.sources.every((s) => /^https:\/\//.test(s.url) && s.label), `${p.id}: sources`);
    assert.ok(p.caveat.length > 40, `${p.id}: says what it cannot show`);
    assert.ok(p.description.length < 150, `${p.id}: the description is a line, not a paragraph`);
    for (const text of [p.name, p.maker, p.place, p.when, p.description, p.title, p.prompt, p.caveat, ...p.sources.map((s) => s.label)]) {
      assert.deepEqual(strange(text), [], `${p.id}: "${text.slice(0, 30)}" uses a character the fonts lack`);
    }
  }
});

test('every film tells its story in order and ends on a takeaway', async () => {
  for (const p of projects) {
    const def = await loaders[p.id]();
    assert.equal(def.id, p.id);
    assert.ok(def.duration >= 18 && def.duration <= 24, `${p.id}: about twenty seconds`);
    assert.equal(def.acts.length, 3, `${p.id}: three acts`);
    assert.equal(def.acts[0].at, 0);
    assert.ok(def.captions.length >= 4 && def.captions[0].at === 0, `${p.id}: captions from the first frame`);
    for (const list of [def.acts, def.captions]) {
      for (let i = 1; i < list.length; i++) assert.ok(list[i].at > list[i - 1].at && list[i].at < def.duration, `${p.id}: in order, inside the film`);
    }
    for (const g of def.gates ?? []) assert.ok(g.auto != null && g.at < def.duration, `${p.id}: a gate never strands the viewer`);
    assert.ok(def.takeaway.length > 30 && def.alt.length > 120, `${p.id}: a takeaway and a description for people who cannot see it`);
    for (const text of [def.takeaway, def.alt, ...def.captions.map((c) => c.text), ...def.acts.map((a) => a.label), ...(def.gates ?? []).map((g) => g.label)]) {
      assert.deepEqual(strange(text), [], `${p.id}: "${text.slice(0, 30)}" uses a character the fonts lack`);
      assert.ok(!/\bfictional\b/i.test(text), `${p.id}: these are real events`);
    }
    for (const c of def.captions) assert.ok(c.text.length <= 150, `${p.id}: "${c.text.slice(0, 30)}…" fits under the stage`);
  }
});
