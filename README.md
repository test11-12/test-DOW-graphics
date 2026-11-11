# Ten wins in motion

Ten short animated graphics, one for each of ten American defense-technology wins
between December 2024 and November 2026. Each film runs about twenty seconds, shows
one thing that happened, and carries its own text: a headline, a line telling the
viewer what to watch for, captions, a takeaway and a source.

| | Win | The picture | The viewer can |
| --- | --- | --- | --- |
| 01 | **Fury** · Anduril's YFQ-44A fires a live AMRAAM | The jet held in frame over a moving desert; the missile leaves for a digital target; 556 dots count the days from first design to first flight | Authorize the release |
| 02 | **Leonidas** · Epirus says one pulse dropped 49 drones | Every drone of the day's 61 as a mark that stays where it falls; the pulse as a wave through a field of dots | Fire the pulse |
| 03 | **Ward 250** · Valar's reactor flies in a C-17 | A cutaway of the loading, a map of the flight, and a calendar of 123 dots to criticality | |
| 04 | **Talon-A2** · Stratolaunch's reusable hypersonic flights | A flight profile flown three times: once into the ocean, twice onto a runway by the same airframe | |
| 05 | **Varda W-5** · a capsule comes home over South Australia | A night sky of dots with the re-entry as a long exposure | |
| 06 | **LUCAS** · a one-way attack drone leaves a warship | A littoral combat ship on a sea of dots; a rocket-assisted takeoff; the booster falls away | |
| 07 | **Quarterhorse** · Hermeus goes supersonic, uncrewed | Rings of sound leaving the nose, piling into a wall at Mach 1 and folding into a cone at Mach 1.21 | Set the Mach number |
| 08 | **Marauder** · Saronic's crewless ship, keel to water in nine months | A hull built frame by frame over a calendar, then the yard's twenty-a-year row | |
| 09 | **Victus Haze** · a launch in 16 h 42 min, then a chase in orbit | A 27-hour dial, then two satellites round the Earth: one hunts, and in the second sortie the other runs | Make the target run again |
| 10 | **Blackbeard** · Castelion's hypersonic missile, ordered by the thousand | One round under a Super Hornet's wing, then a field of exactly 12,000 dots with 444 lit | |

These are real events. Every number on screen comes from a listed source or is plain
arithmetic on two such numbers; what was not released is said to be not released; and
every drawing is labeled for what it is (schematic, not to scale). The ledger is in
[docs/SOURCES.md](docs/SOURCES.md), and every word the films show is in
[docs/COPY.md](docs/COPY.md).

## Look at it

Open `release/ten-wins-in-motion.html`. It is one self-contained file and works from
disk, with no server and no network.

Keys: `1`–`9` and `0` choose a win, `←` `→` move between them, `Space` plays or
pauses, `S` changes speed, `R` replays, `F` is full screen. The timeline can be
dragged; every film is a pure function of time, so it scrubs in both directions.

To put a single film inside an article, use the drop-in script:
[docs/EMBED.md](docs/EMBED.md).

## Build it

```bash
npm install
```

```bash
npm run build
```

That writes `dist/`. The build needs only Node 22.18 or newer. The browser tools
(tests, frame capture, PDF) use Playwright if it is installed; nothing else depends
on it.

| file | what it is |
| --- | --- |
| `dist/ten-wins-in-motion.html` | the whole thing in one file (about 200 KB) |
| `dist/index.html` + `dist/assets/` | the site: about 26 KB compressed to first picture, films fetched on demand |
| `dist/embed/wins-motion.js` | the drop-in script for an existing page |
| `dist/ten-wins-page.html` | the page as a body fragment, for hosts that supply their own `<head>` |
| `dist/build-report.json` | sizes, checked by the tests |

## Commands

| command | does |
| --- | --- |
| `npm run build` | build everything into `dist/` |
| `npm run release` | build, refresh the ready-to-use copies in `release/`, and rewrite `docs/COPY.md` |
| `npm run dev` | build, then serve `dist/` at http://localhost:8717 |
| `npm run check` | type-check |
| `npm run test:unit` | test the models, the figures and the copy (Node only) |
| `npm test` | unit tests, the browser tests and the layout check (needs Playwright) |
| `npm run verify` | play all ten films and report what each frame costs |
| `npm run lint:layout` | find clipped or overlapping text in every film, automatically |
| `npm run shoot -- --scene victus-haze` | capture frames and a contact sheet of one film |
| `npm run copy` | rewrite `docs/COPY.md` from the films |
| `npm run export` | a ten-page PDF, one page per win |

## How it is put together

```
src/
  core/      the player (one clock, one loop), the kit of helpers, the contract for a film
  draw/      the pen (hairlines, labels, plates, halftone fields) and the craft silhouettes
  ui/        the instrument rail: rolling numbers, rosters, chips, charts
  shell/     the page around the stage, the timeline, the drop-in embed
  scenes/    ten films; where a film has a model it sits beside it as *.sim.ts
  styles/    tokens and layout
  projects.ts  the ten wins: names, text, sources, caveats
scripts/     build, serve
tools/       capture, layout lint, health report, copy deck, PDF
tests/       unit tests for the models, figures and copy; browser tests for the page
docs/        design rules, sources, copy, embedding
```

A film is a pure function of time. Give it the same moment and it draws the same
picture, which is why the timeline can be scrubbed, why films can be tested frame by
frame, and why they look the same on every machine. Three films have a small model
behind them that runs without a browser: the schedule of 61 drones
(`leonidas.sim.ts`), the geometry of sound round a moving aircraft
(`quarterhorse.sim.ts`) and two satellites in orbit (`victus-haze.sim.ts`).
[docs/DESIGN.md](docs/DESIGN.md) explains the visual rules and how to add a film, and
[docs/DRAWING.md](docs/DRAWING.md) lists everything a film can call.

## Where the look comes from

The design system (black and white, one grotesque typeface, sharp corners, hairline
rules, small uppercase labels, one lime accent) and the film engine were carried over
from an earlier set of animated demonstrations, `si-demonstration-2`. Its tokens are in
`src/styles/base.css` and its rules in `docs/DESIGN.md`. What changed is the subject:
those films were fiction and said so; these are real events and cite their sources.

## Fonts

Two open-licensed typefaces, cut down to the characters used and renamed, as their
license asks of modified versions:

- **Field Sans** is a subset of Uncut Sans by Kasper Nordkvist: all text.
- **Field Mono** is a subset of Geist Mono by the Geist Project Authors: numerals and key hints.

Both are under the SIL Open Font License; the texts are in `assets/licenses/`.
`tools/subset-fonts.py` rebuilds the files in `assets/fonts/` from the originals.
