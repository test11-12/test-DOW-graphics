// Runs an asset generator in headless Blender:   node tools/blender.mjs <generator> [args...]
//   <generator> is a script in films/blender/ (with or without .py); its args follow '--' inside Blender.
// Blender comes from $BLENDER, else /opt/blender/blender (Blender 4.5 LTS). Exits non-zero on a Python error.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name, ...rest] = process.argv.slice(2);
if (!name) { console.error('usage: node tools/blender.mjs <generator> [args...]'); process.exit(2); }
const script = path.join(root, 'blender', name.endsWith('.py') ? name : `${name}.py`);
if (!fs.existsSync(script)) { console.error('no such generator:', script); process.exit(2); }
const blender = process.env.BLENDER || '/opt/blender/blender';
const t0 = Date.now();
const r = spawnSync(blender, ['-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '-P', script, '--', ...rest], { stdio: 'inherit' });
console.log(`blender ${name}: exit ${r.status} in ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(r.status ?? 1);
