// The Saronic Corsair and the distant tanker of "Three Corsairs", built in Blender (blender/corsair.py,
// blender/ship.py) and loaded here as glTF. Same contract as the code-built versions in corsair_model.js:
//   await buildCorsair(pipe) -> THREE.Group, bow along +x, +y up, starboard +z, origin amidships on the static
//                               waterline; root.userData.setThermal(k) raises emissive for the simulated IR shot
//   CORSAIR                  -> principal dimensions (m)
//   await buildShip(len)     -> the merchant ship, scaled to len metres
// The boat is loaded once; every further buildCorsair() returns a clone that shares geometry and materials.
import * as THREE from 'three';
import { loadGLB, loadTexture, hasAsset } from '../engine/assets.js';

export const CORSAIR = { length: 7.3, beam: 2.48, stern: -3.65, bow: 3.65, mastTop: 2.6 };

// emissive per material at setThermal(1): hull warm against the water, engine box hot (as the code-built boat)
const THERMAL = { hull: 1.3, deck: 1.6, deck_grip: 1.6, enginebox: 5.0, mast: 1.2, gear: 0.5 };

// Tiling detail under the baked maps for surfaces a camera gets very close to (the non-skid on the foredeck
// under the bow camera): RG = tangent-space normal, B = height. Sampled in the atlas' own UVs, which have one
// texel density throughout, so `rep` tiles per UV unit give the same grain size everywhere.
function addDetail(mat, tex, rep, normalK, roughK, albedoK) {
  const u = { tDetailMap: { value: tex }, uDetail: { value: new THREE.Vector4(rep, normalK, roughK, albedoK) } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDetailMap; uniform vec4 uDetail;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec4 detailTex = texture2D(tDetailMap, vMapUv * uDetail.x);
  // fade the grain out where it would be smaller than a pixel (its mip-maps average to flat anyway)
  float detailFade = 1.0 - smoothstep(0.35, 1.4, length(fwidth(vMapUv * uDetail.x)));
  diffuseColor.rgb *= 1.0 + (detailTex.b - 0.5) * uDetail.w * detailFade;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor - (detailTex.b - 0.5) * uDetail.z * detailFade, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;',
        'mapN.xy += (detailTex.xy * 2.0 - 1.0) * uDetail.y * detailFade; mapN.xy *= normalScale;'));
  };
  mat.customProgramCacheKey = () => 'corsair-detail';
  mat.needsUpdate = true;
}

let proto = null;
async function loadCorsair(pipe) {
  const { root } = await loadGLB('corsair/corsair.glb', pipe, { aniso: 8 });
  // Vent blades and drain holes are drawn unlit and near black. They stand a few millimetres off the surface
  // behind them, inside the sun's shadow bias, so on the shaded side their sun-facing edges would catch the
  // sun and the vents would read as lit windows.
  const vent = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.006, 0.007) });
  vent.name = 'vent';
  const mats = new Map();
  root.traverse(o => { if (!o.isMesh) return; if (o.material.name === 'vent') o.material = vent; else mats.set(o.material.name, o.material); });
  const grip = mats.get('deck_grip');
  if (grip && grip.map && grip.normalMap && hasAsset('corsair/tex/grip.webp')) {
    const tex = await loadTexture('corsair/tex/grip.webp', pipe, { srgb: false, aniso: 8 });
    const tile = 0.34;                                   // metres of deck one tile of the scanned grit covers
    addDetail(grip, tex, (grip.userData.m_per_uv || 6) / tile, 1.1, 0.10, 0.26);
  }
  const warm = [];
  for (const [name, m] of mats) if (name in THERMAL) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = 0; warm.push([m, THERMAL[name]]); }
  return { root, warm, vent };
}

export async function buildCorsair(pipe) {
  if (!proto) proto = loadCorsair(pipe);
  const { root, warm, vent } = await proto;
  const boat = root.clone(true);
  boat.name = 'corsair';
  boat.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } });
  // 0 = visible light; 1 = simulated long-wave IR. Materials are shared between the boats, which is fine: the
  // film switches all of them together.
  boat.userData = { setThermal(k) { for (const [m, e] of warm) m.emissiveIntensity = e * k; vent.color.setScalar(0.006 + 6.0 * k); } };
  return boat;
}

// The distant merchant ship (a tanker seen hull-down through haze): no shadows, never culled.
export async function buildShip(len = 250) {
  const { root } = await loadGLB('corsair/ship.glb', null, { cast: false, receive: false, aniso: 4 });
  const g = new THREE.Group();
  g.add(root);
  root.scale.setScalar(len / 250);
  g.name = 'ship';
  return g;
}
