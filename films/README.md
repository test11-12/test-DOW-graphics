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
  hero.js       Cycles hero layer: plate switch, depth composite of path-traced heroes, export state (off by default)
  player.html / player.css
src/         one film per file, plus vehicle models and terrain recipes
narration/   <film>.script.json (text, timings) → <film>.json (durations + embedded voice)
tools/       build.mjs, render.mjs, storyboard.mjs, shot.mjs, tts.py; export_shots.mjs, composite.mjs (Cycles heroes)
heroes/      Cycles hero exports and renders (not committed)
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
- `blender/lib/acpaint.py`: building and painting hard-surface vehicles: a small geometry kit in the
  engine's body frame (lofts, wings, lathes), per-part ids, and projection painting: the livery, panel
  breaks, fasteners and sealant are drawn with Pillow in metres in side elevation and plan, where the
  reference photographs show them, and projected onto the baked position of every texel.
- `blender/fury.py` (+ `fury_geo.py`) builds `assets/fury/fury.glb`, the YFQ-44A (nodes `body`, `wings`,
  `misc`, `gear` with its own plain `tyres_own`, and the `nav_*` light positions); `blender/amraam.py` builds
  `assets/fury/amraam.glb` (nodes `aim120`, `motor_glow`; stations measured on the released photographs).
  `fury geo` / `fury paint` run the Cycles bakes and the repaint separately. `src/fury_assets.js` loads both
  behind the interface of `src/fury_model.js` (film 2 imports it) and, when `assets/fury/tyres.glb` is packed,
  puts the ramp tyres from `blender/fury_ramp.py` on the gear in place of `tyres_own`.
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

## Path-traced heroes (Cycles)

For close shots the vehicles can be path-traced in Blender Cycles (OptiX on an NVIDIA RTX GPU) with the film's own
cameras, sun and sky, and composited into the engine's own frame: sky, terrain, sea, clouds, smoke and every lens
effect stay the engine's. It is off by default: a page only changes when it is opened with `?nohero=` or
`?herolayer=`, and the tools below are the only things that open it that way.

```bash
cd films && node tools/build.mjs fury
# 1. per frame: camera, sun, ground, hero and set-piece transforms; per shot: the engine's sky as an HDR
node tools/export_shots.mjs fury --from=14.3 --to=23 --w=1920 --h=1080          # or --times=17,48.6
# 2. the heroes in Cycles (OptiX > CUDA > HIP > oneAPI > CPU, picked automatically; --device=CPU to force).
#    One frame first: read heroes/fury/cycles/timing.json, then the rest (--no-exr saves about 55 MB a frame)
node tools/blender.mjs hero_shot --export heroes/fury --frames 510 --samples 256 --noise 0.01
node tools/blender.mjs hero_shot --export heroes/fury --samples 256 --noise 0.01 --no-exr
# 3. stills: the composite, plus the film as built, the plate and an engine | composite sheet
node tools/composite.mjs fury --hero=heroes/fury/cycles --w=1920 --h=1080 --compare 17 20.5
# 4. the sequence and its MP4 (frames cached in frames/fury/1920x1080@30-hero/, written to out/fury-hero.mp4)
node tools/render.mjs fury --hero=heroes/fury/cycles --from=14.3 --to=23
```

On Windows run the same commands from `films` in PowerShell; set `$env:BLENDER="C:\Program Files\Blender
Foundation\Blender 4.5\blender.exe"` first if Blender is not at `/opt/blender/blender`. Use the same `--w --h` (or
`--res` in step 2, a percentage) everywhere; the engine also accepts a layer of another size (scaled linearly), but
not another frame rate: `render.mjs --hero` refuses an `--fps` other than the export's.

**Before a long sequence, check for flicker.** Each frame is denoised on its own with a new seed, so dark undersides
and glossy panels can boil from frame to frame. Render 30 consecutive frames of one close shot
(`--frames 510-539`), play them through the engine (`render.mjs --hero --from=17 --to=18`) and look. If they boil,
raise `--samples`, lower `--noise` (0.005), or set `--min-samples 64` for close-ups; the engine's grain hides the rest.

**What each piece does**

- `engine/assets.js` tags what `loadGLB` loads: `root.userData.asset = <asset path>`, and every glTF node
  `userData.glbNode = [asset, node index]`. `clone()` copies userData, so props and tyres cloned out of a model keep
  their source. No film code has to say what is a hero.
- Heroes are the meshes registered with `pipe.registerDynamic` that came from a `.glb` (`--heroes=1`, the default:
  in film 2 the Fury, its ramp tyres and the AIM-120). `--heroes=fury/amraam.glb` (a comma list of assets) path-traces
  only those; the engine keeps drawing the rest. The selection is chosen once, at export: `shots.json` and the
  renderer's `layer.json` record it, every `hero_<n>.bin` carries its hash, `composite.mjs` and `render.mjs --hero`
  take it from there (an explicit `--heroes` that differs is an error), and the page refuses a layer rendered for
  another selection, since the engine would then hide meshes Cycles did not render, or draw ones it did.
  `?nohero=all` (the plate without code-built moving meshes as well) is for plates only: Cycles cannot render
  code-built meshes, so it is refused together with a layer. Visible `.glb` meshes that are not heroes (ramp props)
  are exported as set pieces. Code-built moving objects are exported as named transforms only and stay engine-drawn
  until they are built in Blender (films 1 and 3 today).
- `tools/export_shots.mjs` runs the built page headless at 320 px wide with the target aspect, renders each frame
  (so every pose, shot hook and grade is exactly the film's) and writes `heroes/<film>/frame_<n>.json` (camera:
  absolute position = floating origin + local, quaternion, vertical fov, aspect, near, far; sun direction and linear
  irradiance; ground: sea level, or the baked terrain height under the camera and under each hero; the shot's
  exposure, white balance, shutter and focus; every visible glTF node instance with asset, node index, absolute
  world matrix, role, emissive state; point and spot lights that are on, such as the missile motor's lamp;
  registered moving objects as transforms), `env_<shot>.hdr` (the engine's
  reflection environment, equirectangular, `u = 0.5 + atan2(y, x)/2π`, `v = 0.5 + asin(z)/π` in Blender axes) and
  `shots.json`. One padding frame either side gives motion-blur keys.
- `blender/hero_shot.py` imports each `.glb` once and instances the exported nodes at their matrices (engine axes
  converted to Blender's), poses the camera (vertical sensor fit, 24 mm sensor: the engine's lens model), a sun lamp
  (0.53° disc; colour and strength = the engine's irradiance, which is in the same units as Blender's W/m²), the
  engine's own sky as world light (`--sky nishita` for a Nishita sky at the sun's position, scaled to the same sky
  irradiance), the engine's point and spot lights near the heroes (power = 4π × the engine's intensity: the same
  irradiance at a distance; `--no-lights` to leave them out), a shadow-catcher plane at the ground level and
  set pieces within `--set-radius` m as shadow catchers; film transparent, adaptive sampling, OpenImageDenoise (on
  the GPU when there is one), persistent data. A hero node it cannot instance (its `.glb` missing under
  `films/assets`, or its glTF node not found in the Blender import) stops the run with the node's name: the plate
  hides every hero mesh, so a skipped one would silently vanish from the film.
  Per frame it writes `hero_<n>.exr` (linear, premultiplied: Combined, Depth, Shadow Catcher), `hero_<n>.png` (a
  preview through the engine's tone curve) and `hero_<n>.bin` (the layer the engine loads: the crop holding the
  heroes and their shadows; colour + alpha, shadow ratio, view depth), plus `timing.json` (wall and CPU seconds per
  frame) and `layer.json`. `--mblur` and `--dof` put motion blur (keyed from the neighbouring frames, the shot's
  shutter) and focus blur into Cycles for use outside the engine; for the engine composite leave them off (see below).
- The plate, `?nohero=1`: the heroes are hidden from the colour pass and the shadow map (their shadows go; the
  catcher brings them back) and `def.heroless(film, layer)` lets a film drop its own painted shadows of the objects
  the layer replaces (film 2: the jet's contact shadow on the apron, only when the jet is among the heroes).
- The composite, `?herolayer=<folder url>/` (`tools/composite.mjs`, `tools/render.mjs --hero`): `engine/hero.js`
  loads `hero_<frame>.bin` and, in `pipeline.render`, right after the deferred terrain and sea lighting, multiplies
  the plate by the shadow ratio, lays the premultiplied hero over it where the hero is nearer than the plate, and
  writes the hero's depth into a copy of the scene depth that every later pass reads. `composite.mjs` snaps each
  still's time to the layers' frame grid, so the engine and the Cycles hero are posed at the same instant.

**Why the composite happens inside the engine.** The engine already is a depth-aware linear-light compositor: aerial
perspective, cloud and cirrus layers, the effects layer (smoke trails, plumes, glows, spray: drawn after the
atmosphere and tested by hand against the scene depth), refraction, depth of field, motion blur, bloom, flare, AgX
tone map, grade, vignette and grain all work from the HDR colour and the depth. Laying the Cycles hero in there,
with its depth, gives it exactly the plate's treatment, and the effects sort against it per pixel: smoke in front of
the jet stays in front, smoke behind it is hidden, a chock nearer than a wheel hides the wheel, the missile's heat
haze bends the airframe behind it. On the sea the engine's own moving water surface clips a hull: there the ground
plane only lights the hull from below and is hidden from the camera, because a shadow catcher the camera sees holds
out what is behind it and would cut every hull flat at sea level, leaving a gap at the waterline in every wave trough
(the price: no hull shadow on the water). A separate effects layer composited last could not put smoke *behind* the
hero, and a Python re-implementation of the grade, bloom, flare and lens would drift from the engine's. Motion blur
is the engine's too: the hidden hero meshes still draw into the velocity pass, and they have the same silhouette as
the Cycles render because both come from the same `.glb`; hero and background blur together. Screen-space AO is not
applied on the hero (Cycles has full global illumination); the plate's AO is computed before the hero goes in, so
the hero's contact occlusion on the ground comes from the shadow catcher alone.

**Checked on the CPU build machine** (no GPU; film 2 with the Blender Fury and AIM-120 and the golden-hour look,
640x360, `--samples 48 --noise 0.02`, 4 threads shared with other builders): t = 17 (s03, the missile under the wing,
the whole frame hero and shadow) took 155 s of wall time and 112 CPU-seconds in Cycles; t = 48.6 (s08, the launch, a
250x100 px hero) 21 s and 15 CPU-s. `timing.json` records both numbers per frame: on a shared machine the CPU-seconds
are the work and the wall time is the share it got (here about a fifth of the 4 threads). The composite pass adds two
full-screen passes to the engine frame. With the feature off, stills of all three films (two times each, 480x270) are
bit-identical before and after this change. Also checked: a hero whose `.glb` or glTF node is missing stops the run;
the soft-edge depth fill leaves no covered pixel without a depth (the earlier 3 x 3 rule left 54 and 34 in these two
frames); a ground plane through the jet as `sea` renders the whole jet where `terrain` holds out the part above it;
`--mblur --no-exr` runs; the tools and the page refuse a mismatched selection, `all` with a layer, a layer of another
film and an `--fps` other than the export's.

**Estimated cost on an RTX 5090 at 1920x1080** (an estimate, not a measurement; render one frame first and read its
`timing.json`). Scaling: 9× the pixels and about 4× the samples for `--samples 256 --noise 0.01`, so 36×. Blender Open
Data puts an RTX 5090 with OptiX very roughly 100-200× above a 4-thread share of a server CPU.

| per 1080p frame | close-up (t = 17) | small hero (t = 48.6) |
|---|---|---|
| Cycles, from the CPU-seconds (the work, independent of how busy this machine was) | 112 × 36 / 4 threads ÷ 100-200 = **5-10 s** | 15 × 36 / 4 ÷ 100-200 = **1-2 s** (GPU overheads dominate) |
| Cycles, from the wall time (no correction for the shared machine: an upper bound) | 155 × 36 ÷ 100-200 = 28-56 s | 21 × 36 ÷ 100-200 = 4-8 s |
| CPU side of `hero_shot.py`: scene update, GPU denoise, 32-bit EXR, reading it back, depth fill, preview (0.5 s at 640x360 here) | 2-4 s | under 1 s |
| engine frame in `render.mjs --hero` (load the 10-50 MB layer, render, JPEG) | SwiftShader as today: 5-40 s; hardware WebGL in Chrome on the 5090 (the GPU-mode work): about 1 s | same |

So a 900-frame close-up sequence (30 s of film) is about 2-3.5 hours of `hero_shot.py` at 256 samples (7.5-15 hours if the
wall-time row is the right one), plus the engine pass: about 15 minutes with hardware WebGL, 1.25-10 hours on
SwiftShader. A full-frame 1080p layer is about 50 MB and its EXR about 55 MB: use `--no-exr` for sequences.

**Limits.** The heroes must come from `.glb` files on both sides (the engine and Blender render the same model).
Cycles' depth is from the first sample: a covered pixel without one (a soft or thin edge, a first sample that missed)
takes the nearest solid hero depth within 3 px, else within 19 px, else the hero's median depth. The world light is
the engine's environment at the start of the shot. Set pieces that the engine builds in code (the power cable, the
streamers) receive shadow from the ground plane's ratio, not their own shape. Film 2's per-shot paint tweaks (paint
roughness × 0.75, sky fill × 0.5 in the backlit shots) are engine-side and not carried to Cycles, which renders the
`.glb` materials as authored under the real sky. Engine lamps (the missile motor's) also light the shadow catchers,
so near a lit motor on the ground the ground would get that light twice (not in film 2: the motor lights in the air).

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
