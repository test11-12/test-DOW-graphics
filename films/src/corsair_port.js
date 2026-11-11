// The harbour for "Three Corsairs", built in Blender from CC0 photoscans (films/blender/port.py) and loaded
// from assets/corsair/port_*.glb. A generic naval maintenance waterfront standing in for the facility at
// Bandar Abbas, not a survey of it: same layout and coordinates as the procedural port it replaces.
//
// Light baked in Blender for the film's fixed sun (az 80, el 16) rides along with each asset:
//   - stones and gravel carry per-vertex occlusion and sun visibility (_AO, _SUN attributes);
//   - structures carry an occlusion texture whose G channel is sun visibility (material extras: dowlm = 1).
// Here the sun visibility scales the direct light (static shadows at every range, where the engine's single
// shadow map only covers the shot's focus), and rock materials (extras: dow = 'rock') get the shoreline:
// wet dark stone and a weed film at the water, a salt-pale splash zone, dry bleached tops.
import * as THREE from 'three';
import { loadGLB, hasAsset } from '../engine/assets.js';

export const PORT = {
  quayY: 2.4, quayZ: -22, pier: { x0: -19, x1: -11, z1: 52, y: 2.6 }, lift: { x0: -8, x1: 4, z0: 2, z1: 40, y: 1.5 },
  sub: { x: -2, z0: 5.5, z1: 34.5, y: 3.32 }, finger: { x0: 4.6, x1: 7.2, z1: 44 },
  entrance: [[30, 176], [176, 108]],
  // waterline points the three boats run to
  hits: [[-2.2, 41.2], [8.4, 22.5], [-20.2, 26]],
};

const FILES = ['port_rocks', 'port_rocks_near', 'port_pier', 'port_gantry', 'port_yard'];
const NEAR_LOD = 150;   // m: stones within this range of the camera use the detailed version

const VERT_PARS = /* glsl */`
uniform vec3 uDowOrigin;
varying vec3 vDowW;
#ifdef DOW_VLIGHT
attribute float _ao; attribute float _sun;
varying vec2 vDowL;
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
    sh.vertexShader = defs + VERT_PARS + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = defs + FRAG_PARS + sh.fragmentShader
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_SURFACE + FRAG_SAND)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= dowSun;'))
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG_AO);
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}

// opts: { lodNear (m) }
export async function buildPort(pipe, opts = {}) {
  const root = new THREE.Group(); root.name = 'port';
  const S = pipe.shared;
  const U = { uDowOrigin: S.uOrigin, tDowDetail: S.tDetail, uDowK: { value: new THREE.Vector4(1, 1, 1, 0) } };
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
    const flags = { DOW_VLIGHT: !!(geo.attributes._ao && geo.attributes._sun), DOW_LMSUN: !!(ud.dowlm && m0.aoMap), DOW_SHORE: ud.dow === 'rock', DOW_SAND: ud.shore === 'sand' };
    // one material per lighting variant (a material shared by vertex-lit and texture-lit meshes is split)
    const vk = m0.uuid + JSON.stringify(flags);
    let m = variants.get(vk);
    if (!m) {
      m = [...variants.values()].some(v => v.userData.src === m0.uuid) ? m0.clone() : m0;
      m.userData = { ...ud, src: m0.uuid };
      if (m.aoMap) m.aoMapIntensity = ud.aok ?? 1;
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
