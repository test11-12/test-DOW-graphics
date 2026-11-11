// Baked procedural terrain: a recipe (GLSL height + mask functions) is rendered once into height and
// mask textures (a detailed "near" map and a coarse "far" map), then drawn as a camera-centred polar
// grid with earth curvature. Shading is per-pixel from the textures, so the grid can move freely.
import * as THREE from 'three';
import { NOISE, FSQ_VERT } from './glsl.js';
import { Pass, LAYER, RG } from './pipeline.js';

// Slope-following erosion noise (after Fewes / Clay John): gullies and spurs that run down the fall line.
export const EROSION = /* glsl */`
vec3 erosionK(vec2 p, vec2 dir){
  vec2 ip = floor(p), fp = fract(p); vec3 va = vec3(0.0); float wt = 0.0;
  for (int i=-2;i<=1;i++) for (int j=-2;j<=1;j++){
    vec2 o = vec2(float(i), float(j));
    vec2 pp = fp+o-hash22(ip-o)*0.5;
    float w = exp(-dot(pp,pp)*2.0); wt += w;
    float mag = dot(pp,dir)*6.2831853;
    va += vec3(cos(mag), -sin(mag)*dir)*w;
  }
  return va/wt;
}
// p: position in erosion cells, slope: gradient of the macro shape. Returns x: 0..1 (0 = gully floor, 1 = spur crest)
float erosion(vec2 p, vec2 slope, float branch, int oct, float lodCells){
  vec2 dir = slope.yx*vec2(1.0,-1.0);
  vec3 h = vec3(0.0); float a = 0.5, f = 1.0, tot = 0.0;
  for (int i=0;i<6;i++){
    if (i>=oct || f*lodCells > 0.5) break;
    h += erosionK(p*f, dir+h.zy*vec2(1.0,-1.0)*branch)*a*vec3(1.0,f,f);
    tot += a; a *= 0.5; f *= 2.0;
  }
  return tot > 0.0 ? 0.5+0.5*h.x/tot : 0.5;
}
`;

const BAKE_H = recipe => /* glsl */`
precision highp float;
${NOISE}
${EROSION}
uniform vec2 uCenter; uniform float uExtent, uTexel;   // km
varying vec2 vUv;
${recipe}
void main(){
  vec2 p = uCenter+(vUv-0.5)*uExtent;
  gl_FragColor = vec4(terrainH(p, uTexel), 0.0, 0.0, 1.0);
}`;

const BAKE_M = recipe => /* glsl */`
precision highp float;
${NOISE}
${EROSION}
uniform sampler2D tH; uniform vec2 uCenter; uniform float uExtent, uTexel, uRes; uniform vec3 uSunDir; uniform int uWhich;
varying vec2 vUv;
${recipe}
float shadow(vec2 uv, float h){
  vec2 hd = uSunDir.xz; float hl = length(hd);
  if (hl < 1e-4) return 1.0;
  float tanEl = uSunDir.y/hl; vec2 dUV = hd/hl/(uExtent*1000.0);
  float s = 1.0, t = uTexel*1000.0*1.5;
  for (int i=0;i<56;i++){
    vec2 q = uv+dUV*t;
    if (q.x<0.0||q.y<0.0||q.x>1.0||q.y>1.0) break;
    float d = h+t*tanEl-texture2D(tH, q).r;
    s = min(s, 0.5+7.0*d/t);
    if (s <= 0.0) break;
    t *= 1.13;
  }
  return clamp(s, 0.0, 1.0);
}
void main(){
  vec2 p = uCenter+(vUv-0.5)*uExtent;
  float e = 1.0/uRes;
  float h = texture2D(tH, vUv).r;
  float hx = texture2D(tH, vUv+vec2(e,0)).r-texture2D(tH, vUv-vec2(e,0)).r;
  float hz = texture2D(tH, vUv+vec2(0,e)).r-texture2D(tH, vUv-vec2(0,e)).r;
  vec2 grad = vec2(hx,hz)/(2.0*uTexel*1000.0);
  vec4 m0, m1; terrainMask(p, h, grad, uTexel, m0, m1);
  if (uWhich == 0) gl_FragColor = vec4(m0.rgb, shadow(vUv, h));
  else gl_FragColor = m1;
}`;

const TERRAIN_COMMON = /* glsl */`
uniform sampler2D tHNear, tHFar;
uniform vec4 uNear, uFar;     // centre.xz (m), extent (m), texel (m)
float nearW(vec2 w){ vec2 u = abs((w-uNear.xy)/uNear.z); return smoothstep(0.495, 0.44, max(u.x,u.y)); }
float hLod(vec2 w, float lodM){
  float bn = nearW(w);
  float hf = textureLod(tHFar, (w-uFar.xy)/uFar.z+0.5, log2(max(lodM/uFar.w,1.0))).r;
  if (bn <= 0.0) return hf;
  float hn = textureLod(tHNear, (w-uNear.xy)/uNear.z+0.5, log2(max(lodM/uNear.w,1.0))).r;
  return mix(hf, hn, bn);
}
`;

const TERRAIN_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
${TERRAIN_COMMON}
uniform float uYaw, uSector; uniform vec3 uOrigin;
varying vec3 vWorld; varying vec3 vRel;
void main(){
  float az = uYaw+position.x*uSector; vec2 d = vec2(cos(az), sin(az)); float r = position.y;
  vec2 w = uOrigin.xz+d*r;
  float h = hLod(w, position.z);
  vec3 p = vec3(d.x*r, h-uOrigin.y-r*r/(2.0*${RG.toFixed(1)}), d.y*r);
  vWorld = vec3(w.x, h, w.y); vRel = p;
  gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
  #include <logdepthbuf_vertex>
}`;

const TERRAIN_FRAG = shade => /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
${TERRAIN_COMMON}
uniform sampler2D tM0Near, tM0Far, tM1Near, tM1Far, tDetail, tAmbient;
uniform vec3 uOrigin, uSunDir, uSunGround; uniform float uTime, uPixAngle; uniform int uDebug;
uniform vec2 uPhase[12]; uniform vec2 uScale[12];
varying vec3 vWorld; varying vec3 vRel;
// detail-texture coordinates for scale slot i, anchored with a double-precision phase so they stay
// stable right under the camera
vec2 duv(int i){ return vRel.xz*0.001*uScale[i]+uPhase[i]; }
${shade}
void main(){
  #include <logdepthbuf_fragment>
  vec2 w = vWorld.xz;
  float dist = length(vRel);
  vec3 V = -vRel/dist;
  float bn = nearW(w);
  // footprint of a pixel on the ground (m) -> finite-difference step and LOD
  float fp = max(dist*uPixAngle*min(1.0/max(V.y,0.02), 5.0), 0.002);
  float tex = mix(uFar.w, uNear.w, bn);
  float e = max(fp, tex);
  float h0 = hLod(w, e);
  float hx = hLod(w+vec2(e,0.0), e)-hLod(w-vec2(e,0.0), e);
  float hz = hLod(w+vec2(0.0,e), e)-hLod(w-vec2(0.0,e), e);
  float lap = (hLod(w+vec2(e,0.0), e)+hLod(w-vec2(e,0.0), e)+hLod(w+vec2(0.0,e), e)+hLod(w-vec2(0.0,e), e)-4.0*h0)/(e*e);
  vec3 N = normalize(vec3(-hx/(2.0*e), 1.0, -hz/(2.0*e)));
  vec2 un = (w-uNear.xy)/uNear.z+0.5, uf = (w-uFar.xy)/uFar.z+0.5;
  vec4 m0 = mix(texture2D(tM0Far, uf), texture2D(tM0Near, un), bn);
  vec4 m1 = mix(texture2D(tM1Far, uf), texture2D(tM1Near, un), bn);
  vec3 alb; float spec = 0.0;
  shadeTerrain(w*0.001, h0, N, lap, m0, m1, fp, dist, alb, spec);
  N = normalize(N);
  float nl = max(dot(N, uSunDir), 0.0);
  // Oren-Nayar-ish dusty response: flatter, brighter towards grazing light
  float nv = max(dot(N, V), 0.0);
  float s = dot(uSunDir, V)-nl*nv; float tt = s>0.0 ? max(nl,nv) : 1.0;
  float on = nl*(0.84+0.30*s/max(tt,0.05));
  float sh = m0.a;
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  float ao = clamp(1.0+lap*30.0, 0.55, 1.0);
  vec3 col = alb*0.3183*(uSunGround*max(on,0.0)*sh + amb*ao*(0.55+0.45*N.y));
  { // dry-ground sheen towards the sun at grazing angles
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0);
    float fr = 0.03+0.97*pow(1.0-max(dot(V,Hh),0.0), 5.0);
    col += uSunGround*sh*nl*pow(nh, 22.0)*3.6*fr*0.35*(0.4+alb.g);
  }
  if (spec > 0.0){ // open water: sky mirror + sun glitter
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0);
    float fr = 0.02+0.98*pow(1.0-nv, 5.0);
    col = mix(col, amb*0.3183*1.4*fr+alb*0.02, spec);
    col += spec*uSunGround*pow(nh, 900.0)*40.0*sh;
  }
  if (uDebug == 1) col = vec3(sh);
  else if (uDebug == 2) col = N.xzy*0.5+0.5;
  else if (uDebug == 3) col = alb;
  else if (uDebug == 4) col = uSunGround*0.05;
  else if (uDebug == 5) col = amb*0.2;
  else if (uDebug == 6) col = vec3(max(on,0.0));
  gl_FragColor = vec4(col, 1.0);
}`;

function ringGeometry(cols, rings, full) {
  const nv = (cols + 1) * rings.length;
  const pos = new Float32Array(nv * 3);
  let k = 0;
  for (let j = 0; j < rings.length; j++) {
    const r = rings[j], sp = j === 0 ? rings[1] - rings[0] : r - rings[j - 1];
    for (let i = 0; i <= cols; i++) { pos[k++] = i / cols - 0.5; pos[k++] = r; pos[k++] = sp; }
  }
  const idx = new Uint32Array(cols * (rings.length - 1) * 6);
  k = 0;
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}
function ringsFor(preset) {
  const out = []; let r;
  const lin = (to, step) => { while (r < to) { out.push(r); r += step; } };
  const geo = (to, k) => { while (r < to) { out.push(r); r *= k; } };
  if (preset === 'ground') { r = 0; out.push(0); r = 0.6; geo(6000, 1.045); lin(72000, 70); geo(520000, 1.05); }
  else if (preset === 'top') { r = 0; lin(26000, 55); geo(520000, 1.06); }
  else { r = 0; lin(4000, 100); lin(110000, 140); geo(520000, 1.035); }
  out.push(r);
  return out;
}

export class Terrain {
  // recipe: { height: glsl (float terrainH(vec2 km, float lodKm)), mask: glsl (void terrainMask(...)), shade: glsl (void shadeTerrain(...)),
  //           near: {center:[xkm,zkm], extent km, res}, far: {center, extent, res}, groundAlt }
  constructor(pipe, recipe) {
    this.pipe = pipe; this.recipe = recipe;
    const r = pipe.renderer;
    const mk = (res, type, fmt, mip) => {
      const t = new THREE.WebGLRenderTarget(res, res, { type, format: fmt, depthBuffer: false, generateMipmaps: mip, minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter });
      t.texture.anisotropy = Math.min(8, pipe.maxAniso); return t;
    };
    const lvl = (cfg) => ({ cfg, h: mk(cfg.res, THREE.FloatType, THREE.RedFormat, true), m0: mk(cfg.res, THREE.UnsignedByteType, THREE.RGBAFormat, true), m1: mk(cfg.res, THREE.UnsignedByteType, THREE.RGBAFormat, true) });
    this.near = lvl(recipe.near); this.far = lvl(recipe.far);
    this.pH = new Pass(BAKE_H(recipe.height), { uCenter: { value: new THREE.Vector2() }, uExtent: { value: 1 }, uTexel: { value: 1 } });
    this.pM = new Pass(BAKE_M(recipe.height + '\n' + recipe.mask), { tH: { value: null }, uCenter: { value: new THREE.Vector2() }, uExtent: { value: 1 }, uTexel: { value: 1 }, uRes: { value: 1 }, uSunDir: pipe.atmo.uniforms.uSunDir, uWhich: { value: 0 } });
    const S = pipe.shared;
    this.uniforms = {
      tHNear: { value: this.near.h.texture }, tHFar: { value: this.far.h.texture },
      tM0Near: { value: this.near.m0.texture }, tM0Far: { value: this.far.m0.texture },
      tM1Near: { value: this.near.m1.texture }, tM1Far: { value: this.far.m1.texture },
      uNear: { value: new THREE.Vector4() }, uFar: { value: new THREE.Vector4() },
      tDetail: S.tDetail, tAmbient: S.tAmbient, uOrigin: S.uOrigin, uSunDir: S.uSunDir, uTime: S.uTime,
      uSunGround: { value: new THREE.Color() }, uDebug: { value: 0 }, uPixAngle: { value: 0.001 },
      uPhase: { value: Array.from({ length: 12 }, () => new THREE.Vector2()) },
      uScale: { value: Array.from({ length: 12 }, (_, i) => { const v = (recipe.scales || [])[i] ?? 1; return Array.isArray(v) ? new THREE.Vector2(v[0], v[1]) : new THREE.Vector2(v, v); }) }, uYaw: { value: 0 }, uSector: { value: Math.PI * 2 },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG(recipe.shade), uniforms: this.uniforms });
    this.material.extensions.derivatives = true;
    this.geos = {};
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false; this.mesh.layers.set(LAYER.STATIC); this.mesh.matrixAutoUpdate = false;
    pipe.scene.add(this.mesh);
    this.bakedSun = new THREE.Vector3();
  }
  bakeLevel(L, masksOnly) {
    const r = this.pipe.renderer, c = L.cfg, tex = c.extent / c.res;
    if (!masksOnly) {
      const u = this.pH.u; u.uCenter.value.set(c.center[0], c.center[1]); u.uExtent.value = c.extent; u.uTexel.value = tex;
      this.pH.render(r, L.h);
    }
    const m = this.pM.u; m.tH.value = L.h.texture; m.uCenter.value.set(c.center[0], c.center[1]); m.uExtent.value = c.extent; m.uTexel.value = tex; m.uRes.value = c.res;
    m.uWhich.value = 0; this.pM.render(r, L.m0);
    m.uWhich.value = 1; this.pM.render(r, L.m1);
    const U = L === this.near ? this.uniforms.uNear : this.uniforms.uFar;
    U.value.set(c.center[0] * 1000, c.center[1] * 1000, c.extent * 1000, tex * 1000);
  }
  // (re)bake; cheap to call every frame — only re-renders the sun-dependent masks when the sun has moved
  bake() {
    const sun = this.pipe.atmo.sunDir;
    if (!this.baked) { this.bakeLevel(this.far, false); this.bakeLevel(this.near, false); this.baked = true; this.bakedSun.copy(sun); this.pipe.renderer.setRenderTarget(null); return; }
    if (this.bakedSun.distanceTo(sun) > 0.004) { this.bakeLevel(this.far, true); this.bakeLevel(this.near, true); this.bakedSun.copy(sun); this.pipe.renderer.setRenderTarget(null); }
  }
  // preset: 'air' | 'ground' | 'top'
  update(preset = 'air') {
    const pipe = this.pipe, cam = pipe.camera;
    this.bake();
    const full = preset === 'top';
    const key = preset;
    if (!this.geos[key]) this.geos[key] = ringGeometry(full ? 1024 : 640, ringsFor(preset), full);
    this.mesh.geometry = this.geos[key];
    pipe.atmo.sunIrradiance(this.recipe.groundAlt ?? 1400, this.uniforms.uSunGround.value);
    this.uniforms.uPixAngle.value = 2 * Math.tan(cam.fov * Math.PI / 360) / pipe.h;
    const sc = this.uniforms.uScale.value, ph = this.uniforms.uPhase.value, o = pipe.origin;
    for (let i = 0; i < 12; i++) { const ax = o.x * 0.001 * sc[i].x, az = o.z * 0.001 * sc[i].y; ph[i].set(ax - Math.floor(ax), az - Math.floor(az)); }
    if (full) { this.uniforms.uYaw.value = 0; this.uniforms.uSector.value = Math.PI * 2; return; }
    // azimuth sector covering the view frustum
    cam.updateMatrixWorld();
    const f = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    const yaw = Math.atan2(f.z, f.x);
    const t = Math.tan(cam.fov * Math.PI / 360), a = cam.aspect;
    let lo = 0, hi = 0, steep = false;
    const v = new THREE.Vector3();
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      v.set(x * t * a, y * t, -1).normalize().transformDirection(cam.matrixWorld);
      if (Math.hypot(v.x, v.z) < 0.12) { steep = true; continue; }
      let d = Math.atan2(v.z, v.x) - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      lo = Math.min(lo, d); hi = Math.max(hi, d);
    }
    if (steep || hi - lo > 2.6 || Math.hypot(f.x, f.z) < 0.25) { this.uniforms.uYaw.value = 0; this.uniforms.uSector.value = Math.PI * 2; }
    else { const half = Math.max(-lo, hi) * 1.12 + 0.03; this.uniforms.uYaw.value = yaw; this.uniforms.uSector.value = half * 2; }
  }
}
