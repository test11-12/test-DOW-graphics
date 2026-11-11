// Anduril YFQ-44A "Fury" (launch aircraft, tail 1003) and an AIM-120 AMRAAM on an underwing rail, modelled
// from U.S. Air Force / Anduril imagery. Length is scaled from the missile (3.65 m is about 0.37 of the
// airframe); other dimensions are estimated from photographs.
import * as THREE from 'three';
import { loft, loftDecal, wing, Skin, canvasTex, decalTex, decalMat, addTo } from '../engine/geo.js';

const X0 = 5.2;                 // nose tip is X0 metres ahead of the model origin
const X = s => X0 - s;          // body-x of a station s metres aft of the nose tip
const RAIL_Z = 1.75, MSL_Y = -0.561, MSL_NOSE_S = 3.03, MSL_LEN = 3.65;
export const FURY = {
  length: 10.0, span: 6.6, groundY: -1.40, nozzleX: X(10.0), nozzleY: 0.06, noseX: X(0),
  // missile centre when it hangs on the left-wing rail (body frame)
  station: new THREE.Vector3(X(MSL_NOSE_S + MSL_LEN / 2), MSL_Y, -RAIL_Z),
};
const LOW = '#7b8187', UP = '#454a50', FONT = '"Saira Condensed", "Arial Narrow", Arial, sans-serif';

function usafSymbol(g, cx, cy, s, color) {
  g.save(); g.translate(cx, cy); g.scale(s, s); g.fillStyle = color;
  for (const m of [1, -1]) {
    g.beginPath(); g.moveTo(m * 0.06, -0.10); g.lineTo(m * 0.50, -0.42); g.lineTo(m * 0.44, -0.20); g.lineTo(m * 0.10, 0.02); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(m * 0.13, 0.06); g.lineTo(m * 0.42, -0.13); g.lineTo(m * 0.37, 0.03); g.lineTo(m * 0.15, 0.17); g.closePath(); g.fill();
  }
  g.beginPath(); g.moveTo(0, -0.12); g.lineTo(0.09, 0.0); g.lineTo(0, 0.1); g.lineTo(-0.09, 0.0); g.closePath(); g.fill();
  g.beginPath(); g.arc(0, 0.27, 0.105, 0, 6.2832); g.fill();
  g.restore();
}

export function buildFury(pipe) {
  const aniso = pipe.maxAniso;
  const root = new THREE.Group(); root.name = 'fury';

  // ------------------------------------------------------------ fuselage (chined nose, flat-sided mid body)
  const fus = loft([
    { s: 0.00, y: -0.185, w: 0.012, ht: 0.010, hb: 0.008, nt: 1.6, nb: 1.5 },
    { s: 0.45, y: -0.160, w: 0.185, ht: 0.105, hb: 0.060, nt: 1.6, nb: 1.5 },
    { s: 1.20, y: -0.105, w: 0.375, ht: 0.255, hb: 0.130, nt: 1.7, nb: 1.5 },
    { s: 2.00, y: -0.045, w: 0.520, ht: 0.420, hb: 0.215, nt: 1.9, nb: 1.6 },
    { s: 3.00, y: 0.000, w: 0.620, ht: 0.500, hb: 0.330, nt: 2.2, nb: 1.9 },
    { s: 4.20, y: 0.000, w: 0.670, ht: 0.520, hb: 0.450, nt: 2.45, nb: 2.4 },
    { s: 5.60, y: 0.000, w: 0.670, ht: 0.520, hb: 0.480, nt: 2.45, nb: 2.6 },
    { s: 7.00, y: 0.010, w: 0.620, ht: 0.500, hb: 0.440, nt: 2.3, nb: 2.4 },
    { s: 8.30, y: 0.030, w: 0.500, ht: 0.440, hb: 0.360, nt: 2.1, nb: 2.1 },
    { s: 9.30, y: 0.050, w: 0.360, ht: 0.330, hb: 0.290, nt: 2, nb: 2 },
    { s: 9.75, y: 0.060, w: 0.290, ht: 0.280, hb: 0.265, nt: 2, nb: 2 },
  ], { nS: 190, nT: 96, x0: X0 });
  const FL = fus.L, W = 4096, H = 1024;

  const sk = new Skin(W, H, { base: LOW, rough: 0.56, metal: 0, seed: 44 });
  const r = sk.rand, a = sk.a;
  // darker upper colour with stepped, chamfered demarcation
  const steps = [[0, 0.150], [0.085, 0.150], [0.10, 0.190], [0.215, 0.190], [0.23, 0.165], [0.385, 0.165], [0.40, 0.238], [0.655, 0.238], [0.67, 0.180], [0.80, 0.180], [0.815, 0.215], [1.0, 0.215]];
  for (const side of [0, 1]) {
    a.fillStyle = UP; a.beginPath(); a.moveTo(0, side ? H : 0);
    for (const [u, d] of steps) a.lineTo(u * W, (side ? 1 - d : d) * H);
    a.lineTo(W, side ? H : 0); a.closePath(); a.fill();
  }
  sk.r.fillStyle = Skin.orm(0.52, 0); for (const side of [0, 1]) { sk.r.beginPath(); sk.r.moveTo(0, side ? H : 0); for (const [u, d] of steps) sk.r.lineTo(u * W, (side ? 1 - d : d) * H); sk.r.lineTo(W, side ? H : 0); sk.r.closePath(); sk.r.fill(); }
  // tone variation panel to panel (kept very low: this is a filled, low-observable finish)
  const frames = [0]; let u = 0; while (u < 1) { u += (0.55 + r() * 0.5) / FL; frames.push(Math.min(u, 1)); }
  const longs = [0, 0.07, 0.25, 0.43, 0.5, 0.57, 0.75, 0.93, 1];
  for (let i = 0; i < frames.length - 1; i++) for (let j = 0; j < longs.length - 1; j++) {
    const dv = (r() - 0.5) * 0.03; a.fillStyle = dv >= 0 ? `rgba(255,255,255,${dv})` : `rgba(0,0,0,${-dv})`;
    a.fillRect(frames[i] * W, longs[j] * H, (frames[i + 1] - frames[i]) * W, (longs[j + 1] - longs[j]) * H);
  }
  // radome / nose cap and exhaust shroud
  a.fillStyle = 'rgba(255,255,255,0.05)'; a.fillRect(0, 0, 0.075 * W, H);
  a.fillStyle = 'rgba(20,18,16,0.45)'; a.fillRect(0.965 * W, 0, 0.035 * W, H);
  for (let i = 0; i < 40; i++) sk.blotch(0.9 + r() * 0.1, r(), 0.03 + r() * 0.04, 0.05 + r() * 0.08, '25,22,20', 0.07);
  for (const fu of frames) sk.seam([[fu, 0], [fu, 1]], { width: 1.3, dark: 0.34, cut: 0.35 });
  for (const lv of longs) sk.seam([[0.02, lv], [0.965, lv]], { width: 1.2, dark: 0.3, cut: 0.3 });
  sk.seam([[0.075, 0], [0.075, 1]], { width: 2.2, dark: 0.5, cut: 0.6 });
  // access panels with fastener rows, louvres near the engine bay
  for (let i = 0; i < 34; i++) {
    const pu = 0.1 + r() * 0.8, pv = r(), w = 0.012 + r() * 0.03, h = 0.02 + r() * 0.04;
    sk.seam([[pu, pv], [pu + w, pv], [pu + w, pv + h], [pu, pv + h], [pu, pv]], { width: 1.2, dark: 0.38, cut: 0.35 });
    if (r() < 0.6) { sk.rivets(pu + 0.0015, pv + 0.004, pu + w - 0.0015, pv + 0.004, 14, { r: 1.0, dark: 0.3 }); sk.rivets(pu + 0.0015, pv + h - 0.004, pu + w - 0.0015, pv + h - 0.004, 14, { r: 1.0, dark: 0.3 }); }
  }
  for (const pv of [0.31, 0.69]) for (let k = 0; k < 5; k++) { a.fillStyle = '#17191b'; a.fillRect((0.60 + k * 0.006) * W, (pv - 0.012) * H, 0.0028 * W, 0.024 * H); }
  for (const pv of [0.10, 0.90]) { a.fillStyle = '#1b1d1f'; a.beginPath(); a.ellipse(0.70 * W, pv * H, 30, 9, 0, 0, 6.2832); a.fill(); }
  sk.streaks(170, { y0: 0.3, y1: 0.7, len: [0.02, 0.14], alpha: 0.05 });
  sk.streaks(120, { len: [0.01, 0.08], alpha: 0.03 });
  sk.streaks(60, { len: [0.01, 0.06], alpha: 0.025, dark: false });
  sk.waviness(20, 6, 0.03);
  const ft = sk.textures(aniso, 1.6);
  const skinMat = new THREE.MeshStandardMaterial({ map: ft.map, roughnessMap: ft.orm, metalnessMap: ft.orm, normalMap: ft.normalMap, roughness: 1, metalness: 1, envMapIntensity: 0.9 });
  skinMat.normalScale.set(0.45, 0.45);
  addTo(root, fus.geometry, skinMat, { name: 'fuselage' });

  // markings
  const decal = (lf, s0, s1, vc, hM, tex, opt, sides = [0, 1]) => {
    const u0 = s0 / FL, u1 = s1 / FL, gh = lf.girth((u0 + u1) / 2), dv = hM / gh;
    for (const k of sides) { const v = k ? 1 - vc : vc; addTo(root, loftDecal(lf, u0, u1, v - dv / 2, v + dv / 2, opt), decalMat(tex, { roughness: 0.5 }), { cast: false }); }
  };
  const tDes = decalTex(1536, 280, (g, w, h) => {
    g.fillStyle = '#e6e9eb'; g.textBaseline = 'middle'; g.font = `700 236px ${FONT}`;
    g.save(); g.translate(64, h / 2 + 10); g.transform(1.34, 0, -0.2, 1, 0, 0); g.fillText('YFQ-44A', 0, 0); g.restore();
  }, aniso);
  decal(fus, 4.42, 6.26, 0.192, 0.33, tDes, { nu: 30, nv: 6 });
  const tAnd = decalTex(768, 110, (g, w, h) => {
    g.fillStyle = '#d9dcde'; g.textBaseline = 'middle'; g.font = `700 86px ${FONT}`;
    g.save(); g.translate(8, h / 2 + 5); g.scale(1.42, 1); g.fillText('ANDURIL', 0, 0); g.restore();
  }, aniso);
  decal(fus, 2.36, 3.06, 0.228, 0.10, tAnd, { nu: 14, nv: 3 });
  const tSym = decalTex(256, 256, (g) => usafSymbol(g, 128, 128, 230, '#d5d9dc'), aniso);
  decal(fus, 7.18, 7.66, 0.232, 0.46, tSym, { nu: 10, nv: 8 });
  const tUsaf = decalTex(1024, 96, (g, w, h) => { g.fillStyle = '#aab0b5'; g.textBaseline = 'middle'; g.font = `700 76px ${FONT}`; g.save(); g.translate(6, h / 2 + 4); g.scale(1.3, 1); g.fillText('U.S. AIR FORCE', 0, 0); g.restore(); }, aniso);
  decal(fus, 6.72, 7.74, 0.375, 0.095, tUsaf, { nu: 16, nv: 3 });
  const tTri = decalTex(128, 128, (g) => { g.fillStyle = '#f0c419'; g.strokeStyle = '#151515'; g.lineWidth = 7; g.beginPath(); g.moveTo(14, 20); g.lineTo(114, 20); g.lineTo(64, 110); g.closePath(); g.fill(); g.stroke(); }, aniso);
  decal(fus, 1.86, 2.0, 0.236, 0.13, tTri, { nu: 4, nv: 4 });
  decal(fus, 9.08, 9.2, 0.25, 0.12, tTri, { nu: 4, nv: 4 });

  // ------------------------------------------------------------ dorsal blister, antennas
  const paintUp = new THREE.MeshStandardMaterial({ color: UP, roughness: 0.52, metalness: 0 });
  const paintLow = new THREE.MeshStandardMaterial({ color: LOW, roughness: 0.56, metalness: 0 });
  const blister = new THREE.SphereGeometry(1, 28, 14); blister.scale(0.58, 0.105, 0.175);
  addTo(root, blister, paintUp, { pos: [X(2.08), 0.375, 0] });
  const blade = (s, y, up = 1) => { const b = new THREE.BufferGeometry(); const h = 0.15 * up, t = 0.008;
    const pts = [[0.12, 0], [-0.1, 0], [-0.12, h], [-0.02, h]]; const v = [];
    for (const z of [t, -t]) for (const p of pts) v.push(p[0], p[1], z);
    b.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); b.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7]); b.computeVertexNormals();
    addTo(root, b, new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, side: THREE.DoubleSide }), { pos: [X(s), y, 0] }); };
  blade(5.35, 0.515); blade(7.05, 0.505); blade(8.5, -0.395, -1);

  // ------------------------------------------------------------ chin inlet
  const inl = loft([
    { s: 2.55, y: -0.470, w: 0.300, ht: 0.130, hb: 0.130, nt: 5, nb: 3.2 },
    { s: 2.75, y: -0.480, w: 0.325, ht: 0.150, hb: 0.145, nt: 5, nb: 3.2 },
    { s: 3.60, y: -0.500, w: 0.360, ht: 0.190, hb: 0.150, nt: 4, nb: 3 },
    { s: 4.60, y: -0.470, w: 0.330, ht: 0.160, hb: 0.100, nt: 3, nb: 2.6 },
    { s: 5.40, y: -0.430, w: 0.200, ht: 0.100, hb: 0.030, nt: 2.5, nb: 2.2 },
  ], { nS: 40, nT: 48, x0: X0 });
  addTo(root, inl.geometry, paintLow, { name: 'inlet' });
  const dark = new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide });
  addTo(root, new THREE.BoxGeometry(0.9, 0.235, 0.56), dark, { pos: [X(3.02), -0.475, 0], cast: false });
  // lip: thin lighter edge
  { const lipG = new THREE.BufferGeometry(); const pts = []; const N = 40; for (let i = 0; i < N; i++) { const th = i / N * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th), top = c >= 0, e = 2 / (top ? 5 : 3.2);
      pts.push(new THREE.Vector3(X(2.55), -0.47 + 0.13 * Math.sign(c) * Math.pow(Math.abs(c), e), 0.3 * Math.sign(sn) * Math.pow(Math.abs(sn), e))); }
    addTo(root, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 80, 0.012, 6, true), paintLow); }

  // ------------------------------------------------------------ wings
  const wsec = [
    { z: 0.50, le: X(3.80), te: X(6.56), y: -0.105, t: 0.052 },
    { z: 3.30, le: X(6.02), te: X(6.92), y: -0.085, t: 0.046 },
  ];
  const wg = wing(wsec, { nC: 24, nSpan: 14 });
  const pf = wg.userData.planform;
  const wsk = new Skin(2048, 2048, { base: UP, rough: 0.52, metal: 0, seed: 91 });
  wsk.a.fillStyle = LOW; wsk.a.fillRect(0, 1024, 2048, 1024); wsk.r.fillStyle = Skin.orm(0.56, 0); wsk.r.fillRect(0, 1024, 2048, 1024);
  const WU = x => (pf.xmax - x) / (pf.xmax - pf.xmin), WV = (z, lower) => (lower ? 0.5 : 0) + 0.5 * (z - pf.zmin) / (pf.zmax - pf.zmin);
  const leAt = z => wsec[0].le + (wsec[1].le - wsec[0].le) * (z - wsec[0].z) / (wsec[1].z - wsec[0].z), teAt = z => wsec[0].te + (wsec[1].te - wsec[0].te) * (z - wsec[0].z) / (wsec[1].z - wsec[0].z);
  const chordPt = (z, c, lower) => [WU(leAt(z) + (teAt(z) - leAt(z)) * c), WV(z, lower)];
  for (let lower = 0; lower < 2; lower++) {
    const ribs = [0.5, 1.05, 1.75, 2.45, 3.3];
    for (const z of ribs) sk_line(wsk, [chordPt(z, 0, lower), chordPt(z, 1, lower)]);
    for (const c of [0.08, 0.3, 0.52, 0.72]) sk_line(wsk, [chordPt(0.5, c, lower), chordPt(3.3, c, lower)], c === 0.72 ? { width: 2.6, dark: 0.7, cut: 0.8 } : undefined);
    // lighter leading-edge band on the upper surface, control-surface break
    if (!lower) { wsk.a.fillStyle = 'rgba(160,168,175,0.5)'; wsk.a.beginPath(); for (const [zz, cc] of [[0.5, 0], [3.3, 0], [3.3, 0.08], [0.5, 0.08]]) { const p = chordPt(zz, cc, 0); wsk.a.lineTo(p[0] * 2048, p[1] * 2048); } wsk.a.closePath(); wsk.a.fill(); }
    sk_line(wsk, [chordPt(1.9, 0.72, lower), chordPt(1.9, 1, lower)], { width: 2.6, dark: 0.7, cut: 0.8 });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const dv = (wsk.rand() - 0.5) * 0.035; wsk.a.fillStyle = dv >= 0 ? `rgba(255,255,255,${dv})` : `rgba(0,0,0,${-dv})`; wsk.a.fillRect(j * 512, (lower ? 1024 : 0) + i * 256, 512, 256); }
    wsk.streaks(70, { y0: WV(0.5, lower), y1: WV(3.3, lower), len: [0.03, 0.2], alpha: lower ? 0.06 : 0.03 });
  }
  wsk.waviness(10, 16, 0.025);
  const wt = wsk.textures(aniso, 1.6, false);
  const wingMat = new THREE.MeshStandardMaterial({ map: wt.map, roughnessMap: wt.orm, metalnessMap: wt.orm, normalMap: wt.normalMap, roughness: 1, metalness: 1 });
  wingMat.normalScale.set(0.4, 0.4);
  addTo(root, wg, wingMat, { name: 'wingR' });
  addTo(root, wg, wingMat, { name: 'wingL', scale: [1, 1, -1] });

  // ------------------------------------------------------------ stabilators (all-moving, low on the aft body)
  const ssec = [
    { z: 0.28, le: X(8.22), te: X(9.56), y: -0.075, t: 0.048 },
    { z: 1.78, le: X(9.30), te: X(9.92), y: -0.075, t: 0.042 },
  ];
  const sg = wing(ssec, { nC: 18, nSpan: 8 });
  const ssk = new Skin(1024, 1024, { base: UP, rough: 0.52, metal: 0, seed: 17 });
  ssk.a.fillStyle = LOW; ssk.a.fillRect(0, 512, 1024, 512);
  for (const v of [0.02, 0.25, 0.48, 0.52, 0.75, 0.98]) ssk.seam([[0, v], [1, v]], { width: 1.2, dark: 0.3, cut: 0.3 });
  for (const uu of [0.3, 0.62]) ssk.seam([[uu, 0], [uu, 1]], { width: 1.2, dark: 0.3, cut: 0.3 });
  const st = ssk.textures(aniso, 1.5, false);
  const stabMat = new THREE.MeshStandardMaterial({ map: st.map, roughnessMap: st.orm, metalnessMap: st.orm, normalMap: st.normalMap, roughness: 1, metalness: 1 });
  addTo(root, sg, stabMat, { name: 'stabR' });
  addTo(root, sg, stabMat, { name: 'stabL', scale: [1, 1, -1] });

  // ------------------------------------------------------------ fin
  const fsec = [
    { z: 0.36, le: X(7.92), te: X(9.50), t: 0.05 },
    { z: 0.50, le: X(8.12), te: X(9.52), t: 0.05 },
    { z: 1.74, le: X(9.32), te: X(9.93), t: 0.046 },
  ];
  const fg = wing(fsec, { nC: 20, nSpan: 10 });
  const fp = fg.userData.planform;
  fg.rotateX(-Math.PI / 2);
  const fsk = new Skin(1024, 2048, { base: LOW, rough: 0.56, metal: 0, seed: 314 });
  const FU = x => (fp.xmax - x) / (fp.xmax - fp.xmin), FV = (z, lower) => (lower ? 0.5 : 0) + 0.5 * (z - fp.zmin) / (fp.zmax - fp.zmin);
  const fle = z => z < 0.5 ? X(7.92) + (X(8.12) - X(7.92)) * (z - 0.36) / 0.14 : X(8.12) + (X(9.32) - X(8.12)) * (z - 0.5) / 1.24;
  const fte = z => z < 0.5 ? X(9.50) + (X(9.52) - X(9.50)) * (z - 0.36) / 0.14 : X(9.52) + (X(9.93) - X(9.52)) * (z - 0.5) / 1.24;
  for (let lower = 0; lower < 2; lower++) {
    // dark tip cap and leading edge
    fsk.a.fillStyle = UP; fsk.a.fillRect(0, FV(1.6, lower) * 2048, 1024, (FV(1.74, lower) - FV(1.6, lower)) * 2048 + 2);
    fsk.a.beginPath(); for (const [zz, cc] of [[0.36, 0], [1.74, 0], [1.74, 0.09], [0.36, 0.06]]) { const x = fle(zz) + (fte(zz) - fle(zz)) * cc; fsk.a.lineTo(FU(x) * 1024, FV(zz, lower) * 2048); } fsk.a.closePath(); fsk.a.fill();
    for (const z of [0.5, 0.9, 1.3, 1.6]) fsk.seam([[0, FV(z, lower)], [1, FV(z, lower)]], { width: 1.2, dark: 0.3, cut: 0.3 });
    // rudder hinge
    fsk.seam([[FU(fle(0.5) + (fte(0.5) - fle(0.5)) * 0.7), FV(0.5, lower)], [FU(fle(1.6) + (fte(1.6) - fle(1.6)) * 0.7), FV(1.6, lower)]], { width: 2.6, dark: 0.7, cut: 0.8 });
    // markings: drawn in centimetres, flipped so they read upright from outside
    const draw = (sAft, zc, fn) => {
      const g = fsk.a, pxm = 1024 / (fp.xmax - fp.xmin), pym = 1024 / (fp.zmax - fp.zmin);
      g.save(); g.translate(FU(X(sAft)) * 1024, FV(zc, lower) * 2048); g.scale((lower ? -pxm : pxm) / 100, -pym / 100); fn(g); g.restore();
    };
    draw(9.08, 1.02, g => { g.fillStyle = '#e4e7e9'; g.font = `700 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.scale(1.25, 1); g.fillText('AI', 0, 0); g.restore(); });
    draw(8.98, 0.72, g => { g.fillStyle = '#d4d8db'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 7.2px ${FONT}`; g.fillText('AF', -22, -4.3); g.fillText('25', -22, 3.6); g.font = `700 15px ${FONT}`; g.save(); g.scale(1.2, 1); g.fillText('1003', 4, 0); g.restore(); });
    draw(9.34, 1.40, g => { g.strokeStyle = '#d4d8db'; g.fillStyle = '#d4d8db'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(-8, -10); g.lineTo(8, -10); g.lineTo(8, 2); g.quadraticCurveTo(8, 9, 0, 12); g.quadraticCurveTo(-8, 9, -8, 2); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(-5, -5); g.lineTo(0, 5); g.lineTo(5, -5); g.lineTo(2.6, -5); g.lineTo(0, 0.5); g.lineTo(-2.6, -5); g.closePath(); g.fill(); });
  }
  const fnt = fsk.textures(aniso, 1.5, false);
  const finMat = new THREE.MeshStandardMaterial({ map: fnt.map, roughnessMap: fnt.orm, metalnessMap: fnt.orm, normalMap: fnt.normalMap, roughness: 1, metalness: 1 });
  finMat.normalScale.set(0.4, 0.4);
  addTo(root, fg, finMat, { name: 'fin' });

  // ------------------------------------------------------------ exhaust
  const hot = new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.5, metalness: 0.85, side: THREE.DoubleSide });
  const nozPts = [[0.292, 9.72], [0.282, 9.86], [0.25, 10.0], [0.228, 10.0], [0.236, 9.72], [0.21, 9.35]].map(p => new THREE.Vector2(p[0], p[1] - X0));
  const noz = new THREE.LatheGeometry(nozPts, 48); noz.rotateZ(Math.PI / 2);
  addTo(root, noz, hot, { pos: [0, 0.06, 0], name: 'nozzle' });
  addTo(root, new THREE.CircleGeometry(0.215, 32), new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9, emissive: new THREE.Color(1.0, 0.42, 0.16), emissiveIntensity: 0.25 }), { pos: [X(9.4), 0.06, 0], rot: [0, -Math.PI / 2, 0], cast: false });

  // ------------------------------------------------------------ pylons and rail launchers (both wings)
  const railMat = new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.5, metalness: 0.3 });
  const pyl = wing([{ z: 0, le: X(4.84), te: X(6.32), t: 0.062 }, { z: 0.225, le: X(4.98), te: X(6.22), t: 0.062 }], { nC: 12, nSpan: 2, cap: true });
  pyl.rotateX(Math.PI / 2);
  const rail = loft([
    { s: 3.70, y: -0.412, w: 0.012, ht: 0.012, hb: 0.012, nt: 4, nb: 4 },
    { s: 3.92, y: -0.412, w: 0.062, ht: 0.050, hb: 0.050, nt: 5, nb: 5 },
    { s: 6.50, y: -0.412, w: 0.062, ht: 0.050, hb: 0.050, nt: 5, nb: 5 },
    { s: 6.74, y: -0.405, w: 0.022, ht: 0.020, hb: 0.020, nt: 4, nb: 4 },
  ], { nS: 30, nT: 24, x0: X0 });
  for (const sgn of [1, -1]) {
    addTo(root, pyl, paintLow, { pos: [0, -0.13, sgn * RAIL_Z], name: 'pylon' });
    addTo(root, rail.geometry, railMat, { pos: [0, 0, sgn * RAIL_Z], name: 'rail' });
    for (const s of [4.45, 5.75]) addTo(root, new THREE.BoxGeometry(0.1, 0.03, 0.05), railMat, { pos: [X(s), -0.468, sgn * RAIL_Z] });
  }

  // ------------------------------------------------------------ landing gear
  const gear = new THREE.Group(); gear.name = 'gear'; root.add(gear);
  const tire = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.85 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xc9cccf, roughness: 0.4, metalness: 0.9 });
  const leg = new THREE.MeshStandardMaterial({ color: 0xdfe1e3, roughness: 0.35, metalness: 0.6 });
  const wheel = (x, y, z, rad, wd) => { const g = new THREE.Group(); g.position.set(x, y, z);
    addTo(g, new THREE.TorusGeometry(rad - wd * 0.5, wd * 0.5, 14, 30), tire);
    const h = new THREE.CylinderGeometry(rad - wd * 0.9, rad - wd * 0.9, wd * 0.8, 18); h.rotateX(Math.PI / 2); addTo(g, h, hub); gear.add(g); };
  const strut = (x, y0, y1, z, rad) => addTo(gear, new THREE.CylinderGeometry(rad, rad, y1 - y0, 10), leg, { pos: [x, (y0 + y1) / 2, z] });
  const gy = FURY.groundY;
  wheel(X(3.55), gy + 0.19, 0, 0.19, 0.11); strut(X(3.55), gy + 0.19, -0.62, 0.075, 0.028);
  { const ax = new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8); ax.rotateX(Math.PI / 2); addTo(gear, ax, leg, { pos: [X(3.55), gy + 0.19, 0.04] }); }
  { const c = new THREE.CylinderGeometry(0.016, 0.016, 0.55, 8); c.rotateZ(0.95); addTo(gear, c, leg, { pos: [X(3.3), gy + 0.5, 0.075] }); }
  for (const sgn of [1, -1]) {
    wheel(X(5.78), gy + 0.255, sgn * 0.86, 0.255, 0.16); strut(X(5.78), gy + 0.255, -0.42, sgn * 0.74, 0.04);
    const ax = new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8); ax.rotateX(Math.PI / 2); addTo(gear, ax, leg, { pos: [X(5.78), gy + 0.255, sgn * 0.8] });
    const br = new THREE.CylinderGeometry(0.02, 0.02, 0.72, 8); br.rotateZ(-0.8); addTo(gear, br, leg, { pos: [X(6.05), gy + 0.66, sgn * 0.74] });
    addTo(gear, new THREE.BoxGeometry(0.72, 0.42, 0.02), paintLow, { pos: [X(5.75), -0.66, sgn * 0.62], rot: [sgn * 0.25, 0, 0] });
  }
  addTo(gear, new THREE.BoxGeometry(0.6, 0.3, 0.02), paintLow, { pos: [X(3.4), -0.82, 0.2], rot: [0.12, 0, 0] });

  root.userData = { gear, setGear(down) { gear.visible = !!down; } };
  root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return root;
}
function sk_line(skin, pts, opt = { width: 1.2, dark: 0.3, cut: 0.3 }) { skin.seam(pts, opt); }

// AIM-120 AMRAAM: 3.65 m long, 178 mm body, cruciform mid-body wings and tail fins (hung in an X on the rail).
export function buildAmraam(pipe) {
  const aniso = pipe.maxAniso, g = new THREE.Group(); g.name = 'aim120';
  const Xm = s => MSL_LEN / 2 - s, R = 0.089;
  const body = loft([
    { s: 0.00, w: 0.003, ht: 0.003, hb: 0.003 }, { s: 0.10, w: 0.033, ht: 0.033, hb: 0.033 }, { s: 0.25, w: 0.059, ht: 0.059, hb: 0.059 },
    { s: 0.42, w: 0.078, ht: 0.078, hb: 0.078 }, { s: 0.58, w: 0.087, ht: 0.087, hb: 0.087 }, { s: 0.66, w: R, ht: R, hb: R },
    { s: 3.58, w: R, ht: R, hb: R }, { s: 3.65, w: 0.079, ht: 0.079, hb: 0.079 },
  ], { nS: 100, nT: 36, x0: MSL_LEN / 2 });
  const tex = canvasTex(2048, 128, (c, w, h) => {
    c.fillStyle = '#c3c6c8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e3dfd3'; c.fillRect(0, 0, 0.158 * w, h);
    for (const [u, wd, col] of [[0.158, 5, '#4a4e52'], [0.30, 3, '#6d7175'], [0.455, 3, '#6d7175'], [0.555, 16, '#7a5a3b'], [0.74, 3, '#6d7175'], [0.905, 4, '#4a4e52']]) { c.fillStyle = col; c.fillRect(u * w, 0, wd, h); }
    c.fillStyle = '#2a2c2e'; for (const u of [0.2, 0.36, 0.62]) for (const v of [0.2, 0.7]) c.fillRect(u * w, v * h, 54, 4);
    const gr = c.createLinearGradient(0.9 * w, 0, w, 0); gr.addColorStop(0, 'rgba(30,26,22,0)'); gr.addColorStop(1, 'rgba(30,26,22,0.45)'); c.fillStyle = gr; c.fillRect(0.9 * w, 0, 0.1 * w, h);
  }, { aniso });
  addTo(g, body.geometry, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.05 }), { name: 'body' });
  const finMat = new THREE.MeshStandardMaterial({ color: 0xb7babc, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide });
  const mid = wing([{ z: 0.082, le: Xm(1.60), te: Xm(2.13), t: 0.035 }, { z: 0.266, le: Xm(1.98), te: Xm(2.13), t: 0.03 }], { nC: 8, nSpan: 2, profile: 'lens' });
  const tail = wing([{ z: 0.082, le: Xm(3.26), te: Xm(3.61), t: 0.04 }, { z: 0.27, le: Xm(3.47), te: Xm(3.62), t: 0.035 }], { nC: 8, nSpan: 2, profile: 'lens' });
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; addTo(g, mid, finMat, { rot: [a, 0, 0] }); addTo(g, tail, finMat, { rot: [a, 0, 0] }); }
  const nozMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7, emissive: new THREE.Color(1.0, 0.62, 0.3), emissiveIntensity: 0 });
  addTo(g, new THREE.CircleGeometry(0.066, 20), nozMat, { pos: [Xm(MSL_LEN) - 0.002, 0, 0], rot: [0, -Math.PI / 2, 0], cast: false });
  g.userData = { tailX: Xm(MSL_LEN), noseX: Xm(0), setBurn(k) { nozMat.emissiveIntensity = 90 * k; } };
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}
