// Film 1 scrub: creosote, mesquite, snakeweed and dry grass as pre-lit impostors (blender/scrub.py), with baked
// ground-shadow decals.
//
// Where plants grow is one GLSL function shared by the plant shader and the terrain recipe (terrain_nm.js), so the
// ground's tone takes over exactly where distant plants stop being drawn. Nothing is stored per plant: the field is
// a world-fixed jittered grid of plant slots, SCRUB_PITCH apart, in square cells of SCRUB_CELL metres; the vertex
// shader turns (cell, instance index) into a slot, keeps it with probability scrubDensity(), and picks species,
// variant, size and mirroring from a hash. Instance indices are a low-discrepancy permutation of the slots, so drawing
// only the first n of a cell thins it evenly: that is the distance LOD (per cell on the CPU, per plant on the GPU).
import * as THREE from 'three';
import { LAYER } from '../engine/pipeline.js';
import { CLOUD_COVER } from '../engine/clouds.js';
import { TERRAIN_HEIGHT } from '../engine/terrain.js';
import { loadTexture } from '../engine/assets.js';

export const SCRUB_PITCH = 2.0;                 // m between plant slots (at most one plant per 4 m²)
export const SCRUB_CELL = 192;                  // m per instanced cell (a whole number of slots)
export const SCRUB_EXTENT = [1500, 2600];       // |x|, |z| limits of the instanced field (m)
const SLOTS = (SCRUB_CELL / SCRUB_PITCH) ** 2, SIDE = SCRUB_CELL / SCRUB_PITCH;

export const SCRUB_FIELD = /* glsl */`
#define SCRUB_PITCH ${SCRUB_PITCH.toFixed(3)}
float scrubPatch(vec2 q){ return 0.5+0.5*sin(q.x*0.011+sin(q.y*0.004)*2.1)*cos(q.y*0.0075+sin(q.x*0.006)*1.7); }
// probability that the plant slot at q (world x, z in m) holds a plant; 0 where the ground is kept clear
float scrubDensity(vec2 q){
  float ax = abs(q.x), az = abs(q.y);
  if (ax < 41.0 || abs(q.x+58.0) < 7.0 || ax > ${SCRUB_EXTENT[0].toFixed(1)} || az > ${SCRUB_EXTENT[1].toFixed(1)}) return 0.0;
  if (q.x < -30.0 && q.x > -350.0 && q.y > -1700.0 && q.y < -1500.0) return 0.0;   // apron and buildings, north-west
  if (q.x > -66.0 && q.x < -38.0 && q.y > 1706.0 && q.y < 1738.0) return 0.0;       // where the opening shot's camera stands
  float d = 0.18+0.62*scrubPatch(q);
  d *= 0.3+0.7*smoothstep(41.0, 75.0, ax);                                            // sparse beside the graded strip
  d *= 1.0-smoothstep(${(SCRUB_EXTENT[0] - 250).toFixed(1)}, ${SCRUB_EXTENT[0].toFixed(1)}, ax);
  d *= 1.0-smoothstep(${(SCRUB_EXTENT[1] - 250).toFixed(1)}, ${SCRUB_EXTENT[1].toFixed(1)}, az);
  return d;
}
// fraction of plants drawn as impostors where one pixel spans mPerPx metres; the ground tone stands in for the rest
float scrubDrawn(float mPerPx){ return 1.0-smoothstep(0.2, 0.8, mPerPx); }
`;
// JS twin of scrubDrawn, for the per-cell instance counts
export const scrubDrawn = mPerPx => { const t = Math.min(1, Math.max(0, (mPerPx - 0.2) / 0.6)); return 1 - t * t * (3 - 2 * t); };

// one plant from (cell origin, instance index): shared by the impostor and the decal shaders
const PLANT = n => /* glsl */`
${SCRUB_FIELD}
${TERRAIN_HEIGHT}
uniform vec3 uOrigin; uniform float uSlots, uPixAngle, uSunAz;
uniform vec4 uVar[${n * 3}];          // per variant: [size, base, u0, v0] [du, dv, decal along from, decal along to] [decal half-width, decal u0, radius, height]
uniform vec4 uSpecies[4];             // per species: first variant, count, size jitter, height-jitter (unused)
uvec3 sPcg(uvec3 v){ v = v*1664525u+1013904223u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; v ^= v>>16u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; return v; }
// returns false for an empty slot; q: world position (m, x z), sc: scale, vi: variant, mir: mirrored about the sun plane
bool scrubPlant(vec2 cell, int i, out vec2 q, out float y, out float sc, out int vi, out bool mir, out float dist){
  int g = (i*5381+1237)%${SLOTS};
  vec2 slot = vec2(float(g%${SIDE}), float(g/${SIDE}));
  uvec3 h3 = sPcg(uvec3(ivec3(ivec2(floor(cell/${SCRUB_CELL.toFixed(1)}+0.5)), g)+ivec3(40000, 40000, 0)));
  vec4 h = vec4(h3.x&65535u, h3.x>>16u, h3.y&65535u, h3.y>>16u)/65535.0; float h5 = float(h3.z&65535u)/65535.0, h6 = float(h3.z>>16u)/65535.0;
  q = cell+(slot+0.5+(h.xy-0.5)*0.92)*SCRUB_PITCH;
  if (h.z >= scrubDensity(q)) return false;
  y = hLod(q, 1.0);
  vec3 rel = vec3(q.x-uOrigin.x, y-uOrigin.y, q.y-uOrigin.z);
  dist = length(rel);
  if ((float(i)+0.5)/uSlots >= scrubDrawn(dist*uPixAngle)) return false;
  // species: grass and snakeweed where the ground was disturbed (near the strip) and in patches, shrubs elsewhere
  float open = clamp(0.25+0.5*(1.0-smoothstep(45.0, 160.0, abs(q.x)))+0.35*(scrubPatch(q*1.7+vec2(311.0, -97.0))-0.5), 0.0, 1.0);
  int sp = h.w < open*0.55 ? 3 : (h.w < open*0.55+0.22 ? 2 : (h.w < 0.88 ? 0 : 1));   // 0 creosote, 1 mesquite, 2 snakeweed, 3 grass
  vec4 S = uSpecies[sp];
  vi = int(S.x)+min(int(h5*S.y), int(S.y)-1);
  sc = 1.0+(h6-0.5)*S.z;
  mir = fract(h5*7.31) < 0.5;
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
attribute vec4 aQuad;                 // xy: corner 0..1, zw: cell origin (m)
varying vec4 vUv; varying float vT, vSun;
void main(){
  vec2 q; float y, sc, dist; int vi; bool mir;
  if (!scrubPlant(aQuad.zw, gl_InstanceID, q, y, sc, vi, mir, dist)){ gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
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
  vec3 p = base+right*(aQuad.x-0.5)*S+vec3(0.0, aQuad.y*S-A.y*sc, 0.0);
  float u = mir ? 1.0-aQuad.x : aQuad.x;
  vUv = vec4(A.z+(k0+u)*B.x, A.w+aQuad.y*B.y, A.z+(k1+u)*B.x, A.w+aQuad.y*B.y);
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
  if (s.a < 0.3) discard;
  vec3 k = mix(texture2D(tSky, vUv.xy).rgb, texture2D(tSky, vUv.zw).rgb, vT);
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  vec3 col = s.rgb*0.3183*uSunColor*vSun + k*amb*0.3183;
  gl_FragColor = vec4(col*s.a, s.a);
}`;

const DECAL_VERT = n => /* glsl */`
uniform float logDepthBufFC; uniform sampler2D tDetail;
${PLANT(n)}
${CLOUD_COVER}
uniform vec4 uCovK; uniform vec3 uSunDir, uSunColor; uniform sampler2D tAmbient; uniform float uDecalW;
attribute vec4 aQuad;
varying vec2 vUv; varying float vSunF, vSkyF;
void main(){
  vec2 q; float y, sc, dist; int vi; bool mir;
  if (!scrubPlant(aQuad.zw, gl_InstanceID, q, y, sc, vi, mir, dist)){ gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec4 B = uVar[vi*3+1], C = uVar[vi*3+2];
  vec2 anti = -normalize(uSunDir.xz), across = vec2(anti.y, -anti.x);   // the decal image's up axis (Blender's XY is mirrored in x, z)
  float along = mix(B.z, B.w, aQuad.x)*sc, side = (aQuad.y*2.0-1.0)*C.x*sc;
  vec2 g = q+anti*along+across*side;
  vec3 p = vec3(g.x-uOrigin.x, y+0.03-uOrigin.y, g.y-uOrigin.z);
  vUv = vec2(C.y+aQuad.x*uDecalW, mir ? 1.0-aQuad.y : aQuad.y);
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

// atlas: the generated SCRUB_ATLAS (src/scrub_atlas_<film>.js). Returns { group, update(cam, film), ready }.
export async function buildScrub(pipe, { atlas, terrain, clouds }) {
  const P = atlas.plants, n = P.length, V = atlas.views, [W, H] = atlas.size, [DW] = atlas.decalSize;
  if (!n) { const group = new THREE.Group(); return { group, cells: [], update: () => 0, materials: [] }; }   // atlas not baked yet
  const species = ['creosote', 'mesquite', 'snakeweed', 'grass'];
  // variants grouped by species, in the atlas order
  const order = species.flatMap(s => P.map((p, i) => [p, i]).filter(([p]) => p.species === s));
  const uVar = [], uSpecies = [];
  for (const [p] of order) {
    const c = p.cell;
    uVar.push(new THREE.Vector4(p.size, p.base, p.atlas[0] / W, 1 - (p.atlas[1] + c) / H),
      new THREE.Vector4(c / W, c / H, p.decal[0], p.decal[1]),
      new THREE.Vector4(p.decal[2], P.indexOf(p) * 512 / DW, p.radius, p.height));
  }
  let first = 0;
  for (const s of species) { const cnt = order.filter(([p]) => p.species === s).length; uSpecies.push(new THREE.Vector4(first, Math.max(cnt, 1), s === 'grass' ? 0.5 : 0.45, 0)); first += cnt; }
  const [tSun, tSky, tShadow] = await Promise.all([loadTexture(atlas.files.sun, pipe, { aniso: 4 }), loadTexture(atlas.files.sky, pipe, { aniso: 4 }), loadTexture(atlas.files.shadow, pipe, { srgb: false, aniso: 4 })]);
  for (const t of [tSun, tSky, tShadow]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const S = pipe.shared, cov = clouds ? { ...clouds.cover, uCovK: clouds.shadowK || { value: new THREE.Vector4(0, 0, 0, 0) } } : { uCov: { value: new THREE.Vector4() }, uCovHole: { value: new THREE.Vector4() }, uCovK: { value: new THREE.Vector4() } };
  const common = {
    ...terrain.heightUniforms, ...cov, tDetail: S.tDetail, uOrigin: S.uOrigin, uSunDir: S.uSunDir, uSunColor: S.uSunColor, tAmbient: S.tAmbient,
    uSlots: { value: SLOTS }, uPixAngle: { value: 0.001 }, uSunAz: { value: atlas.sun[0] * Math.PI / 180 },
    uVar: { value: uVar }, uSpecies: { value: uSpecies },
  };
  const plantMat = new THREE.ShaderMaterial({
    uniforms: { ...common, tSun: { value: tSun }, tSky: { value: tSky } }, vertexShader: IMPOSTOR_VERT(n, V), fragmentShader: IMPOSTOR_FRAG,
    transparent: true, depthWrite: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide,
  });
  const decalMat = new THREE.ShaderMaterial({
    uniforms: { ...common, tShadow: { value: tShadow }, uDecalW: { value: 512 / DW } }, vertexShader: DECAL_VERT(n), fragmentShader: DECAL_FRAG,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide,
  });
  const group = new THREE.Group(); group.name = 'scrub';
  const cells = [];
  const nx = Math.ceil(SCRUB_EXTENT[0] / SCRUB_CELL), nz = Math.ceil(SCRUB_EXTENT[1] / SCRUB_CELL), R = SCRUB_CELL * 0.71 + 3;
  for (let iz = -nz; iz < nz; iz++) for (let ix = -nx; ix < nx; ix++) {
    const x0 = ix * SCRUB_CELL, z0 = iz * SCRUB_CELL;
    if (x0 >= -41 && x0 + SCRUB_CELL <= 41) continue;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('aQuad', new THREE.Float32BufferAttribute([0, 0, x0, z0, 1, 0, x0, z0, 0, 1, x0, z0, 1, 1, x0, z0], 4));
    geo.setIndex([0, 1, 2, 2, 1, 3]); geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R);
    const cx = x0 + SCRUB_CELL / 2, cz = z0 + SCRUB_CELL / 2;
    const plants = new THREE.Mesh(geo, plantMat), decals = new THREE.Mesh(geo.clone(), decalMat);
    decals.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R + 14);
    for (const m of [plants, decals]) { m.position.set(cx, 0, cz); m.layers.set(LAYER.STATIC); m.castShadow = m.receiveShadow = false; m.frustumCulled = true; }
    plants.renderOrder = 3; decals.renderOrder = 2;
    group.add(decals, plants);
    cells.push({ x0, z0, cx, cz, plants, decals });
  }
  // per frame: how many of each cell's slots can still be bigger than about a pixel
  function update(cam, film) {
    const px = 2 * Math.tan(cam.fov * Math.PI / 360) / film.pipe.h, o = film.pipe.origin, fy = terrain.recipe.groundAlt ?? 0;
    common.uPixAngle.value = px;
    const offP = film.off.has('plants'), offD = film.off.has('decals');   // dev profiling switches
    let drawn = 0;
    for (const c of cells) {
      const dx = Math.max(c.x0 - o.x, 0, o.x - c.x0 - SCRUB_CELL), dz = Math.max(c.z0 - o.z, 0, o.z - c.z0 - SCRUB_CELL), dy = o.y - fy;
      const f = scrubDrawn(Math.hypot(dx, dz, dy) * px);
      const k = f > 0 ? Math.ceil(SLOTS * f) : 0;
      c.plants.geometry.instanceCount = c.decals.geometry.instanceCount = k;
      c.plants.visible = k > 0 && !offP; c.decals.visible = k > 0 && !offD; drawn += k;
    }
    return drawn;
  }
  return { group, cells, update, materials: [plantMat, decalMat] };
}
