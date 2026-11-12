// Transparent effects drawn after the atmosphere pass: exhaust plumes, particle trails, glows, and
// refraction sources (heat haze, shock fronts) drawn into the distortion buffer.
import * as THREE from 'three';
import { NOISE, DEPTH } from './glsl.js';
import { LAYER } from './pipeline.js';

const SOFT = /* glsl */`
${DEPTH}
uniform sampler2D tDepth; uniform vec2 uRes;
float sceneDist(){ float d = texture2D(tDepth, gl_FragCoord.xy/uRes).x; return d >= 0.999999 ? 1.0e9 : viewZ(d); }
`;
const fxU = pipe => ({ tDepth: pipe.shared.tDepth, uRes: pipe.shared.uRes, uLogFar: pipe.shared.uLogFar, uTime: pipe.shared.uTime, tDetail: pipe.shared.tDetail });

// ---------------------------------------------------------------- afterburner / exhaust plume
// A glowing, optically thin volume along -x of the parent, ray-marched inside a bounding cylinder: a hot core,
// a turbulent flame body, standing shock diamonds (the jet is under-expanded) and a faint blue-violet sheath
// at the nozzle lip.
export function makePlume(pipe, { length = 9, radius = 0.47, diamonds = 7, color = [1.0, 0.36, 0.09], core = [1.0, 0.74, 0.46] } = {}) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, false);
  geo.rotateZ(Math.PI / 2); geo.translate(-0.5, 0, 0); // x in [-1,0], unit radius
  const uCamL = { value: new THREE.Vector3() };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { ...fxU(pipe), uLen: { value: length }, uRad: { value: radius }, uPower: { value: 0 }, uDiamonds: { value: diamonds },
      uColor: { value: new THREE.Vector3(...color) }, uCore: { value: new THREE.Vector3(...core) }, uGain: { value: 1 }, uCamL, uFrame: pipe.shared.uFrame },
    vertexShader: /* glsl */`
      uniform float uLen, uRad, uPower;
      varying vec3 vL; varying float vZ;
      void main(){
        vL = vec3(position.x*uLen*(0.35+0.65*uPower), position.y*uRad*1.9, position.z*uRad*1.9);
        vec4 mv = modelViewMatrix*vec4(vL,1.0);
        vZ = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${NOISE}
      ${SOFT}
      uniform float uLen, uRad, uPower, uDiamonds, uTime, uGain, uFrame; uniform vec3 uColor, uCore, uCamL; uniform sampler2D tDetail;
      varying vec3 vL; varying float vZ;
      vec3 emit(vec3 p, float L){
        float a = -p.x/L; if (a <= 0.0 || a >= 1.0) return vec3(0.0);
        float r = length(p.yz)/uRad;
        float ph = a*uDiamonds, cell = fract(ph);
        float bulge = sin(cell*3.14159); bulge *= bulge;                         // each shock cell swells, then necks down
        float Rj = (1.0-0.42*a)*(0.82+0.2*bulge*(1.0-0.6*a));
        float ang = atan(p.z, p.y);
        float n = texture2D(tDetail, vec2(a*2.3-uTime*2.9, ang*0.16+r*0.21)).r;
        float n2 = texture2D(tDetail, vec2(a*6.1-uTime*6.3, ang*0.32+0.4)).g;
        float body = smoothstep(Rj*(1.02+0.16*(n-0.5)), Rj*0.30, r);
        float hot = smoothstep(0.62*Rj, 0.0, r);
        float cd = (cell-0.16)/0.15; float dia = exp(-cd*cd)*smoothstep(Rj*(0.95-0.9*abs(cell-0.16)*2.2), 0.0, r);   // lozenge after each neck
        float tail = (1.0-a)*(1.0-a);
        vec3 e = uColor*body*(0.45+0.75*n)*exp(-a*2.4)*0.9
               + mix(uColor, uCore, 0.75)*hot*exp(-a*4.2)*1.5
               + mix(uCore, vec3(1.0,0.93,0.82), 0.6)*dia*exp(-a*2.6)*(0.8+0.4*n2)*3.4
               + uCore*hot*exp(-a*22.0)*3.0;
        float sh = (r-Rj)/0.11; float sheath = exp(-sh*sh);
        e += vec3(0.30,0.36,1.0)*sheath*exp(-a*7.5)*0.55;
        return e*tail;
      }
      void main(){
        float L = uLen*(0.35+0.65*uPower), Rb = uRad*1.9;
        vec3 ro = uCamL, dv = vL-uCamL; float far = length(dv); vec3 rd = dv/far;
        // ray against the bounding cylinder (axis x, x in [-L,0], radius Rb)
        float A = dot(rd.yz, rd.yz), B = dot(ro.yz, rd.yz), C = dot(ro.yz, ro.yz)-Rb*Rb;
        float t0 = 0.0, t1 = far;
        if (A > 1e-8){ float disc = B*B-A*C; if (disc <= 0.0) discard; float sq = sqrt(disc); t0 = max(t0, (-B-sq)/A); t1 = min(t1, (-B+sq)/A); }
        else if (C > 0.0) discard;
        if (abs(rd.x) > 1e-6){ float ta = (-L-ro.x)/rd.x, tb = (0.0-ro.x)/rd.x; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
        else if (ro.x > 0.0 || ro.x < -L) discard;
        t1 = min(t1, sceneDist()*far/max(vZ, 1e-3));                              // stop at solid geometry
        if (t1 <= t0) discard;
        const int N = 30;
        float ds = (t1-t0)/float(N), t = t0+ds*fract(ign(gl_FragCoord.xy)+uFrame*0.618);
        vec3 acc = vec3(0.0);
        for (int i=0;i<N;i++){ acc += emit(ro+rd*t, L); t += ds; }
        float flick = 0.92+0.08*sin(uTime*71.0)+0.05*sin(uTime*173.0);
        gl_FragColor = vec4(acc*(ds/uRad)*uPower*uPower*flick*uGain*0.5, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.layers.set(LAYER.FX); m.renderOrder = 5;
  const inv = new THREE.Matrix4();
  m.onBeforeRender = (renderer, scene, camera) => { inv.copy(m.matrixWorld).invert(); uCamL.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv); };
  m.userData.set = (power, gain = 1) => { mat.uniforms.uPower.value = power; mat.uniforms.uGain.value = gain; m.visible = power > 0.01; };
  return m;
}

// ---------------------------------------------------------------- heat haze (refraction) behind a nozzle
export function makeHeatHaze(pipe, { length = 30, radius = 0.6, spread = 3.2, strength = 0.004 } = {}) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 16, true);
  geo.rotateZ(Math.PI / 2); geo.translate(-0.5, 0, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...fxU(pipe), uLen: { value: length }, uRad: { value: radius }, uSpread: { value: spread }, uStrength: { value: strength } },
    vertexShader: /* glsl */`
      uniform float uLen, uRad, uSpread;
      varying float vAx; varying vec3 vN; varying vec3 vV; varying float vZ; varying vec3 vP;
      void main(){
        float a = -position.x; vAx = a; float r = uRad*(1.0+uSpread*a);
        vec3 p = vec3(position.x*uLen, position.y*r, position.z*r); vP = p;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vN = normalize(normalMatrix*vec3(0.0, position.y, position.z)); vV = normalize(-mv.xyz); vZ = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${SOFT}
      uniform float uTime, uStrength; uniform sampler2D tDetail;
      varying float vAx; varying vec3 vN; varying vec3 vV; varying float vZ; varying vec3 vP;
      void main(){
        if (vZ > sceneDist()) discard;
        float thick = pow(abs(dot(normalize(vN), normalize(vV))), 1.2);
        vec2 q = vec2(vP.x*0.22+uTime*9.0, vP.y*0.5+vP.z*0.31);
        vec2 n = vec2(texture2D(tDetail, q*0.13).r, texture2D(tDetail, q*0.13+0.47).g)-0.5;
        n += (vec2(texture2D(tDetail, q*0.41+0.2).g, texture2D(tDetail, q*0.41+0.71).r)-0.5)*0.6;
        float k = thick*(1.0-vAx)*(1.0-vAx)*smoothstep(0.0, 0.02, vAx);
        gl_FragColor = vec4(n*uStrength*k, 0.0, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.layers.set(LAYER.DISTORT);
  m.userData.set = k => { mat.uniforms.uStrength.value = strength * k; m.visible = k > 0.001; };
  return m;
}

// ---------------------------------------------------------------- shock front (refraction along a Mach cone)
// Cone opening aft from `apex` with half-angle mu. Light bends most where the sheet is seen edge-on.
export function makeShockCone(pipe, { length = 60, strength = 0.006 } = {}) {
  const geo = new THREE.CylinderGeometry(0, 1, 1, 64, 24, true); // apex at +y
  geo.rotateZ(-Math.PI / 2); geo.translate(-0.5, 0, 0);         // apex at x=0, opening towards -x; unit radius at x=-1
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...fxU(pipe), uLen: { value: length }, uTan: { value: 1 }, uStrength: { value: 0 } },
    vertexShader: /* glsl */`
      uniform float uLen, uTan;
      varying vec3 vN; varying vec3 vV; varying float vZ; varying float vAx; varying vec3 vAxis;
      void main(){
        float a = -position.x; vAx = a; float r = a*uLen*uTan;
        vec3 p = vec3(position.x*uLen, position.y*r, position.z*r);
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vN = normalize(normalMatrix*vec3(0.0, normalize(position.yz+1e-6)));   // radial direction
        vAxis = normalize(normalMatrix*vec3(1.0, 0.0, 0.0));
        vV = normalize(-mv.xyz); vZ = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${SOFT}
      uniform float uStrength;
      varying vec3 vN; varying vec3 vV; varying float vZ; varying float vAx; varying vec3 vAxis;
      void main(){
        if (vZ > sceneDist()) discard;
        vec3 n = normalize(vN), ax = normalize(vAxis), V = normalize(vV);
        vec3 vp = V-dot(V,ax)*ax; float side = length(vp);    // 0 when looking straight down the axis
        float e = clamp(1.0-abs(dot(n, vp/max(side,1e-4))), 0.0, 1.0);
        float k = pow(e, 7.0)*side*(1.0-vAx)*smoothstep(0.0, 0.03, vAx);
        gl_FragColor = vec4(normalize(n.xy+1e-5)*uStrength*k, 0.0, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.layers.set(LAYER.DISTORT);
  // faint bright/dark fringe where the sheet is edge-on (shadowgraph-style visualisation aid)
  const lineMat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { ...fxU(pipe), uLen: mat.uniforms.uLen, uTan: mat.uniforms.uTan, uLine: { value: 0 }, uTone: { value: new THREE.Vector3(5, 5.2, 5.6) } },
    vertexShader: mat.vertexShader,
    fragmentShader: /* glsl */`
      precision highp float;
      ${SOFT}
      uniform float uLine; uniform vec3 uTone;
      varying vec3 vN; varying vec3 vV; varying float vZ; varying float vAx; varying vec3 vAxis;
      void main(){
        if (vZ > sceneDist()) discard;
        vec3 n = normalize(vN), ax = normalize(vAxis), V = normalize(vV);
        vec3 vp = V-dot(V,ax)*ax; float side = length(vp);
        float e = clamp(1.0-abs(dot(n, vp/max(side,1e-4))), 0.0, 1.0);
        float a = clamp(pow(e, 34.0)*side*(1.0-vAx)*smoothstep(0.0, 0.02, vAx)*uLine*1.3, 0.0, 1.0);
        gl_FragColor = vec4(uTone*a, a*0.5);
      }`,
  });
  const lines = new THREE.Mesh(geo, lineMat); lines.frustumCulled = false; lines.layers.set(LAYER.FX); lines.renderOrder = 4;
  const g = new THREE.Group(); g.add(m, lines);
  // mach <= 1: hidden. Strength eases in just past Mach 1. line = brightness of the visible fringe (0 = refraction only)
  g.userData.set = (mach, gain = 1, line = 0) => {
    if (mach <= 1.001 || gain <= 0) { g.visible = false; return; }
    g.visible = true; const mu = Math.asin(1 / mach), k = Math.min(1, (mach - 1) / 0.03);
    mat.uniforms.uTan.value = Math.tan(mu); mat.uniforms.uStrength.value = strength * gain * k;
    lineMat.uniforms.uLine.value = line * k; lines.visible = line > 0.001;
  };
  g.userData.layers = () => { m.layers.set(LAYER.DISTORT); lines.layers.set(LAYER.FX); };
  return g;
}

// ---------------------------------------------------------------- particle trails (stateless, deterministic)
// Each particle is born at k/rate seconds; its state is a pure function of (now, birth time, seed), so frames
// can be rendered in any order. emitter(time, outVec3, k) returns the world position of the source (k: the
// particle's integer id, for emitters that spread particles along a line); vel(time, outVec3, k) its launch velocity.
// Options for water droplets (all off by default):
//   ballistic: launch at vel, then linear drag towards the terminal velocity `drift` (gravity / drag)
//   stretch:   streak each particle along its screen-space motion over `stretch` seconds (motion blur of a drop;
//              set mat.uniforms.uCamVel to the camera's world velocity when the camera moves)
//   hard:      0 soft puff .. 1 a crisp disc; minPx: no particle smaller than this many pixels (its alpha falls
//              with the area instead, so sub-pixel drops do not alias); sizeLog: sizes log-distributed from size0
//              to size1 (many small, few large) instead of growing with age
//   phase:     [g, k] Henyey-Greenstein forward scattering of the sun, k = weight (backlit spray glows at its rim)
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export class Trail {
  constructor(pipe, o = {}) {
    this.pipe = pipe;
    this.o = { rate: 60, life: 6, size0: 0.4, size1: 6, grow: 0.6, color: [0.9, 0.9, 0.92], alpha: 0.6, jitter: 0.3, drift: [0, 0.3, 0], drag: 2.0, spreadV: 1.5, lit: 1, emissive: [0, 0, 0], emissiveLife: 0.15, additive: false, softness: 2, fadeIn: 0.04, start: -1e9, stop: 1e9, noise: 1, color1: null,
      ballistic: false, stretch: 0, hard: 0, minPx: 0, sizeLog: false, phase: [0, 0], fadeOut: 0.55, ...o };
    const N = this.N = Math.ceil(this.o.rate * this.o.life);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); this.aDat = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aDat.setUsage(THREE.DynamicDrawUsage); this.aVel.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iDat', this.aDat); geo.setAttribute('iVel', this.aVel);
    geo.instanceCount = 0;
    const S = pipe.shared;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      blending: this.o.additive ? THREE.AdditiveBlending : THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { ...fxU(pipe), uSunDir: S.uSunDir, uSunColor: S.uSunColor, tAmbient: S.tAmbient,
        uColor: { value: new THREE.Vector3(...this.o.color) }, uColor1: { value: new THREE.Vector3(...(this.o.color1 || this.o.color)) }, uAlpha: { value: this.o.alpha }, uLit: { value: this.o.lit },
        uEmis: { value: new THREE.Vector3(...this.o.emissive) }, uEmisLife: { value: this.o.emissiveLife }, uSoft: { value: this.o.softness }, uNoise: { value: this.o.noise }, uFadeIn: { value: this.o.fadeIn },
        uFadeOut: { value: this.o.fadeOut }, uStretch: { value: this.o.stretch }, uHard: { value: this.o.hard }, uMinPx: { value: this.o.minPx }, uPhase: { value: new THREE.Vector2(...this.o.phase) }, uCamVel: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec4 iDat; attribute vec3 iVel; // size, age01, seed, rotation; velocity (m/s)
        varying vec2 vQ; varying float vZ; varying float vAge; varying float vSeed; varying vec3 vSunV; varying float vAk; varying vec3 vView;
        uniform vec3 uSunDir, uCamVel; uniform float uStretch, uMinPx; uniform vec2 uRes;
        void main(){
          vec4 mv = viewMatrix*vec4(iPos,1.0);
          float c = cos(iDat.w), s = sin(iDat.w);
          vAge = iDat.y; vSeed = iDat.z; vAk = 1.0;
          float size = iDat.x;
          // keep every particle at least uMinPx pixels across; what it lacks in area it loses in opacity
          float pxw = 2.0*max(-mv.z, 0.05)/(projectionMatrix[1][1]*uRes.y);          // metres per pixel here
          if (uMinPx > 0.0){ float m = 0.5*uMinPx*pxw; if (size < m){ vAk = (size*size)/(m*m); size = m; } }
          vec2 q = vec2(position.x*c-position.y*s, position.x*s+position.y*c);
          vQ = q;
          vec2 off = q*size;
          if (uStretch > 0.0){                                                       // streak along the motion
            vec3 vv = (viewMatrix*vec4(iVel-uCamVel,0.0)).xyz*uStretch;              // motion relative to the camera
            vec2 sv = vv.xy - mv.xy*(vv.z/min(mv.z, -0.05));                          // screen-plane motion at this depth
            float L = length(sv);
            if (L > size*0.2){ vec2 a = sv/L; vec2 b = vec2(-a.y, a.x); vQ = position.xy; off = a*position.x*(size+0.5*L) + b*position.y*size; vAk *= sqrt(size/(size+0.5*L)); }
          }
          mv.xy += off;
          vZ = -mv.z; vSunV = (viewMatrix*vec4(uSunDir,0.0)).xyz; vView = normalize(mv.xyz);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        ${SOFT}
        uniform sampler2D tDetail, tAmbient; uniform vec3 uColor, uColor1, uSunColor, uEmis; uniform float uAlpha, uLit, uEmisLife, uSoft, uNoise, uFadeIn, uFadeOut, uHard; uniform vec2 uPhase;
        varying vec2 vQ; varying float vZ; varying float vAge; varying float vSeed; varying vec3 vSunV; varying float vAk; varying vec3 vView;
        void main(){
          float r2 = dot(vQ,vQ); if (r2 > 1.0) discard;
          float sd = sceneDist(); if (vZ > sd) discard;
          float n = texture2D(tDetail, vQ*0.21+vec2(vSeed*7.3, vSeed*3.1)).r;
          float n2 = texture2D(tDetail, vQ*0.55+vec2(vSeed*1.7, vSeed*9.1)).g;
          float body = (1.0-r2);
          float a = smoothstep(0.0, 0.6, body*(0.55+0.9*mix(1.0, n*1.2+n2*0.5-0.35, uNoise)));
          if (uHard > 0.0){ float r = sqrt(r2), fw = max(fwidth(r), 1e-3); a = mix(a, 1.0-smoothstep(1.0-fw*1.5, 1.0, r), uHard); }
          a *= smoothstep(0.0, uFadeIn, vAge)*(1.0-smoothstep(uFadeOut, 1.0, vAge));
          a *= clamp((sd-vZ)/uSoft, 0.0, 1.0)*clamp((vZ-0.6)/1.5, 0.0, 1.0);
          a *= uAlpha*vAk;
          // sphere-impostor shading
          vec3 N = normalize(vec3(vQ, sqrt(max(1.0-r2, 0.0))+0.35));
          vec3 sv = normalize(vSunV);
          float wrap = dot(N, sv)*0.5+0.5;
          vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb*0.3183;
          vec3 base = mix(uColor, uColor1, smoothstep(0.0, 0.55, vAge));
          float sunK = (0.25+0.75*wrap*wrap)*(0.75+0.5*n);
          if (uPhase.y > 0.0){   // clear water drops scatter sunlight forward and are never dark: looking towards the sun
                                 // through spray it glows; from the sun's side it is a soft white (no impostor terminator)
            float g = uPhase.x, cv = dot(vView, sv), hg = (1.0-g*g)/pow(max(1.0+g*g-2.0*g*cv, 1e-4), 1.5);
            sunK = mix(sunK, 0.45+hg*0.9, uPhase.y);
          }
          vec3 lit = base*(uSunColor*0.3183*sunK + amb*1.2);
          vec3 col = mix(base, lit, uLit);
          col += uEmis*exp(-vAge/uEmisLife)*(0.5+n);
          gl_FragColor = vec4(col*a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.layers.set(LAYER.FX);
    this.mesh.renderOrder = o.renderOrder ?? 2;
    pipe.scene.add(this.mesh);
    this._p = new THREE.Vector3(); this._order = new Float32Array(N); this._idx = new Uint32Array(N); this._tmp = [];
  }
  // t: film time; origin: render origin (world). emitter(tb, out) -> world position; vel(tb, out) optional initial velocity
  update(t, origin, emitter, vel) {
    const o = this.o, N = this.N, P = this.aPos.array, D = this.aDat.array, VV = this.aVel.array, cam = this.pipe.camera;
    const k0 = Math.floor(t * o.rate); let n = 0;
    const items = this._tmp; items.length = 0;
    const v = new THREE.Vector3(), cp = cam.position, lr = Math.log(Math.max(o.size1, 1e-6) / Math.max(o.size0, 1e-6));
    for (let i = 0; i < N; i++) {
      const k = k0 - i, tb = k / o.rate, age = t - tb;
      if (age < 0 || age > o.life || tb < o.start || tb > o.stop) continue;
      const a01 = age / o.life, s1 = hash(k), s2 = hash(k + 0.37), s3 = hash(k + 0.71);
      emitter(tb, this._p, k);
      // initial kick decays with drag; plus slow buoyant drift and a wobble (ballistic: drift is the terminal velocity)
      const ex = Math.exp(-o.drag * age), e = (1 - ex) / o.drag;
      let vx = (s1 - 0.5) * o.spreadV, vy = (s2 - 0.5) * o.spreadV, vz = (s3 - 0.5) * o.spreadV;
      if (vel) { vel(tb, v, k); vx += v.x; vy += v.y; vz += v.z; }
      if (o.ballistic) { vx -= o.drift[0]; vy -= o.drift[1]; vz -= o.drift[2]; }
      const x = this._p.x + vx * e + o.drift[0] * age + (s2 - 0.5) * o.jitter, y = this._p.y + vy * e + o.drift[1] * age + (s3 - 0.5) * o.jitter, z = this._p.z + vz * e + o.drift[2] * age + (s1 - 0.5) * o.jitter;
      const rx = x - origin.x, ry = y - origin.y, rz = z - origin.z;
      const size = o.sizeLog ? o.size0 * Math.exp(lr * Math.pow(hash(k + 0.53), 2.2)) : o.size0 + (o.size1 - o.size0) * Math.pow(a01, o.grow) * (0.75 + 0.5 * s3);
      const dx = rx - cp.x, dy = ry - cp.y, dz = rz - cp.z;
      items.push([dx * dx + dy * dy + dz * dz, rx, ry, rz, size, a01, s1, s2 * 6.283 + age * (s3 - 0.5) * 0.6, vx * ex + o.drift[0], vy * ex + o.drift[1], vz * ex + o.drift[2]]);
    }
    if (!o.additive) items.sort((a, b) => b[0] - a[0]);
    for (const it of items) { P[n * 3] = it[1]; P[n * 3 + 1] = it[2]; P[n * 3 + 2] = it[3]; D[n * 4] = it[4]; D[n * 4 + 1] = it[5]; D[n * 4 + 2] = it[6]; D[n * 4 + 3] = it[7]; VV[n * 3] = it[8]; VV[n * 3 + 1] = it[9]; VV[n * 3 + 2] = it[10]; n++; }
    this.mesh.geometry.instanceCount = n; this.aPos.needsUpdate = true; this.aDat.needsUpdate = true; this.aVel.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
  hide() { this.mesh.visible = false; this.mesh.geometry.instanceCount = 0; }
}

// ---------------------------------------------------------------- additive glow sprite (flames, strobes, flashes)
export function makeGlow(pipe, { color = [1, 0.8, 0.5], size = 1, depthSoft = 1.0 } = {}) {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...fxU(pipe), uColor: { value: new THREE.Vector3(...color) }, uSize: { value: size }, uGain: { value: 1 }, uSoft: { value: depthSoft }, uStretch: { value: new THREE.Vector2(1, 1) } },
    vertexShader: /* glsl */`
      uniform float uSize; uniform vec2 uStretch; varying vec2 vQ; varying float vZ;
      void main(){ vec4 mv = modelViewMatrix*vec4(0.0,0.0,0.0,1.0); mv.xy += position.xy*uSize*uStretch; vQ = position.xy; vZ = -mv.z; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${SOFT}
      uniform vec3 uColor; uniform float uGain, uSoft; varying vec2 vQ; varying float vZ;
      void main(){
        float r = length(vQ); if (r > 1.0) discard;
        float sd = sceneDist();
        float occ = clamp((sd-vZ)/uSoft+1.0, 0.0, 1.0);
        float g = exp(-r*r*9.0)+0.18*exp(-r*3.2)*(1.0-r);
        gl_FragColor = vec4(uColor*g*uGain*occ, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.layers.set(LAYER.FX); m.renderOrder = 6;
  m.userData.set = (gain, size) => { mat.uniforms.uGain.value = gain; if (size !== undefined) mat.uniforms.uSize.value = size; m.visible = gain > 0.0005; };
  return m;
}
