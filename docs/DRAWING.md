# The drawing kit, on one page

Everything a film can call, so that writing or polishing one does not mean reading
the engine. The rules for *what* to draw are in [DESIGN.md](DESIGN.md).

## The stage

- Design space: 1280 x 520. The plate (the field) is usually `x 44..884, y 43..477`
  (`FX, FY, FW = 840, FH = 434`). The instrument rail is HTML at `x 920..1252`.
- Keep marks and text at least 14 px inside the plate, and clip moving things to it:
  `g.save(); g.beginPath(); g.rect(FX + .5, FY + .5, FW - 1, FH - 1); g.clip(); … g.restore();`
  Labels are usually drawn after `restore()`, so they sit above everything.
- `update(f)` is called every frame. `f.t` story seconds (can go backward), `f.idle`
  seconds stood still (at a gate or after the end), `f.live = t + idle` (never stops),
  `f.ended`, `f.gate` (non-null while waiting for the viewer), `f.playing`, `f.view`.
  The picture must be a pure function of `(t, idle)` plus any viewer state.

## Kit (`import * as K from '../core/kit.ts'`)

| | |
| --- | --- |
| `K.tween(t, a, b, ease?)` | eased 0..1 as t passes a..b. Eases: `'linear' 'in' 'out' 'inOut'` (default) `'outQuart' 'inOutQuart' 'outExpo' 'inOutSine' 'outBack'` (one small overshoot per film at most) |
| `K.seg(t, a, b)` | the same, linear |
| `K.pulse(t, a, b, fade = .4)` | 0 → 1 → 0: up over `fade`, held, down before b |
| `K.keys([[t0, v0], [t1, v1, ease], …])(t)` | keyframes |
| `K.stagger(t, a, b, i, n, overlap = .6)` | item i of n, each starting a little later |
| `K.clamp(x, a = 0, b = 1)`, `K.lerp(a, b, u)`, `K.smooth(u)`, `K.dist(x1, y1, x2, y2)`, `K.TAU` | |
| `K.rng(seed)()`, `K.hash(i, salt)` | deterministic 0..1 |
| `K.noise(x, salt)`, `K.noise2(x, y, salt)` | smooth noise in -1..1 |
| `K.bezier(bez, u)`, `K.link(x1, y1, x2, y2)`, `K.along(pts, u)` | points on a cubic, an S-curve, a polyline |
| `K.rgba(hex, alpha)`, `K.blend(hexA, hexB, u)` | colours (six-digit hex in) |
| `K.pad(n, w)`, `K.num(n)` | `07`, `2,688` |

## Pen (`import { Pen, DASH, FONT, Halftone } from '../draw/pen.ts'`)

`const pen = new Pen(ctx.canvas(), ctx.colors)`; call `pen.frame(f.view)` first in
every update; `pen.g` is the 2-D context, already in design pixels.

- Style, then mark. `pen.stroke(color, alpha = 1, width = 1, dash?, dashOffset?)`
  and `pen.fill(color, alpha = 1)` return the pen, so they chain:
  `pen.stroke(col.mark, .6, 1, DASH.fine).line(x1, y1, x2, y2)`. A width of 1 is a true
  one-device-pixel hairline. After a dashed stroke, `g.setLineDash([])`.
- `DASH.dot [1.2, 4.2]`, `DASH.dash [5, 4]`, `DASH.long [9, 5]`, `DASH.fine [2, 3]`.
- Stroked marks: `line`, `hline(x1, x2, y)` and `vline(x, y1, y2)` (crisp), `poly(pts,
  close?, u?)`, `curve(bez, u?)`, `box(x, y, w, h)` (crisp rectangle), `ring(x, y, r)`,
  `ticks(x1, y1, x2, y2, n, len = 4, major = 5)`.
- Filled marks: `dot(x, y, r)`, `head(x, y, angle, size)` (arrow head),
  `hatch(x, y, w, h, color, alpha, gap)` (diagonal drafting fill).
- Paths only (follow with `g.fill()` / `g.stroke()`): `rect(x, y, w, h)`, `circle(x, y, r)`.
- Type: `text(str, x, y, { font: 'sans' | 'mono', size, weight, color, alpha, align,
  baseline, track })`; `cap(str, x, y, color?, alpha?, align?)` is the small uppercase
  label; `val(str, …)` a mono numeral; `measure(str, style)`.
- `label(x, y, lx, ly, [name, detail…], { color, u, align })`: a label at (lx, ly)
  tied to the mark at (x, y) by a dashed leader; `u` 0..1 draws it on, so
  `u: K.pulse(t, a, b)` shows it for a while. It paints its own dark backing.
- `tag(str, x, y, { color, alpha, align, solid })`: an outlined tag.
- `plate(x, y, w, h, { title, right, cols, rows, alpha })`: the frame of a field.
- Glyphs: `brackets(x, y, r, color, alpha, len)`, `cross`, `check`, `person`,
  `drone(x, y, angle, scale, color, alpha)`, `cursor`, `doc`.
- `Halftone(x, y, cols, rows, pitch, { stagger })`: a lattice of dots. Each frame set
  `field.tone[i]` (0..1, size) and `field.shade[i]` (index into a palette), then
  `field.draw(pen, [colorA, colorB, …], { min, max, gamma, alpha })`. `field.xs[i]`,
  `field.ys[i]`, `field.n`, `field.at(x, y)`.

## Craft (`import * as C from '../draw/craft.ts'`)

Silhouettes one unit long, nose toward +x: `FURY`, `HORNET`, `DELTA`, `LUCAS`,
`AIRLIFTER` (plan views); `ROC_FRONT` with `ROC_ENGINES`; `MISSILE`, `GLIDER`;
`TALON`, `C17` (with `C17_WHEELS`, `C17_RAMP`, `C17_HOLD`), `LCS` (with `LCS_DECK`),
`MARAUDER` (with `marauderSection(x)`), `MINIVAN` (side views, y down).

- `C.draw(pen, shape, x, y, { size, angle, color, alpha, fill, fillAlpha, width, dash,
  flipX, flipY })`. `fill` defaults to the stage colour so a craft hides what is
  behind it; `fill: null` leaves it hollow. A shape is an array of outlines
  (`{ pts, open?, detail? }`), so `[C.MARAUDER[0]]` is the hull alone, and a film can
  define a shape of its own in the same form.
- `C.rounds(pen, list, x, y, style)` for wheels and engines; `C.place(pt, x, y, style)`
  gives where a point of a craft lands on screen.
- `C.plume(pen, age => point | null, { life, step, r0, r1, color, alpha, jitter, seed })`:
  smoke or exhaust laid along a path.

## The rail (`const rail = ctx.rail()`)

Sections stack top to bottom in the order they are created; the rail is 332 x 468 and
must not overflow (the layout lint checks).

- `rail.phase(label, names).set(position)`: the big phase word; a fractional
  position slides between names.
- `rail.stat({ label, unit?, prefix?, slots = 3, decimals?, bar?, size?: 'l' | 'm' | 's',
  tone? })` → `.set(value)`, `.bar(0..1)`, `.alpha(a)`, `.tone(t)`, `.unit(text)`.
  Digits roll; set it every frame from time.
- `rail.clock({ label, unit })` → `.set(hours)` shows `HH:MM`.
- `rail.pair()` returns a two-column rail for two stats side by side.
- `rail.dots({ label, count, legend? })` → `.set(i, state)`, `.legend(text)`. States:
  0 empty, 1 mark, 2 old, 3 ink, 4 ring, 5 alert, 6 live.
- `rail.chips({ label, items })` → `.set(i, state)`: 0 idle, 1 active, 2 done,
  3 old way, 4 failed, 5 needs attention (lime).
- `rail.log({ label, items })` → `.set(i, on, stamp?)`.
- `rail.chart({ label, height })` → `{ g, w, h, clear() }`: a small canvas in CSS
  pixels; use `FONT.tick`, `FONT.word`, `FONT.label` for its text.
- `rail.note(text)` sits at the bottom.

## The palette (`const col = ctx.colors`)

`col.bright` / `col.mark` the thing itself; `col.live` the one accent (lime): what has
just happened or what to look at, never more than two or three things at once;
`col.old` the old way or the record being beaten; `col.alert` failure only; `col.ink`
text and a person's action; `col.dim`, `col.wire`, `col.line2`, `col.line` structure;
`col.muted`, `col.faint` secondary text; `col.stage` the background, for hiding.

## Controls

`gates: [{ id, at, label, auto }]` on the definition stops the story for a button.
`ctx.button(label, onClick)`, `ctx.options(labels, selected, onChange)` and
`ctx.toggles(labels, onChange)` add controls under the stage; call
`ctx.player.refresh()` after changing viewer state, and reset that state when the
story is scrubbed back.

## Looking at a film

```bash
node tools/shoot.mjs --scene fury --count 15 --out out/frames/fury
```

writes frames named `fury@SS.SS.png` and one contact sheet, `fury-sheet.png`. Add
`--t 6.8,7.2,7.6` for chosen times, `--idle 6` to see the last frame after it has
run on, `--page` for the whole page, `--width` and `--height` for the window.

```bash
node tools/lint-layout.mjs --scene fury --step 0.25
```

finds text that is clipped or sits on other text at any moment.
