// Hermeus Quarterhorse Mk 2.1 (N21QH), modelled from Hermeus press photography: bare-metal tailless delta,
// nose pitot inlet, single F100 with exposed convergent-divergent nozzle, drag-chute boom under the fin.
// Dimensions are estimated from photos against the company's "F-16-scale" description.
import * as THREE from 'three';
import { loft, loftDecal, wing, Skin, decalTex, decalMat, addTo } from '../engine/geo.js';

const X0 = 8.3;                 // nose is X0 metres ahead of the model origin
const X = s => X0 - s;          // body-x of a station s metres aft of the inlet lip
export const QH = { length: 14.6, span: 8.84, groundY: -1.95, nozzleX: X(14.6), nozzleR: 0.47, noseX: X(0) };

function wingLogo(g, x, y, s, color = '#0c0d0e') {
  // Hermeus-style wing: a leading-edge arc with five trailing feathers (root at left, tips trailing right/down)
  g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const y0 = 0.02 + i * 0.165, len = 1.0 - i * 0.15, th = 0.12;
    g.beginPath(); g.moveTo(0.0 + i * 0.045, y0);
    g.bezierCurveTo(0.30, y0 - 0.02, 0.62 * len, y0 + 0.03, len, y0 + 0.24);
    g.bezierCurveTo(0.70 * len, y0 + th + 0.03, 0.34, y0 + th + 0.02, 0.05 + i * 0.045, y0 + th);
    g.closePath(); g.fill();
  }
  g.restore();
}
function horseMark(g, x, y, s, color = '#0c0d0e') {
  g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = color; g.strokeStyle = color; g.lineCap = 'round';
  g.beginPath(); g.moveTo(1.0, 0.42); g.bezierCurveTo(0.82, 0.30, 0.62, 0.30, 0.50, 0.18); g.bezierCurveTo(0.44, 0.10, 0.36, 0.06, 0.30, 0.02);
  g.bezierCurveTo(0.33, 0.12, 0.30, 0.2, 0.26, 0.26); g.bezierCurveTo(0.40, 0.34, 0.5, 0.5, 0.52, 0.62); g.bezierCurveTo(0.66, 0.50, 0.86, 0.52, 1.0, 0.42); g.fill();
  g.lineWidth = 0.055;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0.28 - i * 0.02, 0.10 + i * 0.1); g.bezierCurveTo(0.1, 0.14 + i * 0.1, -0.2, 0.12 + i * 0.12, -0.5 + i * 0.1, 0.2 + i * 0.13); g.stroke(); }
  g.restore();
}
function flag(g, x, y, w, h) {
  g.fillStyle = '#b22234'; g.fillRect(x, y, w, h);
  g.fillStyle = '#f4f4f4'; for (let i = 1; i < 13; i += 2) g.fillRect(x, y + h * i / 13, w, h / 13);
  g.fillStyle = '#2a2f66'; g.fillRect(x, y, w * 0.4, h * 7 / 13);
  g.fillStyle = '#f4f4f4'; for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) { g.beginPath(); g.arc(x + w * 0.4 * (c + 0.6) / 6.2, y + h * 7 / 13 * (r + 0.6) / 5.2, h * 0.014, 0, 6.2832); g.fill(); }
}

export function buildQuarterhorse(pipe) {
  const aniso = pipe.maxAniso;
  const root = new THREE.Group(); root.name = 'quarterhorse';
  const FONT = '"Saira Condensed", "Arial Narrow", Arial, sans-serif';

  // ------------------------------------------------------------ fuselage
  const fus = loft([
    { s: 0.00, y: 0.03, w: 0.400, ht: 0.400, hb: 0.400, nt: 2, nb: 2 },
    { s: 0.25, y: 0.03, w: 0.425, ht: 0.425, hb: 0.425, nt: 2, nb: 2 },
    { s: 0.90, y: 0.03, w: 0.500, ht: 0.505, hb: 0.505, nt: 2, nb: 2 },
    { s: 1.80, y: 0.02, w: 0.585, ht: 0.610, hb: 0.610, nt: 1.95, nb: 2.15 },
    { s: 3.20, y: 0.00, w: 0.680, ht: 0.740, hb: 0.760, nt: 1.85, nb: 2.5 },
    { s: 5.20, y: 0.00, w: 0.740, ht: 0.830, hb: 0.880, nt: 1.78, nb: 2.9 },
    { s: 8.20, y: 0.00, w: 0.760, ht: 0.870, hb: 0.900, nt: 1.78, nb: 3.0 },
    { s: 11.0, y: 0.02, w: 0.735, ht: 0.830, hb: 0.840, nt: 1.85, nb: 2.7 },
    { s: 12.6, y: 0.05, w: 0.665, ht: 0.720, hb: 0.700, nt: 1.95, nb: 2.2 },
    { s: 13.6, y: 0.06, w: 0.610, ht: 0.630, hb: 0.610, nt: 2, nb: 2 },
  ], { nS: 200, nT: 96, x0: X0 });
  const FL = fus.L;

  const sk = new Skin(4096, 1024, { base: '#d3d5d6', rough: 0.44, seed: 21 });
  const r = sk.rand;
  const frames = [0]; let u = 0;
  while (u < 1) { u += (0.42 + r() * 0.34) / FL; frames.push(Math.min(u, 1)); }
  const longs = [0, 0.085, 0.17, 0.25, 0.335, 0.43, 0.5, 0.57, 0.665, 0.75, 0.83, 0.915, 1];
  for (let i = 0; i < frames.length - 1; i++) for (let j = 0; j < longs.length - 1; j++) {
    const odd = r() < 0.1, dv = (r() - 0.55) * (odd ? 0.13 : 0.03), dr = (r() - 0.45) * (odd ? 0.22 : 0.07);
    if (r() < 0.25 && j < longs.length - 2) { sk.panel(frames[i], longs[j], frames[i + 1], longs[j + 2], dv, dr, 0.44); j++; }
    else sk.panel(frames[i], longs[j], frames[i + 1], longs[j + 1], dv, dr, 0.44);
  }
  // lower fuselage: slightly duller, grimy
  sk.a.fillStyle = 'rgba(40,36,30,0.10)'; sk.a.fillRect(0, 0.36 * 1024, 4096, 0.28 * 1024);
  // stainless inlet ring and hot section
  sk.panel(0, 0, 0.022, 1, -0.30, 0.02); sk.panel(0.022, 0, 0.03, 1, -0.12, 0.1);
  for (let i = 0; i < 60; i++) sk.blotch(0.9 + r() * 0.1, r(), 0.02 + r() * 0.04, 0.04 + r() * 0.08, ['120,90,50', '70,70,110', '60,50,40'][i % 3], 0.10);
  sk.panel(0.955, 0, 1, 1, -0.22, 0.12);
  sk.waviness(34, 9, 0.07);
  for (const fu of frames) { sk.seam([[fu, 0], [fu, 1]], { width: 1.5, dark: 0.5 }); sk.rivets(fu + 0.0016, 0, fu + 0.0016, 1, 8); sk.rivets(fu - 0.0016, 0, fu - 0.0016, 1, 8); }
  for (const lv of longs) { sk.seam([[0.03, lv], [0.955, lv]], { width: 1.3, dark: 0.42 }); sk.rivets(0.03, lv + 0.006, 0.955, lv + 0.006, 9); }
  // access panels, ports and vents
  for (let i = 0; i < 46; i++) {
    const pu = 0.05 + r() * 0.86, pv = r(), w = 0.008 + r() * 0.02, h = 0.012 + r() * 0.03;
    sk.seam([[pu, pv], [pu + w, pv], [pu + w, pv + h], [pu, pv + h], [pu, pv]], { width: 1.2, dark: 0.5 });
    if (r() < 0.5) sk.panel(pu, pv, pu + w, pv + h, (r() - 0.5) * 0.12, (r() - 0.5) * 0.2);
  }
  for (const [pu, pv] of [[0.05, 0.19], [0.062, 0.31], [0.05, 0.81], [0.062, 0.69], [0.085, 0.17], [0.085, 0.83], [0.1, 0.33], [0.1, 0.67]]) {
    sk.a.fillStyle = '#e9eaea'; sk.a.beginPath(); sk.a.ellipse(pu * 4096, pv * 1024, 13, 13, 0, 0, 6.2832); sk.a.fill();
    sk.a.strokeStyle = '#3a3c3e'; sk.a.lineWidth = 2.2; sk.a.stroke();
    sk.a.fillStyle = '#b9bcbe'; sk.a.beginPath(); sk.a.ellipse(pu * 4096, pv * 1024, 6, 6, 0, 0, 6.2832); sk.a.fill();
  }
  sk.streaks(260, { y0: 0.34, y1: 0.66, len: [0.02, 0.16], alpha: 0.07 });
  sk.streaks(160, { len: [0.01, 0.08], alpha: 0.035 });
  sk.streaks(120, { len: [0.01, 0.1], alpha: 0.05, dark: false });
  const ft = sk.textures(aniso, 2.4);
  const skinMat = new THREE.MeshStandardMaterial({ map: ft.map, roughnessMap: ft.orm, metalnessMap: ft.orm, normalMap: ft.normalMap, roughness: 1, metalness: 0.92, envMapIntensity: 1.0 });
  skinMat.normalScale.set(0.55, 0.55);
  addTo(root, fus.geometry, skinMat, { name: 'fuselage' });

  // markings
  const decal = (lf, u0, u1, vc, hM, tex, opt) => {
    const gh = lf.girth((u0 + u1) / 2), dv = hM / gh;
    for (const v of [vc, 1 - vc]) addTo(root, loftDecal(lf, u0, u1, v - dv / 2, v + dv / 2, opt), decalMat(tex), { cast: false });
  };
  const tName = decalTex(3072, 440, (g, w, h) => {
    g.fillStyle = '#0c0d0e'; g.textBaseline = 'middle'; g.font = `700 300px ${FONT}`;
    g.save(); g.translate(28, h / 2 + 12); g.scale(1.52, 1); g.fillText('QUARTERHORSE', 0, 0); g.restore();
    horseMark(g, w - 600, 88, 540);
  }, aniso);
  decal(fus, 2.75 / FL, 5.45 / FL, 0.175, 0.39, tName, { nu: 40, nv: 6 });
  const tSeal = decalTex(256, 256, (g, w) => {
    g.fillStyle = '#12182b'; g.beginPath(); g.arc(w / 2, w / 2, 122, 0, 6.2832); g.fill();
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 5; g.beginPath(); g.arc(w / 2, w / 2, 112, 0, 6.2832); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(w / 2, w / 2, 84, 0, 6.2832); g.stroke();
    g.fillStyle = '#d7d9dc'; g.beginPath(); g.moveTo(128, 70); g.lineTo(176, 120); g.lineTo(146, 122); g.lineTo(160, 176); g.lineTo(128, 150); g.lineTo(96, 176); g.lineTo(110, 122); g.lineTo(80, 120); g.closePath(); g.fill();
    g.font = '700 15px Arial'; g.textAlign = 'center';
    for (let i = 0; i < 26; i++) { const a = -2.6 + i * 0.2; g.save(); g.translate(128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98); g.rotate(a + 1.5708); g.fillRect(-3, -5, 6, 9); g.restore(); }
  }, aniso);
  decal(fus, 1.42 / FL, 1.92 / FL, 0.25, 0.5, tSeal, { nu: 10, nv: 10 });
  const tExp = decalTex(512, 80, (g, w, h) => { g.fillStyle = '#0c0d0e'; g.font = `700 62px ${FONT}`; g.textBaseline = 'middle'; g.save(); g.translate(6, h / 2 + 3); g.scale(1.35, 1); g.fillText('EXPERIMENTAL', 0, 0); g.restore(); }, aniso);
  decal(fus, 0.52 / FL, 1.16 / FL, 0.235, 0.1, tExp, { nu: 12, nv: 3 });

  // ------------------------------------------------------------ inlet
  const dark = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.7, metalness: 0.6, side: THREE.DoubleSide });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.28, metalness: 1 });
  addTo(root, new THREE.TorusGeometry(0.392, 0.014, 10, 64), lipMat, { pos: [X(0.0), 0.03, 0], rot: [0, Math.PI / 2, 0] });
  const ductPts = [[0.385, 0], [0.36, 0.25], [0.35, 2.4], [0.0, 2.4]].map(p => new THREE.Vector2(p[0], p[1]));
  const duct = new THREE.LatheGeometry(ductPts, 48); duct.rotateZ(Math.PI / 2);
  addTo(root, duct, dark, { pos: [X(0.0), 0.03, 0], cast: false });
  // compressor face hint deep in the duct
  const face = canvasFan(aniso);
  addTo(root, new THREE.CircleGeometry(0.35, 40), new THREE.MeshStandardMaterial({ map: face, roughness: 0.5, metalness: 0.9, color: 0x555555 }), { pos: [X(2.35), 0.03, 0], rot: [0, Math.PI / 2, 0], cast: false });
  // air-data boom and dorsal fairing
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8babb, roughness: 0.3, metalness: 1 });
  const boom = new THREE.CylinderGeometry(0.012, 0.02, 1.25, 10); boom.rotateZ(-Math.PI / 2);
  addTo(root, boom, steel, { pos: [X(0) + 0.6, 0.40, 0.0] });
  const vane = new THREE.BoxGeometry(0.1, 0.004, 0.16);
  addTo(root, vane, steel, { pos: [X(0) + 1.05, 0.40, 0] });
  const bump = new THREE.SphereGeometry(0.5, 20, 12); bump.scale(0.56, 0.16, 0.24);
  addTo(root, bump, new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.35, metalness: 0.2 }), { pos: [X(1.32), 0.60, 0] });

  // ------------------------------------------------------------ chute boom under the fin
  const bm = loft([
    { s: 9.1, y: 0.80, w: 0.02, ht: 0.03, hb: 0.03, nt: 4, nb: 4 },
    { s: 10.2, y: 0.89, w: 0.20, ht: 0.13, hb: 0.20, nt: 5, nb: 5 },
    { s: 13.6, y: 0.90, w: 0.215, ht: 0.135, hb: 0.17, nt: 6, nb: 6 },
    { s: 15.25, y: 0.90, w: 0.20, ht: 0.13, hb: 0.14, nt: 6, nb: 6 },
    { s: 15.42, y: 0.90, w: 0.13, ht: 0.085, hb: 0.09, nt: 4, nb: 4 },
  ], { nS: 60, nT: 40, x0: X0 });
  const bsk = new Skin(1024, 256, { base: '#d5d7d8', rough: 0.4, seed: 5 });
  for (let i = 0; i < 12; i++) { const a = i / 12, b = (i + 1) / 12; bsk.panel(a, 0, b, 1, (bsk.rand() - 0.6) * 0.14, (bsk.rand() - 0.4) * 0.24, 0.4); bsk.seam([[a, 0], [a, 1]]); bsk.rivets(a + 0.004, 0, a + 0.004, 1, 7); }
  bsk.seam([[0, 0.25], [1, 0.25]]); bsk.seam([[0, 0.75], [1, 0.75]]);
  const bt = bsk.textures(aniso, 2);
  const boomMat = new THREE.MeshStandardMaterial({ map: bt.map, roughnessMap: bt.orm, metalnessMap: bt.orm, normalMap: bt.normalMap, roughness: 1, metalness: 1 });
  addTo(root, bm.geometry, boomMat, { name: 'boom' });
  addTo(root, new THREE.CircleGeometry(0.11, 16), dark, { pos: [X(15.425), 0.9, 0], rot: [0, -Math.PI / 2, 0], cast: false });
  const tReg = decalTex(512, 128, (g, w, h) => { g.fillStyle = '#0c0d0e'; g.font = `700 112px ${FONT}`; g.textBaseline = 'middle'; g.save(); g.translate(8, h / 2 + 6); g.scale(1.42, 1); g.fillText('N21QH', 0, 0); g.restore(); }, aniso);
  { const BL = bm.L, u0 = (11.35 - 9.1) / BL, u1 = (12.35 - 9.1) / BL, gh = bm.girth((u0 + u1) / 2), dv = 0.25 / gh;
    for (const v of [0.25, 0.75]) addTo(root, loftDecal(bm, u0, u1, v - dv / 2, v + dv / 2, { nu: 8, nv: 3 }), decalMat(tReg), { cast: false }); }

  // ------------------------------------------------------------ wings
  const wsec = [
    { z: 0.50, le: X(2.55), te: X(13.50), y: -0.22, t: 0.011 },
    { z: 0.72, le: X(2.90), te: X(13.50), y: -0.22, t: 0.012 },
    { z: 1.66, le: X(7.60), te: X(13.42), y: -0.22, t: 0.030 },
    { z: 4.42, le: X(12.40), te: X(13.20), y: -0.20, t: 0.042 },
  ];
  const wg = wing(wsec, { nC: 26, nSpan: 14 });
  const pf = wg.userData.planform;
  const wsk = new Skin(2048, 2048, { base: '#d2d4d5', rough: 0.46, seed: 99 });
  const U = x => (pf.xmax - x) / (pf.xmax - pf.xmin), V = (z, lower) => (lower ? 0.5 : 0) + 0.5 * (z - pf.zmin) / (pf.zmax - pf.zmin);
  for (let lower = 0; lower < 2; lower++) {
    const ribs = [0.5, 0.95, 1.4, 1.66, 2.1, 2.55, 3.0, 3.45, 3.9, 4.42];
    const spars = [3.4, 5.0, 6.6, 8.0, 9.2, 10.3, 11.3, 12.2, 12.86, 13.5];
    for (let i = 0; i < ribs.length - 1; i++) for (let j = 0; j < spars.length - 1; j++)
      { const odd = wsk.rand() < 0.1; wsk.panel(U(X(spars[j])), V(ribs[i], lower), U(X(spars[j + 1])), V(ribs[i + 1], lower), (wsk.rand() - 0.55) * (odd ? 0.1 : 0.03), (wsk.rand() - 0.45) * (odd ? 0.18 : 0.05), 0.46); }
    // elevons: brighter replaced panels along the trailing edge
    wsk.panel(U(X(12.86)), V(1.7, lower), 1, V(3.0, lower), 0.07, -0.05, 0.46); wsk.panel(U(X(12.86)), V(3.02, lower), 1, V(4.3, lower), 0.05, -0.02, 0.46);
    for (const z of ribs) { wsk.seam([[0, V(z, lower)], [1, V(z, lower)]], { width: 1.4, dark: 0.45 }); wsk.rivets(0, V(z, lower) + 0.002, 1, V(z, lower) + 0.002, 8); }
    for (const s of spars) { wsk.seam([[U(X(s)), V(0.5, lower)], [U(X(s)), V(4.42, lower)]], { width: 1.4, dark: 0.45 }); wsk.rivets(U(X(s)) + 0.002, V(0.5, lower), U(X(s)) + 0.002, V(4.42, lower), 8); }
    wsk.seam([[U(X(12.86)), V(1.7, lower)], [U(X(12.86)), V(4.3, lower)]], { width: 3, dark: 0.8, cut: 0.9 });
    wsk.seam([[U(X(12.86)), V(3.01, lower)], [1, V(3.01, lower)]], { width: 3, dark: 0.8, cut: 0.9 });
    wsk.streaks(120, { y0: V(0.5, lower), y1: V(4.42, lower), len: [0.02, 0.12], alpha: lower ? 0.08 : 0.04 });
  }
  wsk.waviness(18, 22, 0.06);
  const wt = wsk.textures(aniso, 2.2, false);
  const wingMat = new THREE.MeshStandardMaterial({ map: wt.map, roughnessMap: wt.orm, metalnessMap: wt.orm, normalMap: wt.normalMap, roughness: 1, metalness: 0.92 });
  wingMat.normalScale.set(0.5, 0.5);
  addTo(root, wg, wingMat, { name: 'wingR' });
  addTo(root, wg, wingMat, { name: 'wingL', scale: [1, 1, -1] });

  // ------------------------------------------------------------ fin
  const fsec = [
    { z: 0.96, le: X(9.90), te: X(14.74), t: 0.024 },
    { z: 1.27, le: X(11.55), te: X(14.83), t: 0.036 },
    { z: 2.74, le: X(14.50), te: X(15.80), t: 0.045 },
  ];
  const fg = wing(fsec, { nC: 20, nSpan: 12 });
  const fp = fg.userData.planform;
  fg.rotateX(-Math.PI / 2);
  const fsk = new Skin(1024, 2048, { base: '#d2d4d5', rough: 0.46, seed: 314 });
  const FU = x => (fp.xmax - x) / (fp.xmax - fp.xmin), FV = (z, lower) => (lower ? 0.5 : 0) + 0.5 * (z - fp.zmin) / (fp.zmax - fp.zmin);
  for (let lower = 0; lower < 2; lower++) {
    const hs = [0.96, 1.27, 1.6, 1.95, 2.3, 2.74], cs = [0, 0.18, 0.36, 0.54, 0.7, 0.86, 1];
    for (let i = 0; i < hs.length - 1; i++) for (let j = 0; j < cs.length - 1; j++) fsk.panel(cs[j], FV(hs[i], lower), cs[j + 1], FV(hs[i + 1], lower), (fsk.rand() - 0.55) * 0.06, (fsk.rand() - 0.45) * 0.16, 0.46);
    for (const z of hs) { fsk.seam([[0, FV(z, lower)], [1, FV(z, lower)]], { width: 1.3 }); fsk.rivets(0, FV(z, lower) + 0.002, 1, FV(z, lower) + 0.002, 8); }
    // rudder hinge: parallel to the trailing edge
    const h0 = [FU(X(14.05)), FV(1.0, lower)], h1 = [FU(X(15.38)), FV(2.7, lower)];
    fsk.seam([h0, h1], { width: 3, dark: 0.8, cut: 0.9 });
    for (let k = 0; k < 9; k++) { const t = (k + 0.5) / 9; fsk.a.fillStyle = '#a0612a'; fsk.a.fillRect((h0[0] + (h1[0] - h0[0]) * t) * 1024 - 14, (h0[1] + (h1[1] - h0[1]) * t) * 2048 - 3, 9, 6); }
    // markings (texture rows run root->tip, columns nose->tail; flip to read upright from outside)
    const draw = (sAft, zc, hM, fn) => {
      const g = fsk.a, cx = FU(X(sAft)) * 1024, cy = FV(zc, lower) * 2048, pxm = 1024 / (fp.xmax - fp.xmin), pym = 1024 / (fp.zmax - fp.zmin);
      g.save(); g.translate(cx, cy); g.scale(lower ? -pxm : pxm, -pym); fn(g, hM); g.restore();
    };
    draw(13.55, 1.95, 0.62, (g, h) => { g.save(); g.scale(lower ? -1 : 1, 1); wingLogo(g, -0.52, -0.3, 0.95); g.restore(); });
    draw(13.62, 1.47, 0.2, (g) => { g.save(); if (lower) g.scale(-1, 1); flag(g, -0.19, -0.105, 0.38, 0.21); g.restore(); });
  }
  fsk.waviness(8, 14, 0.05);
  const fnt = fsk.textures(aniso, 2.2, false);
  const finMat = new THREE.MeshStandardMaterial({ map: fnt.map, roughnessMap: fnt.orm, metalnessMap: fnt.orm, normalMap: fnt.normalMap, roughness: 1, metalness: 0.92 });
  finMat.normalScale.set(0.5, 0.5);
  addTo(root, fg, finMat, { name: 'fin' });

  // ------------------------------------------------------------ nozzle (convergent-divergent, exposed petals)
  const petalTex = (() => {
    const s = new Skin(1024, 256, { base: '#3b3835', rough: 0.55, metal: 0.9, seed: 8 });
    for (let i = 0; i < 20; i++) { const a = i / 20; s.panel(a, 0, a + 1 / 20, 1, (s.rand() - 0.5) * 0.12, (s.rand() - 0.5) * 0.2, 0.55, 0.9); s.seam([[a, 0], [a, 1]], { width: 5, dark: 0.9, cut: 1 }); s.seam([[a + 0.025, 0.1], [a + 0.025, 0.95]], { width: 2, dark: 0.4, cut: 0.4 }); }
    for (let i = 0; i < 40; i++) s.blotch(s.rand(), s.rand(), 0.03, 0.2, ['110,80,45', '55,60,95', '20,18,16'][i % 3], 0.16);
    return s.textures(aniso, 3, false);
  })();
  const nozMat = new THREE.MeshStandardMaterial({ map: petalTex.map, roughnessMap: petalTex.orm, metalnessMap: petalTex.orm, normalMap: petalTex.normalMap, roughness: 1, metalness: 1, side: THREE.DoubleSide });
  const nozPts = [[0.60, 13.52], [0.615, 13.7], [0.60, 13.95], [0.50, 14.6], [0.47, 14.6], [0.50, 14.1], [0.43, 13.75], [0.50, 13.3]].map(p => new THREE.Vector2(p[0], p[1] - X0));
  const noz = new THREE.LatheGeometry(nozPts, 60); noz.rotateZ(Math.PI / 2);
  // lathe uv: u around, v along profile -> petals want u around
  addTo(root, noz, nozMat, { pos: [0, 0.06, 0], name: 'nozzle' });
  // flame holder / turbine face; emissive is driven by afterburner state
  const abMat = new THREE.MeshStandardMaterial({ color: 0x151312, roughness: 0.8, metalness: 0.5, emissive: new THREE.Color(1.0, 0.45, 0.16), emissiveIntensity: 0 });
  addTo(root, new THREE.CircleGeometry(0.5, 40), abMat, { pos: [X(13.3), 0.06, 0], rot: [0, -Math.PI / 2, 0], cast: false });
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.6, metalness: 0.8, side: THREE.BackSide, emissive: new THREE.Color(1.0, 0.5, 0.2), emissiveIntensity: 0 });
  const liner = new THREE.CylinderGeometry(0.455, 0.5, 1.2, 40, 1, true); liner.rotateZ(Math.PI / 2);
  addTo(root, liner, linerMat, { pos: [X(13.95), 0.06, 0], cast: false });

  // ------------------------------------------------------------ landing gear (ground / take-off shots)
  const gear = new THREE.Group(); gear.name = 'gear'; root.add(gear);
  const tire = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.85, metalness: 0 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xc8cacc, roughness: 0.35, metalness: 1 });
  const strutM = new THREE.MeshStandardMaterial({ color: 0xd0d2d4, roughness: 0.25, metalness: 1 });
  const wheel = (x, y, z, rad, wd) => {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const t = new THREE.TorusGeometry(rad - wd * 0.5, wd * 0.5, 14, 32); addTo(g, t, tire);
    const h = new THREE.CylinderGeometry(rad - wd * 0.9, rad - wd * 0.9, wd * 0.8, 20); h.rotateX(Math.PI / 2); addTo(g, h, hub);
    gear.add(g); return g;
  };
  const strut = (x, y0, y1, z, rad) => { const c = new THREE.CylinderGeometry(rad, rad, y1 - y0, 12); addTo(gear, c, strutM, { pos: [x, (y0 + y1) / 2, z] }); };
  const gy = QH.groundY;
  wheel(X(4.55), gy + 0.235, 0, 0.235, 0.13); strut(X(4.55), gy + 0.235, -0.6, 0.0, 0.04);
  { const c = new THREE.CylinderGeometry(0.022, 0.022, 0.9, 8); c.rotateZ(0.9); addTo(gear, c, strutM, { pos: [X(4.2), gy + 0.75, 0] }); }
  for (const sgn of [1, -1]) {
    wheel(X(9.55), gy + 0.32, sgn * 1.12, 0.32, 0.2); strut(X(9.55), gy + 0.32, -0.3, sgn * 0.98, 0.055);
    const ax = new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8); ax.rotateX(Math.PI / 2); addTo(gear, ax, strutM, { pos: [X(9.55), gy + 0.32, sgn * 1.03] });
    const br = new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8); br.rotateZ(-0.85); addTo(gear, br, strutM, { pos: [X(9.9), gy + 0.9, sgn * 0.98] });
    // open main-gear door
    addTo(gear, new THREE.BoxGeometry(1.5, 0.52, 0.03), skinMatPlain(), { pos: [X(8.75), -1.12, sgn * 0.62], rot: [sgn * 0.12, 0, 0] });
  }
  addTo(gear, new THREE.BoxGeometry(1.25, 0.42, 0.03), skinMatPlain(), { pos: [X(3.75), -1.02, 0.34], rot: [0.1, 0, 0] });
  addTo(gear, new THREE.BoxGeometry(1.25, 0.42, 0.03), skinMatPlain(), { pos: [X(3.75), -1.02, -0.34], rot: [-0.1, 0, 0] });

  function skinMatPlain() { return new THREE.MeshStandardMaterial({ color: 0xd4d6d7, roughness: 0.38, metalness: 1 }); }

  root.userData = {
    gear,
    setAfterburner(k) { abMat.emissiveIntensity = 0.15 + 70 * k; linerMat.emissiveIntensity = 0.05 + 30 * k; },
    setGear(down) { gear.visible = !!down; },
  };
  root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
  return root;
}

function canvasFan(aniso) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#050505'; g.fillRect(0, 0, 256, 256); g.translate(128, 128);
  for (let i = 0; i < 30; i++) { g.rotate(6.2832 / 30); g.fillStyle = i % 2 ? '#3a3c3e' : '#2a2c2e'; g.beginPath(); g.moveTo(8, 0); g.lineTo(120, -8); g.lineTo(122, 10); g.closePath(); g.fill(); }
  g.fillStyle = '#4a4c4e'; g.beginPath(); g.arc(0, 0, 30, 0, 6.2832); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}
