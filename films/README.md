# Firsts — three simulated films

Narrated, storyboarded visualizations of three 2026 defense-tech firsts. Each is a real-time 3D film that
plays in a browser and renders, frame for frame, to MP4.

| Film | Event | Page | Video | Storyboard |
|---|---|---|---|---|
| **Mach 1.21** | Hermeus Quarterhorse Mk 2.1 goes supersonic on its third flight (May 26, 2026) | `dist/quarterhorse.html` | `out/quarterhorse.mp4` | `storyboards/quarterhorse.md` |
| **Fox Three** | Anduril YFQ-44A Fury fires its first AIM-120 AMRAAM (announced July 15, 2026) | `dist/fury.html` | `out/fury.mp4` | `storyboards/fury.md` |
| **Three Corsairs** | Saronic Corsair sea drones strike Bandar Abbas Naval Base (July 12, 2026) | `dist/corsair.html` | `out/corsair.mp4` | `storyboards/corsair.md` |

These are simulations, not footage. Every film carries a persistent on-screen tag saying so and ends on a
card listing its sources and what is illustrative.

## What is real and what is illustrative

Stated as fact (on screen or in narration) only when it appears in a primary statement or trade
reporting: dates, places, vehicle names, counts, the Mach 1.21 peak, quoted officials. Not publicly
released, and therefore illustrative here: times of day, weather, altitudes, flight and approach paths, telemetry
traces, camera positions, the look of sites beyond what released imagery shows. Vehicle models are built
from released photographs; dimensions are estimates.

## Layout

```
engine/      shared renderer and runtime
  pipeline.js   HDR passes: scene (MSAA, log depth) → sky and aerial perspective → effects → refraction →
                motion blur → bloom → lens, tone map, grade
  glsl.js       noise and the atmosphere model (Rayleigh, aerosol, ozone; sky-view LUT)
  terrain.js    baked procedural terrain: height and mask maps from a GLSL recipe, drawn as a curved,
                camera-centred grid with per-pixel shading
  geo.js        modelling kit: lofted bodies, wings, decals, painted panel / rivet skins
  fx.js         afterburner plume, heat haze, shock fronts, smoke trails, glows
  audio.js      procedural sound and score, rendered once to a buffer
  film.js       shot timeline, overlays, captions, player, offline frame API
  player.html / player.css
src/         one film per file, plus vehicle models and terrain recipes
narration/   <film>.script.json (text, timings) → <film>.json (durations + embedded voice)
tools/       build.mjs, render.mjs, storyboard.mjs, shot.mjs, tts.py
dist/        built pages (self-contained; three.js from cdnjs, or inlined in *.offline.html)
out/         rendered MP4s
storyboards/ shot lists with stills
```

Nothing is loaded from outside: geometry, textures, sound and score are generated in code. The narration
voice is synthesized locally (Kokoro, an open neural TTS model); no text leaves the machine.

## Build, preview, render

```bash
cd films && npm ci
```

```bash
node tools/build.mjs            # all films → dist/
```

Open `dist/<film>.offline.html` in a browser to play it. To render video (headless Chromium, needs
Playwright and ffmpeg; frames are cached under `frames/` so re-runs only render what changed):

```bash
node tools/render.mjs quarterhorse --w=1920 --h=1080 --fps=30
```

```bash
node tools/storyboard.mjs quarterhorse
```

To change narration, edit `narration/<film>.script.json`, then regenerate the voice (Python venv with
`kokoro-onnx` and `soundfile`, model files `kokoro-v1.0.onnx` and `voices-v1.0.bin`):

```bash
python tools/tts.py quarterhorse --models /path/to/models
```

## How a film is defined

A film is a list of shots. Each shot gives a time range, a `pose(time)` that places the world, a
`camera(time)` that returns a position, target, lens and shake, and a grade. Because every frame is a pure
function of film time, live playback, scrubbing and the offline renderer produce the same picture. World
positions are kept in double precision and re-centred on the camera every frame, so a 14 m aircraft and a
400 km horizon share one scene.

## Engine reference

`src/quarterhorse.js` is the worked example for everything below.

**Frame order** (`engine/pipeline.js`): sky-view table and ambient → reflection probe → aerial-perspective
froxels → scene (MSAA, log depth) → motion vectors → deferred terrain lighting → ambient occlusion →
volumetric clouds → sky, sun, aerial perspective and cloud composite → effects layer → refraction (heat
haze, shock fronts) → depth of field → motion blur → light shafts → bloom and flare → lens, AgX tone map,
grade, grain.

**Layers** (`LAYER`): `STATIC`, `DYNAMIC` (call `pipe.registerDynamic(root)` so it gets motion vectors),
`FX` (additive, drawn after the atmosphere; test depth by hand against `tDepth`), `DISTORT` (refraction).

**Grade and lens**, per shot, in `post`: `exposure, contrast, sat, wb, lift, tint, bloom, bloomSpread,
vignette, grain, ca, shutter, shimmer:[px, scale, far], aerial, sunDisk, sharpen`,
`dof:{focus (m), fstop, max (px)}`, `rays` (light shafts when the sun is in or near frame),
`flare:{ghost, halo, streak, thr}`, `ao:{radius, strength}|false`, `cirrus:{alt, cover, opacity, scale, wind}`,
`clouds:{…}` (below), `mode:'thermal'` with `thermal:[gain, level, noise, polarity]`, `envKey`,
`envDeck:{alt, k}`.

**Sun and air**: `pipe.atmo.setSun(azimuthDeg, elevationDeg)` (0 = north, 90 = east);
`pipe.atmo.uniforms.uHaze / uHazeH` set aerosol density and scale height; `pipe.atmo.groundAlbedo`.

**Clouds** (`engine/clouds.js`): `new CloudLayer(pipe, {base, top, div})` ray-marches one layer of cumulus
between two altitudes (m MSL) at 1/div resolution. Turn it on per shot with
`post.clouds = {cover 0..1, scale, wind:[km/s, km/s], density, tile (m), steps, erosion, gain, shear,
shadow 0..1, hole:[x, z, radius, strength]}`. `hole` thins the layer around a world position (to keep a low
sun or the ground under a look-down shot visible). Create the layer before the terrain and pass
`clouds.terrainShadow()` into the terrain recipe (`uniforms`, `defines`) so the ground takes the same
cloud shadows.

**Terrain** (`engine/terrain.js`): a recipe is GLSL for `terrainH(km, lod)`, `terrainMask(...)` and
`shadeTerrain(...)`, plus the extents of a near and a far baked map. The mesh only writes depth; one
full-screen pass lights it. In `shadeTerrain`, sample the shared detail texture with `dtex(duv(i), i)`
(scale slot `i`, stable under the camera). `spec > 0` marks open water (mirror of the sky plus glitter);
`spec < 0` marks pavement (glossy low-sun lobe, sky sheen at grazing angles). Anything drawn over the
terrain with alpha below 1 (for example dark shadow streaks under plants) lets that much less terrain
light through.

**Effects** (`engine/fx.js`): `makePlume` (ray-marched afterburner with shock cells), `makeHeatHaze`,
`makeShockCone`, `Trail` (stateless particles), `makeGlow`.

**Development tools**: `node tools/shot.mjs <film> <outPrefix> [--w --h --nres --prof=1 --off=a,b
--cam=x,y,z,lookx,looky,lookz,fov --debug=scene|ao|vel|tile] t1 t2 …` renders stills at film times;
`--prof=1` prints per-pass timings; `--cam` replaces the shot's camera.
