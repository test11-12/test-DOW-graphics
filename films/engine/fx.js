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
// A body of revolution along -x of the parent. Emission is treated as a thin glowing volume: brighter
// through the middle, with standing shock diamonds when the nozzle is under-expanded.
export function makePlume(pipe, { length = 9, radius = 0.47, diamonds = 7, color = [1.0, 0.36, 0.09], core = [1.0, 0.74, 0.46] } = {}) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 40, 48, true);
  geo.rotateZ(Math.PI / 2); geo.translate(-0.5, 0, 0); // x in [-1,0], unit radius
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...fxU(pipe), uLen: { value: length }, uRad: { value: radius }, uPower: { value: 0 }, uDiamonds: { value: diamonds },
      uColor: { value: new THREE.Vector3(...color) }, uCore: { value: new THREE.Vector3(...core) }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uLen, uRad, uPower, uDiamonds, uTime;
      varying float vAx; varying vec3 vN; varying vec3 vV; varying float vZ;
      float prof(float a){ // radius along the plume (a = 0 nozzle .. 1 tip)
        float pinch = 1.0-0.16*pow(0.5+0.5*cos(a*uDiamonds*6.2831853), 2.0)*(1.0-a);
        return (1.0-0.78*a)*pinch*mix(0.8,1.0,smoothstep(0.0,0.05,a));
      }
      void main(){
        float a = -position.x; vAx = a;
        float r = uRad*prof(a);
        vec3 p = vec3(position.x*uLen*(0.35+0.65*uPower), position.y*r, position.z*r);
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        vN = normalize(normalMatrix*vec3(0.0, position.y, position.z));
        vV = normalize(-mv.xyz); vZ = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${NOISE}
      ${SOFT}
      uniform float uPower, uDiamonds, uTime, uGain; uniform vec3 uColor, uCore; uniform sampler2D tDetail;
      varying float vAx; varying vec3 vN; varying vec3 vV; varying float vZ;
      void main(){
        if (vZ > sceneDist()) discard;
        float thick = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = vAx;
        float flick = 0.9+0.1*sin(uTime*71.0+a*30.0)+0.06*sin(uTime*173.0);
        float dia = pow(0.5+0.5*cos(a*uDiamonds*6.2831853+3.14159), 4.0);
        float fall = exp(-a*3.2);
        float n = texture2D(tDetail, vec2(a*1.7-uTime*3.0, atan(vN.y, vN.x)*0.3)).r;
        float fall2 = exp(-a*3.4)*(1.0-a);
        vec3 c = uColor*(0.6+0.4*n)*fall2 + mix(uColor, uCore, 0.6)*dia*exp(-a*4.4)*1.5 + uCore*exp(-a*16.0)*2.2;
        float edge = pow(1.0-abs(dot(normalize(vN), normalize(vV))), 3.0);
        c += vec3(0.30,0.40,1.0)*edge*exp(-a*9.0)*0.5;
        c *= 0.55;
        gl_FragColor = vec4(c*thick*uPower*uPower*flick*uGain, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.layers.set(LAYER.FX); m.renderOrder = 5;
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
        float e = 1.0-abs(dot(n, vp/max(side,1e-4)));
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
        float e = 1.0-abs(dot(n, vp/max(side,1e-4)));
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
// can be rendered in any order. emitter(time, outVec3) returns the world position of the source.
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export class Trail {
  constructor(pipe, o = {}) {
    this.pipe = pipe;
    this.o = { rate: 60, life: 6, size0: 0.4, size1: 6, grow: 0.6, color: [0.9, 0.9, 0.92], alpha: 0.6, jitter: 0.3, drift: [0, 0.3, 0], drag: 2.0, spreadV: 1.5, lit: 1, emissive: [0, 0, 0], emissiveLife: 0.15, additive: false, softness: 2, fadeIn: 0.04, start: -1e9, stop: 1e9, noise: 1, ...o };
    const N = this.N = Math.ceil(this.o.rate * this.o.life);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); this.aDat = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aDat.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iDat', this.aDat);
    geo.instanceCount = 0;
    const S = pipe.shared;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      blending: this.o.additive ? THREE.AdditiveBlending : THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { ...fxU(pipe), uSunDir: S.uSunDir, uSunColor: S.uSunColor, tAmbient: S.tAmbient,
        uColor: { value: new THREE.Vector3(...this.o.color) }, uAlpha: { value: this.o.alpha }, uLit: { value: this.o.lit },
        uEmis: { value: new THREE.Vector3(...this.o.emissive) }, uEmisLife: { value: this.o.emissiveLife }, uSoft: { value: this.o.softness }, uNoise: { value: this.o.noise }, uFadeIn: { value: this.o.fadeIn } },
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec4 iDat; // size, age01, seed, rotation
        varying vec2 vQ; varying float vZ; varying float vAge; varying float vSeed; varying vec3 vSunV;
        uniform vec3 uSunDir;
        void main(){
          vec4 mv = viewMatrix*vec4(iPos,1.0);
          float c = cos(iDat.w), s = sin(iDat.w);
          vQ = position.xy; vAge = iDat.y; vSeed = iDat.z;
          mv.xy += vec2(position.x*c-position.y*s, position.x*s+position.y*c)*iDat.x;
          vZ = -mv.z; vSunV = (viewMatrix*vec4(uSunDir,0.0)).xyz;
          vQ = vec2(position.x*c-position.y*s, position.x*s+position.y*c);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        ${SOFT}
        uniform sampler2D tDetail, tAmbient; uniform vec3 uColor, uSunColor, uEmis; uniform float uAlpha, uLit, uEmisLife, uSoft, uNoise, uFadeIn;
        varying vec2 vQ; varying float vZ; varying float vAge; varying float vSeed; varying vec3 vSunV;
        void main(){
          float r2 = dot(vQ,vQ); if (r2 > 1.0) discard;
          float sd = sceneDist(); if (vZ > sd) discard;
          float n = texture2D(tDetail, vQ*0.21+vec2(vSeed*7.3, vSeed*3.1)).r;
          float n2 = texture2D(tDetail, vQ*0.55+vec2(vSeed*1.7, vSeed*9.1)).g;
          float body = (1.0-r2);
          float a = smoothstep(0.0, 0.6, body*(0.55+0.9*mix(1.0, n*1.2+n2*0.5-0.35, uNoise)));
          a *= smoothstep(0.0, uFadeIn, vAge)*(1.0-smoothstep(0.55, 1.0, vAge));
          a *= clamp((sd-vZ)/uSoft, 0.0, 1.0)*clamp((vZ-0.6)/1.5, 0.0, 1.0);
          a *= uAlpha;
          // sphere-impostor shading
          vec3 N = normalize(vec3(vQ, sqrt(max(1.0-r2, 0.0))+0.35));
          float wrap = dot(N, normalize(vSunV))*0.5+0.5;
          vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb*0.3183;
          vec3 lit = uColor*(uSunColor*0.3183*(0.25+0.75*wrap*wrap)*(0.75+0.5*n) + amb*1.2);
          vec3 col = mix(uColor, lit, uLit);
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
    const o = this.o, N = this.N, P = this.aPos.array, D = this.aDat.array, cam = this.pipe.camera;
    const k0 = Math.floor(t * o.rate); let n = 0;
    const items = this._tmp; items.length = 0;
    const v = new THREE.Vector3(), cp = cam.position;
    for (let i = 0; i < N; i++) {
      const k = k0 - i, tb = k / o.rate, age = t - tb;
      if (age < 0 || age > o.life || tb < o.start || tb > o.stop) continue;
      const a01 = age / o.life, s1 = hash(k), s2 = hash(k + 0.37), s3 = hash(k + 0.71);
      emitter(tb, this._p);
      // initial kick decays with drag; plus slow buoyant drift and a wobble
      const e = (1 - Math.exp(-o.drag * age)) / o.drag;
      let vx = (s1 - 0.5) * o.spreadV, vy = (s2 - 0.5) * o.spreadV, vz = (s3 - 0.5) * o.spreadV;
      if (vel) { vel(tb, v); vx += v.x; vy += v.y; vz += v.z; }
      const x = this._p.x + vx * e + o.drift[0] * age + (s2 - 0.5) * o.jitter, y = this._p.y + vy * e + o.drift[1] * age + (s3 - 0.5) * o.jitter, z = this._p.z + vz * e + o.drift[2] * age + (s1 - 0.5) * o.jitter;
      const rx = x - origin.x, ry = y - origin.y, rz = z - origin.z;
      const size = o.size0 + (o.size1 - o.size0) * Math.pow(a01, o.grow) * (0.75 + 0.5 * s3);
      const dx = rx - cp.x, dy = ry - cp.y, dz = rz - cp.z;
      items.push([dx * dx + dy * dy + dz * dz, rx, ry, rz, size, a01, s1, s2 * 6.283 + age * (s3 - 0.5) * 0.6]);
    }
    if (!o.additive) items.sort((a, b) => b[0] - a[0]);
    for (const it of items) { P[n * 3] = it[1]; P[n * 3 + 1] = it[2]; P[n * 3 + 2] = it[3]; D[n * 4] = it[4]; D[n * 4 + 1] = it[5]; D[n * 4 + 2] = it[6]; D[n * 4 + 3] = it[7]; n++; }
    this.mesh.geometry.instanceCount = n; this.aPos.needsUpdate = true; this.aDat.needsUpdate = true;
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
