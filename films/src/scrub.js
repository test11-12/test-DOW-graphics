// Desert scrub as pre-lit impostors (blender/scrub.py): shrubs, sub-shrubs and bunchgrass baked from photoscanned
// plants under the film's own sun, each with a baked ground-shadow decal (the long sun shadow and the contact
// occlusion under the plant).
//
// Where plants grow is a "field": a world-fixed jittered grid of plant slots, `pitch` metres apart, in square cells of
// `cell` metres. A slot holds a plant with probability density(x, z); species, variant, size and mirroring come from
// a hash. Each cell's plants are listed on the CPU the first time the cell comes into range (a few kilobytes), in a
// low-discrepancy order, so drawing only the first n thins the cell evenly: that is the distance LOD (per cell on the
// CPU, per plant on the GPU; a plant shrinks to nothing just before it is dropped, so nothing pops).
// The same density is given to the film's terrain recipe as GLSL, so the ground's tone takes over exactly where
// distant plants stop being drawn.
//
// A field is { pitch, cell, bounds: [x0, x1, z0, z1] (world m), density(x, z), species(x, z, h), glsl } where
//   density(x, z)       probability that the slot at world (x, z) holds a plant
//   species(x, z, h)    species of that plant, h a random 0..1: 0 shrub (creosote), 1 dense shrub, 2 sub-shrub,
//                       3 bunchgrass
//   glsl                the same in GLSL for the terrain recipe: float scrubDensity(vec2 q), plus whatever tone
//                       helpers the recipe wants (keep the two in step), and SCRUB_DRAWN below
import * as THREE from 'three';
import { LAYER } from '../engine/pipeline.js';
import { CLOUD_COVER } from '../engine/clouds.js';
import { TERRAIN_HEIGHT } from '../engine/terrain.js';
import { loadTexture } from '../engine/assets.js';

// fraction of plants drawn where one pixel spans mPerPx metres (GLSL, and its JS twin for the per-cell counts)
export const SCRUB_DRAWN = /* glsl */`float scrubDrawn(float mPerPx){ return 1.0-smoothstep(0.3, 1.1, mPerPx); }`;
export const scrubDrawn = mPerPx => { const t = Math.min(1, Math.max(0, (mPerPx - 0.3) / 0.8)); return 1 - t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- film 1: Spaceport America (runway north-south at the origin)
const NM_EXTENT = [1500, 2600];       // |x|, |z| limits of the instanced field (m)
const NM_GLSL = /* glsl */`
#define SCRUB_PITCH 2.0
float scrubPatch(vec2 q){ return 0.5+0.5*sin(q.x*0.011+sin(q.y*0.004)*2.1)*cos(q.y*0.0075+sin(q.x*0.006)*1.7); }
// how much of the plant cover is bunchgrass: the band that drains the pavement (tufts in rows along the runway, as on
// the real field), thinning into shrub country, with grassy patches further out
float scrubGrassy(vec2 q){
  float ax = abs(q.x);
  return clamp(0.34+0.6*(1.0-smoothstep(70.0, 190.0, ax))+0.3*(scrubPatch(q*1.7+vec2(311.0, -97.0))-0.5), 0.0, 1.0);
}
float scrubDensity(vec2 q){
  float ax = abs(q.x), az = abs(q.y);
  if (ax < 40.0 || abs(q.x+58.0) < 5.6 || ax > ${NM_EXTENT[0].toFixed(1)} || az > ${NM_EXTENT[1].toFixed(1)}) return 0.0;
  if (q.x < -30.0 && q.x > -350.0 && q.y > -1700.0 && q.y < -1500.0) return 0.0;   // apron and buildings, north-west
  float d = 0.26+0.5*scrubPatch(q);
  // beside the graded strip: rows of tufts about 6 m apart, dense in the row and bare between
  float rows = 0.5+0.5*cos((ax-43.5)*1.047+1.3*sin(q.y*0.013));
  float band = 1.0-smoothstep(62.0, 96.0, ax);
  d = mix(d, min(0.1+1.15*rows*rows, 1.0), band);
  d *= smoothstep(40.0, 43.0, ax);
  d *= 1.0-smoothstep(${(NM_EXTENT[0] - 250).toFixed(1)}, ${NM_EXTENT[0].toFixed(1)}, ax);
  d *= 1.0-smoothstep(${(NM_EXTENT[1] - 250).toFixed(1)}, ${NM_EXTENT[1].toFixed(1)}, az);
  return d;
}
${SCRUB_DRAWN}
`;
// the same field in JS (keep in step with NM_GLSL)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const nmPatch = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(z * 0.004) * 2.1) * Math.cos(z * 0.0075 + Math.sin(x * 0.006) * 1.7);
const nmGrassy = (x, z) => Math.min(1, Math.max(0, 0.34 + 0.6 * (1 - sstep(70, 190, Math.abs(x))) + 0.3 * (nmPatch(x * 1.7 + 311, z * 1.7 - 97) - 0.5)));
function nmDensity(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax < 40 || Math.abs(x + 58) < 5.6 || ax > NM_EXTENT[0] || az > NM_EXTENT[1]) return 0;
  if (x < -30 && x > -350 && z > -1700 && z < -1500) return 0;
  let d = 0.26 + 0.5 * nmPatch(x, z);
  const rows = 0.5 + 0.5 * Math.cos((ax - 43.5) * 1.047 + 1.3 * Math.sin(z * 0.013)), band = 1 - sstep(62, 96, ax);
  d += (Math.min(0.1 + 1.15 * rows * rows, 1) - d) * band;
  return d * sstep(40, 43, ax) * (1 - sstep(NM_EXTENT[0] - 250, NM_EXTENT[0], ax)) * (1 - sstep(NM_EXTENT[1] - 250, NM_EXTENT[1], az));
}
// the opening shot looks from the service track to the aircraft at the brake-release point: nothing taller than grass
// and snakeweed stands in that wedge
function nmSpecies(x, z, h) {
  const g = nmGrassy(x, z), dx = x + 55.5, dz = z - 1725.5, al = dx * 0.893 - dz * 0.45, ac = Math.abs(dx * 0.45 + dz * 0.893);
  const low = al > -8 && al < 64 && ac < 5 + al * 0.3;
  if (h < g * 0.86) return 3;
  if (h < g * 0.86 + 0.1 || low) return 2;
  return h > 0.93 ? 1 : 0;
}
export const SCRUB_FIELD_NM = { pitch: 2, cell: 96, bounds: [-NM_EXTENT[0], NM_EXTENT[0], -NM_EXTENT[1], NM_EXTENT[1]], density: nmDensity, species: nmSpecies, glsl: NM_GLSL };
export const SCRUB_FIELD = NM_GLSL;   // for the film 1 terrain recipe
// one plant from its instance record: shared by the impostor and the decal shaders
const PLANT = (n, lodK = 1) => /* glsl */`
#define LOD_K ${lodK.toFixed(2)}
${SCRUB_DRAWN}
${TERRAIN_HEIGHT}
uniform vec3 uOrigin; uniform float uPixAngle, uSunAz, uGroundY;
uniform vec4 uVar[${n * 3}];          // per variant: [size, base, u0, v0] [du, dv, decal along from, decal along to] [decal half-width, decal u0, radius, height]
attribute vec2 aCorner;               // quad corner 0..1
attribute vec4 aPlant;                // world x, z (m); scale (negative: mirrored about the sun plane); variant + rank in its cell (0..1)
// returns false for a plant beyond its draw distance; q: world position (m, x z), sc: scale, vi: variant
bool scrubPlant(out vec2 q, out float y, out float sc, out int vi, out bool mir, out float dist){
  q = aPlant.xy; vi = int(floor(aPlant.w)); mir = aPlant.z < 0.0;
  // distance LOD on the field's nominal ground level (no texture fetch for the plants that are dropped)
  dist = length(vec3(q.x-uOrigin.x, uGroundY-uOrigin.y, q.y-uOrigin.z));
  float lod = scrubDrawn(dist*uPixAngle*LOD_K)-fract(aPlant.w);
  if (lod <= 0.0) return false;
  y = hLod(q, 1.0);
  sc = abs(aPlant.z)*smoothstep(0.0, 0.06, lod);
  return true;
}
// log depth per vertex, pulled towards the camera by bias metres (an impostor stands for a plant with depth)
vec4 scrubClip(vec3 rel, float bias){
  vec4 c = projectionMatrix*viewMatrix*vec4(rel, 1.0);
  c.z = (log2(max(1e-6, 1.0+max(c.w-bias, 0.05)))*logDepthBufFC-1.0)*c.w;
  return c;
}
`;

const IMPOSTOR_VERT = (n, views) => /* glsl */`
uniform float logDepthBufFC; uniform sampler2D tDetail;
${PLANT(n)}
${CLOUD_COVER}
uniform vec4 uCovK; uniform vec3 uSunDir;
varying vec4 vUv; varying float vT, vSun;
void main(){
  vec2 q; float y, sc, dist; int vi; bool mir;
  if (!scrubPlant(q, y, sc, vi, mir, dist)){ gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec4 A = uVar[vi*3], B = uVar[vi*3+1], C = uVar[vi*3+2];
  vec3 base = vec3(q.x-uOrigin.x, y-uOrigin.y, q.y-uOrigin.z);
  vec2 toCam = -base.xz; float lh = max(length(toCam), 1e-3); toCam /= lh;
  // which of the baked views: azimuth (clockwise from north) of the camera seen from the plant
  float az = atan(toCam.x, -toCam.y);
  if (mir) az = 2.0*uSunAz-az;
  float f = fract(az/6.2831853)*${views.toFixed(1)}; float k0 = floor(f); vT = f-k0;
  float k1 = mod(k0+1.0, ${views.toFixed(1)});
  vec3 right = vec3(toCam.y, 0.0, -toCam.x);
  float S = A.x*sc;
  float cy = aCorner.y*min(1.0, (A.y+C.w*1.03)/A.x);        // the quad stops just above the plant's top (wide, low plants)
  vec3 p = base+right*(aCorner.x-0.5)*S+vec3(0.0, cy*S-A.y*sc, 0.0);
  float u = mir ? 1.0-aCorner.x : aCorner.x;
  vUv = vec4(A.z+(k0+u)*B.x, A.w+cy*B.y, A.z+(k1+u)*B.x, A.w+cy*B.y);
  // cloud shadow on the plant (as on the ground)
  vec2 cq = q+uSunDir.xz*((uCovK.x-y)/max(uSunDir.y, 0.05));
  vSun = uCovK.y > 0.0 ? 1.0-uCovK.y*smoothstep(0.3, 0.85, cloudCoverL(cq, 0.5)) : 1.0;
  gl_Position = scrubClip(p, C.z*sc*0.8);
}`;
const IMPOSTOR_FRAG = /* glsl */`
uniform sampler2D tSun, tSky, tAmbient; uniform vec3 uSunColor;
varying vec4 vUv; varying float vT, vSun;
void main(){
  vec4 s = mix(texture2D(tSun, vUv.xy), texture2D(tSun, vUv.zw), vT);
  float a = clamp(s.a*1.2, 0.0, 1.0);
  if (a < 0.08) discard;
  vec3 k = mix(texture2D(tSky, vUv.xy).rgb, texture2D(tSky, vUv.zw).rgb, vT);
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  vec3 col = s.rgb*0.3183*uSunColor*vSun + k*amb*0.3183;
  gl_FragColor = vec4(col*a, a);
}`;

// shadow decals are dropped well inside the plants' range: at a grazing angle, by then, the plants in
// front hide the ground their shadows fall on
const DECAL_LOD = 2.6;
const DECAL_VERT = n => /* glsl */`
uniform float logDepthBufFC; uniform sampler2D tDetail;
${PLANT(n, DECAL_LOD)}
${CLOUD_COVER}
uniform vec4 uCovK; uniform vec3 uSunDir, uSunColor; uniform sampler2D tAmbient; uniform float uDecalW;
varying vec2 vUv; varying float vSunF, vSkyF;
void main(){
  vec2 q; float y, sc, dist; int vi; bool mir;
  if (!scrubPlant(q, y, sc, vi, mir, dist)){ gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec4 B = uVar[vi*3+1], C = uVar[vi*3+2];
  vec2 anti = -normalize(uSunDir.xz), across = vec2(anti.y, -anti.x);   // the decal image's up axis (Blender's XY is mirrored in x, z)
  float along = mix(B.z, B.w, aCorner.x)*sc, side = (aCorner.y*2.0-1.0)*C.x*sc;
  vec2 g = q+anti*along+across*side;
  vec3 p = vec3(g.x-uOrigin.x, y+0.03-uOrigin.y, g.y-uOrigin.z);
  vUv = vec2(C.y+aCorner.x*uDecalW, mir ? 1.0-aCorner.y : aCorner.y);
  // share of the ground's light that comes straight from the sun (the rest is sky): a shadow removes only that
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  float es = dot(uSunColor, vec3(0.3333))*max(uSunDir.y, 0.0), ea = dot(amb, vec3(0.3333));
  vec2 cq = q+uSunDir.xz*((uCovK.x-y)/max(uSunDir.y, 0.05));
  float cloud = uCovK.y > 0.0 ? 1.0-uCovK.y*smoothstep(0.3, 0.85, cloudCoverL(cq, 0.5)) : 1.0;
  vSunF = es*cloud/max(es*cloud+ea, 1e-4); vSkyF = 1.0-vSunF;
  gl_Position = scrubClip(p, 0.0);
}`;
const DECAL_FRAG = /* glsl */`
uniform sampler2D tShadow;
varying vec2 vUv; varying float vSunF, vSkyF;
void main(){
  vec2 t = texture2D(tShadow, vUv).rg;
  float a = 1.0-(1.0-t.r*vSunF)*(1.0-t.g*vSkyF*0.8);
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

// small integer hash -> n uniform randoms in [0, 1)
function hashN(a, b, c, n, out) {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < n; i++) { h = (h + 0x6d2b79f5) >>> 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  return out;
}

// atlas: the generated SCRUB_ATLAS (src/scrub_atlas_<film>.js); field: see the top of this file (default: film 1's);
// sizes: optional per-species size scale { creosote, mesquite, snakeweed, grass }.
// Returns { group, cells, update(cam, film), materials }.
export async function buildScrub(pipe, { atlas, terrain, clouds, field = SCRUB_FIELD_NM, sizes = {} }) {
  const P = atlas.plants, n = P.length, V = atlas.views, [W, H] = atlas.size, [DW] = atlas.decalSize;
  if (!n) { const group = new THREE.Group(); return { group, cells: [], update: () => 0, materials: [] }; }   // atlas not baked yet
  const F = field, CELL = F.cell, SIDE = Math.round(CELL / F.pitch), SLOTS = SIDE * SIDE;
  const species = ['creosote', 'mesquite', 'snakeweed', 'grass'];
  // variants grouped by species, in the atlas order
  const order = species.flatMap(s => P.map((p, i) => [p, i]).filter(([p]) => p.species === s));
  const uVar = [], spec = [];
  for (const [p] of order) {
    const c = p.cell;
    uVar.push(new THREE.Vector4(p.size, p.base, p.atlas[0] / W, 1 - (p.atlas[1] + c) / H),
      new THREE.Vector4(c / W, c / H, p.decal[0], p.decal[1]),
      new THREE.Vector4(p.decal[2], P.indexOf(p) * 512 / DW, p.radius, p.height));
  }
  let first = 0;
  for (const s of species) { const cnt = order.filter(([p]) => p.species === s).length; spec.push({ first, count: Math.max(cnt, 1), jitter: s === 'grass' ? 0.6 : 0.5, size: sizes[s] ?? 1 }); first += cnt; }
  const [tSun, tSky, tShadow] = await Promise.all([loadTexture(atlas.files.sun, pipe, { aniso: 2 }), loadTexture(atlas.files.sky, pipe, { aniso: 1 }), loadTexture(atlas.files.shadow, pipe, { srgb: false, aniso: 4 })]);
  for (const t of [tSun, tSky, tShadow]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const S = pipe.shared, cov = clouds ? { ...clouds.cover, uCovK: clouds.shadowK || { value: new THREE.Vector4(0, 0, 0, 0) } } : { uCov: { value: new THREE.Vector4() }, uCovHole: { value: new THREE.Vector4() }, uCovK: { value: new THREE.Vector4() } };
  const common = {
    ...terrain.heightUniforms, ...cov, tDetail: S.tDetail, uOrigin: S.uOrigin, uSunDir: S.uSunDir, uSunColor: S.uSunColor, tAmbient: S.tAmbient,
    uPixAngle: { value: 0.001 }, uSunAz: { value: atlas.sun[0] * Math.PI / 180 }, uGroundY: { value: terrain.recipe.groundAlt ?? 0 },
    uVar: { value: uVar },
  };
  const plantMat = new THREE.ShaderMaterial({
    uniforms: { ...common, tSun: { value: tSun }, tSky: { value: tSky } }, vertexShader: IMPOSTOR_VERT(n, V), fragmentShader: IMPOSTOR_FRAG,
    transparent: true, depthWrite: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide,
  });
  const decalMat = new THREE.ShaderMaterial({
    uniforms: { ...common, tShadow: { value: tShadow }, uDecalW: { value: 512 / DW } }, vertexShader: DECAL_VERT(n), fragmentShader: DECAL_FRAG,
    // the shadow is written to the scene's alpha only (the terrain pass lights 1 - alpha of the ground), keeping the
    // larger of what is there: where shadows overlap, the ground loses the sun once, not twice
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.MaxEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, side: THREE.DoubleSide,
  });
  const group = new THREE.Group(); group.name = 'scrub';
  const cells = [];
  const corner = new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2), index = new THREE.Uint16BufferAttribute([0, 1, 2, 2, 1, 3], 1);
  const [bx0, bx1, bz0, bz1] = F.bounds, R = CELL * 0.71 + 3, h6 = new Float64Array(6);
  for (let iz = Math.floor(bz0 / CELL); iz < Math.ceil(bz1 / CELL); iz++) for (let ix = Math.floor(bx0 / CELL); ix < Math.ceil(bx1 / CELL); ix++) {
    const x0 = ix * CELL, z0 = iz * CELL;
    if (F.skip && F.skip(x0, z0, CELL)) continue;
    cells.push({ ix, iz, x0, z0, cx: x0 + CELL / 2, cz: z0 + CELL / 2, n: -1, plants: null, decals: null });
  }
  // a cell's plants, listed when it first comes into range: [x, z, +-scale, variant + rank] in thinning order
  function populate(c) {
    const a = [];
    for (let i = 0; i < SLOTS; i++) {
      const g = (i * 5381 + 1237) % SLOTS, h = hashN(c.ix, c.iz, g, 6, h6);
      const x = c.x0 + (g % SIDE + 0.5 + (h[0] - 0.5) * 0.92) * F.pitch, z = c.z0 + (Math.floor(g / SIDE) + 0.5 + (h[1] - 0.5) * 0.92) * F.pitch;
      if (h[2] >= F.density(x, z)) continue;
      const sp = spec[F.species(x, z, h[3])];
      a.push(x, z, (1 + (h[5] - 0.5) * sp.jitter) * sp.size * (h[4] * 7.31 % 1 < 0.5 ? -1 : 1), sp.first + Math.min(Math.floor(h[4] * sp.count), sp.count - 1));
    }
    c.n = a.length / 4;
    if (!c.n) return;
    for (let k = 0; k < c.n; k++) a[k * 4 + 3] += (k + 0.5) / c.n * 0.999;
    const inst = new THREE.InstancedBufferAttribute(new Float32Array(a), 4);
    const mk = (mat, r, order) => {
      const geo = new THREE.InstancedBufferGeometry(); geo.setAttribute('aCorner', corner); geo.setAttribute('aPlant', inst); geo.setIndex(index); geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r);
      const m = new THREE.Mesh(geo, mat); m.position.set(c.cx, 0, c.cz); m.layers.set(LAYER.STATIC); m.castShadow = m.receiveShadow = false; m.frustumCulled = true; m.renderOrder = order;
      group.add(m); return m;
    };
    c.decals = mk(decalMat, R + 16, 2); c.plants = mk(plantMat, R, 3);
  }
  // per frame: how many of each cell's plants can still be bigger than about a pixel
  function update(cam, film) {
    const px = 2 * Math.tan(cam.fov * Math.PI / 360) / film.pipe.h, o = film.pipe.origin, fy = terrain.recipe.groundAlt ?? 0;
    common.uPixAngle.value = px;
    const offP = film.off.has('plants'), offD = film.off.has('decals');   // dev profiling switches
    let drawn = 0;
    for (const c of cells) {
      const dx = Math.max(c.x0 - o.x, 0, o.x - c.x0 - CELL), dz = Math.max(c.z0 - o.z, 0, o.z - c.z0 - CELL), dy = o.y - fy;
      const d = Math.hypot(dx, dz, dy) * px, f = scrubDrawn(d), fd = scrubDrawn(d * DECAL_LOD);
      if (f > 0 && c.n < 0) populate(c);
      if (!c.plants) continue;
      const k = f > 0 ? Math.ceil(c.n * f) : 0, kd = fd > 0 ? Math.ceil(c.n * fd) : 0;
      c.plants.geometry.instanceCount = k; c.decals.geometry.instanceCount = kd;
      c.plants.visible = k > 0 && !offP; c.decals.visible = kd > 0 && !offD; drawn += k;
    }
    return drawn;
  }
  return { group, cells, update, materials: [plantMat, decalMat] };
}
