// Build everything from src/ with nothing but Node and esbuild.
//
//   node scripts/build.mjs                 -> dist/  (the site, the single file, the embed)
//   node scripts/build.mjs --out some/dir  -> build somewhere else (used by the tools)
//   node scripts/build.mjs --single        -> only the single self-contained page (fast)
//   node scripts/build.mjs --release       -> also refresh release/ (the ready-to-use files kept in the repository)
//
// Outputs
//   dist/index.html + dist/assets/*        the site: tiny first load, films fetched on demand
//   dist/ten-wins-in-motion.html           one self-contained file that opens from disk
//   dist/ten-wins-page.html                the same page as a body fragment, for hosts that supply their own <head>
//   dist/embed/wins-motion.js + demo.html  the drop-in script for an existing site
//   dist/build-report.json                 sizes, used by the budget tests
import { build, transform } from 'esbuild';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projects } from '../src/projects.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes('--' + name);
const opt = (name, fallback) => (argv.includes('--' + name) ? argv[argv.indexOf('--' + name) + 1] : fallback);
const OUT = resolve(opt('out', join(ROOT, 'dist')));
const quiet = flag('quiet');
const singleOnly = flag('single');

const FONTS = [
  ['Field Sans', 'sans-400.woff2', '400'],
  ['Field Sans', 'sans-500.woff2', '500 600'],
  ['Field Sans', 'sans-700.woff2', '700 900'],
  ['Field Mono', 'mono-400.woff2', '400'],
  ['Field Mono', 'mono-500.woff2', '500 700'],
];
const src = (...p) => join(ROOT, 'src', ...p);
const read = (p) => readFile(p, 'utf8');
const br = (buf) => brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

async function styles() {
  const sceneCss = (await readdir(src('scenes'))).filter((f) => f.endsWith('.css')).sort();
  const parts = [await read(src('styles', 'base.css')), await read(src('styles', 'stage.css')), ...(await Promise.all(sceneCss.map((f) => read(src('scenes', f)))))];
  return (await transform(parts.join('\n'), { loader: 'css', minify: true })).code;
}
const fontFaces = (url) => FONTS.map(([family, file, weight]) => `@font-face{font-family:"${family}";src:url(${url(file)}) format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`).join('');
async function inlineFonts() {
  const data = {};
  for (const [, file] of FONTS) data[file] = (await readFile(join(ROOT, 'assets', 'fonts', file))).toString('base64');
  return fontFaces((file) => `data:font/woff2;base64,${data[file]}`);
}
const licences = async () => {
  const dir = join(ROOT, 'assets', 'licenses');
  const texts = await Promise.all((await readdir(dir)).sort().map((f) => read(join(dir, f))));
  return '<!-- Font licence notices\n' + texts.join('\n\n').replaceAll('--', '- -') + '\n-->';
};
const common = { bundle: true, minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning' };

/* ---- 1. The single self-contained page ------------------------------------- */
export const SINGLE = 'ten-wins-in-motion.html';
async function single(css, template) {
  const js = (await build({ ...common, entryPoints: [src('shell', 'main.ts')], format: 'iife', write: false })).outputFiles[0].text;
  const head = `<style>${await inlineFonts()}${css}</style>`;
  const tail = `<script>${js.replaceAll('</script', '<\\/script')}</script>\n${await licences()}`;
  // Replacer functions, so that "$&" and friends inside the code are not treated as patterns.
  const html = template.replace('<!--HEAD-->', () => head).replace('<!--SCRIPT-->', () => tail);
  await writeFile(join(OUT, SINGLE), html);
  // The same page without <html>, <head> or <body>, for a host that wraps it in its own
  // document. The viewport note tells such a host that the side gutter clears its insets.
  const title = template.match(/<title>[\s\S]*?<\/title>/)[0];
  const body = template.match(/<!--BODY-->([\s\S]*?)<!--\/BODY-->/)[1].trim();
  const page = `${title}\n<meta name="claude:viewport-fit-sides" content="cover">\n${head}\n${body}\n${tail}\n`;
  await writeFile(join(OUT, 'ten-wins-page.html'), page);
  return Buffer.from(html);
}

/* ---- 2. The site: split modules, films on demand --------------------------- */
async function site(css, template) {
  const result = await build({
    ...common,
    entryPoints: { main: src('shell', 'main.ts') },
    format: 'esm',
    splitting: true,
    outdir: join(OUT, 'assets'),
    entryNames: '[name]-[hash]',
    chunkNames: '[name]-[hash]',
    metafile: true,
  });
  const outputs = result.metafile.outputs;
  const rel = (p) => 'assets/' + p.split('/assets/').pop();
  // Films loaded with import() are entry points too, so pick the shell by name.
  const entry = Object.keys(outputs).find((k) => outputs[k].entryPoint?.endsWith('shell/main.ts'));
  // Everything the entry needs to start, plus the first film, is fetched in parallel with it.
  const eager = new Set();
  const walk = (k) => outputs[k].imports.filter((i) => i.kind === 'import-statement').forEach((i) => (eager.has(i.path) ? 0 : (eager.add(i.path), walk(i.path))));
  walk(entry);
  const firstFilm = Object.keys(outputs).find((k) => k.split('/').pop().startsWith(projects[0].id + '-'));
  if (firstFilm) (eager.add(firstFilm), walk(firstFilm));
  await mkdir(join(OUT, 'assets', 'fonts'), { recursive: true });
  for (const [, file] of FONTS) await cp(join(ROOT, 'assets', 'fonts', file), join(OUT, 'assets', 'fonts', file));
  const head = [
    ...['sans-400.woff2', 'sans-500.woff2', 'sans-700.woff2'].map((f) => `<link rel="preload" href="assets/fonts/${f}" as="font" type="font/woff2" crossorigin>`),
    ...[...eager].map((k) => `<link rel="modulepreload" href="${rel(k)}">`),
    `<style>${fontFaces((file) => `assets/fonts/${file}`)}${css}</style>`,
  ].join('\n');
  const html = template.replace('<!--HEAD-->', () => head).replace('<!--SCRIPT-->', () => `<script type="module" src="${rel(entry)}"></script>`);
  await writeFile(join(OUT, 'index.html'), html);
  await writeFile(join(OUT, '.nojekyll'), '');
  await writeFile(join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

  const size = async (k) => (await readFile(join(OUT, rel(k)))).length;
  const first = [Buffer.from(html), await readFile(join(OUT, rel(entry)))];
  for (const k of eager) first.push(await readFile(join(OUT, rel(k))));
  const films = {};
  for (const k of Object.keys(outputs)) if (!eager.has(k) && k !== entry && k.endsWith('.js')) films[rel(k)] = await size(k);
  return {
    html: html.length,
    firstLoad: { files: first.length, bytes: first.reduce((n, b) => n + b.length, 0), brotli: first.reduce((n, b) => n + br(b), 0) },
    fonts: Object.fromEntries(await Promise.all(FONTS.map(async ([, f]) => [f, (await readFile(join(ROOT, 'assets', 'fonts', f))).length]))),
    lazyChunks: films,
  };
}

/* ---- 3. The drop-in embed --------------------------------------------------- */
async function embed(css) {
  const sprite = (await read(src('index.html'))).match(/<svg aria-hidden="true"[\s\S]*?<\/svg>/)[0];
  const embedCss = css.replaceAll(':root', ':host') + (await read(src('styles', 'embed.css')));
  const js = (
    await build({
      ...common,
      entryPoints: [src('shell', 'embed.ts')],
      format: 'iife',
      write: false,
      define: { __EMBED_CSS__: JSON.stringify(embedCss), __EMBED_FONTS__: JSON.stringify(await inlineFonts()), __EMBED_SPRITE__: JSON.stringify(sprite) },
    })
  ).outputFiles[0].text;
  await mkdir(join(OUT, 'embed'), { recursive: true });
  await writeFile(join(OUT, 'embed', 'wins-motion.js'), '/* Ten wins in motion: drop-in build. See docs/EMBED.md */\n' + js);
  await cp(src('embed-demo.html'), join(OUT, 'embed', 'demo.html'));
  return Buffer.from(js);
}

const t0 = Date.now();
if (!singleOnly) await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const css = await styles();
const template = await read(src('index.html'));
const report = { builtAt: new Date().toISOString(), css: css.length };
const one = await single(css, template);
report.single = { bytes: one.length, gzip: gzipSync(one).length, brotli: br(one) };
if (!singleOnly) {
  report.site = await site(css, template);
  const hasEmbed = await read(src('shell', 'embed.ts')).then(() => true, () => false);
  if (hasEmbed) {
    const e = await embed(css);
    report.embed = { bytes: e.length, gzip: gzipSync(e).length, brotli: br(e) };
  }
  await writeFile(join(OUT, 'build-report.json'), JSON.stringify(report, null, 2));
}
// --release also copies the ready-to-use files into release/, which is kept in the repository
// so that nobody has to build before using them.
if (flag('release') && !singleOnly) {
  const to = join(ROOT, 'release');
  await rm(to, { recursive: true, force: true });
  await mkdir(join(to, 'embed'), { recursive: true });
  await cp(join(OUT, SINGLE), join(to, SINGLE));
  await cp(join(OUT, 'embed', 'wins-motion.js'), join(to, 'embed', 'wins-motion.js'));
  await cp(join(OUT, 'embed', 'demo.html'), join(to, 'embed', 'demo.html'));
}
if (!quiet) {
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log(`Built ${OUT} in ${Date.now() - t0} ms`);
  console.log(`  single file     ${kb(report.single.bytes)}  (${kb(report.single.brotli)} brotli)`);
  if (report.site) console.log(`  site first load ${kb(report.site.firstLoad.bytes)} in ${report.site.firstLoad.files} files  (${kb(report.site.firstLoad.brotli)} brotli), then ${Object.keys(report.site.lazyChunks).length} films on demand`);
  if (report.embed) console.log(`  embed script    ${kb(report.embed.bytes)}  (${kb(report.embed.brotli)} brotli)`);
}
