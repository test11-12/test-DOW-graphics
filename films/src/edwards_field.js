// Edwards flight line, as dressed for the film: ground equipment around the parked aircraft, hangars and light
// masts beyond the apron, runway edge lights and signs, and scrub on the unpaved ground. The pavements themselves
// are painted by the terrain recipe (terrain_mojave.js). Generic airfield furniture only: no unit markings.
import * as THREE from 'three';
import { LAYER } from '../engine/pipeline.js';
import { canvasTex, rng } from '../engine/geo.js';
import { loadGLB, hasAsset } from '../engine/assets.js';
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
// (+x towards its nose, +z to its right, y up from the pavement). The props are modelled and baked from photoscans in
// Blender (blender/fury_ramp.py -> assets/fury/ramp.glb, one node per prop, origin on the ground); this lays them out.
// ac: the FURY description from fury_model.js
export async function buildRamp(pipe, ac) {
  const g = new THREE.Group(); g.name = 'ramp';
  const gy = -ac.groundY;                      // height of the aircraft origin above the pavement
  if (hasAsset('fury/ramp.glb')) {
    const { root } = await loadGLB('fury/ramp.glb', pipe, { envIntensity: 1.0 });
    const proto = {};
    root.traverse(o => { if (o.isMesh) proto[o.name] = o; });
    const add = (name, x, z, yaw = 0, cast = true) => {
      const p = proto[name]; if (!p) return null;
      const m = p.clone(); m.position.set(x, 0, z); m.rotation.set(0, yaw, 0); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m;
    };
    // chocks either side of each wheel, the rope outboard
    add('chocks_main', ac.mainGear.x, ac.mainGear.z, 0); add('chocks_main', ac.mainGear.x, -ac.mainGear.z, Math.PI);
    add('chocks_nose', ac.noseGear.x, 0, 0.0);
    // cones off the wingtips, the nose and the tail
    const wt = ac.wingTip;
    for (const [x, z, a] of [[wt.x - 0.4, wt.z + 0.75, 0.3], [wt.x - 0.4, -wt.z - 0.75, 1.1], [ac.noseX + 1.3, 0.9, 0.2], [ac.tailX - 1.1, -1.3, 0.7], [ac.tailX - 0.9, 2.1, 2.0]]) add('cone', x, z, a);
    add('towbar', ac.noseX + 0.9, 1.5, -0.38);                              // lying ahead of the nose, ready to hook up
    add('extinguisher', ac.noseX + 2.4, -4.4, 2.3);                        // wheeled flight-line extinguisher
    add('gpu', 2.0, 7.9, Math.PI - 0.32);                                  // power cart off the right wing
    add('stand', 3.4, 2.1, Math.PI / 2);                                 // platform stand by the forward fuselage
    add('driptray', -2.6, 0.08, 0.1, false);
    // the neighbouring stand on the left, dressed but empty, and a cart further down the line (reads as a working ramp)
    add('gpu', -1.5, -38.5, 0.25); add('cone', 2.0, -33.2, 0.4); add('cone', -6.0, -36.5, 1.2); add('stand', 4.2, -37.8, 0.7);
    add('chocks_main', 0.6, -36.0, 1.57); add('extinguisher', 6.5, -40.5, 2.9);
    add('gpu', -9.0, 31.0, 1.9); add('cone', -3.5, 34.0, 0.3);
  }
  // power cable from the cart to a receptacle aft of the nose gear
  const cable = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.62, metalness: 0.0 });
  const pts = [[3.1, 0.8, 8.1], [3.0, 0.05, 7.5], [1.6, 0.03, 5.4], [1.4, 0.03, 3.4], [0.75, 0.03, 1.7], [0.5, 0.04, 0.7], [0.4, gy - 0.72, 0.42]].map(p => new THREE.Vector3(p[0], p[1], p[2]));
  put(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5), 80, 0.021, 8), cable);
  // remove-before-flight streamers (plain red: their lettering is not legible at this distance and is not reproduced)
  const flagM = new THREE.MeshStandardMaterial({ color: 0x9c1414, roughness: 0.75, side: THREE.DoubleSide });
  const flag = (x, y, z, len, ry = 0) => put(g, new THREE.PlaneGeometry(0.05, len, 1, 4), flagM, [x, y - len / 2, z], [0, ry, 0.05]);
  flag(ac.station.x + 0.55, gy + ac.station.y - 0.09, ac.station.z, 0.36, 0.4); flag(ac.noseGear.x + 0.05, 0.62, 0.05, 0.3, 1.2); flag(ac.mainGear.x + 0.2, 0.6, ac.mainGear.z - 0.2, 0.3, 0.3); flag(ac.mainGear.x + 0.2, 0.6, -ac.mainGear.z + 0.2, 0.3, 2.2);
  g.traverse(o => { if (o.isMesh) o.layers.set(LAYER.STATIC); });
  return g;
}

// The parked aircraft's tyres as they stand on the ramp (blender/fury_ramp.py -> assets/fury/tyres.glb): ribbed tread
// with dust in the grooves, a scuffed crown, a flattened contact patch. They replace the plain lathe tyres of the
// code-built airframe, which are found by what they are (a lathe about the axle in near-black rubber); a model
// that brings its own tyres is left alone. Call before the aircraft is registered as dynamic. Returns the count.
export async function dressTyres(pipe, acRoot) {
  if (!hasAsset('fury/tyres.glb')) return 0;
  const hits = [];
  acRoot.traverse(o => { if (o.isMesh && o.geometry.type === 'LatheGeometry' && o.material.color && o.material.color.getHex() === 0x0b0b0c) hits.push(o); });
  if (!hits.length) return 0;
  const { root } = await loadGLB('fury/tyres.glb', pipe, { envIntensity: 1.0 });
  const proto = {}; root.traverse(o => { if (o.isMesh) proto[o.name] = o; });
  let n = 0;
  for (const old of hits) {
    old.geometry.computeBoundingBox(); const r = old.geometry.boundingBox.max.y;   // tread radius: the wheel centre stands this far above the pavement
    const p = r > 0.2 ? proto.tyre_main : proto.tyre_nose; if (!p) continue;
    const m = p.clone(); m.position.set(old.position.x, old.position.y - r, old.position.z); old.parent.add(m); old.visible = false; n++;
  }
  return n;
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
