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

// emissive per material at setThermal(1): the hull a little warmer than the sea, the deck a little warmer again
// (sun on it), the engine box and its vents hot (the simulated IR grade saturates near 1)
const THERMAL = { hull: 0.15, deck: 0.32, deck_grip: 0.32, enginebox: 3.0, vent: 5.0, mast: 0.25, gear: 0.3 };
// materials that get the wet-surface layer, and the plating "fairing" amplitude (m) of each
const SURFACE = { hull: { fair: 0.0018 }, deck: {}, deck_grip: { grain: true }, enginebox: {} };

const DROP_TILE = 0.60;   // metres of surface one tile of the droplet texture covers (1024 texels: 0.59 mm; drops 0.7-7 mm across)
const GRAIN_TILE = 0.20;  // metres per tile of the scanned non-skid grit

// The wet-surface layer. Water on paint is a clear coat over a flat substrate, so the glTF material becomes a
// MeshPhysicalMaterial whose clearcoat is the water: the paint keeps its own normal and roughness (the Blender
// bake, blender/corsair_tex.py, darkens it where it is wet and adds salt and streaks), while the water layer
// has its own normal (drops, ripples) and is near mirror-smooth. A mask atlas, shipped as the glTF emissive
// texture, says where: R water film, G droplet density, B salt. In the atlas' own UVs (one texel density
// throughout, so `rep` tiles per UV unit give the same size everywhere):
//   droplets: spherical caps from a tiling texture, shown where their random id is below the density mask;
//             they glint in the sun and the sky, darken the paint under them, and fade out under a pixel
//   film:     standing water: a clear coat with weak ripples (the drop texture five times larger)
//   salt:     the baked salt broken into crystalline speckle at close range
//   grain:    the non-skid grit (deck_grip only)
//   fairing:  plating that is fair but not optically flat, frames 0.52 m apart (hull only)
function toPhysical(std) {
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, std);
  p.defines = { STANDARD: '', PHYSICAL: '' };
  p.clearcoat = 1; p.clearcoatRoughness = 0.06;
  return p;
}
function surfaceLayer(mat, o) {
  const U = {
    tWetMask: { value: o.mask }, tDrops: { value: o.drops }, tGrain: { value: o.grain },
    uDrop: { value: new THREE.Vector4(o.mpu / DROP_TILE, 4.0, 0.22, 0.9) },
    uGrain: { value: new THREE.Vector4(o.mpu / GRAIN_TILE, o.grit ? 0.8 : 0, o.grit ? 0.10 : 0, o.grit ? 0.15 : 0) },
    uFair: { value: o.fair || 0 },
  };
  const fair = (o.fair || 0) > 0;
  mat.userData.layer = U;
  mat.onBeforeCompile = (sh, r) => {
    THREE.Material.prototype.onBeforeCompile.call(mat, sh, r);     // the engine's sampler-precision prelude
    Object.assign(sh.uniforms, U);
    if (fair) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos, vFairX, vFairY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = transformed; vFairX = normalMatrix * vec3(1.0, 0.0, 0.0); vFairY = normalMatrix * vec3(0.0, 1.0, 0.0);');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tWetMask, tDrops, tGrain; uniform vec4 uDrop, uGrain; uniform float uFair;
${fair ? 'varying vec3 vObjPos, vFairX, vFairY;' : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 wetMask = texture2D(tWetMask, vMapUv).rgb;
  vec2 dropUv = vMapUv * uDrop.x;
  vec4 drop = texture2D(tDrops, dropUv);
  float dropFade = 1.0 - smoothstep(2.5, 7.0, length(fwidth(dropUv)) * 1024.0);
  float dropOn = step(drop.a, wetMask.g * 0.995) * smoothstep(0.03, 0.15, drop.b) * dropFade;
  vec2 ripUv = dropUv * 0.2;
  vec4 rip = texture2D(tDrops, ripUv);
  float ripOn = wetMask.r * (1.0 - smoothstep(2.5, 7.0, length(fwidth(ripUv)) * 1024.0)) * smoothstep(0.02, 0.2, rip.b);
  vec2 grainUv = vMapUv * uGrain.x;
  vec4 grain = texture2D(tGrain, grainUv);
  float grainPx = length(fwidth(grainUv)) * 1024.0;                 // grit texels per pixel
  float grainFade = 1.0 - smoothstep(0.35, 1.4, grainPx / 1024.0);
  float near = 1.0 - smoothstep(2.0, 6.0, grainPx);
  diffuseColor.rgb *= 1.0 + (grain.b - 0.5) * uGrain.w * grainFade;
  float saltK = wetMask.b * smoothstep(0.50, 0.70, grain.b) * near;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.52, 0.53, 0.52), min(saltK * 0.85, 1.0));
  diffuseColor.rgb *= 1.0 - 0.12 * dropOn;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor - (grain.b - 0.5) * uGrain.z * grainFade + 0.22 * saltK, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  vec2 grainN = grain.xy * 2.0 - 1.0, dropN = drop.xy * 2.0 - 1.0, ripN = rip.xy * 2.0 - 1.0;
  grainN.y = -grainN.y; dropN.y = -dropN.y; ripN.y = -ripN.y;     // these textures are decoded upside down
  mapN.xy += grainN * uGrain.y * grainFade;
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
${fair ? `  {
    vec2 f = vec2(vObjPos.x / 0.52, (vObjPos.y + 0.6) / 0.24), c = floor(f), t = fract(f);
    float amp = uFair * (0.35 + 0.65 * fract(sin(dot(vec3(c, sign(vObjPos.z)), vec3(12.9898, 78.233, 37.719))) * 43758.5453));
    float sx = sin(3.14159 * t.x), sy = sin(3.14159 * t.y);
    vec3 g = vec3(-amp * 6.28318 * sx * cos(3.14159 * t.x) * sy * sy / 0.52, -amp * 6.28318 * sy * cos(3.14159 * t.y) * sx * sx / 0.24, 0.0);
    vec3 gv = vFairX * g.x + vFairY * g.y;
    normal = normalize(normal - (gv - normal * dot(gv, normal)));
  }` : ''}`)
      .replace('#include <clearcoat_normal_fragment_maps>', `
  vec3 waterN = vec3(dropN * uDrop.y * dropOn + ripN * uDrop.z * ripOn * (1.0 - dropOn), 1.0);
  waterN.xy *= normalScale;
  clearcoatNormal = normalize( tbn * waterN );
  {   // a drop's far side must not face away from the eye (it would turn black): bend it back to grazing
    vec3 eyeDir = normalize(vViewPosition);
    clearcoatNormal = normalize(clearcoatNormal + eyeDir * max(0.0, 0.15 - dot(clearcoatNormal, eyeDir)));
  }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  material.clearcoat = uDrop.w > 1.5 ? 1.0 : clamp(max(wetMask.r * uDrop.w, dropOn), 0.0, 1.0);   // > 1.5: all wet (look development)
  material.clearcoatF0 = vec3(0.02);
  {   // a curved drop under one pixel: widen the lobe by the normal's spread over the pixel (specular
      // anti-aliasing), so the glint of the sun or the sky in each drop lands on the pixel instead of between pixels
    vec3 ndx = dFdx(clearcoatNormal), ndy = dFdy(clearcoatNormal);
    float spread = min(0.5 * (dot(ndx, ndx) + dot(ndy, ndy)), 0.20);
    float cr = max(mix(0.075, 0.03, dropOn), 0.0525) + geometryRoughness;
    material.clearcoatRoughness = min(sqrt(cr * cr + spread), 1.0);
  }`);
  };
  mat.customProgramCacheKey = () => `corsair-surface-${fair ? 1 : 0}`;
  mat.needsUpdate = true;
}

// The vent blades and the plenum behind them sit in a pocket in the engine box: the sun reaches them only in
// part, and its shadow map cannot resolve 2 mm blades, so their direct light is cut to a fraction (they are
// lit by the sky as usual) and they read as dark recessed louvres from any angle.
function cavity(mat, k) {
  mat.onBeforeCompile = (sh, r) => {
    THREE.Material.prototype.onBeforeCompile.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  reflectedLight.directDiffuse *= ${k.toFixed(3)}; reflectedLight.directSpecular *= ${k.toFixed(3)};`);
  };
  mat.customProgramCacheKey = () => 'corsair-cavity';
  mat.needsUpdate = true;
}

let proto = null;
async function loadCorsair(pipe) {
  const { root } = await loadGLB('corsair/corsair.glb', pipe, { aniso: 8 });
  const mats = new Map();
  root.traverse(o => { if (o.isMesh) mats.set(o.material.name, o.material); });
  // the emissive texture of the painted atlases is the wet-surface mask, not light
  const masks = new Map();
  for (const m of mats.values()) {
    if (m.emissiveMap) { m.emissiveMap.colorSpace = THREE.NoColorSpace; m.emissiveMap.needsUpdate = true; masks.set(m.name, m.emissiveMap); m.emissiveMap = null; m.needsUpdate = true; }
  }
  const tex = async (name) => hasAsset(name) ? loadTexture(name, pipe, { srgb: false, aniso: 8 }) : null;
  const [drops, grain] = await Promise.all([tex('corsair/tex/drops.webp'), tex('corsair/tex/grip.webp')]);
  for (const [name, o] of Object.entries(SURFACE)) {
    const m = mats.get(name);
    if (!m || !masks.has(name) || !drops || !grain || !m.map || !m.normalMap) continue;
    const p = toPhysical(m);
    surfaceLayer(p, { ...o, grit: !!o.grain, mask: masks.get(name), drops, grain, mpu: m.userData.m_per_uv || 6 });
    root.traverse(x => { if (x.isMesh && x.material === m) x.material = p; });
    mats.set(name, p);
  }
  if (mats.has('vent')) cavity(mats.get('vent'), 0.12);
  const warm = [];
  for (const [name, m] of mats) if (name in THERMAL) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = 0; warm.push([m, THERMAL[name]]); }
  return { root, warm };
}

export async function buildCorsair(pipe) {
  if (!proto) proto = loadCorsair(pipe);
  const { root, warm } = await proto;
  const boat = root.clone(true);
  boat.name = 'corsair';
  boat.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } });
  // 0 = visible light; 1 = simulated long-wave IR. Materials are shared between the boats, which is fine: the
  // film switches all of them together.
  boat.userData = { warm, setThermal(k) { for (const [m, e] of warm) m.emissiveIntensity = e * k; } };
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
