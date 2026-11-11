// Baked procedural terrain: a recipe (GLSL height + mask functions) is rendered once into height and
// mask textures (a detailed "near" map and a coarse "far" map). Geometry is a camera-centred polar grid
// with earth curvature that only writes depth; the lighting runs afterwards as one full-screen pass
// (deferred), so the expensive shader runs exactly once per pixel whatever the triangle density.
import * as THREE from 'three';
import { NOISE, DEPTH, FSQ_VERT } from './glsl.js';
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
  for (int i=0;i<72;i++){
    vec2 q = uv+dUV*t;
    if (q.x<0.0||q.y<0.0||q.x>1.0||q.y>1.0) break;
    float d = h+t*tanEl-texture2D(tH, q).r;
    s = min(s, 0.5+7.0*d/t);
    if (s <= 0.0) break;
    t *= 1.12;
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
  if (bn >= 1.0) return textureLod(tHNear, (w-uNear.xy)/uNear.z+0.5, log2(max(lodM/uNear.w,1.0))).r;
  float hf = textureLod(tHFar, (w-uFar.xy)/uFar.z+0.5, log2(max(lodM/uFar.w,1.0))).r;
  if (bn <= 0.0) return hf;
  return mix(hf, textureLod(tHNear, (w-uNear.xy)/uNear.z+0.5, log2(max(lodM/uNear.w,1.0))).r, bn);
}
`;

// depth-only geometry. Log depth is written per vertex (triangles are small) so early-Z stays enabled.
const TERRAIN_VERT = /* glsl */`
${TERRAIN_COMMON}
uniform float uYaw, uSector, logDepthBufFC; uniform vec3 uOrigin;
void main(){
  float az = uYaw+position.x*uSector; vec2 d = vec2(cos(az), sin(az)); float r = position.y;
  vec2 w = uOrigin.xz+d*r;
  float h = hLod(w, position.z);
  vec3 p = vec3(d.x*r, h-uOrigin.y-r*r/(2.0*${RG.toFixed(1)}), d.y*r);
  gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
  gl_Position.z = (log2(max(1e-6, 1.0+gl_Position.w))*logDepthBufFC-1.0)*gl_Position.w;
}`;
const TERRAIN_FRAG = /* glsl */`
void main(){ gl_FragColor = vec4(0.0); }   // alpha 0 marks "terrain here" for the shading pass
`;

// full-screen lighting pass: scene.rgb + terrain * (1 - scene.a)
const SHADE_FRAG = shade => /* glsl */`
precision highp float;
${NOISE}
${DEPTH}
${TERRAIN_COMMON}
uniform sampler2D tScene, tDepth, tM0Near, tM0Far, tM1Near, tM1Far, tDetail, tAmbient;
uniform mat4 uInvProj; uniform mat3 uCamRot;
uniform vec3 uOrigin, uSunDir, uSunGround; uniform float uTime, uPixAngle; uniform int uDebug; uniform vec2 uRes;
uniform vec2 uPhase[12]; uniform vec2 uScale[12];
uniform sampler2D tShadow; uniform mat4 uShadowMat; uniform vec3 uShadowK;   // enabled, texel size, softness (texels)
uniform sampler2D tSky; uniform float uMieG;
varying vec2 vUv;
// sky radiance in direction d, from the pipeline's sky-view table (for reflections off water and pavement)
vec3 skyRefl(vec3 d){
  d.y = max(d.y, 0.004); d = normalize(d);
  float el = asin(d.y), v = clamp(0.5+0.5*sqrt(el/1.5707963), 0.004, 0.996), u = atan(d.z, d.x)/6.2831853+0.5;
  float c = dot(d, uSunDir), g = uMieG, g2 = g*g;
  float pR = 0.0596831*(1.0+c*c), pM = 0.1193662*((1.0-g2)*(1.0+c*c))/((2.0+g2)*pow(max(1.0+g2-2.0*g*c, 1e-4), 1.5));
  return textureLod(tSky, vec2(u, v/3.0), 0.0).rgb*pR+textureLod(tSky, vec2(u, (v+1.0)/3.0), 0.0).rgb*min(pM, 6.0)+textureLod(tSky, vec2(u, (v+2.0)/3.0), 0.0).rgb;
}
vec3 vRel; vec2 gGx, gGy;     // camera-relative position (m) and ground-footprint axes (km) of this pixel
// shadow of the hero objects (the sun's shadow map rendered with the scene pass) falling on the ground
float heroShadow(vec3 P){
  if (uShadowK.x < 0.5) return 1.0;
  vec4 s4 = uShadowMat*vec4(P, 1.0); vec3 s = s4.xyz/s4.w;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0 || s.z <= 0.0) return 1.0;
  float acc = 0.0;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
    float dz = dot(texture2D(tShadow, s.xy+vec2(float(i),float(j))*uShadowK.y*uShadowK.z), vec4(5.9371964e-8, 1.5199223e-5, 3.8910506e-3, 0.99609375));
    acc += step(s.z-0.0012, dz);
  }
  return acc/9.0;
}
// detail-texture coordinates for scale slot i, anchored with a double-precision phase so they stay stable
// right under the camera
vec2 duv(int i){ return vRel.xz*0.001*uScale[i]+uPhase[i]; }
// anisotropically filtered detail lookup for slot i with explicit gradients (safe at depth edges)
vec4 dtex(vec2 uv, int i){ return textureGrad(tDetail, uv, gGx*uScale[i], gGy*uScale[i]); }
float terrainSunShadow(vec2 wxz, float h);   // optional hook (cloud shadows); default defined below
${shade}
#ifndef TERRAIN_SHADOW_HOOK
float terrainSunShadow(vec2 wxz, float h){ return 1.0; }
#endif
void main(){
  vec4 sc = texture2D(tScene, vUv);
  float cov = 1.0-sc.a;
  if (cov <= 0.004){ gl_FragColor = vec4(sc.rgb, 1.0); return; }
  float d = texture2D(tDepth, vUv).x;
  if (cov < 0.996 || d >= 0.999999){ // silhouette pixel: use the farthest non-sky neighbour as the ground depth
    vec2 t = 1.0/uRes; float m = d >= 0.999999 ? 0.0 : d, q;
    q = texture2D(tDepth, vUv+vec2(t.x,0.0)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv-vec2(t.x,0.0)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv+vec2(0.0,t.y)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv-vec2(0.0,t.y)).x; if (q < 0.999999) m = max(m,q);
    d = m;
  }
  vec4 q4 = uInvProj*vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 vd = normalize(q4.xyz/q4.w);
  vec3 rd = normalize(uCamRot*vd);
  float dist = viewZ(d)/max(-vd.z, 1e-4);
  vRel = rd*dist;
  vec2 w = uOrigin.xz+vRel.xz;
  vec3 V = -rd;
  float bn = nearW(w);
  // footprint of a pixel on the ground: across the view, and (stretched) along it
  float across = max(dist*uPixAngle, 0.002), stretch = min(1.0/max(V.y,0.02), 12.0);
  vec2 fw = normalize(rd.xz+1e-6);
  gGx = vec2(-fw.y, fw.x)*across*0.001; gGy = fw*across*min(stretch, 5.0)*0.001;
  float fp = across*min(stretch, 5.0);
  float tex = mix(uFar.w, uNear.w, bn);
  float e = max(fp, tex);
  float h0 = hLod(w, e);
  float hE = hLod(w+vec2(e,0.0), e), hW = hLod(w-vec2(e,0.0), e), hS = hLod(w+vec2(0.0,e), e), hN = hLod(w-vec2(0.0,e), e);
  float lap = (hE+hW+hS+hN-4.0*h0)/(e*e);
  vec3 N = normalize(vec3(-(hE-hW)/(2.0*e), 1.0, -(hS-hN)/(2.0*e)));
  vec2 un = (w-uNear.xy)/uNear.z+0.5, uf = (w-uFar.xy)/uFar.z+0.5;
  float ln = log2(max(fp/uNear.w, 1.0)), lf = log2(max(fp/uFar.w, 1.0));
  vec4 m0, m1;
  if (bn >= 1.0){ m0 = textureLod(tM0Near, un, ln); m1 = textureLod(tM1Near, un, ln); }
  else if (bn <= 0.0){ m0 = textureLod(tM0Far, uf, lf); m1 = textureLod(tM1Far, uf, lf); }
  else { m0 = mix(textureLod(tM0Far, uf, lf), textureLod(tM0Near, un, ln), bn); m1 = mix(textureLod(tM1Far, uf, lf), textureLod(tM1Near, un, ln), bn); }
  vec3 alb; float spec = 0.0;
  shadeTerrain(w*0.001, h0, N, lap, m0, m1, fp, dist, alb, spec);
  N = normalize(N);
  float nl = max(dot(N, uSunDir), 0.0);
  // Oren-Nayar-ish dusty response: flatter, brighter towards grazing light
  float nv = max(dot(N, V), 0.0);
  float s = dot(uSunDir, V)-nl*nv; float tt = s>0.0 ? max(nl,nv) : 1.0;
  float on = nl*(0.84+0.30*s/max(tt,0.05));
  float sh = m0.a*terrainSunShadow(w, h0)*heroShadow(vRel+vec3(0.0, 0.04, 0.0));
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  float ao = clamp(1.0+lap*30.0, 0.55, 1.0);
  vec3 col = alb*0.3183*(uSunGround*max(on,0.0)*sh + amb*ao*(0.55+0.45*N.y));
  { // dry-ground sheen towards the sun at grazing angles
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0);
    float fr = 0.03+0.97*pow(1.0-max(dot(V,Hh),0.0), 5.0);
    col += uSunGround*sh*nl*pow(nh, 12.0)*1.5*fr*0.35*(0.4+alb.g);
  }
  if (spec < 0.0){ // pavement: a broad glossy lobe towards a low sun, and the sky's sheen at grazing angles
    float k = -spec;
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0), vh = max(dot(V,Hh),0.0);
    float fr = 0.04+0.96*pow(1.0-vh, 5.0);
    float a2 = 0.05, dd = nh*nh*(a2-1.0)+1.0, D = a2/(3.14159*dd*dd);
    col += uSunGround*sh*D*fr*min(nl/(4.0*max(nv,0.02)*max(nl,0.02)+0.3), 2.0)*nl*k;
    float fs = pow(1.0-nv, 5.0);
    col = mix(col, skyRefl(reflect(-V, N)), fs*k*0.2);
  }
  if (spec > 0.0){ // open water: mirror of the sky + sun glitter
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0);
    float fr = 0.02+0.98*pow(1.0-nv, 5.0);
    col = mix(col, skyRefl(reflect(-V, N))*fr+alb*0.02, spec);
    col += spec*uSunGround*pow(nh, 900.0)*40.0*sh;
  }
  if (uDebug == 1) col = vec3(sh);
  else if (uDebug == 2) col = N.xzy*0.5+0.5;
  else if (uDebug == 3) col = alb;
  gl_FragColor = vec4(sc.rgb+col*cov, 1.0);
}`;

function ringGeometry(cols, rings) {
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
// ring radii: spacing never finer than the far field needs (it grows with distance past ~35 km).
// q (0.4..1) coarsens the grid for small render targets, where the vertex work would otherwise dominate.
function ringsFor(preset, q = 1) {
  const out = []; let r;
  const lin = (to, step) => { while (r < to) { out.push(r); r += step / q; } };
  const geo = (to, k) => { const kk = 1 + (k - 1) / q; while (r < to) { out.push(r); r *= kk; } };
  const grow = (to, step, k) => { while (r < to) { out.push(r); r += Math.max(step, r * k) / q; } };
  if (preset === 'ground') { r = 0; out.push(0); r = 0.6; geo(5000, 1.07); grow(80000, 100, 0.0065); geo(520000, 1.06); }
  else if (preset === 'top') { r = 0; lin(24000, 70); geo(520000, 1.07); }
  else { r = 0; lin(4000, 125); grow(130000, 160, 0.006); geo(520000, 1.045); }
  out.push(r);
  return out;
}

export class Terrain {
  // recipe: { height: glsl (float terrainH(vec2 km, float lodKm)), mask: glsl (void terrainMask(...)), shade: glsl (void shadeTerrain(...)),
  //           scales: detail slots, near: {center:[xkm,zkm], extent km, res}, far: {center, extent, res}, groundAlt,
  //           uniforms: extra uniforms for the shading pass, defines: GLSL prepended to it }
  constructor(pipe, recipe) {
    this.pipe = pipe; this.recipe = recipe;
    const mk = (res, type, fmt, mip) => {
      const t = new THREE.WebGLRenderTarget(res, res, { type, format: fmt, depthBuffer: false, generateMipmaps: mip, minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter });
      t.texture.anisotropy = type === THREE.FloatType ? 1 : Math.min(4, pipe.maxAniso); return t;
    };
    const lvl = (cfg) => ({ cfg, h: mk(cfg.res, THREE.FloatType, THREE.RedFormat, true), m0: mk(cfg.res, THREE.UnsignedByteType, THREE.RGBAFormat, true), m1: mk(cfg.res, THREE.UnsignedByteType, THREE.RGBAFormat, true) });
    this.near = lvl(recipe.near); this.far = lvl(recipe.far);
    this.pH = new Pass(BAKE_H(recipe.height), { uCenter: { value: new THREE.Vector2() }, uExtent: { value: 1 }, uTexel: { value: 1 } });
    this.pM = new Pass(BAKE_M(recipe.height + '\n' + recipe.mask), { tH: { value: null }, uCenter: { value: new THREE.Vector2() }, uExtent: { value: 1 }, uTexel: { value: 1 }, uRes: { value: 1 }, uSunDir: pipe.atmo.uniforms.uSunDir, uWhich: { value: 0 } });
    const S = pipe.shared;
    const heights = { tHNear: { value: this.near.h.texture }, tHFar: { value: this.far.h.texture }, uNear: { value: new THREE.Vector4() }, uFar: { value: new THREE.Vector4() } };
    this.uniforms = {
      ...heights,
      tScene: { value: null }, tDepth: S.tDepth, uLogFar: S.uLogFar, uInvProj: S.uInvProj, uCamRot: S.uCamRot, uRes: S.uRes,
      tM0Near: { value: this.near.m0.texture }, tM0Far: { value: this.far.m0.texture },
      tM1Near: { value: this.near.m1.texture }, tM1Far: { value: this.far.m1.texture },
      tDetail: S.tDetail, tAmbient: S.tAmbient, uOrigin: S.uOrigin, uSunDir: S.uSunDir, uTime: S.uTime, tSky: S.tSky, uMieG: pipe.atmo.uniforms.uMieG,
      uSunGround: { value: new THREE.Color() }, uDebug: { value: 0 }, uPixAngle: { value: 0.001 },
      tShadow: { value: pipe.white }, uShadowMat: { value: new THREE.Matrix4() }, uShadowK: { value: new THREE.Vector3(0, 1 / 2048, 1.3) },
      uPhase: { value: Array.from({ length: 12 }, () => new THREE.Vector2()) },
      uScale: { value: Array.from({ length: 12 }, (_, i) => { const v = (recipe.scales || [])[i] ?? 1; return Array.isArray(v) ? new THREE.Vector2(v[0], v[1]) : new THREE.Vector2(v, v); }) },
      ...(recipe.uniforms || {}),
    };
    this.meshUniforms = { ...heights, uOrigin: S.uOrigin, uYaw: { value: 0 }, uSector: { value: Math.PI * 2 }, logDepthBufFC: { value: 2 / (Math.log(pipe.quality.far + 1) / Math.LN2) } };
    this.material = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: this.meshUniforms });
    this.shadePass = new Pass(SHADE_FRAG((recipe.defines || '') + recipe.shade), this.uniforms);
    this.geos = {};
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false; this.mesh.layers.set(LAYER.STATIC); this.mesh.matrixAutoUpdate = false;
    pipe.scene.add(this.mesh);
    pipe.deferred.push(this);
    this.bakedSun = new THREE.Vector3();
  }
  // deferred hook: called by the pipeline after the opaque scene pass
  shade(renderer, sceneTex, target) {
    if (!this.mesh.visible) return false;
    this.uniforms.tScene.value = sceneTex;
    const sh = this.pipe.sun.shadow, U = this.uniforms;
    if (this.pipe.sun.castShadow && sh.map && this.heroShadows !== false) { U.tShadow.value = sh.map.texture; U.uShadowMat.value.copy(sh.matrix); U.uShadowK.value.set(1, 1 / sh.mapSize.x, 1.3); }
    else U.uShadowK.value.x = 0;
    this.shadePass.render(renderer, target);
    return true;
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
    const pipe = this.pipe, cam = pipe.camera, mu = this.meshUniforms;
    this.bake();
    const full = preset === 'top';
    // grid density follows the render size: about one column per 3.4 px, rings to match
    const q = Math.min(1, Math.max(0.4, pipe.h / 1080)), cols = Math.round((full ? 768 : (preset === 'ground' ? 560 : 448)) * Math.min(1, Math.max(0.35, pipe.w / 1920)) / 8) * 8, gk = `${preset}:${cols}:${q.toFixed(2)}`;
    if (!this.geos[gk]) this.geos[gk] = ringGeometry(cols, ringsFor(preset, q));
    this.mesh.geometry = this.geos[gk];
    pipe.atmo.sunIrradiance(this.recipe.groundAlt ?? 1400, this.uniforms.uSunGround.value);
    this.uniforms.uPixAngle.value = 2 * Math.tan(cam.fov * Math.PI / 360) / pipe.h;
    mu.logDepthBufFC.value = 2 / (Math.log(cam.far + 1) / Math.LN2);
    const sc = this.uniforms.uScale.value, ph = this.uniforms.uPhase.value, o = pipe.origin;
    for (let i = 0; i < 12; i++) { const ax = o.x * 0.001 * sc[i].x, az = o.z * 0.001 * sc[i].y; ph[i].set(ax - Math.floor(ax), az - Math.floor(az)); }
    if (full) { mu.uYaw.value = 0; mu.uSector.value = Math.PI * 2; return; }
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
    if (steep || hi - lo > 2.6 || Math.hypot(f.x, f.z) < 0.25) { mu.uYaw.value = 0; mu.uSector.value = Math.PI * 2; }
    else { const half = Math.max(-lo, hi) * 1.12 + 0.03; mu.uYaw.value = yaw; mu.uSector.value = half * 2; }
  }
}
