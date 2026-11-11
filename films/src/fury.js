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
import { buildFury, buildAmraam, FURY } from './fury_assets.js';
import { buildRamp, buildFieldFar, buildScrub, fieldXZ } from './edwards_field.js';
import { makeMissileTrail } from './fury_fx.js';

const NARRATION = __NARRATION__;
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
const K = { V, A1: 150, T1: 2.5, A2: 70, burn: 8.0, climbT0: 0.45, climbK: 4.5, climbT1: 3.0 };
const T_IGN = 47.8, SLOW = 0.3;
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
  const terrain = new Terrain(pipe, { ...MOJAVE_TERRAIN, uniforms: { ...cs.uniforms }, defines: cs.defines, near: { ...MOJAVE_TERRAIN.near, res: nearRes }, far: { ...MOJAVE_TERRAIN.far, res: film.quality.lowTerrain ? 1024 : 2048 } });
  lap('clouds+terrain ctor');
  // airfield dressing (group origin = runway midpoint)
  const field = new THREE.Group(); field.name = 'field';
  const sunDir = pipe.atmo.sunDir;
  const far = buildFieldFar(pipe, sunDir), scrub = buildScrub(pipe, sunDir), ramp = buildRamp(FURY);
  ramp.position.set(PARK.p.x, 0, PARK.p.z); attitude(PARK.hdg, 0, 0, ramp.quaternion);
  field.add(far, scrub, ramp); pipe.scene.add(field);
  lap('field');
  // aircraft
  const ac = await buildFury(pipe); pipe.scene.add(ac);
  const haze = makeHeatHaze(pipe, { length: 24, radius: FURY.nozzleR, spread: 3.0, strength: 0.0028 }); haze.position.set(FURY.nozzleX, FURY.nozzleY, 0); ac.add(haze);
  const nav = ac.userData.navPos.map((p, i) => { const g = makeGlow(pipe, { color: i ? [1.0, 0.07, 0.04] : [0.08, 1.0, 0.3], size: 0.3, depthSoft: 0.3 }); g.position.copy(p); ac.add(g); return g; });
  pipe.registerDynamic(ac);
  lap('aircraft');
  // missile, its motor and its trail
  const msl = await buildAmraam(pipe); pipe.scene.add(msl);
  const tx = msl.userData.tailX;
  const plume = makePlume(pipe, { length: 7.5, radius: 0.085, diamonds: 9, color: [1.0, 0.42, 0.13], core: [1.0, 0.86, 0.6] }); plume.position.set(tx + 0.02, 0, 0); msl.add(plume);
  const glow = makeGlow(pipe, { color: [1.0, 0.7, 0.4], size: 1.4, depthSoft: 0.5 }); glow.position.set(tx - 0.3, 0, 0); msl.add(glow);
  const mhaze = makeHeatHaze(pipe, { length: 30, radius: 0.14, spread: 5.5, strength: 0.0036 }); mhaze.position.set(tx, 0, 0); msl.add(mhaze);
  const lamp = new THREE.PointLight(new THREE.Color(1.0, 0.62, 0.32), 0, 60, 2); lamp.position.set(tx - 0.9, 0, 0); msl.add(lamp);
  pipe.registerDynamic(msl);
  const trail = makeMissileTrail(pipe, clouds.noise.texture, K); pipe.scene.add(trail);
  if (film.off.has('clouds')) for (const c of [CLOUDS, GROUND_CLOUDS]) { c.cover = 0; c.shadow = 0; }
  lap('missile');
  W = { terrain, clouds, field, far, scrub, ramp, ac, haze, nav, msl, plume, glow, mhaze, lamp, trail, sunDir };
  return W;
}

// ------------------------------------------------------------------ pose helpers
function motorOff() { W.msl.userData.setBurn(0); W.plume.userData.set(0); W.glow.userData.set(0); W.mhaze.userData.set(0); W.lamp.intensity = 0; W.trail.visible = false; }
function navLights(k) { for (const g of W.nav) g.userData.set(k); }
// aircraft on the ground at world position p (origin height included); the missile hangs on its rail
function poseGround(film, p, hdg, pitch, o = {}) {
  film.place(W.ac, p); attitude(hdg, pitch, 0, W.ac.quaternion);
  W.ac.userData.setGear(true); W.haze.userData.set(o.haze ?? 0); navLights(o.nav ?? 0);
  tB.copy(FURY.station).applyQuaternion(W.ac.quaternion).add(p); film.place(W.msl, tB); W.msl.quaternion.copy(W.ac.quaternion); W.msl.visible = true;
  motorOff();
  W.field.visible = true; tB.set(0, FIELD_ALT, 0); film.place(W.field, tB); W.ramp.visible = o.ramp ?? true;
}
// airborne: sig = seconds from ignition. o.missile === false hides the missile (after the shot)
function poseAir(film, sig, t, o = {}) {
  const s = acAt(sig), kick = sig > 0 ? Math.exp(-sig * 7) : 0;
  film.place(W.ac, s.p); attitude(s.hdg, s.pitch + 0.35 * kick, s.roll + 1.1 * kick, W.ac.quaternion);
  W.ac.userData.setGear(false); W.haze.userData.set(o.haze ?? 0.8); navLights(o.nav ?? 0.9);
  W.field.visible = false;
  if (o.missile === false) { W.msl.visible = false; motorOff(); if (o.trail) setTrail(film, o.trail, o); return s; }
  mslCentre(sig, tA); film.place(W.msl, tA); W.msl.visible = true;
  if (sig <= 0) { attitude(s.hdg, s.pitch, s.roll, W.msl.quaternion); motorOff(); return s; }
  attitude(HDG, mslPitch(sig), 3 * Math.sin(sig * 2.1), W.msl.quaternion);
  const burn = sig < K.burn ? 1 : 0, flash = 1 + 2.4 * Math.exp(-sig / 0.045), flick = 0.92 + 0.08 * Math.sin(t * 190) + 0.05 * Math.sin(t * 517);
  W.msl.userData.setBurn(burn); W.plume.userData.set(burn, (o.plumeGain ?? 5.5) * flick);
  W.glow.userData.set(burn * (o.glow ?? 2.0) * flash * flick, 1.3 + 0.5 * (flash - 1) * 0.35);
  W.mhaze.userData.set(burn); W.lamp.intensity = burn * (o.lamp ?? 90) * flash * flick;
  setTrail(film, sig, o);
  return s;
}
function setTrail(film, sig, o = {}) { tB.copy(IGNITION).sub(film.origin); W.trail.userData.set(sig, tB, HDG, W.sunDir, { density: o.density ?? 1, stretch: o.stretch ?? 0.4, plume: o.trailGlow ?? 1 }); }
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
const AIR_POST = { clouds: CLOUDS, exposure: 0.2, contrast: 1.3, sat: 1.18, wb: [1.03, 1.0, 0.95], aerial: 0.82, grain: 0.035, bloom: 0.065, cirrus: { ...CIRRUS, alt: 14200 } };
const PLOT_POST = { clouds: { ...CLOUDS, cover: 0, shadow: 0, steps: 8 }, exposure: 0.12, contrast: 1.25, sat: 0.3, wb: [0.88, 0.96, 1.08], aerial: 0.4, grain: 0.03, bloom: 0.03, vignette: 0.5, cirrus: null, shutter: 0, ao: false };
const PLOT_C = v3(24000, 0, -28000);
const plotCam = (lt) => ({ pos: v3(PLOT_C.x + lt * 30, 78000, PLOT_C.z - lt * 55), look: v3(PLOT_C.x + lt * 30, 0, PLOT_C.z - lt * 55), up: v3(0, 0, -1), fov: 40 });

const SIG = {   // film time -> seconds from ignition, per airborne shot
  s05: t => -30 + (t - 28.8), s07: t => -3.2 + (t - 44.0), s08: t => SLOW * (t - T_IGN),
  s09: t => SLOW * (52.2 - T_IGN) + (t - 52.2), s11: t => 40 + (t - 65.3), s12: t => T_BRK - 0.6 + (t - 72.3),
};

const shots = [
  { id: 's01', name: 'Edwards, evening', t0: 0, t1: 6.4, terrain: 'ground', note: 'Low on the apron, looking into the setting sun: the jet in silhouette, its shadow reaching the lens, light breaking through cloud.',
    pose: (lt, t, f) => poseGround(f, PARK.p, PARK.hdg, 0),
    camera: (lt) => { const k = ease(lt / 6.4); return { pos: park(-17.6 + 2.4 * k, 0.42 + 0.22 * k, 15.4 - 1.4 * k), look: park(0.6, 2.35 - 0.25 * k, 0.4), fov: 32, shake: { rot: 0.02, freq: 0.3, seed: 1 }, focus: park(-3, 1, 3), focusRadius: 24 }; },
    post: { ...GROUND_POST, exposure: GROUND_POST.exposure * 0.82, vignette: 0.34, rays: 0.5, flare: FLARE, sunDisk: 0.5, bloom: 0.1, dof: { focus: 23, fstop: 2.4, max: 10 } } },
  { id: 's02', name: 'No cockpit', t0: 6.4, t1: 14.3, terrain: 'ground', note: 'Slider down the sunlit port side: chined nose, no canopy, splinter paint, the designation.',
    pose: (lt, t, f) => poseGround(f, PARK.p, PARK.hdg, 0),
    camera: (lt) => { const k = ease(lt / 8.2); return { pos: park(6.2 - 6.6 * k, 1.5, -7.6), look: park(4.4 - 5.0 * k, 1.08, 0), fov: 24, shake: { rot: 0.025, freq: 0.35, seed: 2 }, focus: park(-2, 1, 3), focusRadius: 20 }; },
    post: { ...GROUND_POST, exposure: 0.2, dof: { focus: 7.6, fstop: 4, max: 9 } } },
  { id: 's03', name: 'The weapon', t0: 14.3, t1: 22.3, terrain: 'ground', note: 'Under the left wing: an AIM-120 on its rail launcher, radome to fins, in low raking light.',
    pose: (lt, t, f) => poseGround(f, PARK.p, PARK.hdg, 0),
    camera: (lt) => { const k = ease(lt / 8.2); return { pos: park(4.6 - 3.6 * k, 0.42 + 0.14 * k, -5.1 + 0.5 * k), look: park(2.0 - 2.3 * k, 0.66, -1.85), fov: 22, shake: { rot: 0.02, freq: 0.3, seed: 3 }, focus: park(-1, 1, 1), focusRadius: 16 }; },
    post: { ...GROUND_POST, exposure: 0.21, dof: { focus: 3.4, fstop: 4, max: 11 } } },
  { id: 's04', name: 'Take-off', t0: 22.3, t1: 28.8, terrain: 'ground', note: 'Long lens across the runway: rotation, wheels off, the desert and its far ranges behind.',
    pose: (lt, t, f) => { const r = roll(lt); poseGround(f, fieldW(r.u, 0, r.y), RWY_HDG, r.pitch, { haze: 1.3, ramp: true, nav: 0.7 }); },
    camera: (lt) => { const r = roll(lt), l = roll(lt - 0.1); const tgt = fieldW(l.u + 2.5, 0, lerp(l.y, FIELD_ALT + 4, 0.1) + 0.2); return { pos: fieldW(150, 300, FIELD_ALT + 6.5), look: tgt, fov: 3.5 - 0.4 * smooth(2, 6.5, lt), shake: { rot: 0.018, freq: 1.3, seed: 4 }, focus: fieldW(r.u, 0, r.y), focusRadius: 9 }; },
    post: { ...GROUND_POST, shimmer: [1.5, 30, 280], exposure: 0.2 } },
  { id: 's05', name: 'Secluded airspace', t0: 28.8, t1: 33.6, terrain: 'air', note: 'Air-to-air from the port quarter: the jet over cloud and long-shadowed desert ranges, the missile under its left wing.',
    pose: (lt, t, f) => poseAir(f, SIG.s05(t), t),
    camera: (lt, t) => { const s = acAt(SIG.s05(t)), k = ease(lt / 4.8); return { pos: body(s, [-13 + 3 * k, 4.4 - 0.5 * k, -12.5 + 1.5 * k]), look: body(s, [1.0, 0.6, 0.5]), fov: 26, shake: { rot: 0.05, freq: 0.5, seed: 5 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: (lt, t) => { const s = acAt(SIG.s05(t)); return { ...AIR_POST, clouds: { ...CLOUDS, hole: [s.p.x + FWD.x * 9000, s.p.z + FWD.z * 9000, 9000, 0.7] } }; } },
  { id: 's06', name: 'Digital target', t0: 33.6, t1: 44.0, terrain: 'top', note: 'Engagement plot over the Mojave relief (original, illustrative): a target track arrives; a human operator tasks ENGAGE; the aircraft sequences the shot.',
    pose: (lt, t, f) => poseAir(f, -20, t, { missile: false, haze: 0, nav: 0 }),
    camera: (lt) => plotCam(lt),
    post: () => ({ ...PLOT_POST }) },
  { id: 's07', name: 'On the rail', t0: 44.0, t1: 46.7, terrain: 'air', note: 'Simulated wing-station camera looking forward along the missile, the low sun at the edge of frame.',
    pose: (lt, t, f) => poseAir(f, SIG.s07(t), t),
    camera: (lt, t) => { const s = acAt(SIG.s07(t)); attitude(s.hdg, s.pitch, s.roll, q1); return { pos: body(s, [-2.62, -0.63, -2.78], true), look: body(s, [4.5, -0.50, -1.72], true), up: v3(0, 1, 0).applyQuaternion(q1), fov: 60, shake: { rot: 0.16, freq: 3.2, seed: 7, jolt: 0.07 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: { ...AIR_POST, exposure: 0.17, lensK: 0.06, vignette: 0.42, grain: 0.055, sat: 1.05, rays: 0.35, flare: FLARE, sunDisk: 0.4 } },
  { id: 's08', name: 'Fox three', t0: 46.7, t1: 52.2, terrain: 'air', note: 'Port-side long lens, slow motion: the motor lights under the wing, the missile leaves the rail and outruns the frame.',
    pose: (lt, t, f) => poseAir(f, SIG.s08(t), t, { stretch: 0.3 }),
    camera: (lt, t) => { const sig = SIG.s08(t), s = acAt(sig), d = mslAhead(sig), k = smooth(T_IGN + 0.5, T_IGN + 3.8, t), j = t > T_IGN ? Math.exp(-(t - T_IGN) * 1.5) : 0;
      return { pos: body(s, [2.0 + 5 * k, -5.2, -57]), look: body(s, [1.4 + Math.min(d, 16) * 0.5 * k + 3.5 * k, -0.35 + mslClimb(sig) * 0.3 * k, 0]), fov: 12.6 + 12 * k, shake: { rot: 0.03 + 0.05 * j, freq: 1.4, seed: 8 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: (lt, t) => ({ ...AIR_POST, exposure: 0.185 - (t > T_IGN ? 0.02 * Math.exp(-(t - T_IGN) * 3) : 0), bloom: 0.085, shutter: 0.35 }) },
  { id: 's09', name: 'Fly-out', t0: 52.2, t1: 58.2, terrain: 'air', note: 'From behind and above: the missile climbs away on a thin trail toward the sun and a target that is not there.',
    pose: (lt, t, f) => poseAir(f, SIG.s09(t), t, { stretch: 0.55 }),
    camera: (lt, t) => { const sig = SIG.s09(t), s = acAt(sig), m = mslCentre(sig, v3()), k = ease(lt / 6); const look = body(s, [70, 2, -4]).lerp(m, 0.3 + 0.3 * k); return { pos: body(s, [-16 - 4 * k, 4.4 + 1.2 * k, 5.2]), look, fov: 36 - 6 * k, shake: { rot: 0.06, freq: 0.7, seed: 9 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: { ...AIR_POST, exposure: 0.165, rays: 0.4, flare: FLARE, sunDisk: 0.4 } },
  { id: 's10', name: 'Resolved as data', t0: 58.2, t1: 65.3, terrain: 'top', note: 'Back on the plot: the missile track runs out to the digital target. No physical target, no explosion.',
    pose: (lt, t, f) => poseAir(f, 20, t, { missile: false, haze: 0, nav: 0 }),
    camera: (lt) => plotCam(lt + 10.4),
    post: () => ({ ...PLOT_POST }) },
  { id: 's11', name: 'One step closer', t0: 65.3, t1: 72.3, terrain: 'air', note: 'Heading home: the jet over the desert with an empty rail under its left wing.',
    pose: (lt, t, f) => poseAir(f, SIG.s11(t), t, { missile: false }),
    camera: (lt, t) => { const s = acAt(SIG.s11(t)), k = ease(lt / 7); return { pos: body(s, [4.5 - 9.5 * k, -1.5 + 2.3 * k, -9.6 - 1.2 * k]), look: body(s, [0.5 - 0.6 * k, -0.3, -1.0 + 0.8 * k]), fov: 25, shake: { rot: 0.05, freq: 0.5, seed: 11 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: (lt, t) => { const s = acAt(SIG.s11(t)); return { ...AIR_POST, exposure: 0.195, clouds: { ...CLOUDS, hole: [s.p.x, s.p.z, 8000, 0.6] } }; } },
  { id: 's12', name: 'End card', t0: 72.3, t1: DUR, terrain: 'air', note: 'The jet banks away toward the low sun; title, date, sources.',
    pose: (lt, t, f) => poseAir(f, SIG.s12(t), t, { missile: false }),
    camera: (lt, t) => { const s0 = acAt(T_BRK - 0.6), s = acAt(SIG.s12(t)); const cam = body({ p: tA.copy(s0.p).addScaledVector(FWD, V * lt), hdg: HDG }, [-27, 3.2, 9.5]); return { pos: cam, look: s.p.clone(), fov: 30 - 5 * smooth(0.5, 6, lt), shake: { rot: 0.05, freq: 0.6, seed: 12 }, focus: s.p.clone(), focusRadius: 7 }; },
    post: { ...AIR_POST, exposure: 0.16, rays: 0.4, flare: FLARE, sunDisk: 0.4, bloom: 0.08 } },
];

// ------------------------------------------------------------------ overlays
const cues = [
  { type: 'l3', t0: 0.8, t1: 5.9, kicker: 'Announced July 15, 2026', title: 'Edwards Air Force Base', sub: 'California · with the 412th Test Wing’s Air Dominance Combined Test Force' },
  { type: 'l3', t0: 7.0, t1: 13.8, kicker: 'Anduril · U.S. Air Force', title: 'YFQ-44A “Fury”', sub: 'Collaborative Combat Aircraft · uncrewed' },
  { type: 'l3', t0: 15.0, t1: 21.8, kicker: 'On an underwing hardpoint', title: 'AIM-120 AMRAAM', sub: 'Radar-guided air-to-air missile, carried externally' },
  { type: 'l3', t0: 29.2, t1: 33.3, kicker: 'Secluded airspace', title: 'Mojave Desert' },
  { type: 'stat', t0: 48.2, t1: 51.8, value: 'FOX THREE', label: 'Brevity code: active-radar missile away' },
  { type: 'stat', side: 'left', t0: 52.8, t1: 57.8, value: 'FIRST', label: 'Live-fire by a U.S. Collaborative Combat Aircraft' },
  { type: 'quote', t0: 66.0, t1: 71.9, text: '“We’re one step closer to delivering capabilities to the warfighter.”', cite: 'Gen. Ken Wilsbach, Air Force Chief of Staff · July 15, 2026' },
  { type: 'card', t0: 73.0, t1: DUR, fadeOut: 0.9, html: `<div class="k">Anduril · U.S. Air Force · YFQ-44A</div><div class="t">Fox Three</div><div class="row"><span>First CCA live-fire</span><span>Announced July 15, 2026</span><span>Edwards AFB · Mojave Desert</span></div><div class="src">Sources: U.S. Air Force release and Anduril statement of July 15, 2026, as reported by The War Zone; New Atlas.</div><div class="dis">Simulated visualization. Not actual footage. Time of day, weather, altitude, speed, flight path, ranges, the engagement plot, the wing station shown, the missile’s fly-out and the slow-motion launch are illustrative. The target was digital: no physical aircraft was engaged. Date, base, missile type and quotations are as reported.</div>` },
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
  const a1 = smooth(33.6, 34.3, t) * (1 - smooth(43.55, 44.0, t)), a2 = smooth(58.2, 58.8, t) * (1 - smooth(64.85, 65.3, t)), A = Math.max(a1, a2);
  if (A <= 0.001) { if (hud.on) { g.clearRect(0, 0, PW, PH); hud.on = false; } return; }
  hud.on = true; const second = t > 50;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, PW, PH); g.globalAlpha = A;
  g.fillStyle = 'rgba(3,7,11,0.5)'; g.fillRect(0, 0, PW, PH);
  g.lineCap = 'butt'; g.lineJoin = 'miter';
  g.strokeStyle = INK; g.lineWidth = 1; g.globalAlpha = 0.07 * A; g.beginPath();
  for (let x = 96; x < PW; x += 144) { g.moveTo(x + 0.5, 150); g.lineTo(x + 0.5, 890); }
  for (let y = 150; y <= 890; y += 148) { g.moveTo(74, y + 0.5); g.lineTo(PW - 74, y + 0.5); }
  g.stroke();
  g.globalAlpha = 0.34 * A; g.strokeRect(74.5, 150.5, PW - 149, 740);
  label(g, 'ENGAGEMENT PLOT', 76, 128, { display: true, w: 700, size: 40, ls: 4, A });
  label(g, 'ILLUSTRATIVE DIAGRAM · NOT AN OPERATOR DISPLAY · NOT TO SCALE', PW - 76, 126, { align: 'right', size: 17, a: 0.7, A });
  const ac = [AC0[0] + (second ? 26 : 0), AC0[1] - (second ? 40 : 0) - (t - (second ? 58.2 : 33.6)) * 2.2];
  const tEng = 40.5, link = second ? 1 : smooth(34.6, 35.4, t);
  g.globalAlpha = 0.5 * A * link; g.setLineDash([3, 9]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(OP[0] + 30, OP[1] - 22); g.lineTo(ac[0] - 28, ac[1] + 22); g.stroke(); g.setLineDash([]);
  { const mx = (OP[0] + ac[0]) / 2, my = (OP[1] + ac[1]) / 2; g.save(); g.translate(mx, my); g.rotate(Math.atan2(ac[1] - OP[1], ac[0] - OP[0])); label(g, 'COMMAND LINK · BEYOND LINE OF SIGHT', 0, -14, { align: 'center', size: 15, a: 0.62 * link, A }); g.restore(); }
  g.globalAlpha = A; g.lineWidth = 2; g.strokeStyle = INK; g.strokeRect(OP[0] - 22.5, OP[1] - 22.5, 45, 45);
  g.beginPath(); g.moveTo(OP[0] - 9, OP[1] + 9); g.lineTo(OP[0], OP[1] - 10); g.lineTo(OP[0] + 9, OP[1] + 9); g.stroke();
  label(g, 'OPERATOR', OP[0] - 22, OP[1] + 56, { size: 20, w: 700, A }); label(g, 'HUMAN · LOCATION NOT RELEASED', OP[0] - 22, OP[1] + 82, { size: 15, a: 0.62, A });
  g.globalAlpha = A; g.lineWidth = 2.5; g.beginPath(); g.moveTo(ac[0] - 15, ac[1] + 17); g.lineTo(ac[0], ac[1] - 19); g.lineTo(ac[0] + 15, ac[1] + 17); g.lineTo(ac[0], ac[1] + 8); g.closePath(); g.stroke();
  label(g, 'YFQ-44A', ac[0] + 30, ac[1] - 4, { size: 20, w: 700, A }); label(g, 'UNCREWED', ac[0] + 30, ac[1] + 20, { size: 15, a: 0.62, A });
  const tTrk = 35.6, trk = second ? 1 : smooth(tTrk, tTrk + 0.5, t), blink = second ? 1 : (t < tTrk + 1.6 ? 0.55 + 0.45 * Math.sign(Math.sin((t - tTrk) * 16)) : 1);
  if (trk > 0) {
    g.globalAlpha = A * trk * blink; g.lineWidth = 2.5; g.strokeStyle = AMBER;
    g.beginPath(); g.moveTo(TG[0], TG[1] - 22); g.lineTo(TG[0] + 22, TG[1]); g.lineTo(TG[0], TG[1] + 22); g.lineTo(TG[0] - 22, TG[1]); g.closePath(); g.stroke();
    g.setLineDash([2, 7]); g.lineWidth = 1.2; g.beginPath(); g.arc(TG[0], TG[1], 46 + 30 * (1 - trk), 0, 6.2832); g.stroke(); g.setLineDash([]);
    label(g, 'TRACK 01 · DIGITAL TARGET', TG[0] + 62, TG[1] - 6, { size: 20, w: 700, color: AMBER, A: A * trk }); label(g, 'SIMULATED · NO PHYSICAL AIRCRAFT', TG[0] + 62, TG[1] + 19, { size: 15, a: 0.7, A: A * trk });
    g.strokeStyle = INK; g.globalAlpha = 0.28 * A * trk; g.setLineDash([1, 8]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(ac[0] + 14, ac[1] - 16); g.lineTo(TG[0] - 30, TG[1] + 14); g.stroke(); g.setLineDash([]);
  }
  if (!second && t > tEng - 0.1) {
    const p = ease((t - tEng) / 0.95), x = lerp(OP[0] + 30, ac[0] - 28, p), y = lerp(OP[1] - 22, ac[1] + 22, p), pulse = Math.exp(-Math.max(0, t - tEng) * 2.2);
    g.globalAlpha = A; g.fillStyle = AMBER; g.beginPath(); g.arc(x, y, 7, 0, 6.2832); g.fill();
    g.strokeStyle = AMBER; g.lineWidth = 2; g.globalAlpha = A * pulse; g.strokeRect(OP[0] - 22.5 - 26 * (1 - pulse), OP[1] - 22.5 - 26 * (1 - pulse), 45 + 52 * (1 - pulse), 45 + 52 * (1 - pulse));
    label(g, 'TASKING: ENGAGE', x + 20, y + 30, { size: 19, w: 700, color: AMBER, A: A * smooth(tEng, tEng + 0.25, t) });
  }
  let done = 0;
  if (second) {
    const p = ease((t - 58.9) / 4.0), sx = ac[0] + 12, sy = ac[1] - 18, ex = TG[0] - 14, ey = TG[1] + 9, x = lerp(sx, ex, p), y = lerp(sy, ey, p) - Math.sin(p * Math.PI) * 46;
    g.strokeStyle = INK; g.globalAlpha = A; g.lineWidth = 2.5; g.beginPath(); g.moveTo(sx, sy);
    for (let i = 1; i <= 40; i++) { const q = p * i / 40; g.lineTo(lerp(sx, ex, q), lerp(sy, ey, q) - Math.sin(q * Math.PI) * 46); } g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(x, y, 5.5, 0, 6.2832); g.fill();
    if (p < 0.98) label(g, 'AIM-120', x - 16, y - 20, { align: 'right', size: 17, w: 700, A });
    done = smooth(62.9, 63.4, t);
    if (done > 0) { const e = t - 62.9; g.strokeStyle = AMBER; g.lineWidth = 2; for (const k of [0, 0.45]) { const r = 30 + (e - k) * 70; if (e > k && r < 190) { g.globalAlpha = A * Math.max(0, 1 - r / 190); g.beginPath(); g.arc(TG[0], TG[1], r, 0, 6.2832); g.stroke(); } }
      label(g, 'ENGAGEMENT COMPLETE', TG[0] - 62, TG[1] + 94, { size: 20, w: 700, color: AMBER, A: A * done, align: 'right' }); label(g, 'TARGET EXISTED ONLY AS DATA · NOTHING WAS HIT', TG[0] - 62, TG[1] + 120, { size: 15, a: 0.7, A: A * done, align: 'right' }); }
  }
  const steps = second
    ? [['01', 'TARGET TRACK INGESTED', 'mission software', 0], ['02', 'OPERATOR TASKS: ENGAGE', 'the human decision', 0], ['03', 'WEAPON EMPLOYMENT SEQUENCE', 'run by the aircraft', 0], ['04', 'AIM-120 AWAY', 'one missile', 58.5]]
    : [['01', 'TARGET TRACK INGESTED', 'mission software', 36.3], ['02', 'OPERATOR TASKS: ENGAGE', 'the human decision', 41.4], ['03', 'WEAPON EMPLOYMENT SEQUENCE', 'run by the aircraft', 42.3], ['04', 'AIM-120 AWAY', 'one missile', 1e9]];
  const X0 = 1218, Y0 = 566;
  steps.forEach(([n, s1, s2, at], i) => {
    const on = smooth(at, at + 0.3, t), y = Y0 + i * 66, human = i === 1;
    g.globalAlpha = A * (0.3 + 0.7 * on); g.strokeStyle = human && on > 0.5 ? AMBER : INK; g.lineWidth = 1.5; g.strokeRect(X0 + 0.5, y - 21.5, 26, 26);
    if (on > 0) { g.fillStyle = human ? AMBER : INK; g.globalAlpha = A * on; g.fillRect(X0 + 6, y - 16, 15, 15); }
    label(g, n, X0 + 44, y, { size: 16, a: 0.6 * (0.4 + 0.6 * on), A }); label(g, s1, X0 + 86, y - 3, { size: 19, w: 700, color: human && on > 0.5 ? AMBER : INK, a: 0.35 + 0.65 * on, A }); label(g, s2.toUpperCase(), X0 + 86, y + 19, { size: 13.5, a: 0.55 * (0.4 + 0.6 * on), A, ls: 2 });
  });
  if (!second) { const q = smooth(42.3, 42.9, t); if (q > 0) label(g, '“…AUTONOMOUSLY WITHIN PILOT-DEFINED PARAMETERS” — GEN. DALE WHITE, USAF', X0, Y0 + 4 * 66 + 6, { size: 13.5, a: 0.7 * q, A, ls: 1.4 }); }
  else { const q = smooth(59.4, 60.2, t) * (1 - smooth(64.3, 64.9, t)); if (q > 0) { label(g, '“AN END-TO-END, BEYOND-LINE-OF-SIGHT STRIKE', 96, 250, { size: 22, w: 700, A: A * q, ls: 2.4 }); label(g, 'AGAINST A SIMULATED TARGET.”', 96, 282, { size: 22, w: 700, A: A * q, ls: 2.4 }); label(g, 'MARK SHUSHNAR, ANDURIL · JULY 15, 2026', 96, 316, { size: 15, color: AMBER, A: A * q }); } }
  g.globalAlpha = 1;
}
function updateHud(t) {
  drawPlot(t);
  hud.slow.style.opacity = (smooth(46.9, 47.3, t) * (1 - smooth(51.8, 52.2, t))).toFixed(3);
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
  for (const t of [0.9, 7.05, 15.05]) m.beep(t, { freq: 1175, gain: 0.022, dur: 0.05 });
  // take-off: a small turbofan at full power passing the camera
  m.jet({ env: [[22.3, 0], [22.5, 0.1], [25.2, 0.3], [26.6, 0.34], [28.75, 0.16], [28.8, 0]], pitch: [[22.3, 1.25], [26.4, 1.3], [28.8, 1.05]], pan: 0, whine: 0.9, bright: 1.15 });
  m.pad(22.0, 29.2, Am, { gain: 0.04, bright: 900, attack: 1.2 });
  // at altitude
  m.wind({ env: [[28.8, 0], [28.9, 0.06], [33.5, 0.06], [33.6, 0.012], [43.9, 0.012], [44.0, 0.11], [46.65, 0.12], [46.7, 0.04], [52.2, 0.04], [52.25, 0.075], [58.1, 0.07], [58.2, 0.012], [65.2, 0.012], [65.3, 0.065], [77, 0.06], [DUR, 0]], freq: 700 });
  m.jet({ env: [[28.8, 0], [28.9, 0.05], [33.5, 0.05], [33.6, 0], [44.0, 0], [44.05, 0.09], [46.65, 0.09], [46.7, 0.03], [52.1, 0.03], [52.2, 0.07], [58.1, 0.06], [58.2, 0], [65.3, 0], [65.4, 0.055], [72.3, 0.055], [76.5, 0.02], [DUR, 0]], pitch: [[28.8, 1.2], [DUR, 1.15]], pan: 0.15, whine: 0.5, bright: 0.9 });
  m.pad(28.9, 34.2, Em, { gain: 0.045, bright: 950 });
  // the plot: a low room tone, ticks as each step lands
  m.tone({ type: 'sine', freq: 55, env: [[33.6, 0], [34.4, 0.06], [43.6, 0.06], [44.0, 0]], dest: m.music });
  m.tone({ type: 'sine', freq: 55, env: [[58.2, 0], [58.8, 0.06], [64.9, 0.06], [65.3, 0]], dest: m.music });
  m.pad(33.8, 44.2, Dm9, { gain: 0.036, bright: 800 });
  m.pulse(34.2, 43.6, 0.78, { freq: 41, gain: 0.2 });
  for (const [t, f] of [[35.6, 880], [35.78, 880], [36.3, 1320], [41.4, 1320], [42.3, 1320]]) m.beep(t, { freq: f, gain: 0.045, dur: 0.06 });
  m.thump(40.5, { gain: 0.55, f0: 110, f1: 55, dur: 0.35 }); m.beep(40.5, { freq: 660, gain: 0.06, dur: 0.16 });
  // on the rail, then the shot (slow motion: everything stretched and low)
  m.riser(44.2, T_IGN - 0.02, { gain: 0.15 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: 300, env: [[44.0, 0], [44.1, 0.22], [46.6, 0.24], [46.7, 0]] });
  m.hit(T_IGN, { gain: 0.9 });
  m.thump(T_IGN, { gain: 1.2, f0: 120, f1: 30, dur: 1.6, send: 0.5 });
  m.noise({ kind: 'white', type: 'bandpass', freq: [[T_IGN, 2600], [T_IGN + 0.4, 900], [52.2, 260]], q: 0.7, env: [[T_IGN, 0], [T_IGN + 0.03, 0.75], [T_IGN + 0.8, 0.5], [52.1, 0.16], [52.2, 0]], pan: [[T_IGN, 0.1], [52.2, -0.65]], send: 0.35 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: [[T_IGN, 700], [52.2, 160]], env: [[T_IGN, 0], [T_IGN + 0.04, 1.1], [T_IGN + 1.2, 0.6], [52.1, 0.2], [52.2, 0]], pan: [[T_IGN, 0.1], [52.2, -0.6]], send: 0.3 });
  // fly-out in real time: the motor's roar thinning into distance
  m.noise({ kind: 'white', type: 'bandpass', freq: [[52.2, 1500], [58.2, 380]], q: 0.8, env: [[52.2, 0], [52.25, 0.28], [54.2, 0.1], [58.1, 0.015], [58.2, 0]], pan: [[52.2, -0.2], [58.2, -0.5]], send: 0.5 });
  m.noise({ kind: 'brown', type: 'lowpass', freq: 220, env: [[52.2, 0], [52.25, 0.5], [55.2, 0.15], [58.1, 0.02], [58.2, 0]], send: 0.4 });
  m.pad(47.6, 58.6, Em, { gain: 0.058, bright: 1250, attack: 0.8 });
  m.pad(58.0, 65.6, C, { gain: 0.04, bright: 900 });
  for (const [t, f] of [[58.5, 1320], [62.9, 1568], [63.08, 1568]]) m.beep(t, { freq: f, gain: 0.045, dur: 0.06 });
  m.pulse(58.8, 62.9, 0.7, { freq: 41, gain: 0.18, accel: 0.02 });
  m.thump(62.9, { gain: 0.5, f0: 90, f1: 40, dur: 0.6 });
  m.pad(65.3, 73.2, G, { gain: 0.052, bright: 1250 });
  m.pad(72.6, DUR - 0.6, Em, { gain: 0.055, bright: 1000, release: 0.6 });
  m.hit(73.0, { gain: 0.55 });
  for (const t of [29.25, 48.25, 52.85]) m.beep(t, { freq: 1175, gain: 0.025, dur: 0.05 });
}

startFilm({
  id: 'fury', title: 'Fox Three', duration: DUR, fps: 30, poster: 48.9, narration: NARRATION,
  build, shots, cues, buildHud, updateHud, score,
  frame(t, shot, lt, film, c) {
    W.terrain.update(shot.terrain);
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
