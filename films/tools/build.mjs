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
  const artifact = `${head}${body}\n<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/${THREE_VERSION}/three.min.js"></script>\n<script>\n${safe(js)}\n</script>\n`;
  const offline = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
    `<style>html{color-scheme:dark}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style>\n${head}</head><body>${body}\n` +
    `<script>\n${safe(threeSrc)}\n</script>\n<script>\n${safe(js)}\n</script>\n</body></html>\n`;
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', `${name}.html`), artifact);
  fs.writeFileSync(path.join(root, 'dist', `${name}.offline.html`), offline);
  console.log(`built ${name}: artifact ${(artifact.length / 1e6).toFixed(2)} MB, offline ${(offline.length / 1e6).toFixed(2)} MB`);
}
