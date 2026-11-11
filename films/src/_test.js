import * as THREE from 'three';
import { Pipeline, LAYER } from '../engine/pipeline.js';
import { Terrain } from '../engine/terrain.js';
import { attitude } from '../engine/geo.js';
import { makePlume, makeHeatHaze, makeShockCone } from '../engine/fx.js';
import { NM_TERRAIN } from './terrain_nm.js';
import { buildQuarterhorse, QH } from './quarterhorse_model.js';
const canvas = document.getElementById('view');
const P = new URLSearchParams(location.search);
const W = +(P.get('w') || 960), H = +(P.get('h') || 540);
const pipe = new Pipeline(canvas, { width: W, height: H, quality: { msaa: +(P.get('msaa') ?? 4) } });
const sc = pipe.scene;
const nres = +(P.get('nres') || 1024);
let terrain, ac, plume, haze, shock;
async function init() {
  await Promise.all([document.fonts.load('700 64px "Saira Condensed"'), document.fonts.load('400 20px "B612 Mono"')]);
  terrain = new Terrain(pipe, { ...NM_TERRAIN, near: { ...NM_TERRAIN.near, res: nres } });
  pipe.atmo.groundAlbedo.setRGB(0.3, 0.24, 0.18);
  ac = buildQuarterhorse(pipe); sc.add(ac);
  plume = makePlume(pipe, { length: 10, radius: QH.nozzleR }); plume.position.set(QH.nozzleX, 0.06, 0); ac.add(plume);
  haze = makeHeatHaze(pipe, { length: 40, radius: 0.55 }); haze.position.set(QH.nozzleX, 0.06, 0); ac.add(haze);
  shock = makeShockCone(pipe, { length: 70 }); shock.position.set(QH.noseX + 0.2, 0, 0); ac.add(shock);
  pipe.registerDynamic(ac);
  plume.layers.set(LAYER.FX); haze.layers.set(LAYER.DISTORT); shock.layers.set(LAYER.DISTORT);
}
window.FILM = {
  ready: init(),
  renderFrame(t, o = {}) {
    const alt = o.alt ?? 11000, sunEl = o.sunEl ?? 26, sunAz = o.sunAz ?? 88;
    pipe.atmo.setSun(sunAz, sunEl); pipe.atmo.uniforms.uHaze.value = o.haze ?? 0.5;
    const cam = pipe.camera; cam.fov = o.fov ?? 22; cam.updateProjectionMatrix();
    const hdg = o.hdg ?? 0, spd = o.spd ?? 0;
    const fwd = new THREE.Vector3(Math.sin(hdg * Math.PI / 180), 0, -Math.cos(hdg * Math.PI / 180));
    const acW = tt => new THREE.Vector3(o.cx ?? 70000, alt + 1401, o.cz ?? 20000).addScaledVector(fwd, spd * tt);
    const camOff = new THREE.Vector3(...(o.cam || [-18, 3, 14]));
    const camW = tt => (o.camFixed ? new THREE.Vector3(o.cx ?? 70000, alt + 1401, o.cz ?? 20000).add(camOff) : acW(tt).add(camOff));
    const origin = camW(t);
    pipe.origin.copy(origin); pipe.camAlt = origin.y;
    const pose = tt => {
      const a = acW(tt); ac.position.set(a.x - origin.x, a.y - origin.y, a.z - origin.z);
      attitude(hdg, o.pitch ?? 2, o.roll ?? 0, ac.quaternion);
      const c = camW(tt); cam.position.set(c.x - origin.x, c.y - origin.y, c.z - origin.z);
      const look = (o.look ? new THREE.Vector3(...o.look) : new THREE.Vector3()).add(ac.position); cam.up.set(0, 1, 0); cam.lookAt(look);
    };
    ac.userData.setGear(!!o.gear); ac.userData.setAfterburner(o.ab ?? 0);
    plume.userData.set(o.ab ?? 0, o.abGain ?? 1); haze.userData.set(o.hz ?? 1); shock.userData.set(o.mach ?? 0.9, o.shockGain ?? 1);
    pose(t - 1 / 30); pipe.snapshotPrev(); pose(t);
    pipe.shadowFocus.copy(ac.position); pipe.shadowRadius = 11;
    terrain.update(o.preset || 'air'); terrain.uniforms.uDebug.value = o.dbg || 0;
    pipe.render(t, Math.round(t * 30), { exposure: o.exp ?? 0.22, envKey: `${alt}|${sunEl}|${sunAz}|${o.haze}`, cirrus: o.cirrus ? { cover: 0.45, opacity: 0.5, alt: 13500 } : null, shutter: o.shutter ?? 0.5, contrast: 1.3, sat: 1.25, aerial: 0.85, wb: [1.05, 1.0, 0.93], ...o.post });
    const gl = pipe.renderer.getContext(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return true;
  },
};
