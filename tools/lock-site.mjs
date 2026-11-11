#!/usr/bin/env node
// Lock the one-file build behind a password, for a static host such as GitHub Pages.
//
//   SITE_PASSWORD=... node tools/lock-site.mjs [--in dist/ten-wins-in-motion.html] [--out dist/pages]
//
// The page is encrypted with AES-GCM under a key derived from the password (PBKDF2,
// SHA-256, 600,000 rounds) and decrypted in the visitor's browser, so the host only ever
// holds ciphertext. The password is read from the environment and written nowhere.
// Capitalization does not matter. A short password keeps out casual visitors and search
// engines, not a determined one: the encrypted page can be attacked offline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const input = resolve(opt('--in', join(ROOT, 'dist', 'ten-wins-in-motion.html')));
const out = resolve(opt('--out', join(ROOT, 'dist', 'pages')));
const password = (process.env.SITE_PASSWORD ?? '').trim().toUpperCase();
if (!password) {
  console.error('Set SITE_PASSWORD to the password the page should open with.');
  process.exit(2);
}

const ROUNDS = 600000;
const { subtle } = globalThis.crypto;
const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, readFileSync(input)));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const font = (file) => readFileSync(join(ROOT, 'assets', 'fonts', file)).toString('base64');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Ten Wins in Motion</title>
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<style>
@font-face{font-family:"Field Sans";src:url(data:font/woff2;base64,${font('sans-500.woff2')}) format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:"Field Sans";src:url(data:font/woff2;base64,${font('sans-700.woff2')}) format("woff2");font-weight:700;font-display:swap}
:root{--line-2:#2f3234;--wire:#565654;--ink:#ffffff;--text:#d8d8d4;--muted:#9d9f9a;--faint:#6c6e6b;--live:#dff140;--alert:#ff3535;color-scheme:dark}
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:#000000;color:var(--text);font:500 15px/1.4 "Field Sans","Helvetica Neue",Helvetica,Arial,sans-serif}
main{min-height:100%;display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px))}
form{width:min(380px,100%);display:grid;gap:12px}
h1{margin:0 0 6px;font-weight:700;font-size:34px;line-height:1;letter-spacing:-.03em;color:var(--ink)}
.cap{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.rule{border-top:1px solid var(--line-2);padding-top:14px}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;height:40px;padding:0 12px;border:1px solid var(--line-2);border-radius:0;background:#0e0f0f;color:var(--ink);font:inherit;letter-spacing:.06em;outline:none}
input:focus{border-color:var(--wire)}
button{height:40px;padding:0 18px;border:0;border-radius:0;background:var(--ink);color:#000;font:inherit;cursor:pointer;transition:background-color .3s ease-out}
button:hover,button:focus-visible{background:var(--live);outline:none}
.msg{min-height:1.4em;margin:0;font-size:13px;color:var(--faint)}
.msg.bad{color:var(--alert)}
.foot{margin-top:18px;color:var(--faint)}
</style>
</head>
<body>
<main>
<form id="gate">
<h1>Ten wins in motion</h1>
<label class="cap rule" for="pw">Password</label>
<div class="row"><input id="pw" type="password" autocomplete="current-password" autofocus required><button type="submit">Enter</button></div>
<p id="msg" class="msg" role="status" aria-live="polite"></p>
<p class="cap foot">Real events · schematic drawings</p>
</form>
</main>
<script>
(() => {
  const D = { s: "${b64(salt)}", i: "${b64(iv)}", n: ${ROUNDS}, c: "${b64(sealed)}" };
  const bytes = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
  const form = document.getElementById('gate');
  const input = document.getElementById('pw');
  const msg = document.getElementById('msg');
  async function unlock(pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.trim().toUpperCase()), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(D.s), iterations: D.n, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const html = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(D.i) }, key, bytes(D.c)));
    try { sessionStorage.setItem('wins-pass', pw); } catch (e) {}
    document.open();
    document.write(html);
    document.close();
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'msg';
    msg.textContent = 'Opening…';
    try {
      await unlock(input.value);
    } catch (err) {
      msg.className = 'msg bad';
      msg.textContent = 'That password does not open it.';
      input.select();
    }
  });
  // A reload in the same tab opens without asking again.
  let saved = null;
  try { saved = sessionStorage.getItem('wins-pass'); } catch (e) {}
  if (saved) unlock(saved).catch(() => {});
})();
</script>
</body>
</html>
`;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), page);
writeFileSync(join(out, '.nojekyll'), '');
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log(`Locked ${input} -> ${join(out, 'index.html')} (${(page.length / 1024).toFixed(0)} KB)`);
