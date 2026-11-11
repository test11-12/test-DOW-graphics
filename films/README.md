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

Sound, score, sky, terrain, sea and effects are generated in code; hero models and close-range materials are
built in Blender from CC0 photoscans (see below). The narration voice is synthesized locally (Kokoro, an open
neural TTS model); no text leaves the machine.

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

## Assets made in Blender

Models and textures that need real modelling and photographic material (aircraft, boats, the harbour, rock,
ground) are built by scripts in `blender/` that run headless Blender 4.5 LTS through its Python API, and are
exported as glTF into `assets/<film>/`. The engine loads them with `engine/assets.js`; `tools/build.mjs`
packs every `.glb` and every file under a `tex/` folder of `assets/<film>/`, `assets/shared/` and the folders
a film's `meta.json` lists under `"assets"` into the page.

```bash
node tools/blender.mjs <generator> [args]     # Blender from $BLENDER, else /opt/blender/blender
```

- `blender/lib/dowlib.py`: shared helpers: scene reset, bevels and smoothing, UVs and texel density,
  material node helpers (tri-planar scanned materials, edge-wear and occlusion masks), PBR baking
  (base colour, ORM, normal, emissive; occlusion denoised), glTF export, a quick Cycles preview, and
  downloads of CC0 photoscans from Poly Haven and ambientCG.
- Conventions: metres; vehicles modelled nose along +X, up +Z, starboard along -Y (the engine's +x forward,
  +y up, +z right after export); per-material maps: base colour (sRGB), ORM (R occlusion, G roughness,
  B metal), OpenGL normal.
- Sources are cached in `$DOW_CACHE` (default `/opt/dow-cache`) and never committed; the exported `.glb`
  files are, so the films build without Blender.
- `src/lookdev.js` is a turntable for checking any packed asset under the films' sky and grade:
  `node tools/shot.mjs lookdev <prefix> --q="glb=quarterhorse/quarterhorse.glb&el=10&dist=20" t` (t from 0 to 12
  orbits once; `--q` passes any URL parameters to the page).

- `blender/ground_tex.py` writes the tiling ground material sets in `assets/shared/tex/ground/` (albedo,
  a grey two-up x|y normal, packed occlusion / roughness / height) that the terrain's material layers read.
- `blender/scrub.py [--film=NAME --sun=AZ,EL]` bakes the desert scrub: each scanned plant rendered in Cycles
  from 16 azimuths under the film's own sun, as two light groups (sun, sky) that the film relights, plus a
  top-down shadow and occlusion decal per plant. It writes `assets/<film>/tex/scrub_*.webp` and
  `src/scrub_atlas_<film>.js`; `src/scrub.js` draws them (see "Scrub" below). Re-bake when a film's sun moves.

Photoscanned materials and models come from [Poly Haven](https://polyhaven.com) and
[ambientCG](https://ambientcg.com), both CC0.

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

*Photoscanned layers* (optional): `recipe.layers = [{ name, albedo, normal, orm, scale, rotate, detail }]`
(texture paths under `assets/`, `scale` in metres per tile) are packed into two texture arrays; a recipe
without `layers` renders exactly as before. In `shadeTerrain` (inside `#ifdef TERRAIN_LAYERS`):
`Surf s = layerSample(L_NAME)` samples a layer hex-tiled (no repetition, footprint-correct, fading to the
layer's mean far away); `layerSampleST(L_NAME, st, dx, dy, angle)` samples it in a mapping of your own (per
slab, per plank); `surfBlendH(a, b, t, soft)` blends two surfaces by height; `surfApply(s, k, alb, N)`
writes one into the outputs and switches the pixel to the layered lighting (cavity occlusion, GGX, sky
reflection, relief under a low sun kept energy-neutral). `layerMeanAlbedo(L_NAME)` lets a recipe regrade a scan
to a target colour or use it as a multiplier over its own painted surface. `layerAniso` / `layerAnisoB` set
the anisotropy of the two arrays (albedo + height; normal + roughness + occlusion); `detail: [k, strength]`
lays the scan over itself k times finer (k a whole number) where the camera magnifies it; `relief` (metres per
unit of the height channel) marches the scan's height field towards the sun within a few centimetres per pixel,
so stones, cracks and broom ridges cast their own shadows under a low sun (`Surf.sh`, debug view `uDebug = 9`).
Recipe options: `partialGround: true` finds the ground behind half-covered pixels (the fine blades at a plant's
edge) instead of shading it on the impostor's plane; `ambSat` (0..1) takes saturation out of the sky light on
the layered ground. Heights are R32F, or hi + lo in RG16F on GPUs without `OES_texture_float_linear` (`?hsplit=1`
forces that path for testing); read them with `hLod()` / `hRead()`, which add the parts.

**Scrub** (`src/scrub.js`): `await buildScrub(pipe, { atlas, terrain, clouds, field })` returns
`{ group, update(camera, film) }`. Plants are impostors relit from the baked sun and sky light groups, with
baked ground-shadow decals; nothing is stored per plant. A field (`{ pitch, cell, bounds, density, species,
glsl, sizes, tone }`, GLSL `scrubD` (grass, shrubs per slot), `scrubDensity`, `scrubGrassy`, `scrubDrawn`) says
where plants grow and how big and bright each species is (`sizes`: scale on the baked plant, `tone`: gain on its
baked albedo, or `[gain, saturation]`); the film's terrain recipe includes the same GLSL so the ground's tone
stands in for plants too small to draw. Keep the scrub as the photographs show it: low (creosote under about
1.5 m), metres apart, graded strips beside the pavement. Film 1: `SCRUB_FIELD_NM` (in `scrub.js`); film 2:
`src/scrub_mojave.js`.

**Sea** (`engine/ocean.js`): `new Ocean(pipe, {clouds, sea: {wind, amp, long, chop, spread}})` draws a
displaced grid depth-only and lights it in one full-screen pass (sea level is world y = 0). Call
`ocean.update(t, {wake: {x, z, size}, reflect, whitecap, glitter, sparkle, slick, thermal})` once per frame
after the camera is posed. `ocean.heightAt(x, z, t)` is the same wave sum on the CPU, for hulls riding the
sea; `ocean.wakes` (track functions) and `ocean.discs` (splash rings) feed the foam map;
`ocean.setShelter(x, z, r0, r1, k)` calms the water inside a harbour.

**Effects** (`engine/fx.js`): `makePlume` (ray-marched afterburner with shock cells), `makeHeatHaze`,
`makeShockCone`, `Trail` (stateless particles), `makeGlow`.

**Development tools**: `node tools/shot.mjs <film> <outPrefix> [--w --h --nres --prof=1 --off=a,b
--cam=x,y,z,lookx,looky,lookz,fov --debug=scene|ao|vel|tile] t1 t2 …` renders stills at film times;
`--prof=1` prints per-pass timings; `--cam` replaces the shot's camera.
