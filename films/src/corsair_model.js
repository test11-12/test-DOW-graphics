// Models for "Three Corsairs": the Saronic Corsair (24 ft autonomous surface vessel, modelled from company
// photography: light-grey deep-V hull, closed foredeck, aft well with engine box, tubular mast arch with
// radome and EO/IR head), a generic naval maintenance waterfront (pier on piles, ship lift with a small
// submarine on the raised platform, yellow gantry, sheds, rubble breakwaters) and a distant merchant ship.
// The port is a stylised stand-in for the facility at Bandar Abbas, not a survey of it. No flags or insignia.
import * as THREE from 'three';
import { loft, canvasTex, normalFromHeight, rng } from '../engine/geo.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);

// ------------------------------------------------------------------ geometry helpers
function sweep(sec, sList, flip = false) {
  const rows = sList.map(sec), nv = rows[0].length, pos = [], uv = [], idx = [];
  rows.forEach((r, i) => r.forEach((p, j) => { pos.push(p[0], p[1], p[2]); uv.push(i / (rows.length - 1), j / (nv - 1)); }));
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < nv - 1; j++) {
    const a = i * nv + j, b = a + nv, c = a + 1, d = b + 1;
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals(); return g;
}
function mirrorZ(geo) {
  const g = geo.clone(), p = g.attributes.position, ix = g.index.array;
  for (let i = 0; i < p.count; i++) p.setZ(i, -p.getZ(i));
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.computeVertexNormals(); return g;
}
function merge(list) {
  let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni), hasCol = list.every(g => g.attributes.color), col = hasCol ? new Float32Array(nv * 3) : null;
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3); if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2); if (hasCol) col.set(g.attributes.color.array, vo * 3);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo; } else for (let i = 0; i < n; i++) idx[io++] = vo + i;
    vo += n;
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.BufferAttribute(pos, 3)); o.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); o.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (hasCol) o.setAttribute('color', new THREE.BufferAttribute(col, 3));
  o.setIndex(new THREE.BufferAttribute(idx, 1)); return o;
}
const place = (g, x, y, z, ry = 0, rx = 0, rz = 0) => { const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)); m.setPosition(x, y, z); return g.applyMatrix4(m); };
// box whose UVs are in metres (so tiling textures keep a real-world scale on every face)
function mbox(w, h, d, tile = 4) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, z / tile, y / tile); else if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, x / tile, z / tile); else uv.setXY(i, x / tile, y / tile);
  }
  return g;
}
function tube(a, b, r, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a), l = d.length(), g = new THREE.CylinderGeometry(r, r, l, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g.applyMatrix4(m);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mesh = (parent, geo, mat, opt = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = opt.cast ?? true; m.receiveShadow = opt.receive ?? true; if (opt.name) m.name = opt.name; parent.add(m); return m; };

// ------------------------------------------------------------------ Corsair
const L = 7.3, HB = 1.24;
const sx = s => L / 2 - s * L;
const bg = s => s < 0.42 ? HB * Math.pow(1 - Math.pow(1 - s / 0.42, 2.3), 0.9) : HB - 0.05 * Math.pow((s - 0.42) / 0.58, 2);
const yg = s => 0.74 + 0.16 * (1 - s) * (1 - s);
const bc = s => s < 0.5 ? 1.05 * Math.pow(1 - Math.pow(1 - s / 0.5, 2.0), 0.8) : 1.05 - 0.03 * (s - 0.5) / 0.5;
const yk = s => s >= 0.25 ? -0.44 : -0.44 + 1.34 * Math.pow(1 - s / 0.25, 3.2);
const ycE = s => Math.max(-0.02 + 0.57 * Math.pow(1 - Math.min(s / 0.55, 1), 1.8), yk(s) + bc(s) * 0.25);
const cf = s => 0.07 * Math.min(1, bc(s) / 0.4);
const gw = s => 0.09 * Math.min(1, bg(s) / 0.3);
const COWL_END = 0.62, FLOOR = 0.30;
export const CORSAIR = { length: L, beam: HB * 2, stern: -L / 2, bow: L / 2, mastTop: 2.9 };

export function buildCorsair(pipe) {
  const aniso = pipe.maxAniso, root = new THREE.Group(); root.name = 'corsair';
  // paint: haze grey with water streaks and a darker wet band low on the topsides
  const hullTex = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#8f9498'; g.fillRect(0, 0, w, h);
    const r = rng(41);
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '20,24,28' : '235,238,240'},${0.03 + r() * 0.05})`; g.fillRect(r() * w, r() * h, 20 + r() * 160, 1 + r() * 3); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(30,34,36,0.42)'); gr.addColorStop(0.3, 'rgba(30,34,36,0.12)'); gr.addColorStop(0.55, 'rgba(30,34,36,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { aniso });
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTex, color: 0xffffff, roughness: 0.42, metalness: 0.0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0 });
  const deckTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#9a9fa3'; g.fillRect(0, 0, w, h); const r = rng(5);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + r() * 0.06})`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
    // hatch outline and deck fittings on the foredeck cover (u: bow -> aft, v: gunwale -> centreline)
    g.strokeStyle = 'rgba(25,28,30,0.85)'; g.lineWidth = 3; g.strokeRect(w * 0.36, h * 0.42, w * 0.5, h * 0.75);
    g.lineWidth = 2; g.strokeRect(w * 0.12, h * 0.7, w * 0.16, h * 0.5);
    for (const [u, v] of [[0.3, 0.55], [0.6, 0.3], [0.9, 0.3], [0.2, 0.9]]) { g.fillStyle = 'rgba(30,33,36,0.9)'; g.beginPath(); g.arc(u * w, v * h, 7, 0, 6.2832); g.fill(); g.fillStyle = '#b9bdc0'; g.beginPath(); g.arc(u * w, v * h, 3.5, 0, 6.2832); g.fill(); }
  }, { aniso });
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0 });
  const boxMat = new THREE.MeshStandardMaterial({ color: lin(0.27, 0.29, 0.31), roughness: 0.5, metalness: 0, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0 });
  const black = new THREE.MeshStandardMaterial({ color: lin(0.015, 0.016, 0.017), roughness: 0.75 });
  const tubeMat = new THREE.MeshStandardMaterial({ color: lin(0.32, 0.34, 0.36), roughness: 0.4, metalness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
  const white = new THREE.MeshStandardMaterial({ color: lin(0.78, 0.8, 0.8), roughness: 0.3, metalness: 0 });
  const glass = new THREE.MeshStandardMaterial({ color: lin(0.01, 0.012, 0.016), roughness: 0.08, metalness: 0.4 });

  const N = 44, sAll = Array.from({ length: N + 1 }, (_, i) => Math.pow(i / N, 1.45));
  const hullParts = [];
  const bottom = sweep(s => { const o = []; for (let j = 0; j <= 5; j++) { const u = j / 5; o.push([sx(s), lerp(yk(s), ycE(s), u), bc(s) * u]); } return o; }, sAll);
  const chine = sweep(s => [[sx(s), ycE(s), bc(s)], [sx(s), ycE(s) + 0.014, bc(s) + cf(s)]], sAll);
  const top = sweep(s => { const o = []; for (let j = 0; j <= 7; j++) { const u = j / 7; o.push([sx(s), lerp(ycE(s) + 0.014, yg(s), u), lerp(bc(s) + cf(s), bg(s), u) + 0.035 * Math.sin(Math.PI * u) * Math.min(1, bg(s) / 0.5)]); } return o; }, sAll);
  // two spray rails proud of the bottom
  for (const f of [0.38, 0.68]) hullParts.push(sweep(s => { const z = bc(s) * f, y = lerp(yk(s), ycE(s), f), w = 0.03 * Math.min(1, bc(s) / 0.3); return [[sx(s), y - 0.004, z - w], [sx(s), y - 0.03, z + w * 0.4], [sx(s), y + 0.012, z + w]]; }, sAll.filter(s => s > 0.08)));
  hullParts.push(bottom, chine, top);
  const cap = sweep(s => [[sx(s), yg(s), bg(s)], [sx(s), yg(s) + 0.012, bg(s) - gw(s) * 0.5], [sx(s), yg(s), bg(s) - gw(s)]], sAll);
  const half = merge([...hullParts, cap]);
  // transom
  const tr = new THREE.Shape(); const T = 1;
  tr.moveTo(0, yk(T)); tr.lineTo(bc(T), ycE(T)); tr.lineTo(bc(T) + cf(T), ycE(T) + 0.014); tr.lineTo(bg(T), yg(T)); tr.lineTo(-bg(T), yg(T)); tr.lineTo(-bc(T) - cf(T), ycE(T) + 0.014); tr.lineTo(-bc(T), ycE(T)); tr.closePath();
  const transom = new THREE.ShapeGeometry(tr); place(transom, sx(T), 0, 0, -Math.PI / 2);
  mesh(root, merge([half, mirrorZ(half), transom]), hullMat, { name: 'hull' });

  // foredeck cover, aft bulkhead, well
  const sFore = sAll.filter(s => s <= COWL_END + 1e-6); if (sFore[sFore.length - 1] < COWL_END) sFore.push(COWL_END);
  const bi = s => bg(s) - gw(s), z1 = s => Math.max(bi(s) - 0.17, bi(s) * 0.5);
  const cowlSide = sweep(s => [[sx(s), yg(s) - 0.035, bi(s)], [sx(s), yg(s) + 0.095, z1(s)]], sFore);
  const cowlTop = sweep(s => [[sx(s), yg(s) + 0.095, z1(s)], [sx(s), yg(s) + 0.14, z1(s) * 0.5], [sx(s), yg(s) + 0.155, 0]], sFore);
  const gut = sweep(s => [[sx(s), yg(s), bi(s)], [sx(s), yg(s) - 0.035, bi(s)]], sFore);
  const fore = merge([cowlSide, cowlTop, gut]);
  const sAft = [COWL_END, 0.7, 0.8, 0.9, 1.0];
  const floor = sweep(s => [[sx(s), FLOOR, 0], [sx(s), FLOOR, bi(s)]], sAft);
  const inner = sweep(s => [[sx(s), FLOOR, bi(s)], [sx(s), yg(s), bi(s)]], sAft);
  const aft = merge([floor, inner]);
  const bh = new THREE.Shape(); const c = COWL_END;
  bh.moveTo(-bi(c), FLOOR); bh.lineTo(bi(c), FLOOR); bh.lineTo(bi(c), yg(c) - 0.035); bh.lineTo(z1(c), yg(c) + 0.095); bh.lineTo(0, yg(c) + 0.155); bh.lineTo(-z1(c), yg(c) + 0.095); bh.lineTo(-bi(c), yg(c) - 0.035); bh.closePath();
  const bulk = new THREE.ShapeGeometry(bh); place(bulk, sx(c), 0, 0, -Math.PI / 2);
  mesh(root, merge([fore, mirrorZ(fore), aft, mirrorZ(aft), bulk]), deckMat, { name: 'deck' });

  // engine box
  const eb = loft([
    { s: 0.0, y: 0.60, w: 0.5, ht: 0.03, hb: 0.28, nt: 5, nb: 6 }, { s: 0.22, y: 0.62, w: 0.74, ht: 0.3, hb: 0.32, nt: 5, nb: 6 },
    { s: 1.45, y: 0.62, w: 0.76, ht: 0.32, hb: 0.32, nt: 5, nb: 6 }, { s: 1.58, y: 0.6, w: 0.66, ht: 0.2, hb: 0.3, nt: 5, nb: 6 }, { s: 1.6, y: 0.6, w: 0.02, ht: 0.02, hb: 0.02, nt: 3, nb: 3 },
  ], { nS: 30, nT: 40, x0: sx(0.772) });
  mesh(root, eb.geometry, boxMat, { name: 'enginebox' });
  for (const sgn of [-1, 1]) for (let i = 0; i < 5; i++) mesh(root, place(new THREE.BoxGeometry(0.5, 0.02, 0.012), sx(0.772) - 0.75, 0.56 + i * 0.05, sgn * 0.765), black, { cast: false });
  mesh(root, place(new THREE.TorusGeometry(0.09, 0.012, 6, 14, Math.PI), sx(0.772) - 0.8, 0.93, 0, 0, 0, 0), tubeMat, { cast: false });

  // rub rail and fittings
  const railPts = sAll.map(s => V(sx(s), yg(s) + 0.006, bg(s) + 0.012));
  const rail = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 90, 0.034, 6);
  mesh(root, merge([rail, mirrorZ(rail), tube(V(sx(1) - 0.01, yg(1), -bg(1)), V(sx(1) - 0.01, yg(1), bg(1)), 0.03, 6)]), black, { name: 'rubrail' });
  for (const s of [0.3, 0.74]) for (const sgn of [-1, 1]) mesh(root, place(new THREE.BoxGeometry(0.09, 0.2, 0.05), sx(s), yg(s) - 0.13, sgn * (bg(s) + 0.02)), black, { cast: false });
  mesh(root, place(new THREE.CylinderGeometry(0.11, 0.13, 0.3, 14), sx(1) - 0.12, -0.22, 0, 0, 0, Math.PI / 2), black, { cast: false });

  // mast arch
  const tubes = [], P = {
    fL: V(sx(0.585), yg(0.585), -(bg(0.585) - 0.05)), fR: V(sx(0.585), yg(0.585), bg(0.585) - 0.05), rL: V(sx(0.71), yg(0.71), -(bg(0.71) - 0.05)), rR: V(sx(0.71), yg(0.71), bg(0.71) - 0.05),
    tfL: V(-1.02, 2.12, -0.42), tfR: V(-1.02, 2.12, 0.42), trL: V(-1.5, 2.2, -0.42), trR: V(-1.5, 2.2, 0.42),
  };
  const T2 = (a, b, r = 0.03) => tubes.push(tube(a, b, r));
  T2(P.fL, P.tfL); T2(P.fR, P.tfR); T2(P.rL, P.trL); T2(P.rR, P.trR); T2(P.tfL, P.tfR); T2(P.trL, P.trR); T2(P.tfL, P.trL); T2(P.tfR, P.trR);
  const midF = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, t);
  T2(midF(P.fL, P.tfL, 0.55), midF(P.fR, P.tfR, 0.55), 0.024); T2(midF(P.rL, P.trL, 0.5), midF(P.rR, P.trR, 0.5), 0.024);
  T2(midF(P.fL, P.tfL, 0.3), midF(P.rL, P.trL, 0.62), 0.022); T2(midF(P.fR, P.tfR, 0.3), midF(P.rR, P.trR, 0.62), 0.022);
  tubes.push(place(new THREE.BoxGeometry(0.62, 0.025, 0.96), -1.26, 2.185, 0, 0, 0, -0.16));
  mesh(root, merge(tubes), tubeMat, { name: 'mast' });
  // radar, EO/IR head, lights, antennas, camera pods
  const sens = [];
  sens.push(place(new THREE.CylinderGeometry(0.255, 0.265, 0.13, 28), -1.36, 2.3, 0.02)); sens.push(place(new THREE.SphereGeometry(0.255, 28, 10, 0, 6.2832, 0, Math.PI / 2).scale(1, 0.42, 1), -1.36, 2.365, 0.02));
  sens.push(place(new THREE.CylinderGeometry(0.04, 0.05, 0.36, 10), -1.02, 2.33, -0.3)); sens.push(place(new THREE.CylinderGeometry(0.088, 0.088, 0.24, 18), -1.02, 2.62, -0.3)); sens.push(place(new THREE.SphereGeometry(0.088, 18, 10), -1.02, 2.74, -0.3));
  mesh(root, merge(sens), white, { name: 'sensors' });
  mesh(root, place(new THREE.BoxGeometry(0.02, 0.13, 0.11), -0.935, 2.63, -0.3), glass, { cast: false });
  const ant = [];
  ant.push(tube(V(-1.52, 2.2, 0.4), V(-1.62, 3.55, 0.44), 0.008, 5)); ant.push(tube(V(-1.52, 2.2, -0.4), V(-1.64, 3.3, -0.45), 0.008, 5)); ant.push(tube(V(-1.02, 2.14, 0.4), V(-1.0, 3.0, 0.43), 0.007, 5));
  ant.push(tube(V(-1.5, 2.2, 0.0), V(-1.5, 2.78, 0.0), 0.012, 6));
  for (const sgn of [-1, 1]) { const p0 = midF(sgn < 0 ? P.fL : P.fR, sgn < 0 ? P.tfL : P.tfR, 0.72); ant.push(place(new THREE.BoxGeometry(0.16, 0.08, 0.2), p0.x + 0.08, p0.y, p0.z)); }
  mesh(root, merge(ant), black, { name: 'antennas' });
  const navRed = new THREE.MeshStandardMaterial({ color: lin(0.5, 0.02, 0.02), emissive: lin(1, 0.04, 0.02), emissiveIntensity: 0.6, roughness: 0.4 });
  mesh(root, place(new THREE.SphereGeometry(0.035, 10, 8), -1.5, 2.81, 0), navRed, { cast: false });

  root.userData = {
    // 0 = visible light; 1 = simulated long-wave IR (hull warm against the water, engine box hot)
    setThermal(k) { hullMat.emissiveIntensity = 1.3 * k; deckMat.emissiveIntensity = 1.6 * k; boxMat.emissiveIntensity = 5.0 * k; tubeMat.emissiveIntensity = 1.2 * k; },
  };
  root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return root;
}

// ------------------------------------------------------------------ waterfront
// Rubble mound along a path: a faceted rock bank with a flat crest.
function rubble(path, { crest = 3.0, top = 3.5, base = 17, seg = 1.5, toe = -2.2, seed = 3, taper = [true, true], tone = [0.2, 0.185, 0.165] } = {}) {
  const r = rng(seed), pts = [];
  for (let i = 0; i < path.length - 1; i++) { const [x0, z0] = path[i], [x1, z1] = path[i + 1], l = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(l / seg)); for (let j = 0; j < n; j++) pts.push([lerp(x0, x1, j / n), lerp(z0, z1, j / n)]); }
  pts.push(path[path.length - 1]);
  const NJ = 17, pos = [], col = [], idx = [], M = pts.length;
  for (let i = 0; i < M; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(M - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    const e0 = taper[0] ? Math.min(1, i * seg / 9) : 1, e1 = taper[1] ? Math.min(1, (M - 1 - i) * seg / 9) : 1, e = Math.min(e0, e1), ee = Math.sqrt(e);
    for (let j = 0; j < NJ; j++) {
      const u = j / (NJ - 1) * 2 - 1, o = u * base / 2 * (0.45 + 0.55 * ee), k = Math.min(1, (1 - Math.abs(u)) / (1 - top / base));
      const h = lerp(toe, lerp(toe + 0.8, crest, ee), Math.pow(k, 0.85));
      const j3 = j > 0 && j < NJ - 1 ? 1 : 0.3;
      pos.push(pts[i][0] + nx * o + (r() - 0.5) * 0.9 * j3, h + (r() - 0.5) * 0.75, pts[i][1] + nz * o + (r() - 0.5) * 0.9 * j3);
      const t = 0.72 + r() * 0.5, wet = h < 0.45 ? 0.55 : 1; col.push(tone[0] * t * wet, tone[1] * t * wet, tone[2] * t * wet);
    }
  }
  for (let i = 0; i < M - 1; i++) for (let j = 0; j < NJ - 1; j++) { const a = i * NJ + j, b = a + NJ, c = a + 1, d = b + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  return g;
}
// loose heap of broken masonry
function heap(rad, h, seed, tone = [0.3, 0.28, 0.25]) {
  const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, r = rng(seed), col = [];
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.75 + 0.5 * Math.sin(x * 9.1 + z * 4.3) * Math.cos(z * 7.7 + y * 3.1); p.setXYZ(i, x * rad * k, Math.max(0, y) * h * (0.6 + 0.8 * Math.abs(Math.sin(x * 5 + z * 6))), z * rad * k); const t = 0.6 + 0.7 * r(); col.push(tone[0] * t, tone[1] * t, tone[2] * t); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}

export const PORT = {
  quayY: 2.4, quayZ: -22, pier: { x0: -19, x1: -11, z1: 52, y: 2.6 }, lift: { x0: -8, x1: 4, z0: 2, z1: 40, y: 1.5 },
  sub: { x: -2, z0: 5.5, z1: 34.5, y: 3.32 }, finger: { x0: 4.6, x1: 7.2, z1: 44 },
  entrance: [[30, 176], [176, 108]],
  // waterline points the three boats run to
  hits: [[-2.2, 41.2], [8.4, 22.5], [-20.2, 26]],
};

export function buildPort(pipe) {
  const aniso = pipe.maxAniso, root = new THREE.Group(); root.name = 'port';
  const r = rng(77);
  const concTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#8d8a84'; g.fillRect(0, 0, w, h); const q = rng(9);
    for (let i = 0; i < 16000; i++) { g.fillStyle = `rgba(${q() < 0.5 ? '0,0,0' : '255,250,240'},${0.03 + q() * 0.05})`; const s = 1 + q() * 3; g.fillRect(q() * w, q() * h, s, s); }
    for (let i = 0; i < 90; i++) { const x = q() * w, y = q() * h, rr = 20 + q() * 90; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(30,26,22,${0.05 + q() * 0.1})`); gr.addColorStop(1, 'rgba(30,26,22,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    g.strokeStyle = 'rgba(35,33,30,0.55)'; g.lineWidth = 2.5; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
  }, { aniso, repeat: true });
  const conc = new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.92, metalness: 0 });
  const concDark = new THREE.MeshStandardMaterial({ map: concTex, color: lin(0.55, 0.53, 0.5), roughness: 0.95 });
  const ribH = document.createElement('canvas'); ribH.width = 256; ribH.height = 64; { const g = ribH.getContext('2d'); for (let x = 0; x < 256; x++) { const v = Math.round(128 + 110 * Math.sin(x / 256 * Math.PI * 2 * 16)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 64); } }
  const ribN = normalFromHeight(ribH, 1.4, aniso, true); ribN.wrapS = ribN.wrapT = THREE.RepeatWrapping;
  const dirtTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); const q = rng(31);
    for (let i = 0; i < 260; i++) { const x = q() * w, l = 30 + q() * 260; const gr = g.createLinearGradient(0, 0, 0, l); gr.addColorStop(0, `rgba(60,48,36,${0.1 + q() * 0.22})`); gr.addColorStop(1, 'rgba(60,48,36,0)'); g.fillStyle = gr; g.fillRect(x, q() * h * 0.5, 2 + q() * 9, l); }
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(40,34,28,${q() * 0.08})`; g.fillRect(q() * w, q() * h, 2, 2); }
  }, { aniso, repeat: true });
  const metal = (c, rough = 0.6) => new THREE.MeshStandardMaterial({ color: c, map: dirtTex, normalMap: ribN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: rough, metalness: 0.25 });
  const paint = (c, rough = 0.7, met = 0.1) => new THREE.MeshStandardMaterial({ color: c, map: dirtTex, roughness: rough, metalness: met });
  const dark = new THREE.MeshStandardMaterial({ color: lin(0.012, 0.012, 0.013), roughness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: lin(0.02, 0.02, 0.021), roughness: 0.85 });
  const Y = PORT.quayY;

  // land, quay apron, beaches
  const landTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#a3957c'; g.fillRect(0, 0, w, h); const q = rng(55);
    for (let i = 0; i < 600; i++) { const x = q() * w, y = q() * h, rr = 15 + q() * 120; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, `rgba(${q() < 0.5 ? '70,58,44' : '214,200,170'},${0.05 + q() * 0.12})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    for (let i = 0; i < 20000; i++) { g.fillStyle = `rgba(${q() < 0.5 ? '40,34,26' : '235,225,205'},${0.04 + q() * 0.08})`; g.fillRect(q() * w, q() * h, 1.5, 1.5); }
  }, { aniso, repeat: true });
  landTex.repeat.set(60, 30);
  const landG = new THREE.PlaneGeometry(14000, 7000, 1, 1); landG.rotateX(-Math.PI / 2);
  mesh(root, place(landG, 0, Y - 0.06, PORT.quayZ - 3500), new THREE.MeshStandardMaterial({ map: landTex, roughness: 1 }), { cast: false });
  mesh(root, place(mbox(330, 6, 96, 9), 5, Y - 3, PORT.quayZ - 48), conc, { cast: false, name: 'quay' });
  const beach = (x0, x1) => { const g = sweep(u => { const x = lerp(x0, x1, u), w = Math.sin(x * 0.011) * 3 + Math.sin(x * 0.037) * 1.2; return [[x, Y - 0.06, PORT.quayZ - 2], [x, 0.9, PORT.quayZ + 7 + w], [x, -0.9, PORT.quayZ + 19 + w * 1.4]]; }, Array.from({ length: 80 }, (_, i) => i / 79), x1 < x0); return g; };
  const sand = new THREE.MeshStandardMaterial({ color: lin(0.42, 0.36, 0.27), roughness: 1, side: THREE.DoubleSide });
  mesh(root, beach(-7000, -205), sand, { cast: false }); mesh(root, beach(215, 7000), sand, { cast: false });

  // breakwaters and the rubble bank beside the yard
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const rocks = [
    rubble([[-190, PORT.quayZ + 4], [-190, 150], [-176, 172], [-150, 178], [28, 178]], { seed: 11, taper: [false, true] }),
    rubble([[196, PORT.quayZ + 4], [196, 70], [188, 96], [174, 110]], { seed: 12, taper: [false, true] }),
    rubble([[26, PORT.quayZ + 5], [150, PORT.quayZ + 5]], { seed: 13, crest: 2.3, top: 2, base: 15, toe: -1.6, taper: [true, true], tone: [0.24, 0.215, 0.18] }),
    rubble([[-150, PORT.quayZ + 5], [-196, PORT.quayZ + 5]], { seed: 14, crest: 2.3, top: 2, base: 15, toe: -1.6, taper: [true, false], tone: [0.24, 0.215, 0.18] }),
    rubble([[150, PORT.quayZ + 5], [202, PORT.quayZ + 5]], { seed: 15, crest: 2.3, top: 2, base: 15, toe: -1.6, taper: [false, false], tone: [0.24, 0.215, 0.18] }),
  ];
  mesh(root, merge(rocks), rockMat, { cast: true, name: 'rubble' });
  // entrance beacons (plain lattice posts)
  const steel = paint(lin(0.3, 0.31, 0.32), 0.6, 0.5);
  for (const [x, z] of PORT.entrance) { const g = []; for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) g.push(tube(V(x + dx, 2.4, z + dz), V(x + dx * 0.3, 9, z + dz * 0.3), 0.05, 5)); g.push(place(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 10), x, 9.2, z)); mesh(root, merge(g), steel); }

  // pier on piles, finger pier, ship lift
  const pier = PORT.pier, lift = PORT.lift, fin = PORT.finger, parts = [];
  parts.push(place(mbox(pier.x1 - pier.x0, 0.9, pier.z1 - PORT.quayZ, 6), (pier.x0 + pier.x1) / 2, pier.y - 0.45, (pier.z1 + PORT.quayZ) / 2));
  parts.push(place(mbox(fin.x1 - fin.x0, 0.7, fin.z1 - PORT.quayZ, 6), (fin.x0 + fin.x1) / 2, pier.y - 0.35, (fin.z1 + PORT.quayZ) / 2));
  mesh(root, merge(parts), conc, { name: 'pierdeck' });
  const piles = [];
  for (let z = PORT.quayZ + 3; z <= pier.z1 - 1; z += 5.2) for (const x of [pier.x0 + 0.9, (pier.x0 + pier.x1) / 2, pier.x1 - 0.9]) piles.push(place(new THREE.CylinderGeometry(0.42, 0.42, 4.2, 12), x, pier.y - 0.9 - 2.1 + 0.2, z));
  for (let z = PORT.quayZ + 3; z <= fin.z1 - 1; z += 5.2) for (const x of [fin.x0 + 0.5, fin.x1 - 0.5]) piles.push(place(new THREE.CylinderGeometry(0.34, 0.34, 4.2, 10), x, pier.y - 0.7 - 2.1 + 0.2, z));
  for (let z = PORT.quayZ + 5; z <= pier.z1; z += 10.4) piles.push(place(mbox(pier.x1 - pier.x0, 0.7, 0.9, 6), (pier.x0 + pier.x1) / 2, pier.y - 1.2, z));
  mesh(root, merge(piles), concDark, { name: 'piles' });
  const liftG = [place(mbox(lift.x1 - lift.x0, 0.55, lift.z1 - lift.z0, 6), (lift.x0 + lift.x1) / 2, lift.y - 0.275, (lift.z0 + lift.z1) / 2)];
  for (let z = lift.z0 + 3; z < lift.z1; z += 5.6) liftG.push(place(mbox(lift.x1 - lift.x0 + 1.2, 0.5, 0.7, 6), (lift.x0 + lift.x1) / 2, lift.y - 0.75, z));
  mesh(root, merge(liftG), paint(lin(0.2, 0.2, 0.2), 0.8, 0.3), { name: 'liftplatform' });
  const win = [], cab = [];
  for (let z = lift.z0 + 3; z < lift.z1; z += 5.6) for (const [x, sgn] of [[pier.x1 - 0.9, 1], [fin.x0 + 0.9, -1]]) {
    win.push(place(new THREE.BoxGeometry(1.3, 1.1, 1.5), x, pier.y + 0.55, z)); win.push(place(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 12), x + sgn * 0.5, pier.y + 0.65, z, 0, 0, Math.PI / 2));
    cab.push(tube(V(x + sgn * 0.85, pier.y + 0.3, z), V(x + sgn * 1.25, lift.y, z), 0.03, 5));
  }
  mesh(root, merge(win), paint(lin(0.1, 0.16, 0.24), 0.6, 0.4), { name: 'winches' }); mesh(root, merge(cab), dark, { cast: false });
  // bollards, tyre fenders, railing
  const fit = [];
  for (let z = PORT.quayZ + 6; z < pier.z1; z += 9) { fit.push(place(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 10), pier.x0 + 0.6, pier.y + 0.25, z)); fit.push(place(new THREE.TorusGeometry(0.55, 0.2, 8, 16), pier.x0 - 0.2, 1.5, z + 3, Math.PI / 2)); }
  for (let x = -130; x < 150; x += 14) fit.push(place(new THREE.CylinderGeometry(0.22, 0.28, 0.55, 10), x, Y + 0.27, PORT.quayZ - 0.8));
  mesh(root, merge(fit), rubber);
  const railG = [];
  for (let z = PORT.quayZ + 1; z < pier.z1; z += 2.2) railG.push(place(new THREE.BoxGeometry(0.05, 1.05, 0.05), pier.x0 + 0.15, pier.y + 0.52, z));
  railG.push(place(new THREE.BoxGeometry(0.05, 0.05, pier.z1 - PORT.quayZ), pier.x0 + 0.15, pier.y + 1.05, (pier.z1 + PORT.quayZ) / 2)); railG.push(place(new THREE.BoxGeometry(0.04, 0.04, pier.z1 - PORT.quayZ), pier.x0 + 0.15, pier.y + 0.55, (pier.z1 + PORT.quayZ) / 2));
  mesh(root, merge(railG), steel, { cast: false });

  // lamp posts
  const lamps = []; const lampAt = (x, z, ry) => { lamps.push(place(new THREE.CylinderGeometry(0.07, 0.11, 9.5, 8), x, 0, z).translate(0, (z > PORT.quayZ ? pier.y : Y) + 4.75, 0)); const yb = (z > PORT.quayZ ? pier.y : Y) + 9.5; lamps.push(place(new THREE.BoxGeometry(1.7, 0.07, 0.07), x + Math.cos(ry) * 0.85, yb, z - Math.sin(ry) * 0.85, ry)); lamps.push(place(new THREE.BoxGeometry(0.62, 0.13, 0.26), x + Math.cos(ry) * 1.6, yb - 0.06, z - Math.sin(ry) * 1.6, ry)); };
  for (const z of [-14, 4, 22, 40]) lampAt(pier.x0 + 0.5, z, 0);
  for (const x of [-120, -80, -44, 34, 70, 106, 142]) lampAt(x, PORT.quayZ - 3, Math.PI / 2);
  mesh(root, merge(lamps), steel);

  // the boat on the lift: a small submarine hull on keel blocks (generic)
  const sub = PORT.sub, SL = sub.z1 - sub.z0;
  const hull = loft([
    { s: 0.0, y: 0, w: 0.04, ht: 0.04, hb: 0.04 }, { s: 0.35, y: 0, w: 0.62, ht: 0.62, hb: 0.62 }, { s: 1.4, y: 0, w: 1.12, ht: 1.12, hb: 1.12 }, { s: 3.6, y: 0, w: 1.38, ht: 1.38, hb: 1.38 },
    { s: SL * 0.66, y: 0, w: 1.38, ht: 1.38, hb: 1.38 }, { s: SL * 0.86, y: 0.05, w: 0.8, ht: 0.8, hb: 0.8 }, { s: SL * 0.985, y: 0.12, w: 0.16, ht: 0.16, hb: 0.16 }, { s: SL, y: 0.12, w: 0.02, ht: 0.02, hb: 0.02 },
  ], { nS: 90, nT: 40, x0: 0 });
  const subG = [hull.geometry.clone()];
  const sail = new THREE.CylinderGeometry(1, 1, 1.75, 28, 1); sail.scale(1.9, 1, 0.5); subG.push(place(sail, -SL * 0.4, 1.38 + 0.8, 0));
  const sailTop = new THREE.SphereGeometry(1, 24, 8, 0, 6.2832, 0, Math.PI / 2); sailTop.scale(1.9, 0.22, 0.5); subG.push(place(sailTop, -SL * 0.4, 1.38 + 1.675, 0));
  subG.push(place(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 8), -SL * 0.4 + 0.4, 1.38 + 2.6, 0)); subG.push(place(new THREE.CylinderGeometry(0.045, 0.045, 1.3, 8), -SL * 0.4 - 0.5, 1.38 + 2.3, 0.1));
  for (const rz of [0, Math.PI / 2]) subG.push(place(new THREE.BoxGeometry(1.5, 0.07, 3.0), -SL * 0.93, 0.1, 0, 0, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationX(rz)));
  subG.push(place(new THREE.TorusGeometry(0.62, 0.07, 8, 24), -SL * 0.985, 0.12, 0, Math.PI / 2));
  const subMesh = mesh(root, merge(subG), new THREE.MeshStandardMaterial({ color: lin(0.035, 0.037, 0.04), map: dirtTex, roughness: 0.62, metalness: 0.2 }), { name: 'submarine' });
  subMesh.rotation.y = -Math.PI / 2; subMesh.position.set(sub.x, sub.y, sub.z1);
  const blocks = [];
  for (let i = 0; i < 7; i++) { const z = sub.z1 - 3.5 - i * (SL - 7) / 6; blocks.push(place(new THREE.BoxGeometry(1.5, sub.y - 1.38 - lift.y, 0.9), sub.x, (sub.y - 1.38 + lift.y) / 2, z)); for (const sgn of [-1, 1]) blocks.push(tube(V(sub.x + sgn * 3.0, lift.y, z), V(sub.x + sgn * 1.2, sub.y - 0.5, z), 0.07, 6)); }
  mesh(root, merge(blocks), paint(lin(0.22, 0.17, 0.11), 0.9, 0));

  // yellow gantry straddling the lift
  const yel = new THREE.MeshStandardMaterial({ color: lin(0.62, 0.4, 0.045), map: dirtTex, roughness: 0.65, metalness: 0.15 });
  const gx0 = pier.x1 - 1.2, gx1 = fin.x0 + 1.3, gz0 = 21, gz1 = 35, gh = 15.5, gy = pier.y, gan = [];
  for (const x of [gx0, gx1]) for (const z of [gz0, gz1]) { gan.push(place(new THREE.BoxGeometry(1.0, gh, 1.0), x, gy + gh / 2, z)); gan.push(place(new THREE.BoxGeometry(1.6, 0.9, 2.4), x, gy + 0.45, z)); }
  for (const z of [gz0, gz1]) gan.push(place(new THREE.BoxGeometry(gx1 - gx0 + 2.2, 1.7, 1.2), (gx0 + gx1) / 2, gy + gh + 0.2, z));
  for (const x of [gx0, gx1]) { gan.push(place(new THREE.BoxGeometry(1.0, 1.3, gz1 - gz0), x, gy + gh - 0.3, (gz0 + gz1) / 2)); gan.push(place(new THREE.BoxGeometry(0.5, 0.5, Math.hypot(gz1 - gz0, 8)), x, gy + 6.5, (gz0 + gz1) / 2, 0, Math.atan2(8, gz1 - gz0))); gan.push(place(new THREE.BoxGeometry(0.5, 0.5, Math.hypot(gz1 - gz0, 8)), x, gy + 6.5, (gz0 + gz1) / 2, 0, -Math.atan2(8, gz1 - gz0))); }
  gan.push(place(new THREE.BoxGeometry(5.2, 2.6, 6.5), (gx0 + gx1) / 2 - 1, gy + gh + 2.35, (gz0 + gz1) / 2)); gan.push(place(new THREE.BoxGeometry(3.4, 2.2, 3.0), gx1 - 1.2, gy + gh + 2.1, gz0 + 1));
  gan.push(place(new THREE.BoxGeometry(gx1 - gx0, 0.6, 0.9), (gx0 + gx1) / 2, gy + gh + 0.4, (gz0 + gz1) / 2));
  mesh(root, merge(gan), yel, { name: 'gantry' });
  const gd = [];
  for (const z of [gz0 - 0.75, gz1 + 0.75]) { gd.push(place(new THREE.BoxGeometry(gx1 - gx0 + 2.2, 0.05, 0.05), (gx0 + gx1) / 2, gy + gh + 2.15, z)); for (let x = gx0 - 1; x <= gx1 + 1; x += 1.6) gd.push(place(new THREE.BoxGeometry(0.05, 1.05, 0.05), x, gy + gh + 1.6, z)); }
  for (const x of [(gx0 + gx1) / 2 - 2.5, (gx0 + gx1) / 2 + 2.5]) for (const z of [gz0 + 3, gz1 - 3]) gd.push(tube(V(x, gy + gh, z), V(x, sub.y + 2.2, z), 0.035, 5));
  gd.push(tube(V(gx1 + 0.6, gy, gz0 - 0.6), V(gx1 + 0.6, gy + gh, gz0 + 5), 0.09, 5));
  mesh(root, merge(gd), dark, { cast: false });

  // maintenance sheds
  const shed = (x, z, w, d, h, wallC, roofC, opt = {}) => {
    const g = new THREE.Group(); g.position.set(x, Y, z); g.rotation.y = opt.ry || 0; root.add(g);
    const rise = d * 0.11, wall = metal(wallC, 0.62), roof = metal(roofC, 0.55);
    wall.normalMap = ribN.clone(); wall.normalMap.repeat.set(1, 1); wall.normalMap.needsUpdate = true;
    const cut = opt.damaged ? 0.42 : 1;   // fraction of the length still standing
    const wl = w * cut, wx = -w / 2 + wl / 2;
    mesh(g, place(mbox(wl, h, d, 5), wx, h / 2, 0), wall);
    // gable roof
    const rg = new THREE.BufferGeometry(), x0 = -w / 2 - 0.7, x1 = -w / 2 + wl + (opt.damaged ? 0 : 0.7), z0 = -d / 2 - 0.7, z1 = d / 2 + 0.7;
    const rp = [x0, h, z0, x1, h, z0, x1, h + rise, 0, x0, h + rise, 0, x0, h, z1, x1, h, z1];
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, wl / 5, 0, wl / 5, 4, 0, 4, 0, 8, wl / 5, 8], 2));
    rg.setIndex([0, 3, 1, 1, 3, 2, 3, 4, 2, 2, 4, 5]); rg.computeVertexNormals();
    const rm = mesh(g, rg, roof); rm.material.side = THREE.DoubleSide;
    const gab = new THREE.BufferGeometry(); gab.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, h, -d / 2, -w / 2, h, d / 2, -w / 2, h + rise, 0, wx + wl / 2, h, d / 2, wx + wl / 2, h, -d / 2, wx + wl / 2, h + rise, 0], 3));
    gab.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2)); gab.setIndex([0, 1, 2, 3, 4, 5]); gab.computeVertexNormals(); mesh(g, gab, wall).material.side = THREE.DoubleSide;
    // big doors on the water side
    const nd = opt.doors ?? 2, dw = Math.min(15, wl / nd * 0.62), dh = h * 0.72;
    for (let i = 0; i < nd; i++) { const dx = -w / 2 + wl * (i + 0.5) / nd; if (dx + dw / 2 > -w / 2 + wl - 1) continue; mesh(g, place(new THREE.BoxGeometry(dw, dh, 0.5), dx, dh / 2, d / 2 - 0.1), dark, { cast: false }); mesh(g, place(new THREE.BoxGeometry(dw * 0.46, dh, 0.25), dx - dw * 0.3 - (i % 2) * 2, dh / 2, d / 2 + 0.2), metal(roofC, 0.6), { cast: false }); mesh(g, place(new THREE.BoxGeometry(dw + 1.2, 0.5, 0.5), dx, dh + 0.3, d / 2 + 0.15), steel, { cast: false }); }
    if (opt.band) mesh(g, place(new THREE.BoxGeometry(wl + 0.08, h * 0.2, d + 0.08), wx, h * 0.84, 0), metal(opt.band, 0.6), { cast: false });
    if (opt.damaged) {
      // the far end is down: bent frames, a spill of masonry and sheet, soot on what still stands
      const hx = -w / 2 + wl;
      mesh(g, place(heap(w * 0.3, 5.5, opt.seed || 5), hx + w * 0.2, 0, 2), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
      mesh(g, place(heap(w * 0.16, 3.2, (opt.seed || 5) + 1, [0.16, 0.15, 0.14]), hx + w * 0.42, 0, -d * 0.25), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
      const fr = []; for (let i = 0; i < 4; i++) { const fx = hx + 2 + i * w * 0.13, lean = 0.25 + i * 0.2; fr.push(place(new THREE.BoxGeometry(0.4, h * (0.95 - i * 0.2), 0.4), fx, h * (0.95 - i * 0.2) / 2 - 0.3, -d / 2 + 0.3, 0, 0, -lean)); if (i < 3) fr.push(place(new THREE.BoxGeometry(0.35, h * (0.8 - i * 0.2), 0.35), fx + 1, h * (0.8 - i * 0.2) / 2 - 0.3, d / 2 - 0.3, 0, 0, lean * 0.7)); }
      fr.push(place(new THREE.BoxGeometry(w * 0.3, 0.3, 0.3), hx + w * 0.13, h * 0.55, -d / 2 + 0.3, 0, 0, -0.5));
      mesh(g, merge(fr), paint(lin(0.09, 0.07, 0.06), 0.9, 0.5));
      for (let i = 0; i < 5; i++) mesh(g, place(new THREE.PlaneGeometry(5 + i, 3.5), hx + 3 + i * 3.2, 1.2 + (i % 3) * 1.1, (i - 2) * 3.5, i * 1.3, -1.2 + i * 0.25), roof, { cast: false }).material.side = THREE.DoubleSide;
      mesh(g, place(new THREE.BoxGeometry(wl * 0.5, h * 0.9, d + 0.12), hx - wl * 0.25, h * 0.55, 0), new THREE.MeshStandardMaterial({ color: lin(0.02, 0.018, 0.016), transparent: true, opacity: 0.55, roughness: 1 }), { cast: false });
    }
    return g;
  };
  shed(74, -72, 62, 40, 15, lin(0.55, 0.57, 0.58), lin(0.42, 0.44, 0.45), { band: lin(0.08, 0.2, 0.42), doors: 2 });
  shed(158, -70, 60, 38, 14, lin(0.5, 0.52, 0.55), lin(0.3, 0.33, 0.37), { band: lin(0.07, 0.17, 0.36), doors: 2, damaged: true, seed: 21 });
  shed(-92, -78, 54, 36, 13, lin(0.47, 0.45, 0.4), lin(0.36, 0.35, 0.33), { doors: 2 });
  shed(-10, -96, 40, 26, 9, lin(0.5, 0.48, 0.44), lin(0.4, 0.39, 0.37), { doors: 3 });

  // yard clutter: containers, a mobile crane, tanks, and the low buildings of the base behind
  const boxes = [];
  const cc = [lin(0.3, 0.1, 0.07), lin(0.1, 0.18, 0.26), lin(0.35, 0.3, 0.2), lin(0.16, 0.2, 0.16), lin(0.34, 0.34, 0.33)];
  const cg = cc.map(() => []);
  for (let i = 0; i < 22; i++) { const x = -62 + (i % 6) * 6.6 + (r() - 0.5), z = -40 - Math.floor(i / 6) * 3.1, st = i % 5 === 0 ? 1 : 0; cg[i % cc.length].push(place(mbox(6.06, 2.59, 2.44, 3), x, Y + 1.3 + st * 2.6, z, r() * 0.04)); }
  cg.forEach((list, i) => { if (list.length) mesh(root, merge(list), metal(cc[i], 0.7)); });
  const crane = [place(new THREE.BoxGeometry(9, 2.2, 3), 30, Y + 1.7, -42, 0.3), place(new THREE.BoxGeometry(2.4, 2.4, 2.6), 27.5, Y + 3.6, -41, 0.3), place(new THREE.BoxGeometry(26, 0.9, 0.9), 37, Y + 11.5, -45, 0.3, 0, 0.72)];
  mesh(root, merge(crane), paint(lin(0.55, 0.36, 0.05), 0.7, 0.2));
  const tk = []; for (let i = 0; i < 4; i++) tk.push(place(new THREE.CylinderGeometry(7, 7, 9, 24), 230 + (i % 2) * 19, Y + 4.5, -120 - Math.floor(i / 2) * 19));
  mesh(root, merge(tk), paint(lin(0.7, 0.7, 0.68), 0.5, 0.1));
  const bl = [], rf = [];
  for (let i = 0; i < 120; i++) {
    const x = (r() * 2 - 1) * 520, z = -150 - r() * 520; if (Math.abs(x - 240) < 40 && z > -170) continue;
    const w = 12 + r() * 34, d = 9 + r() * 22, h = 3.5 + r() * 6, ry = (Math.round(r() * 2) * Math.PI) / 2 + (r() - 0.5) * 0.08;
    bl.push(place(mbox(w, h, d, 6), x, Y + h / 2, z, ry)); rf.push(place(new THREE.BoxGeometry(w + 0.5, 0.3, d + 0.5), x, Y + h + 0.15, z, ry));
  }
  mesh(root, merge(bl), paint(lin(0.52, 0.47, 0.38), 0.9, 0), { cast: false }); mesh(root, merge(rf), paint(lin(0.6, 0.58, 0.54), 0.85, 0), { cast: false });
  const roads = []; for (const z of [-128, -260, -400, -560]) roads.push(place(new THREE.BoxGeometry(1300, 0.05, 9), 0, Y, z)); for (const x of [-380, -190, 0, 190, 380]) roads.push(place(new THREE.BoxGeometry(9, 0.05, 560), x, Y, -410));
  mesh(root, merge(roads), new THREE.MeshStandardMaterial({ color: lin(0.07, 0.07, 0.072), roughness: 0.95 }), { cast: false });
  root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return root;
}

// ------------------------------------------------------------------ distant merchant ship (silhouette-level detail)
export function buildShip(len = 250) {
  const root = new THREE.Group(), k = len / 250;
  const hull = loft([
    { s: 0, y: 6, w: 0.3, ht: 6.5, hb: 12, nt: 3, nb: 3 }, { s: 14, y: 6, w: 13, ht: 6, hb: 13, nt: 4, nb: 3.5 }, { s: 40, y: 5.5, w: 21.5, ht: 5.5, hb: 13, nt: 6, nb: 5 },
    { s: 215, y: 5.5, w: 21.5, ht: 5.5, hb: 13, nt: 6, nb: 5 }, { s: 245, y: 6, w: 17, ht: 6, hb: 10, nt: 5, nb: 4 }, { s: 250, y: 6.5, w: 0.5, ht: 5, hb: 5, nt: 4, nb: 4 },
  ], { nS: 60, nT: 28, x0: 125 });
  const hm = new THREE.Mesh(hull.geometry, new THREE.MeshStandardMaterial({ color: lin(0.035, 0.04, 0.05), roughness: 0.7 })); root.add(hm);
  const wht = new THREE.MeshStandardMaterial({ color: lin(0.62, 0.62, 0.6), roughness: 0.6 }), deck = new THREE.MeshStandardMaterial({ color: lin(0.2, 0.1, 0.07), roughness: 0.85 });
  const add = (g, m) => { const o = new THREE.Mesh(g, m); root.add(o); return o; };
  add(place(new THREE.BoxGeometry(205, 1.0, 41), -4, 11.3, 0), deck);
  add(place(new THREE.BoxGeometry(22, 20, 34), -92, 21.5, 0), wht); add(place(new THREE.BoxGeometry(10, 5, 40), -88, 33, 0), wht);
  add(place(new THREE.CylinderGeometry(3, 3.6, 11, 12), -100, 37, 0), new THREE.MeshStandardMaterial({ color: lin(0.05, 0.05, 0.055), roughness: 0.7 }));
  for (let i = 0; i < 7; i++) add(place(new THREE.CylinderGeometry(0.5, 0.5, 30, 6), -55 + i * 24, 13.4, (i % 2 ? 6 : -6), 0, 0, Math.PI / 2), wht);
  add(place(new THREE.CylinderGeometry(0.4, 0.5, 16, 6), 108, 19, 0), wht); add(place(new THREE.CylinderGeometry(0.5, 0.6, 13, 6), 10, 18, 0), wht);
  root.scale.setScalar(k); root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
  return root;
}
