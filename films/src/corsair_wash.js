// Water at the hull of a Corsair running at speed (film 3). Every frame the waterline is found from the boat's
// attitude and the sea surface (the hull form below is blender/corsair_geo.py's), and from it:
//   - the white water sheeting along the hull: a foam ribbon on the topsides at the waterline, climbing highest
//     just aft of the spray root and streaming aft (FX layer, a child of the boat)
//   - spray sheets thrown off each side along the forward part of the wetted length: many small, hard,
//     ballistic droplets streaked by their motion, with a faint mist round them
//   - the jet's rooster tail and boil astern
//   - the waterline footprint, handed to the ocean so its shading pass draws contact foam round the hull
// The boat's own axes: bow +x, up +y, starboard +z (engine), origin amidships on the static waterline.
import * as THREE from 'three';
import { Trail } from '../engine/fx.js';
import { LAYER } from '../engine/pipeline.js';
import { DEPTH } from '../engine/glsl.js';

// ---------------------------------------------------------------- hull form (blender/corsair_geo.py)
const XB = 3.65, L = 7.3, HB = 1.24, LB = 3.07;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function pchip(xs, ys) {
  const n = xs.length, h = [], dl = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); dl.push((ys[i + 1] - ys[i]) / h[i]); }
  for (let i = 1; i < n - 1; i++) if (dl[i - 1] * dl[i] > 0) { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]); }
  m[0] = dl[0]; m[n - 1] = dl[n - 2];
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
const zk = pchip([-3.65, 1.6, 2.4, 2.95, 3.27, 3.45, 3.56, 3.62, 3.65], [-0.60, -0.60, -0.585, -0.52, -0.36, -0.10, 0.22, 0.45, 0.61]);
const bg = x => { const dd = XB - x; return dd < LB ? HB * Math.sqrt(Math.max(0, 1 - Math.pow(1 - dd / LB, 1.8))) : HB - 0.05 * ((dd - LB) / (L - LB)) ** 2; };
const zg = x => 0.50 + 0.11 * Math.pow(Math.max(x, 0) / XB, 1.6) - 0.02 * clamp(-x / XB) - 0.15 * smooth(-0.78, -1.08, x);
const bc = x => { const dd = XB - x; return dd < 3.4 ? 1.05 * Math.pow(Math.max(0, 1 - (1 - dd / 3.4) ** 2), 0.8) : 1.05 - 0.03 * (dd - 3.4) / (L - 3.4); };
const zc = x => { const dd = XB - x; return Math.max(-0.20 + 0.42 * Math.pow(1 - Math.min(dd / 4, 1), 1.8), zk(x) + bc(x) * 0.27); };
// half-breadth of the hull at station x and height h (model metres; 0 below the keel)
export function hullHalf(x, h) {
  const K = zk(x); if (h <= K) return 0;
  const ys = bg(x), zs = zg(x), b = Math.min(bc(x), Math.max(ys - 0.03, 0) * 0.9);
  const Cz = b > 1e-4 ? Math.max(Math.min(zc(x), zs - 0.02), K) : K;
  if (h <= Cz) return Cz > K + 1e-4 ? b * (h - K) / (Cz - K) : 0;
  const cf = 0.075 * clamp(b / 0.35), D2y = b + cf, D2z = Cz + 0.03 * cf;
  if (h <= D2z) return D2y;
  if (h >= zs) return ys;
  const u = (h - D2z) / (zs - D2z), bulge = (0.03 * clamp(ys / 0.5) + 0.05 * smooth(1.6, 0.3, XB - x) * clamp(ys / 0.3)) * clamp((zs - D2z) / 0.2);
  return D2y + (ys - D2y) * u + bulge * Math.sin(Math.PI * Math.pow(u, 0.8));
}
export const HULL = { zk, zc, zg, bg, bc };

const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const NST = 28, XS = Array.from({ length: NST }, (_, i) => -3.62 + 7.22 * i / (NST - 1));
export const FOOT_N = 16;           // stations of the footprint handed to the ocean, -3.65 .. 3.65

// ---------------------------------------------------------------- the foam sheet on the topsides
const SHEET_VERT = /* glsl */`
attribute vec3 aDat;      // along (m, hull frame), height fraction 0 (below the waterline) .. 1 (top of the climb), strength
uniform vec3 uSunDir;
varying vec3 vDat; varying float vZ; varying vec3 vN; varying vec3 vSunV;
void main(){
  vDat = aDat;
  vec4 mv = modelViewMatrix*vec4(position, 1.0);
  vZ = -mv.z; vSunV = (viewMatrix*vec4(uSunDir, 0.0)).xyz;
  vN = normalize(normalMatrix*vec3(0.0, 0.35, sign(position.z)));
  gl_Position = projectionMatrix*mv;
}`;
const SHEET_FRAG = /* glsl */`
precision highp float;
${DEPTH}
uniform sampler2D tDepth, tDetail, tAmbient; uniform vec2 uRes; uniform float uTime, uSpeed, uAlpha; uniform vec3 uSunColor;
varying vec3 vDat; varying float vZ; varying vec3 vN; varying vec3 vSunV;
void main(){
  float d = texture2D(tDepth, gl_FragCoord.xy/uRes).x;
  float sd = d >= 0.999999 ? 1.0e9 : viewZ(d);
  if (vZ > sd+0.035) discard;                         // under the sea surface, or behind the hull
  float u = vDat.x, f = vDat.y, k = vDat.z;
  if (k <= 0.002) discard;
  // the water streams aft past the hull at the boat's speed: streaky lace, long along the hull
  float s = u+uTime*uSpeed;
  float n1 = texture2D(tDetail, vec2(s*0.11, f*0.9+0.13)).b;
  float n2 = texture2D(tDetail, vec2(s*0.37+0.3, f*2.3)).r;
  float n3 = texture2D(tDetail, vec2(s*1.3+0.7, f*5.1+0.4)).g;
  float lace = smoothstep(0.38, 0.66, n1*0.55+n2*0.3+n3*0.25);
  float edge = 0.30+0.70*texture2D(tDetail, vec2(s*0.21+0.5, 0.37)).r;          // ragged top of the climb
  float body = 1.0-smoothstep(edge-0.35, edge, f);
  float a = k*body*mix(0.15+0.75*lace, 0.9, smoothstep(0.25, 0.0, f));
  a = clamp(a*uAlpha, 0.0, 1.0);
  if (a < 0.003) discard;
  vec3 N = normalize(vN), L = normalize(vSunV);
  float wrap = clamp(dot(N, L)*0.5+0.5, 0.0, 1.0);
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  vec3 col = vec3(0.86, 0.90, 0.92)*(uSunColor*0.3183*(0.15+0.85*wrap*wrap)*(0.8+0.4*lace) + amb*0.3183*1.1);
  gl_FragColor = vec4(col*a, a);
}`;

export class BoatWash {
  // poseAt(time, outPos, outQuat): the boat's world pose at any film time (a pure function of time)
  constructor(pipe, boat, poseAt) {
    this.pipe = pipe; this.boat = boat; this.poseAt = poseAt;
    boat.userData.wash = this;
    this.hw = [new Float32Array(NST), new Float32Array(NST)];      // waterline height per station, port / starboard
    this.bw = [new Float32Array(NST), new Float32Array(NST)];      // half-breadth there (0 where dry)
    this.foot = new Float32Array(FOOT_N);
    this.cache = new Map();
    this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    // spray: droplets off each side, a faint mist with them, the rooster tail and its mist
    // droplets (sizes are radii): clots of spray 1-5 cm across, hard-edged but ragged, streaked by the shutter
    // droplets (sizes are radii): ligaments and clots of spray 1-4 cm thick, drawn as filaments along their flight
    // (the sheet tears into streaks before it breaks into drops) and streaked further by the shutter
    const drop = { life: 0.52, size0: 0.004, size1: 0.02, sizeLog: true, color: [0.92, 0.95, 0.97], alpha: 0.7, jitter: 0.02, drift: [0, -7.5, 0], drag: 1.6, ballistic: true,
      spreadV: 0.9, noise: 0.35, hard: 0.75, softness: 0.25, fadeIn: 0.02, fadeOut: 0.7, stretch: 0.022, minPx: 1.2, phase: [0.72, 0.75] };
    const mist = { life: 0.8, size0: 0.08, size1: 0.45, grow: 0.7, color: [0.93, 0.95, 0.96], alpha: 0.025, jitter: 0.15, drift: [0, -0.8, 0], drag: 2.4, spreadV: 1.2, noise: 1.0, softness: 0.3, fadeIn: 0.05, phase: [0.6, 0.6] };
    this.drops = [0, 1].map(() => new Trail(pipe, { ...drop, rate: 2300 }));
    this.mists = [0, 1].map(() => new Trail(pipe, { ...mist, rate: 90 }));
    this.tail = new Trail(pipe, { ...drop, rate: 1400, life: 0.8, size1: 0.03, alpha: 0.75, drag: 1.1, drift: [0, -8.5, 0], spreadV: 1.6 });
    this.tailMist = new Trail(pipe, { ...mist, rate: 70, life: 0.9, size0: 0.12, size1: 0.7, alpha: 0.03 });
    this.trails = [...this.drops, ...this.mists, this.tail, this.tailMist];
    // the foam sheet: per side a strip of NST stations x 5 rows, rebuilt every frame in the boat's own frame
    const R = 5, nv = 2 * NST * R;
    const g = new THREE.BufferGeometry();
    this.sPos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3); this.sDat = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    this.sPos.setUsage(THREE.DynamicDrawUsage); this.sDat.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.sPos); g.setAttribute('aDat', this.sDat);
    const idx = [];
    for (let s = 0; s < 2; s++) for (let i = 0; i < NST - 1; i++) for (let j = 0; j < R - 1; j++) {
      const a = (s * NST + i) * R + j, b = a + R;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    g.setIndex(idx);
    const S = pipe.shared;
    this.sheetMat = new THREE.ShaderMaterial({ // (uAlpha: overall opacity)
      vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { tDepth: S.tDepth, tDetail: S.tDetail, tAmbient: S.tAmbient, uRes: S.uRes, uLogFar: S.uLogFar, uTime: S.uTime, uSunColor: S.uSunColor, uSunDir: S.uSunDir, uSpeed: { value: 16 }, uAlpha: { value: 0.85 } },
    });
    this.sheet = new THREE.Mesh(g, this.sheetMat); this.sheet.frustumCulled = false; this.sheet.layers.set(LAYER.FX); this.sheet.renderOrder = 1;
    boat.add(this.sheet);
    this.R = R;
  }
  pose(time) {      // cached world pose at a film time: { p, ex, ey, ez } (the boat's axes in world space)
    const key = Math.round(time * 240);
    let c = this.cache.get(key);
    if (!c) {
      if (this.cache.size > 4000) this.cache.clear();
      this.poseAt(key / 240, this._p, this._q);
      c = { p: this._p.clone(), ex: new THREE.Vector3(1, 0, 0).applyQuaternion(this._q), ey: new THREE.Vector3(0, 1, 0).applyQuaternion(this._q), ez: new THREE.Vector3(0, 0, 1).applyQuaternion(this._q) };
      this.cache.set(key, c);
    }
    return c;
  }
  // the waterline now: where each station's topside meets the sea
  solve(ocean, t) {
    const P = this.pose(t), w = this._a;
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1, H = this.hw[side], B = this.bw[side];
      for (let i = 0; i < NST; i++) {
        const x = XS[i], k0 = zk(x), top = zg(x);
        let h = H[i] || -0.3;
        for (let it = 0; it < 4; it++) {
          const b = hullHalf(x, h);
          w.copy(P.p).addScaledVector(P.ex, x).addScaledVector(P.ey, h).addScaledVector(P.ez, sg * b);
          h = clamp(h + (ocean.heightAt(w.x, w.z, t) - w.y) / Math.max(P.ey.y, 0.5), k0 - 0.4, top + 0.1);
        }
        H[i] = h; B[i] = h > k0 ? hullHalf(x, h) : 0;
      }
    }
    // the spray root: the forward end of the wetted length (interpolated between stations)
    let xr = XS[0];
    for (let i = 0; i < NST; i++) { const wet = 0.5 * (this.hw[0][i] + this.hw[1][i]) - zk(XS[i]); if (wet > 0) xr = XS[i] + (i < NST - 1 ? clamp(wet / Math.max(wet - (0.5 * (this.hw[0][i + 1] + this.hw[1][i + 1]) - zk(XS[i + 1])), 1e-3)) * (XS[i + 1] - XS[i]) : 0); }
    this.xr = xr;
    for (let j = 0; j < FOOT_N; j++) {
      const x = -3.65 + 7.3 * j / (FOOT_N - 1), f = clamp((x - XS[0]) / (XS[NST - 1] - XS[0]) * (NST - 1), 0, NST - 1.001), i = Math.floor(f), u = f - i;
      const b = 0.5 * ((this.bw[0][i] + this.bw[1][i]) * (1 - u) + (this.bw[0][i + 1] + this.bw[1][i + 1]) * u);
      this.foot[j] = x > xr ? 0 : b;
    }
  }
  // local point on side `side` at station x (interpolated waterline) lifted dh above the waterline, out `off`
  local(side, x, dh, off, out) {
    const f = clamp((x - XS[0]) / (XS[NST - 1] - XS[0]) * (NST - 1), 0, NST - 1.001), i = Math.floor(f), u = f - i;
    const h = this.hw[side][i] * (1 - u) + this.hw[side][i + 1] * u + dh;
    return out.set(x, h, (side ? 1 : -1) * (hullHalf(x, h) + off));
  }
  // a point of the foam sheet: on the topside, from the chine (or the waterline, when it stands higher) up
  sheetPt(side, x, dh, off, out) {
    const f = clamp((x - XS[0]) / (XS[NST - 1] - XS[0]) * (NST - 1), 0, NST - 1.001), i = Math.floor(f), u = f - i;
    const base = Math.max(this.hw[side][i] * (1 - u) + this.hw[side][i + 1] * u, zc(x) + 0.035), h = base + dh;
    return out.set(x, h, (side ? 1 : -1) * (hullHalf(x, Math.max(h, zc(x) + 0.035)) + off));
  }
  hide() { for (const tr of this.trails) tr.mesh.visible = false; this.sheet.visible = false; this.active = false; }
  // speed: m/s along the track; on: boat visible and running
  // camVel: the camera's world velocity (m/s); exposure: the shutter's open time (s), which sets the streaks
  setCamera(camVel, exposure) { for (const tr of this.trails) { tr.mat.uniforms.uCamVel.value.copy(camVel); if (tr.o.stretch) tr.mat.uniforms.uStretch.value = 0.010 + exposure; } }
  update(film, ocean, t, speed, on) {
    const plane = smooth(5, 14, speed);
    if (!on || plane < 0.02 || film.off.has('spray')) { this.hide(); return; }
    this.active = true;
    this.solve(ocean, t);
    const O = film.origin, xr = this.xr, len = 1.5, tmp = this._b, vel = this._c;
    // foam sheet on the topsides, in the boat's own frame
    const P = this.sPos.array, D = this.sDat.array, R = this.R;
    for (let side = 0; side < 2; side++) for (let i = 0; i < NST; i++) {
      const x = XS[i], wet = this.bw[side][i] > 0 ? 1 : 0, aft = clamp((xr - x) / 1.8);
      const climb = (0.05 + 0.20 * Math.exp(-Math.pow((xr - 0.55 - x) / 0.75, 2)) + 0.05 * smooth(-1.0, -3.4, x)) * plane;
      const k = wet * smooth(xr + 0.15, xr - 0.35, x) * (1 - 0.6 * smooth(-3.0, -3.6, x)) * (0.7 + 0.3 * aft) * plane;
      for (let j = 0; j < R; j++) {
        const fr = (j - 1) / (R - 2), dh = j === 0 ? -0.06 : fr * climb, v = (side * NST + i) * R + j;
        this.sheetPt(side, x, dh, 0.010 + 0.006 * fr, tmp);
        P[v * 3] = tmp.x; P[v * 3 + 1] = tmp.y; P[v * 3 + 2] = tmp.z;
        D[v * 3] = x; D[v * 3 + 1] = j === 0 ? -0.25 : fr; D[v * 3 + 2] = k;
      }
    }
    this.sPos.needsUpdate = true; this.sDat.needsUpdate = true;
    this.sheet.visible = !film.off.has('sheet');
    this.sheetMat.uniforms.uSpeed.value = speed;
    // spray sheets: droplets launched along the forward 2.2 m of the wetted length, fanning out and up
    // the sheet leaves the hull at the chine (or, aft, where the waterline stands above the chine)
    const self = this, root = (side, k, out, tb) => {
      const c = self.pose(tb), f = Math.pow(hash(k * 1.137 + 0.11), 1.4), x = xr - 0.10 - f * len;
      self.local(side, x, 0.0, 0.0, tmp);
      const h = Math.max(tmp.y, zc(x) + 0.01), b = hullHalf(x, h) + 0.025, sg = side ? 1 : -1;
      return out.copy(c.p).addScaledVector(c.ex, x).addScaledVector(c.ey, h).addScaledVector(c.ez, sg * b);
    };
    const launch = (side, k, out, tb, up0, out0, fw) => {
      const c = self.pose(tb), f = Math.pow(hash(k * 1.137 + 0.11), 1.4), h1 = Math.pow(hash(k * 2.71 + 0.3), 0.7), h2 = hash(k * 3.33 + 0.7), sg = side ? 1 : -1;
      const nose = 1 - f;                                // the root of the sheet throws hardest
      const fx = c.ex.x, fz = c.ex.z, l = Math.hypot(fx, fz) || 1;
      const sx = c.ez.x * sg, sz = c.ez.z * sg, ls = Math.hypot(sx, sz) || 1;
      const up = (up0 * (0.45 + 0.75 * h1) * (0.55 + 0.45 * nose)) * plane, lat = (out0 * (0.5 + 0.8 * h2) * (0.6 + 0.4 * nose)) * plane, fwd = speed * fw * (0.7 + 0.6 * h1);
      return out.set(fx / l * fwd + sx / ls * lat, up, fz / l * fwd + sz / ls * lat);
    };
    if (film.off.has('drops')) { for (const tr of this.trails) tr.mesh.visible = false; return; }
    this.drops.forEach((tr, side) => tr.update(t, O, (tb, out, k) => root(side, k, out, tb), (tb, out, k) => launch(side, k, out, tb, 3.6, 8.5, 0.46)));
    this.mists.forEach((tr, side) => tr.update(t, O, (tb, out, k) => root(side, k, out, tb), (tb, out, k) => launch(side, k, out, tb, 2.6, 3.4, 0.5)));
    // rooster tail: the jet stream breaking the surface astern, thrown up and aft, and its boil of mist
    const stern = (k, out, tb) => {
      const c = self.pose(tb), hT = 0.5 * (self.hw[0][0] + self.hw[1][0]);
      return out.copy(c.p).addScaledVector(c.ex, -3.85 - 0.5 * hash(k * 0.91)).addScaledVector(c.ey, hT + 0.02).addScaledVector(c.ez, (hash(k * 1.7) - 0.5) * 0.35);
    };
    const jet = (k, out, tb, up0) => {
      const c = self.pose(tb), h1 = hash(k * 2.13), h2 = hash(k * 5.1), fx = c.ex.x, fz = c.ex.z, l = Math.hypot(fx, fz) || 1;
      const fwd = speed * (0.10 + 0.30 * h2), up = up0 * (0.4 + 0.8 * h1) * plane, lat = (hash(k * 7.7) - 0.5) * 2.4;
      return out.set(fx / l * fwd - fz / l * lat, up, fz / l * fwd + fx / l * lat);
    };
    this.tail.update(t, O, (tb, out, k) => stern(k, out, tb), (tb, out, k) => jet(k, out, tb, 5.5));
    this.tailMist.update(t, O, (tb, out, k) => stern(k, out, tb), (tb, out, k) => jet(k, out, tb, 2.0));
  }
  // the footprint for the ocean's contact foam: world position, heading, half-breadths, spray root, strength
  footprint(t, speed) {
    const c = this.pose(t), l = Math.hypot(c.ex.x, c.ex.z) || 1;
    return { x: c.p.x, z: c.p.z, fx: c.ex.x / l, fz: c.ex.z / l, b: this.foot, xr: this.xr, k: smooth(5, 14, speed) };
  }
}
