# Rendering the films on a Windows PC with an NVIDIA GPU

Hand-off for a Claude Code session (or a person) on a Windows PC with an NVIDIA RTX card (written for an RTX 2070,
8 GB). Everything here runs from `films/` in PowerShell. The engine, tools and asset pipeline are described in
`README.md`; this file is only the render plan.

**What this is.** Three narrated, labelled simulations ("SIMULATED VISUALIZATION · NOT ACTUAL FOOTAGE"):
`quarterhorse` (film 1, "Mach 1.21"), `fury` (film 2, "Fox Three"), `corsair` (film 3, "Three Corsairs"). Branch
`claude/nifty-turing-xanjo5` of `test11-12/test-DOW-graphics`. In-progress work by other builders is backed up on
`backup/*` branches; do not render from those.

**State of the films.** Film 2 has its final look (Blender Fury and AIM-120, the golden-hour cinematography pass):
render it first. Films 1 and 3 have their final models but still get a lighting and camera pass, and the
finished ground (film 1) and harbour (film 3) are not merged yet: render them for testing only, and pull again before
their final renders. The frame cache is keyed by the built page, so after a `git pull` and rebuild no old frame is
reused.

**Do not change the films.** Facts, wording, overlays and looks are reviewed elsewhere. If a tool fails on Windows,
make the smallest fix, commit it on a new branch `pc-fixes`, and say what and why; push only with the user's OK.

## 1. Setup (once)

1. NVIDIA driver: a current Game Ready or Studio driver. Check: `nvidia-smi` lists the card.
2. Tools (winget, or the vendors' installers):
   ```powershell
   winget install Git.Git
   winget install OpenJS.NodeJS.LTS
   winget install Gyan.FFmpeg
   winget install Google.Chrome
   ```
   Node must be 22 or newer (`node -v`); `ffmpeg -version` must work in a new terminal.
3. Blender 4.5 LTS from blender.org (Download, LTS, 4.5). Then, in every new PowerShell:
   ```powershell
   $env:BLENDER = "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"
   ```
   (adjust to where it installed). In Blender, Preferences > System > Cycles Render Devices must show OptiX with
   the RTX card.
4. The repository, in the folder you work in:
   ```powershell
   git clone https://github.com/test11-12/test-DOW-graphics.git
   cd test-DOW-graphics
   git checkout claude/nifty-turing-xanjo5
   cd films
   npm ci
   npm install --no-save playwright
   npx playwright install chromium
   node tools/build.mjs
   ```

## 2. Check that WebGL runs on the GPU

```powershell
node tools/shot.mjs fury $env:TEMP\gpucheck --gpu --channel=chrome --w=1920 --h=1080 --accum=16 48.6
```

It must print a line like `WebGL (film): ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 ... Direct3D11 ...)` and
`accum 16 ss 1: ... ms each`. If it refuses ("software rasteriser"), try `--angle=gl` or update the driver, and open
`chrome://gpu` in Chrome to see why. Open `$env:TEMP\gpucheck_00.png`: the launch shot, backlit smoke, the sun upper
left.

**Write down the "ms each" number.** Time per frame at `--accum=16` is about 17 times that plus about 0.1 s.

## 3. Film 2, final (WebGL, accumulation)

8 GB of video memory takes two browser workers, not the default four:

```powershell
node tools/render.mjs fury --gpu --channel=chrome --w=1920 --h=1080 --fps=30 --accum=16 --workers=2
```

About 2,370 frames. Estimate before starting: frames x 17 x (ms each). On an RTX 2070 expect roughly 1 to 3 hours;
the run prints its own rate and an ETA every 25 frames. It resumes where it stopped if interrupted (run the same
command again). Output: `out/fury.mp4`. Frames: `frames/fury/1920x1080@30_a16_ss1_<build>/`.

A quick test first is worth it: `--from=46 --to=52` renders the six seconds of the launch.

## 4. Cycles close-up for comparison (optional, film 2 only)

Path-tracing the heroes (README, "Path-traced heroes"). On an RTX 2070 a 1080p close-up frame is an estimated 15 to
60 s at the settings below (an estimate: the timing run measures it), so do one shot, not the film. The best candidate is s03, the AIM-120 under the wing on
the ramp (t = 14.3 to 23.0).

```powershell
# timing first: three frames, read the last one in heroes\fury\cycles\timing.json (the first includes OptiX setup)
node tools/export_shots.mjs fury --from=17 --to=17.1 --w=1920 --h=1080
node tools/blender.mjs hero_shot --export heroes/fury --frames 510-512 --samples 128 --noise 0.02
node tools/composite.mjs fury --hero=heroes/fury/cycles --w=1920 --h=1080 --gpu --channel=chrome --compare 17
```

`--compare` writes `heroes\fury\comp\fury_00_sheet.png` (engine | composite). If the composite is clearly better and
the time per frame is acceptable, do the whole shot and splice it in:

```powershell
node tools/export_shots.mjs fury --from=14.3 --to=23 --w=1920 --h=1080
node tools/blender.mjs hero_shot --export heroes/fury --samples 128 --noise 0.02 --no-exr
node tools/render.mjs fury --hero=heroes/fury/cycles --from=14.3 --to=23 --gpu --channel=chrome --workers=2
```

`hero_shot` resumes a stopped run and stops instead of falling back to the CPU if Blender cannot see the GPU. The
Cycles hero and `--accum` do not combine yet: a shot is either accumulated (step 3) or path-traced (this step). To
splice, copy the hero frames over the same frame numbers in the accumulated frame folder, then encode again:
`node tools/render.mjs fury --gpu --channel=chrome --w=1920 --h=1080 --fps=30 --accum=16 --encode-only`.
Before a long run, check 30 consecutive frames for flicker (README).

## 5. Films 1 and 3

Same as step 3 with `quarterhorse` and `corsair`, for testing until their final passes land; then
`git pull`, `node tools/build.mjs`, and render again.

## 6. Before calling a film done

- Play `out/<film>.mp4` end to end: every shot present, no black, frozen or blank frames, no flashing.
- The tag "SIMULATED VISUALIZATION · NOT ACTUAL FOOTAGE" is visible throughout; captions and narration in sync.
- The end card shows the sources and the list of what is illustrative.
- Audio present, no clipping.

Report back: the GPU line from step 2, the "ms each", the wall time per film, and where the MP4s are.
