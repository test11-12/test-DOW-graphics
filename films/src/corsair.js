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
import { Trail } from '../engine/fx.js';
import { buildCorsair, buildPort, buildShip, CORSAIR, PORT } from './corsair_model.js';

const NARRATION = __NARRATION__;
const SUN = { az: 80, el: 16 };                // hazy morning sun, east
const DUR = 20;

// ------------------------------------------------------------------ world
let W;
const CLOUDS = { cover: 0.38, scale: 0.8, wind: [0.010, 0.004], density: 0.013, tile: 4000, steps: 48, shadow: 0.7 };
async function build(film) {
  const pipe = film.pipe;
  pipe.atmo.setSun(SUN.az, SUN.el);
  pipe.atmo.uniforms.uHaze.value = +film.params.get('haze') || 70; pipe.atmo.uniforms.uHazeH.value = 550; pipe.atmo.groundAlbedo.setRGB(0.05, 0.08, 0.09);
  const clouds = new CloudLayer(pipe, { base: 1500, top: 3100, div: +film.params.get('cdiv') || 3 });
  const ocean = new Ocean(pipe, { clouds, sea: { wind: 50, amp: 1.0, long: 1, chop: 0.8, spread: 40 } });
  const boats = [0, 1, 2].map(() => { const b = buildCorsair(pipe); pipe.scene.add(b); pipe.registerDynamic(b); return b; });
  // spray: two sheets thrown off the chines forward of midships and a rooster tail off the transom, per boat
  const spray = boats.map(() => ({
    side: [-1, 1].map(() => new Trail(pipe, { rate: 150, life: 0.5, size0: 0.10, size1: 0.62, grow: 0.8, color: [0.93, 0.95, 0.96], alpha: 0.22, jitter: 0.2, drift: [0, -2.4, 0], drag: 3.0, spreadV: 1.6, noise: 1.0, softness: 0.3, fadeIn: 0.05 })),
    tail: new Trail(pipe, { rate: 110, life: 0.7, size0: 0.18, size1: 1.0, grow: 0.8, color: [0.93, 0.95, 0.96], alpha: 0.2, jitter: 0.25, drift: [0, -1.8, 0], drag: 2.6, spreadV: 1.4, noise: 1.0, softness: 0.3, fadeIn: 0.06 }),
  }));
  const port = buildPort(pipe); pipe.scene.add(port);
  port.traverse(o => { if (o.isMesh) o.layers.set(LAYER.STATIC); });
  if (film.off.has('clouds')) CLOUDS.cover = 0;
  W = { clouds, ocean, boats, port, spray };
  return W;
}

// a boat riding the sea: position on the surface, trim from speed and from the local wave slope
const q1 = new THREE.Quaternion(), tmp = v3();
function placeBoat(film, b, x, z, hdg, speed, t) {
  const O = W.ocean, h = O.heightAt(x, z, t), r = hdg * Math.PI / 180, fx = Math.sin(r), fz = -Math.cos(r), L = 2.6;
  const hb = O.heightAt(x + fx * L, z + fz * L, t), hs = O.heightAt(x - fx * L, z - fz * L, t);
  const hr = O.heightAt(x - fz * 0.9, z + fx * 0.9, t), hl = O.heightAt(x + fz * 0.9, z - fx * 0.9, t);
  const plane = smooth(4, 14, speed);
  const pitch = Math.atan2(hb - hs, 2 * L) * 180 / Math.PI * 0.8 + 3.6 * plane + 0.5 * wobble(t * 2.3, 3 + x * 0.01);
  const roll = Math.atan2(hr - hl, 1.8) * 180 / Math.PI * 0.6 + 0.8 * wobble(t * 1.7, 9 + z * 0.01);
  tmp.set(x, (h + hb + hs) / 3 * 0.85 + 0.10 * plane, z); film.place(b, tmp);
  attitude(hdg, pitch, roll, b.quaternion);
  b.visible = true;
}

const SEA_POST = { clouds: CLOUDS, exposure: 0.2, contrast: 1.22, sat: 1.0, wb: [1.0, 1.0, 1.02], aerial: 1.0, grain: 0.04, bloom: 0.1, shutter: 0.22 };
const run = t => ({ x: 40, z: 3200 - 16.5 * t });       // lead boat, northbound
const shots = [
  { id: 't01', name: 'Sea test', t0: 0, t1: 10, note: 'Look development: boat on open water, sun ahead.',
    pose: (lt, t, f) => { const p = run(t); placeBoat(f, W.boats[0], p.x, p.z, 0, 16.5, t); W.boats[1].visible = W.boats[2].visible = false; f.place(W.port, v3(0, 0, 0)); },
    camera: (lt, t) => { const p = run(t); return { pos: v3(p.x - 17, 3.4, p.z + 15), look: v3(p.x + 2, 0.6, p.z - 1), fov: 30, shake: { rot: 0.12, freq: 0.9, seed: 2 }, focus: v3(p.x, 0.5, p.z), focusRadius: 9 }; },
    post: { ...SEA_POST, rays: 0.12, flare: { ghost: 0.05, halo: 0.03, streak: 0.14, thr: 8 }, sunDisk: 0.5 } },
  { id: 't02', name: 'Sea test wide', t0: 10, t1: DUR, note: 'Look development: open water toward the sun, no boat.',
    pose: (lt, t, f) => { for (const b of W.boats) b.visible = false; f.place(W.port, v3(0, 0, 0)); },
    camera: (lt, t) => ({ pos: v3(-300, 14 + lt * 0.3, 2600), look: v3(-300 + 96, -4, 2600 - 27.5), fov: 38, shake: { rot: 0.05, freq: 0.5, seed: 4 } }),
    post: { ...SEA_POST, rays: 0.12, flare: { ghost: 0.05, halo: 0.03, streak: 0.14, thr: 8 }, sunDisk: 0.5 } },
];

// spray emitters follow a boat's track function p(t) -> {x, z, hdg, v}
const _e = v3();
function updateSpray(film, i, track, t) {
  const sp = W.spray[i], O = film.origin;
  const at = (tb, fwd, lat, up, out) => { const p = track(tb), r = p.hdg * Math.PI / 180, fx = Math.sin(r), fz = -Math.cos(r); return out.set(p.x + fx * fwd - fz * lat, W.ocean.heightAt(p.x, p.z, tb) + up, p.z + fz * fwd + fx * lat); };
  sp.side.forEach((tr, k) => { const sg = k ? 1 : -1; tr.mesh.visible = !film.off.has('spray');
    tr.update(t, O, (tb, out) => at(tb, 0.7, sg * 1.05, 0.2, out), (tb, out) => { const p = track(tb), r = p.hdg * Math.PI / 180, fx = Math.sin(r), fz = -Math.cos(r), k2 = clamp(p.v / 16, 0, 1.2); return out.set(fx * p.v * 0.9 - fz * sg * 4.2 * k2, 2.6 * k2, fz * p.v * 0.9 + fx * sg * 4.2 * k2); }); });
  sp.tail.mesh.visible = !film.off.has('spray');
  sp.tail.update(t, O, (tb, out) => at(tb, -3.9, 0, 0.1, out), (tb, out) => { const p = track(tb), r = p.hdg * Math.PI / 180, k2 = clamp(p.v / 16, 0, 1.2); return out.set(Math.sin(r) * p.v * 0.88, 2.4 * k2, -Math.cos(r) * p.v * 0.88); });
}

startFilm({
  id: 'corsair', title: 'Three Corsairs', duration: DUR, fps: 30, poster: 3, narration: NARRATION,
  build, shots, cues: [],
  frame(t, shot, lt, film, c) {
    const lead = run(t);
    W.ocean.wakes.length || W.ocean.wakes.push({ pos: (time, out) => { const p = run(time); return out.set(p.x, 0, p.z); }, beam: 1.25 });
    updateSpray(film, 0, tb => { const p = run(tb); return { x: p.x, z: p.z, hdg: 0, v: 16.5 }; }, t);
    W.ocean.update(t, { wake: { x: lead.x, z: lead.z + 40, size: 130 }, reflect: !film.off.has('refl'), whitecap: 0.34, ...(shot.sea || {}) });
  },
});
