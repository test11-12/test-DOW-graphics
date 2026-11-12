// Browser launch for the offline tools (render.mjs, shot.mjs).
//   default: Playwright's headless shell with WebGL on SwiftShader (the CPU path this repository was built on)
//   --gpu:   WebGL on the machine's real GPU. Linux: ANGLE over Vulkan in Chromium's new headless mode (the
//            combination Chrome's own GPU-testing guide uses for NVIDIA); Windows: ANGLE over Direct3D 11;
//            macOS: ANGLE over Metal. Prints the WebGL renderer string and refuses to go on if it is a software
//            rasteriser (SwiftShader, llvmpipe, ...), so a misconfigured machine fails in seconds, not after hours.
//   options (as --key=value on the tool's command line):
//     --channel=chromium|chrome|msedge|chrome-beta  browser build (default chromium: Playwright's full Chromium, new
//                                                   headless; chrome = the installed Google Chrome)
//     --angle=vulkan|gl-egl|gl|d3d11|metal          ANGLE backend (default per platform, above)
//     --chrome=/path/to/chrome                      explicit executable
//     --headed                                      a visible window (if a driver will not render headless)
//     --gpu-args="--flag --flag"                    extra Chromium switches
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render driver|mesa offscreen|subzero/i;

export function gpuLaunchOptions(opt = {}) {
  const plat = process.platform, angle = opt.angle || (plat === 'win32' ? 'd3d11' : plat === 'darwin' ? 'metal' : 'vulkan');
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', `--use-angle=${angle}`,
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  // Playwright passes its own --enable-features; Chromium keeps only the last one, so repeat Playwright's here
  if (angle === 'vulkan') args.push('--enable-features=Vulkan,CDPScreenshotNewSurface', '--disable-vulkan-surface');
  if (plat === 'win32') args.push('--force_high_performance_gpu');
  if (opt['gpu-args']) args.push(...String(opt['gpu-args']).split(/\s+/).filter(Boolean));
  const o = { headless: !opt.headed, args };
  if (opt.chrome) o.executablePath = opt.chrome; else o.channel = opt.channel || 'chromium';
  return o;
}

// opt: the tool's parsed --options; cpuArgs: the switches the tool has always used on the CPU path; extraArgs: switches
// a feature needs on both paths (for example --allow-file-access-from-files for the Cycles hero layers)
export async function launchBrowser(opt, cpuArgs, extraArgs = []) {
  if (!opt.gpu) return chromium.launch({ args: [...cpuArgs, ...extraArgs] });
  const o = gpuLaunchOptions(opt); o.args.push(...extraArgs);
  try { return await chromium.launch(o); }
  catch (e) {
    console.error(`--gpu: could not start ${o.executablePath || o.channel} (${e.message.split('\n')[0]}).\n` +
      `  Install it with "npx playwright install ${process.platform === 'linux' ? '--with-deps ' : ''}chromium" (or pass --channel=chrome to use the installed Google Chrome).`);
    process.exit(3);
  }
}

// WebGL implementation behind a page (a fresh WebGL2 context, or the film's own when it is up)
export async function glInfo(page) {
  return page.evaluate(() => {
    const own = window.FILM && window.FILM.film && window.FILM.film.pipe;
    const gl = own ? own.renderer.getContext() : document.createElement('canvas').getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl || gl.isContextLost()) return null;
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER), vendor: gl.getParameter(e ? e.UNMASKED_VENDOR_WEBGL : gl.VENDOR), version: gl.getParameter(gl.VERSION), maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), source: own ? 'film' : 'probe' };
  });
}

// print the renderer (unless quiet); with --gpu, exit if WebGL is missing, lost or a software rasteriser
export async function checkGL(page, opt, label = '', quiet = false) {
  const info = await glInfo(page);
  const s = info ? `${info.renderer} | ${info.vendor} | ${info.version}` : 'no WebGL 2 context (or it was lost)';
  if (!quiet || !info || SOFTWARE_GL.test(info.renderer) || SOFTWARE_GL.test(info.vendor)) console.log(`WebGL${label ? ' (' + label + ')' : ''}: ${s}`);
  if (opt.gpu && (!info || SOFTWARE_GL.test(info.renderer) || SOFTWARE_GL.test(info.vendor))) {
    console.error(`\n--gpu was asked for, but WebGL is ${info ? 'running on a software rasteriser (' + info.renderer + ')' : 'not available'}. Refusing to render.\n` +
      `  Linux: check "nvidia-smi" and "vulkaninfo --summary" (the NVIDIA Vulkan ICD must be installed, driver 570+ for an RTX 50xx);\n` +
      `         try --angle=gl-egl, or --channel=chrome; a desktop session (DISPLAY set) also works with --headed.\n` +
      `  Windows: update the NVIDIA driver; try --channel=chrome, --angle=d3d11 or --headed.\n` +
      `  Then: chrome://gpu in the same browser shows what it found.`);
    process.exit(3);
  }
  return info;
}
