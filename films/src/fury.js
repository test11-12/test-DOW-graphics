// FOX THREE — Anduril YFQ-44A "Fury", first live missile shot by a U.S. Collaborative Combat Aircraft.
// A simulated visualization. What is documented: the Air Force announced the test on July 15, 2026; the
// aircraft took off from Edwards AFB; it fired one AIM-120 AMRAAM in secluded airspace over the Mojave
// Desert at a "digital" (simulated) target; a human operator tasked the aircraft to engage. Everything
// else on screen (time of day, weather, altitude, speed, flight path, ranges, the engagement plot, which
// wing carried the missile, the missile's fly-out, the slow-motion launch) is illustrative.
import * as THREE from 'three';
import { startFilm, clamp, lerp, smooth, ease, easeOut, wobble, v3, hdgVec } from '../engine/film.js';
import { Terrain } from '../engine/terrain.js';
import { CloudLayer } from '../engine/clouds.js';
import { attitude } from '../engine/geo.js';
import { makePlume, makeHeatHaze, makeGlow } from '../engine/fx.js';
import { MOJAVE_TERRAIN, FIELD_ALT, RWY_HDG, SPOT } from './terrain_mojave.js';
import { buildFury, buildAmraam, FURY } from './fury_model.js';
import { buildRamp, buildFieldFar, buildScrub, fieldXZ, dressTyres } from './edwards_field.js';
import { makeMissileTrail } from './fury_fx.js';
import { loadGroundArray } from './fury_ground.js';

const NARRATION = __NARRATION__;
// look development only: tools may set window.__DEV = { post: {...}, trail: {...}, haze, hazeH, ... } before a frame
const DEV = () => (typeof window !== 'undefined' && window.__DEV) || {};
const D = Math.PI / 180;
const SUN = { az: 289, el: 10 };                        // low evening sun (illustrative)
const GROUND_Y = FIELD_ALT - FURY.groundY;              // aircraft origin height when standing on its wheels
const DUR = 79;
const fieldW = (u, v, y = FIELD_ALT) => { const [x, z] = fieldXZ(u, v); return v3(x, y, z); };
const PARK = { p: fieldW(SPOT.u, SPOT.v, GROUND_Y), hdg: RWY_HDG + 90, pitch: 0, roll: 0 };   // nose towards the flight line

// ------------------------------------------------------------------ flight and engagement kinematics (illustrative)
// "sig" = seconds from motor ignition. Each airborne shot maps film time onto sig (the launch runs in slow motion).
const HDG = 320, V = 245;                               // launch heading (deg true), true airspeed (m/s)
const FWD = hdgVec(HDG);
const LAUNCH = v3(38000, 9600, -38000);                 // where the motor lights
const K = { V, A1: 150, T1: 2.5, A2: 70, burn: 8.0, climbT0: 0.45, climbK: 2.2, climbT1: 3.0 };
const T_IGN = 47.8, SLOW = 0.15;                      // the launch shot runs at about a seventh of real time
const mslAhead = s => s <= 0 ? 0 : (s < K.T1 ? 0.5 * K.A1 * s * s : 0.5 * K.A1 * K.T1 * K.T1 + K.A1 * K.T1 * (s - K.T1) + 0.5 * K.A2 * (s - K.T1) * (s - K.T1));
const mslSpeed = s => s <= 0 ? 0 : (s < K.T1 ? K.A1 * s : K.A1 * K.T1 + K.A2 * (s - K.T1));
const mslClimb = s => { const u = Math.max(0, s - K.climbT0); return u < K.climbT1 ? K.climbK * u * u : K.climbK * K.climbT1 * (2 * u - K.climbT1); };
const mslClimbRate = s => { const u = Math.max(0, s - K.climbT0); return 2 * K.climbK * Math.min(u, K.climbT1); };
const T_BRK = 68.5;                                     // sig at which the last shot's break begins
const BRK = (() => { // gentle left break towards the sun, integrated once
  const dt = 1 / 60, n = 1200, A = new Float64Array(n * 5); let x = 0, z = 0, y = 0, hdg = HDG;
  for (let i = 0; i < n; i++) { const tau = i * dt, roll = -48 * ease(clamp((tau - 1.0) / 2.6)); A.set([x, y, z, hdg, roll], i * 5);
    hdg += 9.81 * Math.tan(roll * D) / V / D * dt; x += Math.sin(hdg * D) * V * dt; z -= Math.cos(hdg * D) * V * dt; y += (roll < -5 ? 5 : 0) * dt; }
  return { A, dt, n };
})();
function acAt(sig, out = { p: v3(), hdg: HDG, pitch: 2.2, roll: 0 }) {
  if (sig < T_BRK) { out.p.copy(LAUNCH).addScaledVector(FWD, V * sig); out.hdg = HDG; out.roll = wobble(sig * 0.7, 3) * 0.8; }
  else { const f = clamp((sig - T_BRK) / BRK.dt, 0, BRK.n - 1.001), i = Math.floor(f), k = f - i, A = BRK.A, a = i * 5, b = a + 5;
    out.p.copy(LAUNCH).addScaledVector(FWD, V * T_BRK); out.p.x += lerp(A[a], A[b], k); out.p.y += lerp(A[a + 1], A[b + 1], k); out.p.z += lerp(A[a + 2], A[b + 2], k);
    out.hdg = lerp(A[a + 3], A[b + 3], k); out.roll = lerp(A[a + 4], A[b + 4], k) + wobble(sig * 0.7, 3) * 0.6; }
  out.pitch = 2.2 + wobble(sig * 0.9, 5) * 0.2;
  return out;
}
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), tA = v3(), tB = v3();
// missile centre: on the rail it rides with the aircraft; after ignition it flies its own (straight, lofting) path
function mslCentre(sig, out = v3()) {
  const s = acAt(Math.min(sig, 0));
  attitude(s.hdg, s.pitch, s.roll, q1); out.copy(FURY.station).applyQuaternion(q1).add(s.p);
  if (sig > 0) { out.addScaledVector(FWD, V * sig + mslAhead(sig)); out.y += mslClimb(sig); }
  return out;
}
const mslPitch = sig => sig <= 0 ? 0 : 2.2 * Math.exp(-sig * 2.5) + Math.atan2(mslClimbRate(sig), V + mslSpeed(sig)) / D;
// where the motor lit (the missile's tail at sig = 0), world
const IGNITION = (() => { const c = mslCentre(0), s = acAt(0); attitude(s.hdg, s.pitch, s.roll, q1); return v3(-MSL_HALF(), 0, 0).applyQuaternion(q1).add(c); })();
function MSL_HALF() { return 1.825; }

// take-off run for the tracking shot (time-cut into the roll): field coordinates along the runway
function roll(tau) {
  const v0 = 58, a = 3.6, s = v0 * tau + 0.5 * a * tau * tau, tl = 2.7, c = Math.max(0, tau - tl);
  return { u: -40 + s, y: GROUND_Y + Math.min(0.5 * 2.6 * c * c, 0.5 * 2.6 * 16 + 10.4 * Math.max(0, c - 4)), pitch: 8.5 * smooth(1.7, 2.9, tau) + 2.5 * smooth(2.9, 6, tau) };
}

// ------------------------------------------------------------------ world
let W;
async function build(film) {
  const pipe = film.pipe; let _t = performance.now(); const lap = n => { if (film.params.has('prof')) { pipe.renderer.getContext().finish(); const now = performance.now(); console.log('build', n, Math.round(now - _t)); _t = now; } };
  pipe.atmo.setSun(SUN.az, SUN.el);
  pipe.atmo.uniforms.uHaze.value = 0.62; pipe.atmo.groundAlbedo.setRGB(0.33, 0.28, 0.22);
  const nearRes = film.quality.lowTerrain ? 1024 : (+film.params.get('nres') || 4096);
  const clouds = new CloudLayer(pipe, { base: 4300, top: 6100, div: +film.params.get('cdiv') || 3 });
  const cs = clouds.terrainShadow();
  // photoscanned asphalt for the flight line (blender/fury_ground.py), and the parked aircraft's occlusion of it
  const ground = film.off.has('scan') ? null : await loadGroundArray(pipe, ['asphalt'], { size: film.quality.lowTerrain ? 1024 : 2048 });
  const GU = { tGround: { value: ground }, uGround: { value: new THREE.Vector4(3.0, ground ? 1 : 0, 0, 0) }, uAcAO: { value: new THREE.Vector4() },
    uAcGear: { value: new THREE.Vector4(FURY.noseGear.x, FURY.mainGear.x, FURY.mainGear.z, 0.155) } };
  const terrain = new Terrain(pipe, { ...MOJAVE_TERRAIN, uniforms: { ...cs.uniforms, ...GU }, defines: cs.defines, near: { ...MOJAVE_TERRAIN.near, res: nearRes }, far: { ...MOJAVE_TERRAIN.far, res: film.quality.lowTerrain ? 1024 : 2048 } });
  lap('clouds+terrain ctor');
  // airfield dressing (group origin = runway midpoint)
  const field = new THREE.Group(); field.name = 'field';
  const sunDir = pipe.atmo.sunDir;
  const far = buildFieldFar(pipe, sunDir), scrub = buildScrub(pipe, sunDir), ramp = await buildRamp(pipe, FURY);
  ramp.position.set(PARK.p.x, 0, PARK.p.z); attitude(PARK.hdg, 0, 0, ramp.quaternion);
  field.add(far, scrub, ramp); pipe.scene.add(field);
  lap('field');
  // aircraft
  const ac = buildFury(pipe); pipe.scene.add(ac);
  if (!film.off.has('tyres')) await dressTyres(pipe, ac);
  const haze = makeHeatHaze(pipe, { length: 24, radius: FURY.nozzleR, spread: 3.0, strength: 0.0028 }); haze.position.set(FURY.nozzleX, FURY.nozzleY, 0); ac.add(haze);
  const nav = ac.userData.navPos.map((p, i) => { const g = makeGlow(pipe, { color: i ? [1.0, 0.07, 0.04] : [0.08, 1.0, 0.3], size: 0.3, depthSoft: 0.3 }); g.position.copy(p); ac.add(g); return g; });
  pipe.registerDynamic(ac);
  lap('aircraft');
  // missile, its motor and its trail
  const msl = buildAmraam(pipe); pipe.scene.add(msl);
  const tx = msl.userData.tailX;
  const plume = makePlume(pipe, { length: 9.0, radius: 0.12, diamonds: 8, color: [1.0, 0.45, 0.15], core: [1.0, 0.88, 0.66] }); plume.position.set(tx + 0.02, 0, 0); msl.add(plume);
  const glow = makeGlow(pipe, { color: [1.0, 0.7, 0.4], size: 1.4, depthSoft: 0.5 }); glow.position.set(tx - 0.3, 0, 0); msl.add(glow);
  const mhaze = makeHeatHaze(pipe, { length: 30, radius: 0.14, spread: 5.5, strength: 0.0036 }); mhaze.position.set(tx, 0, 0); msl.add(mhaze);
  const lamp = new THREE.PointLight(new THREE.Color(1.0, 0.6, 0.3), 0, 80, 2); lamp.position.set(tx - 0.35, 0, 0); msl.add(lamp);
  pipe.registerDynamic(msl);
  const trail = makeMissileTrail(pipe, clouds.noise.texture, K); pipe.scene.add(trail);
  if (film.off.has('clouds')) for (const c of [CLOUDS, GROUND_CLOUDS]) { c.cover = 0; c.shadow = 0; }
  lap('missile');
  W = { terrain, clouds, field, far, scrub, ramp, ac, haze, nav, msl, plume, glow, mhaze, lamp, trail, sunDir, GU };
  return W;
}

// ------------------------------------------------------------------ pose helpers
function motorOff() { W.msl.userData.setBurn(0); W.plume.userData.set(0); W.glow.userData.set(0); W.mhaze.userData.set(0); W.lamp.intensity = 0; W.trail.visible = false; }
function navLights(k) { for (const g of W.nav) g.userData.set(k); }
// aircraft on the ground at world position p (origin height included); the missile hangs on its rail
function poseGround(film, p, hdg, pitch, o = {}) {
  film.place(W.ac, p); attitude(hdg, pitch, 0, W.ac.quaternion);
  W.GU.uAcAO.value.set(p.x, p.z, hdg * D, clamp(1 - (p.y - GROUND_Y) / 2.5));
  W.ac.userData.setGear(true); W.haze.userData.set(o.haze ?? 0); navLights(o.nav ?? 0);
  tB.copy(FURY.station).applyQuaternion(W.ac.quaternion).add(p); film.place(W.msl, tB); W.msl.quaternion.copy(W.ac.quaternion); W.msl.visible = true;
  motorOff();
  W.field.visible = true; tB.set(0, FIELD_ALT, 0); film.place(W.field, tB); W.ramp.visible = o.ramp ?? true;
}
// airborne: sig = seconds from ignition. o.missile === false hides the missile (after the shot)
function poseAir(film, sig, t, o = {}) {
  o = { ...o, ...DEV().air }; const s = acAt(sig), kick = sig > 0 ? Math.exp(-sig * 7) : 0;
  film.place(W.ac, s.p); attitude(s.hdg, s.pitch + 0.35 * kick, s.roll + 1.1 * kick, W.ac.quaternion); W.GU.uAcAO.value.w = 0;
  W.ac.userData.setGear(false); W.haze.userData.set(o.haze ?? 0.8); navLights(o.nav ?? 0.9);
  W.field.visible = false;
  if (o.missile === false) { W.msl.visible = false; motorOff(); if (o.trail) setTrail(film, o.trail, o); return s; }
  mslCentre(sig, tA); film.place(W.msl, tA); W.msl.visible = true;
  if (sig <= 0) { attitude(s.hdg, s.pitch, s.roll, W.msl.quaternion); motorOff(); return s; }
  attitude(HDG, mslPitch(sig), 3 * Math.sin(sig * 2.1), W.msl.quaternion);
  const burn = sig < K.burn ? 1 : 0, flash = 1 + 2.4 * Math.exp(-sig / 0.045), flick = 0.92 + 0.08 * Math.sin(t * 190) + 0.05 * Math.sin(t * 517);
  W.msl.userData.setBurn(burn); W.plume.userData.set(burn, (o.plumeGain ?? 18) * flick);
  W.glow.userData.set(burn * (o.glow ?? 1.6) * flash * flick, 0.8 + 0.3 * (flash - 1) * 0.35);
  W.mhaze.userData.set(burn); W.lamp.intensity = burn * (o.lamp ?? 90) * flash * flick;
  setTrail(film, sig, o);
  return s;
}
// o.blur: metres the smoke streams past the (formation) camera while its shutter is open
// (an accumulated frame, --accum, blurs the smoke for real over the shutter: the stand-in is off then)
function setTrail(film, sig, o = {}) { tB.copy(IGNITION).sub(film.origin); W.trail.userData.set(sig, tB, HDG, W.sunDir, { density: o.density ?? 1, plume: o.trailGlow ?? 1, blur: film.accum?.n > 1 ? 0 : o.blur ?? 0, stretch: o.stretch ?? 1, ...DEV().trail }); }
// point given in a heading-aligned frame around state s: [forward, up, right]; full attitude if `rigid`
function body(s, off, rigid = false, out = v3()) {
  attitude(s.hdg, rigid ? s.pitch : 0, rigid ? s.roll : 0, q2);
  return out.set(off[0], off[1], off[2]).applyQuaternion(q2).add(s.p);
}
// point around the parked aircraft: [towards the nose, height above the pavement, to its right]
const park = (x, h, z) => body({ p: tA.set(PARK.p.x, FIELD_ALT, PARK.p.z), hdg: PARK.hdg }, [x, h, z], false, v3());

// ------------------------------------------------------------------ light and grade
const CLOUDS = { cover: 0.34, scale: 0.62, wind: [0.010, 0.004], density: 0.013, tile: 4300, steps: 56, shadow: 0.8 };
// seen from the field, the cloud thins out along the line of sight to the low sun
const SUN_GAP = (() => { const az = SUN.az * D, d = (5200 - FIELD_ALT) / Math.tan(SUN.el * D); return [PARK.p.x + Math.sin(az) * d, PARK.p.z - Math.cos(az) * d, 11000, 0.85]; })();
const GROUND_CLOUDS = { ...CLOUDS, cover: 0.4, hole: SUN_GAP };
const CIRRUS = { alt: 12800, cover: 0.36, opacity: 0.45, scale: 1.3, wind: [0.003, 0.001] };
const FLARE = { ghost: 0.05, halo: 0.03, streak: 0.14, thr: 8 };
const GROUND_POST = { clouds: GROUND_CLOUDS, exposure: 0.215, contrast: 1.22, sat: 1.06, wb: [1.0, 1.0, 1.02], aerial: 0.9, grain: 0.04, bloom: 0.08, shutter: 0.5, cirrus: CIRRUS };
// at altitude: pale sky, a light hazy horizon and restrained colour, after the released photographs of the test;
// no high cloud (the sky in them is clear)
const AIR_POST = { clouds: CLOUDS, exposure: 0.25, contrast: 1.12, sat: 0.88, wb: [1.02, 1.0, 0.97], aerial: 0.9, grain: 0.035, bloom: 0.065, cirrus: null };
const PLOT_POST = { clouds: { ...CLOUDS, cover: 0, shadow: 0, steps: 8 }, exposure: 0.2, contrast: 1.38, sat: 0.22, wb: [0.9, 0.97, 1.06], aerial: 0.35, grain: 0.03, bloom: 0.03, vignette: 0.3, cirrus: null, shutter: 0, ao: false };
const PLOT_C = v3(24000, 0, -28000);
const plotCam = (lt) => ({ pos: v3(PLOT_C.x + lt * 30, 78000, PLOT_C.z - lt * 55), look: v3(PLOT_C.x + lt * 30, 0, PLOT_C.z - lt * 55), up: v3(0, 0, -1), fov: 40 });

const SIG = {   // film time -> seconds from ignition, per airborne shot
  s05: t => -30 + (t - 28.8), s07: t => -3.2 + (t - 44.0), s08: t => SLOW * (t - T_IGN),
  s09: t => SLOW * (52.2 - T_IGN) + (t - 52.2), s11: t => 40 + (t - 65.3), s12: t => T_BRK - 0.6 + (t - 72.3),
};
const AIR_HAZE = [1.4, 3000];   // aerosol amount and scale height (m) for the shots at altitude
const SUN_AIR = 0.15;      // sun-disk gain at altitude (higher overflows the half-float scene buffer)

const shots = [
  { id: 's01', name: 'Edwards, evening', t0: 0, t1: 6.4, terrain: 'ground', note: 'Low on the apron, looking into the setting sun: the jet in silhouette, its shadow reaching the lens, light breaking through cloud.',
    pose: (lt, t, f) => poseGround(f, PARK.p, PARK.hdg, 0),
    camera: (lt) => { const k = ease(lt / 6.4); return { pos: park(-17.6 + 2.4 * k, 0.42 + 0.22 * k, 15.4 - 1.4 * k), look: park(0.6, 2.35 - 0.25 * k, 0.4), fov: 32, shake: { rot: 0.02, freq: 0.3, seed: 1 }, focus: park(-3, 1, 3), focusRadius: 24 }; },
    post: { ...GROUND_POST, exposure: GROUND_POST.exposure * 0.82, vignette: 0.34, rays: 0.5, flare: FLARE, sunDisk: 0.5, bloom: 0.1, dof: { focus: 23, fstop: 2.4, max: 10 } } },
  { id: 's02', name: 'No cockpit', t0: 6.4, t1: 14.3, terrain: 'ground', note: 'Slider down the sunlit port side: chined nose, no canopy, splinter paint, the designation.',
    pose: (lt, t, f) => poseGround(f, PARK.p, PARK.hdg, 0),
    camera: (lt) => { const k = ease(lt / 8.2); return { pos: park(6.2 - 6.6 * k, 1.5, -7.6), look: park(4.4 - 5.0 * k, 1.08, 0), fov: 24, shake: { rot: 0.025, freq: 0.35, seed: 2 }, focus: park(-2, 1, 3), focusRadius: 20 }; },
    post: { ...GROUND_POST, exposure: 0.2, dof: { focus: 7.6, fstop: 4, max: 9 } } },
  { id: 's03', name: 'The weapon', t0: 14.3, t1: 23.0, terrain: 'ground', note: 'Under the left wing: an AIM-120 on its rail launcher, radome to fins, in low raking light.',
    pose: (lt, t, f) => poseGround(f, PARK.p, PARK.hdg, 0),
    camera: (lt) => { const k = ease(lt / 8.7); return { pos: park(4.6 - 3.6 * k, 0.42 + 0.14 * k, -5.1 + 0.5 * k), look: park(2.0 - 2.3 * k, 0.66, -1.85), fov: 22, shake: { rot: 0.02, freq: 0.3, seed: 3 }, focus: park(-1, 1, 1), focusRadius: 16 }; },
    post: { ...GROUND_POST, exposure: 0.21, dof: { focus: 3.4, fstop: 4, max: 11 } } },
  { id: 's04', name: 'Take-off', t0: 23.0, t1: 28.8, terrain: 'ground', note: 'Long lens across the runway: rotation, wheels off, the desert and its far ranges behind.',
    pose: (lt, t, f) => { const r = roll(lt); poseGround(f, fieldW(r.u, 0, r.y), RWY_HDG, r.pitch, { haze: 1.3, ramp: true, nav: 0.7 }); },
    camera: (lt) => { const r = roll(lt), l = roll(lt - 0.1); const tgt = fieldW(l.u + 2.5, 0, lerp(l.y, FIELD_ALT + 4, 0.1) + 0.2); return { pos: fieldW(150, 300, FIELD_ALT + 6.5), look: tgt, fov: 3.5 - 0.4 * smooth(2, 5.8, lt), shake: { rot: 0.018, freq: 1.3, seed: 4 }, focus: fieldW(r.u, 0, r.y), focusRadius: 9 }; },
    post: { ...GROUND_POST, shimmer: [1.5, 30, 280], exposure: 0.2 } },
  { id: 's05', name: 'Secluded airspace', t0: 28.8, t1: 33.6, terrain: 'air', note: 'High chase looking down: the jet over the long-shadowed ranges of the Mojave, cloud and cloud shadow below, the missile under its left wing.',
    pose: (lt, t, f) => poseAir(f, SIG.s05(t), t),
    camera: (lt, t) => { const s = acAt(SIG.s05(t)), k = ease(lt / 4.8); return { pos: body(s, [-17 + 4 * k, 33 - 3 * k, -22 + 3 * k]), look: body(s, [3.0, -1.5, 0.6]), fov: 30, shake: { rot: 0.04, freq: 0.45, seed: 5 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: (lt, t) => { const s = acAt(SIG.s05(t)); return { ...AIR_POST, exposure: 0.29, contrast: 1.16, clouds: { ...CLOUDS, hole: [s.p.x, s.p.z, 17000, 0.7] } }; } },
  { id: 's06', name: 'Digital target', t0: 33.6, t1: 44.0, terrain: 'top', note: 'Engagement plot over the Mojave relief (original, illustrative): a target track arrives; a human operator tasks ENGAGE; the aircraft sequences the shot.',
    pose: (lt, t, f) => poseAir(f, -20, t, { missile: false, haze: 0, nav: 0 }),
    camera: (lt) => plotCam(lt),
    post: () => ({ ...PLOT_POST }) },
  { id: 's07', name: 'On the rail', t0: 44.0, t1: 46.7, terrain: 'air', note: 'Simulated wing-station camera looking forward along the missile, the low sun at the edge of frame.',
    pose: (lt, t, f) => poseAir(f, SIG.s07(t), t),
    camera: (lt, t) => { const s = acAt(SIG.s07(t)); attitude(s.hdg, s.pitch, s.roll, q1); return { pos: body(s, [-2.62, -0.63, -2.78], true), look: body(s, [4.5, -0.50, -1.72], true), up: v3(0, 1, 0).applyQuaternion(q1), fov: 60, shake: { rot: 0.16, freq: 3.2, seed: 7, jolt: 0.07 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: { ...AIR_POST, exposure: 0.2, lensK: 0.06, vignette: 0.42, grain: 0.055, sat: 1.05, rays: 0.35, flare: FLARE, sunDisk: SUN_AIR } },
  { id: 's08', name: 'Fox three', t0: 46.7, t1: 52.2, terrain: 'air', note: 'Port-side chase, long lens, slow motion: the motor lights under the wing and floods it orange, the missile slides off the rail and outruns the frame, its smoke rolling up behind it.',
    pose: (lt, t, f) => poseAir(f, SIG.s08(t), t, { blur: V * SLOW / 30 * 0.25, stretch: 1.3 }),
    camera: (lt, t) => { const sig = SIG.s08(t), s = acAt(sig), k = smooth(T_IGN + 0.55, T_IGN + 3.0, t), j = t > T_IGN ? Math.exp(-(t - T_IGN) * 2.2) : 0;
      const lead = Math.min(mslAhead(sig), 20) * 0.25 * smooth(T_IGN, T_IGN + 1.6, t);
      return { pos: body(s, [-2.5 + 5.5 * k, -3.4 - 0.9 * k, -35 + 3 * k]), look: body(s, [0.6 + lead + 1.5 * k, -0.62 + 0.2 * k, -1.6 + 0.6 * k]), fov: 14.5 + 13.5 * k, shake: { rot: 0.025 + 0.09 * j, freq: 1.4, seed: 8, jolt: 0.05 * j }, focus: s.p.clone(), focusRadius: 9 }; },
    post: (lt, t) => ({ ...AIR_POST, exposure: 0.245 - (t > T_IGN ? 0.03 * Math.exp(-(t - T_IGN) * 2.5) : 0), bloom: 0.09, shutter: 0.3, shimmer: [0.8, 22, 30] }) },
  { id: 's09', name: 'Fly-out', t0: 52.2, t1: 58.2, terrain: 'air', note: 'Behind and above, looking into the low sun: the trail runs past the jet and away, backlit, to a point of flame climbing toward a target that is not there.',
    pose: (lt, t, f) => poseAir(f, SIG.s09(t), t, { blur: V / 30 * 0.25 }),
    camera: (lt, t) => { const sig = SIG.s09(t), s = acAt(sig), k = ease(lt / 6); const cp = DEV().s09 || [-50, 3, 38, 420, 46, -150, 36]; return { pos: body(s, [cp[0] - 6 * k, cp[1] + 1.5 * k, cp[2] - 2 * k]), look: body(s, [cp[3], cp[4] + 12 * k, cp[5] + 10 * k]), fov: cp[6] - 5 * k, shake: { rot: 0.05, freq: 0.6, seed: 9 }, focus: s.p.clone(), focusRadius: 8 }; },
    post: { ...AIR_POST, exposure: 0.18, rays: 0.45, flare: FLARE, sunDisk: SUN_AIR, bloom: 0.08, accumShutter: 0.25 } },   // accumShutter: the trail's 90 degree smear (blur above)
  { id: 's10', name: 'Resolved as data', t0: 58.2, t1: 65.3, terrain: 'top', note: 'Back on the plot: the missile track runs out to the digital target. No physical target, no explosion.',
    pose: (lt, t, f) => poseAir(f, 20, t, { missile: false, haze: 0, nav: 0 }),
    camera: (lt) => plotCam(lt + 10.4),
    post: () => ({ ...PLOT_POST }) },
  { id: 's11', name: 'One step closer', t0: 65.3, t1: 72.3, terrain: 'air', note: 'Ahead and below on the port side, the sun behind the lens: the jet in golden light, the rail under its left wing empty.',
    pose: (lt, t, f) => poseAir(f, SIG.s11(t), t, { missile: false }),
    camera: (lt, t) => { const s = acAt(SIG.s11(t)), k = ease(lt / 7); return { pos: body(s, [13.5 - 5 * k, -2.0 + 0.8 * k, -15 + 1.5 * k]), look: body(s, [-0.6 - 0.4 * k, -0.25, -1.1]), fov: 24, shake: { rot: 0.045, freq: 0.5, seed: 11 }, focus: s.p.clone(), focusRadius: 8 }; },
    post: (lt, t) => { const s = acAt(SIG.s11(t)); return { ...AIR_POST, exposure: 0.25, clouds: { ...CLOUDS, hole: [s.p.x, s.p.z, 8000, 0.6] } }; } },
  { id: 's12', name: 'End card', t0: 72.3, t1: DUR, terrain: 'air', note: 'The jet banks away toward the low sun; title, date, sources.',
    pose: (lt, t, f) => poseAir(f, SIG.s12(t), t, { missile: false }),
    camera: (lt, t) => { const s0 = acAt(T_BRK - 0.6), s = acAt(SIG.s12(t)); const cam = body({ p: tA.copy(s0.p).addScaledVector(FWD, V * lt), hdg: HDG }, [-27, 3.2, 9.5]);
      const look = s.p.clone(); look.y -= cam.distanceTo(s.p) * 0.14 * smooth(0.2, 1.6, lt);   // the jet rides above the title card
      return { pos: cam, look, fov: 30 - 5 * smooth(0.5, 6, lt), shake: { rot: 0.05, freq: 0.6, seed: 12 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: { ...AIR_POST, exposure: 0.19, rays: 0.4, flare: FLARE, sunDisk: SUN_AIR, bloom: 0.08 } },
];

for (const s of shots) { const c = s.camera; s.camera = (lt, t, f) => { const o = c(lt, t, f), w = DEV().wheel; return w ? { ...o, pos: park(FURY.mainGear.x + w[0], w[1], -FURY.mainGear.z + w[2]), look: park(FURY.mainGear.x, w[4] ?? 0.2, -FURY.mainGear.z), fov: w[3] || o.fov, shake: null, focus: park(FURY.mainGear.x, 0.3, -FURY.mainGear.z), focusRadius: 5 } : o; }; }
for (const s of shots) { const p = s.post; s.post = (lt, t, f) => ({ ...(typeof p === 'function' ? p(lt, t, f) : p), ...DEV().post }); }   // look development overrides

// ------------------------------------------------------------------ overlays
const cues = [
  { type: 'l3', t0: 0.8, t1: 5.9, kicker: 'Announced July 15, 2026', title: 'Edwards Air Force Base', sub: 'California · with the 412th Test Wing’s Air Dominance Combined Test Force' },
  { type: 'l3', t0: 6.8, t1: 13.9, kicker: 'Anduril · U.S. Air Force', title: 'YFQ-44A “Fury”', sub: 'Collaborative Combat Aircraft · uncrewed · first flight October 31, 2025' },
  { type: 'l3', t0: 15.6, t1: 22.6, kicker: 'On an underwing hardpoint', title: 'AIM-120 AMRAAM', sub: 'Radar-guided air-to-air missile, carried externally' },
  { type: 'l3', t0: 29.2, t1: 33.3, kicker: 'Secluded airspace', title: 'Mojave Desert' },
  { type: 'stat', t0: 48.2, t1: 51.8, value: 'FOX THREE', label: 'Brevity code: active-radar missile away' },
  { type: 'stat', t0: 53.0, t1: 57.9, value: 'FIRST', label: 'Live missile shot by a U.S. CCA-type drone, per The War Zone' },
  { type: 'quote', t0: 66.0, t1: 71.9, text: '“We’re one step closer to delivering capabilities to the warfighter.”', cite: 'Gen. Ken Wilsbach, Air Force Chief of Staff · July 15, 2026' },
  { type: 'card', t0: 73.0, t1: DUR, fadeOut: 0.9, html: `<div class="k">Anduril · U.S. Air Force · YFQ-44A</div><div class="t">Fox Three</div><div class="row"><span>First CCA live fire</span><span>Announced July 15, 2026</span><span>Edwards AFB · Mojave Desert</span></div><div class="src">Sources: U.S. Air Force release and Anduril statement of July 15, 2026, as reported by The War Zone; New Atlas.</div><div class="dis">Simulated visualization. Not actual footage. Illustrative: time of day, weather, flight path, altitude, speed and ranges, the engagement plot and every display shown, which wing carried the missile, the missile’s fly-out and the slow-motion launch. The test date was not released. The target was digital: no physical aircraft was engaged. Base, missile type, dates and quotations are as reported.</div>` },
];

// engagement plot: an original explanatory diagram, not a reproduction of any operator interface. Drawn on a
// 1920 x 1080 canvas over the relief seen from straight above; every element eases in on the narration's cue.
const INK = '#f1efe7', AMBER = '#ffb224', DIM = 'rgba(241,239,231,0.55)', PW = 1920, PH = 1080;
const OP = [300, 800], AC0 = [690, 610], TG = [1150, 300];     // operator, aircraft (at the first cue), digital target
const PANEL = 1395;                                             // left edge of the sequence panel
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
const MONO = '"B612 Mono", ui-monospace, monospace', DISP = '"Saira Condensed", "Arial Narrow", sans-serif';
function label(g, txt, x, y, o = {}) {
  g.font = `${o.w ?? 400} ${o.size ?? 19}px ${o.display ? DISP : MONO}`;
  try { g.letterSpacing = (o.ls ?? 2.6) + 'px'; } catch (e) { /* older canvas */ }
  g.textAlign = o.align || 'left'; g.textBaseline = o.base || 'alphabetic'; g.fillStyle = o.color || INK; g.globalAlpha = Math.max(0, Math.min(1, (o.a ?? 1) * (o.A ?? 1)));
  if (o.glow) { g.shadowColor = o.color || INK; g.shadowBlur = o.glow; }
  const n = o.type === undefined ? txt.length : Math.floor(txt.length * Math.max(0, Math.min(1, o.type)));
  g.fillText(txt.slice(0, n), x, y);
  g.shadowBlur = 0;
}
// a polyline drawn on from its start: k in 0..1 of its length
function drawOn(g, pts, k) {
  if (k <= 0) return;
  let L = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
  let rem = L * Math.min(1, k); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && rem > 0; i++) { const f = Math.min(1, rem / seg[i - 1]); g.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)); rem -= seg[i - 1]; }
  g.stroke();
}
const brackets = (g, x0, y0, x1, y1, s) => { g.beginPath(); for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]]) { g.moveTo(x + dx * s, y); g.lineTo(x, y); g.lineTo(x, y + dy * s); } g.stroke(); };
function drawPlot(t) {
  const g = hud.g;
  const a1 = smooth(33.6, 34.2, t) * (1 - smooth(43.55, 44.0, t)), a2 = smooth(58.2, 58.7, t) * (1 - smooth(64.85, 65.3, t)), A = Math.max(a1, a2);
  if (A <= 0.001) { if (hud.on) { g.clearRect(0, 0, PW, PH); hud.on = false; } return; }
  hud.on = true; const second = t > 50, T0 = second ? 58.2 : 33.6, lt = t - T0;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, PW, PH);
  // shade the relief, heavier at the edges and behind the panel
  const vg = g.createRadialGradient(700, 540, 200, 700, 540, 1250); vg.addColorStop(0, 'rgba(4,9,13,0.1)'); vg.addColorStop(1, 'rgba(4,9,13,0.62)');
  g.globalAlpha = A; g.fillStyle = vg; g.fillRect(0, 0, PW, PH);
  const pg = g.createLinearGradient(PANEL - 140, 0, PANEL + 40, 0); pg.addColorStop(0, 'rgba(4,9,13,0)'); pg.addColorStop(1, 'rgba(4,9,13,0.62)');
  g.fillStyle = pg; g.fillRect(PANEL - 140, 0, PW - PANEL + 140, PH);
  // grid: fine graticule with heavier lines every fourth, drawn on at the first cue
  const gk = second ? 1 : smooth(33.7, 34.9, t);
  g.lineWidth = 1; g.strokeStyle = INK;
  for (let i = 0, x = 80; x < PANEL - 40; x += 60, i++) { g.globalAlpha = A * (i % 4 ? 0.035 : 0.08); drawOn(g, [[x + 0.5, 190], [x + 0.5, 930]], gk); }
  for (let i = 0, y = 190; y <= 930; y += 60, i++) { g.globalAlpha = A * (i % 4 ? 0.035 : 0.08); drawOn(g, [[80, y + 0.5], [PANEL - 60, y + 0.5]], gk); }
  g.globalAlpha = A * 0.45; g.lineWidth = 1.5; brackets(g, 60.5, 172.5, PANEL - 40.5, 950.5, 28);
  label(g, 'ENGAGEMENT, AS DESCRIBED', 64, 118, { display: true, w: 700, size: 44, ls: 3, A, type: second ? 1 : (lt - 0.1) / 0.8 });
  label(g, 'ILLUSTRATIVE DIAGRAM · NOT AN OPERATOR DISPLAY · NOT TO SCALE', 66, 148, { size: 15, a: 0.62, A, type: second ? 1 : (lt - 0.4) / 1.0 });
  // ---- the aircraft drifts along its track, leaving breadcrumbs
  const drift = (second ? 10.4 : 0) + lt, ac = [AC0[0] + drift * 4.2, AC0[1] - drift * 6.0];
  g.fillStyle = INK; for (let i = 1; i <= 10; i++) { const d2 = drift - i * 0.9; if (d2 < -6) break; g.globalAlpha = A * 0.5 * (1 - i / 11); g.beginPath(); g.arc(AC0[0] + d2 * 4.2, AC0[1] - d2 * 6.0, 2.2, 0, 6.2832); g.fill(); }
  const acIn = second ? 1 : smooth(34.6, 35.2, t);
  g.save(); g.translate(ac[0], ac[1]); g.rotate(Math.atan2(4.2, 6.0)); g.globalAlpha = A * acIn; g.lineWidth = 2.5; g.strokeStyle = INK; g.shadowColor = INK; g.shadowBlur = 8;
  g.beginPath(); g.moveTo(0, -20); g.lineTo(14, 16); g.lineTo(0, 8); g.lineTo(-14, 16); g.closePath(); g.stroke(); g.shadowBlur = 0; g.restore();
  label(g, 'YFQ-44A', ac[0] + 30, ac[1] - 2, { size: 20, w: 700, A: A * acIn, type: second ? 1 : (t - 34.8) / 0.5 }); label(g, 'UNCREWED', ac[0] + 30, ac[1] + 21, { size: 14, a: 0.6, A: A * acIn });
  // ---- operator and the beyond-line-of-sight command link (data flowing along it)
  const opIn = second ? 1 : smooth(34.4, 35.0, t);
  g.globalAlpha = A * opIn; g.lineWidth = 2; g.strokeStyle = INK; g.strokeRect(OP[0] - 22.5, OP[1] - 22.5, 45, 45);
  g.beginPath(); g.arc(OP[0], OP[1] - 6, 6, 0, 6.2832); g.moveTo(OP[0] - 11, OP[1] + 13); g.quadraticCurveTo(OP[0], OP[1] - 2, OP[0] + 11, OP[1] + 13); g.stroke();
  label(g, 'OPERATOR', OP[0] - 22, OP[1] + 56, { size: 20, w: 700, A: A * opIn }); label(g, 'A HUMAN · LOCATION NOT RELEASED', OP[0] - 22, OP[1] + 80, { size: 14, a: 0.6, A: A * opIn });
  const lk = second ? 1 : smooth(35.0, 36.0, t), L0 = [OP[0] + 30, OP[1] - 24], L1 = [ac[0] - 24, ac[1] + 26];
  g.globalAlpha = A * 0.55; g.lineWidth = 1.5; g.setLineDash([4, 10]); g.lineDashOffset = -t * 40; drawOn(g, [L0, L1], lk); g.setLineDash([]); g.lineDashOffset = 0;
  { const mx = (L0[0] + L1[0]) / 2, my = (L0[1] + L1[1]) / 2; g.save(); g.translate(mx, my); g.rotate(Math.atan2(L1[1] - L0[1], L1[0] - L0[0])); label(g, 'COMMAND LINK · BEYOND LINE OF SIGHT', 0, -14, { align: 'center', size: 14, a: 0.6 * lk, A, type: second ? 1 : (t - 35.6) / 0.9 }); g.restore(); }
  // ---- the digital target: a track that blinks in, then holds
  const tTrk = 37.0, trk = second ? 1 : smooth(tTrk, tTrk + 0.4, t), blink = second ? 1 : (t < tTrk + 1.2 ? 0.55 + 0.45 * Math.sign(Math.sin((t - tTrk) * 18)) : 1);
  if (trk > 0) {
    g.globalAlpha = A * trk * blink; g.lineWidth = 2.5; g.strokeStyle = AMBER; g.shadowColor = AMBER; g.shadowBlur = 14;
    g.beginPath(); g.moveTo(TG[0], TG[1] - 22); g.lineTo(TG[0] + 22, TG[1]); g.lineTo(TG[0], TG[1] + 22); g.lineTo(TG[0] - 22, TG[1]); g.closePath(); g.stroke(); g.shadowBlur = 0;
    const ring = 44 + 34 * (1 - trk) + (second ? 0 : 6 * Math.sin(t * 3.1));
    g.setLineDash([2, 7]); g.lineWidth = 1.2; g.globalAlpha = A * trk * 0.8; g.beginPath(); g.arc(TG[0], TG[1], ring, 0, 6.2832); g.stroke(); g.setLineDash([]);
    label(g, 'TRACK 01 · DIGITAL TARGET', TG[0] + 110, TG[1] - 92, { align: 'right', size: 20, w: 700, color: AMBER, A: A * trk, glow: 6, type: second ? 1 : (t - tTrk - 0.1) / 0.7 });
    label(g, 'SIMULATED · NO PHYSICAL AIRCRAFT', TG[0] + 110, TG[1] - 68, { align: 'right', size: 14, a: 0.7, A: A * trk, type: second ? 1 : (t - tTrk - 0.5) / 0.8 });
    // the sensor track: a dotted line from the aircraft to the target
    g.strokeStyle = INK; g.globalAlpha = 0.3 * A * trk; g.setLineDash([1, 8]); g.lineWidth = 1.2; drawOn(g, [[ac[0] + 12, ac[1] - 18], [TG[0] - 28, TG[1] + 16]], second ? 1 : smooth(tTrk + 0.3, tTrk + 1.3, t)); g.setLineDash([]);
  }
  // ---- the human decision: the ENGAGE tasking travels up the command link
  const tEng = 40.1;
  if (!second && t > tEng - 0.1) {
    const p = ease((t - tEng) / 0.9), x = lerp(L0[0], L1[0], p), y = lerp(L0[1], L1[1], p), pulse = Math.exp(-Math.max(0, t - tEng) * 2.0);
    g.globalAlpha = A; g.fillStyle = AMBER; g.shadowColor = AMBER; g.shadowBlur = 18; g.beginPath(); g.arc(x, y, 7, 0, 6.2832); g.fill(); g.shadowBlur = 0;
    g.strokeStyle = AMBER; g.lineWidth = 2; g.globalAlpha = A * pulse; const e = 26 * (1 - pulse); g.strokeRect(OP[0] - 22.5 - e, OP[1] - 22.5 - e, 45 + 2 * e, 45 + 2 * e);
    label(g, 'TASKING: ENGAGE', x + 20, y + 32, { size: 19, w: 700, color: AMBER, A: A * smooth(tEng, tEng + 0.25, t), glow: 8, type: (t - tEng) / 0.5 });
    if (p >= 1) { const q = Math.exp(-(t - tEng - 0.9) * 2.5); g.strokeStyle = AMBER; g.globalAlpha = A * q; g.lineWidth = 2; g.beginPath(); g.arc(ac[0], ac[1], 26 + 30 * (1 - q), 0, 6.2832); g.stroke(); }
  }
  // ---- the shot (second plot): one missile on a lofted path to the target, which was only data
  if (second) {
    const p = ease((t - 58.9) / 4.0), sx = ac[0] + 12, sy = ac[1] - 18, ex = TG[0] - 14, ey = TG[1] + 9;
    const P = q => [lerp(sx, ex, q), lerp(sy, ey, q) - Math.sin(q * Math.PI) * 70];
    if (p > 0) {
      const pts = []; for (let i = 0; i <= 48; i++) pts.push(P(p * i / 48));
      g.strokeStyle = INK; g.globalAlpha = A * 0.9; g.lineWidth = 2.5; g.shadowColor = INK; g.shadowBlur = 6; drawOn(g, pts, 1); g.shadowBlur = 0;
      const [hx, hy] = P(p); g.fillStyle = '#ffffff'; g.shadowColor = AMBER; g.shadowBlur = 20; g.globalAlpha = A; g.beginPath(); g.arc(hx, hy, 6, 0, 6.2832); g.fill(); g.shadowBlur = 0;
      if (p < 0.97) label(g, 'AIM-120', hx + 20, hy + 26, { size: 17, w: 700, A: A * (1 - smooth(0.8, 0.95, p)) });
    }
    const done = smooth(62.9, 63.3, t);
    if (done > 0) {
      const e = t - 62.9; g.strokeStyle = AMBER; g.lineWidth = 2;
      for (const k of [0, 0.4, 0.8]) { const r = 28 + (e - k) * 80; if (e > k && r < 220) { g.globalAlpha = A * Math.max(0, 1 - r / 220); g.beginPath(); g.arc(TG[0], TG[1], r, 0, 6.2832); g.stroke(); } }
      label(g, 'ENGAGEMENT COMPLETE', TG[0] - 30, TG[1] + 104, { align: 'center', size: 21, w: 700, color: AMBER, A: A * done, glow: 8, type: (t - 62.9) / 0.6 });
      label(g, 'THE TARGET EXISTED ONLY AS DATA · NOTHING WAS HIT', TG[0] - 30, TG[1] + 130, { align: 'center', size: 14, a: 0.72, A: A * done, type: (t - 63.3) / 0.9 });
    }
    const q = smooth(61.0, 61.6, t) * (1 - smooth(64.4, 64.9, t));
    if (q > 0) {
      label(g, '“AN END-TO-END,', 96, 250, { size: 24, w: 700, A: A * q, ls: 2.2, type: (t - 61.0) / 0.4 });
      label(g, 'BEYOND-LINE-OF-SIGHT STRIKE', 96, 284, { size: 24, w: 700, A: A * q, ls: 2.2, type: (t - 61.35) / 0.7 });
      label(g, 'AGAINST A SIMULATED TARGET.”', 96, 318, { size: 24, w: 700, A: A * q, ls: 2.2, type: (t - 62.0) / 0.7 });
      label(g, 'MARK SHUSHNAR, ANDURIL · JULY 15, 2026', 96, 352, { size: 15, color: AMBER, A: A * q });
    }
  }
  // ---- the sequence panel
  g.globalAlpha = A * 0.3; g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(PANEL + 0.5, 190); g.lineTo(PANEL + 0.5, 930); g.stroke();
  label(g, 'SEQUENCE, AS REPORTED', PANEL + 36, 226, { size: 15, a: 0.6, A, ls: 3 });
  const steps = [['01', 'TARGET TRACK INGESTED', 'MISSION SOFTWARE', second ? 0 : 37.6, false], ['02', 'OPERATOR TASKS: ENGAGE', 'THE HUMAN DECISION', second ? 0 : 41.0, true],
    ['03', 'WEAPON EMPLOYMENT SEQUENCE', 'RUN BY THE AIRCRAFT', second ? 0 : 42.3, false], ['04', 'AIM-120 AWAY', 'ONE MISSILE', second ? 58.6 : 1e9, false]];
  steps.forEach(([n, s1, s2, at, human], i) => {
    const on = smooth(at, at + 0.35, t), y = 292 + i * 96, col = human && on > 0.5 ? AMBER : INK;
    g.globalAlpha = A * (0.25 + 0.75 * on); g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(PANEL + 36.5, y - 21.5, 26, 26);
    if (on > 0) { g.fillStyle = col; g.globalAlpha = A * on; g.fillRect(PANEL + 42, y - 16, 15, 15); }
    const cur = on * (1 - smooth(at + 1.6, at + 2.4, t)) * (i === 3 && second ? 1 : 1);
    if (cur > 0.01) { g.globalAlpha = A * cur; g.fillStyle = col; g.fillRect(PANEL + 8, y - 30, 4, 48); }
    label(g, n, PANEL + 80, y, { size: 15, a: 0.55 * (0.4 + 0.6 * on), A });
    label(g, s1, PANEL + 120, y - 3, { size: 19, w: 700, color: col, a: 0.32 + 0.68 * on, A, glow: human && on > 0.5 ? 6 : 0 });
    label(g, s2, PANEL + 120, y + 21, { size: 13.5, a: 0.5 * (0.4 + 0.6 * on), A, ls: 2 });
  });
  if (!second) { const q = smooth(42.7, 43.2, t); if (q > 0) { label(g, '“…CAN EXECUTE THE WEAPON EMPLOYMENT SEQUENCE', PANEL + 36, 720, { size: 13.5, a: 0.75 * q, A, ls: 1.2, type: (t - 42.7) / 0.6 }); label(g, 'AUTONOMOUSLY WITHIN PILOT-DEFINED PARAMETERS.”', PANEL + 36, 742, { size: 13.5, a: 0.75 * q, A, ls: 1.2, type: (t - 43.0) / 0.5 }); label(g, 'GEN. DALE WHITE, U.S. AIR FORCE', PANEL + 36, 770, { size: 13, color: AMBER, a: q, A }); } }
  g.globalAlpha = 1;
}
function updateHud(t) {
  drawPlot(t);
  hud.slow.style.opacity = (smooth(46.9, 47.3, t) * (1 - smooth(51.8, 52.2, t))).toFixed(3);
  hud.cam.style.opacity = (smooth(44.1, 44.4, t) * (1 - smooth(46.45, 46.7, t))).toFixed(3);
}

// ------------------------------------------------------------------ sound
// Score in F# minor (film 1 is in D minor): a dark drone and a slow pulse on the ramp, a clock-like pulse that
// tightens through the engagement plot, a held breath on the rail, the launch as a deep hit that opens into A major,
// and the end on A over a low F#.
function score(m) {
  const Fsm = [92.50, 138.59, 185.00, 220.00, 277.18], Dmaj = [73.42, 146.83, 185.00, 220.00, 293.66], Bm = [61.74, 123.47, 185.00, 246.94, 293.66];
  const Csm = [69.30, 138.59, 164.81, 207.65, 277.18], Amaj = [55.0, 110.0, 164.81, 220.0, 277.18], Emaj = [82.41, 164.81, 207.65, 246.94, 329.63], Dadd9 = [73.42, 146.83, 220.0, 293.66, 329.63];
  // the ramp: wind over the apron, a turbine idling somewhere down the line, a low F# underneath
  m.wind({ env: [[0, 0], [1, 0.05], [22.9, 0.05], [23.0, 0.02], [28.7, 0.02], [28.8, 0]], freq: 380 });
  m.jet({ env: [[0, 0], [2, 0.007], [22.9, 0.009], [23.0, 0]], pitch: [[0, 0.88], [23, 0.88]], pan: -0.5, whine: 0.6, bright: 0.55 });
  m.tone({ type: 'sine', freq: 46.25, env: [[0, 0], [2.5, 0.07], [22.6, 0.07], [23.2, 0]], dest: m.music, send: 0.2 });
  m.hit(0.3, { gain: 0.42 });
  m.pad(0.4, 14.0, [Fsm[0], Fsm[1], Fsm[3]], { gain: 0.032, bright: 560, attack: 3 });
  m.pad(13.6, 23.2, [Dmaj[0], Dmaj[2], Dmaj[3]], { gain: 0.034, bright: 640 });
  m.tone({ type: 'sine', freq: [[6.4, 739.99], [14.3, 739.99]], env: [[6.4, 0], [8.5, 0.006], [13.6, 0.006], [14.6, 0]], dest: m.music, send: 0.6 });
  m.pulse(15.2, 22.9, 1.05, { freq: 46, gain: 0.16 });
  for (const t of [0.9, 6.95, 15.75]) m.beep(t, { freq: 1108.7, gain: 0.02, dur: 0.05 });
  // take-off: a small turbofan at full power passing the camera
  m.jet({ env: [[23.0, 0], [23.2, 0.1], [25.6, 0.3], [27.0, 0.34], [28.75, 0.16], [28.8, 0]], pitch: [[23.0, 1.25], [26.8, 1.3], [28.8, 1.05]], pan: 0, whine: 0.9, bright: 1.15 });
  m.pad(22.8, 29.4, Bm, { gain: 0.04, bright: 860, attack: 1.4 });
  // at altitude
  m.wind({ env: [[28.8, 0], [28.9, 0.06], [33.5, 0.06], [33.6, 0.012], [43.9, 0.012], [44.0, 0.11], [46.65, 0.1], [46.7, 0.03], [52.2, 0.03], [52.25, 0.075], [58.1, 0.07], [58.2, 0.012], [65.2, 0.012], [65.3, 0.065], [77, 0.06], [DUR, 0]], freq: 700 });
  m.jet({ env: [[28.8, 0], [28.9, 0.05], [33.5, 0.05], [33.6, 0], [44.0, 0], [44.05, 0.09], [46.65, 0.08], [46.7, 0.025], [52.1, 0.025], [52.2, 0.07], [58.1, 0.06], [58.2, 0], [65.3, 0], [65.4, 0.055], [72.3, 0.055], [76.5, 0.02], [DUR, 0]], pitch: [[28.8, 1.2], [DUR, 1.15]], pan: 0.15, whine: 0.5, bright: 0.9 });
  m.pad(28.9, 34.4, Fsm, { gain: 0.045, bright: 980, attack: 1.6 });
  // the plot: room tone, a pulse that tightens like a clock, a tick as each step lands
  m.tone({ type: 'sine', freq: 46.25, env: [[33.6, 0], [34.4, 0.06], [43.6, 0.07], [44.0, 0]], dest: m.music });
  m.pad(33.8, 44.3, Csm, { gain: 0.034, bright: 760 });
  m.pulse(34.2, 43.7, 0.62, { freq: 46, gain: 0.2, accel: 0.022 });
  for (const [t, f] of [[37.0, 880], [37.16, 880], [37.6, 1318.5], [41.0, 1318.5], [42.3, 1318.5], [42.7, 987.8]]) m.beep(t, { freq: f, gain: 0.042, dur: 0.06 });
  m.thump(40.1, { gain: 0.5, f0: 110, f1: 55, dur: 0.35 }); m.beep(40.1, { freq: 659.3, gain: 0.055, dur: 0.16 });
  // on the rail, then a held breath, then the shot (slow motion: everything stretched and low)
  m.riser(44.2, 46.75, { gain: 0.14 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: 300, env: [[44.0, 0], [44.1, 0.2], [46.6, 0.22], [46.7, 0]] });
  m.tone({ type: 'sine', freq: [[46.7, 1479.98], [T_IGN, 1479.98]], env: [[46.7, 0], [47.0, 0.012], [T_IGN - 0.05, 0.016], [T_IGN, 0]], dest: m.music, send: 0.5 });
  m.hit(T_IGN, { gain: 0.95 });
  m.thump(T_IGN, { gain: 1.25, f0: 120, f1: 28, dur: 1.8, send: 0.55 });
  m.noise({ kind: 'white', type: 'bandpass', freq: [[T_IGN, 2600], [T_IGN + 0.4, 900], [52.2, 260]], q: 0.7, env: [[T_IGN, 0], [T_IGN + 0.03, 0.72], [T_IGN + 0.8, 0.48], [52.1, 0.15], [52.2, 0]], pan: [[T_IGN, 0.1], [52.2, -0.65]], send: 0.35 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: [[T_IGN, 700], [52.2, 160]], env: [[T_IGN, 0], [T_IGN + 0.04, 1.05], [T_IGN + 1.2, 0.6], [52.1, 0.2], [52.2, 0]], pan: [[T_IGN, 0.1], [52.2, -0.6]], send: 0.3 });
  m.pad(T_IGN - 0.1, 53.6, Amaj, { gain: 0.06, bright: 1300, attack: 0.9 });
  // fly-out in real time: the motor's roar thinning into the distance
  m.noise({ kind: 'white', type: 'bandpass', freq: [[52.2, 1500], [58.2, 380]], q: 0.8, env: [[52.2, 0], [52.25, 0.28], [54.2, 0.1], [58.1, 0.015], [58.2, 0]], pan: [[52.2, -0.2], [58.2, -0.5]], send: 0.5 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: 220, env: [[52.2, 0], [52.25, 0.5], [55.2, 0.15], [58.1, 0.02], [58.2, 0]], send: 0.4 });
  m.pad(52.4, 58.8, Emaj, { gain: 0.05, bright: 1200, attack: 1.2 });
  m.pad(58.0, 65.6, Dadd9, { gain: 0.04, bright: 920 });
  for (const [t, f] of [[58.6, 1318.5], [62.9, 1661.2], [63.06, 1661.2]]) m.beep(t, { freq: f, gain: 0.044, dur: 0.06 });
  m.pulse(58.8, 62.9, 0.55, { freq: 46, gain: 0.16, accel: 0.03 });
  m.thump(62.9, { gain: 0.5, f0: 92, f1: 46, dur: 0.6 });
  m.pad(65.3, 73.4, Amaj, { gain: 0.05, bright: 1250 });
  m.tone({ type: 'sine', freq: 46.25, env: [[72.3, 0], [73.5, 0.06], [DUR - 0.8, 0.05], [DUR, 0]], dest: m.music, send: 0.3 });
  m.pad(72.8, DUR - 0.6, [Amaj[0], Amaj[2], Amaj[3], Amaj[4], 369.99], { gain: 0.05, bright: 1000, release: 0.6 });
  m.hit(73.0, { gain: 0.5 });
  for (const t of [29.25, 48.25, 53.05]) m.beep(t, { freq: 1108.7, gain: 0.024, dur: 0.05 });
}

startFilm({
  id: 'fury', title: 'Fox Three', duration: DUR, fps: 30, poster: 48.9, narration: NARRATION,
  build, shots, cues, buildHud, updateHud, score,
  frame(t, shot, lt, film, c) {
    W.terrain.update(shot.terrain);
    { const div = DEV().cdiv ?? (+film.params.get('cdiv') || (shot.terrain === 'air' ? 2 : 3)); if (W.clouds.div !== div) { W.clouds.div = div; W.clouds.setSize(film.pipe.w, film.pipe.h); } }   // the deck from above is the backdrop: half resolution; from the ground a third
    { const A = film.pipe.atmo.uniforms, air = shot.terrain === 'air', d = DEV(); A.uHaze.value = d.haze ?? (air ? AIR_HAZE[0] : 0.62); A.uHazeH.value = d.hazeH ?? (air ? AIR_HAZE[1] : 1200); }
    W.scrub.visible = shot.id === 's04' && !film.off.has('scrub');
    if (W.scrub.visible) { // thin the scrub out with distance: plants under about a pixel are skipped
      const pxPerM = film.pipe.h / (2 * Math.tan(c.fov * Math.PI / 360));
      for (const im of W.scrub.children) {
        const u = im.userData, d = Math.hypot(u.cx - c.pos.x, u.cz - c.pos.z, FIELD_ALT - c.pos.y);
        const f = clamp((0.55 * pxPerM / Math.max(d - 130, 30) - 0.8) / 1.7, 0, 1);
        im.count = Math.round(u.n * f); im.visible = im.count > 0;
      }
    }
    if (film.off.size) { // dev switches
      if (film.off.has('env')) film.pipe.scene.environment = null;
      if (film.off.has('ac')) W.ac.visible = false;
      if (film.off.has('field')) W.field.visible = false;
      if (film.off.has('terrain')) W.terrain.mesh.visible = false;
      if (film.off.has('trail')) W.trail.visible = false;
    }
  },
});
