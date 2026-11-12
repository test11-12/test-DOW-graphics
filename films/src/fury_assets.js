// Anduril YFQ-44A "Fury" (launch aircraft, tail AI / 1003) and the AIM-120 AMRAAM, built in Blender
// (films/blender/fury.py, amraam.py) from released photographs and loaded here as glTF. Same interface as
// fury_model.js, except that the two builders are asynchronous:
//   const ac = await buildFury(pipe);      ac.userData = { gear, navPos, setGear(down) }
//   const msl = await buildAmraam(pipe);   msl.userData = { tailX, noseX, setBurn(k) }
// Body frame: +x forward, +y up, +z starboard; s = metres aft of the nose tip. The numbers below mirror
// films/blender/fury_geo.py: change them there and here together.
import * as THREE from 'three';
import { loadGLB, hasAsset } from '../engine/assets.js';

const X0 = 5.2;                 // nose tip is X0 metres ahead of the model origin
const X = s => X0 - s;          // body-x of a station s metres aft of the nose tip
const CH = -0.20;               // height of the chine / wing plane
const RAIL_Z = 1.85, RAIL_S0 = 3.93, RAIL_S1 = 6.73, RAIL_Y = -0.40;
const MSL_LEN = 3.65, MSL_NOSE_S = 3.07, MSL_Y = -0.557;
const GROUND = -1.20;           // ground plane when standing on the wheels
const WING = { z1: 3.30, le1: 6.25, te1: 7.55 };
const NOSE_GEAR = { s: 3.60, r: 0.180 }, MAIN_GEAR = { s: 5.75, z: 0.86, r: 0.235 };
export const FURY = {
  length: 9.9, span: 6.6, groundY: GROUND, chineY: CH, noseX: X(0), nozzleX: X(9.9), nozzleY: CH + 0.25, nozzleR: 0.20,
  // missile centre when it hangs on the left-wing rail (body frame), and the rail it leaves
  station: new THREE.Vector3(X(MSL_NOSE_S + MSL_LEN / 2), MSL_Y, -RAIL_Z),
  railZ: RAIL_Z, railY: RAIL_Y, railX0: X(RAIL_S0), railX1: X(RAIL_S1),
  noseGear: new THREE.Vector3(X(NOSE_GEAR.s), GROUND, 0), mainGear: new THREE.Vector3(X(MAIN_GEAR.s), GROUND, MAIN_GEAR.z), mainR: MAIN_GEAR.r,
  wingTip: new THREE.Vector3(X((WING.le1 + WING.te1) / 2), CH, WING.z1), tailX: X(10.02), finTopY: 1.84,
};

const prep = (root, envIntensity) => root.traverse(o => {
  if (!o.isMesh) return;
  o.frustumCulled = false;
  if (envIntensity !== undefined) o.material.envMapIntensity = envIntensity;
});

// The aircraft. root.userData: gear (the landing-gear group), navPos ([starboard green, port red] wing-tip
// light positions, body frame), navWhite ([starboard, port] the white lights beside them), tailLight, setGear(down).
// The model's own plain tyres give way to the photoscanned ramp tyres (assets/fury/tyres.glb: ribbed tread, dusty
// sidewalls, flattened contact patch) when that asset is packed, unless opts.rampTyres is false (the film's
// 'tyres' dev switch). The pylons are their own node ('pylons').
export async function buildFury(pipe, opts = {}) {
  const { root: scene } = await loadGLB('fury/fury.glb', pipe, { aniso: 16 });
  const root = new THREE.Group(); root.name = 'fury'; root.add(scene);
  prep(root);
  const gear = scene.getObjectByName('gear');
  const own = scene.getObjectByName('tyres_own');
  if (own && opts.rampTyres !== false && hasAsset('fury/tyres.glb')) {
    const { root: t } = await loadGLB('fury/tyres.glb', pipe, { aniso: 16 });
    const proto = {}; t.traverse(o => { if (o.isMesh) proto[o.name] = o; });
    if (proto.tyre_main && proto.tyre_nose) {
      // wheel centres stand r above the pavement; the tyre models stand on their own origin
      for (const [x, z, p] of [[X(NOSE_GEAR.s), 0, proto.tyre_nose], [X(MAIN_GEAR.s), MAIN_GEAR.z, proto.tyre_main], [X(MAIN_GEAR.s), -MAIN_GEAR.z, proto.tyre_main]]) {
        const m = p.clone(); m.position.set(x, GROUND, z); m.frustumCulled = false; gear.add(m);
      }
      own.visible = false;
    }
  }
  const at = n => { const o = scene.getObjectByName(n); return o ? o.position.clone() : new THREE.Vector3(); };
  const navPos = [at('nav_green'), at('nav_red')], navWhite = [at('nav_wg'), at('nav_wr')];
  // gear down: the bays stand open (their doors hang on the gear group); gear up: the closed door skins fill them
  const doors = scene.getObjectByName('bay_doors');
  root.userData = { gear, navPos, navWhite, tailLight: at('nav_tail'), setGear(down) { gear.visible = !!down; if (doors) doors.visible = !down; } };
  return root;
}

// AIM-120 AMRAAM. Origin at mid-length, nose along +x, hangers up. userData: tailX, noseX, setBurn(k): k = 0..1
// lights the inside of the motor nozzle.
export async function buildAmraam(pipe) {
  const { root: scene } = await loadGLB('fury/amraam.glb', pipe, { aniso: 16 });
  const g = new THREE.Group(); g.name = 'aim120'; g.add(scene);
  prep(g);
  const glow = scene.getObjectByName('motor_glow');
  const mat = glow.material = glow.material.clone();
  mat.emissive = new THREE.Color(1.0, 0.66, 0.34); mat.emissiveIntensity = 0; glow.castShadow = false;
  g.userData = { tailX: -MSL_LEN / 2, noseX: MSL_LEN / 2, setBurn(k) { mat.emissiveIntensity = 60 * k; } };
  return g;
}
