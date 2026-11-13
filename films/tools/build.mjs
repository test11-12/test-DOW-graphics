// Bundles engine + one film into self-contained HTML.
//   dist/<film>.html          artifact page (no <html>/<head>/<body>; three.js from cdnjs)
//   dist/<film>.offline.html  standalone document with three.js inlined (used by tools/render.mjs)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE_VERSION = '0.160.0';
const films = process.argv.slice(2).filter(a => !a.startsWith('--'));
const all = films.length ? films : ['quarterhorse', 'fury', 'corsair'];

const b64 = p => fs.readFileSync(p).toString('base64');
const font = (pkg, file, family, weight) =>
  `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;` +
  `src:url(data:font/woff2;base64,${b64(path.join(root, 'node_modules/@fontsource', pkg, 'files', file))}) format("woff2")}`;

const fontCss = [
  font('saira-condensed', 'saira-condensed-latin-500-normal.woff2', 'Saira Condensed', 500),
  font('saira-condensed', 'saira-condensed-latin-700-normal.woff2', 'Saira Condensed', 700),
  font('b612', 'b612-latin-400-normal.woff2', 'B612', 400),
  font('b612', 'b612-latin-700-normal.woff2', 'B612', 700),
  font('b612-mono', 'b612-mono-latin-400-normal.woff2', 'B612 Mono', 400),
  font('b612-mono', 'b612-mono-latin-700-normal.woff2', 'B612 Mono', 700),
].join('\n');

// `import * as THREE from 'three'` resolves to the UMD global.
const threeGlobal = {
  name: 'three-global',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'three-global' }));
    b.onLoad({ filter: /.*/, namespace: 'three-global' }, () => ({ contents: 'module.exports = window.THREE;', loader: 'js' }));
  },
};

// Assets packed into a film's page: every .glb and every file under a tex/ folder in films/assets/<film>/,
// films/assets/shared/ and any extra folders the film's meta.json lists under "assets". Bake intermediates
// live outside films/assets (the generator cache), so nothing else is picked up.
const MIME = { glb: 'model/gltf-binary', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', ktx2: 'image/ktx2' };
function listAssets(name, meta) {
  const out = [], base = path.join(root, 'assets');
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name), rel = path.relative(base, p).split(path.sep).join('/');
      if (e.isDirectory()) walk(p);
      else if (/\.glb$/i.test(e.name) || (/(^|\/)tex\//.test(rel) && MIME[e.name.split('.').pop().toLowerCase()])) out.push(rel);
    }
  };
  for (const d of new Set([name, 'shared', ...(meta.assets || [])])) walk(path.join(base, d));
  return out.sort();
}
const WEB_EMBED_LIMIT = 6e6;   // artifact pages embed assets up to this total; above it they reference files

const css = fs.readFileSync(path.join(root, 'engine/player.css'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'engine/player.html'), 'utf8');
const threeSrc = fs.readFileSync(path.join(root, 'node_modules/three/build/three.min.js'), 'utf8');

for (const name of all) {
  const entry = path.join(root, 'src', `${name}.js`);
  if (!fs.existsSync(entry)) { console.log(`skip ${name} (no src/${name}.js)`); continue; }
  const narrPath = path.join(root, 'narration', `${name}.json`);
  const narration = fs.existsSync(narrPath) ? fs.readFileSync(narrPath, 'utf8') : '{"lines":[]}';
  const res = await build({
    entryPoints: [entry], bundle: true, format: 'iife', write: false, minify: !process.argv.includes('--debug'),
    target: 'es2020', plugins: [threeGlobal], define: { __NARRATION__: narration }, legalComments: 'none',
  });
  const js = res.outputFiles[0].text;
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'src', `${name}.meta.json`), 'utf8'));
  const body = shell.replace(/\{\{(\w+)\}\}/g, (_, k) => meta[k] ?? '');
  const head = `<title>${meta.title}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n${fontCss}\n${css}\n</style>\n`;
  const safe = s => s.replace(/<\/script/gi, '<\\/script');
  // packed assets: data URLs in the offline page; in the artifact page too when small, else relative files
  const assets = listAssets(name, meta);
  const sizes = assets.map(a => fs.statSync(path.join(root, 'assets', a)).size), total = sizes.reduce((a, b) => a + b, 0);
  const dataURL = a => `data:${MIME[a.split('.').pop().toLowerCase()] || 'application/octet-stream'};base64,${b64(path.join(root, 'assets', a))}`;
  const tableOf = f => `<script>window.__ASSETS__={${assets.map(a => `${JSON.stringify(a)}:${JSON.stringify(f(a))}`).join(',')}};</script>\n`;
  const offlineAssets = assets.length ? tableOf(dataURL) : '';
  const webEmbed = total <= WEB_EMBED_LIMIT;
  const webAssets = assets.length ? tableOf(webEmbed ? dataURL : (a => `assets/${a}`)) : '';
  if (assets.length && !webEmbed) for (const a of assets) { const d = path.join(root, 'dist', 'assets', a); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(root, 'assets', a), d); }
  const artifact = `${head}${body}\n${webAssets}<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/${THREE_VERSION}/three.min.js"></script>\n<script>\n${safe(js)}\n</script>\n`;
  const offline = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
    `<style>html{color-scheme:dark}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style>\n${head}</head><body>${body}\n` +
    `${offlineAssets}<script>\n${safe(threeSrc)}\n</script>\n<script>\n${safe(js)}\n</script>\n</body></html>\n`;
  if (assets.length) console.log(`  ${assets.length} asset(s), ${(total / 1e6).toFixed(1)} MB${webEmbed ? '' : ' (artifact page references dist/assets/)'}`);
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', `${name}.html`), artifact);
  fs.writeFileSync(path.join(root, 'dist', `${name}.offline.html`), offline);
  console.log(`built ${name}: artifact ${(artifact.length / 1e6).toFixed(2)} MB, offline ${(offline.length / 1e6).toFixed(2)} MB`);
}
