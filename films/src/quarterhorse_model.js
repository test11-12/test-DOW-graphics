// Hermeus Quarterhorse Mk 2.1 (N21QH), built in Blender (films/blender/quarterhorse.py) from Hermeus press
// photography: bare-metal tailless delta, pitot nose inlet with the air-data boom, single F100 with the exposed
// convergent-divergent nozzle, drag-chute boom under the fin, F-16-type landing gear. Materials are baked from CC0
// photoscans into anisotropic bare aluminium; markings as they appear in released photos.
// Body frame: +x forward, +y up, +z starboard, origin on the fuselage reference axis; the inlet lip is at x = 8.3,
// the nozzle axis at y = QH.nozzleY, the tyres stand on y = QH.groundY.
import { loadGLB, findMesh } from '../engine/assets.js';
import * as THREE from 'three';

const X0 = 8.3;                 // nose is X0 metres ahead of the model origin
const X = s => X0 - s;          // body-x of a station s metres aft of the inlet lip
export const QH = { length: 14.6, span: 8.84, groundY: -1.71, nozzleX: X(14.6), nozzleY: -0.155, nozzleR: 0.47, noseX: X(0) };

export async function buildQuarterhorse(pipe) {
  const { root: model } = await loadGLB('quarterhorse/quarterhorse.glb', pipe, { aniso: 8 });
  const root = new THREE.Group(); root.name = 'quarterhorse';
  root.add(model);
  const gear = model.getObjectByName('gear');
  const glow = model.getObjectByName('ab_glow');
  const holder = findMesh(glow, 'flameholder'), liner = findMesh(glow, 'liner');
  // the afterburner surfaces glow through their emissive maps; the film drives the intensity
  for (const m of [holder.material, liner.material]) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 0; }
  // nothing inside the fuselage needs to throw a shadow
  glow.traverse(o => { if (o.isMesh) o.castShadow = false; });
  root.userData = {
    gear,
    setAfterburner(k) { holder.material.emissiveIntensity = 0.15 + 60 * k; liner.material.emissiveIntensity = 0.05 + 9 * k; },
    setGear(down) { gear.visible = !!down; },
  };
  return root;
}
