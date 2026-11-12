// HDR render pipeline: scene (MSAA, log depth) -> deferred terrain -> ambient occlusion -> sky / aerial perspective /
// clouds -> FX -> refraction -> depth of field -> motion blur -> light shafts, bloom, flare -> lens, tone map, grade.
import * as THREE from 'three';
import { NOISE, ATMOSPHERE, DEPTH, FSQ_VERT } from './glsl.js';

export const LAYER = { STATIC: 0, DYNAMIC: 1, FX: 2, DISTORT: 3 };
export const RG = 6360000;
const H_R = 8000, BETA_R = [5.802e-6, 13.558e-6, 33.1e-6], BETA_M_E = 4.44e-6, BETA_O = [0.650e-6, 1.881e-6, 0.085e-6];

const fsGeo = new THREE.BufferGeometry();
fsGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
fsGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// three r160 declares precision for float and int only, so under GLSL ES 3.00 every sampler defaults to lowp.
// GPUs that honour that (Mali, some Adreno) hand back 16-bit depth, heights and HDR colour: banded occlusion,
// stepped water and terrain. Every program, built-in or custom, gets full-precision samplers in both stages.
const SAMPLER_PRECISION = 'precision highp sampler2D;\nprecision highp samplerCube;\nprecision highp sampler3D;\n';
THREE.Material.prototype.onBeforeCompile = function (shader) {
  shader.vertexShader = SAMPLER_PRECISION + shader.vertexShader; shader.fragmentShader = SAMPLER_PRECISION + shader.fragmentShader;
};

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
uniform float uCamAlt; uniform vec3 uGroundAlb; uniform vec2 uDeck;   // cloud deck below the camera: top altitude (m), brightness (0 = none)
uniform vec4 uOver;   // opt-in (post.envOver / post.envDesat): cloud layer above the camera: base (m), cover, brightness; w: clear-sky desaturation
uniform vec4 uEnvG;   // opt-in (post.envGround): the ground right under the camera: albedo (rgb), w: camera height above it (m; 0 = off)
uniform float uEnvGShade;
uniform float uSea;     // 1: the ground below the horizon is open water, which mirrors the sky (Fresnel, wave-blurred)
// the cloud layer seen from the probe (opt-in, post.envClouds): column cover as clouds.js CLOUD_COVER computes it
uniform sampler2D tDetail, tAmbient; uniform vec4 uECov, uEHole, uECloud; uniform vec3 uSunColor;   // uECloud: mid altitude (m), strength, world x, z of the probe
uniform float uEFog;
varying vec3 vDir;
float envCover(vec2 wxz){
  vec2 q = wxz*0.001/uECov.y+uECov.zw;
  float n = textureLod(tDetail, q*0.011, 1.0).r*0.5+textureLod(tDetail, q*0.043+0.31, 2.0).g*0.33+textureLod(tDetail, q*0.17+0.7, 7.0).r*0.17;
  float thr = mix(0.66, 0.12, uECov.x);
  float c = smoothstep(thr, thr+0.42, n);
  if (uEHole.w > 0.0) c *= 1.0-uEHole.w*(1.0-smoothstep(uEHole.z*0.55, uEHole.z, length(wxz-uEHole.xy)));
  return c;
}
// what a ray from the probe sees of the cloud deck (lit as the ocean lights the clouds it reflects)
vec3 envClouds(vec3 rd, vec3 col){
  if (uECloud.y <= 0.0 || rd.y < 0.012) return col;
  float tc = (uECloud.x-uCamAlt)/rd.y;
  if (tc <= 0.0 || tc > 90000.0) return col;
  float cc = smoothstep(0.32, 0.8, envCover(uECloud.zw+rd.xz*tc));
  float cs = max(dot(rd, uSunDir), 0.0);
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  vec3 cloudCol = uSunColor*(0.035+0.10*pow(cs, 6.0)+0.05*(1.0-cs))+amb*0.21;
  return mix(col, cloudCol, cc*uECloud.y*exp(-tc*uEFog*0.5));
}
vec3 skyAlong(vec3 ro, vec3 rd){
  vec3 LR, LM, LMS, T;
  atmoIntegrate(ro, rd, 1.0e9, 0.5, 14, LR, LM, LMS, T);
  float cv = dot(rd,uSunDir);
  return LR*phaseR(cv)+LM*min(phaseM(cv),1.5)+LMS;
}
void main(){
  vec3 rd = normalize(vDir);
  vec3 ro = vec3(0.0, RG+uCamAlt, 0.0);
  float b = dot(ro,rd), c = dot(ro,ro)-RG*RG, disc = b*b-c;
  float tG = (disc>0.0 && b<0.0) ? (-b-sqrt(disc)) : -1.0;
  float tD = -1.0;
  if (uDeck.y > 0.0 && uCamAlt > uDeck.x && b < 0.0){ float Rd = RG+uDeck.x, dd = b*b-(dot(ro,ro)-Rd*Rd); if (dd > 0.0) tD = -b-sqrt(dd); }
  vec3 LR, LM, LMS, T;
  atmoIntegrate(ro, rd, tD>0.0 ? tD : (tG>0.0 ? tG : 1.0e9), 0.5, 14, LR, LM, LMS, T);
  float cv = dot(rd,uSunDir);
  vec3 col = LR*phaseR(cv)+LM*min(phaseM(cv),1.5)+LMS;
  // single scattering alone paints a deeper blue than a real sky (no multiple scattering, no fine aerosol): bare metal
  // must not reflect a sky more saturated than the one on screen
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), uOver.w);
  if (uOver.y > 0.0 && rd.y > 0.0 && uCamAlt < uOver.x){   // the underside of a broken layer overhead
    float se = max(rd.y, 0.015), dist = (uOver.x-uCamAlt)/se;
    float cov = 1.0-pow(clamp(1.0-uOver.y, 0.0, 1.0), 1.0/max(se*1.5, 0.05));          // seen at a slant the gaps close up
    float mu = uSunDir.y;
    vec3 Es = uSunE*exp(-sunTau(RG+uOver.x, max(mu, 0.02)));
    float fwd = 0.6+1.6*pow(max(cv, 0.0), 6.0);                     // diffused light is brightest toward the sun
    vec3 Lc = (Es*(0.10+0.30*max(mu, 0.0))*fwd + uSunE*0.05*smoothstep(-0.1, 0.2, mu) + Es*max(mu, 0.0)*uGroundAlb*0.35)*0.3183*uOver.z;
    Lc = mix(Lc, col, 1.0-exp(-dist/40000.0));                        // haze between the camera and a distant cloud base
    col = mix(col, Lc, cov);
  }
  if (tD <= 0.0 && tG <= 0.0) col = envClouds(rd, col);
  if (tD>0.0){        // a bright, softly lit cloud floor
    vec3 p = ro+rd*tD; float mu = dot(normalize(p), uSunDir);
    vec3 E = uSunE*exp(-sunTau(RG+uDeck.x, max(mu, 0.02)))*(0.2+0.8*max(mu, 0.0)) + uSunE*0.07*smoothstep(-0.1,0.2,uSunDir.y);
    col += T*mix(uGroundAlb*0.6, vec3(1.0), 0.75)*uDeck.y*E*0.3183;
  } else if (tG>0.0){
    vec3 p = ro+rd*tG; float mu = max(dot(normalize(p), uSunDir), 0.0);
    vec3 E = uSunE*exp(-sunTau(RG, mu))*mu + uSunE*0.06*smoothstep(-0.1,0.2,uSunDir.y);
    vec3 grd = uGroundAlb*E*0.3183;
    if (uSea > 0.0){   // sea: skylight mirrored by wave facets (the facets keep grazing reflection below ~0.45)
      vec3 up = normalize(p), rr = reflect(rd, up);
      rr.y = max(rr.y, 0.02); rr = normalize(rr);
      float cosI = clamp(-dot(rd, up), 0.0, 1.0), f = 0.02+0.98*pow(1.0-max(cosI, 0.16), 5.0);
      grd = mix(grd, envClouds(rr, skyAlong(p+up*2.0, rr)), f*uSea);
      if (uECloud.y > 0.0 && uSunDir.y > 0.0){   // the sun's glitter: wave facets (Cox-Munk, ~7 m/s) mirroring the sun at the probe
        vec3 v = -rd, hh = normalize(uSunDir+v);
        float cb = max(dot(hh, up), 1e-3), tb2 = (1.0-cb*cb)/(cb*cb), s2 = 0.04, cvv = max(dot(v, up), 0.03);
        float Fh = 0.02+0.98*pow(1.0-max(dot(hh, v), 0.0), 5.0);
        vec3 Es = uSunE*exp(-sunTau(RG, max(dot(up, uSunDir), 0.02)));
        grd += min(Es*Fh*exp(-tb2/s2)/(3.14159*s2*4.0*cvv*cb*cb*cb*cb), Es*1.5)*uSea*uECloud.y;
      }
    }
    col += T*grd;
  }
  if (uEnvG.w > 0.0 && rd.y < 0.0){
    // a camera standing on a runway: what metal mirrors below the horizon is the pavement a few metres away, lit as the
    // terrain shader lights it (sun + sky hemisphere), not the albedo-tinted ground of the sky model seen through
    // kilometres of air. The steep rays look at the ground under the airframe, which the airframe hides from the sky.
    float tg = uEnvG.w/max(-rd.y, 1e-3), mu = uSunDir.y;
    vec3 Es = uSunE*exp(-sunTau(RG+max(uCamAlt-uEnvG.w, 0.0), max(mu, 0.02)))*max(mu, 0.0);
    vec3 Lg = uEnvG.rgb*0.3183*(Es + texture2D(tAmbient, vec2(0.5)).rgb)*(1.0-uEnvGShade*smoothstep(-0.3, -0.8, rd.y));
    col = mix(col, Lg, smoothstep(0.0, -0.05, rd.y)*exp(-tg/8000.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// Aerial-perspective froxel LUT: 32 depth slices (8x4 tiles of 64x36) of in-scatter and transmittance along the
// view frustum, so per-pixel fog is two texture taps instead of an integral.
const AP_FRAG = /* glsl */`
precision highp float;
${ATMOSPHERE}
uniform mat4 uInvProj; uniform mat3 uCamRot; uniform float uCamAlt; uniform int uWhich;
varying vec2 vUv;
void main(){
  vec2 g = vUv*vec2(8.0,4.0); vec2 tile = floor(g), f = fract(g);
  float k = tile.x+tile.y*8.0;
  vec2 suv = (f*vec2(64.0,36.0)-0.5)/vec2(63.0,35.0);
  float w = (k+1.0)/32.0; float dist = 480000.0*w*w;
  vec4 q = uInvProj*vec4(suv*2.0-1.0, 1.0, 1.0);
  vec3 rd = normalize(uCamRot*normalize(q.xyz/q.w));
  vec3 LR, LM, LMS, T;
  atmoIntegrate(vec3(0.0, RG+uCamAlt, 0.0), rd, dist, 0.5, 10, LR, LM, LMS, T);
  gl_FragColor = uWhich == 0 ? vec4(atmoCombine(LR, LM, LMS, dot(rd,uSunDir)), 1.0) : vec4(T, 1.0);
}`;
const AP_LOOKUP = /* glsl */`
uniform sampler2D tApI, tApT;
void aerialLUT(vec2 uv, float dist, out vec3 I, out vec3 T){
  float w = sqrt(clamp(dist/480000.0, 0.0, 1.0))*32.0-1.0;
  float k0 = floor(w), f = w-k0;
  vec2 tuv = (clamp(uv,0.0,1.0)*vec2(63.0,35.0)+0.5)/vec2(64.0,36.0);
  vec3 I0 = vec3(0.0), T0 = vec3(1.0);
  if (k0 >= 0.0){ vec2 a = (vec2(mod(k0,8.0), floor(k0/8.0))+tuv)/vec2(8.0,4.0); I0 = texture2D(tApI,a).rgb; T0 = texture2D(tApT,a).rgb; }
  float k1 = min(k0+1.0, 31.0);
  vec2 b = (vec2(mod(k1,8.0), floor(k1/8.0))+tuv)/vec2(8.0,4.0);
  I = mix(I0, texture2D(tApI,b).rgb, f); T = mix(T0, texture2D(tApT,b).rgb, f);
}`;

// Screen-space ambient occlusion at half resolution (r = occlusion, g = view depth for edge-aware filtering)
const AO_FRAG = /* glsl */`
precision highp float;
${NOISE}
${DEPTH}
uniform sampler2D tDepth; uniform mat4 uInvProj; uniform vec2 uRes; uniform vec3 uAO; // radius (m), strength, px per unit at z=1
varying vec2 vUv;
vec3 vpos(vec2 uv){ float d = texture2D(tDepth, uv).x; float z = d >= 0.999999 ? 1.0e7 : viewZ(d); vec4 q = uInvProj*vec4(uv*2.0-1.0, 1.0, 1.0); vec3 dir = q.xyz/q.w; return dir/(-dir.z)*z; }
void main(){
  vec3 P = vpos(vUv); float zc = -P.z;
  float rpx = uAO.x*uAO.z/zc;
  float zs = min(zc, 6.0e4);                 // half-float safe depth for the edge-aware filters (sky = 60 km)
  if (zc > 9.0e6 || rpx < 1.2){ gl_FragColor = vec4(1.0, zs, 0.0, 1.0); return; }
  vec2 t = 1.0/uRes;
  vec3 Pr = vpos(vUv+vec2(t.x,0.0)), Pl = vpos(vUv-vec2(t.x,0.0)), Pu = vpos(vUv+vec2(0.0,t.y)), Pd = vpos(vUv-vec2(0.0,t.y));
  vec3 dx = abs(Pr.z-P.z) < abs(P.z-Pl.z) ? Pr-P : P-Pl;
  vec3 dy = abs(Pu.z-P.z) < abs(P.z-Pd.z) ? Pu-P : P-Pd;
  if (max(abs(dx.z), abs(dy.z)) > 0.25*zc){ gl_FragColor = vec4(1.0, zs, 0.0, 1.0); return; }   // isolated sliver: no stable normal
  vec3 N = normalize(cross(dx, dy)); if (N.z < 0.0) N = -N;
  rpx = min(rpx, 0.11*uRes.y);
  float r = rpx*zc/uAO.z;                   // effective world radius after the pixel cap
  float ang = ign(gl_FragCoord.xy)*6.2831853, occ = 0.0;
  for (int i=0;i<12;i++){
    float tt = (float(i)+0.5)/12.0; ang += 2.39996;
    vec3 S = vpos(vUv+vec2(cos(ang), sin(ang))*rpx*sqrt(tt)*t);
    vec3 v = S-P; float dd = dot(v,v);
    occ += max(dot(v,N)/sqrt(dd+1e-8)-0.12, 0.0)*clamp(1.0-dd/(r*r), 0.0, 1.0);
  }
  gl_FragColor = vec4(clamp(1.0-occ/12.0*2.4*uAO.y, 0.0, 1.0), zs, 0.0, 1.0);
}`;
const AO_BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tIn; uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec2 c = texture2D(tIn, vUv).rg; float acc = c.r*0.28, ws = 0.28;
  for (int i=1;i<=4;i++){
    float g = i==1 ? 0.22 : (i==2 ? 0.15 : (i==3 ? 0.09 : 0.04));
    for (int s=0;s<2;s++){
      vec2 q = texture2D(tIn, vUv+uDir*float(i)*(s==0 ? 1.0 : -1.0)).rg;
      float w = g/(1.0+abs(q.g-c.g)/(0.02*c.g+0.01)*4.0);
      acc += q.r*w; ws += w;
    }
  }
  gl_FragColor = vec4(acc/ws, c.g, 0.0, 1.0);
}`;

const ATMO_FRAG = /* glsl */`
precision highp float;
${NOISE}
${ATMOSPHERE}
${DEPTH}
${AP_LOOKUP}
uniform sampler2D tScene, tDepth, tSky, tDetail, tAmbient, tAO, tCloud;
uniform mat4 uInvProj; uniform mat3 uCamRot;
uniform float uCamAlt, uFrame, uSunDisk, uAerial;
uniform vec3 uOrigin;
uniform vec4 uCirrus;   // altitude (m), coverage 0..1, opacity, scale (km)
uniform vec2 uCirrusWind;
uniform vec4 uCloud;    // x: enabled, y: layer base, z: layer top (m MSL)
uniform vec3 uAOk;      // x: strength (0 = off), yz: AO buffer size
varying vec2 vUv;

vec3 skyLut(vec3 d, float cv){
  vec2 uv = skyUV(d); float v = clamp(uv.y, 0.004, 0.996);
  return texture2D(tSky, vec2(uv.x,(v+0.0)/3.0)).rgb*phaseR(cv)
       + texture2D(tSky, vec2(uv.x,(v+1.0)/3.0)).rgb*phaseM(cv)
       + texture2D(tSky, vec2(uv.x,(v+2.0)/3.0)).rgb;
}
// edge-aware upsample of the half-resolution AO buffer
float aoAt(vec2 uv, float z){
  vec2 p = uv*uAOk.yz-0.5, b = floor(p), f = p-b; float ws = 0.0, as = 0.0; z = min(z, 6.0e4);
  for (int j=0;j<2;j++) for (int i=0;i<2;i++){
    vec2 s = texture2D(tAO, (b+vec2(float(i),float(j))+0.5)/uAOk.yz).rg;
    float w = (i==0 ? 1.0-f.x : f.x)*(j==0 ? 1.0-f.y : f.y)/(0.02+abs(s.g-z)/z);
    ws += w; as += s.r*w;
  }
  return ws > 0.05 ? as/ws : 1.0;     // no AO sample at a comparable depth (silhouette against sky): leave unoccluded
}
// distance along the ray to the near face of the spherical layer [base, top] (m MSL); -1 if never entered
float shellEnter(vec3 ro, vec3 rd, float base, float top){
  float Rb = RG+base, Rt = RG+top, b = dot(ro,rd), r2 = dot(ro,ro);
  if (r2 > Rt*Rt){ float disc = b*b-(r2-Rt*Rt); return (disc <= 0.0 || b >= 0.0) ? -1.0 : -b-sqrt(disc); }
  if (r2 < Rb*Rb){ return -b+sqrt(max(b*b-(r2-Rb*Rb), 0.0)); }
  return 0.0;
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
  bool sky = d >= 0.999999;
  float ak = sky ? 1.0 : uAerial;
  vec3 col; float dist = 1.0e9;
  if (sky){
    // the scene pass already drew the sky behind everything (alpha 1); only depth-only markers of terrain or sea
    // that this sample missed (alpha below 1, at the horizon) still need sky
    col = sc.rgb;
    if (sc.a < 0.999){
      vec3 skyc = skyLut(rd, cv);
      float cs = 0.9999892; // cos(0.00465)
      float disk = smoothstep(cs-0.0000035, cs+0.0000015, cv);
      if (disk > 0.0){
        vec3 Tv = exp(-sunTau(RG+uCamAlt, rd.y));
        float limb = 1.0-0.55*(1.0-sqrt(clamp((cv-cs)/(1.0-cs),0.0,1.0)));
        vec3 sd = uSunE*14700.0*uSunDisk*Tv*disk*limb;
        skyc += sd*min(1.0, 3.0e4/max(max(sd.r, max(sd.g, sd.b)), 1e-6));
      }
      col += skyc*(1.0-sc.a);
    }
  } else {
    float vz = viewZ(d);
    dist = vz/max(-vd.z, 1e-4);
    vec3 I, T; aerialLUT(vUv, dist, I, T);
    vec3 s = sc.rgb;
    if (uAOk.x > 0.0) s *= mix(1.0, aoAt(vUv, vz), uAOk.x);
    col = s*mix(vec3(1.0), T, ak)+I*ak;
  }
  float tc; vec4 ci = cirrus(ro, rd, cv, tc);
  if (ci.a > 0.0 && tc < dist){
    vec3 Ic, Tc; aerialLUT(vUv, tc, Ic, Tc); Ic *= ak; Tc = mix(vec3(1.0), Tc, ak);
    col = max(col-Ic, vec3(0.0))*(1.0-ci.a)+Ic+ci.rgb*ci.a*Tc;
  }
  if (uCloud.x > 0.5){
    vec4 cl = texture2D(tCloud, vUv);
    if (cl.a < 0.997){
      float tcl = shellEnter(ro, rd, uCloud.y, uCloud.z);
      if (tcl >= 0.0 && tcl < dist){
        vec3 Ic, Tc; aerialLUT(vUv, tcl+500.0, Ic, Tc); Ic *= ak; Tc = mix(vec3(1.0), Tc, ak);
        col = max(col-Ic, vec3(0.0))*cl.a+Ic+cl.rgb*Tc;
      }
    }
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), sc.a);
}`;

// The sky drawn behind everything inside the multisampled scene pass, so that the edges of objects against the
// sky are anti-aliased against the sky itself rather than against black.
const SKY_BG_VERT = `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
const SKY_BG_FRAG = /* glsl */`
precision highp float;
${ATMOSPHERE}
uniform sampler2D tSky; uniform mat4 uInvProj; uniform mat3 uCamRot; uniform float uCamAlt, uSunDisk;
varying vec2 vUv;
vec3 skyLut(vec3 d, float cv){
  vec2 uv = skyUV(d); float v = clamp(uv.y, 0.004, 0.996);
  return texture2D(tSky, vec2(uv.x,(v+0.0)/3.0)).rgb*phaseR(cv)
       + texture2D(tSky, vec2(uv.x,(v+1.0)/3.0)).rgb*phaseM(cv)
       + texture2D(tSky, vec2(uv.x,(v+2.0)/3.0)).rgb;
}
void main(){
  vec4 q = uInvProj*vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 rd = normalize(uCamRot*normalize(q.xyz/q.w));
  float cv = dot(rd, uSunDir);
  vec3 col = skyLut(rd, cv);
  float cs = 0.9999892; // cos(0.00465)
  float disk = smoothstep(cs-0.0000035, cs+0.0000015, cv);
  if (disk > 0.0){
    vec3 Tv = exp(-sunTau(RG+uCamAlt, rd.y));
    float limb = 1.0-0.55*(1.0-sqrt(clamp((cv-cs)/(1.0-cs),0.0,1.0)));
    vec3 sd = uSunE*14700.0*uSunDisk*Tv*disk*limb;
    col += sd*min(1.0, 3.0e4/max(max(sd.r, max(sd.g, sd.b)), 1e-6));   // stay inside half-float range, keep the hue
  }
  gl_FragColor = vec4(col, 1.0);
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
  float zs = min(dist, 6.0e4);          // the stored depth must stay inside half-float range
  vec4 dv = texture2D(tVel, vUv);
  if (dv.a <= 0.5 && dist < 3000.0){
    // The multisampled depth and the single-sample velocity buffer disagree by up to a pixel along silhouettes.
    // A moving object's edge pixel read as static would get the camera's full speed, so borrow a neighbour's motion.
    vec2 tx = 1.0/vec2(textureSize(tVel, 0));
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){ vec4 n = texture2D(tVel, vUv+vec2(float(i),float(j))*tx); if (n.a > 0.5) dv = n; }
  }
  vec2 v;
  if (dv.a > 0.5) v = dv.xy;
  else {
    vec3 p = (uCamRot*vd)*dist;
    vec4 pc = uPrevVP*vec4(p,1.0);
    v = vUv-(pc.xy/pc.w*0.5+0.5);
    if (pc.w <= 0.0) v = vec2(0.0);
  }
  gl_FragColor = vec4(v, zs, dv.a);
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
  // firewall for everything downstream (blurs spread one bad pixel into a block): no Inf or NaN leaves this pass.
  // Tested on the bit pattern, because fast-math compilers may fold isnan() away.
  uvec2 eo = floatBitsToUint(off)&0x7f800000u; if (eo.x == 0x7f800000u || eo.y == 0x7f800000u) off = vec2(0.0);
  vec4 o = texture2D(tColor, vUv+off);
  uvec3 e = floatBitsToUint(o.rgb)&0x7f800000u;
  if (e.r == 0x7f800000u || e.g == 0x7f800000u || e.b == 0x7f800000u) o.rgb = vec3(0.0);
  gl_FragColor = vec4(clamp(o.rgb, 0.0, 6.0e4), o.a);
}`;
// Depth of field: half-resolution gather (after Gustafsson), blended back by blur amount
const DOF_PRE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tColor, tVelFull; uniform vec3 uDof;  // focus distance (m), px of blur per unit (z-S)/z, max blur (px)
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv).rgb; c *= min(1.0, 4.0e3/max(max(c.r, max(c.g, c.b)), 1e-6));
  float z = texture2D(tVelFull, vUv).z;
  gl_FragColor = vec4(c, clamp((z-uDof.x)/z*uDof.y, -uDof.z, uDof.z)*0.5);
}`;
const DOF_GATHER_FRAG = /* glsl */`
precision highp float;
${NOISE}
uniform sampler2D tIn; uniform vec2 uTexel; uniform float uMaxC, uFrame;
varying vec2 vUv;
void main(){
  vec4 c0 = texture2D(tIn, vUv); float cs0 = abs(c0.a);
  vec3 acc = c0.rgb; float tot = 1.0, fg = 0.0;
  float ang = fract(ign(gl_FragCoord.xy)+uFrame*0.618)*6.2831853;
  for (int i=0;i<40;i++){
    float rad = uMaxC*sqrt((float(i)+0.5)/40.0); ang += 2.39996;
    vec4 s = texture2D(tIn, vUv+vec2(cos(ang), sin(ang))*rad*uTexel); float ss = abs(s.a);
    if (s.a > c0.a) ss = clamp(ss, 0.0, cs0*2.0);   // a background sample cannot smear over a sharper, nearer centre
    float m = smoothstep(rad-0.5, rad+0.5, ss);
    acc += mix(acc/tot, s.rgb, m); tot += 1.0;
    fg += m*step(s.a, -0.6);
  }
  gl_FragColor = vec4(acc/tot, max(smoothstep(0.35, 1.5, cs0), clamp(fg/40.0*3.0, 0.0, 1.0)));
}`;
const DOF_COMP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tColor, tBlur;
varying vec2 vUv;
void main(){ vec4 b = texture2D(tBlur, vUv); vec4 c = texture2D(tColor, vUv); gl_FragColor = vec4(mix(c.rgb, b.rgb, b.a), c.a); }`;

// Light shafts: sky near the sun, blurred radially away from it (quarter resolution)
const RAY_MASK_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tColor, tDepth; uniform mat4 uInvProj; uniform mat3 uCamRot; uniform vec3 uSunDir; uniform vec2 uRayM;   // cone sharpness, brightness cap
varying vec2 vUv;
void main(){
  vec4 q = uInvProj*vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 rd = normalize(uCamRot*normalize(q.xyz/q.w));
  float m = step(0.999999, texture2D(tDepth, vUv).x)*pow(max(dot(rd,uSunDir), 0.0), uRayM.x);
  vec3 c = texture2D(tColor, vUv).rgb;
  gl_FragColor = vec4(c*min(1.0, uRayM.y/max(max(c.r, max(c.g, c.b)), 1e-6))*m, 1.0);   // cap brightness, keep the sun's hue
}`;
const RAY_BLUR_FRAG = /* glsl */`
precision highp float;
${NOISE}
uniform sampler2D tIn; uniform vec2 uSunUV; uniform float uFrame; uniform vec3 uRayK;   // reach (fraction of the way to the sun), fall-off per frame height, aspect
varying vec2 vUv;
void main(){
  vec2 delta = (vUv-uSunUV)*(uRayK.x/44.0); vec2 uv = vUv-delta*fract(ign(gl_FragCoord.xy)+uFrame*0.618);
  vec3 acc = vec3(0.0); float illum = 1.0;
  for (int i=0;i<44;i++){ acc += texture2D(tIn, uv).rgb*illum; uv -= delta; illum *= 0.965; }
  float r = length((vUv-uSunUV)*vec2(uRayK.z, 1.0));
  gl_FragColor = vec4(acc/44.0*exp(-uRayK.y*r), 1.0);   // shafts die out away from the sun instead of crossing the frame
}`;
// Lens artefacts from the brightest parts of the frame: ghosts, halo, horizontal streak (quarter resolution)
const FLARE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform vec4 uK; // ghost, halo, streak strength, threshold
varying vec2 vUv;
// bright parts of the frame only, with their intensity capped so a sun in shot gives a flare, not a white-out
vec3 thr(vec2 uv){
  vec3 c = texture2D(tSrc, uv).rgb; float l = max(c.r, max(c.g, c.b));
  return c/max(l, 1e-4)*min(l, uK.w*3.0)*smoothstep(uK.w, uK.w*2.5, l);
}
void main(){
  vec3 res = vec3(0.0);
  vec2 uv = vec2(1.0)-vUv, gv = (vec2(0.5)-uv);
  if (uK.x > 0.0){
    // a few small ghosts strung along the axis through the frame centre, each slightly colour-fringed
    for (int i=0;i<4;i++){
      float sc = i==0 ? 0.22 : (i==1 ? 0.46 : (i==2 ? 0.74 : 1.18));
      vec2 o = uv+gv*sc; float w = pow(clamp(1.0-length(vec2(0.5)-o)/0.7071, 0.0, 1.0), 6.0);
      vec3 tint = i==0 ? vec3(1.0,0.72,0.45) : (i==1 ? vec3(0.45,0.75,1.0) : (i==2 ? vec3(0.7,1.0,0.75) : vec3(0.85,0.65,1.0)));
      vec2 ca = gv*0.012;
      res += vec3(thr(o+ca).r, thr(o).g, thr(o-ca).b)*w*tint*uK.x*(i==3 ? 0.5 : 1.0);
    }
  }
  if (uK.y > 0.0){
    vec2 hv = normalize(gv+1e-6)*0.43, ho = uv+hv; float hw = pow(clamp(1.0-length(vec2(0.5)-ho)/0.7071, 0.0, 1.0), 5.0);
    res += vec3(thr(ho+hv*0.012).r, thr(ho).g, thr(ho-hv*0.012).b)*hw*uK.y;
  }
  if (uK.z > 0.0){
    // anamorphic streak: long, thin, fading smoothly
    vec3 st = vec3(0.0); float ws = 0.0;
    for (int i=-32;i<=32;i++){ float w = exp(-abs(float(i))/7.0); st += thr(vUv+vec2(float(i)*uTexel.x*2.2, 0.0))*w; ws += w; }
    res += st/ws*vec3(0.78,0.88,1.0)*uK.z*0.45;   // a faint, nearly neutral streak: documentary glass, not a stylised anamorphic
  }
  gl_FragColor = vec4(res, 1.0);
}`;
const BLOOM_DOWN_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tIn; uniform vec2 uTexel; uniform float uFirst;
varying vec2 vUv;
vec3 S(vec2 o){ vec3 c = texture2D(tIn, vUv+o*uTexel).rgb; return c*min(1.0, 6.0e3/max(max(c.r, max(c.g, c.b)), 1e-6)); }   // cap brightness, keep hue
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
uniform sampler2D tColor, tBloom, tDetail, tRays, tFlare, tDepth;
uniform vec2 uRes; uniform float uFrame, uExposure, uBloom, uVignette, uGrain, uCA, uLensK, uLensFit, uFade, uSat, uContrast, uSharpen, uRays, uFlare, uLogFar;
uniform vec2 uRaysNear;   // light shafts are scattered along the view ray: weight on things at 0 m, distance (m) to full (0 = off)
uniform vec3 uWB, uLift, uTint, uBloomTint; uniform int uMode; uniform vec4 uThermal; // gain, level, noise, polarity
uniform vec4 uTone; uniform vec3 uToneLo, uToneHi;   // post.tone: black point, blue saturation, top / bottom grad (stops); shadow and highlight tints
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
float raysW(vec2 uv){
  if (uRaysNear.y <= 0.0) return 1.0;
  float z = exp2(texture2D(tDepth, uv).x*uLogFar)-1.0;
  return mix(uRaysNear.x, 1.0, 1.0-exp(-z/uRaysNear.y));
}
vec3 fetch(vec2 uv){ return texture2D(tColor, uv).rgb + texture2D(tBloom, uv).rgb*uBloom*uBloomTint + texture2D(tRays, uv).rgb*uRays*raysW(uv) + texture2D(tFlare, uv).rgb*uFlare; }
void main(){
  vec2 c = vUv-0.5; vec2 asp = vec2(uRes.x/uRes.y, 1.0);
  float r2 = dot(c*asp, c*asp);
  // barrel distortion. lensFit (opt-in) scales it so the frame corners land on the source corners and nothing is
  // sampled from outside the frame (clamped edge pixels smear into streaks along the borders); the CA spread is
  // then shrunk so the red and blue taps stay inside the frame too
  float fit = mix(1.0, 1.0+uLensK*0.25*(asp.x*asp.x+1.0), uLensFit);
  vec2 uv = 0.5+c*(1.0+uLensK*r2)/fit;
  vec3 col;
  if (uCA > 0.0){
    vec2 dir = (uv-0.5)*uCA*(0.4+r2*2.0);
    if (uLensFit > 0.5){ vec2 room = max(0.5-abs(uv-0.5), vec2(0.0)); dir = clamp(dir, -room, room); }
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
  if (uTone.z+uTone.w > 0.0) col *= exp2(-uTone.z*smoothstep(0.45, 1.0, vUv.y)-uTone.w*smoothstep(0.45, 1.0, 1.0-vUv.y));   // graduated ND, top and bottom
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
    if (uTone.y != 1.0){   // saturation of blues only (hue near 225 degrees)
      float h = atan(1.7320508*(o.g-o.b), 2.0*o.r-o.g-o.b), dh = abs(mod(h+5.4977871, 6.2831853)-3.1415927);
      o = l+(o-l)*mix(1.0, uTone.y, exp(-dh*dh/0.45));
    }
    o = agxOut(o);
    if (uTone.x > 0.0) o = max(o-uTone.x, vec3(0.0))/(1.0-uTone.x);   // black point
    if (uToneLo != vec3(1.0) || uToneHi != vec3(1.0)) o *= mix(uToneLo, uToneHi, smoothstep(0.0, 0.7, dot(o, vec3(0.2126,0.7152,0.0722))));   // split tone
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
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false;
    r.setPixelRatio(1);
    this.maxAniso = r.capabilities.getMaxAnisotropy();
    if (!r.capabilities.isWebGL2) throw new Error('WebGL 2 is not available in this browser.');
    this.floatLinear = !!r.extensions.get('OES_texture_float_linear');
    if (!r.extensions.get('EXT_color_buffer_float') && !r.extensions.get('EXT_color_buffer_half_float')) throw new Error('This device cannot render to floating-point textures.');

    this.atmo = new Atmosphere();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.3, q.far);
    this.camera.layers.enable(LAYER.DYNAMIC);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);
    this.shadowFocus = new THREE.Vector3(); this.shadowRadius = 14;

    this.prevVP = new THREE.Matrix4();
    this.dynamic = [];
    this.deferred = [];      // objects with shade(renderer, sceneTexture, target) -> true if they drew
    this.clouds = null;      // optional volumetric cloud layer: { render(pipe, opts) -> texture, base, top }
    this.frame = 0;
    this.camAlt = 0; this.origin = new THREE.Vector3();
    this._v = new THREE.Vector3();

    this.detail = makeDetailTexture(Math.min(2, this.maxAniso));
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.white.needsUpdate = true;
    const A = this.atmo.uniforms;
    const shared = this.shared = {
      tDepth: { value: null }, tDetail: { value: this.detail }, tSky: { value: null }, tAmbient: { value: null },
      uLogFar: { value: Math.log2(q.far + 1) }, uRes: { value: new THREE.Vector2(1, 1) }, uCamAlt: { value: 0 },
      uOrigin: { value: new THREE.Vector3() }, uTime: { value: 0 }, uFrame: { value: 0 },
      uSunColor: { value: new THREE.Color() }, uGroundAlb: { value: this.atmo.groundAlbedo },
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() },
      tApI: { value: null }, tApT: { value: null },
      ...A,
    };

    const fopt = { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const hopt = { ...fopt, type: THREE.HalfFloatType };
    this.rtSky = new THREE.WebGLRenderTarget(256, 384, this.floatLinear ? fopt : hopt);   // 32-bit float is not filterable without OES_texture_float_linear (iOS, many phones)
    this.rtSky.texture.wrapS = THREE.RepeatWrapping;
    this.rtAmbient = new THREE.WebGLRenderTarget(1, 1, { ...fopt, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rtApI = new THREE.WebGLRenderTarget(512, 144, hopt); this.rtApT = new THREE.WebGLRenderTarget(512, 144, hopt);
    shared.tSky.value = this.rtSky.texture; shared.tAmbient.value = this.rtAmbient.texture;
    shared.tApI.value = this.rtApI.texture; shared.tApT.value = this.rtApT.texture;

    this.pSky = new Pass(SKY_LUT_FRAG, { ...A, uCamAlt: shared.uCamAlt, uGroundAlb: shared.uGroundAlb });
    this.pAmbient = new Pass(AMBIENT_FRAG, { ...A, tSky: shared.tSky });
    this.pAp = new Pass(AP_FRAG, { ...A, uInvProj: shared.uInvProj, uCamRot: shared.uCamRot, uCamAlt: shared.uCamAlt, uWhich: { value: 0 } });
    this.pAO = new Pass(AO_FRAG, { tDepth: shared.tDepth, uLogFar: shared.uLogFar, uInvProj: shared.uInvProj, uRes: shared.uRes, uAO: { value: new THREE.Vector3(0.9, 0.7, 1) } });
    this.pAOBlur = new Pass(AO_BLUR_FRAG, { tIn: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.pAtmo = new Pass(ATMO_FRAG, {
      ...A, tScene: { value: null }, tDepth: shared.tDepth, tSky: shared.tSky, tDetail: shared.tDetail, tAmbient: shared.tAmbient,
      tApI: shared.tApI, tApT: shared.tApT, tAO: { value: this.white }, tCloud: { value: this.black },
      uInvProj: shared.uInvProj, uCamRot: shared.uCamRot, uCamAlt: shared.uCamAlt, uFrame: shared.uFrame,
      uLogFar: shared.uLogFar, uSunDisk: { value: 0.05 }, uAerial: { value: 1 }, uOrigin: shared.uOrigin,
      uCirrus: { value: new THREE.Vector4(10500, 0, 0, 1) }, uCirrusWind: { value: new THREE.Vector2() },
      uCloud: { value: new THREE.Vector4(0, 3000, 5000, 0) }, uAOk: { value: new THREE.Vector3(0, 1, 1) },
    });
    this.skyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: SKY_BG_VERT, fragmentShader: SKY_BG_FRAG, depthWrite: false,
      uniforms: { ...A, tSky: shared.tSky, uInvProj: shared.uInvProj, uCamRot: shared.uCamRot, uCamAlt: shared.uCamAlt, uSunDisk: this.pAtmo.u.uSunDisk },
    }));
    this.skyQuad.frustumCulled = false; this.skyQuad.renderOrder = -1e9; this.skyQuad.layers.set(LAYER.STATIC); this.skyQuad.name = 'sky-background';
    this.scene.add(this.skyQuad);
    this.velMat = new THREE.ShaderMaterial({ vertexShader: VEL_VERT, fragmentShader: VEL_FRAG, uniforms: { uPrevMVP: { value: new THREE.Matrix4() } }, side: THREE.DoubleSide });
    this.velMat.isVelocityMaterial = true;
    this.pVelFull = new Pass(VELFULL_FRAG, { tDepth: shared.tDepth, tVel: { value: null }, uInvProj: shared.uInvProj, uPrevVP: { value: this.prevVP }, uCamRot: shared.uCamRot, uLogFar: shared.uLogFar });
    this.pTile = new Pass(TILEMAX_FRAG, { tIn: { value: null }, uStep: { value: new THREE.Vector2() }, uCount: { value: 1 } });
    this.pBlur = new Pass(MBLUR_FRAG, { tColor: { value: null }, tVelFull: { value: null }, tTile: { value: null }, uRes: shared.uRes, uShutter: { value: 0.5 }, uMaxPx: { value: 48 }, uFrame: shared.uFrame });
    this.pDistort = new Pass(DISTORT_FRAG, { tColor: { value: null }, tDist: { value: null }, tDetail: shared.tDetail, tVelFull: { value: null }, uRes: shared.uRes, uTime: shared.uTime, uShimmer: { value: new THREE.Vector3(0, 1, 2000) } });
    this.pDofPre = new Pass(DOF_PRE_FRAG, { tColor: { value: null }, tVelFull: { value: null }, uDof: { value: new THREE.Vector3(10, 1, 20) } });
    this.pDofGather = new Pass(DOF_GATHER_FRAG, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uMaxC: { value: 10 }, uFrame: shared.uFrame });
    this.pDofComp = new Pass(DOF_COMP_FRAG, { tColor: { value: null }, tBlur: { value: null } });
    this.pRayMask = new Pass(RAY_MASK_FRAG, { tColor: { value: null }, tDepth: shared.tDepth, uInvProj: shared.uInvProj, uCamRot: shared.uCamRot, uSunDir: A.uSunDir, uRayM: { value: new THREE.Vector2(20, 80) } });
    this.pRayBlur = new Pass(RAY_BLUR_FRAG, { tIn: { value: null }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uFrame: shared.uFrame, uRayK: { value: new THREE.Vector3(0.92, 0, 16 / 9) } });
    this.pFlare = new Pass(FLARE_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uK: { value: new THREE.Vector4(0, 0, 0, 10) } });
    this.pDown = new Pass(BLOOM_DOWN_FRAG, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 1 } });
    this.pUp = new Pass(BLOOM_UP_FRAG, { tIn: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 0.5 } });
    this.pFinal = new Pass(FINAL_FRAG, {
      tColor: { value: null }, tBloom: { value: null }, tDetail: shared.tDetail, tRays: { value: this.black }, tFlare: { value: this.black },
      tDepth: shared.tDepth, uLogFar: shared.uLogFar, uRaysNear: { value: new THREE.Vector2(1, 0) },
      uRes: shared.uRes, uFrame: shared.uFrame,
      uExposure: { value: 0.25 }, uBloom: { value: 0.06 }, uVignette: { value: 0.25 }, uGrain: { value: 0.035 }, uCA: { value: 0.0012 },
      uLensK: { value: 0.0 }, uLensFit: { value: 0 }, uFade: { value: 1 }, uSat: { value: 1.12 }, uContrast: { value: 1.12 }, uSharpen: { value: 0.0 }, uRays: { value: 0 }, uFlare: { value: 0 },
      uWB: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3(0, 0, 0) }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uBloomTint: { value: new THREE.Vector3(1, 1, 1) },
      uMode: { value: 0 }, uThermal: { value: new THREE.Vector4(2.2, 0.3, 0.06, 0) },
      uTone: { value: new THREE.Vector4(0, 1, 0, 0) }, uToneLo: { value: new THREE.Vector3(1, 1, 1) }, uToneHi: { value: new THREE.Vector3(1, 1, 1) },
    });

    // environment probe (image-based lighting for PBR materials)
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new THREE.Scene();
    const envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthTest: false, depthWrite: false,
      uniforms: { ...A, uCamAlt: shared.uCamAlt, uGroundAlb: shared.uGroundAlb, uDeck: { value: new THREE.Vector2(0, 0) }, uOver: { value: new THREE.Vector4(0, 0, 0, 0) },
        uEnvG: { value: new THREE.Vector4(0, 0, 0, 0) }, uEnvGShade: { value: 0 }, uSea: { value: 0 },
        tDetail: shared.tDetail, tAmbient: shared.tAmbient, uSunColor: shared.uSunColor, uECov: { value: new THREE.Vector4(0, 1, 0, 0) }, uEHole: { value: new THREE.Vector4(0, 0, 1, 0) },
        uECloud: { value: new THREE.Vector4() }, uEFog: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: ENV_FRAG,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat)); this.envDeck = envMat.uniforms.uDeck.value; this.envOver = envMat.uniforms.uOver.value; this.envMat = envMat; this.envSea = envMat.uniforms.uSea; this.envU = envMat.uniforms;
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
    for (const k of ['rtScene', 'rtVel', 'rtA', 'rtB', 'rtC', 'rtVelFull', 'rtTileH', 'rtTile', 'rtTileN', 'rtDist', 'rtAO', 'rtAO2', 'rtDofA', 'rtDofB', 'rtRayA', 'rtRayB', 'rtFlare']) this[k]?.dispose();
    (this.bloom || []).forEach(t => t.dispose()); (this.bloomUp || []).forEach(t => t.dispose());
    const hf = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const near = { ...hf, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...hf, samples: q.msaa, depthBuffer: true, depthTexture: depth });
    this.shared.tDepth.value = depth;
    this.rtVel = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rtA = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false });
    this.rtC = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false });
    this.rtVelFull = new THREE.WebGLRenderTarget(w, h, near);
    this.tile = Math.max(8, Math.round(h / 34));
    const tw = Math.ceil(w / this.tile), th = Math.ceil(h / this.tile);
    this.rtTileH = new THREE.WebGLRenderTarget(tw, h, near);
    this.rtTile = new THREE.WebGLRenderTarget(tw, th, near);
    this.rtTileN = new THREE.WebGLRenderTarget(tw, th, near);
    const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2), w4 = Math.ceil(w / 4), h4 = Math.ceil(h / 4);
    this.rtDist = new THREE.WebGLRenderTarget(w2, h2, { ...hf, depthBuffer: false });
    this.rtAO = new THREE.WebGLRenderTarget(w2, h2, near); this.rtAO2 = new THREE.WebGLRenderTarget(w2, h2, near);
    this.rtDofA = new THREE.WebGLRenderTarget(w2, h2, { ...hf, depthBuffer: false }); this.rtDofB = new THREE.WebGLRenderTarget(w2, h2, { ...hf, depthBuffer: false });
    this.rtRayA = new THREE.WebGLRenderTarget(w4, h4, { ...hf, depthBuffer: false }); this.rtRayB = new THREE.WebGLRenderTarget(w4, h4, { ...hf, depthBuffer: false });
    this.rtFlare = new THREE.WebGLRenderTarget(w4, h4, { ...hf, depthBuffer: false });
    this.bloom = []; this.bloomUp = [];
    let bw = w, bh = h;
    for (let i = 0; i < q.bloomLevels; i++) {
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
      this.bloom.push(new THREE.WebGLRenderTarget(bw, bh, { ...hf, depthBuffer: false }));
      this.bloomUp.push(new THREE.WebGLRenderTarget(bw, bh, { ...hf, depthBuffer: false }));
    }
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.clouds && this.clouds.setSize && this.clouds.setSize(w, h);
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

  // forces the GPU to finish and records elapsed ms under `name` (only when this.prof is set)
  mark(name) {
    if (!this.prof) return;
    const gl = this.renderer.getContext(); gl.finish();
    const fmt = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT), type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
    const px = type === gl.FLOAT ? new Float32Array(4) : (type === gl.HALF_FLOAT ? new Uint16Array(4) : new Uint8Array(4));
    gl.readPixels(0, 0, 1, 1, fmt, type, px);
    const now = performance.now(); this.prof[name] = (this.prof[name] || 0) + now - this._pt; this._pt = now;
  }

  // post: { exposure, bloom, bloomTint, vignette, grain, ca, lensK, fade, sat, contrast, wb, lift, tint, shutter, shimmer:[amp,scale,far],
  //         sunDisk, aerial, mode, thermal, sharpen, envKey, envSea (0..1: the probe's ground is open water), cirrus:{alt,cover,opacity,scale,wind}, clouds:{...},
  //         ao:{radius,strength}|false, dof:{focus,fstop,max}, rays, rayShape:{reach,fall,cone,cap}, raysNear:[weight at 0 m, metres to full weight],
  //         flare:{ghost,halo,streak,thr}, lensFit (scale lensK so nothing is sampled from outside the frame),
  //         tone:{black (display black point, 0), blueSat (1), grad:[top, bottom] (stops, 0), shadows:[r,g,b], highlights:[r,g,b] (split tone, 1)},
  //         envDeck, envOver:{base,cover,gain}|true, envDesat, envGround:{albedo,h,shade}, envClouds (0..1: the cloud layer, and over envSea the sun's glitter) (reflection probe, all opt-in) }
  render(time, frameIndex, post = {}) {
    const r = this.renderer, S = this.shared, cam = this.camera, sc = this.scene;
    if (this.prof) { this.prof = {}; r.getContext().finish(); this._pt = performance.now(); }
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

    // sky LUT + hemisphere irradiance only when sun / altitude / haze change; IBL when the key changes
    const A = this.atmo.uniforms, sk = `${A.uSunDir.value.x.toFixed(4)},${A.uSunDir.value.y.toFixed(4)},${A.uSunDir.value.z.toFixed(4)},${Math.round(this.camAlt / 25)},${A.uHaze.value},${A.uHazeH.value},${A.uMieG.value},${A.uMS.value}`;
    if (sk !== this.skyKey) { this.skyKey = sk; this.pSky.render(r, this.rtSky); this.pAmbient.render(r, this.rtAmbient); }
    { // reflections: a cloud deck under the camera brightens the lower half of what metal sees
      const dk = post.envDeck ?? (this.clouds && post.clouds ? { alt: this.clouds.top - 350, k: 0.6 * Math.min(1, (post.clouds.cover ?? 0.35) * 1.5) } : null);
      this.envDeck.set(dk ? dk.alt : 0, dk ? dk.k : 0);
      // opt-in: a cloud layer above the camera (true: the volumetric layer and its cover) and a less saturated clear sky
      const ov = post.envOver === true ? (this.clouds && post.clouds ? { base: this.clouds.base, cover: post.clouds.cover ?? 0.35 } : null) : post.envOver;
      this.envOver.set(ov ? ov.base : 0, ov ? ov.cover : 0, ov ? (ov.gain ?? 1) : 0, post.envDesat ?? 0);
      // opt-in: the pavement under a camera on the ground, {albedo:[r,g,b] linear, h: camera height (m), shade: 0..1}
      const eg = post.envGround, gu = this.envMat.uniforms;
      gu.uEnvG.value.set(eg ? eg.albedo[0] : 0, eg ? eg.albedo[1] : 0, eg ? eg.albedo[2] : 0, eg ? (eg.h ?? 2) : 0); gu.uEnvGShade.value = eg ? (eg.shade ?? 0) : 0;
    }
    this.envSea.value = post.envSea ?? 0;
    // the cloud deck (and over the sea the sun's glitter) in the probe: a key per 1.5 km of camera travel
    const ec = post.envClouds && this.clouds && post.clouds ? post.envClouds : 0, eu = this.envU;
    if (ec) {
      this.clouds.setCover(post.clouds, time);
      eu.uECov.value.copy(this.clouds.cover.uCov.value); eu.uEHole.value.copy(this.clouds.cover.uCovHole.value);
      eu.uECloud.value.set((this.clouds.base + this.clouds.top) / 2, ec, this.origin.x, this.origin.z); eu.uEFog.value = 4.44e-6 * A.uHaze.value + 1.3e-5;
    } else eu.uECloud.value.y = 0;
    this.updateEnvironment((post.envKey ?? 'default') + (post.envSea ? ':sea' + post.envSea : '') + (ec ? `:cl${ec}@${Math.round(this.origin.x / 1500)},${Math.round(this.origin.z / 1500)},${(post.clouds.cover ?? 0.35).toFixed(2)}` : ''));
    // aerial-perspective froxels follow the camera every frame
    this.pAp.u.uWhich.value = 0; this.pAp.render(r, this.rtApI);
    this.pAp.u.uWhich.value = 1; this.pAp.render(r, this.rtApT);
    this.mark('sky+env');

    // 1. opaque scene (the sky background reads the sun-disk strength)
    this.pAtmo.u.uSunDisk.value = post.sunDisk ?? 0.05;
    cam.layers.set(LAYER.STATIC); cam.layers.enable(LAYER.DYNAMIC);
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtScene); r.setClearColor(0x000000, 1); r.clear();
    r.render(sc, cam);
    if (this.prof) r.setRenderTarget(this.rtVel);
    this.mark('scene');

    // 2. motion vectors of moving geometry
    sc.overrideMaterial = this.velMat;
    cam.layers.set(LAYER.DYNAMIC);
    r.setRenderTarget(this.rtVel); r.setClearColor(0x000000, 0); r.clear();
    r.render(sc, cam);
    sc.overrideMaterial = null;
    this.mark('velocity');

    // 3. deferred lighting of depth-only geometry (terrain): one evaluation per pixel
    let sceneTex = this.rtScene.texture, dT = this.rtB;
    for (const d of this.deferred) { if (d.shade(r, sceneTex, dT)) { sceneTex = dT.texture; dT = dT === this.rtB ? this.rtC : this.rtB; } this.mark('deferred.' + (d.profName || d.constructor.name)); }

    // 4. ambient occlusion (half resolution, edge-aware blur)
    const ua = this.pAtmo.u, ao = post.ao === false ? null : (post.ao || {});
    if (ao && (ao.strength ?? 0.7) > 0) {
      const u = this.pAO.u; u.uAO.value.set(ao.radius ?? 0.9, 1, 0.5 * this.h / Math.tan(cam.fov * Math.PI / 360));
      this.pAO.render(r, this.rtAO);
      const b = this.pAOBlur.u;
      b.tIn.value = this.rtAO.texture; b.uDir.value.set(1 / this.rtAO.width, 0); this.pAOBlur.render(r, this.rtAO2);
      b.tIn.value = this.rtAO2.texture; b.uDir.value.set(0, 1 / this.rtAO.height); this.pAOBlur.render(r, this.rtAO);
      ua.tAO.value = this.rtAO.texture; ua.uAOk.value.set(ao.strength ?? 0.7, this.rtAO.width, this.rtAO.height);
    } else { ua.tAO.value = this.white; ua.uAOk.value.set(0, 1, 1); }
    this.mark('ao');

    // 5. volumetric clouds (own module), then sky + aerial perspective + composite
    if (this.clouds && post.clouds) {
      const tex = this.clouds.render(this, post.clouds, time);
      ua.tCloud.value = tex; ua.uCloud.value.set(1, this.clouds.base, this.clouds.top, 0);
    } else { ua.tCloud.value = this.black; ua.uCloud.value.x = 0; }
    this.mark('clouds');
    ua.tScene.value = sceneTex;
    ua.uSunDisk.value = post.sunDisk ?? 0.05; ua.uAerial.value = post.aerial ?? 1;
    const ci = post.cirrus;
    if (ci) { ua.uCirrus.value.set(ci.alt ?? 10500, ci.cover ?? 0.4, ci.opacity ?? 0.5, ci.scale ?? 1); ua.uCirrusWind.value.set((ci.wind?.[0] ?? 0) * time, (ci.wind?.[1] ?? 0) * time); }
    else ua.uCirrus.value.z = 0;
    this.pAtmo.render(r, this.rtA);
    this.mark('atmosphere');

    // 6. transparent FX over the lit, fogged scene; refraction sources (heat haze, shock fronts)
    cam.layers.set(LAYER.FX);
    r.setRenderTarget(this.rtA);
    r.render(sc, cam);
    cam.layers.set(LAYER.DISTORT);
    r.setRenderTarget(this.rtDist); r.setClearColor(0x000000, 0); r.clear();
    r.render(sc, cam);
    cam.layers.set(LAYER.STATIC); cam.layers.enable(LAYER.DYNAMIC);
    this.mark('fx');

    // 7. velocity field + refraction
    this.pVelFull.u.tVel.value = this.rtVel.texture;
    this.pVelFull.render(r, this.rtVelFull);
    const sh2 = post.shimmer || [0, 1, 2000];
    const ud = this.pDistort.u;
    ud.tColor.value = this.rtA.texture; ud.tDist.value = this.rtDist.texture; ud.tVelFull.value = this.rtVelFull.texture;
    ud.uShimmer.value.set(sh2[0] * this.h / 1080, sh2[1] * this.h / 1080, sh2[2]);
    this.pDistort.render(r, this.rtB);
    let cur = this.rtB, other = this.rtA;
    this.mark('refraction');

    // 8. depth of field
    const dof = post.dof;
    if (dof && dof.fstop && dof.focus > 0) {
      const f = 0.012 / Math.tan(cam.fov * Math.PI / 360);                       // focal length (m) on a 24 mm-high sensor
      const K = f * f / (dof.fstop * Math.max(dof.focus - f, 1e-3)) * (this.h / 0.024), maxC = Math.min(dof.max ?? 0.022 * this.h, 0.03 * this.h);
      const u = this.pDofPre.u; u.tColor.value = cur.texture; u.tVelFull.value = this.rtVelFull.texture; u.uDof.value.set(dof.focus, K, maxC);
      this.pDofPre.render(r, this.rtDofA);
      const g = this.pDofGather.u; g.tIn.value = this.rtDofA.texture; g.uTexel.value.set(1 / this.rtDofA.width, 1 / this.rtDofA.height); g.uMaxC.value = maxC * 0.5;
      this.pDofGather.render(r, this.rtDofB);
      const c = this.pDofComp.u; c.tColor.value = cur.texture; c.tBlur.value = this.rtDofB.texture;
      this.pDofComp.render(r, other);
      [cur, other] = [other, cur];
    }
    this.mark('dof');

    // 9. motion blur
    const shutter = post.shutter ?? 0.5;
    if (shutter > 0) {
      const ut = this.pTile.u;
      ut.tIn.value = this.rtVelFull.texture; ut.uCount.value = this.tile; ut.uStep.value.set(1 / this.w, 0);
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
    this.mark('motionblur');

    // 10. light shafts from the sun when it is in or near the frame
    const uf = this.pFinal.u;
    let rays = post.rays ?? 0;
    if (rays > 0) {
      const sv = this._v.copy(this.atmo.sunDir).transformDirection(cam.matrixWorldInverse);
      const P = cam.projectionMatrix.elements;
      if (sv.z < -0.02) {
        const sx = sv.x / -sv.z * P[0] * 0.5 + 0.5, sy = sv.y / -sv.z * P[5] * 0.5 + 0.5;
        const off = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
        rays *= Math.min(1, Math.max(0, (1.6 - off) / 0.6)) * Math.min(1, -sv.z / 0.25);
        if (rays > 0.001) {
          const rs = post.rayShape || {};   // optional: { reach (0.92), fall (0: none), cone (20), cap (80) }
          this.pRayMask.u.uRayM.value.set(rs.cone ?? 20, rs.cap ?? 80);
          this.pRayMask.u.tColor.value = cur.texture; this.pRayMask.render(r, this.rtRayA);
          this.pRayBlur.u.uRayK.value.set(rs.reach ?? 0.92, rs.fall ?? 0, this.w / this.h);
          this.pRayBlur.u.tIn.value = this.rtRayA.texture; this.pRayBlur.u.uSunUV.value.set(sx, sy); this.pRayBlur.render(r, this.rtRayB);
        }
      } else rays = 0;
    }
    uf.tRays.value = rays > 0.001 ? this.rtRayB.texture : this.black; uf.uRays.value = rays > 0.001 ? rays : 0;
    uf.uRaysNear.value.set(post.raysNear?.[0] ?? 1, post.raysNear?.[1] ?? 0);
    this.mark('rays');

    // 11. bloom
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
    // lens ghosts / halo / streak from the brightest pixels
    const fl = post.flare, exposure = post.exposure ?? 0.25;
    if (fl && ((fl.ghost ?? 0) > 0 || (fl.halo ?? 0) > 0 || (fl.streak ?? 0) > 0)) {
      const u = this.pFlare.u; u.tSrc.value = B[1].texture; u.uTexel.value.set(1 / B[1].width, 1 / B[1].height);
      u.uK.value.set(fl.ghost ?? 0, fl.halo ?? 0, fl.streak ?? 0, (fl.thr ?? 3.2) / exposure);
      this.pFlare.render(r, this.rtFlare);
      uf.tFlare.value = this.rtFlare.texture; uf.uFlare.value = 1;
    } else { uf.tFlare.value = this.black; uf.uFlare.value = 0; }
    this.mark('bloom');

    // 12. lens, tone map, grade
    uf.tColor.value = cur.texture; uf.tBloom.value = up;
    uf.uExposure.value = exposure; uf.uBloom.value = post.bloom ?? 0.06;
    uf.uVignette.value = post.vignette ?? 0.25; uf.uGrain.value = post.grain ?? 0.035; uf.uCA.value = post.ca ?? 0.0012;
    uf.uLensK.value = post.lensK ?? 0; uf.uLensFit.value = post.lensFit ? 1 : 0; uf.uFade.value = post.fade ?? 1; uf.uSat.value = post.sat ?? 1.12; uf.uContrast.value = post.contrast ?? 1.12;
    uf.uSharpen.value = post.sharpen ?? 0;
    uf.uWB.value.fromArray(post.wb || [1, 1, 1]); uf.uLift.value.fromArray(post.lift || [0, 0, 0]); uf.uTint.value.fromArray(post.tint || [1, 1, 1]);
    uf.uBloomTint.value.fromArray(post.bloomTint || [1, 1, 1]);
    { const tn = post.tone || {}; uf.uTone.value.set(tn.black ?? 0, tn.blueSat ?? 1, tn.grad?.[0] ?? 0, tn.grad?.[1] ?? 0); uf.uToneLo.value.fromArray(tn.shadows || [1, 1, 1]); uf.uToneHi.value.fromArray(tn.highlights || [1, 1, 1]); }
    uf.uMode.value = post.mode === 'thermal' ? 1 : 0;
    if (post.thermal) uf.uThermal.value.fromArray(post.thermal);
    if (post.debug === 'scene') uf.tColor.value = sceneTex;
    else if (post.debug === 'ao') uf.tColor.value = this.rtAO.texture;
    else if (post.debug === 'vel') uf.tColor.value = this.rtVelFull.texture;
    else if (post.debug === 'tile') uf.tColor.value = this.rtTileN.texture;
    this.pFinal.render(r, null);
    this.mark('final');
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
