// Volumetric cloud layer: a ray-marched slab of procedural cumulus / altocumulus between two altitudes, lit by
// the sun (cone-sampled self shadowing, multi-octave scattering) and the sky, with matching shadows for the ground.
// Rendered at reduced resolution into (rgb = in-scattered light, a = transmittance); the atmosphere pass
// composites it at the right depth.
import * as THREE from 'three';
import { NOISE, DEPTH, FSQ_VERT } from './glsl.js';
import { Pass } from './pipeline.js';

// Column coverage 0..1 at a world position (shared with the terrain so cloud shadows line up).
// uCov: coverage 0..1, feature scale (km per unit), wind offset (km). uCovHole: xz centre (m), radius (m), strength.
export const CLOUD_COVER = /* glsl */`
uniform vec4 uCov, uCovHole;
// l: extra blur (mip levels); 0 for the cloud march, about 0.5 for the penumbra of shadows on the ground
float cloudCoverL(vec2 wxz, float l){
  vec2 q = wxz*0.001/uCov.y+uCov.zw;
  float n = textureLod(tDetail, q*0.011, l).r*0.5+textureLod(tDetail, q*0.043+0.31, l+1.0).g*0.33+textureLod(tDetail, q*0.17+0.7, l+2.0+l*4.0).r*0.17;
  float thr = mix(0.66, 0.12, uCov.x);
  float c = smoothstep(thr, thr+0.42, n);
  if (uCovHole.w > 0.0) c *= 1.0-uCovHole.w*(1.0-smoothstep(uCovHole.z*0.55, uCovHole.z, length(wxz-uCovHole.xy)));
  return c;
}
float cloudCover(vec2 wxz){ return cloudCoverL(wxz, 0.0); }`;

// tileable Perlin-Worley volume (after Schneider / piyushslayer): r = billowy base, gba = Worley octaves
const NOISE3_FRAG = /* glsl */`
precision highp float;
uniform float uSlice;
varying vec2 vUv;
vec3 hash33(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453123); }
float remap(float x, float a, float b, float c, float d){ return (((x-a)/(b-a))*(d-c))+c; }
float gradNoise(vec3 x, float freq){
  vec3 p = floor(x), w = fract(x);
  vec3 u = w*w*w*(w*(w*6.0-15.0)+10.0);
  vec3 ga = hash33(mod(p+vec3(0,0,0),freq))*2.0-1.0, gb = hash33(mod(p+vec3(1,0,0),freq))*2.0-1.0;
  vec3 gc = hash33(mod(p+vec3(0,1,0),freq))*2.0-1.0, gd = hash33(mod(p+vec3(1,1,0),freq))*2.0-1.0;
  vec3 ge = hash33(mod(p+vec3(0,0,1),freq))*2.0-1.0, gf = hash33(mod(p+vec3(1,0,1),freq))*2.0-1.0;
  vec3 gg = hash33(mod(p+vec3(0,1,1),freq))*2.0-1.0, gh = hash33(mod(p+vec3(1,1,1),freq))*2.0-1.0;
  float va = dot(ga,w-vec3(0,0,0)), vb = dot(gb,w-vec3(1,0,0)), vc = dot(gc,w-vec3(0,1,0)), vd = dot(gd,w-vec3(1,1,0));
  float ve = dot(ge,w-vec3(0,0,1)), vf = dot(gf,w-vec3(1,0,1)), vg = dot(gg,w-vec3(0,1,1)), vh = dot(gh,w-vec3(1,1,1));
  return va+u.x*(vb-va)+u.y*(vc-va)+u.z*(ve-va)+u.x*u.y*(va-vb-vc+vd)+u.y*u.z*(va-vc-ve+vg)+u.z*u.x*(va-vb-ve+vf)+u.x*u.y*u.z*(-va+vb+vc-vd+ve-vf-vg+vh);
}
float worley(vec3 uvw, float freq){
  vec3 id = floor(uvw*freq), p = fract(uvw*freq); float md = 1.0e4;
  for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++) for (int z=-1;z<=1;z++){
    vec3 o = vec3(float(x),float(y),float(z)); vec3 d = o+hash33(mod(id+o, vec3(freq)))-p; md = min(md, dot(d,d));
  }
  return 1.0-clamp(md, 0.0, 1.0);
}
float perlinFbm(vec3 p, float freq){ float a = 1.0, n = 0.0; for (int i=0;i<6;i++){ n += a*gradNoise(p*freq, freq); freq *= 2.0; a *= 0.55; } return n; }
float worleyFbm(vec3 p, float freq){ return worley(p,freq)*0.625+worley(p,freq*2.0)*0.25+worley(p,freq*4.0)*0.125; }
void main(){
  vec3 uvw = vec3(vUv, uSlice);
  float pf = mix(1.0, perlinFbm(uvw, 4.0), 0.5); pf = abs(pf*2.0-1.0);
  float g = worleyFbm(uvw, 4.0), b = worleyFbm(uvw, 8.0), a = worleyFbm(uvw, 16.0);
  gl_FragColor = vec4(remap(pf, 0.0, 1.0, g, 1.0), g, b, a);
}`;

const CLOUD_FRAG = /* glsl */`
precision highp float; precision highp sampler3D;
${NOISE}
${DEPTH}
uniform sampler2D tDepth, tDetail; uniform sampler3D tNoise3;
uniform mat4 uInvProj; uniform mat3 uCamRot; uniform float uCamAlt, uFrame;
uniform vec3 uOrigin, uSunDir, uSunC, uAmbTop, uAmbBot;
uniform vec4 uLayer;   // base, top (m MSL), extinction (1/m at density 1), metres per noise tile
uniform vec4 uMarch;   // steps, first light step (m), max march distance (m), erosion strength
uniform vec3 uShape;   // noise wind offset (tiles)
uniform float uGain; uniform vec2 uShear;
${CLOUD_COVER}
varying vec2 vUv;
const float RGc = 6360000.0;
float remap(float x, float a, float b, float c, float d){ return (((x-a)/(b-a))*(d-c))+c; }
float hg(float c, float g){ return (1.0-g*g)/(12.566371*pow(max(1.0+g*g-2.0*g*c, 1e-4), 1.5)); }
// first interval of the ray inside the spherical layer
bool shellSegment(vec3 ro, vec3 rd, out float t0, out float t1){
  float Rb = RGc+uLayer.x, Rt = RGc+uLayer.y, b = dot(ro,rd), r2 = dot(ro,ro);
  float dT = b*b-(r2-Rt*Rt), dB = b*b-(r2-Rb*Rb);
  t0 = 0.0; t1 = 0.0;
  if (r2 > Rt*Rt){
    if (dT <= 0.0 || b >= 0.0) return false;
    float sT = sqrt(dT); t0 = -b-sT; t1 = dB > 0.0 ? -b-sqrt(dB) : -b+sT;
  } else if (r2 < Rb*Rb){
    t0 = -b+sqrt(max(dB,0.0)); t1 = -b+sqrt(max(dT,0.0));
  } else {
    t1 = (dB > 0.0 && b < 0.0) ? -b-sqrt(dB) : -b+sqrt(max(dT,0.0));
  }
  return t1 > t0;
}
float cloudDensity(vec2 wxz, float alt, out float h01, bool cheap){
  h01 = (alt-uLayer.x)/(uLayer.y-uLayer.x);
  if (h01 <= 0.0 || h01 >= 1.0) return 0.0;
  float cov = cloudCover(wxz+uShear*(alt-uLayer.x));        // wind shear leans the towers
  if (cov <= 0.02) return 0.0;
  float top = 0.22+0.78*cov;                                 // strong cells build higher
  float prof = smoothstep(0.0, 0.07, h01)*smoothstep(top, top*0.25, h01);
  vec3 q = vec3(wxz.x, alt, wxz.y)/uLayer.w+uShape;
  vec4 n = texture(tNoise3, q);
  float lf = n.g*0.625+n.b*0.25+n.a*0.125;
  float base = clamp(remap(n.r, lf-1.0, 1.0, 0.0, 1.0), 0.0, 1.0)*prof;
  float c2 = clamp(remap(base, 1.0-cov, 1.0, 0.0, 1.0), 0.0, 1.0);
  if (!cheap && c2 > 0.0 && uMarch.w > 0.0){
    vec4 hf = texture(tNoise3, q*5.3+0.37);
    float hfn = hf.g*0.625+hf.b*0.25+hf.a*0.125;
    c2 = clamp(remap(c2, mix(hfn, 1.0-hfn, clamp(h01*5.0, 0.0, 1.0))*uMarch.w, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  return c2;
}
void main(){
  vec4 q = uInvProj*vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 vd = normalize(q.xyz/q.w), rd = normalize(uCamRot*vd);
  vec3 ro = vec3(0.0, RGc+uCamAlt, 0.0);
  float t0, t1;
  if (!shellSegment(ro, rd, t0, t1)){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float d = texture2D(tDepth, vUv).x;
  float dist = d >= 0.999999 ? 1.0e9 : viewZ(d)/max(-vd.z, 1e-4);
  if (dist < t0) dist = 1.0e9;                 // geometry in front of the layer is handled at composite time
  t1 = min(min(t1, dist), t0+uMarch.z);
  if (t1 <= t0){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  int N = int(uMarch.x); float ds = (t1-t0)/float(N);
  float t = t0+ds*fract(ign(gl_FragCoord.xy)+uFrame*0.618);
  float cv = dot(rd, uSunDir);
  // multiple scattering as octaves (after Wrenninge): each bounce is dimmer, penetrates deeper and is more isotropic
  float ph[5]; { float c = 1.0; for (int k=0;k<5;k++){ ph[k] = mix(hg(cv, 0.8*c), hg(cv, -0.3*c), 0.3); c *= 0.5; } }
  float back = clamp(0.5-0.5*cv, 0.0, 1.0);
  vec3 L = vec3(0.0); float T = 1.0, ext = uLayer.z;
  for (int i=0;i<96;i++){
    if (i >= N) break;
    vec3 p = ro+rd*t; float alt = length(p)-RGc, h01;
    float dens = cloudDensity(uOrigin.xz+p.xz, alt, h01, ds > 300.0);
    if (dens > 0.002){
      dens *= 1.0-smoothstep(uMarch.z*0.55, uMarch.z, t-t0);
      float tau = 0.0, sl = uMarch.y; vec3 lp = p;
      for (int j=0;j<5;j++){
        lp += uSunDir*sl; float al = length(lp)-RGc, hh;
        if (al >= uLayer.y || al <= uLayer.x) break;
        tau += cloudDensity(uOrigin.xz+lp.xz, al, hh, true)*sl; sl *= 1.7;
      }
      tau *= ext;
      vec3 sun = vec3(0.0); { float a = 1.0, b = 1.0; for (int k=0;k<5;k++){ sun += uSunC*(a*exp(-tau*b)*ph[k]); a *= 0.7; b *= 0.4; } }
      float powder = 1.0-exp(-dens*ext*ds*1.6-tau*0.7);
      sun *= mix(1.0, 0.25+0.75*powder, back*0.8)*uGain;
      vec3 amb = mix(uAmbBot, uAmbTop, clamp(h01, 0.0, 1.0))*(0.3+0.7*exp(-tau*0.25));
      vec3 S = (sun+amb)*dens*ext;
      float tr = exp(-dens*ext*ds);
      L += T*(S-S*tr)/max(dens*ext, 1e-6);
      T *= tr;
      if (T < 0.012){ T = 0.0; break; }
    }
    t += ds;
  }
  gl_FragColor = vec4(L, T);
}`;

// small edge-preserving smooth of the low-resolution cloud buffer
const CLOUD_BLUR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tIn; uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(tIn, vUv), acc = c*0.36; float ws = 0.36;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
    if (i == 0 && j == 0) continue;
    vec4 s = texture2D(tIn, vUv+vec2(float(i),float(j))*uTexel*1.2);
    float w = ((i == 0 || j == 0) ? 0.11 : 0.05)/(1.0+abs(s.a-c.a)*6.0);
    acc += s*w; ws += w;
  }
  gl_FragColor = acc/ws;
}`;

export class CloudLayer {
  // opts: { base, top (m MSL), div: resolution divisor (2..4), noiseRes }
  constructor(pipe, opts = {}) {
    this.pipe = pipe; this.base = opts.base ?? 4200; this.top = opts.top ?? 6000; this.div = opts.div ?? 3;
    const R = opts.noiseRes ?? 64, r = pipe.renderer;
    this.noise = new THREE.WebGL3DRenderTarget(R, R, R, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false });
    const tx = this.noise.texture; tx.wrapS = tx.wrapT = tx.wrapR = THREE.RepeatWrapping; tx.minFilter = tx.magFilter = THREE.LinearFilter; tx.generateMipmaps = false;
    const gen = new Pass(NOISE3_FRAG, { uSlice: { value: 0 } });
    for (let i = 0; i < R; i++) { gen.u.uSlice.value = (i + 0.5) / R; r.setRenderTarget(this.noise, i); r.render(gen.mesh, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); }
    r.setRenderTarget(null); gen.material.dispose();
    const S = pipe.shared;
    this.cover = { uCov: { value: new THREE.Vector4(0.35, 1, 0, 0) }, uCovHole: { value: new THREE.Vector4(0, 0, 1, 0) } };
    this.pass = new Pass(CLOUD_FRAG, {
      tDepth: S.tDepth, tDetail: S.tDetail, tNoise3: { value: tx }, uLogFar: S.uLogFar, uInvProj: S.uInvProj, uCamRot: S.uCamRot, uCamAlt: S.uCamAlt, uFrame: S.uFrame,
      uOrigin: S.uOrigin, uSunDir: S.uSunDir, uSunC: { value: new THREE.Color() }, uAmbTop: { value: new THREE.Color() }, uAmbBot: { value: new THREE.Color() },
      uLayer: { value: new THREE.Vector4(this.base, this.top, 0.012, 4500) }, uMarch: { value: new THREE.Vector4(48, 90, 70000, 0.42) }, uShape: { value: new THREE.Vector3() }, uGain: { value: 1 }, uShear: { value: new THREE.Vector2(0.3, 0.12) },
      ...this.cover,
    });
    this.blur = new Pass(CLOUD_BLUR_FRAG, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this._amb = new Float32Array(4);
    pipe.clouds = this;
    this.setSize(pipe.w, pipe.h);
  }
  setSize(w, h) {
    this.rt?.dispose(); this.rt2?.dispose();
    const o = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rt = new THREE.WebGLRenderTarget(Math.ceil(w / this.div), Math.ceil(h / this.div), o);
    this.rt2 = new THREE.WebGLRenderTarget(Math.ceil(w / this.div), Math.ceil(h / this.div), o);
  }
  // uniforms + GLSL a terrain recipe can add so the ground receives this layer's shadows
  terrainShadow() {
    this.shadowK = { value: new THREE.Vector4((this.base + this.top) / 2, 0.8, 0, 0) };
    return {
      uniforms: { ...this.cover, uCovK: this.shadowK },
      defines: `#define TERRAIN_SHADOW_HOOK\nuniform vec4 uCovK;\n${CLOUD_COVER}\nfloat terrainSunShadow(vec2 wxz, float h){ if (uCovK.y <= 0.0) return 1.0; vec2 q = wxz+uSunDir.xz*((uCovK.x-h)/max(uSunDir.y, 0.05)); return 1.0-uCovK.y*smoothstep(0.3, 0.85, cloudCoverL(q, 0.5)); }\n`,
    };
  }
  // o: { cover, scale (km), wind:[kx,kz] km/s, hole:[x,z,radius,strength], density, tile (m), steps, lightStep, maxDist, erosion, shadow, base, top }
  render(pipe, o, time) {
    const u = this.pass.u, r = pipe.renderer, A = pipe.atmo;
    if (o.base !== undefined) this.base = o.base; if (o.top !== undefined) this.top = o.top;
    const wx = (o.wind?.[0] ?? 0) * time, wz = (o.wind?.[1] ?? 0) * time;
    this.cover.uCov.value.set(o.cover ?? 0.35, o.scale ?? 1, wx / (o.scale ?? 1), wz / (o.scale ?? 1));
    const hole = o.hole; this.cover.uCovHole.value.set(hole ? hole[0] : 0, hole ? hole[1] : 0, hole ? hole[2] : 1, hole ? (hole[3] ?? 1) : 0);
    u.uLayer.value.set(this.base, this.top, o.density ?? 0.012, o.tile ?? 4500);
    u.uMarch.value.set(Math.min(96, o.steps ?? 48), o.lightStep ?? 90, o.maxDist ?? 70000, o.erosion ?? 0.42);
    u.uGain.value = o.gain ?? 1; if (o.shear) u.uShear.value.set(o.shear[0], o.shear[1]);
    u.uShape.value.set(wx * 1000 / (o.tile ?? 4500), 0, wz * 1000 / (o.tile ?? 4500));
    if (this.shadowK) { this.shadowK.value.x = (this.base + this.top) / 2; this.shadowK.value.y = o.shadow ?? 0.8; }
    // sun and sky light at the layer
    const sun = A.sunIrradiance((this.base + this.top) / 2, u.uSunC.value);
    const key = pipe.skyKey + '|' + this.base;
    if (key !== this._ambKey) { this._ambKey = key; r.readRenderTargetPixels(pipe.rtAmbient, 0, 0, 1, 1, this._amb); }
    const a = this._amb, g = A.groundAlbedo, mu = Math.max(A.sunDir.y, 0);
    u.uAmbTop.value.setRGB(a[0] / Math.PI * 0.75, a[1] / Math.PI * 0.75, a[2] / Math.PI * 0.75);
    u.uAmbBot.value.setRGB(a[0] / Math.PI * 0.3 + g.r * sun.r * mu / Math.PI * 0.45, a[1] / Math.PI * 0.3 + g.g * sun.g * mu / Math.PI * 0.45, a[2] / Math.PI * 0.3 + g.b * sun.b * mu / Math.PI * 0.45);
    this.pass.render(r, this.rt);
    this.blur.u.tIn.value = this.rt.texture; this.blur.u.uTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
    this.blur.render(r, this.rt2);
    return this.rt2.texture;
  }
}
