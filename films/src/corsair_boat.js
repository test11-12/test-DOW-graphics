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
// (sun on it), the engine box and its vents hot (the simulated IR grade saturates near 1). In the IR view the
// reflected light is taken away (setThermal), so these alone set the apparent temperature.
const THERMAL = { hull: 0.13, deck: 0.22, deck_grip: 0.22, enginebox: 3.0, vent: 5.0, ventblade: 5.0, mast: 0.12, gear: 0.14 };
// materials that get the wet-surface layer, and the plating "fairing" amplitude (m) of each
const SURFACE = { hull: { fair: 0.0028 }, deck: {}, deck_grip: { grain: true }, enginebox: {} };

const DROP_TILE = 1.0;    // metres of surface one tile of the droplet texture covers (1024 texels: 0.98 mm; drop radii 1.2-12 mm, most 1-3)
const GRAIN_TILE = 0.20;  // metres per tile of the scanned non-skid grit (fine)
const GRIT_TILE = 0.85;   // the same grit at a coarser scale: aggregate relief of 3-6 mm a camera on the deck resolves

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
    uGrit: { value: new THREE.Vector2(o.mpu / GRIT_TILE, o.grit ? 1.0 : 0) },
    uFair: { value: o.fair || 0 }, uWet: { value: 1 }, uTimeS: o.time,
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
uniform sampler2D tWetMask, tDrops, tGrain; uniform vec4 uDrop, uGrain; uniform vec2 uGrit; uniform float uFair, uWet, uTimeS;
${fair ? 'varying vec3 vObjPos, vFairX, vFairY;' : ''}
float hashC(vec2 p){ p = fract(p*vec2(0.1031, 0.1030)); p += dot(p, p.yx+33.33); return fract((p.x+p.y)*p.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 wetMask = texture2D(tWetMask, vMapUv).rgb;
  vec2 dropUv = vMapUv * uDrop.x;
  vec4 drop = texture2D(tDrops, dropUv);
  float dropTpp = length(fwidth(dropUv)) * 1024.0;                 // drop texels per pixel
  float dropFade = 1.0 - smoothstep(4.0, 10.0, dropTpp);
  float dropOn = step(drop.a, wetMask.g * 0.995) * smoothstep(0.03, 0.15, drop.b) * dropFade * uWet;
  float dropRim = dropOn * (1.0 - smoothstep(0.05, 0.45, drop.b));  // the meniscus at a bead's edge
  vec2 ripUv = dropUv * 0.2;
  vec4 rip = texture2D(tDrops, ripUv);
  float ripOn = wetMask.r * (1.0 - smoothstep(2.5, 7.0, length(fwidth(ripUv)) * 1024.0)) * smoothstep(0.02, 0.2, rip.b);
  vec2 grainUv = vMapUv * uGrain.x;
  vec4 grain = texture2D(tGrain, grainUv);
  float grainPx = length(fwidth(grainUv)) * 1024.0;                 // grit texels per pixel
  float grainFade = 1.0 - smoothstep(0.35, 1.4, grainPx / 1024.0);
  float near = 1.0 - smoothstep(2.0, 6.0, grainPx);
  vec2 gritUv = vMapUv * uGrit.x;
  vec4 grit = texture2D(tGrain, gritUv.yx + 0.37);                   // the coarse aggregate (turned, so it never lines up with the fine)
  float gritFade = uGrit.y * (1.0 - smoothstep(1.5, 5.0, length(fwidth(gritUv)) * 1024.0));
  diffuseColor.rgb *= 1.0 + (grain.b - 0.5) * uGrain.w * grainFade + (grit.b - 0.5) * 0.30 * gritFade;
  float saltK = wetMask.b * max(smoothstep(0.50, 0.70, grain.b) * near, 0.6 * smoothstep(0.58, 0.74, grit.b) * gritFade);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.56, 0.55), min(saltK * 0.85, 1.0));
  diffuseColor.rgb *= 1.0 - 0.03 * dropOn - 0.22 * dropRim;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor - (grain.b - 0.5) * uGrain.z * grainFade - (grit.b - 0.5) * 0.22 * gritFade + 0.22 * saltK, 0.04, 1.0);`)
      .replace('#include <normal_fragment_maps>', `
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  vec2 grainN = grain.xy * 2.0 - 1.0, gritN = grit.yx * 2.0 - 1.0, dropN = drop.xy * 2.0 - 1.0, ripN = rip.xy * 2.0 - 1.0;
  grainN.y = -grainN.y; gritN.x = -gritN.x; dropN.y = -dropN.y; ripN.y = -ripN.y;     // these textures are decoded upside down
  mapN.xy += grainN * uGrain.y * grainFade + gritN * 1.1 * gritFade;
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
  {   // a bead's crown looks at the sky (a bright highlight); its far side must not face away from the eye (it would turn black)
    vec3 eyeDir = normalize(vViewPosition), skyV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    clearcoatNormal = normalize(clearcoatNormal + skyV * 0.30 * dropOn * smoothstep(0.3, 0.8, drop.b));
    clearcoatNormal = normalize(clearcoatNormal + eyeDir * max(0.0, 0.15 - dot(clearcoatNormal, eyeDir)));
  }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  material.clearcoat = uDrop.w > 1.5 ? 1.0 : clamp(max(wetMask.r * uDrop.w, dropOn), 0.0, 1.0) * uWet;   // > 1.5: all wet (look development)
  material.clearcoatF0 = vec3(0.02);
  {   // a curved drop under one pixel: widen the lobe by the normal's spread over the pixel (specular
      // anti-aliasing), so the glint of the sun or the sky in each drop lands on the pixel instead of between pixels
    vec3 ndx = dFdx(clearcoatNormal), ndy = dFdy(clearcoatNormal);
    float spread = min(0.5 * (dot(ndx, ndx) + dot(ndy, ndy)), 0.20);
    float cr = max(mix(0.075, 0.03, dropOn), 0.0525) + geometryRoughness;
    material.clearcoatRoughness = min(sqrt(cr * cr + spread), 1.0);
  }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  {   // drops too small to draw: a statistical sparkle. Cells about a pixel across on the drop texture; in a share of
      // them (the droplet density) one bead faces the sun right now and shows it as a one-pixel glint
    float farK = smoothstep(4.0, 10.0, dropTpp) * uWet;
    if (farK > 0.0 && wetMask.g > 0.02) {
      vec3 Ls = directionalLights[0].direction, Lc = directionalLights[0].color, Vv = normalize(vViewPosition);
      float ndl = max(dot(normal, Ls), 0.0);
      float expect = dot(ndl * Lc * material.diffuseColor, vec3(1.0)) * RECIPROCAL_PI;
      float sunVis = clamp(dot(reflectedLight.directDiffuse, vec3(1.0)) / max(expect, 1e-6), 0.0, 1.0);
      // cells of about two pixels (in the drop texture), each holding at most one glint: a round point of light
      // well under a pixel at a random place in the cell, so it never shows the cell's square
      float lv = floor(log2(max(dropTpp, 1.0))) + 1.0, cs = exp2(lv);
      vec2 q = dropUv * 1024.0 / cs, cell = floor(q), fq = fract(q);
      float rr = hashC(cell + lv * 17.0), ph = hashC(cell * 1.37 + 4.1 + lv);
      vec2 at = vec2(hashC(cell + 9.7), hashC(cell * 0.73 + 2.9)) * 0.6 + 0.2;
      float px = length(fwidth(q));                                          // cells per pixel
      float dot_ = exp(-dot(fq - at, fq - at) / max(px * px * 0.18, 1e-5));
      float tw = fract(uTimeS * (0.6 + 1.6 * ph) + ph * 7.0);
      float on = step(1.0 - wetMask.g * 0.02, rr) * smoothstep(0.0, 0.15, tw) * (1.0 - smoothstep(0.3, 0.75, tw));
      float cone = smoothstep(0.42, 0.62, dot(normalize(Ls + Vv), normal));     // some facet of a 65-degree cap faces the half-vector
      reflectedLight.directSpecular += Lc * (4.0 * on * dot_ * cone * sunVis * farK * step(0.0, ndl));
    }
  }
#endif`);
  };
  mat.customProgramCacheKey = () => `corsair-surface-${fair ? 1 : 0}-${o.grit ? 1 : 0}`;
  mat.needsUpdate = true;
}

// The vent blades and the plenum behind them sit in a pocket in the engine box: the sun reaches them only in
// part, and its shadow map cannot resolve 2 mm blades, so their direct light is cut to a fraction (they are
// lit by the sky as usual) and they read as dark recessed louvres from any angle.
function cavity(mat, k, tag) {
  mat.onBeforeCompile = (sh, r) => {
    THREE.Material.prototype.onBeforeCompile.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  reflectedLight.directDiffuse *= ${k.toFixed(3)}; reflectedLight.directSpecular *= ${k.toFixed(3)};`);
  };
  mat.customProgramCacheKey = () => 'corsair-cavity-' + tag;
  mat.needsUpdate = true;
}

function setWarm(m, e, k) {
  const v = m.userData.vis || (m.userData.vis = { color: m.color.clone(), env: m.envMapIntensity ?? 1, rough: m.roughness, metal: m.metalness });
  if (m.userData.thermalK === k) return;
  m.userData.thermalK = k;
  m.emissiveIntensity = e * k;
  m.color.copy(v.color).multiplyScalar(1 - 0.97 * k);
  m.envMapIntensity = v.env * (1 - 0.97 * k);
  m.roughness = v.rough + (1 - v.rough) * k; m.metalness = v.metal * (1 - k);
  if (m.userData.layer) m.userData.layer.uWet.value = 1 - k;
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
    if (!m || !masks.has(name) || !drops || !grain || !m.map || !m.normalMap) { console.warn('corsair: no water layer on', name, '(was the GLB exported by `corsair full` or `retex`?)'); continue; }
    const p = toPhysical(m);
    surfaceLayer(p, { ...o, grit: !!o.grain, mask: masks.get(name), drops, grain, mpu: m.userData.m_per_uv || 6, time: pipe.shared.uTime });
    root.traverse(x => { if (x.isMesh && x.material === m) x.material = p; });
    mats.set(name, p);
  }
  if (mats.has('mast')) { const m = mats.get('mast'); m.metalness = 0.55; m.roughness = 1.0; }   // anodised tube: matt enough to read light grey from above, not as a dark mirror of the sea
  if (mats.has('vent')) cavity(mats.get('vent'), 0.12, 'vent');            // plenum, hatch gaps, holes: deep and dark
  if (mats.has('ventblade')) cavity(mats.get('ventblade'), 0.45, 'blade');   // the blades: at the mouth of the pocket
  const warm = [];
  for (const [name, m] of mats) if (name in THERMAL) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = 0; warm.push([m, THERMAL[name]]); }
  return { root, warm, mats };
}

export async function buildCorsair(pipe) {
  if (!proto) proto = loadCorsair(pipe);
  const { root, warm } = await proto;
  const boat = root.clone(true);
  boat.name = 'corsair';
  boat.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } });
  // 0 = visible light; 1 = simulated long-wave IR: emissive alone sets the apparent temperature, so reflected sun
  // and sky (which would saturate the grade on any lit paint) are taken away. Materials are shared between the
  // boats, which is fine: the film switches all of them together.
  boat.userData = { warm, setThermal(k) { for (const [m, e] of warm) setWarm(m, e, k); } };
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
