// FOX THREE — Anduril YFQ-44A "Fury", first live missile shot by a U.S. Collaborative Combat Aircraft.
// A simulated visualization. What is documented: the Air Force announced the test on July 15, 2026; the
// aircraft took off from Edwards AFB; it fired one AIM-120 AMRAAM in secluded airspace over the Mojave
// Desert at a "digital" (simulated) target; a human operator tasked the aircraft to engage. Everything
// else on screen (time of day, altitude, speed, flight path, ranges, the engagement plot, which wing
// carried the missile, the slow-motion launch) is illustrative.
import * as THREE from 'three';
import { startFilm, clamp, lerp, smooth, ease, easeOut, curve, wobble, v3 } from '../engine/film.js';
import { LAYER } from '../engine/pipeline.js';
import { Terrain } from '../engine/terrain.js';
import { attitude } from '../engine/geo.js';
import { makePlume, makeHeatHaze, makeGlow, Trail } from '../engine/fx.js';
import { MOJAVE_TERRAIN, FIELD_ALT } from './terrain_mojave.js';
import { buildFury, buildAmraam, FURY } from './fury_model.js';

const NARRATION = __NARRATION__;
const D = Math.PI / 180;
const SUN = { az: 255, el: 31 };                       // afternoon, west-south-west
const GROUND_Y = FIELD_ALT - FURY.groundY + 0.03;      // aircraft origin height when on its wheels
const RAMP = { x: -255, z: 1480, hdg: 345 };            // parking spot on the apron
const DUR = 79;

// ------------------------------------------------------------------ airfield (runway along z, apron to the west)
const CONCRETE_FN = /* glsl */`
uniform float uKind;   // 0 runway, 1 apron / taxiway
float box(float a, float b, float x){ float w = fwidth(x)*0.75+1e-5; return smoothstep(a-w, a+w, x)-smoothstep(b-w, b+w, x); }
vec4 concreteColor(vec2 p){
  float sl = mix(7.62, 6.1, uKind);
  vec2 s = p/sl, f = abs(fract(s)-0.5), id = floor(s);
  float jw = max(fwidth(s.x), fwidth(s.y));
  float joint = smoothstep(0.5-0.004-jw, 0.5-jw*0.3, max(f.x,f.y))*clamp(0.012/max(jw,1e-4), 0.0, 1.0);
  float tone = 0.9+0.2*fract(sin(dot(id, vec2(12.9898,78.233)))*43758.5453);
  float n1 = texture2D(tDetail, p*0.011).r, n2 = texture2D(tDetail, p*0.09).g, n3 = texture2D(tDetail, p*0.9).r;
  vec3 c = vec3(0.50,0.49,0.455)*tone*(0.8+0.25*n1)*(0.9+0.2*n2)*(0.92+0.16*n3);
  c = mix(c, vec3(0.14,0.13,0.12), joint*0.8);
  // tar-sealed cracks and oil spots
  float crack = smoothstep(0.012, 0.0, abs(texture2D(tDetail, p*0.035).g-0.5))*step(0.55, n1);
  c = mix(c, vec3(0.07,0.07,0.07), crack*0.7);
  c *= 1.0-0.35*smoothstep(0.72, 0.9, texture2D(tDetail, p*0.07+0.4).r)*uKind;
  float paint = 0.0; vec3 pc = vec3(0.84,0.83,0.78); float rough = 0.93;
  if (uKind < 0.5){
    float az = abs(p.y), ax = abs(p.x);
    float tz = smoothstep(2250.0,1950.0,az)*smoothstep(1300.0,1700.0,az);
    float streak = texture2D(tDetail, vec2(p.x*0.3, p.y*0.004)).r;
    c = mix(c, vec3(0.06), tz*smoothstep(16.0,4.0,ax)*smoothstep(0.3,0.75,streak)*0.8);
    paint = box(42.4, 43.5, ax);
    paint = max(paint, box(-0.45, 0.45, p.x)*box(0.0, 36.6, mod(p.y+2290.0, 61.0))*step(az, 2200.0));
    paint = max(paint, box(2215.0, 2262.0, az)*box(2.0, 40.0, ax)*box(0.0, 0.5, fract(ax/3.6)));
    paint = max(paint, box(1930.0, 1978.0, az)*box(10.0, 21.0, ax));
    rough -= 0.12*tz;
  } else {
    // taxi lines: yellow, with black borders worn thin
    float l = max(box(-0.09, 0.09, p.x-30.0)*step(p.y, 46.0), box(-0.09, 0.09, p.y-46.0)*step(30.0, p.x));
    paint = l; pc = vec3(0.80,0.62,0.10);
  }
  float wear = 0.5+0.5*texture2D(tDetail, p*0.21).g;
  c = mix(c, pc*wear, paint*0.92);
  return vec4(c, mix(rough, 0.8, paint));
}`;

function buildAirfield(pipe) {
  const g = new THREE.Group(); g.name = 'airfield';
  const concrete = kind => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.tDetail = pipe.shared.tDetail; sh.uniforms.uKind = { value: kind };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRw;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRw = position.xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vRw; uniform sampler2D tDetail;\n${CONCRETE_FN}`)
        .replace('#include <map_fragment>', '#include <map_fragment>\nvec4 rw = concreteColor(vRw); diffuseColor.rgb = rw.rgb;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rw.a;');
    };
    return mat;
  };
  const slab = (w, l, x, z, kind, y = 0.02) => { const geo = new THREE.PlaneGeometry(w, l, 1, Math.max(1, Math.round(l / 40))); geo.rotateX(-Math.PI / 2); const m = new THREE.Mesh(geo, concrete(kind)); m.position.set(x, y, z); m.receiveShadow = true; g.add(m); return m; };
  slab(91, 4580, 0, 0, 0);                                    // main runway
  slab(270, 400, -285, 1450, 1, 0.025);                       // apron
  { const geo = new THREE.PlaneGeometry(106, 30); geo.rotateX(-Math.PI / 2); const m = new THREE.Mesh(geo, concrete(1)); m.position.set(-98, 0.02, 1480); m.receiveShadow = true; g.add(m); }
  const asph = new THREE.MeshStandardMaterial({ color: 0x2b2a29, roughness: 0.95 });
  for (const sx of [-1, 1]) { const sh = new THREE.PlaneGeometry(10, 4580); sh.rotateX(-Math.PI / 2); const m = new THREE.Mesh(sh, asph); m.position.set(sx * 50.5, 0.0, 0); g.add(m); }

  // scrub on the base side of the runway, thinning out towards the lakebed
  const rnd = (() => { let s = 20260715; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const lumpy = (detail, amt) => { const b = new THREE.IcosahedronGeometry(1, detail); const p = b.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amt * Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 5.7 + x * 2.1); p.setXYZ(i, x * k, Math.max(y, -0.25) * k, z * k); } b.computeVertexNormals(); return b; };
  const N = pipe.quality.lowTerrain ? 24000 : 90000;
  const bush = new THREE.InstancedMesh(lumpy(1, 0.22), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const patch = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.012 + Math.sin(z * 0.0045) * 2.1) * Math.cos(z * 0.008 + Math.sin(x * 0.007) * 1.7);
  let n = 0, guard = 0;
  while (n < N && guard++ < N * 40) {
    const x = -1340 + rnd() * 1900, z = (rnd() * 2 - 1) * 2700;
    if (Math.abs(x) < 58) continue;
    if (x > -428 && x < -142 && z > 1242 && z < 1658) continue;
    if (x > -152 && x < -44 && z > 1460 && z < 1500) continue;
    const east = x > 0 ? 0.3 * (1 - x / 620) : 1;
    if (rnd() > (0.2 + 0.8 * patch(x, z)) * east) continue;
    const grass = rnd() < 0.25, w = grass ? 0.15 + rnd() * 0.2 : 0.3 + rnd() * 0.55, h = grass ? 0.18 + rnd() * 0.2 : w * (0.55 + rnd() * 0.6);
    ps.set(x, -0.12 + h * 0.2, z); q.setFromAxisAngle(up, rnd() * 6.28); sc.set(w, h, w * (0.8 + rnd() * 0.4));
    m4.compose(ps, q, sc); bush.setMatrixAt(n, m4);
    if (grass) col.setRGB(0.38 + rnd() * 0.12, 0.33 + rnd() * 0.1, 0.2 + rnd() * 0.06); else { const k = rnd(); col.setRGB(0.06 + k * 0.04, 0.068 + k * 0.04, 0.04 + k * 0.022); }
    bush.setColorAt(n, col); n++;
  }
  bush.count = n; bush.instanceMatrix.needsUpdate = true; bush.instanceColor.needsUpdate = true; bush.frustumCulled = false; g.add(bush);

  // flight-line buildings well west of the apron, light poles along its edge
  const bld = (x, z, w, d, h, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.15 })); m.position.set(x, h / 2 - 0.1, z); g.add(m); };
  bld(-640, 1320, 110, 150, 24, 0x9a968c); bld(-650, 1560, 90, 120, 20, 0x8d897f); bld(-620, 1760, 60, 70, 12, 0xa19d93); bld(-560, 1180, 14, 14, 30, 0xb0aca2);
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c8f92, roughness: 0.5, metalness: 0.8 });
  for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 16, 8), steel); m.position.set(-424, 8, 1270 + i * 76); g.add(m); }
  g.traverse(o => { if (o.isMesh) { o.layers.set(LAYER.STATIC); o.castShadow = false; } });
  return { group: g, bush };
}

// ------------------------------------------------------------------ flight / engagement kinematics (illustrative)
// sim time `sig` is seconds from missile ignition; each shot maps film time onto it (the launch runs in slow motion)
const V = 245;                                          // m/s true airspeed
const LAUNCH = v3(38000, 9600, -38000);                 // northbound over the R-2508 ranges
const T_IGN = 47.8, SLOW = 0.3;
const BRK = (() => { // gentle left break for the last shot, integrated once
  const dt = 1 / 60, n = 1200, A = new Float64Array(n * 5); let x = 0, z = 0, y = 0, hdg = 0;
  for (let i = 0; i < n; i++) { const tau = i * dt, roll = -42 * ease(clamp((tau - 1.2) / 2.4)); A.set([x, y, z, hdg, roll], i * 5);
    hdg += 9.81 * Math.tan(roll * D) / V / D * dt; x += Math.sin(hdg * D) * V * dt; z -= Math.cos(hdg * D) * V * dt; y += (roll < -5 ? 4 : 0) * dt; }
  return { A, dt, n };
})();
function acAt(sig, out = { p: v3(), hdg: 0, pitch: 2.2, roll: 0 }) {
  if (sig < 70) { out.p.copy(LAUNCH); out.p.z -= V * sig; out.hdg = 0; out.roll = wobble(sig * 0.7, 3) * 0.8; }
  else { const f = clamp((sig - 70) / BRK.dt, 0, BRK.n - 1.001), i = Math.floor(f), k = f - i, A = BRK.A, a = i * 5, b = a + 5;
    out.p.set(LAUNCH.x + lerp(A[a], A[b], k), LAUNCH.y + lerp(A[a + 1], A[b + 1], k), LAUNCH.z - V * 70 + lerp(A[a + 2], A[b + 2], k)); out.hdg = lerp(A[a + 3], A[b + 3], k); out.roll = lerp(A[a + 4], A[b + 4], k) + wobble(sig * 0.7, 3) * 0.6; }
  out.pitch = 2.2 + wobble(sig * 0.9, 5) * 0.2;
  return out;
}
// missile displacement from its rail position: forward d, up h (m), flight-path pitch (deg), burn 0..1
function mslRel(sig) {
  if (sig <= 0) return { d: 0, h: 0, pitch: 0, burn: 0 };
  const a = 250, tb = 3.8, d = sig < tb ? 0.5 * a * sig * sig : 0.5 * a * tb * tb + a * tb * (sig - tb), vr = sig < tb ? a * sig : a * tb;
  const u = Math.max(0, sig - 0.45), h = u < 3 ? 5.5 * u * u : 49.5 + 33 * (u - 3), vu = u < 3 ? 11 * u : 33;
  return { d, h, pitch: Math.atan2(vu, V + vr) / D, burn: 1 };
}
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), tA = v3(), tB = v3();
function mslWorld(sig, out = v3(), tail = false) {
  const s = acAt(Math.min(sig, 69.9)), r = mslRel(sig);
  attitude(s.hdg, sig <= 0 ? s.pitch : 0, sig <= 0 ? s.roll : 0, q1);
  out.copy(FURY.station); if (tail) out.x -= 1.83;
  out.applyQuaternion(q1).add(s.p);
  out.z -= r.d; out.y += r.h;      // heading is due north during the engagement
  return out;
}

// ------------------------------------------------------------------ world
let W;
async function build(film) {
  const pipe = film.pipe;
  pipe.atmo.setSun(SUN.az, SUN.el);
  pipe.atmo.uniforms.uHaze.value = 0.6; pipe.atmo.groundAlbedo.setRGB(0.33, 0.28, 0.22);
  const nearRes = film.quality.lowTerrain ? 1024 : (+film.params.get('nres') || 4096);
  const terrain = new Terrain(pipe, { ...MOJAVE_TERRAIN, near: { ...MOJAVE_TERRAIN.near, res: nearRes }, far: { ...MOJAVE_TERRAIN.far, res: film.quality.lowTerrain ? 1024 : 2048 } });
  const field = buildAirfield(pipe); pipe.scene.add(field.group);
  const ac = buildFury(pipe); pipe.scene.add(ac);
  const haze = makeHeatHaze(pipe, { length: 22, radius: 0.24, spread: 3.0, strength: 0.0026 }); haze.position.set(FURY.nozzleX, FURY.nozzleY, 0); ac.add(haze);
  pipe.registerDynamic(ac);
  const msl = buildAmraam(pipe); pipe.scene.add(msl);
  const plume = makePlume(pipe, { length: 5.2, radius: 0.07, diamonds: 7, color: [1.0, 0.46, 0.14], core: [1.0, 0.86, 0.62] }); plume.position.set(msl.userData.tailX, 0, 0); msl.add(plume);
  const glow = makeGlow(pipe, { color: [1.0, 0.72, 0.42], size: 1.5, depthSoft: 0.6 }); glow.position.set(msl.userData.tailX - 0.25, 0, 0); msl.add(glow);
  const mhaze = makeHeatHaze(pipe, { length: 26, radius: 0.12, spread: 5.0, strength: 0.0034 }); mhaze.position.set(msl.userData.tailX, 0, 0); msl.add(mhaze);
  const lamp = new THREE.PointLight(new THREE.Color(1.0, 0.68, 0.38), 0, 45, 2); lamp.position.set(msl.userData.tailX - 0.6, 0, 0); msl.add(lamp);
  pipe.registerDynamic(msl);
  const smoke = new Trail(pipe, { rate: 150, life: 5.5, size0: 0.22, size1: 4.2, grow: 0.55, color: [0.93, 0.93, 0.95], alpha: 0.3, jitter: 0.12, drift: [0.4, 0.25, 0], drag: 3.0, spreadV: 1.6, lit: 1, emissive: [9, 4.2, 1.4], emissiveLife: 0.012, softness: 1.2, fadeIn: 0.012 });
  W = { terrain, field, ac, haze, msl, plume, glow, mhaze, lamp, smoke };
  return W;
}

// ------------------------------------------------------------------ pose helpers
function setMissile(film, sig, t) {
  const r = mslRel(sig), s = acAt(Math.min(sig, 69.9));
  mslWorld(sig, tA); film.place(W.msl, tA);
  if (sig <= 0) attitude(s.hdg, s.pitch, s.roll, W.msl.quaternion);
  else attitude(0, 2.2 * Math.exp(-sig * 2) + r.pitch, 0, W.msl.quaternion);
  const flash = sig > 0 ? 1 + 2.6 * Math.exp(-sig / 0.05) : 0, flick = 0.9 + 0.1 * Math.sin(t * 190) + 0.05 * Math.sin(t * 517);
  W.msl.userData.setBurn(r.burn); W.plume.userData.set(r.burn, 5.5 * flick); W.glow.userData.set(r.burn * (2.2 + 3.5 * (flash - 1)) * flick, 1.25 + 0.8 * (flash - 1) * 0.3);
  W.mhaze.userData.set(r.burn); W.lamp.intensity = r.burn * 70 * flash * flick;
  W.msl.visible = true;
}
function poseAir(film, sig, t, o = {}) {
  const s = acAt(sig);
  film.place(W.ac, s.p); attitude(s.hdg, s.pitch + (o.bump ?? 0), s.roll, W.ac.quaternion);
  W.ac.userData.setGear(false); W.haze.userData.set(o.haze ?? 0.8);
  if (o.missile === false) { W.msl.visible = false; W.lamp.intensity = 0; W.plume.userData.set(0); W.glow.userData.set(0); W.mhaze.userData.set(0); }
  else setMissile(film, o.mslSig ?? sig, t);
  W.field.group.visible = false;
  return s;
}
function poseGround(film, x, z, y, hdg, pitch, haze = 0) {
  tA.set(x, y, z); film.place(W.ac, tA); attitude(hdg, pitch, 0, W.ac.quaternion);
  W.ac.userData.setGear(true); W.haze.userData.set(haze);
  tB.copy(FURY.station).applyQuaternion(W.ac.quaternion).add(tA); film.place(W.msl, tB); W.msl.quaternion.copy(W.ac.quaternion); W.msl.visible = true;
  W.msl.userData.setBurn(0); W.plume.userData.set(0); W.glow.userData.set(0); W.mhaze.userData.set(0); W.lamp.intensity = 0;
  W.field.group.visible = true; tB.set(0, FIELD_ALT, 0); film.place(W.field.group, tB);
}
// point given in the aircraft's body axes [forward, up, right]; full attitude if `rigid`
function body(s, off, rigid = false, out = v3()) {
  attitude(s.hdg, rigid ? s.pitch : 0, rigid ? s.roll : 0, q2);
  return out.set(off[0], off[1], off[2]).applyQuaternion(q2).add(s.p);
}
const rampState = { p: v3(RAMP.x, GROUND_Y, RAMP.z), hdg: RAMP.hdg, pitch: 0, roll: 0 };
// take-off run for the tracking shot (time-cut into the roll); heads north
function roll(tau) {
  const v0 = 56, a = 3.4, s = v0 * tau + 0.5 * a * tau * tau, tl = 2.7, c = Math.max(0, tau - tl);
  return { z: 300 - s, y: GROUND_Y + Math.min(0.5 * 2.6 * c * c, 0.5 * 2.6 * 16 + 10.4 * Math.max(0, c - 4)), pitch: 8.5 * smooth(1.7, 2.9, tau) + 2.5 * smooth(2.9, 6, tau) };
}

const CIRRUS = { alt: 12400, cover: 0.3, opacity: 0.42, scale: 1.3, wind: [0.003, 0.001] };
const GROUND_POST = { exposure: 0.2, contrast: 1.3, sat: 1.18, wb: [1.07, 1.0, 0.9], aerial: 0.9, grain: 0.04, bloom: 0.07, cirrus: CIRRUS };
const AIR_POST = { exposure: 0.19, contrast: 1.32, sat: 1.2, wb: [1.06, 1.0, 0.91], aerial: 0.8, grain: 0.035, bloom: 0.065, cirrus: { ...CIRRUS, alt: 13600 } };
const PLOT_POST = { exposure: 0.105, contrast: 1.2, sat: 0.32, wb: [0.86, 0.95, 1.08], aerial: 0.45, grain: 0.03, bloom: 0.03, vignette: 0.45, cirrus: null, shutter: 0 };
const plotCam = (lt, off) => ({ pos: v3(31000 + off + lt * 14, 46000, -31000 - lt * 22), look: v3(31000 + off + lt * 14, 0, -31000 - lt * 22), up: v3(0, 0, -1), fov: 40 });

const SIG = {   // film time -> sim time for each airborne shot
  s05: t => -30 + (t - 28.8), s07: t => -3.4 + (t - 44.0), s08: t => SLOW * (t - T_IGN),
  s09: t => SLOW * (52 - T_IGN) + (t - 52), s11: t => 40 + (t - 65.3), s12: t => 68.6 + (t - 72.3),
};

const shots = [
  { id: 's01', name: 'Ramp', t0: 0, t1: 6.2, terrain: 'ground', note: 'Low and wide on the Edwards apron in afternoon light: a fighter-sized jet with no canopy.',
    pose: (lt, t, f) => poseGround(f, RAMP.x, RAMP.z, GROUND_Y, RAMP.hdg, 0),
    camera: (lt) => { const k = ease(lt / 6.4); return { pos: body(rampState, [14.5 - 3.4 * k, -0.52 + 0.1 * k, -9.4 + 1.6 * k]), look: body(rampState, [1.2, -0.25, -0.2]), fov: 25, shake: { rot: 0.02, freq: 0.3, seed: 1 }, focus: rampState.p.clone(), focusRadius: 8 }; },
    post: { ...GROUND_POST, shimmer: [0.8, 26, 400] } },
  { id: 's02', name: 'No cockpit', t0: 6.2, t1: 14.3, terrain: 'ground', note: 'Slider down the sunlit port side: chined nose, splinter paint, the designation.',
    pose: (lt, t, f) => poseGround(f, RAMP.x, RAMP.z, GROUND_Y, RAMP.hdg, 0),
    camera: (lt) => { const k = ease(lt / 8.3); return { pos: body(rampState, [6.4 - 6.9 * k, 0.32, -7.4]), look: body(rampState, [4.6 - 5.4 * k, 0.02, 0]), fov: 24, shake: { rot: 0.025, freq: 0.35, seed: 2 }, focus: rampState.p.clone(), focusRadius: 8 }; },
    post: { ...GROUND_POST, exposure: 0.19 } },
  { id: 's03', name: 'The weapon', t0: 14.3, t1: 22.3, terrain: 'ground', note: 'Under the wing: an AIM-120 on its rail launcher, radome to fins.',
    pose: (lt, t, f) => poseGround(f, RAMP.x, RAMP.z, GROUND_Y, RAMP.hdg, 0),
    camera: (lt) => { const k = ease(lt / 8.2); return { pos: body(rampState, [4.3 - 3.9 * k, -0.86 + 0.16 * k, -4.9 + 0.5 * k]), look: body(rampState, [1.75 - 2.1 * k, -0.55, -1.75]), fov: 23, shake: { rot: 0.02, freq: 0.3, seed: 3 }, focus: body(rampState, [0, -0.3, -1.4]), focusRadius: 5 }; },
    post: { ...GROUND_POST, exposure: 0.215 } },
  { id: 's04', name: 'Take-off', t0: 22.3, t1: 28.8, terrain: 'ground', note: 'Long lens from the base side of the runway: rotation, wheels off, Rogers Dry Lake behind.',
    pose: (lt, t, f) => { const r = roll(lt); poseGround(f, 0, r.z, r.y, 0, r.pitch, 1.3); },
    camera: (lt) => { const r = roll(lt), l = roll(lt - 0.1); return { pos: v3(-345, FIELD_ALT + 6.5, -70), look: v3(0, lerp(l.y, FIELD_ALT + 4, 0.1) + 0.2, l.z - 2.5), fov: 3.5 - 0.35 * smooth(2, 6.5, lt), shake: { rot: 0.018, freq: 1.3, seed: 4 }, focus: v3(0, r.y, r.z), focusRadius: 8 }; },
    post: { ...GROUND_POST, shimmer: [1.5, 30, 280], exposure: 0.2 } },
  { id: 's05', name: 'Closed airspace', t0: 28.8, t1: 33.6, terrain: 'air', note: 'Air-to-air from high on the port quarter over Mojave ranges and dry lakes; missile on the left wing.',
    pose: (lt, t, f) => poseAir(f, SIG.s05(t), t),
    camera: (lt, t) => { const s = acAt(SIG.s05(t)), k = ease(lt / 4.8); return { pos: body(s, [-12.5 + 2.5 * k, 5.2 - 0.6 * k, -11.5 + 1.2 * k]), look: body(s, [0.6, -0.2, 0]), fov: 25, shake: { rot: 0.05, freq: 0.5, seed: 5 }, focus: s.p.clone(), focusRadius: 8 }; },
    post: { ...AIR_POST } },
  { id: 's06', name: 'Digital target', t0: 33.6, t1: 44.0, terrain: 'top', note: 'Engagement plot (original, illustrative): a target track arrives; the operator tasks ENGAGE; the aircraft sequences the shot.',
    pose: (lt, t, f) => poseAir(f, -20, t, { missile: false, haze: 0 }),
    camera: (lt) => plotCam(lt, 0),
    post: (lt) => ({ ...PLOT_POST }) },
  { id: 's07', name: 'On the rail', t0: 44.0, t1: 46.7, terrain: 'air', note: 'Simulated wing-station camera looking forward along the missile, seconds before release.',
    pose: (lt, t, f) => poseAir(f, SIG.s07(t), t),
    camera: (lt, t) => { const s = acAt(SIG.s07(t)); attitude(s.hdg, s.pitch, s.roll, q1); return { pos: body(s, [-2.75, -0.46, -1.02], true), look: body(s, [4.2, -0.62, -2.05], true), up: v3(0, 1, 0).applyQuaternion(q1), fov: 58, shake: { rot: 0.16, freq: 3.2, seed: 7, jolt: 0.07 }, focus: body(s, [0, -0.3, -1.5], true), focusRadius: 5 }; },
    post: { ...AIR_POST, exposure: 0.21, lensK: 0.05, vignette: 0.42, grain: 0.055, sat: 1.05, cirrus: { ...CIRRUS, alt: 13600 } } },
  { id: 's08', name: 'Fox three', t0: 46.7, t1: 52.0, terrain: 'air', note: 'Port-side long lens, slow motion: motor ignition, the missile leaves the rail and outruns the frame.',
    pose: (lt, t, f) => { const sig = SIG.s08(t); poseAir(f, sig, t, { bump: 0.5 * Math.exp(-Math.max(0, sig) * 6) * (sig > 0 ? 1 : 0) }); },
    camera: (lt, t) => { const sig = SIG.s08(t), s = acAt(sig), r = mslRel(sig), k = smooth(T_IGN + 0.5, T_IGN + 3.6, t); return { pos: body(s, [2.0 + 5 * k, -5.2, -57]), look: body(s, [1.4 + Math.min(r.d, 16) * 0.55 * k + 3 * k, -0.35 + r.h * 0.3 * k, 0]), fov: 12.6 + 12 * k, shake: { rot: 0.03 + 0.05 * Math.exp(-Math.max(0, t - T_IGN) * 1.5) * (t > T_IGN ? 1 : 0), freq: 1.4, seed: 8 }, focus: s.p.clone(), focusRadius: 8 }; },
    post: (lt, t) => ({ ...AIR_POST, exposure: 0.185 - 0.02 * Math.exp(-Math.max(0, t - T_IGN) * 3) * (t > T_IGN ? 1 : 0), bloom: 0.085, shutter: 0.35 }) },
  { id: 's09', name: 'Fly-out', t0: 52.0, t1: 58.0, terrain: 'air', note: 'From behind and above: the missile climbs away on a thin white trail toward a target that is not there.',
    pose: (lt, t, f) => poseAir(f, SIG.s09(t), t),
    camera: (lt, t) => { const sig = SIG.s09(t), s = acAt(sig), m = mslWorld(sig, v3()), k = ease(lt / 6); const look = body(s, [60, 2, -1.5]).lerp(m, 0.35 + 0.3 * k); return { pos: body(s, [-15.5 - 4 * k, 4.2 + 1.2 * k, 4.6]), look, fov: 36 - 6 * k, shake: { rot: 0.06, freq: 0.7, seed: 9 }, focus: s.p.clone(), focusRadius: 8 }; },
    post: { ...AIR_POST, exposure: 0.18 } },
  { id: 's10', name: 'Resolved as data', t0: 58.0, t1: 65.3, terrain: 'top', note: 'Back on the plot: the missile track runs out to the digital target. No physical target, no explosion.',
    pose: (lt, t, f) => poseAir(f, 20, t, { missile: false, haze: 0 }),
    camera: (lt) => plotCam(lt + 10.4, 400),
    post: (lt) => ({ ...PLOT_POST }) },
  { id: 's11', name: 'One step closer', t0: 65.3, t1: 72.3, terrain: 'air', note: 'Heading home: Fury over the desert with an empty rail under the left wing.',
    pose: (lt, t, f) => poseAir(f, SIG.s11(t), t, { missile: false }),
    camera: (lt, t) => { const s = acAt(SIG.s11(t)), k = ease(lt / 7); return { pos: body(s, [-10.5 + 3.5 * k, 3.6 - 0.5 * k, -10.2 + 1.0 * k]), look: body(s, [0.4, -0.25, 0]), fov: 27, shake: { rot: 0.05, freq: 0.5, seed: 11 }, focus: s.p.clone(), focusRadius: 8 }; },
    post: { ...AIR_POST, exposure: 0.195 } },
  { id: 's12', name: 'End card', t0: 72.3, t1: DUR, terrain: 'air', note: 'The jet banks away toward the low sun; title, date, sources.',
    pose: (lt, t, f) => poseAir(f, SIG.s12(t), t, { missile: false }),
    camera: (lt, t) => { const s0 = acAt(68.6), s = acAt(SIG.s12(t)); const cam = body({ p: v3(s0.p.x, s0.p.y, s0.p.z - V * lt), hdg: 0 }, [-26, 3.0, 9]); return { pos: cam, look: s.p.clone(), fov: 30 - 5 * smooth(0.5, 6, lt), shake: { rot: 0.05, freq: 0.6, seed: 12 }, focus: s.p.clone(), focusRadius: 8 }; },
    post: { ...AIR_POST, exposure: 0.17, sunDisk: 0.05, bloom: 0.08 } },
];

// ------------------------------------------------------------------ overlays
const cues = [
  { type: 'l3', t0: 0.8, t1: 5.9, kicker: 'Announced July 15, 2026', title: 'Edwards Air Force Base', sub: 'California · with the 412th Test Wing’s Air Dominance Combined Test Force' },
  { type: 'l3', t0: 6.9, t1: 13.8, kicker: 'Anduril · U.S. Air Force', title: 'YFQ-44A “Fury”', sub: 'Collaborative Combat Aircraft · uncrewed' },
  { type: 'l3', t0: 14.9, t1: 21.8, kicker: 'On a wing hardpoint', title: 'AIM-120 AMRAAM', sub: 'Radar-guided air-to-air missile, carried externally' },
  { type: 'l3', t0: 29.2, t1: 33.3, kicker: 'Closed airspace', title: 'Mojave Desert' },
  { type: 'stat', t0: 48.0, t1: 51.7, value: 'FOX THREE', label: 'Brevity code: active-radar missile away' },
  { type: 'stat', side: 'left', t0: 52.7, t1: 57.6, value: 'FIRST', label: 'Live missile shot by a U.S. Collaborative Combat Aircraft' },
  { type: 'quote', t0: 66.0, t1: 71.9, text: '“We’re one step closer to delivering capabilities to the warfighter.”', cite: 'Gen. Ken Wilsbach, Air Force Chief of Staff · July 15, 2026' },
  { type: 'card', t0: 73.0, t1: DUR, fadeOut: 0.9, html: `<div class="k">Anduril · U.S. Air Force · YFQ-44A</div><div class="t">Fox Three</div><div class="row"><span>First CCA live-fire</span><span>Announced July 15, 2026</span><span>Edwards AFB · Mojave Desert</span></div><div class="src">Sources: U.S. Air Force release and Anduril statement of July 15, 2026, as reported by The War Zone; New Atlas.</div><div class="dis">Simulated visualization. Not actual footage. Time of day, altitude, speed, flight path, ranges, the engagement plot, the wing station shown and the slow-motion launch are illustrative. The target was digital: no physical aircraft was engaged. Date, base, missile type and quotations are as reported.</div>` },
];

// engagement plot: an original explanatory diagram, not a reproduction of any operator interface
const INK = '#f3f1ea', AMBER = '#ffb224', PW = 1920, PH = 1080;
const OP = [250, 770], AC0 = [760, 585], TG = [1500, 300];
let hud;
function buildHud(root) {
  const st = document.createElement('style');
  st.textContent = `.plot{inset:0;width:100%;height:100%}
.tagr{right:2.6cqw;top:2.4cqw;font:400 .86cqw/1 var(--f-data);letter-spacing:.2em;text-transform:uppercase;color:var(--ink);text-shadow:0 0 .5cqw rgba(0,0,0,.7);padding:.5cqw .8cqw;border:1px solid var(--line)}`;
  root.append(st);
  const c = document.createElement('canvas'); c.className = 'plot'; c.width = PW; c.height = PH; root.append(c);
  const slow = document.createElement('div'); slow.className = 'tagr'; slow.textContent = 'Slow motion'; root.append(slow);
  const cam = document.createElement('div'); cam.className = 'tagr'; cam.textContent = 'Wing-station view · simulated'; root.append(cam);
  hud = { c, g: c.getContext('2d'), slow, cam, on: false };
}
function label(g, txt, x, y, o = {}) {
  g.font = `${o.w ?? 400} ${o.size ?? 19}px ${o.display ? '"Saira Condensed", "Arial Narrow", sans-serif' : '"B612 Mono", ui-monospace, monospace'}`;
  try { g.letterSpacing = (o.ls ?? 2.6) + 'px'; } catch (e) { /* older canvas */ }
  g.textAlign = o.align || 'left'; g.textBaseline = o.base || 'alphabetic'; g.fillStyle = o.color || INK; g.globalAlpha = (o.a ?? 1) * (o.A ?? 1);
  g.fillText(txt, x, y);
}
function drawPlot(t) {
  const g = hud.g;
  const a1 = smooth(33.6, 34.3, t) * (1 - smooth(43.55, 44.0, t)), a2 = smooth(58.0, 58.6, t) * (1 - smooth(64.85, 65.3, t)), A = Math.max(a1, a2);
  if (A <= 0.001) { if (hud.on) { g.clearRect(0, 0, PW, PH); hud.on = false; } return; }
  hud.on = true; const second = t > 50;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, PW, PH); g.globalAlpha = A;
  g.fillStyle = 'rgba(3,7,11,0.5)'; g.fillRect(0, 0, PW, PH);
  g.lineCap = 'butt'; g.lineJoin = 'miter';
  // graticule and frame
  g.strokeStyle = INK; g.lineWidth = 1; g.globalAlpha = 0.07 * A; g.beginPath();
  for (let x = 96; x < PW; x += 144) { g.moveTo(x + 0.5, 150); g.lineTo(x + 0.5, 890); }
  for (let y = 150; y <= 890; y += 148) { g.moveTo(74, y + 0.5); g.lineTo(PW - 74, y + 0.5); }
  g.stroke();
  g.globalAlpha = 0.34 * A; g.strokeRect(74.5, 150.5, PW - 149, 740);
  label(g, 'ENGAGEMENT PLOT', 76, 128, { display: true, w: 700, size: 40, ls: 4, A });
  label(g, 'ILLUSTRATIVE DIAGRAM · NOT AN OPERATOR DISPLAY · NOT TO SCALE', PW - 76, 126, { align: 'right', size: 17, a: 0.7, A });
  const ac = [AC0[0] + (second ? 26 : 0), AC0[1] - (second ? 40 : 0) - (t - (second ? 58 : 33.6)) * 2.2];
  // command link: operator -> aircraft
  const tEng = 40.5, link = second ? 1 : smooth(34.6, 35.4, t);
  g.globalAlpha = 0.5 * A * link; g.setLineDash([3, 9]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(OP[0] + 30, OP[1] - 22); g.lineTo(ac[0] - 28, ac[1] + 22); g.stroke(); g.setLineDash([]);
  { const mx = (OP[0] + ac[0]) / 2, my = (OP[1] + ac[1]) / 2; g.save(); g.translate(mx, my); g.rotate(Math.atan2(ac[1] - OP[1], ac[0] - OP[0])); label(g, 'COMMAND LINK · BEYOND LINE OF SIGHT', 0, -14, { align: 'center', size: 15, a: 0.62 * link, A }); g.restore(); }
  // operator node
  g.globalAlpha = A; g.lineWidth = 2; g.strokeStyle = INK; g.strokeRect(OP[0] - 22.5, OP[1] - 22.5, 45, 45);
  g.beginPath(); g.moveTo(OP[0] - 9, OP[1] + 9); g.lineTo(OP[0], OP[1] - 10); g.lineTo(OP[0] + 9, OP[1] + 9); g.stroke();
  label(g, 'OPERATOR', OP[0] - 22, OP[1] + 56, { size: 20, w: 700, A }); label(g, 'HUMAN · ON THE GROUND', OP[0] - 22, OP[1] + 82, { size: 15, a: 0.62, A });
  // aircraft: chevron pointing along track
  g.globalAlpha = A; g.lineWidth = 2.5; g.beginPath(); g.moveTo(ac[0] - 15, ac[1] + 17); g.lineTo(ac[0], ac[1] - 19); g.lineTo(ac[0] + 15, ac[1] + 17); g.lineTo(ac[0], ac[1] + 8); g.closePath(); g.stroke();
  label(g, 'YFQ-44A', ac[0] + 30, ac[1] - 4, { size: 20, w: 700, A }); label(g, 'UNCREWED', ac[0] + 30, ac[1] + 20, { size: 15, a: 0.62, A });
  // target track
  const tTrk = 35.6, trk = second ? 1 : smooth(tTrk, tTrk + 0.5, t), blink = second ? 1 : (t < tTrk + 1.6 ? 0.55 + 0.45 * Math.sign(Math.sin((t - tTrk) * 16)) : 1);
  if (trk > 0) {
    g.globalAlpha = A * trk * blink; g.lineWidth = 2.5; g.strokeStyle = AMBER;
    g.beginPath(); g.moveTo(TG[0], TG[1] - 22); g.lineTo(TG[0] + 22, TG[1]); g.lineTo(TG[0], TG[1] + 22); g.lineTo(TG[0] - 22, TG[1]); g.closePath(); g.stroke();
    g.setLineDash([2, 7]); g.lineWidth = 1.2; g.beginPath(); g.arc(TG[0], TG[1], 46 + 30 * (1 - trk), 0, 6.2832); g.stroke(); g.setLineDash([]);
    label(g, 'TRACK 01 · DIGITAL TARGET', TG[0] + 62, TG[1] - 6, { size: 20, w: 700, color: AMBER, A: A * trk }); label(g, 'SIMULATED · NO PHYSICAL AIRCRAFT', TG[0] + 62, TG[1] + 19, { size: 15, a: 0.7, A: A * trk });
    // bearing line
    g.strokeStyle = INK; g.globalAlpha = 0.28 * A * trk; g.setLineDash([1, 8]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(ac[0] + 14, ac[1] - 16); g.lineTo(TG[0] - 30, TG[1] + 14); g.stroke(); g.setLineDash([]);
  }
  // ENGAGE tasking travelling up the link
  if (!second && t > tEng - 0.1) {
    const p = ease((t - tEng) / 0.95), x = lerp(OP[0] + 30, ac[0] - 28, p), y = lerp(OP[1] - 22, ac[1] + 22, p), pulse = Math.exp(-Math.max(0, t - tEng) * 2.2);
    g.globalAlpha = A; g.fillStyle = AMBER; g.beginPath(); g.arc(x, y, 7, 0, 6.2832); g.fill();
    g.strokeStyle = AMBER; g.lineWidth = 2; g.globalAlpha = A * pulse; g.strokeRect(OP[0] - 22.5 - 26 * (1 - pulse), OP[1] - 22.5 - 26 * (1 - pulse), 45 + 52 * (1 - pulse), 45 + 52 * (1 - pulse));
    label(g, 'TASKING: ENGAGE', x + 20, y + 30, { size: 19, w: 700, color: AMBER, A: A * smooth(tEng, tEng + 0.25, t) });
  }
  // missile track (second visit)
  let done = 0;
  if (second) {
    const p = ease((t - 58.7) / 4.0), sx = ac[0] + 12, sy = ac[1] - 18, ex = TG[0] - 14, ey = TG[1] + 9, x = lerp(sx, ex, p), y = lerp(sy, ey, p) - Math.sin(p * Math.PI) * 46;
    g.strokeStyle = INK; g.globalAlpha = A; g.lineWidth = 2.5; g.beginPath(); g.moveTo(sx, sy);
    for (let i = 1; i <= 40; i++) { const q = p * i / 40; g.lineTo(lerp(sx, ex, q), lerp(sy, ey, q) - Math.sin(q * Math.PI) * 46); } g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(x, y, 5.5, 0, 6.2832); g.fill();
    if (p < 0.98) label(g, 'AIM-120', x - 16, y - 20, { align: 'right', size: 17, w: 700, A });
    done = smooth(62.7, 63.2, t);
    if (done > 0) { const e = t - 62.7; g.strokeStyle = AMBER; g.lineWidth = 2; for (const k of [0, 0.45]) { const r = 30 + (e - k) * 70; if (e > k && r < 190) { g.globalAlpha = A * Math.max(0, 1 - r / 190); g.beginPath(); g.arc(TG[0], TG[1], r, 0, 6.2832); g.stroke(); } }
      label(g, 'ENGAGEMENT COMPLETE', TG[0] - 62, TG[1] + 94, { size: 20, w: 700, color: AMBER, A: A * done, align: 'right' }); label(g, 'TARGET EXISTED ONLY AS DATA · NOTHING WAS HIT', TG[0] - 62, TG[1] + 120, { size: 15, a: 0.7, A: A * done, align: 'right' }); }
  }
  // sequence list
  const steps = second
    ? [['01', 'TARGET TRACK INGESTED', 'mission software', 0], ['02', 'OPERATOR TASKS: ENGAGE', 'the human decision', 0], ['03', 'WEAPON EMPLOYMENT SEQUENCE', 'run by the aircraft', 0], ['04', 'AIM-120 AWAY', 'one missile', 58.3]]
    : [['01', 'TARGET TRACK INGESTED', 'mission software', 36.3], ['02', 'OPERATOR TASKS: ENGAGE', 'the human decision', 41.4], ['03', 'WEAPON EMPLOYMENT SEQUENCE', 'run by the aircraft', 42.3], ['04', 'AIM-120 AWAY', 'one missile', 1e9]];
  const X0 = 1218, Y0 = 566;
  steps.forEach(([n, s1, s2, at], i) => {
    const on = smooth(at, at + 0.3, t), y = Y0 + i * 66, human = i === 1;
    g.globalAlpha = A * (0.3 + 0.7 * on); g.strokeStyle = human && on > 0.5 ? AMBER : INK; g.lineWidth = 1.5; g.strokeRect(X0 + 0.5, y - 21.5, 26, 26);
    if (on > 0) { g.fillStyle = human ? AMBER : INK; g.globalAlpha = A * on; g.fillRect(X0 + 6, y - 16, 15, 15); }
    label(g, n, X0 + 44, y, { size: 16, a: 0.6 * (0.4 + 0.6 * on), A }); label(g, s1, X0 + 86, y - 3, { size: 19, w: 700, color: human && on > 0.5 ? AMBER : INK, a: 0.35 + 0.65 * on, A }); label(g, s2.toUpperCase(), X0 + 86, y + 19, { size: 13.5, a: 0.55 * (0.4 + 0.6 * on), A, ls: 2 });
  });
  if (!second) { const q = smooth(42.3, 42.9, t); if (q > 0) label(g, '“…AUTONOMOUSLY WITHIN PILOT-DEFINED PARAMETERS” — GEN. DALE WHITE, USAF', X0, Y0 + 4 * 66 + 6, { size: 13.5, a: 0.7 * q, A, ls: 1.4 }); }
  else { const q = smooth(59.2, 60.0, t) * (1 - smooth(64.3, 64.9, t)); if (q > 0) { label(g, '“AN END-TO-END, BEYOND-LINE-OF-SIGHT STRIKE', 96, 250, { size: 22, w: 700, A: A * q, ls: 2.4 }); label(g, 'AGAINST A SIMULATED TARGET.”', 96, 282, { size: 22, w: 700, A: A * q, ls: 2.4 }); label(g, 'MARK SHUSHNAR, ANDURIL · JULY 15, 2026', 96, 316, { size: 15, color: AMBER, A: A * q }); } }
  g.globalAlpha = 1;
}
function updateHud(t) {
  drawPlot(t);
  hud.slow.style.opacity = (smooth(46.9, 47.3, t) * (1 - smooth(51.6, 52.0, t))).toFixed(3);
  hud.cam.style.opacity = (smooth(44.1, 44.4, t) * (1 - smooth(46.45, 46.7, t))).toFixed(3);
}

// ------------------------------------------------------------------ sound
function score(m) {
  const Em = [82.41, 123.47, 164.81, 196.0, 246.94], C = [65.41, 130.81, 164.81, 196.0, 261.63], Am = [55.0, 110.0, 164.81, 220.0, 261.63], Dm9 = [73.42, 146.83, 174.61, 220.0, 329.63], G = [98.0, 146.83, 196.0, 246.94, 293.66];
  // the ramp: wind over concrete, a flight line somewhere behind
  m.wind({ env: [[0, 0], [1, 0.05], [22.2, 0.05], [22.3, 0.02], [28.7, 0.02], [28.8, 0]], freq: 380 });
  m.jet({ env: [[0, 0], [2, 0.008], [22.2, 0.01], [22.3, 0]], pitch: [[0, 0.9], [22.3, 0.9]], pan: -0.5, whine: 0.7, bright: 0.6 });
  m.hit(0.3, { gain: 0.45 });
  m.pad(0.4, 13.6, [Em[0], Em[2], Em[4]], { gain: 0.034, bright: 620 });
  m.pad(13.2, 22.0, [C[0], C[2], C[4]], { gain: 0.036, bright: 700 });
  for (const t of [0.9, 6.95, 14.95]) m.beep(t, { freq: 1175, gain: 0.022, dur: 0.05 });
  // take-off: a small turbofan at full power passing the camera
  m.jet({ env: [[22.3, 0], [22.5, 0.1], [25.2, 0.3], [26.6, 0.34], [28.75, 0.16], [28.8, 0]], pitch: [[22.3, 1.25], [26.4, 1.3], [28.8, 1.05]], pan: 0, whine: 0.9, bright: 1.15 });
  m.pad(22.0, 29.2, Am, { gain: 0.04, bright: 900, attack: 1.2 });
  // at altitude
  m.wind({ env: [[28.8, 0], [28.9, 0.06], [33.5, 0.06], [33.6, 0.012], [43.9, 0.012], [44.0, 0.11], [46.65, 0.12], [46.7, 0.04], [52.0, 0.04], [52.05, 0.075], [57.9, 0.07], [58.0, 0.012], [65.2, 0.012], [65.3, 0.065], [77, 0.06], [DUR, 0]], freq: 700 });
  m.jet({ env: [[28.8, 0], [28.9, 0.05], [33.5, 0.05], [33.6, 0], [44.0, 0], [44.05, 0.09], [46.65, 0.09], [46.7, 0.03], [51.9, 0.03], [52.0, 0.07], [57.9, 0.06], [58.0, 0], [65.3, 0], [65.4, 0.055], [72.3, 0.055], [76.5, 0.02], [DUR, 0]], pitch: [[28.8, 1.2], [DUR, 1.15]], pan: 0.15, whine: 0.5, bright: 0.9 });
  m.pad(28.9, 34.2, Em, { gain: 0.045, bright: 950 });
  // the plot: a low room tone, ticks as each step lands
  m.tone({ type: 'sine', freq: 55, env: [[33.6, 0], [34.4, 0.06], [43.6, 0.06], [44.0, 0]], dest: m.music });
  m.tone({ type: 'sine', freq: 55, env: [[58.0, 0], [58.6, 0.06], [64.9, 0.06], [65.3, 0]], dest: m.music });
  m.pad(33.8, 44.2, Dm9, { gain: 0.036, bright: 800 });
  m.pulse(34.2, 43.6, 0.78, { freq: 41, gain: 0.2 });
  for (const [t, f] of [[35.6, 880], [35.78, 880], [36.3, 1320], [41.4, 1320], [42.3, 1320]]) m.beep(t, { freq: f, gain: 0.045, dur: 0.06 });
  m.thump(40.5, { gain: 0.55, f0: 110, f1: 55, dur: 0.35 }); m.beep(40.5, { freq: 660, gain: 0.06, dur: 0.16 });
  // on the rail, then the shot (slow motion: everything stretched and low)
  m.riser(44.2, T_IGN - 0.02, { gain: 0.15 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: 300, env: [[44.0, 0], [44.1, 0.22], [46.6, 0.24], [46.7, 0]] });
  m.hit(T_IGN, { gain: 0.9 });
  m.thump(T_IGN, { gain: 1.2, f0: 120, f1: 30, dur: 1.6, send: 0.5 });
  m.noise({ kind: 'white', type: 'bandpass', freq: [[T_IGN, 2600], [T_IGN + 0.4, 900], [52, 260]], q: 0.7, env: [[T_IGN, 0], [T_IGN + 0.03, 0.75], [T_IGN + 0.8, 0.5], [51.9, 0.16], [52, 0]], pan: [[T_IGN, 0.1], [52, -0.65]], send: 0.35 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: [[T_IGN, 700], [52, 160]], env: [[T_IGN, 0], [T_IGN + 0.04, 1.1], [T_IGN + 1.2, 0.6], [51.9, 0.2], [52, 0]], pan: [[T_IGN, 0.1], [52, -0.6]], send: 0.3 });
  // fly-out in real time: the motor's roar thinning into distance
  m.noise({ kind: 'white', type: 'bandpass', freq: [[52, 1500], [58, 380]], q: 0.8, env: [[52, 0], [52.05, 0.28], [54, 0.1], [57.9, 0.015], [58, 0]], pan: [[52, -0.2], [58, -0.5]], send: 0.5 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: 220, env: [[52, 0], [52.05, 0.5], [55, 0.15], [57.9, 0.02], [58, 0]], send: 0.4 });
  m.pad(47.6, 58.4, Em, { gain: 0.058, bright: 1250, attack: 0.8 });
  m.pad(57.8, 65.6, C, { gain: 0.04, bright: 900 });
  for (const [t, f] of [[58.3, 1320], [62.7, 1568], [62.88, 1568]]) m.beep(t, { freq: f, gain: 0.045, dur: 0.06 });
  m.pulse(58.6, 62.7, 0.7, { freq: 41, gain: 0.18, accel: 0.02 });
  m.thump(62.7, { gain: 0.5, f0: 90, f1: 40, dur: 0.6 });
  m.pad(65.3, 73.2, G, { gain: 0.052, bright: 1250 });
  m.pad(72.6, DUR - 0.6, Em, { gain: 0.055, bright: 1000, release: 0.6 });
  m.hit(73.0, { gain: 0.55 });
  for (const t of [29.25, 48.05, 52.75]) m.beep(t, { freq: 1175, gain: 0.025, dur: 0.05 });
}

startFilm({
  id: 'fury', title: 'Fox Three', duration: DUR, fps: 30, poster: 48.75, narration: NARRATION,
  build, shots, cues, buildHud, updateHud, score,
  frame(t, shot, lt, film) {
    W.terrain.update(shot.terrain); W.field.bush.visible = shot.terrain === 'ground';
    // smoke trail: births are in film time; each shot supplies its own film->sim mapping
    const map = SIG[shot.id];
    if (map && (shot.id === 's08' || shot.id === 's09')) {
      W.smoke.o.start = shot.id === 's08' ? T_IGN : 52 - SLOW * (52 - T_IGN);
      W.smoke.update(t, film.origin, (tb, out) => mslWorld(map(tb), out, true));
    } else W.smoke.hide();
  },
});
