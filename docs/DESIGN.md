# Design notes, and how to add a film

The look comes from an earlier project, a set of animated demonstrations drawn as
technical plates. The tokens in `src/styles/base.css`, the two typefaces in
`assets/fonts/` and the rules below were carried over from it unchanged. One rule was
rewritten, because those films were fiction and these are not: see **Honesty**.

## The rules every film follows

**One idea.** A film shows one thing that happened, in three acts of roughly seven
seconds. If a second idea turns up, it belongs to another film.

**A plate, not a cartoon.** The main field is drawn like a technical plate: a hairline
frame with corner brackets, a small caps title, and where it helps, ruler ticks. Things
on it are marks, not illustrations. Aircraft and ships are outlines from
`src/draw/craft.ts`: right in proportion, bare of detail.

**Dots carry quantity.** Where there are many of something (days, drones, missiles),
each one is a dot and its size or color says what happened to it. Count them and the
number is true: 556 days, 61 drones, 123 days, 12,000 missiles.

**Labels are tied to what they name.** A label sits beside its mark, joined by a
dashed leader line, in small caps with a plain second line. Nothing is explained in a
legend if it can be labeled in place. (Two satellites that never hold still are the
one exception: their names sit in a corner.)

**Instruments on the right.** The rail beside the field holds the numbers: the phase,
one or two large counters with rolling digits, a roster or a row of chips, and a small
chart. A film sets them every frame from the same time value that draws the field.

**Black, white and one accent.** The page and the films share a small palette.

| token | color | meaning |
| --- | --- | --- |
| `--mark`, `--bright` | light gray, white | the thing itself: the aircraft, the ship, the route |
| `--old` | warm tan | the old way, or the record being beaten |
| `--alert` | red | failure only |
| `--live` | lime | the one accent: what has just happened, or the thing to look at now |
| `--ink` | white | text, and a person's action |
| `--dim`, `--wire`, `--line-2` | grays | structure and everything not yet touched |

Use the accent sparingly. If more than two or three things on screen are lime, it has
stopped meaning anything.

**One typeface, three voices.** Everything is set in one grotesque (`--sans`). Titles
are bold, large and in sentence case, tracked tight. Structure is carried by small
uppercase labels at weight 500, tracked slightly open (`pen.cap`, `.ins-label`).
Large numerals are regular weight, not bold. The monospace face (`--mono`) is for
numerals, axis ticks and key hints only; never for labels or sentences.

**Sharp corners, hairline rules.** No rounded rectangles, no shadows, no gradients
except where one is the picture. Circles are for controls and markers.

**Motion.** Things ease in over about half a second and stagger slightly. Nothing
bounces, with at most one small overshoot in a film. Something keeps moving after the
story ends, so the last frame is alive.

**Honesty.** These are real events, so the rule is stricter than "say it is
fictional":

- Every number on screen comes from a source listed in `src/projects.ts`, or is plain
  arithmetic on two such numbers, and `docs/SOURCES.md` says which.
- Arithmetic is safe only between two figures the same source ties together. A
  contract value divided by a quantity is a price only if the source says that money
  buys exactly those units; an earlier build of Blackbeard divided a first award by a
  lot size and published a price nobody had given.
- A plan is not an order. What an agency is seeking, what it has committed to and
  what it has bought are three different numbers, and the film says which one it is
  drawing.
- A counter runs up to a reported figure. It never plays invented telemetry: there is
  no speedometer for a speed nobody released.
- What was not released is said to be not released, on the plate, in the same voice
  as everything else. An unknown extent is drawn open or hatched, not given an end.
- A company's own count is called the company's count, and a claim of a first is
  given to whoever made it.
- Go to the primary release before repeating a trade report's summary of it. Then have
  someone who did not make the film check every caption and label against the
  sources: `docs/SOURCES.md` records what that found.
- Every plate title says what kind of drawing it is: schematic, not to scale, seen
  from above. Geometry that is exact (the Mach cone, the dot counts) says so too.

## Time

A film never keeps its own clock. The player hands it a frame:

- `t`: story time in seconds, from 0 to the film's duration. It can run backward.
- `idle`: seconds the story has stood still while playing (after the end, or at a gate).
- `live`: `t + idle`, for motion that should never stop.

The picture must be a pure function of `(t, idle)`. That one rule gives scrubbing,
replay, deterministic tests and identical pictures everywhere. In practice: derive
everything with `K.tween(t, from, to)` and friends, use `live` for drift and pulses,
and never use `Math.random` or `Date.now` (use `K.rng` and `K.hash`).

Anything expensive (a schedule, a model) runs once in `prepare()` and is read back
by time. `prepare()` may run before the film is opened, while another one plays.

## Adding a film

Everything a film can call is listed on one page in [DRAWING.md](DRAWING.md).

1. Add the event to `src/projects.ts`: name, maker, place, date, the line under the
   name, the headline, what to watch for, its sources and what it cannot show.
2. Write `src/scenes/<id>.ts` that exports a definition:

```ts
import * as K from '../core/kit.ts';
import { Pen } from '../draw/pen.ts';
import type { SceneDef } from '../core/types.ts';

const def: SceneDef = {
  id: 'my-film',
  duration: 21,
  takeaway: 'One sentence the viewer should leave with.',
  alt: 'What happens, for someone who cannot see it.',
  acts: [{ at: 0, label: 'Before' }, { at: 7, label: 'During' }, { at: 14, label: 'After' }],
  captions: [{ at: 0, text: 'What is on screen now.' }],
  setup(ctx) {
    const pen = new Pen(ctx.canvas(), ctx.colors);
    const rail = ctx.rail();
    const count = rail.stat({ label: 'Things done', slots: 3, bar: true });
    return {
      update(f) {
        pen.frame(f.view);
        pen.plate(44, 43, 840, 434, { title: 'What this plate shows · schematic' });
        const done = 120 * K.tween(f.t, 2, 12);
        count.set(done);
        count.bar(done / 120);
      },
    };
  },
};
export default def;
```

3. Register it in `src/scenes/registry.ts` so it loads on demand, and add its id to
   `PROJECT_IDS` in `tools/lib.mjs`.
4. If it has a model, put it in `src/scenes/<id>.sim.ts` with no DOM in it, and test
   it in `tests/unit/`. Export the reported figures as constants and test the
   arithmetic on them there too.
5. Look at it: `npm run shoot -- --scene my-film` writes frames and a contact sheet to
   `out/frames/my-film/`.
6. Run `npm run lint:layout -- --scene my-film`: it finds text that is clipped, sits
   on other text, crosses the plate's frame or is hidden behind another label's
   backing, at any moment of the film. Add `--edge 13` to see what comes within 13 px
   of the frame.
7. Run `npm test`, then `npm run copy` to refresh `docs/COPY.md`.

The design space is 1280 by 520. The field is usually `x 44..884, y 43..477`; the
rail takes the rest. Canvases sit behind one HTML layer (`ctx.html()`), which is for
real text such as the rail. Avoid CSS transitions inside a film: they are a second
clock.

Text must stay inside the characters kept in the fonts: basic Latin plus
`© · × ° ± – — ‘ ’ “ ” … ™ → ← ↑ ↓ ≠ − ≈ •`. `tests/unit/copy.test.ts` fails on
anything else, because the browser would quietly draw it in another typeface.

## Asking the viewer to act

- `gates: [{ id, at, label, auto }]` stops the story at a moment and shows a button
  under the stage. `auto` releases it after that many seconds. Use `f.live`, not
  `f.t`, for anything that should keep moving while the story waits. *Fury* stops for
  the human's consent; *Leonidas* stops before the pulse.
- `ctx.options(labels, selected, onChange)` offers a choice, `ctx.toggles` independent
  switches and `ctx.button` a single action. Keep any viewer state small, reset it
  when the story is scrubbed back, and call `ctx.player.refresh()` after changing it.
  *Quarterhorse* lets the viewer set the Mach number; *Victus Haze* lets them make the
  target run again.
