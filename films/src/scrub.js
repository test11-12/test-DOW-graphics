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
// As the photographs of the site show it: pinkish red-brown basin soil, mats of straw-coloured bunchgrass, and low
// shrubs well apart (creosote and mesquite under about 1.5 m, snakeweed under half a metre), never a closed stand. A
// graded strip runs beside the pavement; beyond it, tufts loosely follow shallow drainage lines, and the shrubs start
// further out.
// The field's GLSL gives scrubD(q) = expected plants per slot (x: bunchgrass slots, y: shrubs) over the whole basin
// floor, and scrubInst(q) = the share of them drawn as plants (the instanced field's extent, with a ragged,
// noise-warped edge). Wherever plants are not drawn (out of the instanced field, or too small to draw) the terrain
// tints the ground with their cover instead, so the two hand over without a line.
const NM_EXTENT = [1500, 2600];       // east |x| and |z| limits of the instanced field (m)
const NM_WEST = 4200;                 // to the west it runs further: film 1's take-off telephoto looks that way
const NM_GLSL = /* glsl */`
#define SCRUB_PITCH 2.0
#define SCRUB_FIELD_GLSL 1
float scrubPatch(vec2 q){ return 0.5+0.5*sin(q.x*0.011+sin(q.y*0.004)*2.1)*cos(q.y*0.0075+sin(q.x*0.006)*1.7); }
// warps at 50 to 90 m and at 250 to 400 m
float scrubWarp(vec2 q){ return sin(q.x*0.11+sin(q.y*0.083)*1.7)*cos(q.y*0.127+sin(q.x*0.071)*1.5); }
float scrubWarpL(vec2 q){ return sin(q.x*0.019+sin(q.y*0.013)*1.9)*cos(q.y*0.016+sin(q.x*0.021)*1.6); }
vec2 scrubD(vec2 q){
  float ax = abs(q.x), az = abs(q.y);
  if (ax < 40.0 || abs(q.x+58.0) < 5.6) return vec2(0.0);
  if (q.x < -30.0 && q.x > -350.0 && q.y > -1700.0 && q.y < -1500.0) return vec2(0.0);   // apron and buildings, north-west
  float p1 = scrubPatch(q), p2 = scrubPatch(q*1.7+vec2(311.0, -97.0));
  float g = 0.06+0.22*p2, s = 0.055+0.17*p1*p1;
  // beside the graded strip: tufts loosely along drainage lines about 6 m apart, few shrubs
  float rows = 0.5+0.5*cos((ax-43.5)*1.047+1.3*sin(q.y*0.013)+2.4*scrubWarp(q));
  float band = 1.0-smoothstep(62.0, 120.0, ax);
  g = mix(g, 0.1+0.3*rows*rows, band); s *= 1.0-0.85*band;
  float k = (1.0-0.45*smoothstep(500.0, 1300.0, ax))*smoothstep(40.0, 43.0, ax);
  return vec2(g, s)*k;
}
float scrubInst(vec2 q){
  float w = scrubWarpL(q)*220.0+scrubWarp(q)*40.0;
  return (1.0-smoothstep(${(NM_WEST - 900).toFixed(1)}, ${NM_WEST.toFixed(1)}, -q.x+w))*(1.0-smoothstep(${(NM_EXTENT[0] - 350).toFixed(1)}, ${NM_EXTENT[0].toFixed(1)}, q.x+w))
        *(1.0-smoothstep(${(NM_EXTENT[1] - 400).toFixed(1)}, ${NM_EXTENT[1].toFixed(1)}, abs(q.y)+w));
}
float scrubDensity(vec2 q){ vec2 d = scrubD(q); return d.x+d.y; }
float scrubGrassy(vec2 q){ vec2 d = scrubD(q); return d.x/max(d.x+d.y, 1e-4); }
${SCRUB_DRAWN}
`;
// the same field in JS (keep in step with NM_GLSL)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const nmPatch = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(z * 0.004) * 2.1) * Math.cos(z * 0.0075 + Math.sin(x * 0.006) * 1.7);
const nmWarp = (x, z) => Math.sin(x * 0.11 + Math.sin(z * 0.083) * 1.7) * Math.cos(z * 0.127 + Math.sin(x * 0.071) * 1.5);
const nmWarpL = (x, z) => Math.sin(x * 0.019 + Math.sin(z * 0.013) * 1.9) * Math.cos(z * 0.016 + Math.sin(x * 0.021) * 1.6);
function nmD(x, z) {
  const ax = Math.abs(x);
  if (ax < 40 || Math.abs(x + 58) < 5.6) return [0, 0];
  if (x < -30 && x > -350 && z > -1700 && z < -1500) return [0, 0];
  const p1 = nmPatch(x, z), p2 = nmPatch(x * 1.7 + 311, z * 1.7 - 97);
  let g = 0.06 + 0.22 * p2, s = 0.055 + 0.17 * p1 * p1;
  const rows = 0.5 + 0.5 * Math.cos((ax - 43.5) * 1.047 + 1.3 * Math.sin(z * 0.013) + 2.4 * nmWarp(x, z)), band = 1 - sstep(62, 120, ax);
  g += (0.1 + 0.3 * rows * rows - g) * band; s *= 1 - 0.85 * band;
  const k = (1 - 0.45 * sstep(500, 1300, ax)) * sstep(40, 43, ax);
  return [g * k, s * k];
}
const nmInst = (x, z) => { const w = nmWarpL(x, z) * 220 + nmWarp(x, z) * 40; return (1 - sstep(NM_WEST - 900, NM_WEST, -x + w)) * (1 - sstep(NM_EXTENT[0] - 350, NM_EXTENT[0], x + w)) * (1 - sstep(NM_EXTENT[1] - 400, NM_EXTENT[1], Math.abs(z) + w)); };
const nmDensity = (x, z) => { const i = nmInst(x, z); if (i <= 0) return 0; const [g, s] = nmD(x, z); return (g + s) * i; };
// species of the plant in the slot at (x, z), h random 0..1: 0 creosote, 1 mesquite, 2 snakeweed, 3 bunchgrass.
// The opening shot looks from the service track to the aircraft at the brake-release point: nothing taller than grass
// and snakeweed stands in that wedge.
function nmSpecies(x, z, h) {
  const [g, s] = nmD(x, z), gr = g / Math.max(g + s, 1e-4);
  if (h < gr) return 3;
  const u = (h - gr) / Math.max(1 - gr, 1e-4);
  const dx = x + 55.5, dz = z - 1725.5, al = dx * 0.893 - dz * 0.45, ac = Math.abs(dx * 0.45 + dz * 0.893);
  if (al > -8 && al < 64 && ac < 5 + al * 0.3) return 2;
  return u < 0.5 ? 0 : (u < 0.62 ? 1 : 2);
}
// sizes: scale on the baked plants; tone: [gain, saturation] on their baked albedo (1: as baked); clump: bunchgrass
// bunches per grass slot (1 to n, at 0.2 to 0.7 m from the slot)
export const SCRUB_FIELD_NM = {
  pitch: 2, cell: 96, bounds: [-NM_WEST, NM_EXTENT[0], -NM_EXTENT[1], NM_EXTENT[1]], density: nmDensity, species: nmSpecies, glsl: NM_GLSL,
  sizes: { creosote: 0.85, mesquite: 0.85, snakeweed: 1.0, grass: 1.0 },
  // tone: the bake's leaves are graded to real albedos, but a dense canopy shades itself; these gains bring the sunlit
  // plants to what the site photographs show beside the soil (dark olive creosote, greener mesquite, yellow-green
  // snakeweed, straw bunchgrass a little brighter than the soil)
  tone: { creosote: [2.6, 0.95], mesquite: [2.4, 0.95], snakeweed: [2.3, 1.0], grass: [1.7, 1.0] },
  clump: 4,
};
export const SCRUB_FIELD = NM_GLSL;   // for the film 1 terrain recipe
// one plant from its instance record: shared by the impostor and the decal shaders
const PLANT = (n, lodK = 1) => /* glsl */`
#define LOD_K ${lodK.toFixed(2)}
${SCRUB_DRAWN}
${TERRAIN_HEIGHT}
uniform vec3 uOrigin; uniform float uPixAngle, uSunAz, uGroundY;
uniform vec4 uVar[${n * 4}];          // per variant: [size, base, u0, v0] [du, dv, decal along from, decal along to] [decal half-width, decal u0, radius, height] [tone gain, saturation, decal v0, decal dv]
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
varying vec4 vUv; varying float vT, vSun; varying vec4 vTone;
void main(){
  vec2 q; float y, sc, dist; int vi; bool mir;
  if (!scrubPlant(q, y, sc, vi, mir, dist)){ gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec4 A = uVar[vi*4], B = uVar[vi*4+1], C = uVar[vi*4+2];
  // per plant: its species' tone, and its own small departure from it (gain +-15 %, a slight shift between yellower
  // and greyer green), so no two neighbours read as copies
  vec2 hj = fract(sin(vec2(dot(q, vec2(12.9898, 78.233)), dot(q, vec2(39.3468, 11.135))))*43758.5453)*2.0-1.0;
  vTone = vec4(uVar[vi*4+3].x*(1.0+0.15*hj.x), uVar[vi*4+3].y, hj.y, 0.0);
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
// Lit like the ground around it: the bake's sun term (self-shadowing, translucency, bounce) times the sun at the plant,
// and its sky term times the sky light, desaturated as the layered ground's is (uAmbSat). Species tone acts on the baked
// albedo, before the light, so the low sun's warmth stays on every plant.
// Coverage: mip averaging thins fine twigs and blades with distance, so alpha is scaled back up by the mip level, then
// sharpened to a one-pixel antialiased edge (Golus): far plants stay solid specks, not grey ghosts. The two nearest baked
// views blend by their alpha, then the sharpened edge morphs from one silhouette to the other as the camera turns
// round the plant: no double exposure.
const IMPOSTOR_FRAG = /* glsl */`
uniform sampler2D tSun, tSky, tAmbient; uniform vec3 uSunColor; uniform vec2 uAtlasPx; uniform float uAmbSat;
varying vec4 vUv; varying float vT, vSun; varying vec4 vTone;
const vec3 Y3 = vec3(0.2126, 0.7152, 0.0722);
void main(){
  vec4 s0 = texture2D(tSun, vUv.xy), s1 = texture2D(tSun, vUv.zw);
  float t = smoothstep(0.15, 0.85, vT);
  vec2 px = vUv.xy*uAtlasPx, ddx = dFdx(px), ddy = dFdy(px);
  float lod = max(0.5*log2(max(max(dot(ddx, ddx), dot(ddy, ddy)), 1e-8)), 0.0);
  float a = mix(s0.a, s1.a, t)*(1.0+0.3*lod);
  a = clamp((a-0.5)/max(fwidth(a), 1e-4)+0.5, 0.0, 1.0);
  if (a < 0.01) discard;
  float w0 = s0.a*(1.0-t), w1 = s1.a*t, ws = max(w0+w1, 1e-4);
  vec3 sun = (s0.rgb*w0+s1.rgb*w1)/ws;
  vec3 sky = (texture2D(tSky, vUv.xy).rgb*w0+texture2D(tSky, vUv.zw).rgb*w1)/ws;
  sun = mix(vec3(dot(sun, Y3)), sun, vTone.y); sky = mix(vec3(dot(sky, Y3)), sky, vTone.y);
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb; amb = mix(vec3(dot(amb, Y3)), amb, uAmbSat);
  vec3 col = (sun*0.3183*uSunColor*vSun + sky*amb*0.3183)*vTone.x;
  col *= vec3(1.0+0.05*vTone.z, 1.0, 1.0-0.07*vTone.z);
  gl_FragColor = vec4(max(col, 0.0)*a, a);
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
  vec4 B = uVar[vi*4+1], C = uVar[vi*4+2], D = uVar[vi*4+3];
  vec2 anti = -normalize(uSunDir.xz), across = vec2(anti.y, -anti.x);   // the decal image's up axis (Blender's XY is mirrored in x, z)
  float along = mix(B.z, B.w, aCorner.x)*sc, side = (aCorner.y*2.0-1.0)*C.x*sc;
  vec2 g = q+anti*along+across*side;
  vec3 p = vec3(g.x-uOrigin.x, y+0.03-uOrigin.y, g.y-uOrigin.z);
  vUv = vec2(C.y+aCorner.x*uDecalW, D.z+(mir ? 1.0-aCorner.y : aCorner.y)*D.w);
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

// atlas: the generated SCRUB_ATLAS (src/scrub_atlas_<film>.js); field: see the top of this file (default: film 1's),
// with optional per-species { creosote, mesquite, snakeweed, grass } maps: field.sizes (scale on the baked plant) and
// field.tone (gain on its baked albedo, or [gain, saturation]); field.clump (bunchgrass: up to this many bunches per
// grass slot, each its own variant, size and mirroring); field.scaleAt(x, z) (a size factor by place); ambSat (the
// terrain recipe's): saturation of the sky light on the plants, as on the ground.
// Returns { group, cells, update(cam, film), materials }.
export async function buildScrub(pipe, { atlas, terrain, clouds, field = SCRUB_FIELD_NM }) {
  const sizes = field.sizes || {}, tone = field.tone || {};
  const P = atlas.plants, n = P.length, V = atlas.views, [W, H] = atlas.size, [DW, DH] = atlas.decalSize;
  if (!n) { const group = new THREE.Group(); return { group, cells: [], update: () => 0, materials: [] }; }   // atlas not baked yet
  const F = field, CELL = F.cell, SIDE = Math.round(CELL / F.pitch), SLOTS = SIDE * SIDE;
  const species = ['creosote', 'mesquite', 'snakeweed', 'grass'];
  // variants grouped by species, in the atlas order
  const order = species.flatMap(s => P.map((p, i) => [p, i]).filter(([p]) => p.species === s));
  const uVar = [], spec = [];
  for (const [p] of order) {
    const c = p.cell;
    const dAt = p.decalAt || [P.indexOf(p) * 512, 0];   // decal cell, pixels from the top left (older atlases: one row)
    uVar.push(new THREE.Vector4(p.size, p.base, p.atlas[0] / W, 1 - (p.atlas[1] + c) / H),
      new THREE.Vector4(c / W, c / H, p.decal[0], p.decal[1]),
      new THREE.Vector4(p.decal[2], dAt[0] / DW, p.radius, p.height),
      new THREE.Vector4(...[].concat(tone[p.species] ?? 1, 1).slice(0, 2), 1 - (dAt[1] + 128) / DH, 128 / DH));
  }
  let first = 0;
  // young and old plants: shrubs 0.6 to 1.25 of the baked size, bunchgrass 0.5 to 1.3
  for (const s of species) { const cnt = order.filter(([p]) => p.species === s).length; spec.push({ first, count: Math.max(cnt, 1), lo: s === 'grass' ? 0.5 : 0.6, span: s === 'grass' ? 0.8 : 0.65, size: sizes[s] ?? 1 }); first += cnt; }
  const [tSun, tSky, tShadow] = await Promise.all([loadTexture(atlas.files.sun, pipe, { aniso: 1 }), loadTexture(atlas.files.sky, pipe, { aniso: 1 }), loadTexture(atlas.files.shadow, pipe, { srgb: false, aniso: 2 })]);
  for (const t of [tSun, tSky, tShadow]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const S = pipe.shared, cov = clouds ? { ...clouds.cover, uCovK: clouds.shadowK || { value: new THREE.Vector4(0, 0, 0, 0) } } : { uCov: { value: new THREE.Vector4() }, uCovHole: { value: new THREE.Vector4() }, uCovK: { value: new THREE.Vector4() } };
  const common = {
    ...terrain.heightUniforms, ...cov, tDetail: S.tDetail, uOrigin: S.uOrigin, uSunDir: S.uSunDir, uSunColor: S.uSunColor, tAmbient: S.tAmbient,
    uPixAngle: { value: 0.001 }, uSunAz: { value: atlas.sun[0] * Math.PI / 180 }, uGroundY: { value: terrain.recipe.groundAlt ?? 0 },
    uVar: { value: uVar },
  };
  const plantMat = new THREE.ShaderMaterial({
    uniforms: { ...common, tSun: { value: tSun }, tSky: { value: tSky }, uAtlasPx: { value: new THREE.Vector2(W, H) }, uAmbSat: { value: terrain.recipe.ambSat ?? 1 } }, vertexShader: IMPOSTOR_VERT(n, V), fragmentShader: IMPOSTOR_FRAG,
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
  const [bx0, bx1, bz0, bz1] = F.bounds, R = CELL * 0.71 + 3, h6 = new Float64Array(6), h4 = new Float64Array(4), CLUMP = F.clump || 1;
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
      const si = F.species(x, z, h[3]), sp = spec[si], k = F.scaleAt ? F.scaleAt(x, z) : 1;
      if (si === 3 && CLUMP > 1) { // bunchgrass: one to CLUMP bunches round the slot, each its own variant, size and side
        const nb = 1 + Math.min(Math.floor(h[5] * h[5] * CLUMP * 1.25), CLUMP - 1), r0 = nb > 1 ? 0.2 : 0;
        for (let b = 0; b < nb; b++) {
          const r = hashN(c.ix * 7 + b, c.iz * 13 - b, g, 4, h4), ang = r[0] * 6.2831853, d = r0 + (0.7 - r0) * r[1] * (nb > 1 ? 1 : 0);
          a.push(x + Math.cos(ang) * d, z + Math.sin(ang) * d, (sp.lo + sp.span * r[2]) * sp.size * k * (r[3] < 0.5 ? -1 : 1), sp.first + Math.min(Math.floor(r[3] * 2 % 1 * sp.count), sp.count - 1));
        }
        continue;
      }
      a.push(x, z, (sp.lo + sp.span * h[5]) * sp.size * k * (h[4] * 7.31 % 1 < 0.5 ? -1 : 1), sp.first + Math.min(Math.floor(h[4] * sp.count), sp.count - 1));
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
  // a typical shadow decal's length on the ground (m): the shadows are what a grazing view foreshortens to nothing
  const decalLen = 0.5 * P.reduce((a, p) => a + (p.decal[1] - p.decal[0]) * (sizes[p.species] ?? 1), 0) / n;
  // per frame: how many of each cell's plants can still be bigger than about a pixel
  function update(cam, film) {
    const px = 2 * Math.tan(cam.fov * Math.PI / 360) / film.pipe.h, o = film.pipe.origin, fy = terrain.recipe.groundAlt ?? 0;
    common.uPixAngle.value = px;
    const offP = film.off.has('plants'), offD = film.off.has('decals');   // dev profiling switches
    const sd = S.uSunDir.value, sh = Math.hypot(sd.x, sd.z) || 1, ax = -sd.x / sh, az = -sd.z / sh;
    let drawn = 0;
    for (const c of cells) {
      const dx = Math.max(c.x0 - o.x, 0, o.x - c.x0 - CELL), dz = Math.max(c.z0 - o.z, 0, o.z - c.z0 - CELL), dy = o.y - fy;
      const dm = Math.hypot(dx, dz, dy), d = dm * px, f = scrubDrawn(d);
      // decals: dropped where even a typical shadow, seen this obliquely, would be under half a pixel tall
      const vx = c.cx - o.x, vz = c.cz - o.z, vh = Math.hypot(vx, vz) || 1;
      const along = Math.abs(vx * ax + vz * az) / vh * decalLen + 1.0, tall = along * Math.max(dy, 0) / Math.max(dm, 1) / Math.max(d, 1e-6);
      const fd = tall < 0.5 ? 0 : scrubDrawn(d * DECAL_LOD);
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
