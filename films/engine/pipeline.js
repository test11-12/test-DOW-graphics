// HDR render pipeline: scene (MSAA, log depth) -> atmosphere/sky -> FX -> distortion -> motion blur -> bloom -> grade.
import * as THREE from 'three';
import { NOISE, ATMOSPHERE, DEPTH, FSQ_VERT } from './glsl.js';

export const LAYER = { STATIC: 0, DYNAMIC: 1, FX: 2, DISTORT: 3 };
export const RG = 6360000;
const H_R = 8000, BETA_R = [5.802e-6, 13.558e-6, 33.1e-6], BETA_M_E = 4.44e-6, BETA_O = [0.650e-6, 1.881e-6, 0.085e-6];

const fsGeo = new THREE.BufferGeometry();
fsGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
fsGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class Pass {
  constructor(fragmentShader, uniforms = {}, opts = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: FSQ_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...opts,
    });
    this.mesh = new THREE.Mesh(fsGeo, this.material);
    this.mesh.frustumCulled = false;
    this.u = this.material.uniforms;
  }
  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.mesh, fsCam);
  }
}

function odExp(r, mu, H) {
  const c = Math.sqrt(1.5707963 * r / H), e = Math.exp(-(r - RG) / H);
  if (mu >= 0) return H * e * c / ((c - 1) * mu + 1);
  const r0 = r * Math.sqrt(Math.max(0, 1 - mu * mu));
  if (r0 < RG - 200) return 1e9;
  const c0 = Math.sqrt(1.5707963 * r0 / H), e0 = Math.exp(-(r0 - RG) / H);
  return H * (2 * e0 * c0 - e * c / ((c - 1) * (-mu) + 1));
}

// ---------------------------------------------------------------- atmosphere state
export class Atmosphere {
  constructor() {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
      uSunE: { value: new THREE.Vector3(20, 19.4, 18.8) },
      uHaze: { value: 1.0 }, uHazeH: { value: 1200 }, uMieG: { value: 0.78 }, uMS: { value: 1.0 },
    };
    this.groundAlbedo = new THREE.Color(0.3, 0.25, 0.2);
  }
  get sunDir() { return this.uniforms.uSunDir.value; }
  // sun direction from azimuth (deg clockwise from north) and elevation (deg)
  setSun(azDeg, elDeg) {
    const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }
  // direct sun irradiance (linear RGB) reaching altitude `alt`
  sunIrradiance(alt, out = new THREE.Color()) {
    const u = this.uniforms, r = RG + Math.max(alt, 0), mu = this.sunDir.y;
    const oR = odExp(r, mu, H_R), oM = odExp(r, mu, u.uHazeH.value) * u.uHaze.value;
    const ro = RG + 25000, s2 = (r * r) / (ro * ro) * (1 - mu * mu), oO = 15000 / Math.sqrt(Math.max(1 - s2, 0.004));
    const E = u.uSunE.value;
    out.r = E.x * Math.exp(-(BETA_R[0] * oR + BETA_M_E * oM + BETA_O[0] * oO));
    out.g = E.y * Math.exp(-(BETA_R[1] * oR + BETA_M_E * oM + BETA_O[1] * oO));
    out.b = E.z * Math.exp(-(BETA_R[2] * oR + BETA_M_E * oM + BETA_O[2] * oO));
    return out;
  }
}

// ---------------------------------------------------------------- shaders
const SKY_LUT_FRAG = /* glsl */`
precision highp float;
${ATMOSPHERE}
uniform float uCamAlt; uniform vec3 uGroundAlb;
varying vec2 vUv;
void main(){
  float tile = floor(vUv.y*3.0);
  vec2 uv = vec2(vUv.x, fract(vUv.y*3.0));
  vec3 rd = skyDir(uv);
  vec3 ro = vec3(0.0, RG+uCamAlt, 0.0);
  float b = dot(ro,rd), c = dot(ro,ro)-RG*RG, disc = b*b-c;
  float tG = (disc>0.0 && b<0.0) ? (-b-sqrt(disc)) : -1.0;
  vec3 LR, LM, LMS, T;
  atmoIntegrate(ro, rd, tG>0.0 ? tG : 1.0e9, 0.5, 32, LR, LM, LMS, T);
  if (tG>0.0){ // virtual ground beyond any rendered geometry
    vec3 p = ro+rd*tG; float mu = max(dot(normalize(p), uSunDir), 0.0);
    vec3 E = uSunE*exp(-sunTau(RG, mu))*mu + uSunE*0.06*smoothstep(-0.1,0.2,uSunDir.y);
    LMS += T*uGroundAlb*E*0.3183;
  }
  vec3 o = tile<0.5 ? LR : (tile<1.5 ? LM : LMS);
  gl_FragColor = vec4(o, 1.0);
}`;

// hemisphere irradiance from the sky LUT -> 1x1 target, sampled by terrain/water shaders
const AMBIENT_FRAG = /* glsl */`
precision highp float;
${ATMOSPHERE}
uniform sampler2D tSky;
varying vec2 vUv;
vec3 skyL(vec3 d){
  vec2 uv = skyUV(d); float v = clamp(uv.y, 0.004, 0.996);
  float cv = dot(d, uSunDir);
  return texture2D(tSky, vec2(uv.x,(v+0.0)/3.0)).rgb*phaseR(cv)
       + texture2D(tSky, vec2(uv.x,(v+1.0)/3.0)).rgb*min(phaseM(cv), 2.0)
       + texture2D(tSky, vec2(uv.x,(v+2.0)/3.0)).rgb;
}
void main(){
  vec3 E = vec3(0.0);
  for (int i=0;i<16;i++) for (int j=0;j<8;j++){
    float az = (float(i)+0.5)/16.0*6.2831853, ct = (float(j)+0.5)/8.0, st = sqrt(1.0-ct*ct);
    E += skyL(vec3(st*cos(az), ct, st*sin(az)))*ct;
  }
  E *= 6.2831853/128.0;
  E = mix(E, vec3(dot(E, vec3(0.25,0.6,0.15))), 0.34);
  gl_FragColor = vec4(E, 1.0);
}`;

const ENV_FRAG = /* glsl */`
precision highp float;
${ATMOSPHERE}
uniform float uCamAlt; uniform vec3 uGroundAlb;
varying vec3 vDir;
void main(){
  vec3 rd = normalize(vDir);
  vec3 ro = vec3(0.0, RG+uCamAlt, 0.0);
  float b = dot(ro,rd), c = dot(ro,ro)-RG*RG, disc = b*b-c;
  float tG = (disc>0.0 && b<0.0) ? (-b-sqrt(disc)) : -1.0;
  vec3 LR, LM, LMS, T;
  atmoIntegrate(ro, rd, tG>0.0 ? tG : 1.0e9, 0.5, 14, LR, LM, LMS, T);
  float cv = dot(rd,uSunDir);
  vec3 col = LR*phaseR(cv)+LM*min(phaseM(cv),1.5)+LMS;
  if (tG>0.0){
    vec3 p = ro+rd*tG; float mu = max(dot(normalize(p), uSunDir), 0.0);
    vec3 E = uSunE*exp(-sunTau(RG, mu))*mu + uSunE*0.06*smoothstep(-0.1,0.2,uSunDir.y);
    col += T*uGroundAlb*E*0.3183;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMO_FRAG = /* glsl */`
precision highp float;
${NOISE}
${ATMOSPHERE}
${DEPTH}
uniform sampler2D tScene, tDepth, tSky, tDetail, tAmbient;
uniform mat4 uInvProj; uniform mat3 uCamRot;
uniform float uCamAlt, uFrame, uSunDisk, uAerial;
uniform vec3 uOrigin;
uniform vec4 uCirrus;   // altitude (m), coverage 0..1, opacity, scale (km)
uniform vec2 uCirrusWind;
varying vec2 vUv;

vec3 skyLut(vec3 d, float cv){
  vec2 uv = skyUV(d); float v = clamp(uv.y, 0.004, 0.996);
  return texture2D(tSky, vec2(uv.x,(v+0.0)/3.0)).rgb*phaseR(cv)
       + texture2D(tSky, vec2(uv.x,(v+1.0)/3.0)).rgb*phaseM(cv)
       + texture2D(tSky, vec2(uv.x,(v+2.0)/3.0)).rgb;
}
// thin high cloud sheet on a spherical shell
vec4 cirrus(vec3 ro, vec3 rd, float cv, out float tHit){
  tHit = -1.0;
  if (uCirrus.z <= 0.0) return vec4(0.0);
  float R = RG+uCirrus.x;
  float b = dot(ro,rd), c = dot(ro,ro)-R*R, disc = b*b-c;
  if (disc <= 0.0) return vec4(0.0);
  float s = sqrt(disc);
  float t = (c < 0.0) ? (-b+s) : (-b-s);     // inside shell: exit point; outside: entry point
  if (t <= 0.0) return vec4(0.0);
  vec3 p = ro+rd*t;
  vec2 q = (p.xz+uOrigin.xz)/1000.0/uCirrus.w + uCirrusWind;
  // fibrous streaks: anisotropic, domain-warped
  vec2 w = vec2(texture2D(tDetail, q*0.031).r, texture2D(tDetail, q*0.031+0.37).g)-0.5;
  vec2 qs = mat2(0.94,0.34,-0.34,0.94)*(q+w*1.6);
  float n = texture2D(tDetail, qs*vec2(0.021,0.085)).r*0.55
          + texture2D(tDetail, qs*vec2(0.055,0.23)+0.21).g*0.30
          + texture2D(tDetail, qs*vec2(0.17,0.51)+0.63).r*0.15;
  float big = texture2D(tDetail, q*0.0061+0.11).g;
  float cov = uCirrus.y*(0.35+1.3*big);
  float dens = smoothstep(1.0-cov, 1.0-cov+0.34, n);
  float cosI = abs(dot(normalize(p), rd));
  float a = 1.0-exp(-dens*uCirrus.z/max(cosI,0.07));
  a *= smoothstep(0.0, 0.035, cosI);
  float mu = dot(normalize(p), uSunDir);
  vec3 sun = uSunE*exp(-sunTau(R, mu));
  float g = 0.72; float hg = (1.0-g*g)/pow(1.0+g*g-2.0*g*cv, 1.5)*0.0796;
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  vec3 col = sun*(0.05+hg*0.85) + mix(amb, vec3(dot(amb, vec3(0.33))), 0.5)*0.11;
  tHit = t;
  return vec4(col, a);
}
void main(){
  vec4 sc = texture2D(tScene, vUv);
  float d = texture2D(tDepth, vUv).x;
  vec4 q = uInvProj*vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 vd = normalize(q.xyz/q.w);
  vec3 rd = normalize(uCamRot*vd);
  vec3 ro = vec3(0.0, RG+uCamAlt, 0.0);
  float cv = dot(rd, uSunDir);
  float dither = fract(ign(gl_FragCoord.xy)+uFrame*0.61803);
  vec3 col; vec3 T = vec3(0.0); vec3 I; float dist = 1.0e9;
  if (d >= 0.999999){
    I = skyLut(rd, cv);
    col = I;
    float cs = 0.9999892; // cos(0.00465)
    float disk = smoothstep(cs-0.0000035, cs+0.0000015, cv);
    if (disk > 0.0){
      vec3 Tv = exp(-sunTau(RG+uCamAlt, rd.y));
      float limb = 1.0-0.55*(1.0-sqrt(clamp((cv-cs)/(1.0-cs),0.0,1.0)));
      col += uSunE*14700.0*uSunDisk*Tv*disk*limb;
    }
    T = vec3(0.0);
  } else {
    dist = viewZ(d)/max(-vd.z, 1e-4);
    vec3 LR, LM, LMS;
    atmoIntegrate(ro, rd, dist, dither, 6, LR, LM, LMS, T);
    I = atmoCombine(LR, LM, LMS, cv)*uAerial;
    T = mix(vec3(1.0), T, uAerial);
    col = sc.rgb*T+I;
  }
  float tc; vec4 ci = cirrus(ro, rd, cv, tc);
  if (ci.a > 0.0 && tc < dist){
    // split the path at the cloud: f = share of the path's extinction in front of it
    float f = (dist > 9.0e8) ? clamp(1.0-exp(-tc/90000.0), 0.0, 1.0) : clamp(tc/dist, 0.0, 1.0);
    vec3 Tc = (dist > 9.0e8) ? exp(-(BETA_R*H_R*0.0+vec3(tc*2.0e-6))) : pow(max(T,vec3(1e-6)), vec3(f));
    vec3 Ic = I*f;
    vec3 behind = (col-Ic)/max(Tc, vec3(1e-4));
    col = mix(behind, ci.rgb, ci.a)*Tc+Ic;
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), sc.a);
}`;

const VEL_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform mat4 uPrevMVP;
varying vec4 vCur; varying vec4 vPrev;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  gl_Position = projectionMatrix*mv;
  vCur = gl_Position; vPrev = uPrevMVP*vec4(position,1.0);
  #include <logdepthbuf_vertex>
}`;
const VEL_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec4 vCur; varying vec4 vPrev;
void main(){
  #include <logdepthbuf_fragment>
  vec2 a = vCur.xy/vCur.w, b = vPrev.xy/vPrev.w;
  gl_FragColor = vec4((a-b)*0.5, 0.0, 1.0);
}`;

// full-screen velocity (uv units per frame) + view distance
const VELFULL_FRAG = /* glsl */`
precision highp float;
${DEPTH}
uniform sampler2D tDepth, tVel;
uniform mat4 uInvProj, uPrevVP; uniform mat3 uCamRot;
varying vec2 vUv;
void main(){
  float d = texture2D(tDepth, vUv).x;
  vec4 q = uInvProj*vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 vd = normalize(q.xyz/q.w);
  float dist = d >= 0.999999 ? 4.0e6 : viewZ(d)/max(-vd.z,1e-4);
  vec4 dv = texture2D(tVel, vUv);
  vec2 v;
  if (dv.a > 0.5) v = dv.xy;
  else {
    vec3 p = (uCamRot*vd)*dist;
    vec4 pc = uPrevVP*vec4(p,1.0);
    v = vUv-(pc.xy/pc.w*0.5+0.5);
    if (pc.w <= 0.0) v = vec2(0.0);
  }
  gl_FragColor = vec4(v, dist, dv.a);
}`;
const TILEMAX_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tIn; uniform vec2 uStep; uniform int uCount;
varying vec2 vUv;
void main(){
  vec2 best = vec2(0.0); float bl = -1.0;
  for (int i=0;i<40;i++){ if (i>=uCount) break;
    vec2 v = texture2D(tIn, vUv+uStep*(float(i)-float(uCount-1)*0.5)).xy; float l = dot(v,v);
    if (l>bl){ bl=l; best=v; } }
  gl_FragColor = vec4(best, 0.0, 1.0);
}`;
const MBLUR_FRAG = /* glsl */`
precision highp float;
${NOISE}
uniform sampler2D tColor, tVelFull, tTile;
uniform vec2 uRes; uniform float uShutter, uMaxPx, uFrame;
varying vec2 vUv;
float cone(float d, float v){ return clamp(1.0-d/max(v,0.001), 0.0, 1.0); }
float softer(float a, float b){ return clamp(1.0-(a-b)/(0.04*min(a,b)+0.02), 0.0, 1.0); } // 1 when a is nearer than b
void main(){
  vec4 c0 = texture2D(tColor, vUv);
  vec2 vt = texture2D(tTile, vUv).xy*uShutter*uRes;
  float lt = length(vt);
  if (lt < 0.6){ gl_FragColor = c0; return; }
  if (lt > uMaxPx) vt *= uMaxPx/lt;
  lt = min(lt, uMaxPx);
  vec4 vf = texture2D(tVelFull, vUv);
  float lc = min(length(vf.xy*uShutter*uRes), uMaxPx); float zc = vf.z;
  float j = fract(ign(gl_FragCoord.xy)+uFrame*0.7548);
  float wsum = 1.0/max(lc, 1.0); vec3 acc = c0.rgb*wsum;
  const int N = 14;
  for (int i=0;i<N;i++){
    float t = (float(i)+j)/float(N)-0.5;
    vec2 uv = vUv+vt*t/uRes;
    vec4 s = texture2D(tVelFull, uv);
    float ls = min(length(s.xy*uShutter*uRes), uMaxPx);
    float dpx = abs(t)*lt;
    float w = softer(s.z, zc)*cone(dpx, ls) + softer(zc, s.z)*cone(dpx, lc);
    w += step(dpx, min(ls, lc)*0.5+0.5)*0.15;
    acc += texture2D(tColor, uv).rgb*w; wsum += w;
  }
  gl_FragColor = vec4(acc/wsum, c0.a);
}`;
const DISTORT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tColor, tDist, tDetail, tVelFull;
uniform vec2 uRes; uniform float uTime; uniform vec3 uShimmer; // amp(px), scale, far-bias
varying vec2 vUv;
void main(){
  vec2 off = texture2D(tDist, vUv).xy;
  if (uShimmer.x > 0.0){
    float z = texture2D(tVelFull, vUv).z;
    float k = smoothstep(uShimmer.z*0.25, uShimmer.z, z);
    vec2 p = vUv*uRes/uShimmer.y;
    vec2 n = vec2(texture2D(tDetail, p*0.004+vec2(uTime*0.11, -uTime*0.34)).r, texture2D(tDetail, p*0.004+vec2(-uTime*0.09, -uTime*0.29)+0.5).g)-0.5;
    n += (vec2(texture2D(tDetail, p*0.011+vec2(uTime*0.23, -uTime*0.61)).g, texture2D(tDetail, p*0.011+vec2(0.3-uTime*0.19, -uTime*0.53)).r)-0.5)*0.6;
    off += n*uShimmer.x*k/uRes;
  }
  gl_FragColor = texture2D(tColor, vUv+off);
}`;
const BLOOM_DOWN_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tIn; uniform vec2 uTexel; uniform float uFirst;
varying vec2 vUv;
vec3 S(vec2 o){ return min(texture2D(tIn, vUv+o*uTexel).rgb, vec3(6.0e3)); }
float kw(vec3 c){ return 1.0/(1.0+max(c.r,max(c.g,c.b))*uFirst); }
void main(){
  vec3 a=S(vec2(-2,2)), b=S(vec2(0,2)), c=S(vec2(2,2)), d=S(vec2(-2,0)), e=S(vec2(0,0)), f=S(vec2(2,0)),
       g=S(vec2(-2,-2)), h=S(vec2(0,-2)), i=S(vec2(2,-2)), j=S(vec2(-1,1)), k=S(vec2(1,1)), l=S(vec2(-1,-1)), m=S(vec2(1,-1));
  vec3 g0=(j+k+l+m)*0.25, g1=(a+b+d+e)*0.25, g2=(b+c+e+f)*0.25, g3=(d+e+g+h)*0.25, g4=(e+f+h+i)*0.25;
  float w0=kw(g0)*0.5, w1=kw(g1)*0.125, w2=kw(g2)*0.125, w3=kw(g3)*0.125, w4=kw(g4)*0.125;
  gl_FragColor = vec4((g0*w0+g1*w1+g2*w2+g3*w3+g4*w4)/(w0+w1+w2+w3+w4), 1.0);
}`;
const BLOOM_UP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tIn, tPrev; uniform vec2 uTexel; uniform float uMix;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 s = texture2D(tIn, vUv).rgb*4.0;
  s += (texture2D(tIn, vUv+vec2(t.x,0)).rgb+texture2D(tIn, vUv-vec2(t.x,0)).rgb+texture2D(tIn, vUv+vec2(0,t.y)).rgb+texture2D(tIn, vUv-vec2(0,t.y)).rgb)*2.0;
  s += texture2D(tIn, vUv+t).rgb+texture2D(tIn, vUv-t).rgb+texture2D(tIn, vUv+vec2(t.x,-t.y)).rgb+texture2D(tIn, vUv+vec2(-t.x,t.y)).rgb;
  gl_FragColor = vec4(mix(texture2D(tPrev, vUv).rgb, s/16.0, uMix), 1.0);
}`;
const FINAL_FRAG = /* glsl */`
precision highp float;
${NOISE}
uniform sampler2D tColor, tBloom, tDetail;
uniform vec2 uRes; uniform float uFrame, uExposure, uBloom, uVignette, uGrain, uCA, uLensK, uFade, uSat, uContrast, uSharpen;
uniform vec3 uWB, uLift, uTint; uniform int uMode; uniform vec4 uThermal; // gain, level, noise, polarity
varying vec2 vUv;
vec3 agxCurve(vec3 x){ vec3 x2=x*x, x4=x2*x2; return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232; }
vec3 agx(vec3 v){
  const mat3 m = mat3(0.842479062253094,0.0423282422610123,0.0423756549057051, 0.0784335999999992,0.878468636469772,0.0784336, 0.0792237451477643,0.0791661274605434,0.879142973793104);
  v = m*v; v = clamp(log2(max(v,vec3(1e-10))), -12.47393, 4.026069); v = (v+12.47393)/16.5;
  return agxCurve(v);
}
vec3 agxOut(vec3 v){
  const mat3 mi = mat3(1.19687900512017,-0.0528968517574562,-0.0529716355144438, -0.0980208811401368,1.15190312990417,-0.0980434501171241, -0.0990297440797205,-0.0989611768448433,1.15107367264116);
  return mi*v;
}
vec3 fetch(vec2 uv){ return texture2D(tColor, uv).rgb + texture2D(tBloom, uv).rgb*uBloom; }
void main(){
  vec2 c = vUv-0.5; vec2 asp = vec2(uRes.x/uRes.y, 1.0);
  float r2 = dot(c*asp, c*asp);
  vec2 uv = 0.5+c*(1.0+uLensK*r2);
  vec3 col;
  if (uCA > 0.0){
    vec2 dir = (uv-0.5)*uCA*(0.4+r2*2.0);
    col = vec3(fetch(uv+dir).r, fetch(uv).g, fetch(uv-dir).b);
  } else col = fetch(uv);
  if (uSharpen > 0.0){
    vec2 t = 1.0/uRes;
    vec3 blur = (texture2D(tColor, uv+vec2(t.x,0)).rgb+texture2D(tColor, uv-vec2(t.x,0)).rgb+texture2D(tColor, uv+vec2(0,t.y)).rgb+texture2D(tColor, uv-vec2(0,t.y)).rgb)*0.25;
    col += (texture2D(tColor, uv).rgb-blur)*uSharpen;
  }
  col = max(col, vec3(0.0))*uExposure*uWB;
  float vig = 1.0-uVignette*smoothstep(0.08, 0.95, r2*1.15);
  col *= vig;
  vec3 o;
  if (uMode == 1){
    // long-wave IR look: scene luminance stands in for apparent temperature
    float l = dot(col, vec3(0.30,0.52,0.18));
    l = l/(1.0+l);
    l = clamp((l-uThermal.y)*uThermal.x+0.5, 0.0, 1.0);
    l = mix(l, 1.0-l, uThermal.w);
    float n = (hash12(floor(gl_FragCoord.xy/1.0)+uFrame*17.0)-0.5)*uThermal.z;
    float line = (hash12(vec2(floor(gl_FragCoord.y/2.0), uFrame))-0.5)*uThermal.z*0.35;
    o = vec3(pow(clamp(l+n+line,0.0,1.0), 0.92));
  } else {
    o = agx(col);
    float l = dot(o, vec3(0.2126,0.7152,0.0722));
    o = pow(max(o, vec3(0.0)), vec3(uContrast));
    l = dot(o, vec3(0.2126,0.7152,0.0722));
    o = l+uSat*(o-l);
    o = agxOut(o);
    o = o*uTint+uLift*(1.0-o);
  }
  // sensor grain, heavier in the mids and shadows
  if (uGrain > 0.0){
    vec2 g = gl_FragCoord.xy/1.6+vec2(hash11(uFrame*0.37)*731.0, hash11(uFrame*0.73+4.1)*557.0);
    float n = texture2D(tDetail, g/512.0).a + texture2D(tDetail, (g+97.3)/512.0*1.93).a - 1.0;
    float l = dot(o, vec3(0.3333));
    o += n*uGrain*(0.35+0.65*(1.0-l));
  }
  o *= uFade;
  o += (hash12(gl_FragCoord.xy+uFrame*3.1)+hash12(gl_FragCoord.xy*1.7+uFrame*5.3)-1.0)/255.0;
  gl_FragColor = vec4(clamp(o,0.0,1.0), 1.0);
}`;

// ---------------------------------------------------------------- pipeline
export class Pipeline {
  constructor(canvas, opts = {}) {
    const q = this.quality = { msaa: 4, shadow: 2048, bloomLevels: 6, far: 700000, ...opts.quality };
    const r = this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false,
      logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: true,
    });
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = false;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;
    r.setPixelRatio(1);
    this.maxAniso = r.capabilities.getMaxAnisotropy();
    this.floatLinear = !!r.extensions.get('OES_texture_float_linear');
    r.extensions.get('EXT_color_buffer_float');

    this.atmo = new Atmosphere();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.3, q.far);
    this.camera.layers.enable(LAYER.DYNAMIC);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.shadowFocus = new THREE.Vector3(); this.shadowRadius = 14;

    this.prevVP = new THREE.Matrix4();
    this.dynamic = [];
    this.frame = 0;
    this.camAlt = 0; this.origin = new THREE.Vector3();

    this.detail = makeDetailTexture(this.maxAniso);
    const A = this.atmo.uniforms;
    const shared = this.shared = {
      tDepth: { value: null }, tDetail: { value: this.detail }, tSky: { value: null }, tAmbient: { value: null },
      uLogFar: { value: Math.log2(q.far + 1) }, uRes: { value: new THREE.Vector2(1, 1) }, uCamAlt: { value: 0 },
      uOrigin: { value: new THREE.Vector3() }, uTime: { value: 0 }, uFrame: { value: 0 },
      uSunColor: { value: new THREE.Color() }, uGroundAlb: { value: this.atmo.groundAlbedo },
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() },
      ...A,
    };

    const fopt = { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtSky = new THREE.WebGLRenderTarget(256, 384, fopt);
    this.rtSky.texture.wrapS = THREE.RepeatWrapping;
    this.rtAmbient = new THREE.WebGLRenderTarget(1, 1, { ...fopt, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    shared.tSky.value = this.rtSky.texture; shared.tAmbient.value = this.rtAmbient.texture;

    this.pSky = new Pass(SKY_LUT_FRAG, { ...A, uCamAlt: shared.uCamAlt, uGroundAlb: shared.uGroundAlb });
    this.pAmbient = new Pass(AMBIENT_FRAG, { ...A, tSky: shared.tSky });
    this.pAtmo = new Pass(ATMO_FRAG, {
      ...A, tScene: { value: null }, tDepth: shared.tDepth, tSky: shared.tSky, tDetail: shared.tDetail, tAmbient: shared.tAmbient,
      uInvProj: shared.uInvProj, uCamRot: shared.uCamRot, uCamAlt: shared.uCamAlt, uFrame: shared.uFrame,
      uLogFar: shared.uLogFar, uSunDisk: { value: 0.05 }, uAerial: { value: 1 }, uOrigin: shared.uOrigin,
      uCirrus: { value: new THREE.Vector4(10500, 0, 0, 1) }, uCirrusWind: { value: new THREE.Vector2() },
    });
    this.velMat = new THREE.ShaderMaterial({ vertexShader: VEL_VERT, fragmentShader: VEL_FRAG, uniforms: { uPrevMVP: { value: new THREE.Matrix4() } }, side: THREE.DoubleSide });
    this.velMat.isVelocityMaterial = true;
    this.pVelFull = new Pass(VELFULL_FRAG, { tDepth: shared.tDepth, tVel: { value: null }, uInvProj: shared.uInvProj, uPrevVP: { value: this.prevVP }, uCamRot: shared.uCamRot, uLogFar: shared.uLogFar });
    this.pTile = new Pass(TILEMAX_FRAG, { tIn: { value: null }, uStep: { value: new THREE.Vector2() }, uCount: { value: 1 } });
    this.pBlur = new Pass(MBLUR_FRAG, { tColor: { value: null }, tVelFull: { value: null }, tTile: { value: null }, uRes: shared.uRes, uShutter: { value: 0.5 }, uMaxPx: { value: 48 }, uFrame: shared.uFrame });
    this.pDistort = new Pass(DISTORT_FRAG, { tColor: { value: null }, tDist: { value: null }, tDetail: shared.tDetail, tVelFull: { value: null }, uRes: shared.uRes, uTime: shared.uTime, uShimmer: { value: new THREE.Vector3(0, 1, 2000) } });
    this.pDown = new Pass(BLOOM_DOWN_FRAG, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 1 } });
    this.pUp = new Pass(BLOOM_UP_FRAG, { tIn: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 0.5 } });
    this.pFinal = new Pass(FINAL_FRAG, {
      tColor: { value: null }, tBloom: { value: null }, tDetail: shared.tDetail, uRes: shared.uRes, uFrame: shared.uFrame,
      uExposure: { value: 0.25 }, uBloom: { value: 0.06 }, uVignette: { value: 0.25 }, uGrain: { value: 0.035 }, uCA: { value: 0.0012 },
      uLensK: { value: 0.0 }, uFade: { value: 1 }, uSat: { value: 1.12 }, uContrast: { value: 1.12 }, uSharpen: { value: 0.0 },
      uWB: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3(0, 0, 0) }, uTint: { value: new THREE.Vector3(1, 1, 1) },
      uMode: { value: 0 }, uThermal: { value: new THREE.Vector4(2.2, 0.3, 0.06, 0) },
    });

    // environment probe (image-based lighting for PBR materials)
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new THREE.Scene();
    const envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthTest: false, depthWrite: false,
      uniforms: { ...A, uCamAlt: shared.uCamAlt, uGroundAlb: shared.uGroundAlb },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: ENV_FRAG,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
    this.envRT = null; this.envKey = '';
    this.setSize(opts.width || 1280, opts.height || 720);
  }

  setSize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    const r = this.renderer, q = this.quality;
    r.setSize(w, h, false);
    this.shared.uRes.value.set(w, h);
    for (const k of ['rtScene', 'rtVel', 'rtA', 'rtB', 'rtVelFull', 'rtTileH', 'rtTile', 'rtDist']) this[k]?.dispose();
    (this.bloom || []).forEach(t => t.dispose());
    const hf = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...hf, samples: q.msaa, depthBuffer: true, depthTexture: depth });
    this.shared.tDepth.value = depth;
    this.rtVel = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rtA = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false });
    this.rtVelFull = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.tile = Math.max(8, Math.round(h / 34));
    const tw = Math.ceil(w / this.tile), th = Math.ceil(h / this.tile);
    const near = { ...hf, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.rtTileH = new THREE.WebGLRenderTarget(tw, h, near);
    this.rtTile = new THREE.WebGLRenderTarget(tw, th, near);
    this.rtTileN = new THREE.WebGLRenderTarget(tw, th, near);
    this.rtDist = new THREE.WebGLRenderTarget(Math.ceil(w / 2), Math.ceil(h / 2), { ...hf, depthBuffer: false });
    this.bloom = []; this.bloomUp = [];
    let bw = w, bh = h;
    for (let i = 0; i < q.bloomLevels; i++) {
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      this.bloom.push(new THREE.WebGLRenderTarget(bw, bh, { ...hf, depthBuffer: false }));
      this.bloomUp.push(new THREE.WebGLRenderTarget(bw, bh, { ...hf, depthBuffer: false }));
    }
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // mark an object tree as moving geometry (own motion vectors, casts the hero shadow)
  registerDynamic(root) {
    const self = this;
    root.traverse(o => {
      if (!o.isMesh || o.layers.mask !== 1) return; // leave FX / refraction meshes on their own layers
      o.layers.set(LAYER.DYNAMIC);
      o.userData.prevMW = new THREE.Matrix4();
      o.onBeforeRender = function (r, s, cam, geo, mat) {
        if (mat.isVelocityMaterial) { mat.uniforms.uPrevMVP.value.multiplyMatrices(self.prevVP, this.userData.prevMW); mat.uniformsNeedUpdate = true; }
      };
      this.dynamic.push(o);
    });
  }
  // call with the scene posed at the previous sub-frame time
  snapshotPrev() {
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    for (const o of this.dynamic) o.userData.prevMW.copy(o.matrixWorld);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.prevVP.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
  }

  updateEnvironment(key) {
    if (key === this.envKey && this.envRT) return;
    this.envKey = key;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  // post: { exposure, bloom, vignette, grain, ca, lensK, fade, sat, contrast, wb:[r,g,b], lift:[..], tint:[..], shutter, shimmer:[amp,scale,far], sunDisk, mode, thermal:[..], cirrus:{alt,cover,opacity,scale}, sharpen }
  render(time, frameIndex, post = {}) {
    const r = this.renderer, S = this.shared, cam = this.camera, sc = this.scene;
    this.frame = frameIndex;
    S.uTime.value = time; S.uFrame.value = frameIndex % 1024;
    S.uCamAlt.value = this.camAlt; S.uOrigin.value.copy(this.origin);
    sc.updateMatrixWorld(true); cam.updateMatrixWorld(true);
    S.uInvProj.value.copy(cam.projectionMatrixInverse);
    S.uCamRot.value.setFromMatrix4(cam.matrixWorld);

    // sun light + hero shadow frustum
    const sunC = this.atmo.sunIrradiance(this.camAlt, S.uSunColor.value);
    const m = Math.max(sunC.r, sunC.g, sunC.b, 1e-6);
    this.sun.color.setRGB(sunC.r / m, sunC.g / m, sunC.b / m);
    this.sun.intensity = m * (post.sunScale ?? 1);
    const sr = this.shadowRadius, sh = this.sun.shadow.camera;
    this.sun.target.position.copy(this.shadowFocus);
    this.sun.position.copy(this.shadowFocus).addScaledVector(this.atmo.sunDir, sr * 4);
    sh.left = -sr; sh.right = sr; sh.top = sr; sh.bottom = -sr; sh.near = 0.5; sh.far = sr * 8; sh.updateProjectionMatrix();
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();

    // sky LUT every frame (cheap); IBL only when the key changes
    const A = this.atmo.uniforms, sk = `${A.uSunDir.value.x.toFixed(4)},${A.uSunDir.value.y.toFixed(4)},${A.uSunDir.value.z.toFixed(4)},${Math.round(this.camAlt / 25)},${A.uHaze.value},${A.uHazeH.value},${A.uMieG.value},${A.uMS.value}`;
    if (sk !== this.skyKey) { this.skyKey = sk; this.pSky.render(r, this.rtSky); this.pAmbient.render(r, this.rtAmbient); }
    this.updateEnvironment(post.envKey ?? 'default');

    // 1. opaque scene
    cam.layers.set(LAYER.STATIC); cam.layers.enable(LAYER.DYNAMIC);
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtScene); r.setClearColor(0x000000, 1); r.clear();
    r.render(sc, cam);

    // 2. motion vectors of moving geometry
    sc.overrideMaterial = this.velMat;
    cam.layers.set(LAYER.DYNAMIC);
    r.setRenderTarget(this.rtVel); r.setClearColor(0x000000, 0); r.clear();
    r.render(sc, cam);
    sc.overrideMaterial = null;

    // 3. sky + aerial perspective
    const ua = this.pAtmo.u;
    ua.tScene.value = this.rtScene.texture;
    ua.uSunDisk.value = post.sunDisk ?? 0.05; ua.uAerial.value = post.aerial ?? 1;
    const ci = post.cirrus;
    if (ci) { ua.uCirrus.value.set(ci.alt ?? 10500, ci.cover ?? 0.4, ci.opacity ?? 0.5, ci.scale ?? 1); ua.uCirrusWind.value.set((ci.wind?.[0] ?? 0) * time, (ci.wind?.[1] ?? 0) * time); }
    else ua.uCirrus.value.z = 0;
    this.pAtmo.render(r, this.rtA);

    // 4. transparent FX over the lit, fogged scene
    cam.layers.set(LAYER.FX);
    r.setRenderTarget(this.rtA);
    r.render(sc, cam);

    // 5. refraction sources (heat haze, shock fronts)
    cam.layers.set(LAYER.DISTORT);
    r.setRenderTarget(this.rtDist); r.setClearColor(0x000000, 0); r.clear();
    r.render(sc, cam);
    cam.layers.set(LAYER.STATIC); cam.layers.enable(LAYER.DYNAMIC);

    // 6. velocity field
    this.pVelFull.u.tVel.value = this.rtVel.texture;
    this.pVelFull.render(r, this.rtVelFull);
    const sh2 = post.shimmer || [0, 1, 2000];
    const ud = this.pDistort.u;
    ud.tColor.value = this.rtA.texture; ud.tDist.value = this.rtDist.texture; ud.tVelFull.value = this.rtVelFull.texture;
    ud.uShimmer.value.set(sh2[0] * this.h / 1080, sh2[1] * this.h / 1080, sh2[2]);
    this.pDistort.render(r, this.rtB);
    let cur = this.rtB, other = this.rtA;

    const shutter = post.shutter ?? 0.5;
    if (shutter > 0) {
      const ut = this.pTile.u;
      ut.tIn.value = this.rtVelFull.texture; ut.uStep.value.set(0, 0); ut.uCount.value = this.tile; ut.uStep.value.set(1 / this.w, 0);
      this.pTile.render(r, this.rtTileH);
      ut.tIn.value = this.rtTileH.texture; ut.uStep.value.set(0, 1 / this.h);
      this.pTile.render(r, this.rtTile);
      ut.tIn.value = this.rtTile.texture; ut.uCount.value = 3; ut.uStep.value.set(1 / this.rtTile.width, 0);
      this.pTile.render(r, this.rtTileN);
      ut.tIn.value = this.rtTileN.texture; ut.uStep.value.set(0, 1 / this.rtTile.height);
      this.pTile.render(r, this.rtTile);
      const ub = this.pBlur.u;
      ub.tColor.value = cur.texture; ub.tVelFull.value = this.rtVelFull.texture; ub.tTile.value = this.rtTile.texture;
      ub.uShutter.value = shutter; ub.uMaxPx.value = this.h * 0.055;
      this.pBlur.render(r, other);
      [cur, other] = [other, cur];
    }

    // 7. bloom
    const B = this.bloom, U = this.bloomUp;
    let src = cur.texture, sw = this.w, shh = this.h;
    for (let i = 0; i < B.length; i++) {
      this.pDown.u.tIn.value = src; this.pDown.u.uTexel.value.set(1 / sw, 1 / shh); this.pDown.u.uFirst.value = i === 0 ? 1 : 0;
      this.pDown.render(r, B[i]);
      src = B[i].texture; sw = B[i].width; shh = B[i].height;
    }
    let up = B[B.length - 1].texture;
    for (let i = B.length - 2; i >= 0; i--) {
      this.pUp.u.tIn.value = up; this.pUp.u.tPrev.value = B[i].texture;
      this.pUp.u.uTexel.value.set(1 / B[i + 1].width, 1 / B[i + 1].height);
      this.pUp.u.uMix.value = post.bloomSpread ?? 0.62;
      this.pUp.render(r, U[i]);
      up = U[i].texture;
    }

    // 8. lens, tone map, grade
    const uf = this.pFinal.u;
    uf.tColor.value = cur.texture; uf.tBloom.value = up;
    uf.uExposure.value = post.exposure ?? 0.25; uf.uBloom.value = post.bloom ?? 0.06;
    uf.uVignette.value = post.vignette ?? 0.25; uf.uGrain.value = post.grain ?? 0.035; uf.uCA.value = post.ca ?? 0.0012;
    uf.uLensK.value = post.lensK ?? 0; uf.uFade.value = post.fade ?? 1; uf.uSat.value = post.sat ?? 1.12; uf.uContrast.value = post.contrast ?? 1.12;
    uf.uSharpen.value = post.sharpen ?? 0;
    uf.uWB.value.fromArray(post.wb || [1, 1, 1]); uf.uLift.value.fromArray(post.lift || [0, 0, 0]); uf.uTint.value.fromArray(post.tint || [1, 1, 1]);
    uf.uMode.value = post.mode === 'thermal' ? 1 : 0;
    if (post.thermal) uf.uThermal.value.fromArray(post.thermal);
    if (post.debug === 'scene') uf.tColor.value = this.rtScene.texture;
    this.pFinal.render(r, null);
  }
}

// ---------------------------------------------------------------- tileable detail noise
// R,G: independent 5-octave gradient fBm; B: cellular (F1); A: fine white-ish grain. 512², repeat, mipmapped.
export function makeDetailTexture(aniso = 1) {
  const N = 512, data = new Uint8Array(N * N * 4);
  const rnd = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const grad = (period, seed) => { const r = rnd(seed), g = new Float32Array(period * period * 2); for (let i = 0; i < period * period; i++) { const a = r() * 6.2831853; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); } return g; };
  const perlin = (g, period, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period, x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const d = (ix, iy, dx, dy) => g[(iy * period + ix) * 2] * dx + g[(iy * period + ix) * 2 + 1] * dy;
    const a = d(x0, y0, fx, fy), b = d(x1, y0, fx - 1, fy), c = d(x0, y1, fx, fy - 1), e = d(x1, y1, fx - 1, fy - 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  };
  const chan = (seed) => {
    const out = new Float32Array(N * N); let amp = 1, tot = 0;
    for (let o = 0; o < 6; o++) {
      const period = 4 << o, g = grad(period, seed + o * 101);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] += amp * perlin(g, period, x / N * period, y / N * period);
      tot += amp; amp *= 0.55;
    }
    let mn = 1e9, mx = -1e9; for (let i = 0; i < N * N; i++) { mn = Math.min(mn, out[i]); mx = Math.max(mx, out[i]); }
    for (let i = 0; i < N * N; i++) out[i] = (out[i] - mn) / (mx - mn);
    return out;
  };
  const R = chan(11), G = chan(977);
  // cellular
  const P = 16, r2 = rnd(4242), pts = new Float32Array(P * P * 2); for (let i = 0; i < pts.length; i++) pts[i] = r2();
  const r3 = rnd(99);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = x / N * P, py = y / N * P, cx = Math.floor(px), cy = Math.floor(py); let best = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = ((cx + i) % P + P) % P, gy = ((cy + j) % P + P) % P;
      const dx = cx + i + pts[(gy * P + gx) * 2] - px, dy = cy + j + pts[(gy * P + gx) * 2 + 1] - py;
      best = Math.min(best, dx * dx + dy * dy);
    }
    const k = (y * N + x) * 4;
    data[k] = R[y * N + x] * 255; data[k + 1] = G[y * N + x] * 255; data[k + 2] = Math.min(1, Math.sqrt(best)) * 255;
    data[k + 3] = (r3() + r3() + r3()) / 3 * 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = Math.min(8, aniso); tex.needsUpdate = true;
  return tex;
}
