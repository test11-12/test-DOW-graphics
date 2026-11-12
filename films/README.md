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

## Offline quality on a GPU machine: accumulation, supersampling, `--gpu`

Everything here is switched off unless asked for; without the flags below, `render.mjs` and `shot.mjs` produce
exactly the frames they always did (checked: stills before and after this code are bit-identical).

**Accumulation** (`--accum=N`, `engine/film.js` `renderAccum`): each output frame is the mean of N sub-renders of
the same moment, each jittered in

- time, across the shot's shutter (`post.accumShutter` if the shot sets one, else `post.shutter`, default 0.5, as
  a fraction of a frame, centred on the frame time and kept inside the shot): stratified, in shuffled order, so
  everything that moves blurs for real, the camera included;
- sub-pixel position (R2 sequence, through the camera's view offset), drawn from a tent filter of radius 1 output
  pixel (`--filter=R` changes the radius; with `--ss` it is one internal pixel, and the Lanczos filter down does
  the reconstruction): anti-aliasing of edges, wires, glitter and the deferred terrain and sea, which the MSAA
  scene pass does not reach;
- the shadow light across the solar disc (0.53°) plus a fraction of a shadow-map texel: soft, unstepped hero
  shadows (only the shadow map moves: the sky, the sun disc and the baked terrain keep the true sun);
- the lens over an aperture disc perpendicular to the view, with the frustum sheared so the focus plane of
  `post.dof` stays put: real depth of field. The aperture is sized to give the same blur as the screen-space DOF
  pass at every depth (that pass uses the circle of confusion of an f/N lens, its diameter, as the blur radius,
  so its blur is twice a physical f/N; the radius is f/N x S/(S - f), focal length f on a 24 mm-high sensor,
  focus distance S), and the blur at infinity is held to the pass's `dof.max` cap. Nearer than the focus plane
  the lens is not capped as the pass is, so a foreground very close to the lens blurs more than today.

Each sample dimension (time, pixel, lens, sun disc, shadow texel) is low-discrepancy on its own (stratified time,
R2 with its own toroidal shift, Halton 2,3 for the lens), and the orders that pair them up are chosen, of 64
fixed candidates, to keep the worst correlation between any two dimensions small (about 0.39 at N = 16, 0.19 at
N = 64), so a sun offset never follows the pixel offset and penumbrae stay round. While accumulating:

- the screen-space DOF pass is off (the lens does it);
- the screen-space motion blur stays on in each sub-render, but only across that sub-render's own 1/N slice of the
  shutter (`post.shutter` = shutter / N, centred on the slice). The slices join, so anything that moves more than
  N pixels in a frame is one continuous smear, not N separate copies (`"stratumBlur":false` in a `shot.mjs`
  override shows the bare samples);
- the ray-march and sample dithering of the scene passes (clouds, plumes, smoke, light shafts, the blur itself)
  is seeded per sub-render (`frame x N + k`), so its noise averages away; grain, the thermal sensor noise and the
  dither are drawn once, on the mean, with the frame's own seed, so they keep their art-directed strength;
- the sum is taken on the scene-referred HDR frame (scene plus bloom, rays and flare, times exposure) before tone
  mapping; the grade and AgX run once on the mean, and `post.fade` is averaged over the shutter.

Film code can test `film.accum` (non-null while sub-rendering; `film.accum.n` is N) to drop its own shutter
stand-ins. Film 2 does: its smoke trail's `blur` (lumps shorter than the smear fade to their mean) is off when
N > 1, and the fly-out (s09) sets `accumShutter: 0.25`, the 90° shutter its smoke was tuned for, so the trail
smears the art-directed distance and keeps its billows.

Real motion blur changes a few shots' look, not just their quality, because the screen-space pass never blurred
the effects layer correctly (it has no motion vectors of its own, so the pass smears it with whatever is behind
it, or not at all):

- film 2, s08 and s09: the smoke trail streams past the formation camera and now really smears over the shutter.
  Its large billows stay, but the near trail is softer than today's, which was never smeared at all. Lower the
  shot's `accumShutter` for a crisper trail.
- film 1, s08 (the pass): the shock cone's edge-on "line" aid (`line: 0.12`) shows as faint straight lines across
  the sky. The cone moves with the jet, which the camera tracks, so it stays sharp under accumulation; today the
  screen-space blur smears it away with the fast-moving background. Set `line` to 0 under accumulation if the
  shot should not show it.
- anything that moved fast across the frame keeps the length of smear its shutter implies, where the screen-space
  pass capped it at 5.5% of the frame height (film 1's pass: roughly 200 px at 1080p instead of 59).

A frame is a pure function of (t, N, K), whatever was rendered before it in the session: the per-shot caches (sky
table, reflection probe, cloud ambient) are rebuilt for the frame, and a discarded warm-up sub-render comes first,
because a few passes read state the previous render left (the sea's reflection pass runs before the sun and probe
are updated; sea and terrain read the cloud layer's previous position). So a frame costs N + 1 sub-renders (two
with `--ss` alone).

**Supersampling** (`--ss=K`): every internal buffer at K times the output size, the bloom pyramid and pixel-sized
kernels (DOF cap, sharpen) kept at their output-pixel size, then a Lanczos-2 filter down to the output size, with
the thermal sensor noise, grain and dither added at the output resolution (so they keep their strength). `--ss`
works with or without `--accum` (alone it keeps the screen-space blurs). With accumulation the jitter already
anti-aliases; `--ss=2` mainly buys texture and shading detail (the sea's glitter and fine waves, which the engine
filters by pixel size) at about 3 to 4x the cost per sub-render; its result matches a real render at twice the
size scaled down. It does not add geometry: the sea and terrain meshes are capped at the density of a 1080p frame
(about one column per 3 output pixels), so `--ss=2` at 1080p has the same sea and terrain silhouettes as an
ordinary 1080p frame, only anti-aliased and more finely shaded.

```bash
node tools/shot.mjs fury /tmp/f --w=640 --h=360 --accum=16 48.6 56          # stills
node tools/shot.mjs fury /tmp/f 18:'{"accum":32,"dof":{"focus":3.4,"fstop":1.4}}'   # per-still overrides
node tools/render.mjs fury --w=1920 --h=1080 --accum=16                      # frames/fury/1920x1080@30_a16_ss1/
```

`window.FILM.renderFrame(t, { accum: N, ss: K, filter: R })` is the page API (returns timings); `renderFrame(t)` is
unchanged. Both throw if the WebGL context was lost. `render.mjs` writes each frame under a temporary name and
renames it, so a frame on disk is always whole; a frame that fails (lost context after a driver reset or Windows
TDR, crashed page or browser) is deleted and retried once in a fresh browser, and a second failure stops the run
(exit 4; re-run to resume). With `--gpu` the film's own context is re-checked in every new browser and every 200
frames, so a browser that fell back to a software rasteriser mid-run stops the render instead of producing frames.

**GPU mode** (`--gpu`, `tools/gpu.mjs`): runs WebGL on the real GPU instead of SwiftShader. Linux: Playwright's
full Chromium in the new headless mode with ANGLE over Vulkan (`--enable-gpu --use-angle=vulkan
--enable-features=Vulkan --disable-vulkan-surface`, the set Chrome's GPU-testing guide uses for NVIDIA on Linux);
Windows: ANGLE over Direct3D 11 (`--use-angle=d3d11 --force_high_performance_gpu`); macOS: Metal. Both tools print
the WebGL renderer (`WEBGL_debug_renderer_info`) of a probe context and of the film's own context, and exit (code 3)
with a checklist if it is SwiftShader, llvmpipe or any software rasteriser. Options: `--channel=chrome` (the
installed Google Chrome; default `chromium`), `--angle=gl-egl|gl|vulkan|d3d11`, `--chrome=/path/to/chrome`,
`--headed` (a visible window, if a driver will not render headless), `--gpu-args="..."`. `render.mjs --gpu`
defaults to 4 workers (2 on the CPU path).

### Commands for the RTX 5090 machine

Once, on Linux (driver 570 or newer, its Vulkan ICD installed; `nvidia-smi` and `vulkaninfo --summary` must both
list the card):

```bash
cd films && npm ci && npm install --no-save playwright && npx playwright install --with-deps chromium
node tools/build.mjs
node tools/shot.mjs fury /tmp/gpucheck --gpu --w=1920 --h=1080 --accum=16 48.6
# prints "WebGL: ANGLE (NVIDIA ..., GeForce RTX 5090 ...)" and the cost per sub-render ("... ms each")
```

(`--with-deps` installs the system libraries the full Chromium needs; it uses `sudo` for the package manager.)

On Windows (PowerShell; Chrome installed):

```powershell
cd films; npm ci; npm install --no-save playwright; npx playwright install chromium
node tools/build.mjs
node tools/shot.mjs fury $env:TEMP\gpucheck --gpu --channel=chrome --w=1920 --h=1080 --accum=16 48.6
```

Then each film (the same on both; add `--channel=chrome` on Windows):

```bash
node tools/render.mjs quarterhorse --gpu --w=1920 --h=1080 --fps=30 --accum=16
node tools/render.mjs fury         --gpu --w=1920 --h=1080 --fps=30 --accum=16
node tools/render.mjs corsair      --gpu --w=1920 --h=1080 --fps=30 --accum=16
# final masters: --accum=32 or 64, optionally --ss=2; frames are cached per setting under
# frames/<film>/1920x1080@30_a<N>_ss<K>/ (plus _f<R> with --filter), so a re-run resumes where it stopped
```

If the probe refuses (software renderer): try `--angle=gl-egl`, then `--channel=chrome`, then `--headed` from a
desktop session, and open `chrome://gpu` in the same browser to see why.

**Cost.** A sub-render costs a little less than an ordinary frame (no DOF pass, no grade; the motion blur runs over
its short slice). Measured here at 640x360 on SwiftShader (4 shared cores, load 12 to 17): ordinary frames 4 to 8 s
(up to 15 s for the first frame of a shot); sub-renders 2.4 to 3.9 s, 5.2 s on the apron at sunset and 5.8 s in the
DOF close-up (film 2, t = 3 and 18); so `--accum=16` (17 sub-renders with the warm-up) is 41 to 99 s a still, about
12x an ordinary frame. `--ss=2` alone is 12 s (two renders at twice the size). At 1920x1080 (film 1's pass,
film 2's fly-out, film 3's boat pass; load 17 to 21) an ordinary frame took 25 to 33 s and a sub-render 15 to 24 s,
so `--accum=16` was 4.3 to 6.9 min a still. A frame of N is (N + 1) sub-renders plus one screenshot. The 5090's time per 1080p sub-render is not measured yet (no GPU
here); the first `shot.mjs ... --gpu --accum=16` prints it ("ms each"). Assuming 25 to 60 ms per 1080p sub-render (JavaScript scene
update plus about twenty GPU passes and three ray-marched volumes) and about 50 ms per screenshot:

| Film | Frames (30 fps) | `--accum=16` | `--accum=32` | `--accum=64` | `--accum=16 --ss=2` |
|---|---|---|---|---|---|
| quarterhorse (80 s) | 2400 | 19 to 43 min | 35 to 82 min | 67 to 158 min | 1 to 2.5 h |
| fury (79 s) | 2370 | 19 to 42 min | 35 to 81 min | 66 to 156 min | 1 to 2.5 h |
| corsair (81 s) | 2430 | 19 to 43 min | 36 to 83 min | 68 to 160 min | 1 to 2.5 h |

(`--ss=2` taken as 3.5x per sub-render.) Several workers overlap the JavaScript and screenshot time of one
browser with the GPU work of another, so the wall clock should come in at or under the low end when the frames
are CPU-bound. For comparison, the same `--accum=16` on SwiftShader at 1080p (5 to 40 s per sub-render) would take
60 to 450 hours per film.

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
