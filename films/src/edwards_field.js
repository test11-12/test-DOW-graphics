// Edwards flight line, as dressed for the film: ground equipment around the parked aircraft, hangars and light
// masts beyond the apron, runway edge lights and signs, and scrub on the unpaved ground. The pavements themselves
// are painted by the terrain recipe (terrain_mojave.js). Generic airfield furniture only: no unit markings.
import * as THREE from 'three';
import { LAYER } from '../engine/pipeline.js';
import { canvasTex, rng } from '../engine/geo.js';
import { FIELD_U, FIELD_V } from './terrain_mojave.js';

export const fieldXZ = (u, v) => [u * FIELD_U[0] + v * FIELD_V[0], u * FIELD_U[1] + v * FIELD_V[1]];

const std = (color, rough = 0.7, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
function put(parent, geo, mat, pos, rot, cast = true) { const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(pos[0], pos[1], pos[2]); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; }
function rodG(a, b, r, seg = 8) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(), g = new THREE.CylinderGeometry(r, r, L, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); return g;
}
const wheel = (r, w) => { const g = new THREE.CylinderGeometry(r, r, w, 18); g.rotateX(Math.PI / 2); return g; };

// ------------------------------------------------------------------ ground equipment, in the parked aircraft's frame
// (+x towards its nose, +z to its right, y up from the pavement). ac: the FURY description from fury_model.js
export function buildRamp(ac) {
  const g = new THREE.Group(); g.name = 'ramp';
  const rubber = std(0x0d0d0e, 0.9), yellow = std(0xd8a514, 0.6), orange = std(0xe2571a, 0.55), white = std(0xe8e8e4, 0.5), red = std(0xb5201c, 0.45, 0.1), steel = std(0x9a9da0, 0.4, 0.8), olive = std(0x5a5f4a, 0.7), dark = std(0x1c1d1f, 0.6, 0.3), alu = std(0xd4d6d8, 0.35, 0.85);
  const gy = -ac.groundY;                      // height of the aircraft origin above the pavement
  // wheel chocks, roped in pairs
  const chockGeo = (() => { const s = new THREE.Shape(); s.moveTo(-0.11, 0); s.lineTo(0.11, 0); s.lineTo(0.03, 0.14); s.lineTo(-0.03, 0.14); s.closePath(); const e = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }); e.translate(0, 0, -0.15); return e; })();
  const chocks = (x, z, r) => { for (const sgn of [1, -1]) put(g, chockGeo, sgn > 0 ? yellow : rubber, [x + sgn * (r * 0.72 + 0.09), 0, z]); put(g, rodG([x - r - 0.1, 0.05, z + 0.17], [x + r + 0.1, 0.05, z + 0.17], 0.008, 5), std(0xc9c2a8, 0.9), null, null, false); };
  chocks(ac.mainGear.x, ac.mainGear.z, ac.mainR); chocks(ac.mainGear.x, -ac.mainGear.z, ac.mainR); chocks(ac.noseGear.x, 0, 0.18);
  // traffic cones at the extremities
  const coneBody = new THREE.LatheGeometry([[0.165, 0.03], [0.15, 0.035], [0.035, 0.70], [0.0, 0.71]].map(p => new THREE.Vector2(p[0], p[1])), 18);
  const coneBand = new THREE.LatheGeometry([[0.108, 0.30], [0.082, 0.46]].map(p => new THREE.Vector2(p[0] + 0.002, p[1])), 18);
  const coneBase = new THREE.BoxGeometry(0.36, 0.03, 0.36);
  for (const [x, z] of [[-1.4, 4.15], [-1.4, -4.15], [6.5, 1.1], [-5.9, -1.2], [-5.7, 2.3]]) { put(g, coneBody, orange, [x, 0, z]); put(g, coneBand, white, [x, 0, z], null, false); put(g, coneBase, rubber, [x, 0.015, z]); }
  // tow bar lying ahead of the nose
  { const a = [6.3, 0.19, 2.2], b = [9.5, 0.19, 3.4], t = new THREE.Group();
    put(t, rodG(a, b, 0.045, 10), yellow); put(t, rodG([7.7, 0.19, 2.35], [8.0, 0.19, 3.1], 0.02, 6), steel);
    for (const p of [[7.72, 0.14, 2.28], [7.98, 0.14, 3.17]]) put(t, wheel(0.14, 0.07), rubber, p, [0, 1.2, 0]);
    put(t, new THREE.TorusGeometry(0.07, 0.018, 8, 16), steel, [9.58, 0.19, 3.43], [Math.PI / 2, 0, 0]);
    put(t, new THREE.BoxGeometry(0.22, 0.07, 0.2), steel, [6.25, 0.19, 2.18], [0, -0.36, 0]); g.add(t); }
  // wheeled fire extinguisher
  { const f = new THREE.Group(); f.position.set(7.4, 0, -4.6); f.rotation.y = 0.5;
    put(f, new THREE.CylinderGeometry(0.16, 0.16, 0.95, 16), red, [0, 0.72, 0], [0, 0, 0.2]);
    put(f, new THREE.SphereGeometry(0.16, 14, 8, 0, 6.2832, 0, 1.5708), red, [-0.095, 1.185, 0], [0, 0, 0.2]);
    put(f, new THREE.CylinderGeometry(0.03, 0.045, 0.14, 8), steel, [-0.12, 1.3, 0], [0, 0, 0.2]);
    for (const z of [0.24, -0.24]) put(f, wheel(0.2, 0.06), rubber, [0.12, 0.2, z]);
    put(f, rodG([0.12, 0.2, -0.24], [0.12, 0.2, 0.24], 0.015, 6), steel); put(f, rodG([0.2, 0.2, 0.2], [-0.33, 1.38, 0.2], 0.014, 6), dark); put(f, rodG([0.2, 0.2, -0.2], [-0.33, 1.38, -0.2], 0.014, 6), dark);
    put(f, rodG([-0.33, 1.38, -0.2], [-0.33, 1.38, 0.2], 0.014, 6), dark);
    put(f, new THREE.TorusGeometry(0.17, 0.022, 8, 20), dark, [-0.02, 0.62, 0.19], [0, 0, 0]); put(f, new THREE.TorusGeometry(0.15, 0.022, 8, 20), dark, [-0.02, 0.64, 0.215]);
    put(f, new THREE.BoxGeometry(0.05, 0.3, 0.26), dark, [0.3, 0.15, 0], [0, 0, 0.5]); g.add(f); }
  // ground power cart with its cable run to the belly
  { const c = new THREE.Group(); c.position.set(2.2, 0, 8.6); c.rotation.y = -0.35;
    const tex = canvasTex(512, 256, (x, w, h) => { x.fillStyle = '#6d7158'; x.fillRect(0, 0, w, h); const r = rng(5);
      for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + r() * 0.05})`; x.fillRect(r() * w, r() * h, 20 + r() * 80, 4 + r() * 30); }
      x.fillStyle = '#22241e'; for (let i = 0; i < 14; i++) x.fillRect(40 + i * 14, 60, 7, 120); x.strokeStyle = '#30332a'; x.lineWidth = 3; x.strokeRect(270, 40, 200, 170); x.strokeRect(20, 30, 230, 190);
      x.fillStyle = '#d8a514'; x.fillRect(0, h - 26, w, 10); x.fillStyle = '#16171a'; for (let i = 0; i < 26; i++) { x.beginPath(); x.moveTo(i * 20, h - 26); x.lineTo(i * 20 + 10, h - 26); x.lineTo(i * 20, h - 16); x.lineTo(i * 20 - 10, h - 16); x.fill(); } }, { aniso: 4 });
    const body = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.1 });
    put(c, new THREE.BoxGeometry(2.3, 1.05, 1.25), body, [0, 0.83, 0]); put(c, new THREE.BoxGeometry(2.36, 0.07, 1.31), olive, [0, 1.39, 0]);
    put(c, new THREE.BoxGeometry(2.5, 0.09, 1.1), dark, [0, 0.3, 0]);
    for (const [x, z] of [[0.8, 0.6], [0.8, -0.6], [-0.8, 0.6], [-0.8, -0.6]]) put(c, wheel(0.24, 0.16), rubber, [x, 0.24, z]);
    put(c, rodG([1.2, 0.34, 0], [2.3, 0.2, 0], 0.03, 8), yellow); put(c, new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), dark, [-0.7, 1.67, 0.3]);
    put(c, new THREE.TorusGeometry(0.3, 0.035, 8, 22), rubber, [1.18, 0.75, 0], [0, Math.PI / 2, 0]); g.add(c);
    // cable: from the cart across the ground to the belly behind the nose gear
    const pts = [[1.3, 0.55, 8.1], [1.2, 0.045, 7.5], [0.8, 0.04, 5.5], [1.0, 0.04, 3.2], [0.5, 0.04, 1.5], [0.35, 0.05, 0.6], [0.3, gy - 0.72, 0.42]].map(p => new THREE.Vector3(p[0], p[1], p[2]));
    put(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5), 60, 0.022, 6), rubber); }
  // aluminium work stand by the forward fuselage
  { const s = new THREE.Group(); s.position.set(4.3, 0, 3.4); s.rotation.y = 1.5708;
    const leg = (x, z, h) => put(s, rodG([x, 0, z], [x, h, z], 0.018, 6), alu);
    for (const z of [0.3, -0.3]) { leg(0.0, z, 0.9); leg(0.55, z, 0.9); leg(-0.35, z, 0.6); leg(-0.7, z, 0.3); put(s, rodG([-0.85, 0.0, z], [0.0, 0.9, z], 0.018, 6), alu); put(s, rodG([0.0, 0.9, z], [0.0, 1.75, z], 0.016, 6), alu); put(s, rodG([0.55, 0.9, z], [0.55, 1.75, z], 0.016, 6), alu); put(s, rodG([0.0, 1.75, z], [0.55, 1.75, z], 0.016, 6), alu); put(s, rodG([0.0, 1.35, z], [0.55, 1.35, z], 0.012, 6), alu); put(s, rodG([-0.7, 0.3, z], [0.0, 1.75, z], 0.014, 6), alu); }
    put(s, new THREE.BoxGeometry(0.62, 0.03, 0.66), alu, [0.275, 0.9, 0]); put(s, new THREE.BoxGeometry(0.3, 0.025, 0.62), alu, [-0.2, 0.6, 0]); put(s, new THREE.BoxGeometry(0.3, 0.025, 0.62), alu, [-0.52, 0.3, 0]);
    put(s, rodG([0.55, 1.75, 0.3], [0.55, 1.75, -0.3], 0.016, 6), alu); for (const [x, z] of [[0.58, 0.32], [0.58, -0.32], [-0.83, 0.32], [-0.83, -0.32]]) put(s, wheel(0.05, 0.03), rubber, [x, 0.05, z]); g.add(s); }
  // drip tray under the engine bay, remove-before-flight streamers
  put(g, new THREE.BoxGeometry(0.7, 0.03, 0.5), std(0x2a2b2d, 0.35, 0.9), [-2.6, 0.02, 0.1]);
  const flag = (x, y, z, len, ry = 0) => { const m = put(g, new THREE.PlaneGeometry(0.045, len), new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.6, side: THREE.DoubleSide }), [x, y - len / 2, z], [0, ry, 0.06]); return m; };
  flag(ac.station.x + 0.55, gy + ac.station.y - 0.09, ac.station.z, 0.36, 0.4); flag(ac.noseGear.x + 0.05, 0.62, 0.05, 0.3, 1.2); flag(ac.mainGear.x + 0.2, 0.6, ac.mainGear.z - 0.2, 0.3, 0.3); flag(ac.mainGear.x + 0.2, 0.6, -ac.mainGear.z + 0.2, 0.3, 2.2);
  g.traverse(o => { if (o.isMesh) o.layers.set(LAYER.STATIC); });
  return g;
}

// ------------------------------------------------------------------ flight-line buildings, masts, lights, signs (field frame)
// Group origin = runway midpoint at field elevation; local +x east, +z south (world axes).
export function buildFieldFar(pipe, sunDir) {
  const g = new THREE.Group(); g.name = 'flightline';
  const r = rng(77);
  const wallTex = canvasTex(512, 512, (x, w, h) => { x.fillStyle = '#b3aa98'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 8) { x.fillStyle = `rgba(0,0,0,${0.05 + 0.05 * (i / 8 % 2)})`; x.fillRect(i, 0, 3, h); }
    for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(${r() < 0.6 ? '60,50,40' : '255,255,255'},${0.02 + r() * 0.05})`; x.fillRect(r() * w, r() * h, 6 + r() * 30, 30 + r() * 200); }
    x.fillStyle = 'rgba(40,36,30,0.25)'; x.fillRect(0, h - 40, w, 40); }, { aniso: 4, repeat: true });
  const wall = c => new THREE.MeshStandardMaterial({ color: c, map: wallTex, roughness: 0.75, metalness: 0.2 });
  const doorM = std(0x6f6b62, 0.6, 0.4), roofM = std(0xa9a69c, 0.55, 0.5), trim = std(0x3b3a37, 0.7);
  const rot = Math.atan2(-FIELD_U[1], FIELD_U[0]);      // yaw that lays a box's local +x along the runway axis (+z then points to the flight-line side)
  const shadows = [];
  // hangar: box + shallow gable roof + door band on the apron side (-v). u0..u1 along, v0..v1 across, h eave height
  const hangar = (u0, u1, v0, v1, h, c = 0xbdb4a2) => {
    const L = u1 - u0, Wd = v1 - v0, [x, z] = fieldXZ((u0 + u1) / 2, (v0 + v1) / 2), b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = rot;
    const m = wall(c); m.map = wallTex.clone(); m.map.repeat.set(L / 14, 1); m.map.needsUpdate = true;
    put(b, new THREE.BoxGeometry(L, h, Wd), m, [0, h / 2, 0], null, false);
    const rs = new THREE.Shape(); rs.moveTo(-Wd / 2 - 0.6, 0); rs.lineTo(0, Wd * 0.085); rs.lineTo(Wd / 2 + 0.6, 0); rs.closePath();
    const roof = new THREE.ExtrudeGeometry(rs, { depth: L + 1.2, bevelEnabled: false }); roof.rotateY(Math.PI / 2); roof.translate(-L / 2 - 0.6, h, 0);
    put(b, roof, roofM, null, null, false);
    put(b, new THREE.BoxGeometry(L * 0.82, h * 0.78, 0.5), doorM, [0, h * 0.39, -Wd / 2 - 0.1], null, false);          // doors face the apron
    for (let i = -3; i <= 3; i++) put(b, new THREE.BoxGeometry(0.35, h * 0.78, 0.2), trim, [i * L * 0.82 / 7, h * 0.39, -Wd / 2 - 0.4], null, false);
    put(b, new THREE.BoxGeometry(L + 0.4, 0.8, Wd + 0.4), trim, [0, h - 0.3, 0], null, false);
    g.add(b); shadows.push({ u0, u1, v0, v1, h: h + Wd * 0.04 });
  };
  hangar(40, 215, 668, 748, 24); hangar(452, 566, 655, 722, 17, 0xb8b0a2); hangar(610, 770, 660, 735, 15, 0xc2b9a6); hangar(-215, -40, 665, 742, 20, 0xb0a898);
  hangar(-470, -300, 660, 720, 13, 0xbcb4a4); hangar(820, 960, 670, 730, 12);
  const box = (u, v, L, Wd, h, c, rough = 0.75) => { const [x, z] = fieldXZ(u, v); const m = put(g, new THREE.BoxGeometry(L, h, Wd), std(c, rough, 0.1), [x, h / 2, z], [0, rot, 0], false); shadows.push({ u0: u - L / 2, u1: u + L / 2, v0: v - Wd / 2, v1: v + Wd / 2, h }); return m; };
  // low support buildings, a generic control tower, a water tank
  box(250, 700, 30, 16, 6, 0x9d968a); box(370, 716, 22, 14, 5, 0xa8a195); box(-270, 705, 26, 18, 7, 0x938c80);
  { const [x, z] = fieldXZ(-560, 760); put(g, new THREE.CylinderGeometry(3.4, 4.2, 34, 12), std(0xaaa59a, 0.8), [x, 17, z], null, false); put(g, new THREE.CylinderGeometry(6.2, 5.0, 4.4, 12), std(0x4c5560, 0.25, 0.6), [x, 36.2, z], null, false); put(g, new THREE.CylinderGeometry(6.6, 6.6, 0.6, 12), std(0x8d8a82, 0.7), [x, 38.7, z], null, false); put(g, new THREE.CylinderGeometry(0.08, 0.08, 7, 6), trim, [x, 42.5, z], null, false); shadows.push({ u0: -564, u1: -556, v0: 756, v1: 764, h: 39 }); }
  { const [x, z] = fieldXZ(1080, 800); put(g, new THREE.SphereGeometry(7, 16, 10), std(0xc9c6bd, 0.6), [x, 28, z], null, false); put(g, new THREE.CylinderGeometry(1.0, 1.4, 24, 8), std(0xc9c6bd, 0.6), [x, 12, z], null, false); }
  // flood-light masts along the back of the apron
  const steel = std(0x74777a, 0.5, 0.7), lampM = std(0xdedbd0, 0.4, 0.3);
  const mastG = new THREE.CylinderGeometry(0.16, 0.26, 26, 8), headG = new THREE.BoxGeometry(3.2, 0.8, 0.35);
  for (let u = -600; u <= 640; u += 155) { const [x, z] = fieldXZ(u, 606); put(g, mastG, steel, [x, 13, z], null, false); put(g, headG, lampM, [x, 26.2, z], [0.25, rot, 0], false); shadows.push({ u0: u - 0.25, u1: u + 0.25, v0: 605.75, v1: 606.25, h: 26.5, thin: true }); }
  // vehicles parked along the building line
  const truck = (u, v, c, ry = 0) => { const [x, z] = fieldXZ(u, v), t = new THREE.Group(); t.position.set(x, 0, z); t.rotation.y = rot + ry;
    put(t, new THREE.BoxGeometry(5.3, 0.75, 1.95), std(c, 0.45, 0.3), [0, 0.85, 0], null, false); put(t, new THREE.BoxGeometry(2.0, 0.8, 1.8), std(c, 0.45, 0.3), [0.5, 1.6, 0], null, false);
    put(t, new THREE.BoxGeometry(1.9, 0.6, 1.82), std(0x15181c, 0.15, 0.6), [0.5, 1.62, 0], null, false);
    for (const [wx, wz] of [[1.7, 0.95], [1.7, -0.95], [-1.6, 0.95], [-1.6, -0.95]]) put(t, wheel(0.38, 0.26), std(0x0c0c0d, 0.9), [wx, 0.38, wz], null, false); g.add(t); shadows.push({ u0: u - 2.7, u1: u + 2.7, v0: v - 1, v1: v + 1, h: 1.9 }); };
  truck(300, 640, 0xd8d8d2); truck(318, 646, 0x2f4a66, 0.1); truck(-90, 636, 0xd8d8d2, 3.1); truck(520, 640, 0xb8371f, 0.05);
  // long evening shadows on the ground: one soft dark quad per object, laid away from the sun. They darken the
  // terrain placeholder (alpha = shadow strength), so the deferred terrain pass lights that much less of it.
  const sh = Math.hypot(sunDir.x, sunDir.z), tanEl = Math.max(sunDir.y / sh, 0.05), ax = -sunDir.x / sh, az = -sunDir.z / sh;
  const shMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute float aK; varying float vK;\nvoid main(){ vK = aK; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}`,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying float vK;\nvoid main(){\n#include <logdepthbuf_fragment>\ngl_FragColor = vec4(0.0, 0.0, 0.0, 0.72*smoothstep(0.0, 0.25, vK));\n}`,
  });
  { const pos = [], k = [], idx = [];
    for (const s of shadows) { // shadow of a box: the footprint swept along the shadow direction
      const L = Math.min(s.h / tanEl, 420), c = [[s.u0, s.v0], [s.u1, s.v0], [s.u1, s.v1], [s.u0, s.v1]].map(p => fieldXZ(p[0], p[1]));
      // take the two footprint corners that are extreme across the shadow direction
      let lo = c[0], hi = c[0], lv = 1e9, hv = -1e9; for (const p of c) { const cr = p[0] * az - p[1] * ax; if (cr < lv) { lv = cr; lo = p; } if (cr > hv) { hv = cr; hi = p; } }
      const b = pos.length / 3, fe = s.thin ? 0.35 : 1;
      pos.push(lo[0], 0.05, lo[1], hi[0], 0.05, hi[1], hi[0] + ax * L, 0.05, hi[1] + az * L, lo[0] + ax * L, 0.05, lo[1] + az * L); k.push(fe, fe, 0, 0); idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aK', new THREE.Float32BufferAttribute(k, 1)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, shMat); m.frustumCulled = false; m.renderOrder = 2; g.add(m); }
  // runway and taxiway edge lights, distance-remaining boards on the far side of the runway
  { const postG = new THREE.CylinderGeometry(0.06, 0.07, 0.36, 6), pm = std(0xd8a514, 0.6), list = [];
    for (let u = -2280; u <= 2280; u += 61) for (const v of [48.2, -48.2]) list.push(fieldXZ(u, v));
    const im = new THREE.InstancedMesh(postG, pm, list.length), m4 = new THREE.Matrix4();
    list.forEach((p, i) => { m4.makeTranslation(p[0], 0.18, p[1]); im.setMatrixAt(i, m4); }); im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; g.add(im);
    const lensM = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.2, emissive: new THREE.Color(1.0, 0.93, 0.8), emissiveIntensity: 1.6 });
    const il = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), lensM, list.length);
    list.forEach((p, i) => { m4.makeTranslation(p[0], 0.4, p[1]); il.setMatrixAt(i, m4); }); il.instanceMatrix.needsUpdate = true; il.frustumCulled = false; g.add(il);
    for (let k = 1; k <= 14; k++) { const u = -2290 + k * 305, [x, z] = fieldXZ(u, -62);
      const tex = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#0d0d0d'; c.fillRect(0, 0, w, h); c.strokeStyle = '#e8e8e4'; c.lineWidth = 5; c.strokeRect(5, 5, w - 10, h - 10); c.fillStyle = '#eeeeea'; c.font = '700 96px "Saira Condensed", Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(15 - k), w / 2, h / 2 + 8); }, { aniso: 4 });
      const b = put(g, new THREE.BoxGeometry(1.2, 1.2, 0.12), [std(0x151515), std(0x151515), std(0x151515), std(0x151515), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })], [x, 0.95, z], [0, rot, 0], false);
      put(g, new THREE.BoxGeometry(0.08, 0.5, 0.08), std(0x333333), [x, 0.2, z], null, false); }
    // wind cone
    const [wx, wz] = fieldXZ(-340, -120); put(g, new THREE.CylinderGeometry(0.05, 0.07, 6, 6), std(0xe8e8e4, 0.5), [wx, 3, wz], null, false);
    const sock = new THREE.CylinderGeometry(0.42, 0.2, 2.6, 12, 1, true); sock.rotateZ(Math.PI / 2); put(g, sock, new THREE.MeshStandardMaterial({ color: 0xe2571a, roughness: 0.8, side: THREE.DoubleSide }), [wx + 1.2, 5.8, wz + 0.5], [0, 0.6, -0.12], false);
  }
  g.traverse(o => { if (o.isMesh) { o.layers.set(LAYER.STATIC); o.castShadow = false; } });
  return g;
}

// ------------------------------------------------------------------ scrub on the unpaved ground beside the runway
// Same construction as film 1: ragged instanced shrubs, one mesh per cell so cells outside the view are skipped,
// plus a soft shadow streak per plant. Group origin = runway midpoint.
export function buildScrub(pipe, sunDir) {
  const rnd = rng(20260715);
  const lumpy = (detail, amt) => { const b = new THREE.IcosahedronGeometry(1, detail); const p = b.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amt * Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 5.7 + x * 2.1); p.setXYZ(i, x * k, Math.max(y, -0.25) * k, z * k); } b.computeVertexNormals(); return b; };
  const N = pipe.quality.lowTerrain ? 26000 : 110000;
  const bushMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: pipe.shared.uSunDir, uSunColor: pipe.shared.uSunColor, tAmbient: pipe.shared.tAmbient },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform vec3 uSunDir, uSunColor; uniform sampler2D tAmbient; varying vec3 vSun, vAmb, vP; varying float vRim;
      void main(){
        vec4 wp = modelMatrix*instanceMatrix*vec4(position,1.0);
        vec3 n = normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normalize(position));
        float up = clamp(position.y*0.7+0.5, 0.0, 1.0);
        float nl = max(dot(n, uSunDir), 0.0)*0.8+0.2*max(dot(n, uSunDir)*0.5+0.5, 0.0);
        vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
        vSun = instanceColor*0.3183*uSunColor*nl*(0.3+0.7*up); vAmb = instanceColor*0.3183*amb*(0.3+0.7*up);
        vP = position*(4.0+3.0*fract(instanceColor.r*91.7));
        vec4 mv = viewMatrix*wp;
        vRim = abs(dot(normalize(mat3(viewMatrix)*n), normalize(-mv.xyz)));
        gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vSun, vAmb, vP; varying float vRim;
      float h3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 c = floor(vP*2.6); float a = h3(c), b = h3(c+7.3);
        if (vRim < 0.5 && a > vRim*1.7+0.12) discard;
        #include <logdepthbuf_fragment>
        float gap = step(0.3, b);
        gl_FragColor = vec4(vSun*(0.25+0.95*gap)*(0.7+0.6*a)+vAmb*(0.55+0.45*gap), 1.0);
      }`,
  });
  const bushGeo = lumpy(1, 0.34), cells = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const patch = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(z * 0.004) * 2.1) * Math.cos(z * 0.0075 + Math.sin(x * 0.006) * 1.7);
  let n = 0, guard = 0;
  while (n < N && guard++ < N * 30) {
    // field coordinates: mostly the far side of the runway and the infield, thinning with distance
    const u = (rnd() * 2 - 1) * 2300, far = rnd() < 0.78, v = far ? -58 - Math.pow(rnd(), 1.6) * 900 : 58 + rnd() * 164;
    if (!far && (Math.abs(u - 40) < 16 || Math.abs(Math.abs(u) - 1150) < 16 || Math.abs(Math.abs(u) - 2262) < 16)) continue;   // taxiway connectors
    if (far && Math.abs(v + 96) < 4.5) continue;                                                                                // perimeter track
    if (rnd() > (0.22 + 0.78 * patch(u, v)) * (far ? 1 : 0.5)) continue;
    const [x, z] = fieldXZ(u, v);
    const grass = rnd() < 0.3, w = grass ? 0.16 + rnd() * 0.2 : 0.28 + rnd() * 0.55, h = grass ? 0.2 + rnd() * 0.22 : w * (0.6 + rnd() * 0.6);
    ps.set(x, h * 0.2, z); q.setFromAxisAngle(up, rnd() * 6.28); sc.set(w, h, w * (0.8 + rnd() * 0.4));
    m4.compose(ps, q, sc);
    if (grass) col.setRGB(0.37 + rnd() * 0.12, 0.31 + rnd() * 0.1, 0.18 + rnd() * 0.06); else { const k = rnd(); col.setRGB(0.05 + k * 0.035, 0.058 + k * 0.035, 0.034 + k * 0.02); }
    const key = Math.floor((x + 3000) / 180) + 64 * Math.floor((z + 3000) / 180);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ m: m4.clone(), c: col.clone(), w, h, x, z }); n++;
  }
  const bush = new THREE.Group(); bush.name = 'scrub';
  const sh = Math.hypot(sunDir.x, sunDir.z), tanEl = Math.max(sunDir.y / sh, 0.05), ax = -sunDir.x / sh, az = -sunDir.z / sh;
  const shGeo = new THREE.PlaneGeometry(1, 1); shGeo.rotateX(-Math.PI / 2); shGeo.translate(0.5, 0, 0);
  const shMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix*viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec2 vUv;
      void main(){
        #include <logdepthbuf_fragment>
        float across = 1.0-smoothstep(0.12, 0.5, abs(vUv.y-0.5)*(1.0+vUv.x*0.5));
        float along = smoothstep(0.0, 0.06, vUv.x)*(1.0-smoothstep(0.45, 1.0, vUv.x));
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.62*across*along);
      }`,
  });
  const bx = new THREE.Vector3(), by = new THREE.Vector3(0, 1, 0), bz = new THREE.Vector3();
  for (const [, list] of cells) {
    const im = new THREE.InstancedMesh(bushGeo, bushMat, list.length), sm = new THREE.InstancedMesh(shGeo, shMat, list.length);
    let cx = 0, cz = 0;
    list.forEach((it, k) => {
      im.setMatrixAt(k, it.m); im.setColorAt(k, it.c); cx += it.x; cz += it.z;
      const L = Math.min(1.25 * it.h / tanEl, 14), wd = it.w * 1.9;
      bx.set(ax * L, 0, az * L); bz.set(-az * wd, 0, ax * wd); m4.makeBasis(bx, by, bz); m4.setPosition(it.x - ax * it.w * 0.4, 0.03, it.z - az * it.w * 0.4);
      sm.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.frustumCulled = true;
    sm.instanceMatrix.needsUpdate = true; sm.computeBoundingSphere(); sm.frustumCulled = true; sm.renderOrder = 2;
    im.userData = sm.userData = { cx: cx / list.length, cz: cz / list.length, n: list.length };
    im.layers.set(LAYER.STATIC); sm.layers.set(LAYER.STATIC); im.castShadow = sm.castShadow = false;
    bush.add(im, sm);
  }
  return bush;
}
