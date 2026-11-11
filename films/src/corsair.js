// THREE CORSAIRS — Saronic Corsair uncrewed surface vessels strike the submarine and ship maintenance
// facility at Bandar Abbas Naval Base (July 12, 2026). A simulated visualization.
// Documented (CENTCOM, July 13, 2026; Saronic; trade reporting): the date, the place, three Corsairs used as
// one-way attack surface drones, the first combat use of sea drones by American forces, the released overhead
// thermal and bow-camera views. Everything else on screen (time of day, weather, sea state, courses, speeds,
// ranges, camera positions, the look of the port, where and how the boats detonate) is illustrative.
import * as THREE from 'three';
import { startFilm, clamp, lerp, smooth, ease, easeOut, wobble, v3 } from '../engine/film.js';
import { LAYER } from '../engine/pipeline.js';
import { CloudLayer } from '../engine/clouds.js';
import { Ocean } from '../engine/ocean.js';
import { attitude } from '../engine/geo.js';
import { Trail, makeGlow } from '../engine/fx.js';
import { buildPort, PORT } from './corsair_model.js';
import { buildCorsair, buildShip } from './corsair_boat.js';

const NARRATION = __NARRATION__;
const SUN = { az: 80, el: +new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('sunel') || 11 };   // low morning sun, east
const DUR = 81;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ tracks
// A track is a function of film time returning { x, z, hdg, v, on }. Shots cut between stretches of the run;
// the final approach (from 36.5 s) is one continuous piece of time for all three boats.
const straight = (x0, z0, hdg, v, t0) => t => { const r = hdg * D2R, d = v * (t - t0); return { x: x0 + Math.sin(r) * d, z: z0 - Math.cos(r) * d, hdg, v, on: true }; };
function approach(points, tHit, v) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.5), L = curve.getLength(), p = new THREE.Vector3(), q = new THREE.Vector3();
  const n = points.length, endHdg = Math.atan2(points[n - 1][0] - points[n - 2][0], -(points[n - 1][1] - points[n - 2][1])) / D2R;
  return t => {
    const s = L - v * (tHit - t), u = clamp(s / L, 0, 1);
    if (s < 0) { const a = points[0], b = points[1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l; return { x: a[0] + dx * s, z: a[1] + dz * s, hdg: Math.atan2(dx, -dz) / D2R, v, on: true }; }
    curve.getPointAt(u, p); curve.getPointAt(Math.min(1, u + 0.01), q);
    const hdg = u < 0.985 ? Math.atan2(q.x - p.x, -(q.z - p.z)) / D2R : endHdg;
    return { x: p.x, z: p.z, hdg, v: t < tHit ? v : 0, on: t < tHit };
  };
}
const HIT = [50.9, 52.1, 53.3];
const RUN_IN = [
  approach([[236, 296], [122, 172], [34, 88], PORT.hits[0]], HIT[0], 15),
  approach([[300, 250], [160, 150], [66, 62], PORT.hits[1]], HIT[1], 15),
  approach([[170, 372], [100, 200], [-24, 128], [-40, 64], PORT.hits[2]], HIT[2], 15),
];
const SEA = { x: 60, z: 9200 };                                    // open-water stage, well south of the port
const LEAD = straight(SEA.x, SEA.z, 0, 16.5, 6.5);                 // shot 2
const PASS = straight(SEA.x - 6, SEA.z - 60, 0, 16.5, 14.5);       // shot 3
const TRIO = [straight(0, 7000, 0, 16.5, 21), straight(-30, 7036, 0, 16.5, 21), straight(27, 7064, 0, 16.5, 21)];   // shot 4
// shot 5: the three converge on the harbour mouth from different bearings (reportedly; New Atlas)
const CONV = [straight(262, 528, 328, 16, 28.5), straight(486, 306, 292, 16, 28.5), straight(124, 610, 2, 16, 28.5)];

// ------------------------------------------------------------------ world
let W;
const CLOUDS = { cover: 0.36, scale: 0.8, wind: [0.010, 0.004], density: 0.013, tile: 4000, steps: 40, shadow: 0.65 };
async function build(film) {
  const pipe = film.pipe;
  pipe.atmo.setSun(SUN.az, SUN.el);
  pipe.atmo.uniforms.uHaze.value = +film.params.get('haze') || 25; pipe.atmo.uniforms.uHazeH.value = 550; pipe.atmo.groundAlbedo.setRGB(0.05, 0.08, 0.09);
  const clouds = new CloudLayer(pipe, { base: +film.params.get('cbase') || 900, top: +film.params.get('ctop') || 2300, div: +film.params.get('cdiv') || 4 });
  const P = film.params, sea = { wind: 50, amp: +P.get('seaamp') || 2.4, long: +P.get('sealong') || 0.45, chop: +P.get('seachop') || 0.85, spread: 40 };
  const ocean = new Ocean(pipe, { clouds, sea });
  ocean.setShelter(15, 70, 150, 340, 0.3);      // the basin behind the breakwaters
  const boats = []; for (let i = 0; i < 3; i++) { const b = await buildCorsair(pipe); pipe.scene.add(b); pipe.registerDynamic(b); boats.push(b); }
  // spray: two sheets thrown off the chines forward of midships and a rooster tail off the transom, per boat
  const spray = boats.map(() => ({
    side: [-1, 1].map(() => new Trail(pipe, { rate: 190, life: 0.45, size0: 0.08, size1: 0.44, grow: 0.8, color: [0.93, 0.95, 0.96], alpha: 0.15, jitter: 0.2, drift: [0, -2.4, 0], drag: 3.0, spreadV: 1.6, noise: 1.0, softness: 0.3, fadeIn: 0.05 })),
    tail: new Trail(pipe, { rate: 110, life: 0.6, size0: 0.14, size1: 0.8, grow: 0.8, color: [0.93, 0.95, 0.96], alpha: 0.13, jitter: 0.25, drift: [0, -1.8, 0], drag: 2.6, spreadV: 1.4, noise: 1.0, softness: 0.3, fadeIn: 0.06 }),
  }));
  const port = buildPort(pipe); pipe.scene.add(port);
  port.traverse(o => { if (o.isMesh) o.layers.set(LAYER.STATIC); });
  // the coast range north of the city: two ragged ridgelines whose tops stand clear of the haze layer
  const hills = new THREE.Group(); pipe.scene.add(hills);
  for (const [zc, hmax, seed, tone] of [[-27000, 1500, 3.1, 0.2], [-41000, 2400, 7.7, 0.24]]) {
    const n = 360, pos = [], idx = [];
    const ridge = u => { let h = 0, a = 1, f = 1; for (let o = 0; o < 6; o++) { h += a * Math.abs(Math.sin(u * f * 9.1 + seed * (o + 1)) * Math.cos(u * f * 5.3 + seed * 1.7 * o)); a *= 0.5; f *= 2.05; } return h / 1.97; };
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = (u - 0.5) * 150000, env = Math.pow(Math.sin(Math.PI * u), 0.6), h = hmax * (0.3 + 0.7 * ridge(u)) * env + 30, z = zc + 4000 * Math.sin(u * 7 + seed);
      pos.push(x, -200, z + 9000, x, h * 0.55, z + 3500, x, h, z);
    }
    for (let i = 0; i < n; i++) { const a = i * 3, b = a + 3; idx.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color(tone * 1.1, tone, tone * 0.88), roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.layers.set(LAYER.STATIC); hills.add(m);
  }
  const ship = await buildShip(250); pipe.scene.add(ship); ship.traverse(o => { if (o.isMesh) o.layers.set(LAYER.STATIC); });
  // the three detonations: flash, fire that turns to smoke, a column of white water, a long smoke plume
  const blasts = PORT.hits.map(([x, z], i) => {
    const T = HIT[i], glow = makeGlow(pipe, { color: [1.0, 0.72, 0.42], size: 30, depthSoft: 6 }); pipe.scene.add(glow);
    return {
      x, z, T, glow,
      fire: new Trail(pipe, { rate: 900, life: 1.2, start: T, stop: T + 0.15, size0: 0.7, size1: 3.6, grow: 0.5, color: [0.045, 0.04, 0.036], color1: [0.14, 0.13, 0.12], alpha: 0.9, jitter: 0.8, drift: [1.2, 3.6, 0.4], drag: 3.2, spreadV: 30, emissive: [46, 18, 4.5], emissiveLife: 0.13, noise: 1, softness: 1.5 }),
      column: new Trail(pipe, { rate: 520, life: 2.5, start: T + 0.02, stop: T + 0.4, size0: 0.45, size1: 3.0, grow: 0.6, color: [0.86, 0.89, 0.9], alpha: 0.4, jitter: 0.7, drift: [0.6, -8.5, 0.2], drag: 1.45, spreadV: 7.5, noise: 1, softness: 1.2 }),
      smoke: new Trail(pipe, { rate: 46, life: 17, start: T + 0.1, stop: T + 60, size0: 1.3, size1: 10, grow: 0.62, color: [0.05, 0.047, 0.043], color1: [0.27, 0.26, 0.245], alpha: 0.66, jitter: 1.4, drift: [2.6, 3.2, 0.9], drag: 0.8, spreadV: 5.5, noise: 1, softness: 3, fadeIn: 0.03 }),
    };
  });
  for (const b of blasts) for (const k of [0, 1, 2]) ocean.discs.push({ x: b.x + (k - 1) * 2.5, z: b.z + 4 + k * 3, t0: b.T + k * 0.25, dur: 7 + k * 2, r0: 3, r1: 26 + k * 12, k: 1 });
  if (film.off.has('clouds')) CLOUDS.cover = 0;
  W = { clouds, ocean, boats, port, ship, spray, blasts, hills };
  return W;
}

// A boat riding the sea. A planing hull rides the crests rather than averaging through them, and it has inertia:
// sample the surface along the keel and abeam at three earlier moments of its own track and fit height, pitch
// and roll from them. Pure function of time.
const tmp = v3();
const KEEL = [-3.0, -1.5, 0, 1.5, 3.0], KW = [0.5, 0.3, 0.2], KDT = [0, 0.09, 0.18];
function seaPose(tr, t) {
  const O = W.ocean; let H = 0, P = 0, R = 0;
  for (let k = 0; k < 3; k++) {
    const tt = t - KDT[k], p = tr(tt), r = p.hdg * D2R, fx = Math.sin(r), fz = -Math.cos(r);
    let sum = 0, mx = -1e9, sxy = 0;
    for (const a of KEEL) { const h = O.heightAt(p.x + fx * a, p.z + fz * a, tt); sum += h; mx = Math.max(mx, h); sxy += a * h; }
    const mean = sum / KEEL.length, slope = sxy / KEEL.reduce((q, a) => q + a * a, 0);
    const hr = O.heightAt(p.x - fz * 0.95, p.z + fx * 0.95, tt), hl = O.heightAt(p.x + fz * 0.95, p.z - fx * 0.95, tt);
    H += KW[k] * (mean + 0.45 * (mx - mean)); P += KW[k] * Math.atan(slope); R += KW[k] * Math.atan2(hr - hl, 1.9);
  }
  return { h: H, pitch: P / D2R, roll: R / D2R };
}
function placeBoat(film, b, tr, t) {
  const p = tr(t), s = seaPose(tr, t), plane = smooth(4, 14, p.v);
  const pitch = s.pitch * 0.85 + 3.6 * plane + 0.4 * wobble(t * 2.3, 3 + p.x * 0.01);
  const roll = s.roll * 0.7 + 0.7 * wobble(t * 1.7, 9 + p.z * 0.01);
  tmp.set(p.x, s.h + 0.22 * plane, p.z); film.place(b, tmp);
  attitude(p.hdg, pitch, roll, b.quaternion);
}
// height of a camera boat or a hand-held camera riding the swell at (x, z)
const ride = (x, z, t, k = 0.75) => W ? W.ocean.heightAt(x, z, t - 0.12) * k : 0;
// a point given in a boat's own axes [forward, up, right], in world coordinates
function boatPoint(p, off, out) { const r = p.hdg * D2R, fx = Math.sin(r), fz = -Math.cos(r); return out.set(p.x + fx * off[0] - fz * off[2], off[1], p.z + fz * off[0] + fx * off[2]); }
function updateSpray(film, i, track, t, on) {
  const sp = W.spray[i], O = film.origin, vis = on && !film.off.has('spray');
  for (const tr of sp.side) tr.mesh.visible = vis; sp.tail.mesh.visible = vis;
  if (!vis) return;
  const at = (tb, fwd, lat, up, out) => { const p = track(tb), r = p.hdg * D2R, fx = Math.sin(r), fz = -Math.cos(r); return out.set(p.x + fx * fwd - fz * lat, W.ocean.heightAt(p.x, p.z, tb) + up, p.z + fz * fwd + fx * lat); };
  sp.side.forEach((tr, k) => { const sg = k ? 1 : -1;
    tr.update(t, O, (tb, out) => at(tb, 0.7, sg * 1.05, 0.2, out), (tb, out) => { const p = track(tb), r = p.hdg * D2R, fx = Math.sin(r), fz = -Math.cos(r), k2 = clamp(p.v / 16, 0, 1.2); return out.set(fx * p.v * 0.9 - fz * sg * 4.2 * k2, 2.6 * k2, fz * p.v * 0.9 + fx * sg * 4.2 * k2); }); });
  sp.tail.update(t, O, (tb, out) => at(tb, -3.9, 0, 0.1, out), (tb, out) => { const p = track(tb), r = p.hdg * D2R, k2 = clamp(p.v / 16, 0, 1.2); return out.set(Math.sin(r) * p.v * 0.88, 2.4 * k2, -Math.cos(r) * p.v * 0.88); });
}
function updateBlasts(film, t, show) {
  const O = film.origin;
  for (const b of W.blasts) {
    const a = t - b.T, live = show && a > -0.1;
    b.fire.mesh.visible = b.column.mesh.visible = b.smoke.mesh.visible = live;
    b.glow.userData.set(live && a >= 0 ? 200 * Math.exp(-a * 30) + 10 * Math.exp(-a * 5) : 0, 9 + 12 * clamp(a * 5, 0, 1));
    tmp.set(b.x, 3.5, b.z); film.place(b.glow, tmp);
    if (!live) continue;
    b.fire.update(t, O, (tb, out) => out.set(b.x, 1.5, b.z), (tb, out) => out.set(0, 16, 0));
    b.column.update(t, O, (tb, out) => out.set(b.x, 0.5, b.z + 1.5), (tb, out) => out.set(0, 30, 2));
    b.smoke.update(t, O, (tb, out) => out.set(b.x, 3, b.z - 2), (tb, out) => out.set(0, 5.5, 0));
  }
}

// ------------------------------------------------------------------ grade
const FLARE = { ghost: 0.05, halo: 0.03, streak: 0.14, thr: 8 };
const SEA_POST = { clouds: CLOUDS, exposure: 0.2, contrast: 1.24, sat: 1.0, wb: [1.0, 1.0, 1.03], aerial: 1.0, grain: 0.045, bloom: 0.1, shutter: 0.22, vignette: 0.3 };
const P0 = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
// up-sun shots: a heavier deck with the sun breaking through it (dev overrides: ?ucov= ?udens= ?urays=)
const UP_CLOUDS = { ...CLOUDS, cover: +P0.get('ucov') || 0.56, density: +P0.get('udens') || 0.017, steps: 48 };
const UP_SUN = { ...SEA_POST, clouds: UP_CLOUDS, rays: +P0.get('urays') || 0.12, flare: FLARE, sunDisk: 0.5 };
const IR_POST = { clouds: null, cirrus: null, mode: 'thermal', thermal: [+P0.get('irg') || 4.2, +P0.get('irl') || 0.075, 0.05, 0], exposure: 0.26, contrast: 1.2, aerial: 0.25, grain: 0.09, bloom: 0.03, shutter: 0.3, vignette: 0.45, ao: false };

// ------------------------------------------------------------------ shots
const sunDir = (d, y) => v3(Math.sin(SUN.az * D2R) * d, y, -Math.cos(SUN.az * D2R) * d);
const shots = [
  { id: 's01', name: 'The strait', t0: 0, t1: 6.5, note: 'High over open water, looking up-sun: the glitter path, haze, a tanker hull-down in it.',
    tracks: [], ship: [2900, 8650, 196],
    camera: (lt) => { const p = v3(SEA.x - 260 + lt * 2.2, 24 - lt * 0.5, SEA.z + 190), q = sunDir(600, (+P0.get('s1pitch') || 20) + lt * 3.5); return { pos: p, look: v3(p.x + q.x, p.y + q.y, p.z + q.z), fov: 38, shake: { rot: 0.05, freq: 0.5, seed: 1 } }; },
    post: { ...UP_SUN, exposure: 0.21 } },
  { id: 's02', name: 'Corsair', t0: 6.5, t1: 14.5, note: 'Chase off the port quarter, low: the boat at speed against the sun path.',
    tracks: [LEAD],
    camera: (lt, t) => { const p = LEAD(t), k = ease(lt / 8); const cx = p.x - 17 + 5 * k, cz = p.z + 15 - 5.5 * k; return { pos: v3(cx, 3.4 - 1.1 * k + ride(cx, cz, t, 0.6), cz), look: v3(p.x + 2, 0.7 + ride(p.x, p.z, t, 0.4), p.z - 1), fov: 30, shake: { rot: 0.14, freq: 0.9, seed: 2, jolt: 0.03 }, focus: v3(p.x, 0.5, p.z), focusRadius: 9 }; },
    post: { ...UP_SUN }, wakeSize: 130 },
  { id: 's03', name: 'Head-on', t0: 14.5, t1: 21, note: 'Water-level long lens: the boat comes at the camera, spray flying, and goes by close.',
    tracks: [PASS],
    camera: (lt, t) => { const p = PASS(t), cam = v3(SEA.x + 1.5, 2.4 + ride(SEA.x + 1.5, SEA.z - 160, t), SEA.z - 160), d = Math.hypot(p.x - cam.x, p.z - cam.z), fov = clamp(2 * Math.atan(5.2 / d) / D2R, 5, 46); return { pos: cam, look: v3(p.x, 1.1 + ride(p.x, p.z, t, 0.5), p.z), fov, shake: { rot: 0.05 * Math.min(1, fov / 14), freq: 1.1, seed: 3 }, focus: v3(p.x, 0.5, p.z), focusRadius: 9 }; },
    post: { ...SEA_POST, exposure: 0.22, shutter: 0.3 }, wakeSize: 150 },
  { id: 's04', name: 'Three', t0: 21, t1: 28.5, note: 'From the air, down-sun: three boats, three white wakes on dark water.',
    tracks: TRIO,
    camera: (lt, t) => { const p = TRIO[0](t), k = lt / 7.5; return { pos: v3(p.x + 150 - 30 * k, 78 - 14 * k, p.z + 62), look: v3(p.x - 4, 0, p.z + 34), fov: 31 - 5 * k, shake: { rot: 0.07, freq: 0.6, seed: 4 }, focus: v3(p.x, 0.5, p.z + 30), focusRadius: 45 }; },
    post: { ...SEA_POST, exposure: 0.24, contrast: 1.28 }, wakeSize: 300, wakeAt: t => { const p = TRIO[0](t); return [p.x, p.z + 70]; } },
  { id: 's05', name: 'Overhead, infrared', t0: 28.5, t1: 36.5, note: 'Simulated sensor view (original graphics, labelled): three warm hulls and their wakes converge on the harbour mouth.',
    tracks: CONV, thermal: true,
    camera: (lt, t) => { // wide for three seconds, then the sensor steps to its narrow field and holds the lead boat
      const k = lt / 8, pos = v3(285 - 30 * k, 640 - 40 * k, 790 - 70 * k);
      if (lt < 3.1) return { pos, look: v3(262 - 30 * k, 0, 420 - 70 * k), fov: 36 - 4 * k, roll: -5 + 3 * k, shake: { rot: 0.03, freq: 0.4, seed: 5 } };
      const p = CONV[0](t), n = (lt - 3.1) / 4.9;
      return { pos, look: v3(p.x - 3 - 2 * n, 0, p.z - 7 + 3 * n), fov: 9.5 - 1.5 * n, roll: -5 + 3 * k, shake: { rot: 0.012, freq: 0.5, seed: 5 } }; },
    post: IR_POST, wakeSize: 700, wakeAt: () => [260, 400], sea: { reflect: false, whitecap: 0 } },
  { id: 's06', name: 'The breakwater', t0: 36.5, t1: 43, note: 'Behind the lead boat as it rounds the breakwater head: sheds, a yellow gantry, a pier.',
    tracks: RUN_IN,
    camera: (lt, t) => { const p = RUN_IN[0](t), k = ease(lt / 6.5); return { pos: boatPoint(p, [-15 + 4 * k, 3.6 - 0.9 * k, 3.2 - 2.2 * k], v3()), look: boatPoint(p, [24, 1.6, -1], v3()), fov: 36, shake: { rot: 0.16, freq: 1.0, seed: 6, jolt: 0.04 }, focus: v3(p.x, 0.5, p.z), focusRadius: 10 }; },
    post: { ...SEA_POST, exposure: 0.215 }, wakeSize: 260, wakeAt: t => { const p = RUN_IN[0](t); return [p.x + 30, p.z + 40]; } },
  { id: 's07', name: 'Bow camera', t0: 43, t1: 50.2, note: 'Simulated bow camera (original graphics, labelled): the dock, the gantry and the hull on it grow in the frame.',
    tracks: RUN_IN, bowcam: true,
    camera: (lt, t) => { const p = RUN_IN[0](t), h = W.ocean.heightAt(p.x, p.z, t); return { pos: boatPoint(p, [1.15, 1.52 + h * 0.8, 0.0], v3()), look: boatPoint(p, [40, 1.5 + h * 0.3, 0.6 * wobble(t * 0.7, 3)], v3()), fov: 62, roll: 1.6 * wobble(t * 1.3, 8), shake: { rot: 0.5, freq: 2.2, seed: 7, jolt: 0.12 }, focus: v3(p.x, 0.5, p.z), focusRadius: 6 }; },
    post: { ...SEA_POST, exposure: 0.21, contrast: 1.3, sat: 0.86, lensK: 0.12, ca: 0.003, grain: 0.08, vignette: 0.5, shutter: 0.3, sharpen: 0.25 }, wakeSize: 220, wakeAt: t => { const p = RUN_IN[0](t); return [p.x - 10, p.z + 10]; } },
  { id: 's08', name: 'Three hits', t0: 50.2, t1: 57.2, note: 'Long lens from the far breakwater: three detonations along the waterline, a second or so apart. No people in frame.',
    tracks: RUN_IN, blasts: true,
    camera: (lt, t) => { const jolt = HIT.reduce((a, T) => a + (t > T + 0.55 ? Math.exp(-(t - T - 0.55) * 3.2) : 0), 0); return { pos: v3(-118 - lt * 0.5, 8.5, 214), look: v3(-6 + lt * 0.3, 11 + lt * 0.6, 30), fov: 13.5 - lt * 0.15, shake: { rot: 0.03 + 0.34 * jolt, freq: 1.4 + 5 * jolt, seed: 8, jolt: 0.16 * jolt }, focus: v3(0, 3, 30), focusRadius: 60 }; },
    post: { ...SEA_POST, exposure: 0.2, bloom: 0.16, shutter: 0.4 }, wakeSize: 240, wakeAt: () => [10, 95] },
  { id: 's09', name: 'First', t0: 57.2, t1: 65, note: 'Wide from outside the basin: three columns of smoke leaning with the wind over the base.',
    tracks: [], blasts: true,
    camera: (lt) => ({ pos: v3(210 + lt * 1.4, 8 + lt * 0.5, 400 - lt * 1.5), look: v3(-6, 30, 20), fov: 24, shake: { rot: 0.06, freq: 0.5, seed: 9 } }),
    post: { ...SEA_POST, exposure: 0.2 }, wakeSize: 420, wakeAt: () => [60, 160] },
  { id: 's10', name: 'Not said', t0: 65, t1: 72, note: 'Empty water, up-sun, low and slow.',
    tracks: [],
    camera: (lt) => { const p = v3(SEA.x + 400 + lt * 1.4, 3.2, SEA.z - 900), q = sunDir(300, -9); return { pos: p, look: v3(p.x + q.x, p.y + q.y, p.z + q.z), fov: 34, shake: { rot: 0.1, freq: 0.6, seed: 10 } }; },
    post: { ...UP_SUN, exposure: 0.19 } },
  { id: 's11', name: 'End card', t0: 72, t1: DUR, note: 'Rising over the strait; title, date, sources.',
    tracks: [],
    camera: (lt) => { const p = v3(SEA.x + 400, 12 + lt * 3.2, SEA.z - 1200), q = sunDir(500, -70 - lt * 4); return { pos: p, look: v3(p.x + q.x, p.y + q.y, p.z + q.z), fov: 36, shake: { rot: 0.04, freq: 0.4, seed: 11 } }; },
    post: { ...UP_SUN, exposure: 0.16 } },
];

// ------------------------------------------------------------------ overlays
const cues = [
  { type: 'l3', t0: 0.8, t1: 6.2, kicker: 'July 12, 2026', title: 'Strait of Hormuz' },
  { type: 'l3', t0: 7.2, t1: 14.2, kicker: 'Saronic', title: 'Corsair', sub: '24 ft · uncrewed · used here as a one-way attack drone' },
  { type: 'stat', side: 'left', t0: 15.2, t1: 20.7, value: '35+ KT', label: '1,000 nmi range · 1,000 lb payload · company figures' },
  { type: 'l3', t0: 22.4, t1: 28.2, kicker: 'Target', title: 'Bandar Abbas Naval Base', sub: 'Submarine and ship maintenance facility, Iran' },
  { type: 'quote', t0: 58.2, t1: 64.7, text: '“… the first time American forces have employed sea drones in combat operations.”', cite: 'U.S. Central Command · July 13, 2026' },
  { type: 'stat', side: 'left', t0: 65.6, t1: 71.6, value: 'NOT RELEASED', label: 'Launch platform · warhead · damage · how much was autonomous' },
  { type: 'card', t0: 72.6, t1: DUR, fadeOut: 0.9, html: `<div class="k">Saronic · Corsair</div><div class="t">Three Corsairs</div><div class="row"><span>July 12, 2026</span><span>Bandar Abbas, Iran</span><span>First U.S. combat use of sea drones, per CENTCOM</span></div><div class="src">Sources: U.S. Central Command statement and video (July 13, 2026); Saronic; The War Zone; New Atlas.</div><div class="dis">Simulated visualization. Not actual footage. Time of day, weather, sea state, courses, speeds, the sensor views, the look of the port and where the boats strike are illustrative; the date, place, number and type of boats and the quoted statements are as reported.</div>` },
];
const HUD_CSS = `
.hud-sens{position:absolute;inset:0;color:var(--ink);font-family:var(--f-data);opacity:0}
.hud-sens .lab{position:absolute;left:2.6cqw;top:4.6cqw;font-size:.86cqw;letter-spacing:.3em;text-transform:uppercase;text-shadow:0 0 .5cqw rgba(0,0,0,.8)}
.hud-sens .lab b{color:var(--amber);font-weight:400}
.hud-sens .sub{position:absolute;left:2.6cqw;top:6.3cqw;font-size:.66cqw;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3)}
.hud-sens i{position:absolute;width:3.2cqw;height:3.2cqw;border:1px solid rgba(255,255,255,.55)}
.hud-sens i.a{left:22cqw;top:14cqw;border-right:0;border-bottom:0}.hud-sens i.b{right:22cqw;top:14cqw;border-left:0;border-bottom:0}
.hud-sens i.c{left:22cqw;bottom:12cqw;border-right:0;border-top:0}.hud-sens i.d{right:22cqw;bottom:12cqw;border-left:0;border-top:0}
.hud-sens u{position:absolute;left:50%;top:50%;width:5cqw;height:1px;background:rgba(255,255,255,.5);transform:translate(-50%,-50%)}
.hud-sens u.v{width:1px;height:5cqw}`;
let hud;
function buildHud(root) {
  const st = document.createElement('style'); st.textContent = HUD_CSS; root.append(st);
  const mk = (label, sub, cross) => { const e = document.createElement('div'); e.className = 'hud-sens'; e.innerHTML = `<div class="lab"><b>Simulated</b> ${label}</div><div class="sub">${sub}</div><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i>${cross ? '<u></u><u class="v"></u>' : ''}`; root.append(e); return e; };
  hud = { ir: mk('sensor view · infrared', 'Illustrative · not released imagery', true), bow: mk('bow camera', 'Illustrative · not released imagery', false) };
}
function updateHud(t) {
  hud.ir.style.opacity = (smooth(28.5, 28.9, t) * (1 - smooth(36.2, 36.5, t))).toFixed(3);
  hud.bow.style.opacity = (smooth(43, 43.4, t) * (1 - smooth(49.9, 50.2, t))).toFixed(3);
}

// ------------------------------------------------------------------ sound
function score(m) {
  const Dm = [73.42, 110, 146.83, 174.61], Bb = [58.27, 116.54, 146.83, 174.61], Gm = [49, 98, 146.83, 196];
  // sea and air
  m.wind({ env: [[0, 0], [1, 0.06], [28.4, 0.06], [28.5, 0.015], [36.4, 0.015], [36.5, 0.06], [72, 0.06], [DUR, 0]], freq: 480 });
  m.noise({ kind: 'pink', type: 'bandpass', freq: 1500, q: 0.5, env: [[0, 0], [1, 0.035], [6.4, 0.035], [6.5, 0.09], [21, 0.09], [28.4, 0.05], [28.5, 0.0], [36.5, 0.0], [36.6, 0.09], [50.8, 0.1], [51, 0.03], [72, 0.035], [DUR, 0]] });
  // engines: a low drone with a whine over it, loud alongside, thin from the air
  const eng = [[6.4, 0], [6.5, 0.2], [14.4, 0.22], [14.5, 0.05], [17.6, 0.3], [18.4, 0.34], [19.4, 0.1], [20.9, 0.03], [21, 0.06], [28.4, 0.06], [28.5, 0], [36.5, 0], [36.6, 0.22], [42.9, 0.22], [43, 0.3], [50.85, 0.32], [50.95, 0]];
  m.noise({ kind: 'brown', type: 'lowpass', freq: 150, env: eng.map(([t, v]) => [t, v * 2.2]) });
  m.tone({ type: 'sawtooth', freq: [[6.5, 92], [17.6, 96], [18.4, 104], [19.4, 84], [36.6, 92], [50.9, 98]], env: eng.map(([t, v]) => [t, v * 0.09]) });
  m.noise({ kind: 'white', type: 'bandpass', freq: 3400, q: 1.6, env: eng.map(([t, v]) => [t, v * 0.05]) });
  m.whoosh(18.0, { dur: 1.1, gain: 0.5, f0: 400, f1: 3000, pan: [0.5, -0.6] });
  // music: sparse and dark
  m.hit(0.35, { gain: 0.45 });
  m.pad(0.4, 14, [Dm[0], Dm[1], Dm[3]], { gain: 0.035, bright: 520 });
  m.pad(13.5, 28.6, Bb, { gain: 0.04, bright: 620 });
  m.pad(28.5, 36.6, [Gm[0], Gm[2]], { gain: 0.045, bright: 420, attack: 0.6 });
  for (let t = 29.4; t < 36.2; t += 1.7) m.beep(t, { freq: 1175, gain: 0.02, dur: 0.045 });
  m.pulse(36.6, 50.8, 0.8, { freq: 46, gain: 0.3, accel: 0.03 });
  m.pad(36.5, 50.9, Gm, { gain: 0.05, bright: 700, release: 0.2 });
  m.riser(46.5, 50.85, { gain: 0.14 });
  // the strike, heard from 250 m away
  HIT.forEach((T, i) => m.explosion(T, { gain: 1.15 - i * 0.1, pan: [0.1, 0.3, -0.25][i], delay: 0.55 }));
  m.pad(57, 72.5, Dm, { gain: 0.05, bright: 560, attack: 3 });
  m.pad(71.5, DUR - 0.5, [Dm[0], Dm[2]], { gain: 0.05, bright: 480, release: 0.6 });
  m.hit(72.7, { gain: 0.5 });
}

// boats, port and ship are posed here so the engine sees them at the previous frame's time as well (motion vectors)
function poseAll(shot, t, film) {
  const trs = shot.tracks || [];
  W.boats.forEach((b, i) => { const tr = trs[i], p = tr && tr(t), on = !!(p && p.on); b.visible = on; if (on) placeBoat(film, b, tr, t); });
  tmp.set(0, 0, 0); film.place(W.port, tmp); film.place(W.hills, tmp);
  W.ship.visible = !!shot.ship; if (shot.ship) { tmp.set(shot.ship[0], 0, shot.ship[1]); film.place(W.ship, tmp); W.ship.rotation.y = (90 - shot.ship[2]) * D2R; }
}
for (const s of shots) s.pose = (lt, t, film) => poseAll(s, t, film);

startFilm({
  id: 'corsair', title: 'Three Corsairs', duration: DUR, fps: 30, poster: 9.2, narration: NARRATION,
  build, shots, cues, buildHud, updateHud, score,
  frame(t, shot, lt, film, c) {
    const O = W.ocean, trs = shot.tracks || [], th = shot.thermal ? 1 : 0;
    W.boats.forEach((b, i) => {
      const tr = trs[i], p = tr && tr(t), on = !!(p && p.on);
      b.userData.setThermal && b.userData.setThermal(th);
      updateSpray(film, i, tr || LEAD, t, on && p.v > 6 && !th);
    });
    O.wakes = trs.map(tr => ({ pos: (time, out) => { const p = tr(time); return out.set(p.x, 0, p.z); }, beam: 1.25 }));
    updateBlasts(film, t, !!shot.blasts);
    const lead = trs[0] && trs[0](t), wa = shot.wakeAt ? shot.wakeAt(t) : (lead ? [lead.x, lead.z + 40] : null);
    const off = film.off;   // dev switches for profiling: ?off=refl,wake,seaclouds,sparkle,whitecap
    O.update(t, { wake: wa && !off.has('wake') ? { x: wa[0], z: wa[1], size: shot.wakeSize || 200 } : null, reflect: !off.has('refl'), whitecap: off.has('whitecap') ? 0 : 0.34, thermal: th, cloudsOn: !th && !off.has('seaclouds'), shadeWaves: +film.params.get('waves') || 14, ...(film.params.get('bands') ? { bands: film.params.get('bands').split(',').map(Number) } : {}), ...(shot.sea || {}), ...(off.has('sparkle') ? { sparkle: 0 } : {}) });
  },
});
