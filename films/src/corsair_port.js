// The harbour for "Three Corsairs", built in Blender from CC0 photoscans (films/blender/port.py) and loaded
// from assets/corsair/port_*.glb. A generic naval maintenance waterfront standing in for the facility at
// Bandar Abbas, not a survey of it: same layout and coordinates as the procedural port it replaces.
//
// Light baked in Blender for the film's fixed sun (az 80, el 11) rides along with each asset:
//   - stones and gravel carry per-vertex occlusion and sun visibility (_AO, _SUN attributes);
//   - structures carry an occlusion texture whose G channel is sun visibility (material extras: dowlm = 1).
// Here the sun visibility scales the direct light (static shadows at every range, where the engine's single
// shadow map only covers the shot's focus), and rock materials (extras: dow = 'rock') get the shoreline:
// wet dark stone and a weed film at the water, a salt-pale splash zone, dry bleached tops.
// Detail no atlas can hold is drawn here, filtered to the pixel so it never shimmers: the box-profile ribs of the
// shed cladding and roofs (meshes sheds_clad, sheds_roof), the slats of the roller shutters (sheds_shutter), the
// fastener rows and the sheet-to-sheet tone of the cladding, window rows on the low buildings of the base. Thin
// tubes and bars (rails, posts, ropes, downpipes) are found at load time and widened to about a pixel at any range,
// so they neither break up nor crawl.
import * as THREE from 'three';
import { loadGLB, hasAsset } from '../engine/assets.js';

export const PORT = {
  quayY: 2.4, quayZ: -22, pier: { x0: -19, x1: -11, z1: 52, y: 2.6 }, lift: { x0: -8, x1: 4, z0: 2, z1: 40, y: 1.5 },
  sub: { x: -2, z0: 5.5, z1: 34.5, y: 3.32 }, finger: { x0: 4.6, x1: 7.2, z1: 44 },
  entrance: [[30, 176], [176, 108]],
  // waterline points the three boats run to
  hits: [[-2.2, 41.2], [8.4, 22.5], [-20.2, 26]],
};

const DEV = new Set((typeof location !== 'undefined' ? new URLSearchParams(location.search).get('portdev') || '' : '').split(','));   // look development: ?portdev=noao,nothin
const FILES = ['port_rocks', 'port_rocks_near', 'port_pier', 'port_gantry', 'port_sub', 'port_yard', 'port_sheds', 'port_ground'];
const NEAR_LOD = 150;   // m: stones within this range of the camera use the detailed version

const VERT_PARS = /* glsl */`
uniform vec3 uDowOrigin;
varying vec3 vDowW;
#ifdef DOW_VLIGHT
attribute float _ao; attribute float _sun;
varying vec2 vDowL;
#endif
#ifdef DOW_THIN
attribute vec4 dowThin; uniform vec2 uDowRes;
#endif
`;
// thin parts: grow them so they are never narrower than about a pixel (dowThin: xyz the even-growth direction in
// world space, w the part's half-thickness in metres; see markThin)
const VERT_THIN = /* glsl */`
#ifdef DOW_THIN
  if (dowThin.w > 0.0){
    float px = -mvPosition.z*2.0/(projectionMatrix[1][1]*uDowRes.y);
    float grow = max(0.0, 0.42*px-dowThin.w);        // at least ~0.85 px across (with the scene's MSAA, a steady line)
    if (grow > 0.0){ mvPosition.xyz += (viewMatrix*vec4(dowThin.xyz, 0.0)).xyz*grow; gl_Position = projectionMatrix*mvPosition; }
  }
#endif
`;
const VERT_MAIN = /* glsl */`
  vDowW = (modelMatrix*vec4(transformed, 1.0)).xyz+uDowOrigin;
#ifdef DOW_VLIGHT
  vDowL = vec2(_ao, _sun);
#endif
`;
const FRAG_PARS = /* glsl */`
uniform vec3 uDowOrigin; uniform sampler2D tDowDetail; uniform vec4 uDowK;   // x: sun-visibility weight, y: vertex-AO weight, z: shore strength
varying vec3 vDowW;
#ifdef DOW_VLIGHT
varying vec2 vDowL;
#endif
#if defined(DOW_RIBS) || defined(DOW_SLATS)
// profile height (0..1) across one period: box-profile cladding (pan, rise, crest, fall) or rounded shutter slats
float dowProf(float u, float P){
  float x = fract(u/P);
#ifdef DOW_SLATS
  return 4.0*x*(1.0-x);
#else
  return clamp((x-0.48)/0.12, 0.0, 1.0)-clamp((x-0.84)/0.16, 0.0, 1.0);
#endif
}
float dowHash(vec2 c){ return fract(sin(dot(c, vec2(91.7, 13.1)))*43758.5453); }
// a line of width w (m) every period P along v, box-filtered over the pixel footprint fw
float dowLine(float v, float P, float off, float w, float fw){
  float d = abs(fract((v-off)/P+0.5)-0.5)*P;
  return (1.0-smoothstep(0.5*w, 0.5*w+fw, d))*min(1.0, w/max(fw, 1e-5));
}
#endif
#ifdef DOW_WINDOWS
// fraction of the footprint [x-fw/2, x+fw/2] inside the openings [kP, kP+w]: an exact box filter of a pulse train
float dowPI(float x, float P, float w){ return floor(x/P)*w+min(fract(x/P)*P, w); }
float dowPulse(float x, float P, float w, float fw){ fw = max(fw, 1e-4); return (dowPI(x+0.5*fw, P, w)-dowPI(x-0.5*fw, P, w))/fw; }
#endif
`;
// after the maps are read: sun visibility, and the shoreline weathering of stone
const FRAG_SURFACE = /* glsl */`
  float dowSun = 1.0;
#ifdef DOW_VLIGHT
  dowSun = smoothstep(0.04, 0.96, vDowL.y);
#endif
#if defined(DOW_LMSUN) && defined(USE_AOMAP)
  dowSun = texture2D(aoMap, vAoMapUv).g;
#endif
  dowSun = mix(1.0, dowSun, uDowK.x);
#ifdef DOW_SHORE
  {
    vec2 q = vDowW.xz;
    float n1 = texture2D(tDowDetail, q*0.021).r, n2 = texture2D(tDowDetail, q*0.13+0.31).g, n3 = texture2D(tDowDetail, q*0.71+0.67).r;
    float wy = vDowW.y;
    float tide = 0.85+(n1-0.5)*0.55+(n2-0.5)*0.22;                  // top of the wetted band (water at 0, swell over it)
    float wet = 1.0-smoothstep(tide-0.3, tide+0.06, wy);
    float weed = (1.0-smoothstep(0.05+n1*0.35, 0.45+n2*0.35, wy))*smoothstep(-1.6, -0.5, wy)*smoothstep(0.28, 0.62, n2*0.7+n3*0.5);
    float splash = smoothstep(tide-0.05, tide+0.5, wy)*(1.0-smoothstep(tide+0.7, tide+1.6, wy));
    float dry = smoothstep(tide+0.9, tide+2.1, wy);
    vec3 c = diffuseColor.rgb; float lum = dot(c, vec3(0.3, 0.55, 0.15));
    c = mix(c, (mix(c, vec3(lum)*vec3(1.06, 1.02, 0.95), 0.5)*1.22+vec3(0.010, 0.009, 0.007)), dry*0.8*uDowK.z);        // bleached, dusty tops
    c = mix(c, vec3(0.50, 0.49, 0.46)*(0.75+0.5*n3), splash*smoothstep(0.52, 0.78, n3)*0.4*uDowK.z);                // salt crust
    c = mix(c, c*(0.38+0.25*n3)*vec3(0.93, 0.97, 1.0), wet*0.9*uDowK.z);                                              // damp stone
    vec3 weedC = mix(vec3(0.020, 0.024, 0.010), vec3(0.045, 0.040, 0.017), n3);
    c = mix(c, weedC, weed*0.92*uDowK.z);
    diffuseColor.rgb = c;
    roughnessFactor = mix(roughnessFactor, 0.28, wet*(1.0-weed*0.5)*0.85*uDowK.z);
  }
#endif
`;
// corrugated sheet: ribs as a normal tilt (the slope averaged over the pixel: the height difference across the
// footprint over its width, so ribs fade to flat exactly when they can no longer be resolved), sheet tones, the
// side laps, fastener rows with a little rust bled below them
const FRAG_RIBS = /* glsl */`
#if defined(DOW_RIBS) || defined(DOW_SLATS)
  vec3 dowGN = normalize(cross(dFdx(vDowW), dFdy(vDowW))); vec3 dowA = abs(dowGN);
  bool dowAlongZ = dowA.x > dowA.z;
#ifdef DOW_SLATS
  float dowU = vDowW.y, dowP = 0.09, dowH = 0.007; vec3 dowT = vec3(0.0, 1.0, 0.0);
  float dowV = dowAlongZ ? vDowW.z : vDowW.x;
#else
  float dowU = dowAlongZ ? vDowW.z : vDowW.x, dowP = 0.25, dowH = 0.022; vec3 dowT = dowAlongZ ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  bool dowRoof = dowA.y > 0.5;
  float dowV = dowRoof ? vDowW.z : vDowW.y;
#endif
  float dowFW = max(fwidth(dowU), 1e-4), dowFV = max(fwidth(dowV), 1e-4), dowBW = 1.6*dowFW;     // a wider box than the pixel: no fringes
  float dowS = dowH*(dowProf(dowU+0.5*dowBW, dowP)-dowProf(dowU-0.5*dowBW, dowP))/dowBW;
  // the ribs the filter takes out still scatter the light: widen the highlight by what was lost (specular AA)
  roughnessFactor = sqrt(roughnessFactor*roughnessFactor+0.06*smoothstep(0.25, 1.2, dowBW/dowP));
  {
    float far = smoothstep(0.35, 1.2, dowFW);                                   // sheets smaller than a pixel or so: no tone
    float sheet = dowHash(vec2(floor(dowU/1.0), floor(dowV/6.1)));
    diffuseColor.rgb *= 1.0+0.11*(sheet-0.5)*(1.0-far);
    float patchv = dowHash(vec2(floor(dowU/3.0+0.37*floor(dowV/4.7)), 7.0+floor(dowV/4.7)));   // here and there a run of newer, cleaner sheets
    diffuseColor.rgb *= patchv > 0.86 ? 1.07 : 1.0;
    roughnessFactor = clamp(roughnessFactor+0.12*(sheet-0.5)*(1.0-far), 0.04, 1.0);
#ifndef DOW_SLATS
    float lap = dowLine(dowU, 1.0, 0.0, 0.02, dowFW);
    diffuseColor.rgb *= 1.0-0.22*lap;
    // fastener rows on the girts (walls: every 1.6 m from 3.8 m up; roofs: on the purlins every 1.4 m)
    float rowP = dowRoof ? 1.4 : 1.6, rowO = dowRoof ? 0.3 : 3.8;
    float row = dowLine(dowV, rowP, rowO, 0.022, dowFV);
    float dots = mix(dowLine(dowU, dowP, 0.125, 0.022, dowFW), 0.088, smoothstep(0.2, 0.6, dowFW/dowP));
    diffuseColor.rgb *= 1.0-0.7*row*dots;
    if (!dowRoof){
      float below = fract((dowV-rowO)/rowP)*rowP;                                // metres above the row beneath
      float up = rowP-below;                                                     // metres below the row above
      float st = texture2D(tDowDetail, vec2(dowU*0.9, dowV*0.06)).r;
      float bleed = exp(-up/0.3)*smoothstep(0.45, 0.8, st);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.66, 0.47, 0.33), bleed*0.4);
    }
#endif
  }
#endif
`;
// the low buildings of the base: rows of windows on every wall, one storey every 3.3 m, glass dark with a little
// sky in it, an occasional pale blind; filtered so a far wall just darkens by the share of glass
const FRAG_WINDOWS = /* glsl */`
#ifdef DOW_WINDOWS
  {
    vec3 gn = normalize(cross(dFdx(vDowW), dFdy(vDowW))); vec3 ga = abs(gn);
    if (ga.y < 0.3){
      float u = ga.x > ga.z ? vDowW.z : vDowW.x, v = vDowW.y-2.4-0.9;
      float fu = fwidth(u)*1.3, fv = fwidth(v)*1.3;
      float cov = dowPulse(u+0.75, 3.0, 1.5, fu)*dowPulse(v, 3.3, 1.3, fv)*step(-0.2, v);
      float h = fract(sin(dot(floor(vec2(u/3.0+0.25, v/3.3)), vec2(41.3, 17.9)))*43758.5453);
      vec3 glass = mix(vec3(0.028, 0.032, 0.036), vec3(0.32, 0.3, 0.27), step(0.86, h)*(1.0-smoothstep(0.3, 1.5, fu)));
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, cov*0.9);
      roughnessFactor = mix(roughnessFactor, 0.12, cov*0.8);
    }
  }
#endif
`;
const FRAG_RIBN = /* glsl */`
#if defined(DOW_RIBS) || defined(DOW_SLATS)
  { vec3 Tv = normalize((viewMatrix*vec4(dowT, 0.0)).xyz); Tv = normalize(Tv-normal*dot(normal, Tv)+1e-6); normal = normalize(normal-Tv*dowS); }
#endif
`;
const FRAG_SAND = /* glsl */`
#ifdef DOW_SAND
  {
    vec2 q = vDowW.xz; float n1 = texture2D(tDowDetail, q*0.03).r, n2 = texture2D(tDowDetail, q*0.21+0.4).g;
    float wet = 1.0-smoothstep(0.55+n1*0.35, 1.05+n1*0.35, vDowW.y+(n2-0.5)*0.15);        // damp sand below the last tide
    diffuseColor.rgb *= mix(1.0, 0.52, wet);
    roughnessFactor = mix(roughnessFactor, 0.35, wet*smoothstep(0.6, 0.0, vDowW.y));
  }
#endif
`;
const FRAG_AO = /* glsl */`
#ifdef DOW_VLIGHT
  { float a = mix(1.0, vDowL.x, uDowK.y); reflectedLight.indirectDiffuse *= a; reflectedLight.indirectSpecular *= mix(1.0, a, 0.8); }
#endif
`;

function patchMaterial(mat, flags, U) {
  const key = 'dow:' + Object.keys(flags).filter(k => flags[k]).sort().join(',');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const defs = Object.keys(flags).filter(k => flags[k]).map(k => `#define ${k}\n`).join('');
    sh.vertexShader = defs + VERT_PARS + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_MAIN)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_THIN);
    sh.fragmentShader = defs + FRAG_PARS + sh.fragmentShader
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_SURFACE + FRAG_SAND + FRAG_RIBS + FRAG_WINDOWS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_RIBN)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= dowSun;'))
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG_AO);
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}

// Thin pieces in a mesh: parts (triangles joined through shared corners, split normals welded by position) that
// are long and narrow in world units and closed all round (tubes, bars; not flat strips). Each of their vertices
// gets a dowThin attribute: the direction that grows the part evenly (the mean of the face normals meeting at that
// corner, scaled so every face moves the same distance, so no cracks open) and the part's half-thickness (m).
// Returns the number of vertices marked.
const _v = new THREE.Vector3(), _n = new THREE.Vector3();
function markThin(mesh, maxR = 0.16) {
  const geo = mesh.geometry, pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index;
  if (!pos || !nrm || !idx) return 0;
  const n = pos.count, M = mesh.matrixWorld, NM = new THREE.Matrix3().getNormalMatrix(M);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), weld = new Int32Array(n), key = new Map();
  for (let i = 0; i < n; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(M); _n.fromBufferAttribute(nrm, i).applyMatrix3(NM).normalize();
    P[i * 3] = _v.x; P[i * 3 + 1] = _v.y; P[i * 3 + 2] = _v.z; N[i * 3] = _n.x; N[i * 3 + 1] = _n.y; N[i * 3 + 2] = _n.z;
    const k = Math.round(_v.x * 500) + ',' + Math.round(_v.y * 500) + ',' + Math.round(_v.z * 500);
    let w = key.get(k); if (w === undefined) { w = i; key.set(k, i); } weld[i] = w;
  }
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = weld[i];
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const I = idx.array;
  for (let t = 0; t < I.length; t += 3) { const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]); par[b] = a; par[c] = a; }
  // the normals meeting at each welded corner: their sum and how many
  const cn = new Float32Array(n * 3), ck = new Uint16Array(n);
  for (let i = 0; i < n; i++) { const w = weld[i]; cn[w * 3] += N[i * 3]; cn[w * 3 + 1] += N[i * 3 + 1]; cn[w * 3 + 2] += N[i * 3 + 2]; ck[w]++; }
  const comp = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i); let c = comp.get(r);
    if (!c) { c = { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9], ns: [0, 0, 0], k: 0, v: [] }; comp.set(r, c); }
    for (let a = 0; a < 3; a++) { const x = P[i * 3 + a]; if (x < c.lo[a]) c.lo[a] = x; if (x > c.hi[a]) c.hi[a] = x; c.ns[a] += N[i * 3 + a]; }
    c.k++; c.v.push(i);
  }
  const out = new Float32Array(n * 4); let marked = 0;
  for (const c of comp.values()) {
    if (c.k < 8) continue;
    const e = [0, 1, 2].map(a => c.hi[a] - c.lo[a]).sort((a, b) => a - b);
    const mean = Math.hypot(c.ns[0], c.ns[1], c.ns[2]) / c.k;
    if (!(e[1] < 2 * maxR && e[2] > 3 * e[1] && mean < 0.35)) continue;
    for (const i of c.v) {
      const w = weld[i]; let x = cn[w * 3], y = cn[w * 3 + 1], z = cn[w * 3 + 2];
      // k unit normals summing to S: d = k S / |S|^2 moves each face through the corner by one unit (d.n = 1 for
      // orthogonal or symmetric faces, and n itself on a smooth surface), the same d for every copy of the corner
      const L2 = x * x + y * y + z * z; if (L2 < 1e-8) continue;
      const s = ck[w] / L2;
      out[i * 4] = x * s; out[i * 4 + 1] = y * s; out[i * 4 + 2] = z * s; out[i * 4 + 3] = 0.5 * e[1];
    }
    marked += c.k;
  }
  if (marked) geo.setAttribute('dowThin', new THREE.BufferAttribute(out, 4));
  return marked;
}

// opts: { lodNear (m) }
export async function buildPort(pipe, opts = {}) {
  const root = new THREE.Group(); root.name = 'port';
  const S = pipe.shared;
  const U = { uDowOrigin: S.uOrigin, tDowDetail: S.tDetail, uDowK: { value: new THREE.Vector4(1, 1, 1, 0) }, uDowRes: S.uRes };
  const lodPairs = new Map();   // chunk name -> { A, B, c: Vector3, r }
  for (const f of FILES) {
    const name = `corsair/${f}.glb`;
    if (!hasAsset(name)) { console.warn('port: missing', name); continue; }
    const { root: g } = await loadGLB(name, pipe, { cast: false, receive: true });
    g.name = f; root.add(g);
  }
  const variants = new Map();
  root.updateMatrixWorld(true);      // quantized meshes carry their dequantizing scale in the node transform
  root.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry, m0 = o.material;
    const ud = m0.userData || {};
    const thin = ud.dow === 'rock' || DEV.has('nothin') ? 0 : markThin(o);
    const flags = { DOW_VLIGHT: !!(geo.attributes._ao && geo.attributes._sun), DOW_LMSUN: !!(ud.dowlm && m0.aoMap), DOW_SHORE: ud.dow === 'rock', DOW_SAND: ud.shore === 'sand',
      DOW_RIBS: /^sheds_(clad|roof)/.test(o.name), DOW_SLATS: /^sheds_shutter/.test(o.name), DOW_WINDOWS: /^town/.test(o.name), DOW_THIN: thin > 0 };
    // one material per lighting variant (a material shared by vertex-lit and texture-lit meshes is split)
    const vk = m0.uuid + JSON.stringify(flags);
    let m = variants.get(vk);
    if (!m) {
      m = [...variants.values()].some(v => v.userData.src === m0.uuid) ? m0.clone() : m0;
      m.userData = { ...ud, src: m0.uuid };
      // the sheds' broad faces are baked at a coarse density, where the occlusion bake bands; there it only shades corners
      if (m.aoMap) m.aoMapIntensity = DEV.has('noao') ? 0 : ud.aok ?? (/^sheds/.test(o.name) ? 0.45 : 1);
      patchMaterial(m, flags, U); variants.set(vk, m);
    }
    o.material = m;
    o.castShadow = !!ud.cast || /^(pier|lift|gantry|sub|finger)/.test(o.name);
    o.receiveShadow = true;
    o.frustumCulled = true;   // static geometry: bounding spheres stay valid under the floating origin
    geo.computeBoundingSphere();
    const mm = /^(rk_.+)_(A|B)$/.exec(o.name);
    if (mm) {
      const sc = o.matrixWorld.getMaxScaleOnAxis();
      const p = lodPairs.get(mm[1]) || { c: geo.boundingSphere.center.clone().applyMatrix4(o.matrixWorld), r: geo.boundingSphere.radius * sc };
      p[mm[2]] = o; lodPairs.set(mm[1], p);
    }
  });
  const near = opts.lodNear ?? NEAR_LOD, pairs = [...lodPairs.values()];
  // moored craft and buoys ride the swell (their node origin is their own centre)
  const movers = [];
  root.traverse(o => { if (o.isMesh && /^(craft_|buoy_)/.test(o.name)) movers.push({ o, p: o.position.clone(), buoy: o.name.startsWith('buoy'), len: o.name.includes('tug') ? 8 : o.name.includes('launch') ? 5 : 1.1 }); });
  root.userData = {
    PORT, uniforms: U,
    // Shore map for the sea: where structures and rock stand in the water. The port is drawn from the waterline
    // downwards, counting faces by which way they point (a ray that starts inside a closed solid leaves through
    // one more back face than front faces), then grown a little and blurred so foam can fade away from them. Call once after loading.
    shoreMap(renderer, cx = 2, cz = 96, size = 448, res = 2048) {
      const half = size / 2, cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.02, 40);
      cam.position.set(cx, 0, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, -1, cz); cam.updateMatrixWorld(true);
      const rtA = new THREE.WebGLRenderTarget(res, res, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
      const rtB = new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
      const rtC = new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      const count = new THREE.ShaderMaterial({ side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        vertexShader: 'void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(gl_FrontFacing ? -1.0 : 1.0); }' });
      const scene = new THREE.Scene(), parent = root.parent, vis = [];
      scene.add(root); scene.overrideMaterial = count;
      root.traverse(o => { if (o.isMesh) { vis.push([o, o.visible, o.frustumCulled]); o.visible = !/_A$/.test(o.name) && !/^(core_|land|beach|ground)/.test(o.name); o.frustumCulled = false; } });
      const old = renderer.getRenderTarget(), cc = new THREE.Color(); renderer.getClearColor(cc); const ca = renderer.getClearAlpha();
      renderer.setRenderTarget(rtA); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
      for (const [o, v, f] of vis) { o.visible = v; o.frustumCulled = f; }
      scene.remove(root); if (parent) parent.add(root);
      // threshold the count and flip v (the camera looks down with north up; the sea wants +z up); grow the solids by
      // 0.6 m so that piles and single stones count, then blur: the result falls off smoothly over about 2 m
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
        uniforms: { tIn: { value: rtA.texture }, uDir: { value: new THREE.Vector2(1 / res, 0) }, uMode: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `precision highp float; uniform sampler2D tIn; uniform vec2 uDir; uniform int uMode; varying vec2 vUv;
          void main(){
            float m = 0.0, acc = 0.0, w = 0.0;
            for (int i=-8;i<=8;i++){
              vec2 q = vUv+uDir*float(i); float v = texture2D(tIn, uMode == 0 ? vec2(q.x, 1.0-q.y) : q).r;
              if (uMode == 0) v = step(0.5, v);
              if (uMode < 2){ if (i >= -3 && i <= 3) m = max(m, v); }
              else { float k = exp(-float(i*i)/22.0); acc += v*k; w += k; }
            }
            gl_FragColor = vec4(vec3(uMode < 2 ? m : acc/w), 1.0);
          }` }));
      const qs = new THREE.Scene(), qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); qs.add(quad);
      const QU = quad.material.uniforms, step = (src, dst, mode, dx, dy) => { QU.tIn.value = src.texture; QU.uMode.value = mode; QU.uDir.value.set(dx / res, dy / res); renderer.setRenderTarget(dst); renderer.render(qs, qc); };
      const rtD = new THREE.WebGLRenderTarget(res, res, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
      step(rtA, rtB, 0, 1, 0); step(rtB, rtD, 1, 0, 1); step(rtD, rtB, 2, 1, 0); step(rtB, rtC, 2, 0, 1);
      rtD.dispose();
      renderer.setRenderTarget(old); renderer.setClearColor(cc, ca);
      rtA.dispose(); rtB.dispose(); count.dispose(); quad.material.dispose(); quad.geometry.dispose();
      rtC.texture.wrapS = rtC.texture.wrapT = THREE.ClampToEdgeWrapping;
      return { texture: rtC.texture, x: cx, z: cz, size };
    },
    // per frame: camera world position (stone LOD per chunk); film time and the ocean (craft and buoys afloat)
    update(cam, t, ocean) {
      for (const p of pairs) {
        const useA = !!p.A && p.c.distanceTo(cam) - p.r < near;
        if (p.A) p.A.visible = useA;
        if (p.B) p.B.visible = !useA;
      }
      if (!ocean || t === undefined) return;
      for (const m of movers) {
        const { x, z } = m.p, L = m.len, H = (a, b) => ocean.heightAt(a, b, t - 0.15);
        const h = (H(x, z) + H(x + L, z) + H(x - L, z)) / 3;
        const pitch = Math.atan2(H(x + L, z) - H(x - L, z), 2 * L) * 0.7, roll = Math.atan2(H(x, z + 1.5) - H(x, z - 1.5), 3) * (m.buoy ? 0.9 : 0.5);
        m.o.position.set(x, m.p.y + h * (m.buoy ? 0.95 : 0.8), z);
        m.o.rotation.set(-roll, 0, pitch);
      }
    },
  };
  return root;
}
