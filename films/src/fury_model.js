// Anduril YFQ-44A "Fury" (launch aircraft, tail 1003) and an AIM-120 AMRAAM on an underwing rail, modelled
// from U.S. Air Force / Anduril imagery. Length is scaled from the missile (3.65 m is about 0.37 of the
// airframe); every other dimension is estimated from photographs.
// Body frame: +x forward, +y up, +z starboard. s = metres aft of the nose tip.
import * as THREE from 'three';
import { loft, loftDecal, wing, Skin, canvasTex, decalTex, decalMat, addTo, rng } from '../engine/geo.js';

const X0 = 5.2;                 // nose tip is X0 metres ahead of the model origin
const X = s => X0 - s;          // body-x of a station s metres aft of the nose tip
const CH = -0.20;               // height of the chine / wing plane
const RAIL_Z = 1.85, RAIL_S0 = 3.93, RAIL_S1 = 6.73, RAIL_Y = -0.40;
const MSL_LEN = 3.65, MSL_R = 0.089, MSL_NOSE_S = 3.07, MSL_Y = -0.557;
const GROUND = -1.20;           // ground plane when standing on the wheels
const WING = { z0: 0.60, z1: 3.30, le0: 4.40, te0: 6.86, le1: 5.86, te1: 6.98 };
const NOSE_GEAR = { s: 3.60, r: 0.180, w: 0.115 }, MAIN_GEAR = { s: 5.75, z: 0.86, r: 0.235, w: 0.155 };
export const FURY = {
  length: 9.9, span: 6.6, groundY: GROUND, chineY: CH, noseX: X(0), nozzleX: X(9.9), nozzleY: -0.05, nozzleR: 0.27,
  // missile centre when it hangs on the left-wing rail (body frame), and the rail it leaves
  station: new THREE.Vector3(X(MSL_NOSE_S + MSL_LEN / 2), MSL_Y, -RAIL_Z),
  railZ: RAIL_Z, railY: RAIL_Y, railX0: X(RAIL_S0), railX1: X(RAIL_S1),
  noseGear: new THREE.Vector3(X(NOSE_GEAR.s), GROUND, 0), mainGear: new THREE.Vector3(X(MAIN_GEAR.s), GROUND, MAIN_GEAR.z), mainR: MAIN_GEAR.r,
  wingTip: new THREE.Vector3(X((WING.le1 + WING.te1) / 2), CH, WING.z1), tailX: X(9.95), finTopY: 1.84,
};
const LOW = '#878d93', UP = '#4b5056', DARK = '#33373c', FONT = '"Saira Condensed", "Arial Narrow", Arial, sans-serif';

// ------------------------------------------------------------------ small geometry helpers
// Faceted loft through rings of points (same count per ring). Hard edges between the longitudinal strips,
// smooth along them. UV: u along the rings (us[] or index), v = perimeter fraction.
function ringLoft(rings, { closed = true, us = null } = {}) {
  const nR = rings.length, nP = rings[0].length, cnt = closed ? nP : nP - 1, pos = [], uv = [], idx = [];
  const mid = rings[Math.floor(nR / 2)], per = [0]; let tot = 0;
  for (let j = 0; j < cnt; j++) { const a = mid[j], b = mid[(j + 1) % nP]; tot += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); per.push(tot); }
  let cx = 0, cy = 0, cz = 0, n = 0; for (const r of rings) for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; n++; } cx /= n; cy /= n; cz /= n;
  let orient = 0;
  for (let j = 0; j < cnt; j++) {
    const base = pos.length / 3;
    for (let i = 0; i < nR; i++) { const a = rings[i][j], b = rings[i][(j + 1) % nP], u = us ? us[i] : i / (nR - 1); pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); uv.push(u, per[j] / tot, u, per[j + 1] / tot); }
    for (let i = 0; i < nR - 1; i++) {
      const A = base + i * 2, B = A + 1, C = A + 2, D = A + 3; idx.push(A, C, B, B, C, D);
      const a = rings[i][j], b = rings[i][(j + 1) % nP], c = rings[i + 1][j];
      const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
      orient += (uy * vz - uz * vy) * (a[0] - cx) + (uz * vx - ux * vz) * (a[1] - cy) + (ux * vy - uy * vx) * (a[2] - cz);
    }
  }
  if (orient < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals(); return g;
}
// flat polygon cap through a ring of points, facing `dir`
function capOf(ring, dir) {
  const pos = [], idx = []; let cx = 0, cy = 0, cz = 0; for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const n = ring.length; pos.push(cx / n, cy / n, cz / n); for (const p of ring) pos.push(p[0], p[1], p[2]);
  for (let j = 0; j < n; j++) idx.push(0, 1 + j, 1 + (j + 1) % n);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const nn = g.attributes.normal; if (nn.getX(0) * dir[0] + nn.getY(0) * dir[1] + nn.getZ(0) * dir[2] < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}
// thin plate through a planar outline (list of [x,y,z]), extruded by `th` along `nrm`
function plate(outline, nrm, th) {
  const a = outline.map(p => [p[0] + nrm[0] * th / 2, p[1] + nrm[1] * th / 2, p[2] + nrm[2] * th / 2]), b = outline.map(p => [p[0] - nrm[0] * th / 2, p[1] - nrm[1] * th / 2, p[2] - nrm[2] * th / 2]);
  const gs = [ringLoft([a, b]), capOf(a, nrm), capOf(b, [-nrm[0], -nrm[1], -nrm[2]])];
  return mergeGeos(gs);
}
function mergeGeos(gs) {
  const pos = [], nor = [], uv = [], idx = []; let off = 0;
  for (const g of gs) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
    const ix = g.index ? g.index.array : [...Array(p.count).keys()]; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off); off += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
// cylinder between two points
function rod(a, b, r, seg = 10, r2 = r) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
  const g = new THREE.CylinderGeometry(r2, r, L, seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); return g;
}
// wheel: tyre + hub as lathes about z (axle), centred at the origin
function wheelGeos(r, w) {
  const t = [[r * 0.52, -w * 0.40], [r * 0.60, -w * 0.47], [r * 0.80, -w * 0.5], [r * 0.93, -w * 0.46], [r * 0.985, -w * 0.36], [r, -w * 0.2], [r, w * 0.2], [r * 0.985, w * 0.36], [r * 0.93, w * 0.46], [r * 0.80, w * 0.5], [r * 0.60, w * 0.47], [r * 0.52, w * 0.40]];
  const tyre = new THREE.LatheGeometry(t.map(p => new THREE.Vector2(p[0], p[1])), 44); tyre.rotateX(Math.PI / 2);
  const h = [[0.0, w * 0.26], [r * 0.10, w * 0.26], [r * 0.13, w * 0.20], [r * 0.30, w * 0.16], [r * 0.44, w * 0.30], [r * 0.535, w * 0.40], [r * 0.535, -w * 0.40], [r * 0.44, -w * 0.30], [r * 0.30, -w * 0.16], [r * 0.13, -w * 0.20], [r * 0.10, -w * 0.26], [0.0, -w * 0.26]];
  const hub = new THREE.LatheGeometry(h.map(p => new THREE.Vector2(p[0], p[1])), 32); hub.rotateX(Math.PI / 2);
  // lightening holes read as dark dots on the dish
  const holes = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; for (const sgn of [1, -1]) { const c = new THREE.CircleGeometry(r * 0.045, 10); if (sgn < 0) c.rotateY(Math.PI); c.translate(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, sgn * (w * 0.215)); holes.push(c); } }
  return { tyre, hub, holes: mergeGeos(holes) };
}
function usafSymbol(g, cx, cy, s, color) {
  g.save(); g.translate(cx, cy); g.scale(s, s); g.fillStyle = color;
  for (const m of [1, -1]) {
    g.beginPath(); g.moveTo(m * 0.05, -0.08); g.lineTo(m * 0.50, -0.44); g.lineTo(m * 0.455, -0.20); g.lineTo(m * 0.115, 0.045); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(m * 0.135, 0.085); g.lineTo(m * 0.43, -0.125); g.lineTo(m * 0.385, 0.045); g.lineTo(m * 0.155, 0.20); g.closePath(); g.fill();
  }
  g.beginPath(); g.moveTo(0, -0.115); g.lineTo(0.095, 0.02); g.lineTo(0, 0.125); g.lineTo(-0.095, 0.02); g.closePath(); g.fill();
  g.beginPath(); g.arc(0, 0.29, 0.10, 0, 6.2832); g.fill();
  g.restore();
}

export function buildFury(pipe) {
  const aniso = pipe.maxAniso;
  const root = new THREE.Group(); root.name = 'fury';

  // ------------------------------------------------------------ fuselage: chined nose, canted flanks, round tail
  const fus = loft([
    { s: 0.00, y: CH, w: 0.004, ht: 0.004, hb: 0.003, nt: 1.30, nb: 1.2 },
    { s: 0.25, y: CH, w: 0.070, ht: 0.095, hb: 0.022, nt: 1.34, nb: 1.2 },
    { s: 0.50, y: CH, w: 0.136, ht: 0.182, hb: 0.040, nt: 1.38, nb: 1.2 },
    { s: 1.00, y: CH, w: 0.262, ht: 0.352, hb: 0.070, nt: 1.44, nb: 1.2 },
    { s: 1.50, y: CH, w: 0.378, ht: 0.506, hb: 0.095, nt: 1.50, nb: 1.25 },
    { s: 2.00, y: CH, w: 0.482, ht: 0.632, hb: 0.100, nt: 1.55, nb: 1.3 },
    { s: 2.60, y: CH, w: 0.578, ht: 0.722, hb: 0.086, nt: 1.60, nb: 1.3 },
    { s: 3.50, y: CH, w: 0.672, ht: 0.766, hb: 0.080, nt: 1.62, nb: 1.35 },
    { s: 4.40, y: CH, w: 0.715, ht: 0.772, hb: 0.080, nt: 1.62, nb: 1.4 },
    { s: 6.00, y: CH, w: 0.715, ht: 0.772, hb: 0.140, nt: 1.64, nb: 1.5 },
    { s: 7.20, y: CH + 0.01, w: 0.690, ht: 0.762, hb: 0.400, nt: 1.68, nb: 1.62 },
    { s: 8.20, y: CH + 0.045, w: 0.598, ht: 0.690, hb: 0.395, nt: 1.78, nb: 1.76 },
    { s: 9.00, y: CH + 0.105, w: 0.452, ht: 0.505, hb: 0.350, nt: 1.92, nb: 1.9 },
    { s: 9.55, y: CH + 0.142, w: 0.340, ht: 0.372, hb: 0.305, nt: 2, nb: 2 },
    { s: 9.86, y: CH + 0.15, w: 0.300, ht: 0.300, hb: 0.300, nt: 2, nb: 2 },
  ], { nS: 230, nT: 120, x0: X0 });
  const FL = fus.L, W = 4096, H = 1024, U = s => s / FL;
  const deckY = s => fus.f.y(s) + fus.f.ht(s);

  const sk = new Skin(W, H, { base: LOW, rough: 0.60, metal: 0, seed: 44 });
  const r = sk.rand, a = sk.a;
  // darker upper colour: stepped, chamfered demarcation (same pattern both sides)
  const steps = [[2.70, 0], [2.80, 0.108], [3.42, 0.108], [3.54, 0.072], [4.24, 0.072], [4.42, 0.128], [4.94, 0.128], [5.10, 0.176], [6.24, 0.176], [6.42, 0.120], [7.56, 0.120], [7.72, 0.078], [8.06, 0.078], [8.24, 0]];
  const splinter = ctx => { for (const side of [0, 1]) { ctx.beginPath(); ctx.moveTo(U(steps[0][0]) * W, side ? H : 0); for (const [s, d] of steps) ctx.lineTo(U(s) * W, (side ? 1 - d : d) * H); ctx.closePath(); ctx.fill(); } };
  a.fillStyle = UP; splinter(a); sk.r.fillStyle = Skin.orm(0.56, 0); splinter(sk.r);
  // radome: a slightly cooler, smoother grey
  a.fillStyle = 'rgba(96,104,114,0.30)'; a.fillRect(0, 0, U(1.74) * W, H); sk.r.fillStyle = Skin.orm(0.5, 0); sk.r.fillRect(0, 0, U(1.74) * W, H);
  // panel-to-panel tone
  const frames = [0, 0.62, 1.74, 2.70, 3.50, 4.40, 5.20, 6.00, 6.86, 7.60, 8.30, 9.00, 9.55, FL].map(U);
  const longs = [0, 0.045, 0.125, 0.205, 0.25, 0.31, 0.42, 0.5, 0.58, 0.69, 0.75, 0.795, 0.875, 0.955, 1];
  for (let i = 0; i < frames.length - 1; i++) for (let j = 0; j < longs.length - 1; j++) {
    const dv = (r() - 0.5) * 0.034; a.fillStyle = dv >= 0 ? `rgba(255,255,255,${dv})` : `rgba(0,0,0,${-dv})`;
    a.fillRect(frames[i] * W, longs[j] * H, (frames[i + 1] - frames[i]) * W, (longs[j + 1] - longs[j]) * H);
  }
  // exhaust shroud: heat-stained bare metal
  a.fillStyle = 'rgba(46,42,40,0.72)'; a.fillRect(U(9.58) * W, 0, W, H); sk.r.fillStyle = Skin.orm(0.42, 0.85); sk.r.fillRect(U(9.58) * W, 0, W, H);
  for (let i = 0; i < 46; i++) sk.blotch(U(9.2) + r() * (1 - U(9.2)), r(), 0.012 + r() * 0.02, 0.04 + r() * 0.08, '26,22,20', 0.09);
  for (const fu of frames.slice(1, -1)) sk.seam([[fu, 0], [fu, 1]], { width: 1.4, dark: 0.36, cut: 0.4 });
  for (const lv of longs.slice(1, -1)) sk.seam([[U(0.62), lv], [U(9.58), lv]], { width: 1.2, dark: lv === 0.25 || lv === 0.75 ? 0.5 : 0.28, cut: 0.3 });
  sk.seam([[U(1.74), 0], [U(1.74), 1]], { width: 2.4, dark: 0.5, cut: 0.6 }); sk.seam([[U(9.58), 0], [U(9.58), 1]], { width: 2.4, dark: 0.6, cut: 0.7 });
  // access panels with fastener rows (deterministic scatter, kept off the markings)
  const panel = (s0, s1, v0, v1, riv = true) => {
    const u0 = U(s0), u1 = U(s1);
    sk.seam([[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]], { width: 1.3, dark: 0.42, cut: 0.4 });
    if (riv) { const e = 0.0035, eu = 0.0011; sk.rivets(u0 + eu, v0 + e, u1 - eu, v0 + e, 13, { r: 1.0, dark: 0.3 }); sk.rivets(u0 + eu, v1 - e, u1 - eu, v1 - e, 13, { r: 1.0, dark: 0.3 }); sk.rivets(u0 + eu, v0 + e, u0 + eu, v1 - e, 13, { r: 1.0, dark: 0.3 }); sk.rivets(u1 - eu, v0 + e, u1 - eu, v1 - e, 13, { r: 1.0, dark: 0.3 }); }
  };
  for (const m of [0, 1]) { const V = v => m ? 1 - v : v, P = (s0, s1, v0, v1, rv) => panel(s0, s1, Math.min(V(v0), V(v1)), Math.max(V(v0), V(v1)), rv);
    P(1.95, 2.55, 0.06, 0.145); P(3.62, 4.30, 0.145, 0.235); P(4.52, 5.12, 0.02, 0.10); P(5.3, 5.9, 0.19, 0.24, false); P(6.5, 7.4, 0.14, 0.215); P(7.75, 8.2, 0.10, 0.20);
    P(8.4, 8.95, 0.05, 0.16); P(6.3, 7.3, 0.34, 0.43); P(7.5, 8.2, 0.33, 0.44); P(8.35, 9.0, 0.30, 0.45, false); P(9.05, 9.5, 0.08, 0.2);
    // dark window / antenna patch, slot, exhaust port, vents
    a.fillStyle = '#2b2f33'; a.beginPath(); for (const [s, v] of [[2.66, 0.205], [2.74, 0.165], [2.92, 0.165], [2.84, 0.205]]) a.lineTo(U(s) * W, V(v) * H); a.closePath(); a.fill();
    a.fillStyle = '#202326'; a.fillRect(U(2.10) * W, (V(0.228) - 0.004) * H, (U(2.44) - U(2.10)) * W, 0.008 * H);
    a.beginPath(); for (let k = 0; k < 6; k++) { const an = k / 6 * 6.2832; a.lineTo((U(8.91) + Math.cos(an) * 0.0115) * W, (V(0.19) + Math.sin(an) * 0.020) * H); } a.closePath(); a.fill();
    // gill vents: three pale slanted slots forward, four on a dark-outlined panel aft
    a.fillStyle = '#c9ccce'; for (let k = 0; k < 3; k++) { a.beginPath(); const s0 = 4.56 + k * 0.06; for (const [ds, dv] of [[0, 0.018], [0.035, -0.018], [0.058, -0.018], [0.023, 0.018]]) a.lineTo(U(s0 + ds) * W, (V(0.158) + (m ? -dv : dv)) * H); a.closePath(); a.fill(); }
    a.strokeStyle = '#2b2f33'; a.lineWidth = 3; a.strokeRect(U(7.62) * W, Math.min(V(0.268), V(0.305)) * H, (U(8.28) - U(7.62)) * W, 0.037 * H);
    for (let k = 0; k < 4; k++) { a.beginPath(); const s0 = 7.84 + k * 0.06; for (const [ds, dv] of [[0, 0.012], [0.03, -0.012], [0.05, -0.012], [0.02, 0.012]]) a.lineTo(U(s0 + ds) * W, (V(0.2865) + (m ? -dv : dv)) * H); a.closePath(); a.fill(); }
    // greeked stencil lines aft of the designation and beside doors
    a.fillStyle = 'rgba(215,220,224,0.75)'; for (let k = 0; k < 3; k++) a.fillRect(U(6.12) * W, (V(0.118 + k * 0.012) - 0.0022) * H, (U(6.12 + 0.2 - k * 0.04) - U(6.12)) * W, 0.0044 * H);
    a.fillStyle = 'rgba(40,44,48,0.7)'; for (const [s, v, l] of [[3.64, 0.150, 0.16], [6.52, 0.146, 0.2], [7.52, 0.335, 0.14], [1.97, 0.066, 0.12]]) for (let k = 0; k < 2; k++) a.fillRect(U(s) * W, (V(v + k * 0.007) - 0.0016) * H, (U(s + l * (1 - k * 0.3)) - U(s)) * W, 0.0032 * H);
  }
  // nose-gear and keel doors on the belly centreline, drains
  panel(2.2, 2.6, 0.47, 0.53, false);
  for (let i = 0; i < 26; i++) { const pu = U(6.4 + r() * 3), pv = 0.36 + r() * 0.28; a.fillStyle = 'rgba(20,18,16,0.35)'; a.fillRect(pu * W, pv * H, (0.004 + r() * 0.012) * W, 2 + r() * 3); }
  sk.streaks(190, { y0: 0.27, y1: 0.73, len: [0.02, 0.14], alpha: 0.055 });
  sk.streaks(140, { len: [0.01, 0.08], alpha: 0.03 });
  sk.streaks(80, { len: [0.01, 0.06], alpha: 0.028, dark: false });
  for (let i = 0; i < 30; i++) sk.blotch(r(), r(), 0.01 + r() * 0.03, 0.02 + r() * 0.05, r() < 0.5 ? '20,20,22' : '235,238,240', 0.035);
  sk.waviness(22, 6, 0.03);
  const ft = sk.textures(aniso, 1.7);
  const skinMat = new THREE.MeshStandardMaterial({ map: ft.map, roughnessMap: ft.orm, metalnessMap: ft.orm, normalMap: ft.normalMap, roughness: 1, metalness: 1, envMapIntensity: 1.0 });
  skinMat.normalScale.set(0.5, 0.5);
  addTo(root, fus.geometry, skinMat, { name: 'fuselage' });

  // markings: conforming decals sized in metres on the surface. vc = position around the section (starboard value)
  const vSpan = (sMid, vc, hM) => { // v-range whose arc length is hM, centred on vc
    const u = U(sMid), dv = 0.002; let lo = vc, hi = vc, acc = 0; let pa = fus.surf(u, vc).p, pb = pa.clone();
    while (acc < hM && hi - lo < 0.3) { const na = fus.surf(u, lo - dv).p, nb = fus.surf(u, hi + dv).p; acc += na.distanceTo(pa) + nb.distanceTo(pb); pa = na; pb = nb; lo -= dv; hi += dv; }
    return [lo, hi];
  };
  const place = (s0, s1, vc, hM, tex, opt = {}, sides = [0, 1]) => {
    const [v0, v1] = vSpan((s0 + s1) / 2, vc, hM);
    for (const k of sides) addTo(root, loftDecal(fus, U(s0), U(s1), k ? 1 - v1 : v0, k ? 1 - v0 : v1, opt), decalMat(tex, { roughness: 0.55 }), { cast: false });
  };
  // text fitted to the canvas: cap height = 60 % of the canvas height, stretched to the full width
  const textTex = (txt, color, cw = 2048, chh = 256, weight = 700) => decalTex(cw, chh, (g, w, h) => {
    g.fillStyle = color; g.textBaseline = 'alphabetic'; g.font = `${weight} ${Math.round(h * 0.857)}px ${FONT}`;
    const m = g.measureText(txt), pad = h * 0.08; g.save(); g.translate(pad, h * 0.80); g.scale((w - 2 * pad) / m.width, 1); g.fillText(txt, 0, 0); g.restore();
  }, aniso);
  place(5.27, 6.05, 0.136, 0.165 / 0.6, textTex('YFQ-44A', '#e9ecee'), { nu: 30, nv: 6 });
  place(3.07, 3.50, 0.214, 0.068 / 0.6, textTex('ANDURIL', '#dfe2e4', 1024, 128), { nu: 14, nv: 3 });
  const tMark = decalTex(128, 128, (g) => { g.strokeStyle = '#dfe2e4'; g.lineWidth = 11; g.lineJoin = 'miter'; g.beginPath(); g.moveTo(14, 108); g.lineTo(64, 22); g.lineTo(114, 108); g.moveTo(42, 108); g.lineTo(64, 70); g.lineTo(86, 108); g.stroke(); }, aniso);
  place(2.95, 3.045, 0.214, 0.095, tMark, { nu: 4, nv: 3 });
  const tSym = decalTex(256, 256, (g) => usafSymbol(g, 128, 128, 236, '#dadde0'), aniso);
  place(7.06, 7.30, 0.158, 0.24, tSym, { nu: 10, nv: 8 });
  place(6.28, 7.20, 0.322, 0.075 / 0.6, textTex('U.S. AIR FORCE', '#cdd1d4', 2048, 160), { nu: 18, nv: 3 });
  const tTri = decalTex(128, 128, (g) => { g.strokeStyle = '#d9dcde'; g.lineWidth = 9; g.lineJoin = 'miter'; g.beginPath(); g.moveTo(16, 22); g.lineTo(112, 22); g.lineTo(64, 108); g.closePath(); g.stroke(); }, aniso);
  place(9.40, 9.55, 0.205, 0.15, tTri, { nu: 4, nv: 4 });
  const tTriY = decalTex(128, 128, (g) => { g.fillStyle = '#e9bf1c'; g.strokeStyle = '#141414'; g.lineWidth = 8; g.beginPath(); g.moveTo(14, 20); g.lineTo(114, 20); g.lineTo(64, 110); g.closePath(); g.fill(); g.stroke(); }, aniso);
  place(1.84, 1.95, 0.205, 0.11, tTriY, { nu: 4, nv: 4 });

  // ------------------------------------------------------------ dorsal spine, forward fairing, antennas, probes
  const paintUp = new THREE.MeshStandardMaterial({ color: UP, roughness: 0.56, metalness: 0 });
  const paintLow = new THREE.MeshStandardMaterial({ color: LOW, roughness: 0.60, metalness: 0 });
  const paintDark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.5, metalness: 0.1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.45, metalness: 0.2 });
  { const st = []; for (const [s, w, h] of [[3.05, 0.01, 0.0], [3.35, 0.10, 0.07], [4.2, 0.15, 0.095], [6.4, 0.17, 0.10], [7.6, 0.16, 0.10], [8.1, 0.10, 0.09], [8.45, 0.03, 0.04]]) st.push({ s, y: deckY(s) - 0.035, w, ht: h + 0.035, hb: 0.03, nt: 2.6, nb: 2 });
    addTo(root, loft(st, { nS: 60, nT: 28, x0: X0 }).geometry, paintUp, { name: 'spine' }); }
  { const st = []; for (const [s, w, h] of [[1.72, 0.004, 0.0], [1.84, 0.075, 0.075], [2.02, 0.105, 0.10], [2.3, 0.095, 0.075], [2.62, 0.04, 0.02], [2.74, 0.004, 0.0]]) st.push({ s, y: deckY(s) - 0.03, w, ht: h + 0.03, hb: 0.03, nt: 1.7, nb: 2 });
    addTo(root, loft(st, { nS: 40, nT: 24, x0: X0 }).geometry, paintLow, { name: 'blister' }); }
  const blade = (s, y, h, c, sweep = 0.1, th = 0.008, up = 1) => { const o = [[c * 0.5, 0, 0], [-c * 0.5, 0, 0], [-c * 0.5 - sweep * 0.6, h * up, 0], [-c * 0.5 - sweep * 0.6 + c * 0.42, h * up, 0]].map(p => [p[0] + X(s), p[1] + y, p[2]]); addTo(root, plate(o, [0, 0, 1], th), black); };
  blade(7.02, deckY(7.02) + 0.085, 0.2, 0.2, 0.16, 0.012);
  for (const s of [3.62, 4.02, 4.42]) blade(s, deckY(s) + 0.085, 0.045, 0.07, 0.02, 0.006);
  blade(8.62, fus.f.y(8.62) - fus.f.hb(8.62) + 0.01, 0.2, 0.2, 0.14, 0.014, -1);
  for (const sgn of [1, -1]) { // air-data probes on the nose flank and on the inlet side
    const p = fus.surf(U(1.46), sgn > 0 ? 0.11 : 0.89); addTo(root, rod([p.p.x, p.p.y, p.p.z], [p.p.x + 0.13, p.p.y + 0.012, p.p.z + sgn * 0.035], 0.006, 6, 0.004), new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.35, metalness: 0.8 }));
    addTo(root, mergeGeos([rod([X(3.72), -0.41, sgn * 0.525], [X(3.72), -0.41, sgn * 0.575], 0.007, 6), rod([X(3.72), -0.41, sgn * 0.575], [X(3.60), -0.41, sgn * 0.578], 0.006, 6, 0.004)]), black);
    addTo(root, mergeGeos([rod([X(4.28), -0.56, sgn * 0.49], [X(4.28), -0.60, sgn * 0.52], 0.006, 6), rod([X(4.28), -0.60, sgn * 0.52], [X(4.20), -0.60, sgn * 0.523], 0.005, 6, 0.003)]), black);
  }

  // ------------------------------------------------------------ ventral inlet and keel box (faceted)
  const boxRing = (s, yb, wt, wb, sTop = s) => { const yt = CH - 0.083, c = 0.06;
    return [[X(sTop), yt, wt], [X(lerpN(sTop, s, 0.75)), yb + c, wb + 0.045], [X(s), yb, wb], [X(s), yb, -wb], [X(lerpN(sTop, s, 0.75)), yb + c, -wb - 0.045], [X(sTop), yt, -wt]]; };
  const lerpN = (p, q, t) => p + (q - p) * t;
  const boxSt = [[2.98, CH - 0.255, 0.470, 0.345, 2.63], [3.25, CH - 0.33, 0.490, 0.360, 3.0], [3.7, CH - 0.415, 0.505, 0.375], [4.5, CH - 0.46, 0.515, 0.385], [6.0, CH - 0.46, 0.515, 0.385], [6.7, CH - 0.44, 0.50, 0.37], [7.25, CH - 0.39, 0.46, 0.33], [7.7, CH - 0.30, 0.40, 0.26]];
  const boxRings = boxSt.map(q => boxRing(q[0], q[1], q[2], q[3], q[4] ?? q[0]));
  const bsk = new Skin(2048, 512, { base: LOW, rough: 0.60, metal: 0, seed: 71 });
  { const bu = s => (s - 2.98) / (7.7 - 2.98), rr = bsk.rand;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 5; j++) { const dv = (rr() - 0.5) * 0.034; bsk.a.fillStyle = dv >= 0 ? `rgba(255,255,255,${dv})` : `rgba(0,0,0,${-dv})`; bsk.a.fillRect(i * 204.8, j * 102.4, 204.8, 102.4); }
    for (const s of [3.25, 3.7, 4.5, 5.2, 6.0, 6.7]) bsk.seam([[bu(s), 0], [bu(s), 1]], { width: 1.4, dark: 0.36, cut: 0.4 });
    // main-gear doors on the side walls, nose-gear doors and a centreline seam on the belly
    for (const [v0, v1] of [[0.03, 0.27], [0.73, 0.97]]) { bsk.seam([[bu(5.12), v0], [bu(6.42), v0], [bu(6.42), v1], [bu(5.12), v1], [bu(5.12), v0]], { width: 2.2, dark: 0.6, cut: 0.7 }); bsk.rivets(bu(5.16), v0 + 0.02, bu(6.38), v0 + 0.02, 12); }
    bsk.seam([[bu(3.05), 0.5], [bu(7.6), 0.5]], { width: 1.6, dark: 0.45, cut: 0.5 });
    bsk.seam([[bu(3.12), 0.40], [bu(4.12), 0.40], [bu(4.12), 0.60], [bu(3.12), 0.60], [bu(3.12), 0.40]], { width: 2.2, dark: 0.6, cut: 0.7 });
    bsk.streaks(120, { len: [0.02, 0.2], alpha: 0.06 }); bsk.streaks(40, { y0: 0.3, y1: 0.7, len: [0.05, 0.3], alpha: 0.08 });
  }
  const bt = bsk.textures(aniso, 1.7, false);
  const boxMat = new THREE.MeshStandardMaterial({ map: bt.map, roughnessMap: bt.orm, metalnessMap: bt.orm, normalMap: bt.normalMap, roughness: 1, metalness: 1 });
  boxMat.normalScale.set(0.5, 0.5);
  addTo(root, ringLoft(boxRings, { us: boxSt.map(q => (q[0] - 2.98) / (7.7 - 2.98)) }), boxMat, { name: 'inletBox' });
  // duct: dark throat running aft from the lip, a splitter plate above it and a rounded lip edge
  const ductMat = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.75, metalness: 0.3, side: THREE.DoubleSide });
  { const inset = (ring, d) => { let cy = 0; for (const p of ring) cy += p[1]; cy /= ring.length; return ring.map(p => [p[0], p[1] + (cy - p[1]) * d * 2.2, p[2] * (1 - d * 1.4)]); };
    const r0 = inset(boxRings[0], 0.045), r1 = inset(boxRings[1], 0.07), r2 = inset(boxRings[2], 0.16).map(p => [p[0] - 0.2, p[1] + 0.03, p[2] * 0.8]), r3 = r2.map(p => [p[0] - 0.9, p[1] + 0.1, p[2] * 0.55]);
    addTo(root, ringLoft([boxRings[0].map(p => [p[0] + 0.003, p[1], p[2]]), r0.map(p => [p[0] - 0.012, p[1], p[2]])]), paintLow, { name: 'lip' });
    addTo(root, ringLoft([r0.map(p => [p[0] - 0.012, p[1], p[2]]), r1, r2, r3]), ductMat, { name: 'duct', cast: false });
    addTo(root, capOf(r3, [1, 0, 0]), ductMat, { cast: false });
    // splitter / diverter plate under the fuselage, ahead of the lip
    const sp = [[X(2.40), CH - 0.088, 0], [X(2.63), CH - 0.088, 0.47], [X(3.3), CH - 0.088, 0.50], [X(3.3), CH - 0.088, -0.50], [X(2.63), CH - 0.088, -0.47]];
    addTo(root, plate(sp, [0, 1, 0], 0.012), paintLow, { name: 'splitter' });
  }

  // ------------------------------------------------------------ wings
  const wsec = [
    { z: WING.z0, le: X(WING.le0), te: X(WING.te0), y: CH, t: 0.052 },
    { z: WING.z1 - 0.07, le: X(lerpN(WING.le0, WING.le1, 0.974)), te: X(lerpN(WING.te0, WING.te1, 0.974)), y: CH, t: 0.046 },
    { z: WING.z1, le: X(WING.le1 + 0.09), te: X(WING.te1 - 0.02), y: CH, t: 0.03 },
  ];
  const wg = wing(wsec, { nC: 26, nSpan: 14 });
  const pf = wg.userData.planform;
  const WS = 2048, wsk = new Skin(WS, WS, { base: LOW, rough: 0.60, metal: 0, seed: 91 });
  const WU = x => (pf.xmax - x) / (pf.xmax - pf.xmin), WV = (z, lower) => (lower ? 0.5 : 0) + 0.5 * (z - pf.zmin) / (pf.zmax - pf.zmin);
  const leAt = z => X(lerpN(WING.le0, WING.le1, (z - WING.z0) / (WING.z1 - WING.z0))), teAt = z => X(lerpN(WING.te0, WING.te1, (z - WING.z0) / (WING.z1 - WING.z0)));
  const chordPt = (z, c, lower) => [WU(leAt(z) + (teAt(z) - leAt(z)) * c), WV(z, lower)];
  const wpoly = (ctx, pts, lower) => { ctx.beginPath(); for (const [z, c] of pts) { const p = chordPt(z, c, lower); ctx.lineTo(p[0] * WS, p[1] * WS); } ctx.closePath(); ctx.fill(); };
  for (let lower = 0; lower < 2; lower++) {
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) { const dv = (wsk.rand() - 0.5) * 0.036; wsk.a.fillStyle = dv >= 0 ? `rgba(255,255,255,${dv})` : `rgba(0,0,0,${-dv})`; wpoly(wsk.a, [[0.6 + i * 0.54, [0, 0.15, 0.4, 0.7][j]], [0.6 + (i + 1) * 0.54, [0, 0.15, 0.4, 0.7][j]], [0.6 + (i + 1) * 0.54, [0.15, 0.4, 0.7, 1][j]], [0.6 + i * 0.54, [0.15, 0.4, 0.7, 1][j]]], lower); }
    if (!lower) { // darker angular patch on the upper surface, and the walk strip at the root
      wsk.a.fillStyle = UP; wpoly(wsk.a, [[1.02, 0.30], [1.30, 0.20], [2.30, 0.20], [2.72, 0.36], [2.30, 0.50], [1.75, 0.50], [1.58, 0.62], [1.20, 0.62]], 0);
      wsk.r.fillStyle = Skin.orm(0.56, 0); wpoly(wsk.r, [[1.02, 0.30], [1.30, 0.20], [2.30, 0.20], [2.72, 0.36], [2.30, 0.50], [1.75, 0.50], [1.58, 0.62], [1.20, 0.62]], 0);
    }
    // edge treatment: darker tip and trailing-edge strips
    wsk.a.fillStyle = 'rgba(52,56,61,0.92)'; wpoly(wsk.a, [[3.19, -0.1], [3.4, -0.1], [3.4, 1.1], [3.19, 1.1]], lower);
    wsk.a.fillStyle = 'rgba(60,64,70,0.55)'; wpoly(wsk.a, [[0.6, 0.955], [3.19, 0.955], [3.19, 1.02], [0.6, 1.02]], lower);
    wsk.a.fillStyle = 'rgba(60,64,70,0.4)'; wpoly(wsk.a, [[0.6, -0.02], [3.19, -0.02], [3.19, 0.022], [0.6, 0.022]], lower);
    for (const z of [0.95, 1.45, 1.85, 2.40, 2.95]) wsk.seam([chordPt(z, 0, lower), chordPt(z, z === 0.95 || z === 2.95 ? 1 : 0.7, lower)], { width: 1.3, dark: 0.32, cut: 0.35 });
    for (const c of [0.15, 0.40]) wsk.seam([chordPt(0.6, c, lower), chordPt(3.19, c, lower)], { width: 1.3, dark: 0.3, cut: 0.3 });
    // flaperon: hinge line and end cuts
    wsk.seam([chordPt(0.95, 0.70, lower), chordPt(2.95, 0.70, lower)], { width: 3.0, dark: 0.75, cut: 0.85 });
    for (const z of [0.95, 2.95]) wsk.seam([chordPt(z, 0.70, lower), chordPt(z, 1.0, lower)], { width: 3.0, dark: 0.75, cut: 0.85 });
    for (const z of [1.3, 1.95, 2.6]) { const p = chordPt(z, 0.69, lower); wsk.a.fillStyle = 'rgba(20,22,24,0.6)'; wsk.a.fillRect(p[0] * WS - 16, p[1] * WS - 3, 32, 6); }
    for (const z of [0.95, 1.45, 2.40]) { const p0 = chordPt(z + 0.012, 0.03, lower), p1 = chordPt(z + 0.012, 0.68, lower); wsk.rivets(p0[0], p0[1], p1[0], p1[1], 12, { r: 1.0, dark: 0.28 }); }
    if (lower) { const q0 = chordPt(RAIL_Z - 0.09, 0.36, 1), q1 = chordPt(RAIL_Z + 0.09, 0.80, 1); wsk.seam([[q0[0], q0[1]], [q1[0], q0[1]], [q1[0], q1[1]], [q0[0], q1[1]], [q0[0], q0[1]]], { width: 1.6, dark: 0.5, cut: 0.5 }); }
    wsk.streaks(80, { y0: WV(0.6, lower), y1: WV(3.3, lower), len: [0.03, 0.22], alpha: lower ? 0.06 : 0.032 });
  }
  wsk.waviness(10, 16, 0.025);
  const wt = wsk.textures(aniso, 1.7, false);
  const wingMat = new THREE.MeshStandardMaterial({ map: wt.map, roughnessMap: wt.orm, metalnessMap: wt.orm, normalMap: wt.normalMap, roughness: 1, metalness: 1 });
  wingMat.normalScale.set(0.45, 0.45);
  addTo(root, wg, wingMat, { name: 'wingR' });
  addTo(root, wg, wingMat, { name: 'wingL', scale: [1, 1, -1] });
  // position lights at the tip leading corners
  const lens = (col) => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, emissive: new THREE.Color(...col), emissiveIntensity: 2.2 });
  const navPos = [];
  for (const sgn of [1, -1]) { const m = addTo(root, new THREE.SphereGeometry(0.022, 10, 8), lens(sgn > 0 ? [0.05, 1.0, 0.25] : [1.0, 0.05, 0.03]), { pos: [X(WING.le1 + 0.16), CH + 0.005, sgn * (WING.z1 - 0.012)], cast: false }); m.scale.set(1.8, 0.8, 0.8); navPos.push(m.position.clone()); }

  // ------------------------------------------------------------ stabilators (all-moving, low on the aft body)
  const SY = CH - 0.115;
  const ssec = [
    { z: 0.20, le: X(7.87), te: X(9.42), y: SY, t: 0.05 },
    { z: 1.78, le: X(8.96), te: X(9.80), y: SY, t: 0.042 },
    { z: 1.84, le: X(9.06), te: X(9.79), y: SY, t: 0.028 },
  ];
  const sg = wing(ssec, { nC: 18, nSpan: 8 });
  const sp2 = sg.userData.planform, SS = 1024, ssk = new Skin(SS, SS, { base: LOW, rough: 0.60, metal: 0, seed: 17 });
  const SU = x => (sp2.xmax - x) / (sp2.xmax - sp2.xmin), SV = (z, lower) => (lower ? 0.5 : 0) + 0.5 * (z - sp2.zmin) / (sp2.zmax - sp2.zmin);
  const sle = z => X(lerpN(7.87, 8.96, (z - 0.20) / 1.58)), ste = z => X(lerpN(9.42, 9.80, (z - 0.20) / 1.58));
  const sPt = (z, c, lower) => [SU(sle(z) + (ste(z) - sle(z)) * c), SV(z, lower)];
  const spoly = (ctx, pts, lower) => { ctx.beginPath(); for (const [z, c] of pts) { const p = sPt(z, c, lower); ctx.lineTo(p[0] * SS, p[1] * SS); } ctx.closePath(); ctx.fill(); };
  for (let lower = 0; lower < 2; lower++) {
    if (!lower) { ssk.a.fillStyle = UP; spoly(ssk.a, [[0.62, 0.34], [0.86, 0.22], [1.36, 0.22], [1.52, 0.42], [1.10, 0.66], [0.62, 0.66]], 0); }
    ssk.a.fillStyle = 'rgba(52,56,61,0.9)'; spoly(ssk.a, [[1.72, -0.1], [1.9, -0.1], [1.9, 1.1], [1.72, 1.1]], lower);
    for (const z of [0.6, 1.0, 1.4]) ssk.seam([sPt(z, 0, lower), sPt(z, 1, lower)], { width: 1.2, dark: 0.3, cut: 0.3 });
    for (const c of [0.2, 0.55]) ssk.seam([sPt(0.2, c, lower), sPt(1.72, c, lower)], { width: 1.2, dark: 0.3, cut: 0.3 });
    ssk.streaks(40, { y0: SV(0.2, lower), y1: SV(1.84, lower), len: [0.04, 0.3], alpha: 0.05 });
  }
  const st = ssk.textures(aniso, 1.6, false);
  const stabMat = new THREE.MeshStandardMaterial({ map: st.map, roughnessMap: st.orm, metalnessMap: st.orm, normalMap: st.normalMap, roughness: 1, metalness: 1 });
  addTo(root, sg, stabMat, { name: 'stabR' });
  addTo(root, sg, stabMat, { name: 'stabL', scale: [1, 1, -1] });
  for (const sgn of [1, -1]) addTo(root, rod([X(8.9), SY, sgn * 0.2], [X(8.9), SY, sgn * 0.5], 0.05, 10), paintDark);      // pivot fairing

  // ------------------------------------------------------------ fin
  const FB = 0.30, FT = 1.84, fLE = y => 8.08 + (y - 0.53) * 0.90, fTE = y => 9.46 + (y - 0.53) * 0.308;
  const fsec = [
    { z: FB, le: X(fLE(FB)), te: X(fTE(FB)), t: 0.055 },
    { z: FT - 0.05, le: X(fLE(FT - 0.05)), te: X(fTE(FT - 0.05)), t: 0.046 },
    { z: FT, le: X(fLE(FT) + 0.05), te: X(fTE(FT) - 0.01), t: 0.03 },
  ];
  const fg = wing(fsec, { nC: 22, nSpan: 12 });
  const fp = fg.userData.planform;
  fg.rotateX(-Math.PI / 2);          // span -> up; the wing's "upper" surface becomes the port side
  const FS = 2048, fsk = new Skin(1024, FS, { base: LOW, rough: 0.60, metal: 0, seed: 314 });
  const FU = x => (fp.xmax - x) / (fp.xmax - fp.xmin), FV = (z, lower) => (lower ? 0.5 : 0) + 0.5 * (z - fp.zmin) / (fp.zmax - fp.zmin);
  const fPt = (y, c, lower) => [FU(X(fLE(y) + (fTE(y) - fLE(y)) * c)), FV(y, lower)];
  const fpoly = (ctx, pts, lower) => { ctx.beginPath(); for (const [y, c] of pts) { const p = fPt(y, c, lower); ctx.lineTo(p[0] * 1024, p[1] * FS); } ctx.closePath(); ctx.fill(); };
  for (let lower = 0; lower < 2; lower++) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const dv = (fsk.rand() - 0.5) * 0.034; fsk.a.fillStyle = dv >= 0 ? `rgba(255,255,255,${dv})` : `rgba(0,0,0,${-dv})`; fpoly(fsk.a, [[0.3 + i * 0.385, j / 3], [0.3 + (i + 1) * 0.385, j / 3], [0.3 + (i + 1) * 0.385, (j + 1) / 3], [0.3 + i * 0.385, (j + 1) / 3]], lower); }
    fsk.a.fillStyle = 'rgba(58,62,68,0.92)'; fpoly(fsk.a, [[0.3, -0.05], [1.9, -0.05], [1.9, 0.085], [0.3, 0.06]], lower);         // leading-edge strip
    fsk.a.fillStyle = 'rgba(58,62,68,0.9)'; fpoly(fsk.a, [[1.765, -0.1], [1.9, -0.1], [1.9, 1.1], [1.765, 1.1]], lower);           // tip cap
    for (const y of [0.62, 0.98, 1.36, 1.765]) fsk.seam([fPt(y, 0, lower), fPt(y, 1, lower)], { width: 1.2, dark: 0.3, cut: 0.3 });
    fsk.seam([fPt(0.56, 0.40, lower), fPt(1.765, 0.40, lower)], { width: 1.2, dark: 0.28, cut: 0.3 });
    fsk.seam([fPt(0.56, 0.70, lower), fPt(1.765, 0.70, lower)], { width: 3.0, dark: 0.75, cut: 0.85 });                              // rudder hinge
    { const p0 = fPt(0.58, 0.685, lower), p1 = fPt(1.75, 0.685, lower); fsk.rivets(p0[0], p0[1], p1[0], p1[1], 11, { r: 1.1, dark: 0.3 }); }
    // markings: drawn in centimetres about a point given by (station aft of the nose, height); mirrored on the starboard face
    const draw = (sAft, yc, fn) => {
      const g = fsk.a, pxm = 1024 / (fp.xmax - fp.xmin), pym = (FS / 2) / (fp.zmax - fp.zmin);
      g.save(); g.translate(FU(X(sAft)) * 1024, FV(yc, lower) * FS); g.scale((lower ? -pxm : pxm) / 100, -pym / 100); fn(g); g.restore();
    };
    const ink = '#e6e9eb';
    draw(8.93, 1.05, g => { g.fillStyle = ink; g.font = `700 30px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.scale(1.3, 1); g.fillText('AI', 0, 0); g.restore(); });
    draw(8.84, 0.765, g => { g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 7.4px ${FONT}`; g.fillText('AF', -27.5, -4.1); g.fillText('25', -27.5, 4.0); g.font = `700 18px ${FONT}`; g.save(); g.scale(1.25, 1); g.fillText('1003', 3.4, 0.5); g.restore(); });
    draw(9.17, 1.42, g => { g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-8, 10); g.lineTo(8, 10); g.lineTo(8, -2); g.quadraticCurveTo(8, -9, 0, -12); g.quadraticCurveTo(-8, -9, -8, -2); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(-5.2, 6); g.lineTo(0, -5.5); g.lineTo(5.2, 6); g.lineTo(2.9, 6); g.lineTo(0, -0.6); g.lineTo(-2.9, 6); g.closePath(); g.fill(); });
  }
  fsk.waviness(6, 14, 0.02);
  const fnt = fsk.textures(aniso, 1.6, false);
  const finMat = new THREE.MeshStandardMaterial({ map: fnt.map, roughnessMap: fnt.orm, metalnessMap: fnt.orm, normalMap: fnt.normalMap, roughness: 1, metalness: 1 });
  finMat.normalScale.set(0.45, 0.45);
  addTo(root, fg, finMat, { name: 'fin' });
  const tailLight = addTo(root, new THREE.SphereGeometry(0.02, 8, 6), lens([1, 0.95, 0.85]), { pos: [X(fTE(1.70)) - 0.012, 1.70, 0], cast: false });

  // ------------------------------------------------------------ exhaust: shroud lip, convergent duct, turbine cone
  const NY = FURY.nozzleY;
  const hot = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.38, metalness: 0.9, side: THREE.DoubleSide });
  const soot = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.85, metalness: 0.5, side: THREE.DoubleSide });
  const lathe = (pts, seg = 56) => { const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1] - X0)), seg); g.rotateZ(Math.PI / 2); return g; };
  addTo(root, lathe([[0.302, 9.80], [0.298, 9.88], [0.283, 9.95], [0.270, 9.97], [0.262, 9.95]]), hot, { pos: [0, NY, 0], name: 'nozzleLip' });
  addTo(root, lathe([[0.262, 9.95], [0.252, 9.80], [0.262, 9.50], [0.285, 9.10], [0.285, 8.70]]), soot, { pos: [0, NY, 0], name: 'tailpipe', cast: false });
  addTo(root, lathe([[0.0, 9.42], [0.05, 9.36], [0.105, 9.16], [0.13, 8.90], [0.285, 8.86]], 28), new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.6, metalness: 0.8, side: THREE.DoubleSide }), { pos: [0, NY, 0], name: 'cone', cast: false });
  { const v = []; for (let k = 0; k < 14; k++) { const an = k / 14 * Math.PI * 2, c = Math.cos(an), sn = Math.sin(an); v.push(mergeGeos([plate([[X(8.9), 0.13 * c, 0.13 * sn], [X(8.9), 0.283 * c, 0.283 * sn], [X(9.0), 0.283 * c, 0.283 * sn], [X(9.02), 0.125 * c, 0.125 * sn]], [0, -sn, c], 0.006)])); }
    addTo(root, mergeGeos(v), new THREE.MeshStandardMaterial({ color: 0x232324, roughness: 0.6, metalness: 0.8, side: THREE.DoubleSide }), { pos: [0, NY, 0], cast: false }); }

  // ------------------------------------------------------------ pylons and rail launchers (both wings)
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.55, metalness: 0.15 });
  const railDark = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.5, metalness: 0.5 });
  const pylTop = CH - 0.03, pylBot = RAIL_Y + 0.055;
  const pyl = wing([{ z: 0, le: X(5.02), te: X(6.60), t: 0.07 }, { z: pylTop - pylBot, le: X(5.18), te: X(6.66), t: 0.07 }], { nC: 12, nSpan: 2, cap: false });
  pyl.rotateX(-Math.PI / 2);            // span -> +y
  const rail = loft([
    { s: RAIL_S0, y: RAIL_Y, w: 0.010, ht: 0.012, hb: 0.014, nt: 3, nb: 3 },
    { s: RAIL_S0 + 0.10, y: RAIL_Y, w: 0.050, ht: 0.048, hb: 0.052, nt: 4, nb: 4 },
    { s: RAIL_S0 + 0.26, y: RAIL_Y, w: 0.058, ht: 0.056, hb: 0.058, nt: 5, nb: 6 },
    { s: RAIL_S1 - 0.2, y: RAIL_Y, w: 0.058, ht: 0.056, hb: 0.058, nt: 5, nb: 6 },
    { s: RAIL_S1 - 0.04, y: RAIL_Y + 0.006, w: 0.05, ht: 0.046, hb: 0.05, nt: 4, nb: 4 },
    { s: RAIL_S1, y: RAIL_Y + 0.01, w: 0.022, ht: 0.02, hb: 0.022, nt: 3, nb: 3 },
  ], { nS: 40, nT: 28, x0: X0 });
  const railTex = canvasTex(2048, 128, (c, w, h) => {
    c.fillStyle = '#8b9197'; c.fillRect(0, 0, w, h); const rr = rng(9);
    for (let i = 0; i < 24; i++) { c.fillStyle = `rgba(${rr() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rr() * 0.04})`; c.fillRect(i * w / 24, 0, w / 24, h); }
    c.fillStyle = '#23262a'; for (const u of [0.12, 0.2, 0.31, 0.44, 0.52, 0.66, 0.78, 0.9]) for (const v of [0.25, 0.75]) { c.beginPath(); c.arc(u * w, v * h, 5, 0, 6.2832); c.fill(); }
    c.fillStyle = 'rgba(25,27,30,0.7)'; for (const u of [0.08, 0.36, 0.6, 0.84]) c.fillRect(u * w, 0, 3, h);
    c.fillRect(0, 0.22 * h - 1, w, 2); c.fillRect(0, 0.78 * h - 1, w, 2);
    c.fillStyle = '#2a2d30'; c.fillRect(0.24 * w, 0.2 * h, 0.04 * w, 0.1 * h); c.fillRect(0.24 * w, 0.7 * h, 0.04 * w, 0.1 * h);
  }, { aniso });
  const railSkin = new THREE.MeshStandardMaterial({ map: railTex, roughness: 0.55, metalness: 0.15 });
  for (const sgn of [1, -1]) {
    addTo(root, pyl, railMat, { pos: [0, pylBot, sgn * RAIL_Z], name: 'pylon' });
    addTo(root, rail.geometry, railSkin, { pos: [0, 0, sgn * RAIL_Z], name: 'rail' });
    // guide channel under the rail, umbilical housing, sway braces
    addTo(root, new THREE.BoxGeometry(RAIL_S1 - RAIL_S0 - 0.5, 0.012, 0.05), railDark, { pos: [X((RAIL_S0 + RAIL_S1) / 2), RAIL_Y - 0.062, sgn * RAIL_Z], cast: false });
    addTo(root, new THREE.BoxGeometry(0.34, 0.05, 0.085), railMat, { pos: [X(4.62), RAIL_Y + 0.07, sgn * RAIL_Z] });
    for (const s of [5.35, 6.2]) addTo(root, new THREE.BoxGeometry(0.09, 0.03, 0.2), railDark, { pos: [X(s), RAIL_Y - 0.03, sgn * RAIL_Z] });
  }

  // ------------------------------------------------------------ landing gear
  const gear = new THREE.Group(); gear.name = 'gear'; root.add(gear);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.92 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xcfd2d4, roughness: 0.45, metalness: 0.55 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0xdadcde, roughness: 0.4, metalness: 0.35 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.12, metalness: 1.0 });
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.9, side: THREE.DoubleSide });
  const putWheel = (x, y, z, r, w) => { const g = new THREE.Group(); g.position.set(x, y, z); const wg2 = wheelGeos(r, w); addTo(g, wg2.tyre, tyreMat); addTo(g, wg2.hub, hubMat); addTo(g, wg2.holes, holeMat, { cast: false }); gear.add(g); return g; };
  const G = (geos, mat) => addTo(gear, geos.length === 1 ? geos[0] : mergeGeos(geos), mat);
  { // nose gear: single wheel in a half-fork, oleo, drag brace, steering collar, taxi light
    const x = X(NOSE_GEAR.s), yA = GROUND + NOSE_GEAR.r, top = CH - 0.46;
    putWheel(x, yA, 0, NOSE_GEAR.r, NOSE_GEAR.w);
    G([rod([x, yA, -0.085], [x, yA, 0.085], 0.02, 10), rod([x, yA, 0.08], [x + 0.025, yA + 0.15, 0.08], 0.021, 10), rod([x + 0.025, yA + 0.15, 0.085], [x + 0.025, yA + 0.19, 0.0], 0.023, 10)], legMat);
    G([rod([x + 0.025, yA + 0.17, 0], [x + 0.025, yA + 0.30, 0], 0.018, 12)], chrome);
    G([rod([x + 0.025, yA + 0.27, 0], [x + 0.025, top + 0.14, 0], 0.034, 14), rod([x + 0.025, yA + 0.265, 0], [x + 0.025, yA + 0.30, 0], 0.046, 14),
      rod([x + 0.025, yA + 0.33, 0], [x + 0.40, top + 0.05, 0], 0.015, 8), rod([x + 0.025, yA + 0.185, 0.03], [x - 0.075, yA + 0.235, 0.03], 0.009, 6), rod([x - 0.075, yA + 0.235, 0.03], [x + 0.025, yA + 0.29, 0.03], 0.009, 6)], legMat);
    addTo(gear, new THREE.CylinderGeometry(0.032, 0.028, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.15, metalness: 0.6 }), { pos: [x + 0.068, yA + 0.33, 0], rot: [0, 0, Math.PI / 2] });
    for (const sgn of [1, -1]) addTo(gear, plate([[X(3.14), top - 0.02, sgn * 0.10], [X(4.10), top - 0.02, sgn * 0.10], [X(4.10), top - 0.27, sgn * 0.17], [X(3.14), top - 0.22, sgn * 0.17]], [0, 0.27, sgn], 0.012), paintLow);
    addTo(gear, new THREE.BoxGeometry(0.97, 0.008, 0.2), holeMat, { pos: [X(3.62), CH - 0.464, 0], cast: false });
  }
  for (const sgn of [1, -1]) { // main gear: trailing-link leg out of the keel box
    const x = X(MAIN_GEAR.s), z = sgn * MAIN_GEAR.z, yA = GROUND + MAIN_GEAR.r, zi = sgn * 0.47, yTop = CH - 0.40;
    putWheel(x, yA, z, MAIN_GEAR.r, MAIN_GEAR.w);
    const pv = [x + 0.36, yA + 0.19, sgn * 0.70];
    G([rod([x, yA, z - sgn * 0.14], [x, yA, z + sgn * 0.02], 0.026, 10), rod([x, yA, z - sgn * 0.13], pv, 0.03, 10),
      rod(pv, [x + 0.30, yTop, zi], 0.042, 14), rod([x + 0.02, yA + 0.05, z - sgn * 0.13], [x + 0.12, yA + 0.36, sgn * 0.62], 0.024, 10),
      rod([x + 0.12, yA + 0.36, sgn * 0.62], [x + 0.2, yTop + 0.02, zi], 0.03, 10), rod(pv, [x + 0.62, yTop + 0.03, zi], 0.018, 8),
      rod([x - 0.01, yA + 0.02, z - sgn * 0.135], [x - 0.01, yA + 0.02, z - sgn * 0.20], 0.085, 16)], legMat);
    G([rod([x + 0.045, yA + 0.13, z - sgn * 0.145], [x + 0.105, yA + 0.31, sgn * 0.635], 0.016, 10)], chrome);
    // door: hinged along the lower edge of the box, hanging open
    addTo(gear, plate([[X(5.14), yTop - 0.05, sgn * 0.44], [X(6.40), yTop - 0.05, sgn * 0.44], [X(6.40), yTop - 0.40, sgn * 0.62], [X(5.14), yTop - 0.40, sgn * 0.62]], [0, 0.45, sgn], 0.014), paintLow);
    addTo(gear, new THREE.BoxGeometry(1.24, 0.3, 0.008), holeMat, { pos: [X(5.77), CH - 0.27, sgn * 0.478], rot: [sgn * 0.26, 0, 0], cast: false });
  }

  root.userData = { gear, navPos, setGear(down) { gear.visible = !!down; } };
  root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return root;
}

// AIM-120 AMRAAM: 3.65 m long, 178 mm body, cruciform mid-body wings and tail fins (hung in an X on the rail).
export function buildAmraam(pipe) {
  const aniso = pipe.maxAniso, g = new THREE.Group(); g.name = 'aim120';
  const Xm = s => MSL_LEN / 2 - s, R = MSL_R;
  const body = loft([
    { s: 0.00, w: 0.002, ht: 0.002, hb: 0.002 }, { s: 0.03, w: 0.014, ht: 0.014, hb: 0.014 }, { s: 0.10, w: 0.032, ht: 0.032, hb: 0.032 }, { s: 0.22, w: 0.054, ht: 0.054, hb: 0.054 },
    { s: 0.36, w: 0.071, ht: 0.071, hb: 0.071 }, { s: 0.50, w: 0.083, ht: 0.083, hb: 0.083 }, { s: 0.62, w: R, ht: R, hb: R },
    { s: 3.585, w: R, ht: R, hb: R }, { s: 3.65, w: 0.080, ht: 0.080, hb: 0.080 },
  ], { nS: 120, nT: 40, x0: MSL_LEN / 2 });
  const tex = canvasTex(4096, 256, (c, w, h) => {
    const rr = rng(120);
    c.fillStyle = '#c6c9cb'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e6de'; c.fillRect(0, 0, 0.170 * w, h);                                   // radome
    c.fillStyle = '#9a9ea2'; c.fillRect(0, 0, 0.010 * w, h);                                   // tip
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(${rr() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rr() * 0.03})`; c.fillRect(0.17 * w + rr() * 0.83 * w, 0, (0.01 + rr() * 0.05) * w, h); }
    // section joints, a brown band at the motor, a dark collar at the wings
    for (const [u, wd, col] of [[0.170, 7, '#3f4347'], [0.262, 4, '#6a6e72'], [0.318, 4, '#6a6e72'], [0.452, 4, '#6a6e72'], [0.470, 22, '#7b5b3c'], [0.585, 4, '#6a6e72'], [0.742, 4, '#6a6e72'], [0.895, 5, '#4a4e52'], [0.982, 6, '#3a3d40']]) { c.fillStyle = col; c.fillRect(u * w, 0, wd, h); }
    c.fillStyle = 'rgba(70,74,79,0.55)'; c.fillRect(0.478 * w, 0, 0.105 * w, h);
    // stencil blocks and fastener rings
    c.fillStyle = '#2b2e31'; for (const [u, v, l] of [[0.20, 0.30, 0.03], [0.20, 0.36, 0.022], [0.335, 0.30, 0.05], [0.335, 0.36, 0.035], [0.62, 0.30, 0.06], [0.62, 0.36, 0.04], [0.62, 0.42, 0.05], [0.80, 0.80, 0.04], [0.335, 0.80, 0.045]]) c.fillRect(u * w, v * h, l * w, 5);
    c.fillStyle = 'rgba(40,42,45,0.6)'; for (const u of [0.176, 0.258, 0.326, 0.448, 0.59, 0.738, 0.90]) for (let k = 0; k < 20; k++) { c.beginPath(); c.arc(u * w, (k + 0.5) / 20 * h, 2.4, 0, 6.2832); c.fill(); }
    const gr = c.createLinearGradient(0.93 * w, 0, w, 0); gr.addColorStop(0, 'rgba(30,26,22,0)'); gr.addColorStop(1, 'rgba(30,26,22,0.5)'); c.fillStyle = gr; c.fillRect(0.93 * w, 0, 0.07 * w, h);
  }, { aniso });
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.05 });
  addTo(g, body.geometry, bodyMat, { name: 'body' });
  const finMat = new THREE.MeshStandardMaterial({ color: 0xaeb2b5, roughness: 0.42, metalness: 0.25, side: THREE.DoubleSide });
  const mid = wing([{ z: R - 0.008, le: Xm(1.62), te: Xm(2.14), t: 0.03 }, { z: 0.262, le: Xm(1.99), te: Xm(2.14), t: 0.028 }], { nC: 8, nSpan: 2, profile: 'lens' });
  const tail = wing([{ z: R - 0.008, le: Xm(3.25), te: Xm(3.60), t: 0.036 }, { z: 0.262, le: Xm(3.47), te: Xm(3.615), t: 0.03 }], { nC: 8, nSpan: 2, profile: 'lens' });
  for (let k = 0; k < 4; k++) { const an = Math.PI / 4 + k * Math.PI / 2; addTo(g, mid, finMat, { rot: [an, 0, 0] }); addTo(g, tail, finMat, { rot: [an, 0, 0] }); }
  // cable raceway along the lower quarter, hangers on top
  const dk = new THREE.MeshStandardMaterial({ color: 0x9da1a4, roughness: 0.45, metalness: 0.2 });
  addTo(g, new THREE.BoxGeometry(1.52, 0.014, 0.034), dk, { pos: [Xm(2.52), -R * 0.74, R * 0.74], rot: [Math.PI / 4, 0, 0], cast: false });
  for (const s of [1.2, 1.9, 2.75]) addTo(g, new THREE.BoxGeometry(0.07, 0.028, 0.05), new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.4, metalness: 0.6 }), { pos: [Xm(s), R + 0.008, 0] });
  // nozzle: throat and exit cone
  const nozMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide, emissive: new THREE.Color(1.0, 0.66, 0.34), emissiveIntensity: 0 });
  const noz = new THREE.LatheGeometry([[0.079, 0.0], [0.066, 0.004], [0.03, 0.09], [0.0, 0.09]].map(p => new THREE.Vector2(p[0], p[1])), 28); noz.rotateZ(-Math.PI / 2);
  addTo(g, noz, nozMat, { pos: [Xm(MSL_LEN) + 0.002, 0, 0], cast: false });
  g.userData = { tailX: Xm(MSL_LEN), noseX: Xm(0), setBurn(k) { nozMat.emissiveIntensity = 60 * k; } };
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}
