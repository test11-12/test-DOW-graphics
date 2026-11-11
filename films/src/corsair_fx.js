// The three detonations of "Three Corsairs": a boat-borne charge going off against a pier at the waterline.
// Every part is a pure function of film time, so frames render in any order:
//   - a short hard flash, and the orange light the fireball throws on the pier, the gantry and the hull;
//   - a fireball that rolls up into its own soot and becomes the head of a smoke column;
//   - a white water column with jets, a curtain that falls back, and a base surge of mist rolling out;
//   - debris on ballistic arcs, the larger pieces trailing smoke, each landing with a splash and a ring;
//   - a pressure ring racing out across the water (and a refraction shell in the air);
//   - dust shaken off the pier and the gantry when the shock reaches them;
//   - a turbulent smoke column fed by the fire, leaning with the wind and paling as it dilutes.
// The fireball, the smoke, the fire and the water are one ray-marched volume per blast, rendered at half
// resolution (after the opaque scene, from the pipeline's deferred hook) and composited with a depth-aware
// upsample; spray, debris, splashes and dust are analytic particles. Simulated, illustrative; no people.
import * as THREE from 'three';
import { NOISE, DEPTH } from '../engine/glsl.js';
import { LAYER } from '../engine/pipeline.js';
import { Trail, makeGlow } from '../engine/fx.js';

const G = 9.81;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// aerial perspective of the engine (pipeline.js AP_LOOKUP), so effects fog like the scene behind them
const AP = /* glsl */`
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

// ---------------------------------------------------------------- the rise of the smoke
// A parcel that left the fire `al` seconds ago is plumeY(al) above the water and plumeR(al) wide; it has drifted
// downwind by wind * al * shear(height). Same curves in GLSL (through a table of age by height) and JS (bounds).
const PL = { y0: 2.2, h1: 15, t1: 2.8, w: 2.6, r0: 1.7, rk: 1.3, rp: 0.8 };
const plumeY = al => PL.y0 + PL.h1 * (1 - Math.exp(-al / PL.t1)) + PL.w * al;
const plumeR = al => PL.r0 + PL.rk * Math.pow(al, PL.rp);
const AGE_DY = 4, AGE_N = 64;
const AGE_TABLE = (() => { const t = []; for (let k = 0; k < AGE_N; k++) { const y = k * AGE_DY; let lo = 0, hi = 200; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (plumeY(m) < y) lo = m; else hi = m; } t.push(y <= PL.y0 ? 0 : lo); } return t; })();
// the explosion's own thermal (the head of the column): centre height and radius
const capY = a => 3.0 + 7.5 * (1 - Math.exp(-a / 0.8)) + 7.2 * a / (1 + a / 28);
const capR = a => 11.5 * Math.sqrt(1 - Math.exp(-a / 0.07)) + 3.0 * (1 - Math.exp(-a / 5)) + 0.15 * a;
const shear = y => 0.55 + 0.45 * clamp(y / 45, 0, 2.2);

const VOL_VERT = /* glsl */`
uniform vec3 uBoxMin, uBoxMax; varying vec3 vL; varying float vZ;
void main(){
  vL = mix(uBoxMin, uBoxMax, position+0.5);
  vec4 mv = modelViewMatrix*vec4(vL, 1.0); vZ = -mv.z;
  gl_Position = projectionMatrix*mv;
}`;
const VOL_FRAG = /* glsl */`
precision highp float; precision highp sampler3D;
${NOISE}
${DEPTH}
${AP}
uniform sampler2D tDepth, tAmbient; uniform sampler3D tNoise3; uniform vec2 uLoRes; uniform float uFrame;
uniform vec3 uSunL, uSunColor, uCamL, uBoxMin, uBoxMax;
uniform float uA, uSteps, uAgeT[${AGE_N}];
uniform vec2 uWind;                  // drift of the smoke at 10 m (m/s, x/z)
uniform vec4 uCap;                   // head: centre (local) and radius
uniform vec4 uCapK;                  // density, fire, soot albedo, roll (rad)
uniform vec4 uPl;                    // column: density, flames at the base, age of its top (s), dilution time (s)
uniform vec4 uWa;                    // water column: top (m), radius, density, falling 0..1
uniform vec4 uJe;                    // radial jets of spray: reach (m), density, fall (m), thinning
uniform vec4 uSu;                    // base surge: radius, height, density, ring width
uniform float uFire;                 // emission scale
varying vec3 vL; varying float vZ;
float sceneDist(){ float d = texture2D(tDepth, gl_FragCoord.xy/uLoRes).x; return d >= 0.999999 ? 1.0e9 : viewZ(d); }
float plumeAge(float y){ float f = clamp(y/${AGE_DY.toFixed(1)}, 0.0, ${(AGE_N - 1.001).toFixed(3)}); int i = int(f); return mix(uAgeT[i], uAgeT[i+1], fract(f)); }
float shear(float y){ return 0.55+0.45*clamp(y/45.0, 0.0, 2.2); }
// x smoke density, y water density, z soot albedo; e: emitted radiance; g: forward-scattering share
vec3 medium(vec3 p, bool fine, out vec3 e, out float g){
  e = vec3(0.0);
  float smk = 0.0, wat = 0.0, alb = uCapK.z;
  // --- head: the fireball rolling up into soot
  vec3 rc = p-uCap.xyz; rc.y *= mix(0.85, 0.62, clamp(uA/8.0, 0.0, 1.0));     // the head draws out upwards as it rises
  float R = uCap.w, dc = length(rc)/R;
  if (dc < 1.45 && uCapK.x > 0.0){
    vec2 hz = rc.xz; float rh = length(hz)+1e-3;
    float ang = uCapK.w*(1.0-clamp(dc, 0.0, 1.0));                   // the thermal turns over: up the middle, down the sides
    float cs = cos(ang), sn = sin(ang);
    vec2 ry = vec2(cs*rh-sn*rc.y, sn*rh+cs*rc.y);
    vec3 nq = vec3(hz.x/rh*ry.x, ry.y, hz.y/rh*ry.x)/R*0.42+vec3(0.13, -uA*0.02, 0.41);
    vec4 n = texture(tNoise3, nq);
    float shape = n.r*0.62+n.g*0.38;
    float d2 = dc+(0.55-shape)*1.05;                                 // lobed, not round
    if (fine && d2 < 1.05){ vec4 m = texture(tNoise3, nq*3.7+0.37); d2 += (0.52-(m.g*0.55+m.b*0.45))*0.3; }
    float dens = smoothstep(1.0, 0.86, d2);
    smk += dens*uCapK.x;
    if (uCapK.y > 0.001 && dens > 0.0){
      float inner = smoothstep(0.9, 0.35, d2);                                       // under the soot skin
      float tongues = smoothstep(0.42, 0.78, shape+0.25*(1.0-dc));
      float hot = inner*mix(tongues, 1.0, clamp(uCapK.y-1.5, 0.0, 1.0)*0.6);
      float k = hot*uCapK.y;
      vec3 col = mix(vec3(0.30, 0.035, 0.006), vec3(0.95, 0.24, 0.035), smoothstep(0.05, 0.5, k));
      col = mix(col, vec3(1.0, 0.56, 0.18), smoothstep(0.5, 1.3, k));
      col = mix(col, vec3(1.0, 0.88, 0.66), smoothstep(1.4, 3.2, k));
      e += col*k*dens*uFire;
    }
  }
  // --- the column fed by the fire at the foot of the pier
  if (uPl.x > 0.0 && p.y > 0.3){
    float al = plumeAge(p.y);
    if (al < uPl.z){
      float r = ${PL.r0.toFixed(2)}+${PL.rk.toFixed(2)}*pow(al, ${PL.rp.toFixed(2)});
      vec2 rel = p.xz-uWind*al*shear(p.y); float dd = length(rel)/r;
      if (dd < 1.5){
        vec3 nq = vec3(rel.x/r*0.32, p.y*0.04-uA*0.1, rel.y/r*0.32)+vec3(0.71, 0.0, 0.23);
        vec4 n = texture(tNoise3, nq);
        float sh = n.r*0.65+n.g*0.35;
        float d2 = dd+(0.56-sh)*0.95;
        if (fine && d2 < 1.1){ vec4 m = texture(tNoise3, nq*3.3+0.53); d2 += (0.5-m.g)*0.34; }
        float dn = smoothstep(1.0, 0.7, d2)/(1.0+al/uPl.w)*smoothstep(uPl.z, uPl.z-1.2, al);
        smk += dn*uPl.x;
        alb = mix(alb, mix(0.05, 0.46, smoothstep(1.0, 16.0, al)), dn/(dn+0.04+uCapK.x*step(dc, 1.0)));
        if (uPl.y > 0.0 && al < 1.3){
          float fl = smoothstep(1.3, 0.0, al)*smoothstep(1.0, 0.25, d2)*(0.3+1.4*n.b*n.b);
          e += vec3(1.0, 0.36, 0.06)*fl*uPl.y*uFire;
        }
      }
    }
  }
  // --- water: the column, its falling curtain, the base surge
  if (uWa.z > 0.0 && p.y < uWa.x+5.0){
    float h = clamp(p.y/max(uWa.x, 1.0), 0.0, 1.0);
    float rw = uWa.y*(0.5+0.8*h+0.6*uWa.w);
    float rr = length(p.xz)/rw;
    if (rr < 1.4){
      vec3 nq = vec3(p.x*0.07, p.y*0.014-uA*0.05, p.z*0.07)+vec3(0.37, 0.11, 0.83);
      vec4 n = texture(tNoise3, nq);
      float jets = n.g*0.6+n.b*0.4;
      float prof = mix(smoothstep(1.0, 0.0, rr+(jets-0.5)*0.5), smoothstep(0.3, 0.8, rr)*smoothstep(1.3, 0.85, rr+(jets-0.5)*0.4), uWa.w);
      float top = 1.0-smoothstep(uWa.x*0.7, uWa.x+3.5, p.y+(jets-0.5)*uWa.x*0.45);
      float wd = clamp(prof*top*(0.3+1.4*jets)-0.1, 0.0, 1.0);
      if (fine && wd > 0.0){ vec4 m = texture(tNoise3, nq*3.1+0.19); wd *= 0.55+0.9*m.g; }
      wat += wd*uWa.z;
    }
  }
  // radial jets: fibres of spray thrown out from the burst, upward ones fastest, falling under gravity
  if (uJe.y > 0.0){
    vec3 rel = p-vec3(0.0, 0.6, 0.0);
    float rl = length(rel);
    if (rl < uJe.x*1.05+uJe.z){
      vec3 q = rel; q.y += uJe.z*clamp(rl/max(uJe.x, 1.0), 0.0, 1.0);      // the outer spray has fallen further
      vec3 dir = normalize(q+vec3(0.0, 1e-3, 0.0));
      float up = clamp(dir.y, 0.0, 1.0);
      vec4 jn = texture(tNoise3, dir*0.85+vec3(0.21, 0.37, 0.53));
      float reach = uJe.x*mix(0.35, 1.0, jn.g*jn.g)*(0.45+0.55*up);
      float body = smoothstep(reach, reach*0.72, rl)*smoothstep(0.0, reach*0.25, rl)*step(-0.05, dir.y);
      if (body > 0.0){
        vec4 fn = texture(tNoise3, dir*vec3(3.6, 2.2, 3.6)+vec3(0.0, rl*0.004, 0.0)+0.61);
        float fib = smoothstep(0.42, 0.78, fn.g*0.65+fn.b*0.35);
        wat += body*fib*uJe.y*(1.0-uJe.w*clamp(rl/max(reach, 1.0), 0.0, 1.0));
      }
    }
  }
  if (uSu.z > 0.0 && p.y < uSu.y*2.6){
    float rho = length(p.xz);
    if (rho < uSu.x*1.3){
      float ring = exp(-pow((rho-uSu.x*0.72)/(uSu.x*uSu.w), 2.0));
      float inner = smoothstep(uSu.x*1.05, uSu.x*0.2, rho);
      vec3 nq = vec3(p.x*0.04, p.y*0.06-uA*0.02, p.z*0.04)+vec3(0.53, 0.29, 0.07);
      vec4 n = texture(tNoise3, nq);
      float sd = (ring*0.75+inner*0.4)*exp(-max(p.y, 0.0)/(uSu.y*(0.5+0.8*n.r)));
      wat += clamp(sd*(0.2+1.3*(n.r*0.6+n.g*0.4))-0.08, 0.0, 1.0)*uSu.z;
    }
  }
  float tot = smk+wat;
  g = tot > 0.0 ? wat/tot : 0.0;
  return vec3(smk, wat, alb);
}
float hgN(float c, float g){ return (1.0-g*g)/pow(max(1.0+g*g-2.0*g*c, 1e-3), 1.5); }
float chordSphere(vec3 p, vec3 L, vec3 c, float R){ vec3 oc = p-c; float b = dot(oc, L), cc = dot(oc, oc)-R*R, ds = b*b-cc; if (ds <= 0.0) return 0.0; float s = sqrt(ds); return max(-b+s-max(-b-s, 0.0), 0.0); }
float chordCyl(vec2 p, vec2 L2, float R, float Ly, float y, float y1){
  float a = dot(L2, L2); if (a < 1e-6) return (y < y1 && dot(p, p) < R*R) ? (y1-y)/max(Ly, 0.05) : 0.0;
  float b = dot(p, L2), cc = dot(p, p)-R*R, ds = b*b-a*cc; if (ds <= 0.0) return 0.0;
  float s = sqrt(ds), t1 = (-b+s)/a, t0 = max((-b-s)/a, 0.0);
  t1 = min(t1, Ly > 1e-3 ? max((y1-y)/Ly, 0.0) : 1e4);
  return max(t1-t0, 0.0);
}
// optical depth towards the sun from the large shapes (chords), so self-shadowing costs no extra marching
float sunDepth(vec3 p){
  float tau = chordSphere(p, uSunL, uCap.xyz, uCap.w*0.85)*0.6*uCapK.x*0.55;
  tau += chordCyl(p.xz, uSunL.xz, uWa.y*0.9, uSunL.y, p.y, uWa.x)*0.45*uWa.z*0.35;
  if (uPl.x > 0.0 && p.y > 0.3){
    float al = min(plumeAge(p.y), uPl.z), r = ${PL.r0.toFixed(2)}+${PL.rk.toFixed(2)}*pow(al, ${PL.rp.toFixed(2)});
    tau += chordCyl(p.xz-uWind*al*shear(p.y), uSunL.xz, r*0.8, uSunL.y, p.y, p.y+r*2.5)*0.6*uPl.x*0.45/(1.0+al/uPl.w);
  }
  return tau;
}
void main(){
  vec3 ro = uCamL, dv = vL-uCamL; float far = length(dv); vec3 rd = dv/far;
  vec3 inv = 1.0/rd, ta = (uBoxMin-ro)*inv, tb = (uBoxMax-ro)*inv, tmn = min(ta, tb), tmx = max(ta, tb);
  float tN = max(max(tmn.x, tmn.y), max(tmn.z, 0.0)), tF = min(min(tmx.x, tmx.y), tmx.z);
  tF = min(tF, sceneDist()*far/max(vZ, 1e-3));
  if (tF <= tN) discard;
  float cv = dot(rd, uSunL);
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb*0.3183;
  float N = uSteps, ds = (tF-tN)/N;
  float jit = fract(ign(gl_FragCoord.xy)+uFrame*0.618);
  float t = tN+ds*jit, T = 1.0, dAcc = 0.0, wAcc = 0.0; vec3 C = vec3(0.0);
  float phS = hgN(cv, 0.3)*0.75+hgN(cv, -0.2)*0.25, phW = hgN(cv, 0.72)*0.8+hgN(cv, -0.2)*0.2;
  for (int i=0;i<72;i++){
    if (t > tF || T < 0.012) break;
    vec3 p = ro+rd*t; vec3 e; float g;
    vec3 m = medium(p, true, e, g);
    float sig = m.x*0.6+m.y*0.45;
    if (sig > 1e-4 || e.r > 1e-4){
      vec3 e2; float g2;
      vec3 q1 = medium(p+uSunL*2.5, false, e2, g2);
      float tau = (q1.x*0.6+q1.y*0.45)*3.2+sunDepth(p+uSunL*4.0);
      float Ts = exp(-tau)*0.8+exp(-tau*0.22)*0.2;                // some light finds its way round (multiple scattering)
      float alb = mix(m.z, 0.92, g);
      float ph = mix(phS, phW, g)*0.0796*4.0;
      float up = clamp(0.5+0.5*(p.y-uCap.y)/max(uCap.w, 1.0), 0.0, 1.0);
      vec3 L = alb*(uSunColor*0.3183*ph*Ts*1.2+amb*(0.4+0.6*up)*(0.35+0.65*exp(-tau*0.3))*1.6)+e;
      float a = 1.0-exp(-sig*ds);
      C += T*a*L; dAcc += T*a*t; wAcc += T*a;
      T *= 1.0-a;
      t += ds;
    } else t += ds*1.8;            // empty space: stride on
  }
  if (T > 0.996) discard;
  float alpha = 1.0-T;
  vec3 I, Tr; aerialLUT(gl_FragCoord.xy/uLoRes, dAcc/max(wAcc, 1e-4), I, Tr);
  gl_FragColor = vec4(C*Tr+I*alpha, alpha);
}`;

// depth-aware upsample of the half-resolution volumes onto the full frame
const COMP_FRAG = /* glsl */`
precision highp float;
${DEPTH}
uniform sampler2D tVol, tDepth; uniform vec2 uRes, uLoRes;
float vz(vec2 uv){ float d = texture2D(tDepth, uv).x; return d >= 0.999999 ? 1.0e7 : viewZ(d); }
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  float z = vz(uv);
  // 3x3 tent over the half-resolution texels, weighted by depth similarity: upsamples and removes the march dither
  vec2 p = uv*uLoRes-0.5, b = floor(p+0.5);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
    vec2 c = b+vec2(float(i), float(j));
    vec2 q = (c+0.5)/uLoRes;
    vec2 dd = abs(c-p);
    float w = max(1.6-dd.x, 0.0)*max(1.6-dd.y, 0.0);
    w /= 0.004+abs(vz(q)-z)/max(z, 1.0);
    acc += texture2D(tVol, q)*w; ws += w;
  }
  vec4 c = acc/max(ws, 1e-6);
  if (c.a < 0.002) discard;
  gl_FragColor = c;
}`;

class VolumeSystem {
  constructor(pipe) {
    this.pipe = pipe; this.scene = new THREE.Scene(); this.vols = [];
    this.rt = null; this.loRes = new THREE.Vector2(1, 1);
    this.ensure();
    const S = pipe.shared;
    this.comp = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { tVol: { value: this.rt.texture }, tDepth: S.tDepth, uRes: S.uRes, uLoRes: { value: this.loRes }, uLogFar: S.uLogFar },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: COMP_FRAG,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.comp.frustumCulled = false; this.comp.layers.set(LAYER.FX); this.comp.renderOrder = 3; this.comp.visible = false;
    pipe.scene.add(this.comp);
    // after the opaque scene (depth ready), before the atmosphere and the effects layer
    pipe.deferred.push({ shade: (r) => { this.render(r); return false; } });
  }
  ensure() {
    const p = this.pipe, w = Math.ceil(p.w / 2), h = Math.ceil(p.h / 2);
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.loRes.set(w, h);
    if (this.comp) this.comp.material.uniforms.tVol.value = this.rt.texture;
  }
  render(r) {
    const any = this.vols.some(v => v.visible);
    this.comp.visible = any;
    if (!any) return;
    this.ensure();
    const cam = this.pipe.camera, mask = cam.layers.mask;
    cam.layers.set(0);
    // far to near
    const cp = cam.position;
    this.vols.forEach(v => { v.renderOrder = -v.position.distanceTo(cp); });
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear();
    r.render(this.scene, cam);
    cam.layers.mask = mask;
  }
  add(mesh) { this.vols.push(mesh); this.scene.add(mesh); }
}

function makeVolume(pipe, sys, noise3) {
  const S = pipe.shared;
  const U = {
    tDepth: S.tDepth, uLoRes: { value: sys.loRes }, uLogFar: S.uLogFar, uFrame: S.uFrame, tAmbient: S.tAmbient, uSunColor: S.uSunColor, tApI: S.tApI, tApT: S.tApT,
    tNoise3: { value: noise3 }, uSunL: { value: new THREE.Vector3(0, 1, 0) }, uCamL: { value: new THREE.Vector3() },
    uBoxMin: { value: new THREE.Vector3(-1, 0, -1) }, uBoxMax: { value: new THREE.Vector3(1, 1, 1) },
    uA: { value: 0 }, uSteps: { value: 40 }, uAgeT: { value: AGE_TABLE.slice() }, uWind: { value: new THREE.Vector2(3, 1) },
    uCap: { value: new THREE.Vector4() }, uCapK: { value: new THREE.Vector4() }, uPl: { value: new THREE.Vector4() },
    uWa: { value: new THREE.Vector4() }, uJe: { value: new THREE.Vector4() }, uSu: { value: new THREE.Vector4() }, uFire: { value: 2.6 },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: U, vertexShader: VOL_VERT, fragmentShader: VOL_FRAG,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  mesh.frustumCulled = false; mesh.visible = false;
  const inv = new THREE.Matrix4();
  mesh.onBeforeRender = (r, s, camera) => { inv.copy(mesh.matrixWorld).invert(); U.uCamL.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv); };
  sys.add(mesh);
  return { mesh, U };
}

// ---------------------------------------------------------------- analytic particles
// A particle: birth time t0, start p, start velocity v, linear drag k (1/s), gravity scale, life, size s0 -> s1,
// colour, alpha, kind (0 water, 1 dust, 2 debris). Position p0 + vt a + (v0 - vt)(1 - e^-ka)/k, vt = terminal.
const SPR_VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iDat; attribute vec4 iCol; attribute vec3 iVel;   // size, age01, seed, kind | rgb, alpha | velocity
uniform vec2 uRes; uniform float uStreak;
varying vec2 vQ; varying float vZ; varying vec4 vCol; varying float vSeed; varying float vKind; varying vec3 vI; varying vec3 vT; varying float vStretch;
${AP}
void main(){
  vec4 mv = viewMatrix*vec4(iPos, 1.0);
  vec4 c0 = projectionMatrix*mv, c1 = projectionMatrix*(viewMatrix*vec4(iPos+iVel*uStreak, 1.0));
  vec2 s0 = c0.xy/c0.w, s1 = c1.xy/max(c1.w, 1e-3);
  vec2 dsc = (s1-s0)*uRes*0.5;
  float px = max(iDat.x/max(-mv.z, 0.1)*projectionMatrix[1][1]*uRes.y*0.5, 0.7);
  float L = min(length(dsc), 80.0); vec2 dir = L > 1e-3 ? normalize(dsc) : vec2(1.0, 0.0);
  float st = 1.0+L/px*0.5;
  if (iDat.w < 0.5) st = max(st, 2.5+3.5*iDat.z);       // spray is always a streak along its flight
  vStretch = st;
  vQ = position.xy;
  vec2 off = (dir*position.x*st+vec2(-dir.y, dir.x)*position.y)*px;
  gl_Position = c0; gl_Position.xy += (off+dir*L*0.5)/(uRes*0.5)*c0.w;
  vZ = -mv.z; vCol = iCol; vSeed = iDat.z; vKind = iDat.w;
  aerialLUT(s0*0.5+0.5, length(mv.xyz), vI, vT);
}`;
const SPR_FRAG = /* glsl */`
precision highp float;
${DEPTH}
uniform sampler2D tDepth, tDetail, tAmbient; uniform vec2 uRes; uniform vec3 uSunColor, uSunV;
varying vec2 vQ; varying float vZ; varying vec4 vCol; varying float vSeed; varying float vKind; varying vec3 vI; varying vec3 vT; varying float vStretch;
float sceneDist(){ float d = texture2D(tDepth, gl_FragCoord.xy/uRes).x; return d >= 0.999999 ? 1.0e9 : viewZ(d); }
void main(){
  float r2 = dot(vQ, vQ); if (r2 > 1.0) discard;
  float sd = sceneDist(); if (vZ > sd+0.5) discard;
  float n = texture2D(tDetail, vQ*vec2(0.16/vStretch, 0.16)+vec2(vSeed*7.3, vSeed*3.1)).r;
  float n2 = texture2D(tDetail, vQ*0.43+vec2(vSeed*1.7, vSeed*9.1)).g;
  float a;
  if (vKind > 1.5) a = smoothstep(0.75, 0.45, r2+(n-0.5)*0.9);                         // a dark ragged fragment, blurred along its path
  else a = smoothstep(0.0, 0.7, (1.0-r2)*(0.45+1.1*(n*1.2+n2*0.5-0.35)));              // spray, dust: a lumpy puff
  a *= vCol.a*clamp((sd-vZ)/2.5, 0.0, 1.0)*clamp((vZ-0.8)/2.0, 0.0, 1.0)/mix(1.0, vStretch, 0.6);
  if (a < 0.003) discard;
  vec3 N = normalize(vec3(vQ, sqrt(max(1.0-r2, 0.0))+0.3));
  vec3 Ls = normalize(uSunV);
  float wrap = dot(N, Ls)*0.5+0.5;
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb*0.3183;
  float fwd = vKind < 0.5 ? pow(clamp(-Ls.z, 0.0, 1.0), 5.0)*0.6 : 0.0;     // spray glows against the sun
  vec3 lit = vCol.rgb*(uSunColor*0.3183*(0.18+0.82*wrap*wrap+fwd)*(0.8+0.4*n)+amb*1.25);
  gl_FragColor = vec4((lit*vT+vI)*a, a);
}`;

class Sprites {
  constructor(pipe, parts, o = {}) {
    this.pipe = pipe; this.parts = parts; const N = this.N = Math.max(1, parts.length);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = n => { const a = new THREE.InstancedBufferAttribute(new Float32Array(N * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aPos = mk(3); this.aDat = mk(4); this.aCol = mk(4); this.aVel = mk(3);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iDat', this.aDat); geo.setAttribute('iCol', this.aCol); geo.setAttribute('iVel', this.aVel);
    geo.instanceCount = 0;
    const S = pipe.shared;
    this.uSunV = { value: new THREE.Vector3() };
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { tDepth: S.tDepth, uRes: S.uRes, uLogFar: S.uLogFar, tDetail: S.tDetail, tAmbient: S.tAmbient, uSunColor: S.uSunColor, tApI: S.tApI, tApT: S.tApT,
        uSunV: this.uSunV, uStreak: { value: o.streak ?? 1 / 60 } },
      vertexShader: SPR_VERT, fragmentShader: SPR_FRAG,
    });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.layers.set(LAYER.FX); this.mesh.renderOrder = o.renderOrder ?? 4;
    this.wind = o.wind || [0, 0];
    this._items = []; this._st = new Float32Array(6);
  }
  static state(q, a, wind, out) {
    const k = q.k, vt = -G * q.grav / k, e = (1 - Math.exp(-k * a)) / k, ek = Math.exp(-k * a);
    out[0] = q.p[0] + wind[0] * a + (q.v[0] - wind[0]) * e;
    out[1] = q.p[1] + vt * a + (q.v[1] - vt) * e;
    out[2] = q.p[2] + wind[1] * a + (q.v[2] - wind[1]) * e;
    out[3] = wind[0] + (q.v[0] - wind[0]) * ek; out[4] = vt + (q.v[1] - vt) * ek; out[5] = wind[1] + (q.v[2] - wind[1]) * ek;
    return out;
  }
  update(t, origin) {
    const P = this.aPos.array, D = this.aDat.array, Cc = this.aCol.array, V = this.aVel.array, cam = this.pipe.camera.position;
    const items = this._items, st = this._st; items.length = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const q = this.parts[i], a = t - q.t0;
      if (a < 0 || a > q.life) continue;
      Sprites.state(q, a, this.wind, st);
      if (q.floor !== undefined && st[1] < q.floor) continue;
      const a01 = a / q.life, size = q.s0 + (q.s1 - q.s0) * Math.pow(a01, q.grow ?? 0.6);
      const alpha = q.a * smooth(0, q.fade[0], a01) * (1 - smooth(1 - q.fade[1], 1, a01));
      if (alpha < 0.002) continue;
      const rx = st[0] - origin.x, ry = st[1] - origin.y, rz = st[2] - origin.z, dx = rx - cam.x, dy = ry - cam.y, dz = rz - cam.z;
      items.push([dx * dx + dy * dy + dz * dz, rx, ry, rz, size, a01, q.seed, q.kind, q.col[0], q.col[1], q.col[2], alpha, st[3], st[4], st[5]]);
    }
    items.sort((x, y) => y[0] - x[0]);
    let n = 0;
    for (const it of items) {
      P[n * 3] = it[1]; P[n * 3 + 1] = it[2]; P[n * 3 + 2] = it[3];
      D[n * 4] = it[4]; D[n * 4 + 1] = it[5]; D[n * 4 + 2] = it[6]; D[n * 4 + 3] = it[7];
      Cc[n * 4] = it[8]; Cc[n * 4 + 1] = it[9]; Cc[n * 4 + 2] = it[10]; Cc[n * 4 + 3] = it[11];
      V[n * 3] = it[12]; V[n * 3 + 1] = it[13]; V[n * 3 + 2] = it[14]; n++;
    }
    this.mesh.geometry.instanceCount = n; this.mesh.visible = n > 0;
    this.aPos.needsUpdate = this.aDat.needsUpdate = this.aCol.needsUpdate = this.aVel.needsUpdate = true;
    this.uSunV.value.copy(this.pipe.atmo.sunDir).transformDirection(this.pipe.camera.matrixWorldInverse);
  }
}

// ---------------------------------------------------------------- pressure ring, fire light on the water, shock shell
const RING_VERT = /* glsl */`uniform float uScale; varying vec2 vP; varying float vZ; void main(){ vec3 p = position*vec3(uScale, 1.0, uScale); vP = p.xz; vec4 mv = modelViewMatrix*vec4(p, 1.0); vZ = -mv.z; gl_Position = projectionMatrix*mv; }`;
const RING_FRAG = /* glsl */`
precision highp float;
${DEPTH}
uniform sampler2D tDepth, tDetail; uniform vec2 uRes; uniform float uR, uW, uK, uGlow; uniform vec3 uGlowCol, uSky;
varying vec2 vP; varying float vZ;
void main(){
  float d = texture2D(tDepth, gl_FragCoord.xy/uRes).x; float sd = d >= 0.999999 ? 1.0e9 : viewZ(d);
  if (vZ > sd+0.6) discard;
  float r = length(vP);
  float n = texture2D(tDetail, vP*0.021).r, n2 = texture2D(tDetail, vP*0.09+0.4).g;
  float ring = exp(-pow((r-uR*(0.95+0.1*n))/uW, 2.0))*uK*(0.4+1.2*n2);          // the shock front ruffles the surface
  float glow = uGlow*exp(-r*r/(2.0*24.0*24.0))*(0.5+0.9*n2);                     // the fireball lighting the water
  gl_FragColor = vec4(uSky*ring+uGlowCol*glow, 0.0);
}`;
const SHELL_VERT = /* glsl */`varying vec3 vN; varying vec3 vV; varying float vZ; void main(){ vec4 mv = modelViewMatrix*vec4(position, 1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vZ = -mv.z; gl_Position = projectionMatrix*mv; }`;
const SHELL_FRAG = /* glsl */`
precision highp float;
${DEPTH}
uniform sampler2D tDepth; uniform vec2 uRes; uniform float uK;
varying vec3 vN; varying vec3 vV; varying float vZ;
void main(){
  float d = texture2D(tDepth, gl_FragCoord.xy/uRes).x; float sd = d >= 0.999999 ? 1.0e9 : viewZ(d);
  if (vZ > sd) discard;
  float e = 1.0-abs(dot(normalize(vN), normalize(vV)));
  gl_FragColor = vec4(normalize(vN.xy+1e-5)*pow(e, 6.0)*uK, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- one detonation
// o: { x, z, T, noise3 (3D noise; the cloud layer's), ocean (splash rings), wind: [x, z] m/s at 10 m, seed,
//      scale (1 = a large charge against a pier), dust: [[x0,y0,z0, x1,y1,z1], ...] edges the shock shakes,
//      light: false to skip the fireball's point light }
let sharedLight = null;
const systems = new WeakMap();
export function makeBlast(pipe, o) {
  const X = o.x, Z = o.z, T = o.T, seed = o.seed ?? Math.round(X * 7 + Z * 13), sc = o.scale ?? 1;
  const wind = o.wind || [3.2, 1.0];
  const noise3 = o.noise3 || (pipe.clouds && pipe.clouds.noise && pipe.clouds.noise.texture);
  if (!noise3) throw new Error('makeBlast needs a 3D noise texture (o.noise3 or a CloudLayer)');
  if (!systems.has(pipe)) systems.set(pipe, new VolumeSystem(pipe));
  const sys = systems.get(pipe);
  const r = (() => { let s = (seed * 2654435761) >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const group = new THREE.Group(); group.name = 'blast'; pipe.scene.add(group);
  const vol = makeVolume(pipe, sys, noise3);
  vol.U.uWind.value.set(wind[0], wind[1]);
  const flash = makeGlow(pipe, { color: [1.0, 0.88, 0.74], size: 16 * sc, depthSoft: 8 }); group.add(flash);
  const halo = makeGlow(pipe, { color: [1.0, 0.52, 0.2], size: 50 * sc, depthSoft: 30 }); group.add(halo);

  const water = [], debris = [], dust = [];
  // spray: thin streaks flung out with the jets (the body of the jets is in the volume), raining back down
  for (let i = 0; i < 130; i++) {
    const az = r() * 6.2832, el = (86 - 64 * Math.pow(r(), 0.9)) * Math.PI / 180, sp = (12 + 24 * Math.pow(r(), 1.1)) * sc, ce = Math.cos(el);
    water.push({ t0: T + r() * 0.08, p: [X, 0.8, Z], v: [Math.cos(az) * ce * sp, Math.sin(el) * sp, Math.sin(az) * ce * sp],
      k: 0.45 + 0.4 * r(), grav: 1, life: 1.8 + 2.0 * r(), s0: 0.08 + 0.08 * r(), s1: 0.22 + 0.3 * r(), grow: 0.7, col: [0.86, 0.88, 0.9], a: 0.25 + 0.35 * r(), kind: 0, seed: r(), fade: [0.02, 0.4], floor: 0.0 });
  }
  // debris: fragments on ballistic arcs; the larger pieces trail smoke; each lands with a splash and a ring
  const trails = [];
  for (let i = 0; i < 34; i++) {
    const az = r() * 6.2832, el = (15 + 68 * Math.pow(r(), 0.8)) * Math.PI / 180, sp = (14 + 30 * Math.pow(r(), 1.2)) * sc, big = r() < 0.35;
    const q = { t0: T + 0.02 + r() * 0.05, p: [X, 1.5 + r() * 2, Z], v: [Math.cos(az) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(az) * Math.cos(el) * sp],
      k: big ? 0.1 : 0.22, grav: 1, life: 12, s0: big ? 0.22 : 0.1, s1: big ? 0.2 : 0.09, grow: 1, col: [0.03, 0.028, 0.026], a: 1, kind: 2, seed: r(), fade: [0.001, 0.002], floor: 0.0 };
    const st = new Float32Array(6); let tl = 0;
    for (let a = 0.05; a < 12; a += 0.025) { Sprites.state(q, a, [0, 0], st); if (st[1] <= 0) { tl = a; break; } }
    if (!tl) continue;
    q.life = tl; debris.push(q);
    Sprites.state(q, tl, [0, 0], st);
    const lx = st[0], lz = st[2], tland = q.t0 + tl, nsp = big ? 12 : 6;
    for (let j = 0; j < nsp; j++) {
      const a2 = r() * 6.2832, s2 = (2.5 + 4.5 * r()) * (big ? 1.3 : 1);
      water.push({ t0: tland + r() * 0.04, p: [lx, 0.1, lz], v: [Math.cos(a2) * s2 * 0.3, s2 * 1.6, Math.sin(a2) * s2 * 0.3], k: 0.5, grav: 1, life: 1.1 + r() * 0.5, s0: 0.12, s1: big ? 0.9 : 0.5, grow: 0.6, col: [0.92, 0.94, 0.95], a: 0.6, kind: 0, seed: r(), fade: [0.02, 0.5], floor: -0.2 });
    }
    if (o.ocean) o.ocean.discs.push({ x: lx, z: lz, t0: tland, dur: 3 + (big ? 2 : 0), r0: 0.3, r1: big ? 5 : 2.5, k: big ? 0.75 : 0.45 });
    if (big && trails.length < 6) {
      const qq = q, tl0 = tl;
      trails.push({ q: qq, tr: new Trail(pipe, { rate: 80, life: 1.6 + r() * 1.2, start: qq.t0 + 0.04, stop: qq.t0 + tl0 * 0.7, size0: 0.12, size1: 0.85, grow: 0.5,
        color: [0.14, 0.135, 0.13], color1: [0.42, 0.41, 0.4], alpha: 0.3, jitter: 0.08, drift: [wind[0] * 0.8, 0.4, wind[1] * 0.8], drag: 2, spreadV: 0.4, emissive: [1.2, 0.45, 0.1], emissiveLife: 0.06, noise: 1, softness: 1.2 }) });
    }
  }
  // dust off the structures when the shock gets there (340 m/s)
  for (const sgm of o.dust || []) {
    const [x0, y0, z0, x1, y1, z1] = sgm, L = Math.hypot(x1 - x0, y1 - y0, z1 - z0), n = Math.min(70, Math.ceil(L * 1.1));
    for (let i = 0; i < n; i++) {
      const u = r(), px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u, pz = z0 + (z1 - z0) * u, dist = Math.hypot(px - X, py - 2, pz - Z);
      if (dist > 65) continue;
      const k = 1 / (1 + dist / 16), dx = (px - X) / dist, dz = (pz - Z) / dist;
      dust.push({ t0: T + dist / 340 + r() * 0.06, p: [px, py, pz], v: [dx * 3 * k + (r() - 0.5) * 0.8, -0.2 - r() * 1.2, dz * 3 * k + (r() - 0.5) * 0.8], k: 1.5, grav: 0.1, life: 2.5 + 2.5 * r(),
        s0: 0.25, s1: 1.4 + 2.4 * r() * (0.5 + k), grow: 0.5, col: [0.45, 0.41, 0.35], a: 0.22 + 0.3 * k, kind: 1, seed: r(), fade: [0.06, 0.7] });
    }
  }
  const sWater = new Sprites(pipe, water, { wind: [wind[0] * 0.5, wind[1] * 0.5], renderOrder: 5 });
  const sDebris = new Sprites(pipe, debris, { renderOrder: 6, streak: 1 / 45 });
  const sDust = new Sprites(pipe, dust, { wind: [wind[0] * 0.4, wind[1] * 0.4], renderOrder: 4 });
  group.add(sWater.mesh, sDebris.mesh, sDust.mesh);

  const ringU = { tDepth: pipe.shared.tDepth, tDetail: pipe.shared.tDetail, uRes: pipe.shared.uRes, uLogFar: pipe.shared.uLogFar,
    uR: { value: 0 }, uW: { value: 2 }, uK: { value: 0 }, uGlow: { value: 0 }, uGlowCol: { value: new THREE.Vector3(1, 0.42, 0.12) }, uSky: { value: new THREE.Vector3(0.5, 0.55, 0.6) }, uScale: { value: 60 } };
  const ring = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: ringU, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.frustumCulled = false; ring.layers.set(LAYER.FX); ring.renderOrder = 1; group.add(ring);
  const shellU = { tDepth: pipe.shared.tDepth, uRes: pipe.shared.uRes, uLogFar: pipe.shared.uLogFar, uK: { value: 0 } };
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({ uniforms: shellU, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  shell.frustumCulled = false; shell.layers.set(LAYER.DISTORT); group.add(shell);

  if (o.light !== false && !sharedLight) {
    sharedLight = new THREE.PointLight(0xff9248, 0, 300, 2); sharedLight.castShadow = false; pipe.scene.add(sharedLight);
    sharedLight.userData.claims = [];
  }
  const tmp = new THREE.Vector3(), st = new Float32Array(6), U = vol.U;
  function update(film, t, visible) {
    const a = t - T, live = visible && a > -0.02;
    group.visible = live; vol.mesh.visible = live && a > 0;
    if (!live) { for (const tr of trails) tr.tr.hide(); return 0; }
    const O = film.origin, A = Math.max(a, 0);
    tmp.set(X, 0, Z); film.place(group, tmp); film.place(vol.mesh, tmp);
    // ---- volume
    const R = capR(A) * sc, cy = capY(A) * sc, dr = A * shear(cy);
    U.uA.value = A;
    U.uCap.value.set(wind[0] * dr * 0.8, cy, wind[1] * dr * 0.8, R);
    const fire = 7.0 * Math.exp(-A / 0.18) + 2.2 * Math.exp(-A / 0.6) + 0.3 * Math.exp(-A / 2);
    U.uCapK.value.set(A > 0 ? 1.25 * Math.pow(11.5 / Math.max(R, 11.5), 1.4) / (1 + A / 14) * smooth(0, 0.04, A) * (1 - smooth(30, 55, A)) : 0, fire,
      0.035 + 0.38 * smooth(2.0, 22, A), 1.7 * A / (1 + A / 2.5));
    const plTop = Math.max(0, A - 0.6);
    U.uPl.value.set(plTop > 0 ? 1.15 * smooth(0.6, 2.2, A) : 0, 1.4 * smooth(0.7, 1.5, A) * (1 - smooth(45, 80, A)) * (0.85 + 0.15 * Math.sin(t * 23.1 + seed)), plTop, 10);
    const v0 = 26 * sc, top = A < 2.65 ? v0 * A - 0.5 * G * A * A : Math.max(0, 34.5 * sc - 0.5 * G * 0.5 * (A - 2.65) * (A - 2.65));
    U.uWa.value.set(Math.max(top, 0.1), 5.5 * sc, A < 7.5 ? 2.0 * smooth(0, 0.08, A) * (1 - smooth(3.4, 7.5, A)) : 0, smooth(1.8, 4.2, A));
    const reach = 34 * sc * (1 - Math.exp(-0.8 * A)) / 0.8, fallJ = 0.5 * G * 0.55 * Math.max(0, A - 0.4) ** 2;
    U.uJe.value.set(reach, A < 5 ? 1.8 * smooth(0, 0.05, A) * (1 - smooth(1.8, 4.8, A)) : 0, fallJ, 0.5);
    const sr = A > 0.6 ? (6 + 40 * (1 - Math.exp(-(A - 0.6) / 2.4))) * sc : 0;
    U.uSu.value.set(sr, (2.5 + 4.5 * smooth(0.6, 5, A)) * sc, A > 0.6 && A < 10 ? 0.6 * smooth(0.6, 1.6, A) * (1 - smooth(4, 9.5, A)) : 0, 0.3);
    U.uSteps.value = 40;
    U.uSunL.value.copy(film.pipe.atmo.sunDir);
    const plR = plumeR(plTop) * 1.6, plY = plumeY(plTop), plD = plTop * shear(plY);
    const xs = [U.uCap.value.x - R * 1.3, U.uCap.value.x + R * 1.3, -plR - 2, plR + 2, wind[0] * plD - plR, wind[0] * plD + plR];
    const zs = [U.uCap.value.z - R * 1.3, U.uCap.value.z + R * 1.3, -plR - 2, plR + 2, wind[1] * plD - plR, wind[1] * plD + plR];
    if (U.uWa.value.z > 0) { xs.push(-12 * sc, 12 * sc); zs.push(-12 * sc, 12 * sc); }
    if (U.uJe.value.y > 0) { const jr = reach * 1.05 + fallJ * 0.2; xs.push(-jr, jr); zs.push(-jr, jr); }
    if (U.uSu.value.z > 0) { xs.push(-sr * 1.3, sr * 1.3); zs.push(-sr * 1.3, sr * 1.3); }
    U.uBoxMin.value.set(Math.min(...xs), 0, Math.min(...zs));
    U.uBoxMax.value.set(Math.max(...xs), Math.max(cy + R * 1.6, U.uPl.value.x > 0 ? plY + plR : 0, U.uWa.value.z > 0 ? top + 6 : 0, U.uSu.value.z > 0 ? U.uSu.value.y * 2.6 : 0, 6), Math.max(...zs));
    // ---- flash and glow
    flash.userData.set(A > 0 ? 120 * Math.exp(-A / 0.02) : 0, 14 * sc); flash.position.set(0, 3 * sc, 0);
    halo.userData.set(A > 0 ? 4.5 * Math.exp(-A / 0.1) + 1.0 * Math.exp(-A / 0.5) : 0, (36 + 40 * smooth(0, 0.4, A)) * sc); halo.position.set(0, 6 * sc, 0);
    // ---- pressure ring and light on the water
    ring.visible = A < 1.4;
    ringU.uR.value = 340 * A; ringU.uW.value = 1.2 + 5 * A; ringU.uK.value = A < 0.7 ? 0.5 * (1 - smooth(0.04, 0.7, A)) : 0;
    ringU.uGlow.value = 0.9 * fire; ringU.uScale.value = Math.max(345 * Math.min(A, 0.7) + 60, 60); ring.position.set(0, 0.12, 0);
    shell.visible = A > 0 && A < 0.4; shell.scale.setScalar(Math.max(340 * A, 0.5)); shellU.uK.value = 0.01 * (1 - smooth(0.04, 0.4, A));
    // ---- particles
    sWater.update(t, O); sDebris.update(t, O); sDust.update(t, O);
    for (const { q, tr } of trails) tr.update(t, O, (tb, out) => { Sprites.state(q, Math.max(0, tb - q.t0), [0, 0], st); return out.set(st[0], st[1], st[2]); });
    if (sharedLight) {
      const L = A > 0 ? 1.6e5 * Math.exp(-A / 0.03) + 1.4e4 * Math.exp(-A / 0.3) + 900 * smooth(0.8, 1.6, A) * (1 - smooth(30, 70, A)) * (0.8 + 0.2 * Math.sin(t * 17.3 + seed)) : 0;
      sharedLight.userData.claims.push({ L, x: X, y: 5 * sc, z: Z });
    }
    return fire;
  }
  return { update, group, volume: vol.mesh };
}

// once per frame after every blast's update(): the brightest fireball gets the shared light
export function resolveBlastLight(film) {
  if (!sharedLight) return;
  const c = sharedLight.userData.claims; let best = null;
  for (const k of c) if (!best || k.L > best.L) best = k;
  c.length = 0;
  // the light stays in the scene (intensity 0 when idle) so shader programs never change between frames
  sharedLight.intensity = best ? best.L : 0;
  if (best) sharedLight.position.set(best.x - film.origin.x, best.y - film.origin.y, best.z - film.origin.z);
}
