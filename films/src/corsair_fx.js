// The three detonations of "Three Corsairs": a boat-borne charge going off against a pier at the waterline.
// Every part is a pure function of film time, so frames render in any order:
//   - a hard flash for a frame or two, and the light it throws on the pier, the gantry and the hull;
//   - a fireball that lasts a few tenths of a second and rolls over into its own soot (a rising, turning head);
//   - a column of white water: fibrous jets that go up fast, hang, and fall back as curtains, a low crown of
//     spray thrown outwards, a base surge of mist along the surface, and foam spreading on the water;
//   - debris: small fast fragments blurred along their flight, each landing with a small splash and a ring;
//   - a pressure ring racing out across the water (and a refraction shell in the air);
//   - dust shaken off the pier and the gantry when the shock reaches them;
//   - a turbulent smoke column fed by the fire at the foot of the pier, leaning with the wind and paling.
//
// Everything that scatters light is one sorted cloud of camera-facing particles, and no particle is ever a
// disc: smoke and mist are cut out of a 3D billow noise that erodes them as they age (the silhouette is the
// noise, not the quad), lit per pixel from the sun's side with a per-particle self-shadow term from where
// the particle sits in its column; water is drawn as fibres stretched along the flight. Particles fade
// where they meet the sea and the structures. Simulated, illustrative; no people.
import * as THREE from 'three';
import { DEPTH } from '../engine/glsl.js';
import { LAYER } from '../engine/pipeline.js';
import { makeGlow } from '../engine/fx.js';

const G = 9.81;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

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

// ---------------------------------------------------------------- the particle cloud
// kinds: 0 smoke (and fire), 1 mist / dust, 2 water (fibres along the flight), 3 debris
const K_SMOKE = 0, K_MIST = 1, K_WATER = 2, K_DEBRIS = 3;
const P_VERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iVel;
attribute vec4 iA;   // half-width (m), seed, kind, erosion
attribute vec4 iB;   // albedo rgb, alpha
attribute vec4 iC;   // sun visibility, emission, rotation (rad), stretch (half-length / half-width)
attribute vec2 iD;   // age (s), light from the fireball
uniform vec2 uRes; uniform vec3 uSunV; uniform float uShutter;
varying vec2 vQ; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vS; varying vec3 vD; varying vec3 vI; varying vec3 vT; varying float vZ;
${AP}
void main(){
  vec4 mv = viewMatrix*vec4(iPos, 1.0);
  float kind = iA.z, size = iA.x, len = 1.0, thin = 1.0;
  vec2 ax = vec2(cos(iC.z), sin(iC.z));
  if (kind > 1.5){
    vec3 vv = (viewMatrix*vec4(iVel, 0.0)).xyz; float sp = length(vv.xy);
    if (sp > 1e-3) ax = vv.xy/sp;
    // never thinner than most of a pixel: widen and pay for it in opacity
    float px = size/max(-mv.z, 0.1)*projectionMatrix[1][1]*uRes.y*0.5;
    thin = min(px/0.85, 1.0); size /= thin;
    len = min(max(iC.w*thin, 1.0)+0.5*sp*uShutter/size, kind > 2.5 ? 40.0 : 4.0);   // its own shape, smeared by its speed over the open shutter
  }
  vec2 s0 = (projectionMatrix*mv).xy/max(-mv.z, 1e-3);
  mv.xy += (ax*position.x*len+vec2(-ax.y, ax.x)*position.y)*size;
  gl_Position = projectionMatrix*mv;
  vQ = position.xy; vZ = -mv.z;
  vA = iA; vB = vec4(iB.rgb, iB.a*thin); vC = vec4(iC.xy, len, max(size*0.7, 0.35));
  vS = vec4(dot(uSunV.xy, ax), dot(uSunV.xy, vec2(-ax.y, ax.x)), uSunV.z, dot(normalize(mv.xyz), uSunV));
  vD = vec3(iD, 0.0);
  aerialLUT(s0*0.5+0.5, length(mv.xyz), vI, vT);
}`;
const P_FRAG = /* glsl */`
precision highp float; precision highp sampler3D;
${DEPTH}
uniform sampler2D tDepth, tDetail, tAmbient; uniform sampler3D tNoise3; uniform vec2 uRes; uniform vec3 uSunColor, uFireCol; uniform float uFire;
varying vec2 vQ; varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vS; varying vec3 vD; varying vec3 vI; varying vec3 vT; varying float vZ;
float sceneDist(){ float d = texture2D(tDepth, gl_FragCoord.xy/uRes).x; return d >= 0.999999 ? 1.0e9 : viewZ(d); }
vec3 fireRamp(float k){
  vec3 c = mix(vec3(0.30, 0.030, 0.004), vec3(0.95, 0.22, 0.03), smoothstep(0.05, 0.5, k));
  c = mix(c, vec3(1.0, 0.55, 0.17), smoothstep(0.5, 1.3, k));
  return mix(c, vec3(1.0, 0.88, 0.66), smoothstep(1.4, 3.2, k));
}
void main(){
  float kind = vA.z, seed = vA.y, ero = vA.w, sh = vC.x;
  vec2 q = vQ; float r2 = dot(q, q);
  float sd = sceneDist();
  float soft = clamp((sd-vZ)/vC.w, 0.0, 1.0)*clamp((vZ-1.5)/4.0, 0.0, 1.0);
  if (soft <= 0.0) discard;
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb*0.3183, sun = uSunColor*0.3183, col, emis = vec3(0.0);
  float a;
  if (kind < 1.5){
    // smoke, mist: an island of billow noise inside the quad; the threshold rises as the puff ages and thins
    if (r2 >= 1.0) discard;
    vec3 nq = vec3(q*0.21+vec2(seed*3.71, seed*7.13), seed*5.3+vD.x*0.03);
    vec4 n1 = texture(tNoise3, nq);
    vec4 n2 = texture(tNoise3, nq*3.3+vec3(0.37, 0.11, 0.53));
    float det = texture2D(tDetail, q*0.23+vec2(seed*9.7, seed*4.3)).r;
    float big = clamp((n1.r-0.52)*2.3, 0.0, 1.0), fine = clamp((n2.g-0.42)*2.0, 0.0, 1.0);
    float shape = big*0.62+fine*0.26+clamp((det-0.3)*2.5, 0.0, 1.0)*0.12;
    float dens;
    float wet = smoothstep(0.5, 0.8, vB.g);                                        // water and foam, not soot
    if (kind < 0.5){ dens = (1.0-r2)*(0.10+2.1*shape*shape)-ero; a = smoothstep(0.0, mix(0.42, 0.5, wet), dens); }
    else { float f = 1.0-r2; dens = f*sqrt(f)*(0.22+1.25*shape)-ero; a = smoothstep(0.0, 0.95, dens); }      // mist: a veil, no edge to speak of
    if (dens <= 0.0) discard;
    // light: the billow's own slope towards the sun, and where the pixel sits on the puff
    float bigS = clamp((texture(tNoise3, nq+vec3(vS.xy*0.03, 0.0)).r-0.52)*2.3, 0.0, 1.0);
    float slope = (big-bigS)*(kind < 0.5 ? 3.2 : 1.2);
    float wrap = clamp((dot(q, vS.xy)*0.8+sqrt(1.0-r2)*vS.z)*0.5+0.5, 0.0, 1.0);
    float sunT = kind < 0.5 ? mix(clamp(0.08+1.3*wrap*wrap+slope, 0.02, 2.2), clamp(0.34+1.05*wrap*wrap+slope*0.9, 0.14, 1.75), wet) : clamp(0.5+0.5*wrap+slope, 0.1, 1.4);
    float core = smoothstep(0.2, 1.0, dens);
    vec3 alb = vB.rgb*(kind < 0.5 ? mix(1.0, mix(0.6, 0.9, wet), core) : 1.0);
    col = alb*(sun*sunT*sh+amb*(0.45+0.55*sh)*(kind < 0.5 ? mix(1.0-0.35*core, 1.25-0.15*core, wet) : 1.3));
    if (kind > 0.5) col += vB.rgb*sun*pow(max(vS.w, 0.0), 5.0)*0.55*(1.0-0.7*core)*(0.4+0.6*sh);     // mist glows towards the sun
    col += alb*uFireCol*vD.y;
    if (vC.y > 0.002){
      float cracks = clamp(1.25-1.5*big, 0.0, 1.0)*(0.4+1.2*fine);               // as it cools the billows soot over and the creases still glow
      float hot = vC.y*smoothstep(0.02, 0.55, dens)*mix(cracks, 0.5+1.3*shape, smoothstep(0.5, 2.5, vC.y));
      emis = fireRamp(hot)*hot*uFire*a;
    }
  } else if (kind < 2.5){
    // water: fibres along the flight, head denser than the tail
    float u = q.x, v = q.y, len = vC.z;
    float env = (1.0-v*v)*(1.0-u*u)*(0.6+0.4*u);
    float f1 = texture2D(tDetail, vec2(u*0.011*len+seed*13.1, v*0.42+seed*7.7)).r;
    float f2 = texture2D(tDetail, vec2(u*0.035*len+seed*5.3, v*1.25+seed*3.3)).g;
    float fib = clamp((f1*0.6+f2*0.4-0.40)*3.6, 0.0, 1.0);
    fib = mix(fib, 0.3+0.5*fib, max(smoothstep(0.12, 0.4, ero), 1.0-smoothstep(1.4, 2.6, len)));   // old spray is mist, and a short clot of water has no grain: the fibres soften
    float dens = env*(0.05+2.2*fib*fib)-ero;
    if (dens <= 0.0) discard;
    a = smoothstep(0.0, 0.5, dens);
    float side = clamp(0.62+0.38*v*vS.y+0.25*(fib-0.5), 0.15, 1.1);
    col = vB.rgb*(sun*side*sh*1.1+amb*(0.5+0.5*sh)*1.2);
    col += vB.rgb*sun*pow(max(vS.w, 0.0), 5.0)*0.45*sh;
    col += vB.rgb*uFireCol*vD.y;
  } else {
    // debris: a dark sliver smeared along its path
    float e = (1.0-q.y*q.y)*(1.0-q.x*q.x);
    a = smoothstep(0.0, 0.45, e);
    col = vB.rgb*(sun*0.55+amb)+vB.rgb*uFireCol*vD.y*4.0;
  }
  a *= vB.a*soft;
  if (a < 0.003) discard;
  gl_FragColor = vec4((col*vT+vI)*a+emis*soft*vT, a);
}`;

const STRIDE = 20;
class Cloud {
  constructor(pipe, noise3, cap = 9000) {
    this.pipe = pipe; this.cap = cap; this.n = 0;
    this.buf = new Float32Array(cap * STRIDE); this.key = new Float32Array(cap); this.idx = new Uint32Array(cap);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.at = { iPos: mk(3), iVel: mk(3), iA: mk(4), iB: mk(4), iC: mk(4), iD: mk(2) };
    for (const k in this.at) geo.setAttribute(k, this.at[k]);
    geo.instanceCount = 0;
    const S = pipe.shared;
    this.U = { tDepth: S.tDepth, uRes: S.uRes, uLogFar: S.uLogFar, tDetail: S.tDetail, tAmbient: S.tAmbient, uSunColor: S.uSunColor, tApI: S.tApI, tApT: S.tApT,
      tNoise3: { value: noise3 }, uSunV: { value: new THREE.Vector3() }, uShutter: { value: 1 / 50 }, uFireCol: { value: new THREE.Vector3(2.6, 1.05, 0.26) }, uFire: { value: 2.4 } };
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: this.U, vertexShader: P_VERT, fragmentShader: P_FRAG,
    });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.layers.set(LAYER.FX); this.mesh.renderOrder = 4; this.mesh.visible = false;
    pipe.scene.add(this.mesh);
    this.claims = []; this.light = null;
  }
  // world position and velocity; half-width; seed; kind; erosion; albedo; alpha; sun visibility; emission; rotation; stretch; age; fire light
  push(x, y, z, vx, vy, vz, size, seed, kind, ero, r, g, b, alpha, shade, emis, rot, stretch, age, glow) {
    if (this.n >= this.cap || alpha < 0.004) return;
    const B = this.buf, o = this.n++ * STRIDE;
    B[o] = x; B[o + 1] = y; B[o + 2] = z; B[o + 3] = vx; B[o + 4] = vy; B[o + 5] = vz; B[o + 6] = size; B[o + 7] = seed; B[o + 8] = kind; B[o + 9] = ero;
    B[o + 10] = r; B[o + 11] = g; B[o + 12] = b; B[o + 13] = alpha; B[o + 14] = shade; B[o + 15] = emis; B[o + 16] = rot; B[o + 17] = stretch; B[o + 18] = age; B[o + 19] = glow;
  }
  commit(film) {
    const n = this.n, B = this.buf, O = film.origin, cam = this.pipe.camera, e = cam.matrixWorldInverse.elements, key = this.key;
    this.n = 0;
    this.mesh.visible = n > 0; this.mesh.geometry.instanceCount = n;
    if (!n) return;
    // far to near along the view axis
    for (let i = 0; i < n; i++) { const o = i * STRIDE; key[i] = e[2] * (B[o] - O.x) + e[6] * (B[o + 1] - O.y) + e[10] * (B[o + 2] - O.z); }
    const idx = this.idx.subarray(0, n); for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((p, q) => key[p] - key[q]);
    const { iPos, iVel, iA, iB, iC, iD } = this.at, P = iPos.array, V = iVel.array, A = iA.array, Bc = iB.array, C = iC.array, D = iD.array;
    for (let j = 0; j < n; j++) {
      const o = idx[j] * STRIDE, j3 = j * 3, j4 = j * 4;
      P[j3] = B[o] - O.x; P[j3 + 1] = B[o + 1] - O.y; P[j3 + 2] = B[o + 2] - O.z;
      V[j3] = B[o + 3]; V[j3 + 1] = B[o + 4]; V[j3 + 2] = B[o + 5];
      A[j4] = B[o + 6]; A[j4 + 1] = B[o + 7]; A[j4 + 2] = B[o + 8]; A[j4 + 3] = B[o + 9];
      Bc[j4] = B[o + 10]; Bc[j4 + 1] = B[o + 11]; Bc[j4 + 2] = B[o + 12]; Bc[j4 + 3] = B[o + 13];
      C[j4] = B[o + 14]; C[j4 + 1] = B[o + 15]; C[j4 + 2] = B[o + 16]; C[j4 + 3] = B[o + 17];
      D[j * 2] = B[o + 18]; D[j * 2 + 1] = B[o + 19];
    }
    for (const k in this.at) { const a = this.at[k]; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    this.U.uSunV.value.copy(this.pipe.atmo.sunDir).transformDirection(cam.matrixWorldInverse);
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
  float n = texture2D(tDetail, vP*0.021).r, n2 = texture2D(tDetail, vP*0.09+0.4).g, n3 = texture2D(tDetail, vP*0.37+0.7).r;
  float x = (r-uR*(0.95+0.1*n))/uW;
  float ring = exp(-x*x)*uK*(0.25+1.5*n2*n3*2.0);                                // the shock front ruffles the surface
  float glow = uGlow*exp(-r*r/(2.0*16.0*16.0))*(0.5+0.9*n2);                     // the fireball lighting the water
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

// ---------------------------------------------------------------- the rise of the smoke
// The head (the explosion's own thermal) and the column fed by the fire behind it. Heights in metres above the
// water, ages in seconds; both drift downwind faster the higher they are.
const headY = a => 3.0 + 9.0 * (1 - Math.exp(-a / 1.0)) + 3.4 * a / (1 + a / 60);
const headR = a => 6.6 * (1 - Math.exp(-a / 0.11)) * (1 + 0.05 * a);
const roll = a => 1.5 * a / (1 + a / 2.2);
const PL = { y0: 1.4, h1: 10, t1: 2.5, w: 2.4, r0: 1.5, rk: 1.25, rp: 0.8 };
const plumeY = al => PL.y0 + PL.h1 * (1 - Math.exp(-al / PL.t1)) + PL.w * al;
const plumeR = al => PL.r0 + PL.rk * Math.pow(al, PL.rp);
const shear = y => 0.55 + 0.45 * clamp(y / 45, 0, 2.2);

// a particle under gravity with linear drag k (1/s) in a wind: position and velocity after a seconds
function ballistic(q, a, wx, wz, out) {
  const k = q.k, vt = -G * q.grav / k, ek = Math.exp(-k * a), e = (1 - ek) / k;
  out[0] = q.p[0] + wx * a + (q.v[0] - wx) * e; out[1] = q.p[1] + vt * a + (q.v[1] - vt) * e; out[2] = q.p[2] + wz * a + (q.v[2] - wz) * e;
  out[3] = wx + (q.v[0] - wx) * ek; out[4] = vt + (q.v[1] - vt) * ek; out[5] = wz + (q.v[2] - wz) * ek;
  return out;
}

// ---------------------------------------------------------------- one detonation
// o: { x, z, T, noise3 (3D billow noise; the cloud layer's), ocean (foam and splash rings), wind: [x, z] m/s at
//      10 m, seed, scale (1 = a boat-borne charge against a pier), dust: [[x0,y0,z0, x1,y1,z1], ...] edges the
//      shock shakes, light: false to skip the fireball's point light }
const clouds = new WeakMap();
export function makeBlast(pipe, o) {
  const X = o.x, Z = o.z, T = o.T, seed = o.seed ?? Math.round(X * 7 + Z * 13), sc = o.scale ?? 1;
  const wind = o.wind || [3.2, 1.0];
  const noise3 = o.noise3 || (pipe.clouds && pipe.clouds.noise && pipe.clouds.noise.texture);
  if (!noise3) throw new Error('makeBlast needs a 3D noise texture (o.noise3 or a CloudLayer)');
  if (!clouds.has(pipe)) clouds.set(pipe, new Cloud(pipe, noise3));
  const cloud = clouds.get(pipe);
  const r = (() => { let s = (seed * 2654435761) >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const group = new THREE.Group(); group.name = 'blast'; pipe.scene.add(group);
  const flash = makeGlow(pipe, { color: [1.0, 0.9, 0.78], size: 12 * sc, depthSoft: 8 }); group.add(flash);
  const halo = makeGlow(pipe, { color: [1.0, 0.5, 0.18], size: 30 * sc, depthSoft: 20 }); group.add(halo);

  // ---- the head: the fireball's own gas, thrown out in a tenth of a second, then rising and turning over
  const head = [];
  const lobes = []; for (let j = 0; j < 7; j++) { const az = r() * 6.2832, cy = 0.15 + 0.85 * r(), sy = Math.sqrt(1 - cy * cy); lobes.push([Math.cos(az) * sy, cy, Math.sin(az) * sy, 0.65 + 0.8 * r()]); }
  for (let i = 0; i < 90; i++) {
    const L = lobes[i % 7], az = r() * 6.2832, cy = 2 * r() - 1, sy = Math.sqrt(1 - cy * cy), j = 0.75;
    let dx = L[0] + j * Math.cos(az) * sy, dy = Math.max(L[1] + j * cy, 0.03), dz = L[2] + j * Math.sin(az) * sy; const dl = Math.hypot(dx, dy, dz);
    head.push({ d: [dx / dl, dy / dl, dz / dl], s0: (14 + 40 * Math.pow(r(), 0.7)) * L[3] * sc, t0: r() * 0.03, u: r(), seed: r(), rv: (r() - 0.5) * 1.6, size: 0.75 + 0.55 * r() });
  }
  // ---- water
  const core = [], jets = [], mist = [], debris = [], st = new Float32Array(6);
  const flight = (q, max) => { for (let a = 0.08; a < max; a += 0.04) { ballistic(q, a, 0, 0, st); if (st[1] <= (q.floor ?? 0)) return a; } return max; };
  // the column: a dense white mass of water and foam, fed for a third of a second. Heavy with air drag: it is
  // 10 m up in 0.3 s, tops out near 25 m at two seconds, then slumps back and spreads. The first water out is the
  // fastest; a wider, slower part makes the shoulders round its foot
  for (let i = 0; i < 190; i++) {
    const az = r() * 6.2832, late = r() * r(), steep = r() < 0.7;
    const el = (steep ? 90 - 9 * r() : 80 - 34 * r()) * Math.PI / 180, sp = (steep ? 26 + 28 * Math.pow(r(), 0.75) : 12 + 16 * r()) * (1 - 0.45 * late) * Math.sqrt(sc), ce = Math.cos(el), rr = 2.4 * Math.sqrt(r()) * sc;
    const q = { t0: T + 0.01 + 0.34 * late, p: [X + Math.cos(az) * rr, 0.3, Z + Math.sin(az) * rr], v: [Math.cos(az) * ce * sp, Math.sin(el) * sp, Math.sin(az) * ce * sp],
      k: 0.95 + 0.6 * r(), grav: 0.55 + 0.25 * r(), s0: 0.9 + 0.5 * r(), s1: 2.6 + 1.5 * r(), a: 0.8 + 0.2 * r(), seed: r(), rv: (r() - 0.5) * 1.2, ph: r() * 6.2832, floor: 0.2 };
    q.life = Math.min(flight(q, 10), 9); core.push(q);
  }
  // fingers: short ragged jets that outrun the mass at its leading edge and break up within a second or two, and
  // the drops flung ahead of them. Each bundle shares a direction; gravity bends the path; nothing is drawn
  // longer than its own speed smears it over the shutter
  const bundle = (n, steep) => {
    const az = r() * 6.2832, el = (steep ? 76 + 13 * r() : 40 + 30 * r()) * Math.PI / 180, V = (steep ? 40 + 20 * r() : 20 + 14 * r()) * Math.sqrt(sc), kk = 0.55 + 0.3 * r(), r0 = 1.4 * Math.sqrt(r()) * sc, a0 = r() * 6.2832;
    for (let i = 0; i < n; i++) {
      const drop = i >= n * 0.55, a2 = az + (r() - 0.5) * (drop ? 0.5 : 0.03), e2 = Math.min(el + (r() - 0.5) * (drop ? 0.4 : 0.03), 1.56), ce = Math.cos(e2), sp = V * (drop ? 0.55 + 0.75 * r() : 0.55 + 0.45 * (i + r()) / (n * 0.55));      // one path, the water strung out along it by speed
      const q = { t0: T + 0.01 + 0.03 * r(), p: [X + Math.cos(a0) * r0, 0.3, Z + Math.sin(a0) * r0], v: [Math.cos(a2) * ce * sp, Math.sin(e2) * sp, Math.sin(a2) * ce * sp],
        k: drop ? kk + 0.5 + 0.5 * r() : kk, grav: 1, w0: drop ? 0.05 + 0.06 * r() : 0.3 + 0.2 * r(), w1: drop ? 0.12 + 0.1 * r() : 0.9 + 0.6 * r(), a: drop ? 0.3 + 0.35 * r() : 0.45 + 0.25 * r(), seed: r(), floor: -0.2 };
      q.life = Math.min(flight(q, 7), drop ? 0.8 + 1.0 * r() : 1.5 + 1.3 * r()); jets.push(q);
    }
  };
  for (let g = 0; g < 14; g++) bundle(11, true);
  for (let g = 0; g < 12; g++) bundle(10, false);
  // mist: what the column sheds as it slumps. It hangs low, spreads along the surface and drifts off downwind
  for (let i = 0; i < 70; i++) {       // high: the fine part left hanging where the column stood
    const az = r() * 6.2832, rr = (0.5 + 2.8 * r()) * sc;
    mist.push({ t0: T + 0.5 + 1.8 * r(), p: [X + Math.cos(az) * rr, 4 + 16 * r() * r(), Z + Math.sin(az) * rr], v: [Math.cos(az) * 2 * r(), 1.5 - 3 * r(), Math.sin(az) * 2 * r()],
      k: 1.4, grav: 0.14 + 0.12 * r(), life: 4 + 4 * r(), s0: 1.6 + 0.8 * r(), s1: 3.6 + 2.4 * r(), a: 0.16 + 0.14 * r(), seed: r(), rv: (r() - 0.5) * 0.6, col: [0.9, 0.92, 0.94], wk: 0.7, e1: 0.5 });
  }
  for (let i = 0; i < 110; i++) {      // low: the bank that rolls out from the foot and goes with the wind
    const az = r() * 6.2832, sp = (5 + 9 * r()) * Math.sqrt(sc), rr = (2 + 3 * r()) * sc;
    mist.push({ t0: T + 0.9 + 3.2 * r(), p: [X + Math.cos(az) * rr, 0.6 + 1.6 * r(), Z + Math.sin(az) * rr], v: [Math.cos(az) * sp, 0.4 + 1.2 * r(), Math.sin(az) * sp],
      k: 0.8 + 0.5 * r(), grav: 0.015, life: 6 + 6 * r(), s0: 1.2 + 0.6 * r(), s1: 3.0 + 2.6 * r(), a: 0.2 + 0.18 * r(), seed: r(), rv: (r() - 0.5) * 0.5, col: [0.88, 0.9, 0.92], wk: 0.85, e1: 0.5 });
  }
  // ---- debris: small, fast, most of it gone in a second; each piece lands with a little splash and a ring
  const splash = [];
  for (let i = 0; i < 46; i++) {
    const az = r() * 6.2832, el = (8 + 74 * Math.pow(r(), 0.8)) * Math.PI / 180, sp = (16 + 44 * Math.pow(r(), 1.3)) * Math.sqrt(sc), big = r() < 0.2;
    const q = { t0: T + 0.01 + r() * 0.04, p: [X, 1.0 + r() * 1.5, Z], v: [Math.cos(az) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(az) * Math.cos(el) * sp],
      k: big ? 0.07 : 0.14 + 0.2 * r(), grav: 1, w: big ? 0.055 + 0.04 * r() : 0.02 + 0.03 * r(), st: 1.5 + 2.5 * r(), seed: r(), big };
    q.life = flight(q, 9); if (q.life >= 9) continue;
    debris.push(q);
    ballistic(q, q.life, 0, 0, st);
    const lx = st[0], lz = st[2], tl = q.t0 + q.life, n = big ? 7 : 4;
    for (let j = 0; j < n; j++) {
      const a2 = r() * 6.2832, s2 = (2.2 + 3.2 * r()) * (big ? 1.5 : 1);
      splash.push({ t0: tl + r() * 0.03, p: [lx, 0.05, lz], v: [Math.cos(a2) * s2 * 0.22, s2, Math.sin(a2) * s2 * 0.22], k: 0.6, grav: 1, w0: 0.035, w1: big ? 0.2 : 0.11, st: 3 + 2 * r(), a: 0.75, seed: r(), life: 0.45 + 0.4 * r(), floor: -0.2 });
    }
    if (o.ocean) o.ocean.discs.push({ x: lx, z: lz, t0: tl, dur: 2.2 + (big ? 1.5 : 0), r0: 0.2, r1: big ? 2.6 : 1.3, k: big ? 0.7 : 0.45 });
  }
  // ---- dust off the structures when the shock gets there (340 m/s)
  for (const sgm of o.dust || []) {
    const [x0, y0, z0, x1, y1, z1] = sgm, L = Math.hypot(x1 - x0, y1 - y0, z1 - z0), n = Math.min(40, Math.ceil(L * 0.7));
    for (let i = 0; i < n; i++) {
      const u = r(), px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u, pz = z0 + (z1 - z0) * u, dist = Math.hypot(px - X, py - 2, pz - Z);
      if (dist > 50 || dist < 1) continue;
      const k = 1 / (1 + dist / 14), dx = (px - X) / dist, dz = (pz - Z) / dist;
      mist.push({ t0: T + dist / 340 + r() * 0.05, p: [px, py, pz], v: [dx * 3 * k + (r() - 0.5) * 0.8, -0.2 - r() * 1.0, dz * 3 * k + (r() - 0.5) * 0.8], k: 1.6, grav: 0.08, life: 2.2 + 2.2 * r(),
        s0: 0.3, s1: 1.0 + 1.6 * r() * (0.5 + k), a: 0.1 + 0.2 * k, seed: r(), rv: (r() - 0.5) * 0.6, col: [0.5, 0.46, 0.4], wk: 0.4, e1: 0.5 });
    }
  }
  // foam: the column falls back into a patch of white water that opens into a ring
  if (o.ocean) {
    o.ocean.discs.push({ x: X, z: Z, t0: T + 0.1, dur: 7, r0: 2.5 * sc, r1: 15 * sc, k: 1 });
    o.ocean.discs.push({ x: X + 1.5, z: Z + 2, t0: T + 1.6, dur: 11, r0: 5 * sc, r1: 27 * sc, k: 0.8 });
  }

  const ringU = { tDepth: pipe.shared.tDepth, tDetail: pipe.shared.tDetail, uRes: pipe.shared.uRes, uLogFar: pipe.shared.uLogFar,
    uR: { value: 0 }, uW: { value: 2 }, uK: { value: 0 }, uGlow: { value: 0 }, uGlowCol: { value: new THREE.Vector3(1, 0.42, 0.12) }, uSky: { value: new THREE.Vector3(0.5, 0.55, 0.6) }, uScale: { value: 60 } };
  const ring = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: ringU, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.frustumCulled = false; ring.layers.set(LAYER.FX); ring.renderOrder = 1; group.add(ring);
  const shellU = { tDepth: pipe.shared.tDepth, uRes: pipe.shared.uRes, uLogFar: pipe.shared.uLogFar, uK: { value: 0 } };
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({ uniforms: shellU, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  shell.frustumCulled = false; shell.layers.set(LAYER.DISTORT); group.add(shell);

  if (o.light !== false && !cloud.light) {
    cloud.light = new THREE.PointLight(0xff9248, 0, 300, 2); cloud.light.castShadow = false; pipe.scene.add(cloud.light);
  }
  const tmp = new THREE.Vector3();
  const RATE = 11, LIFE = 20, T0C = T + 0.25;          // the column: parcels per second, their life, when the fire starts feeding it
  function update(film, t, visible) {
    const a = t - T, live = visible && a > -0.02;
    group.visible = live;
    if (!live) return 0;
    const A = Math.max(a, 0), sunD = film.pipe.atmo.sunDir;
    const sh = Math.hypot(sunD.x, sunD.z) || 1, sx = sunD.x / sh, sz = sunD.z / sh;
    tmp.set(X, 0, Z); film.place(group, tmp);
    const fire = 7.0 * Math.exp(-A / 0.1) + 1.6 * Math.exp(-A / 0.32);                 // the fireball's light on what is near it
    const glowNear = A > 0 ? 0.5 * Math.exp(-A / 0.1) + 0.06 * Math.exp(-A / 0.35) : 0;
    if (A > 0) {
      // ---- head
      const hy = headY(A) * sc, hR = headR(A) * sc, hd = A * shear(hy * 0.7), hx = X + wind[0] * hd * 0.85, hz = Z + wind[1] * hd * 0.85, ph = roll(A), cs = Math.cos(ph), sn = Math.sin(ph);
      const grow = 1 + 0.05 * A, hAlpha = 0.95 * smooth(30, 55, 85 - A) / (1 + A / 10), hAlb = 0.055 + 0.22 * smooth(1.0, 22, A), hEro = 0.06 + 0.5 * smooth(1.5, 32, A);
      for (const c of head) {
        const aa = A - c.t0; if (aa <= 0) continue;
        const e9 = (1 - Math.exp(-9 * aa)) / 9;
        let ox = c.d[0] * c.s0 * e9, oy = c.d[1] * c.s0 * e9, oz = c.d[2] * c.s0 * e9;
        const rho = Math.hypot(ox, oz) + 1e-4, Rr = 0.5 * hR, rp = rho - Rr, yy = oy - 0.45 * hR;          // turn about the ring's core
        const rho2 = Rr + cs * rp + sn * yy, y2 = -sn * rp + cs * yy, kx = ox / rho, kz = oz / rho;
        ox = kx * rho2 * grow; oz = kz * rho2 * grow; oy = y2 * grow * 0.9;
        const depth = clamp((hR * grow - (ox * sunD.x + oy * sunD.y + oz * sunD.z)) / (2 * hR * grow + 1e-3)), opac = clamp(hAlpha * 1.2);
        const shade = 1 - opac + opac * Math.max(Math.exp(-3.0 * depth), 0.05);
        const em = (15 * Math.exp(-aa / 0.075) + 4.0 * Math.exp(-aa / 0.16) * (0.4 + c.u) + 0.45 * Math.exp(-aa / 0.5) * c.u * c.u) * smooth(0, 0.012, aa);
        const size = (1.1 + 2.5 * (1 - Math.exp(-aa / 0.16))) * c.size * sc * (1 + 0.075 * aa);
        const warm = 1 - smooth(2, 20, A);
        cloud.push(hx + ox, Math.max(hy + oy, 0.6), hz + oz, 0, 0, 0, size, c.seed, K_SMOKE, hEro + 0.1 * c.u, hAlb * (1 + 0.1 * warm), hAlb, hAlb * (1 - 0.14 * warm),
          hAlpha * smooth(0, 0.02, aa), shade, em, c.seed * 6.283 + c.rv * aa / (1 + aa / 4), 1, aa, 0);
      }
      // ---- the column behind it
      const k1 = Math.floor((t - T0C) * RATE), k0 = Math.max(0, Math.ceil((t - T0C - LIFE) * RATE));
      for (let k = k0; k <= k1; k++) {
        const tb = T0C + k / RATE, al = t - tb; if (al <= 0 || al >= LIFE) continue;
        const h = k * 7.31 + seed * 0.613, u1 = hash(h), u2 = hash(h + 0.17), u3 = hash(h + 0.31), u4 = hash(h + 0.53), u5 = hash(h + 0.71), u6 = hash(h + 0.89);
        const y = plumeY(al) * sc, R = plumeR(al) * sc, shr = shear(y), th = 6.2832 * u2 + (u3 - 0.5) * 0.8 * al, rho = R * 0.7 * Math.sqrt(u1), wob = 0.2 * R;
        const ox = Math.cos(th) * rho + wob * Math.sin(al * 1.1 + u4 * 6.283), oz = Math.sin(th) * rho + wob * Math.cos(al * 0.9 + u5 * 6.283);
        const src = 1 / (1 + (tb - T) / 28);
        const alpha = 0.82 * smooth(0, 0.3, al) / (1 + al / 5.5) * (1 - smooth(0.7 * LIFE, LIFE, al)) * src;
        const depth = clamp((R - (ox * sx + oz * sz)) / (2 * R)), opac = clamp(alpha * 2.2);
        const shade = 1 - opac + opac * Math.max(Math.exp(-2.8 * depth), 0.06);
        const alb = 0.05 + 0.33 * smooth(0.5, 15, al), fl = al < 0.8 ? 2.0 * (1 - al / 0.8) ** 2 * (0.6 + 0.4 * Math.sin(t * 21 + u4 * 40)) * (0.4 + u5) * src : 0;
        cloud.push(X + wind[0] * al * shr + ox, y + (u6 - 0.5) * 0.7 * R, Z + wind[1] * al * shr + oz, 0, 0, 0, R * (0.55 + 0.5 * u5), u4, K_SMOKE, 0.1 + 0.42 * smooth(1, LIFE, al) + 0.08 * u6,
          alb * 1.04, alb, alb * 0.95, alpha, shade, fl, u2 * 6.283 + (u3 - 0.5) * 0.5 * al, 1, al, 0);
      }
    }
    // ---- water
    const wx = wind[0] * 0.3, wz = wind[1] * 0.3;
    for (const q of core) {
      const aa = t - q.t0; if (aa <= 0 || aa >= q.life) continue;
      ballistic(q, aa, wx, wz, st);
      const f = aa / q.life, size = (q.s0 + (q.s1 - q.s0) * (1 - Math.exp(-aa / 1.1))) * sc, wob = 0.3 * size * Math.min(aa, 1);
      const x = st[0] + wob * Math.sin(aa * 1.7 + q.ph), z = st[2] + wob * Math.cos(aa * 1.4 + q.ph * 1.7), y = Math.max(st[1], 0.35 * size);
      const ox = x - X, oz = z - Z, Rc = (3.5 + 0.22 * y) * sc, depth = clamp((Rc - (ox * sunD.x + oz * sunD.z + (y - 9) * sunD.y * 0.5)) / (2 * Rc));
      const fall = st[4] < 0 ? smooth(-1, -7, st[4]) : 0;                                   // falling back: the mass thins into curtains
      const alpha = q.a * smooth(0, 0.03, aa) * (1 - smooth(0.72, 1, f)) / (1 + 0.1 * aa * aa), shade = Math.max(Math.exp(-1.8 * depth), 0.36) * (0.72 + 0.28 * smooth(0, 7, y));
      const gl = glowNear * Math.exp(-(ox * ox + oz * oz + y * y) / 150);
      cloud.push(x, y, z, 0, 0, 0, size, q.seed, K_SMOKE, 0.04 + 0.42 * smooth(0.2, 1, f) + 0.1 * fall, 0.9, 0.92, 0.94, alpha * (1 - 0.55 * fall), shade, 0, q.seed * 6.283 + q.rv * aa / (1 + aa / 3), 1, aa, gl);
      if (fall > 0.01) cloud.push(x, y - 0.5 * size, z, st[3], st[4], st[5], size * 0.75, q.seed + 0.31, K_WATER, 0.22 + 0.25 * f, 0.9, 0.92, 0.94, alpha * fall * 0.75, shade, 0, 0, 2.2, aa, 0);
    }
    for (const q of jets) {
      const aa = t - q.t0; if (aa <= 0 || aa >= q.life) continue;
      ballistic(q, aa, wx, wz, st);
      const f = aa / q.life, w = (q.w0 + (q.w1 - q.w0) * Math.pow(f, 0.7)) * sc;
      const ox = st[0] - X, oz = st[2] - Z, depth = clamp((5 - (ox * sx + oz * sz)) / 10);
      cloud.push(st[0], st[1], st[2], st[3], st[4], st[5], w, q.seed, K_WATER, 0.04 + 0.5 * smooth(0.3, 1, f), 0.9, 0.92, 0.94,
        q.a * smooth(0, 0.03, aa) * (1 - smooth(0.6, 1, f)) * clamp((st[1] + 0.6) / 1.2), Math.max(Math.exp(-1.4 * depth), 0.4), 0, 0, 1, aa, glowNear * Math.exp(-(ox * ox + oz * oz + st[1] * st[1]) / 150));
    }
    const mw = [wind[0], wind[1]];
    for (const q of mist) {
      const aa = t - q.t0; if (aa <= 0 || aa >= q.life) continue;
      ballistic(q, aa, mw[0] * q.wk, mw[1] * q.wk, st);
      if (st[1] < 0.3) st[1] = 0.3 + (0.3 - st[1]) * 0.2;
      const f = aa / q.life, ox = st[0] - X, oz = st[2] - Z, depth = clamp((9 - (ox * sx + oz * sz)) / 18);
      cloud.push(st[0], st[1], st[2], 0, 0, 0, (q.s0 + (q.s1 - q.s0) * Math.pow(f, 0.55)) * sc, q.seed, K_MIST, 0.07 + q.e1 * smooth(0.15, 1, f), q.col[0], q.col[1], q.col[2],
        q.a * smooth(0, 0.08, f) * (1 - smooth(0.6, 1, f)), Math.max(Math.exp(-1.6 * depth), 0.3), 0, q.seed * 6.283 + q.rv * aa, 1, aa, glowNear * Math.exp(-(ox * ox + oz * oz + st[1] * st[1]) / 150));
    }
    for (const q of splash) {
      const aa = t - q.t0; if (aa <= 0 || aa >= q.life) continue;
      ballistic(q, aa, 0, 0, st); if (st[1] < q.floor) continue;
      const f = aa / q.life;
      cloud.push(st[0], st[1], st[2], st[3], st[4], st[5], q.w0 + (q.w1 - q.w0) * Math.sqrt(f), q.seed, K_WATER, 0.05 + 0.3 * f, 0.92, 0.94, 0.95, q.a * (1 - smooth(0.5, 1, f)), 1, 0, 0, q.st, aa, 0);
    }
    // ---- debris
    for (const q of debris) {
      const aa = t - q.t0; if (aa <= 0 || aa >= q.life) continue;
      ballistic(q, aa, 0, 0, st);
      cloud.push(st[0], st[1], st[2], st[3], st[4], st[5], q.w, q.seed, K_DEBRIS, 0, 0.035, 0.032, 0.03, 1, 1, 0, 0, q.st, aa, glowNear);
    }
    // ---- flash and glow
    flash.userData.set(A > 0 ? 110 * Math.exp(-A / 0.022) : 0, 11 * sc); flash.position.set(0, 2.2 * sc, 0);
    halo.userData.set(A > 0 ? 3.6 * Math.exp(-A / 0.07) + 0.5 * Math.exp(-A / 0.3) : 0, (20 + 14 * smooth(0, 0.3, A)) * sc); halo.position.set(0, 4 * sc, 0);
    // ---- pressure ring and light on the water
    ring.visible = A < 1.2;
    ringU.uR.value = 340 * A; ringU.uW.value = 0.8 + 6 * A; ringU.uK.value = A < 0.6 ? 0.55 * (1 - smooth(0.02, 0.6, A)) : 0;
    ringU.uGlow.value = 0.8 * fire; ringU.uScale.value = Math.max(345 * Math.min(A, 0.6) + 50, 50); ring.position.set(0, 0.12, 0);
    shell.visible = A > 0 && A < 0.4; shell.scale.setScalar(Math.max(340 * A, 0.5)); shellU.uK.value = 0.01 * (1 - smooth(0.04, 0.4, A));
    if (cloud.light) {
      const L = A > 0 ? 1.5e5 * Math.exp(-A / 0.03) + 1.0e4 * Math.exp(-A / 0.22) + 500 * smooth(0.8, 1.6, A) * (1 - smooth(30, 70, A)) * (0.8 + 0.2 * Math.sin(t * 17.3 + seed)) : 0;
      cloud.claims.push({ L, x: X, y: 4 * sc, z: Z });
    }
    return fire;
  }
  return { update, group };
}

// once per frame after every blast's update(): sort and upload the particles; the brightest fireball gets the light
export function finishBlasts(film) {
  const cloud = clouds.get(film.pipe);
  if (!cloud) return;
  cloud.commit(film);
  if (!cloud.light) return;
  const c = cloud.claims; let best = null;
  for (const k of c) if (!best || k.L > best.L) best = k;
  c.length = 0;
  // the light stays in the scene (intensity 0 when idle) so shader programs never change between frames
  cloud.light.intensity = best ? best.L : 0;
  if (best) cloud.light.position.set(best.x - film.origin.x, best.y - film.origin.y, best.z - film.origin.z);
}
export const resolveBlastLight = finishBlasts;
