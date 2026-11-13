// Procedural modelling kit: lofted bodies, wings, surface decals and painted canvas textures.
// Body frame: +x forward (nose), +y up, +z right (starboard). Units metres.
import * as THREE from 'three';

export const rng = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// monotone cubic interpolation through (xs, ys)
export function pchip(xs, ys) {
  const n = xs.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  if (n === 2) { m[0] = m[1] = d[0]; }
  else {
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    }
    m[0] = d[0]; m[n - 1] = d[n - 2];
  }
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// Lofted body. stations: [{s, y, w, ht, hb, nt, nb}] with s = distance aft of the nose (m).
// Cross-sections are super-ellipses (n = 2 ellipse, <2 chined/lens, >2 boxy), split top/bottom.
// Returns { geometry, surf(u, v) -> {p, n}, L, stations } where u = s/L, v = angle/2π (0 top, .25 right, .5 belly).
export function loft(stations, opt = {}) {
  const { nS = 160, nT = 72, x0 = 0, sFn = null } = opt;
  const keys = ['y', 'w', 'ht', 'hb', 'nt', 'nb'];
  const ss = stations.map(s => s.s), s0 = ss[0], s1 = ss[ss.length - 1], L = s1 - s0;
  const f = {}; for (const k of keys) f[k] = pchip(ss, stations.map(s => s[k] ?? (k === 'nt' || k === 'nb' ? 2 : 0)));
  const point = (s, th, out) => {
    const c = Math.cos(th), sn = Math.sin(th), top = c >= 0, n = top ? f.nt(s) : f.nb(s), e = 2 / n;
    out.set(x0 - s, f.y(s) + (top ? f.ht(s) : f.hb(s)) * spow(c, e), f.w(s) * spow(sn, e));
    return out;
  };
  const sAt = i => { const t = i / nS; return s0 + L * (sFn ? sFn(t) : t); };
  const N = (nS + 1) * (nT + 1), pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), uv = new Float32Array(N * 2);
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), ds = new THREE.Vector3(), dt = new THREE.Vector3();
  const surfN = (s, th, out) => {
    const es = L * 1e-4, et = 1e-3;
    point(Math.min(s + es, s1), th, a); point(Math.max(s - es, s0), th, b); ds.subVectors(a, b);
    point(s, th + et, a); point(s, th - et, b); dt.subVectors(a, b);
    out.crossVectors(ds, dt);
    if (out.lengthSq() < 1e-20) out.set(1, 0, 0); // degenerate tip
    return out.normalize();
  };
  let k = 0, q = 0;
  for (let i = 0; i <= nS; i++) for (let j = 0; j <= nT; j++) {
    const s = sAt(i), th = j / nT * Math.PI * 2;
    point(s, th, p); pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
    surfN(s, th, a); nor[k] = a.x; nor[k + 1] = a.y; nor[k + 2] = a.z; k += 3;
    uv[q++] = (s - s0) / L; uv[q++] = j / nT;
  }
  const idx = new Uint32Array(nS * nT * 6); k = 0;
  for (let i = 0; i < nS; i++) for (let j = 0; j < nT; j++) {
    const A = i * (nT + 1) + j, B = A + nT + 1, C = A + 1, D = B + 1;
    idx[k++] = A; idx[k++] = B; idx[k++] = C; idx[k++] = B; idx[k++] = D; idx[k++] = C;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  const surf = (u, v) => { const s = s0 + u * L, th = v * Math.PI * 2; return { p: point(s, th, new THREE.Vector3()), n: surfN(s, th, new THREE.Vector3()) }; };
  // girth (m) at u, for sizing decals
  const girth = u => { const s = s0 + u * L; let g = 0; point(s, 0, a); for (let j = 1; j <= 48; j++) { point(s, j / 48 * Math.PI * 2, b); g += a.distanceTo(b); a.copy(b); } return g; };
  return { geometry, surf, girth, L, s0, f };
}

// Conforming patch of a loft surface over [u0,u1]x[v0,v1], lifted `lift` m along the normal. Texture reads
// upright from outside with its left edge towards (flipU ? tail : nose).
export function loftDecal(lf, u0, u1, v0, v1, opt = {}) {
  const { nu = 24, nv = 10, lift = 0.0025, flipV = false } = opt;
  const starboard = ((v0 + v1) / 2) % 1 < 0.5;
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = u0 + (u1 - u0) * i / nu, v = v0 + (v1 - v0) * j / nv, { p, n } = lf.surf(u, v);
    pos.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift); nor.push(n.x, n.y, n.z);
    // starboard: +u runs towards the viewer's left and +v downward; port: +u to the right and +v upward
    const tv = starboard ? j / nv : 1 - j / nv;
    uv.push(starboard ? 1 - i / nu : i / nu, flipV ? 1 - tv : tv);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const A = i * (nv + 1) + j, B = A + nv + 1, C = A + 1, D = B + 1; idx.push(A, B, C, B, D, C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

const naca = (c, t) => 5 * t * (0.2969 * Math.sqrt(c) - 0.1260 * c - 0.3516 * c * c + 0.2843 * c * c * c - 0.1036 * c * c * c * c);
const lens = (c, t) => 2 * t * c * (1 - c) + 0.5 * t * 0.12 * Math.sqrt(Math.max(c * (1 - c), 0)); // biconvex with a slightly blunted edge

// Wing / fin half. sections: [{z, le, te, y, t, twist}] ordered root->tip; le/te are body-x of the leading and
// trailing edge (le > te), t = thickness/chord. Spans along +z. UVs are planform-projected: u from the
// front-most LE to the aft-most TE, v across the span; upper surface in v∈[0,.5], lower in [.5,1].
export function wing(sections, opt = {}) {
  const { nC = 22, nSpan = 10, profile = 'naca', cap = true } = opt;
  const prof = profile === 'lens' ? lens : naca;
  const xmax = Math.max(...sections.map(s => s.le)), xmin = Math.min(...sections.map(s => s.te));
  const zmin = sections[0].z, zmax = sections[sections.length - 1].z;
  const pos = [], uv = [], idx = [];
  const rows = [];
  for (let k = 0; k < sections.length - 1; k++) for (let m = (k === 0 ? 0 : 1); m <= nSpan; m++) {
    const a = sections[k], b = sections[k + 1], f = m / nSpan, L = (p) => a[p] + (b[p] - a[p]) * f;
    rows.push({ z: L('z'), le: L('le'), te: L('te'), y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * f, t: L('t') });
  }
  const ring = 2 * nC + 2; // upper LE->TE (nC+1), lower LE->TE (nC+1)
  for (const r of rows) {
    const ch = r.le - r.te;
    for (let side = 0; side < 2; side++) for (let i = 0; i <= nC; i++) {
      const c = 0.5 * (1 - Math.cos(Math.PI * i / nC)), yt = prof(c, r.t) * ch * (side ? -1 : 1);
      const x = r.le - c * ch;
      pos.push(x, r.y + yt, r.z);
      uv.push((xmax - x) / (xmax - xmin), (side ? 0.5 : 0) + 0.5 * (r.z - zmin) / (zmax - zmin || 1));
    }
  }
  for (let j = 0; j < rows.length - 1; j++) for (let side = 0; side < 2; side++) for (let i = 0; i < nC; i++) {
    const A = j * ring + side * (nC + 1) + i, B = A + 1, C = A + ring, D = C + 1;
    if (side === 0) idx.push(A, B, C, B, D, C); else idx.push(A, C, B, B, C, D);
  }
  if (cap) { // close the tip
    const j = rows.length - 1, base = j * ring;
    for (let i = 0; i < nC; i++) idx.push(base + i, base + i + 1, base + (nC + 1) + i, base + i + 1, base + (nC + 1) + i + 1, base + (nC + 1) + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.planform = { xmin, xmax, zmin, zmax };
  return g;
}

// ------------------------------------------------------------------ painted textures
export function canvasTex(w, h, draw, { srgb = true, aniso = 8, repeat = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// tangent-space normal map from a greyscale height canvas (white = raised)
export function normalFromHeight(heightCanvas, strength = 2, aniso = 8, wrapV = true) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), out = g.createImageData(w, h), d = out.data;
  const H = (x, y) => { x = Math.min(w - 1, Math.max(0, x)); y = wrapV ? (y + h) % h : Math.min(h - 1, Math.max(0, y)); return src[(y * w + x) * 4] / 255; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = 1 / Math.hypot(dx, dy, 1), k = (y * w + x) * 4;
    d[k] = (-dx * l * 0.5 + 0.5) * 255; d[k + 1] = (-dy * l * 0.5 + 0.5) * 255; d[k + 2] = (l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Skin painter: draws panel seams, fastener rows, per-panel tone and wear onto three canvases at once
// (albedo, roughness/metal packed as G/B, height). Coordinates are normalised 0..1.
export class Skin {
  constructor(w, h, { base = '#c9ccce', rough = 0.35, metal = 1, seed = 7 } = {}) {
    this.w = w; this.h = h; this.rand = rng(seed);
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    this.cA = mk(); this.cR = mk(); this.cH = mk();
    this.a = this.cA.getContext('2d'); this.r = this.cR.getContext('2d'); this.hh = this.cH.getContext('2d');
    this.a.fillStyle = base; this.a.fillRect(0, 0, w, h);
    this.r.fillStyle = Skin.orm(rough, metal); this.r.fillRect(0, 0, w, h);
    this.hh.fillStyle = '#808080'; this.hh.fillRect(0, 0, w, h);
  }
  static orm(rough, metal) { const g = Math.round(Math.min(1, Math.max(0, rough)) * 255), b = Math.round(metal * 255); return `rgb(255,${g},${b})`; }
  // tint a rectangular panel: dv = brightness delta, dr = roughness delta
  panel(x0, y0, x1, y1, dv, dr, rough0 = 0.35, metal = 1) {
    const { a, r, w, h } = this;
    a.fillStyle = dv >= 0 ? `rgba(255,255,255,${dv})` : `rgba(0,0,0,${-dv})`; a.fillRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
    r.fillStyle = Skin.orm(rough0 + dr, metal); r.fillRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
  }
  // seam along a polyline (normalised points); cut = groove depth 0..1
  seam(pts, { width = 1.6, dark = 0.55, cut = 0.5 } = {}) {
    const { w, h } = this;
    for (const [ctx, style, lw] of [[this.a, `rgba(20,22,24,${dark})`, width], [this.hh, `rgba(0,0,0,${cut})`, width + 0.6], [this.r, Skin.orm(0.75, 0.6), width]]) {
      ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0] * w, p[1] * h) : ctx.moveTo(p[0] * w, p[1] * h)); ctx.stroke();
    }
  }
  // row of flush fasteners between two points
  rivets(x0, y0, x1, y1, pitchPx = 9, { r = 1.1, dark = 0.35 } = {}) {
    const { w, h, a, hh } = this;
    const dx = (x1 - x0) * w, dy = (y1 - y0) * h, n = Math.max(1, Math.round(Math.hypot(dx, dy) / pitchPx));
    a.fillStyle = `rgba(30,32,34,${dark})`; hh.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i <= n; i++) { const x = x0 * w + dx * i / n, y = y0 * h + dy * i / n; a.beginPath(); a.arc(x, y, r, 0, 6.2832); a.fill(); hh.beginPath(); hh.arc(x, y, r + 0.4, 0, 6.2832); hh.fill(); }
  }
  // streaks running along +x (airflow): n strokes of random length
  streaks(n, { x0 = 0, x1 = 1, y0 = 0, y1 = 1, len = [0.02, 0.2], alpha = 0.06, dark = true, width = [1, 5] } = {}) {
    const { w, h, a, r, rand } = this;
    for (let i = 0; i < n; i++) {
      const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0), l = len[0] + rand() * (len[1] - len[0]);
      const g = a.createLinearGradient(x * w, 0, (x + l) * w, 0); const c = dark ? '10,10,10' : '255,255,255';
      g.addColorStop(0, `rgba(${c},${alpha * (0.4 + rand())})`); g.addColorStop(1, `rgba(${c},0)`);
      a.fillStyle = g; a.fillRect(x * w, y * h, l * w, width[0] + rand() * (width[1] - width[0]));
    }
  }
  // soft blotches (stains, heat tint)
  blotch(x, y, rx, ry, color, alpha) {
    const { w, h, a } = this; a.save(); a.translate(x * w, y * h); a.scale(rx * w, ry * h);
    const g = a.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, `rgba(${color},${alpha})`); g.addColorStop(1, `rgba(${color},0)`);
    a.fillStyle = g; a.beginPath(); a.arc(0, 0, 1, 0, 6.2832); a.fill(); a.restore();
  }
  // low-frequency skin waviness (oil-canning) written into the height canvas
  waviness(cellsX, cellsY, amp = 0.05) {
    const { w, h, hh, rand } = this;
    for (let i = 0; i < cellsX; i++) for (let j = 0; j < cellsY; j++) {
      const cx = (i + 0.5) / cellsX * w, cy = (j + 0.5) / cellsY * h, rx = w / cellsX * 0.62, ry = h / cellsY * 0.62, up = rand() > 0.5;
      hh.save(); hh.translate(cx, cy); hh.scale(rx, ry);
      const g = hh.createRadialGradient(0, 0, 0, 0, 0, 1); const c = up ? '255,255,255' : '0,0,0', al = amp * (0.3 + rand());
      g.addColorStop(0, `rgba(${c},${al})`); g.addColorStop(1, `rgba(${c},0)`);
      hh.fillStyle = g; hh.beginPath(); hh.arc(0, 0, 1, 0, 6.2832); hh.fill(); hh.restore();
    }
  }
  textures(aniso = 8, normalStrength = 2.2, wrapV = true) {
    const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
    return { map: mk(this.cA, true), orm: mk(this.cR, false), normalMap: normalFromHeight(this.cH, normalStrength, aniso, wrapV) };
  }
}

// transparent decal texture with text / shapes; draw(g, w, h) paints on a cleared canvas
export function decalTex(w, h, draw, aniso = 8) {
  return canvasTex(w, h, (g) => { g.clearRect(0, 0, w, h); draw(g, w, h); }, { srgb: true, aniso });
}
export function decalMat(tex, opt = {}) {
  return new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.55, metalness: 0, ...opt });
}

// merge helper for static sub-parts
export function addTo(parent, geometry, material, opt = {}) {
  const m = new THREE.Mesh(geometry, material);
  if (opt.pos) m.position.set(...opt.pos); if (opt.rot) m.rotation.set(...opt.rot); if (opt.scale) m.scale.set(...opt.scale);
  m.castShadow = opt.cast ?? true; m.receiveShadow = opt.receive ?? true; if (opt.name) m.name = opt.name;
  parent.add(m); return m;
}

// attitude quaternion from heading (deg clockwise from north), pitch (deg nose-up), roll (deg right-wing-down)
const _qy = new THREE.Quaternion(), _qz = new THREE.Quaternion(), _qx = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
export function attitude(hdg, pitch = 0, roll = 0, out = new THREE.Quaternion()) {
  const d = Math.PI / 180;
  _qy.setFromAxisAngle(AY, (90 - hdg) * d); _qz.setFromAxisAngle(AZ, pitch * d); _qx.setFromAxisAngle(AX, roll * d);
  return out.copy(_qy).multiply(_qz).multiply(_qx);
}
