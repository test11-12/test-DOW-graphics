// Path-traced hero layer: the film's vehicles rendered in Blender Cycles (blender/hero_shot.py) and composited into
// the engine's own frame. Off unless the page is opened with ?nohero=… or ?herolayer=…; with neither, the film never
// constructs a HeroLayer and the pipeline's hooks are skipped (pipe.hero stays null), so today's frames are unchanged.
//
//   ?nohero=1            the plate: GLB-built heroes (dynamic meshes that came from a .glb) are not drawn and cast no
//                        shadow. =all also drops code-built dynamic meshes; =a.glb,b.glb only those assets' meshes.
//   ?herolayer=<url>/    the composite: as the plate, plus hero_<frame>.bin from that folder (written by hero_shot.py)
//                        laid into the HDR scene buffer before sky, aerial perspective, clouds, effects, refraction,
//                        depth of field, motion blur, bloom and grade. file:// needs Chromium's
//                        --allow-file-access-from-files (tools/composite.mjs and tools/render.mjs --hero set it).
//
// Compositing happens in the engine, in linear light, with depth: the Cycles colour (premultiplied), its shadow-catcher
// ratio (multiplies the plate) and its view depth are applied right after the deferred terrain and sea lighting. The
// composited depth replaces the scene depth for the rest of the frame, so every later pass treats the hero as if the
// engine had drawn it: smoke, spray, plumes and glows in front of it stay in front (the effects test depth by hand),
// those behind it are hidden; a prop or the sea surface nearer than the hero hides it; haze, refraction, focus blur,
// motion blur (from the engine's own velocity pass of the hidden meshes, which match the Cycles silhouette because
// both come from the same .glb), bloom, flare, tone map, grade and grain are the engine's. The film's
// screen-space AO is not applied on the hero (Cycles has full global illumination).
import * as THREE from 'three';
import { Pass } from './pipeline.js';
import { DEPTH } from './glsl.js';

// ------------------------------------------------------------------ provenance
// engine/assets.js loadGLB tags the root (userData.asset) and every glTF node (userData.glbNode = [asset, node index]);
// Object3D.clone copies userData, so a mesh cloned out of a .glb (ramp props, tyres) still says where it came from.
export function glbNodeOf(o) { for (let p = o; p; p = p.parent) if (p.userData && p.userData.glbNode) return p; return null; }
const effVisible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

// The meshes the hero layer replaces. select: '1' (GLB meshes among the registered dynamic ones), 'all', or a
// comma list of asset paths ('fury/fury.glb,fury/amraam.glb').
export function heroMeshes(pipe, select = '1') {
  const s = String(select || '1'), list = s === '1' || s === 'all' ? null : new Set(s.split(',').filter(Boolean));
  return pipe.dynamic.filter(m => {
    if (s === 'all') return true;
    const n = glbNodeOf(m); if (!n) return false;
    return !list || list.has(n.userData.glbNode[0]);
  });
}

// ------------------------------------------------------------------ shaders
const COMP_FRAG = /* glsl */`
precision highp float;
${DEPTH}
uniform sampler2D tScene, tDepth, tHeroC, tHeroA;   // hero: premultiplied linear RGBA; shadow-catcher RGB + view Z (m)
uniform vec4 uRect;                                   // where the hero crop sits on screen (uv: x0, y0, w, h)
uniform int uWhich;                                   // 0: colour, 1: depth (x: log depth, y: hero coverage)
varying vec2 vUv;
void main(){
  vec4 sc = texture2D(tScene, vUv); float d = texture2D(tDepth, vUv).x;
  vec2 hu = (vUv-uRect.xy)/uRect.zw;
  vec4 hc = vec4(0.0), ha = vec4(1.0, 1.0, 1.0, 1.0e9);
  if (hu.x >= 0.0 && hu.y >= 0.0 && hu.x <= 1.0 && hu.y <= 1.0){ hc = texture2D(tHeroC, hu); ha = texture2D(tHeroA, hu); }
  float pz = d >= 0.999999 ? 1.0e9 : viewZ(d);
  float vis = ha.w <= pz*1.002+0.02 ? 1.0 : 0.0;       // anything of the plate nearer than the hero hides it
  float a = hc.a*vis;
  if (uWhich == 0) gl_FragColor = vec4(sc.rgb*max(ha.rgb, vec3(0.0))*(1.0-a)+hc.rgb*vis, sc.a);
  else gl_FragColor = vec4(a > 0.5 ? log2(1.0+ha.w)/uLogFar : d, a, 0.0, 1.0);
}`;
// the half-resolution AO buffer (r: occlusion, g: view depth for the edge-aware upsample): unoccluded on the hero
const AO_FRAG = /* glsl */`
precision highp float;
${DEPTH}
uniform sampler2D tAO, tZ;
varying vec2 vUv;
void main(){
  vec4 ao = texture2D(tAO, vUv); vec2 z = texture2D(tZ, vUv).xy;
  gl_FragColor = z.y > 0.5 ? vec4(1.0, min(viewZ(z.x), 6.0e4), 0.0, 1.0) : ao;
}`;
// terrain height at world x,z (the same lookup as engine/terrain.js, finest level)
const PROBE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tHNear, tHFar, tPts; uniform vec4 uNear, uFar;
varying vec2 vUv;
void main(){
  vec2 w = texture2D(tPts, vec2(vUv.x, 0.5)).xy;
  vec2 u = abs((w-uNear.xy)/uNear.z); float bn = smoothstep(0.495, 0.44, max(u.x, u.y));
  float hn = textureLod(tHNear, (w-uNear.xy)/uNear.z+0.5, 0.0).r, hf = textureLod(tHFar, (w-uFar.xy)/uFar.z+0.5, 0.0).r;
  gl_FragColor = vec4(mix(hf, hn, bn), bn, 0.0, 1.0);
}`;
// the engine's reflection environment as an equirectangular map in Blender's axes (+z up): u = 0.5 + atan2(y, x)/2pi,
// v = 0.5 + asin(z)/pi, row 0 at the bottom. hero_shot.py maps it with the same formula.
const EQUI_FRAG = /* glsl */`
precision highp float;
uniform samplerCube tCube;
varying vec2 vUv;
void main(){
  float lon = (vUv.x-0.5)*6.2831853, lat = (vUv.y-0.5)*3.14159265;
  vec3 b = vec3(cos(lat)*cos(lon), cos(lat)*sin(lon), sin(lat));
  gl_FragColor = vec4(textureCube(tCube, vec3(b.x, b.z, -b.y)).rgb, 1.0);
}`;

// ------------------------------------------------------------------ the layer
function fetchBytes(url) {
  if (!/^file:/i.test(url)) return fetch(url).then(r => { if (!r.ok) throw new Error(`hero layer ${url}: HTTP ${r.status}`); return r.arrayBuffer(); });
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = 'arraybuffer';
    x.onload = () => (x.response && x.response.byteLength) ? res(x.response) : rej(new Error(`hero layer ${url}: missing or empty`));
    x.onerror = () => rej(new Error(`hero layer ${url}: not readable (file:// needs --allow-file-access-from-files)`));
    x.send();
  });
}
const f6 = i => String(i).padStart(6, '0');

export class HeroLayer {
  // film: the Film; o: { select (see heroMeshes), base (folder URL of hero_<frame>.bin, or null for the plate only),
  //   fps (the frame rate the layers are numbered at: export_shots.mjs --fps; default the film's) }
  constructor(film, o = {}) {
    this.film = film; this.pipe = film.pipe; this.select = o.select || '1'; this.fps = +o.fps || film.fps;
    this.base = o.base ? (o.base.endsWith('/') ? o.base : o.base + '/') : null;
    this.meshes = heroMeshes(this.pipe, this.select);
    this.mode = this.base ? 'composite' : 'plate';
    this.layer = null; this._hidden = null;
    this.pComp = new Pass(COMP_FRAG, { tScene: { value: null }, tDepth: { value: null }, tHeroC: { value: null }, tHeroA: { value: null }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uWhich: { value: 0 }, uLogFar: this.pipe.shared.uLogFar });
    this.pAO = new Pass(AO_FRAG, { tAO: { value: null }, tZ: { value: null }, uLogFar: this.pipe.shared.uLogFar });
    this.pipe.hero = this;
  }
  get plateOnly() { return this.mode !== 'composite' || !this.layer || this.layer.empty; }
  // 'off' (the film as built: the engine draws its heroes), 'plate', 'composite'
  setMode(m) { this.mode = m; this.pipe.hero = m === 'off' ? null : this; return m; }

  // offline frame: fetch this frame's Cycles layer first (composite mode), then render
  async frame(t) {
    if (this.mode === 'composite') await this.load(Math.floor(Math.min(Math.max(t, 0), this.film.duration - 1e-4) * this.fps + 1e-6));
    return this.film.offlineFrame(t);
  }
  // hero_<frame>.bin: 32-byte header ('HRO1', int32 W, H, x0, y0, w, h, flags), then w*h RGBA half floats (premultiplied
  // linear colour, alpha), then w*h RGBA floats (shadow-catcher ratio RGB, view Z in metres; 1e9 where no hero).
  // Rows run bottom to top; (x0, y0) is the crop's lower-left pixel in a W x H frame. An empty crop means no hero.
  async load(frame) {
    if (this.layer && this.layer.frame === frame) return this.layer;
    const buf = await fetchBytes(`${this.base}hero_${f6(frame)}.bin`), dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x314f5248) throw new Error(`hero layer frame ${frame}: not a hero_shot.py layer`);
    const [W, H, x0, y0, w, h] = [4, 8, 12, 16, 20, 24].map(k => dv.getInt32(k, true));
    const L = this.layer || {};
    L.frame = frame; L.W = W; L.H = H; L.empty = !(w > 0 && h > 0);
    if (!L.empty) {
      const c = new Uint16Array(buf, 32, w * h * 4), a = new Float32Array(buf, 32 + w * h * 8, w * h * 4);
      if (!L.c || L.w !== w || L.h !== h) {
        L.c && L.c.dispose(); L.a && L.a.dispose();
        L.c = new THREE.DataTexture(c, w, h, THREE.RGBAFormat, THREE.HalfFloatType); L.a = new THREE.DataTexture(a, w, h, THREE.RGBAFormat, THREE.FloatType);
        for (const tx of [L.c, L.a]) { tx.generateMipmaps = false; tx.flipY = false; tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping; }
      } else { L.c.image.data = c; L.a.image.data = a; }
      L.c.needsUpdate = L.a.needsUpdate = true;
      L.w = w; L.h = h; L.rect = [x0 / W, y0 / H, w / W, h / H];
    }
    this.layer = L;
    return L;
  }

  // ---- pipeline hooks (engine/pipeline.js calls these only while pipe.hero is set)
  begin() { const d = this.film.def; if (d.heroless) d.heroless(this.film); }   // the film turns off its own fake hero shadows
  hide(on) {
    if (on && !this._hidden) { this._hidden = this.meshes.map(m => m.visible); for (const m of this.meshes) m.visible = false; }
    else if (!on && this._hidden) { this.meshes.forEach((m, i) => { m.visible = this._hidden[i]; }); this._hidden = null; }
  }
  // after the deferred lighting and the AO estimate, before clouds and atmosphere. Returns the new scene colour.
  composite(r, sceneTex, target) {
    const L = this.layer, pipe = this.pipe, S = pipe.shared;
    if (this.mode !== 'composite' || !L || L.empty) return sceneTex;
    const w = pipe.w, h = pipe.h;
    if (!this.rtZ || this.rtZ.width !== w || this.rtZ.height !== h) {
      this.rtZ && this.rtZ.dispose();
      this.rtZ = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    }
    const filt = (L.W === w && L.H === h) ? THREE.NearestFilter : THREE.LinearFilter;
    if (L.c.magFilter !== filt) { L.c.magFilter = L.c.minFilter = filt; L.c.needsUpdate = true; }
    L.a.magFilter = L.a.minFilter = THREE.NearestFilter;
    const u = this.pComp.u; u.tScene.value = sceneTex; u.tDepth.value = S.tDepth.value; u.tHeroC.value = L.c; u.tHeroA.value = L.a; u.uRect.value.fromArray(L.rect);
    u.uWhich.value = 1; this.pComp.render(r, this.rtZ);
    u.uWhich.value = 0; this.pComp.render(r, target);
    // AO: computed on the plate; the hero's own texels become unoccluded at the hero's depth
    const ua = pipe.pAtmo.u;
    if (ua.uAOk.value.x > 0 && ua.tAO.value === pipe.rtAO.texture) {
      if (!this.rtAO || this.rtAO.width !== pipe.rtAO.width || this.rtAO.height !== pipe.rtAO.height) {
        this.rtAO && this.rtAO.dispose();
        this.rtAO = new THREE.WebGLRenderTarget(pipe.rtAO.width, pipe.rtAO.height, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      }
      this.pAO.u.tAO.value = pipe.rtAO.texture; this.pAO.u.tZ.value = this.rtZ.texture; this.pAO.render(r, this.rtAO);
      ua.tAO.value = this.rtAO.texture;
    }
    this._plateDepth = S.tDepth.value; S.tDepth.value = this.rtZ.texture;
    return target.texture;
  }
  end() { this.hide(false); if (this._plateDepth) { this.pipe.shared.tDepth.value = this._plateDepth; this._plateDepth = null; } }
}

// ------------------------------------------------------------------ export (tools/export_shots.mjs)
const arr = (v, n = 6) => v.map(x => +x.toFixed(n));
function terrainHeights(pipe, pts) {
  const out = pts.map(() => null);
  const ter = pipe.deferred.find(d => d.uniforms && d.uniforms.tHNear && d.mesh && d.mesh.visible);
  if (!ter || !pts.length) return out;
  const n = pts.length, r = pipe.renderer, U = ter.uniforms;
  const data = new Float32Array(n * 4); pts.forEach((p, i) => { data[i * 4] = p[0]; data[i * 4 + 1] = p[1]; });
  const tp = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.FloatType); tp.needsUpdate = true;
  const pass = new Pass(PROBE_FRAG, { tHNear: U.tHNear, tHFar: U.tHFar, uNear: U.uNear, uFar: U.uFar, tPts: { value: tp } });
  const rt = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  pass.render(r, rt);
  const px = new Float32Array(n * 4); r.readRenderTargetPixels(rt, 0, 0, n, 1, px); r.setRenderTarget(null);
  rt.dispose(); tp.dispose(); pass.material.dispose();
  for (let i = 0; i < n; i++) out[i] = px[i * 4];
  return out;
}

// The state of the frame just rendered, in absolute world metres (floating origin added back), three.js axes
// (+x east, +y up, +z south). Call after FILM.renderFrame(t).
export function heroState(film, select = '1') {
  const pipe = film.pipe, O = film.origin, cam = pipe.camera, shot = film._shot, t = film.t, lt = t - shot.t0;
  const post = { ...(film.def.post || {}), ...(typeof shot.post === 'function' ? shot.post(lt, t, film) : (shot.post || {})) };
  pipe.scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
  const abs = m => { const e = Array.from(m.elements); e[12] += O.x; e[13] += O.y; e[14] += O.z; return arr(e, 7); };
  const heroes = new Set(heroMeshes(pipe, select));
  // every visible mesh that came from a .glb, once per glTF node instance
  const nodes = [], seen = new Set();
  pipe.scene.traverse(o => {
    if (!o.isMesh || !(o.layers.mask & 3)) return;
    const n = glbNodeOf(o); if (!n || seen.has(n)) return;
    seen.add(n);
    const meshes = []; n.traverse(c => { if (c.isMesh && glbNodeOf(c) === n) meshes.push(c); });
    if (!meshes.some(effVisible)) return;
    const emissive = [];
    for (const m of meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat && mat.emissive && (mat.emissiveMap || mat.emissive.r + mat.emissive.g + mat.emissive.b > 0)) emissive.push([mat.name, arr([mat.emissive.r, mat.emissive.g, mat.emissive.b], 5), +(mat.emissiveIntensity ?? 1).toFixed(5)]);
    }
    nodes.push({ id: n.uuid, asset: n.userData.glbNode[0], node: n.userData.glbNode[1], name: n.userData.name || n.name, role: meshes.some(m => heroes.has(m)) ? 'hero' : 'set', matrix: abs(n.matrixWorld), ...(emissive.length ? { emissive } : {}) });
  });
  // point and spot lights that are on (a missile motor's glow lighting the wing): position, colour, intensity in the
  // engine's units (irradiance = intensity / d^2, the same as Blender's power / (4 pi d^2))
  const roots = new Set(pipe.dynamicRoots || []), lights = [], v = new THREE.Vector3(), w = new THREE.Vector3();
  pipe.scene.traverse(o => {
    if (!(o.isPointLight || o.isSpotLight) || !(o.intensity > 0) || !effVisible(o)) return;
    let hero = false; for (let p = o; p; p = p.parent) if (roots.has(p)) hero = true;
    v.setFromMatrixPosition(o.matrixWorld);
    const L = { type: o.isSpotLight ? 'spot' : 'point', pos: arr([v.x + O.x, v.y + O.y, v.z + O.z], 5), color: arr(o.color.toArray(), 5), intensity: +o.intensity.toFixed(5), distance: o.distance, decay: o.decay, hero };
    if (o.isSpotLight) { o.target.updateMatrixWorld(); w.setFromMatrixPosition(o.target.matrixWorld).sub(v).normalize(); Object.assign(L, { dir: arr(w.toArray(), 6), angle: o.angle, penumbra: o.penumbra }); }
    lights.push(L);
  });
  // registered moving objects (also code-built ones, which have no .glb to send to Blender)
  const transforms = (pipe.dynamicRoots || []).map(r => {
    let glb = false; r.traverse(c => { if (c.isMesh && glbNodeOf(c)) glb = true; });
    return { name: r.name || r.type, visible: effVisible(r), glb, matrix: abs(r.matrixWorld) };
  });
  // the ground: sea level (y = 0) when the film has a sea, else the baked terrain under the camera and the heroes
  const camW = [cam.position.x + O.x, cam.position.y + O.y, cam.position.z + O.z];
  const heroPts = nodes.filter(n => n.role === 'hero').map(n => [n.matrix[12], n.matrix[14]]);
  const ocean = pipe.deferred.find(d => typeof d.heightAt === 'function');
  let ground;
  if (ocean) ground = { kind: 'sea', level: 0, underCamera: +ocean.heightAt(camW[0], camW[2], t).toFixed(4), underHeroes: heroPts.map(p => +ocean.heightAt(p[0], p[1], t).toFixed(4)) };
  else {
    const h = terrainHeights(pipe, [[camW[0], camW[2]], ...heroPts]);
    const under = h.slice(1).filter(v => v !== null).sort((a, b) => a - b);
    ground = h[0] === null ? { kind: 'none', level: null } : { kind: 'terrain', level: under.length ? +under[under.length >> 1].toFixed(4) : +h[0].toFixed(4), underCamera: +h[0].toFixed(4), underHeroes: h.slice(1).map(v => v === null ? null : +v.toFixed(4)) };
  }
  const q = cam.quaternion, sun = pipe.sun, A = pipe.atmo.uniforms;
  return {
    t, frame: Math.floor(t * film.fps + 1e-6), fps: film.fps, shot: shot.id, envKey: post.envKey ?? shot.id,
    camera: { pos: arr(camW, 5), quat: arr([q.x, q.y, q.z, q.w], 8), fov: cam.fov, aspect: cam.aspect, near: cam.near, far: cam.far },
    sun: { dir: arr(pipe.atmo.sunDir.toArray(), 7), irradiance: arr([sun.color.r * sun.intensity, sun.color.g * sun.intensity, sun.color.b * sun.intensity], 5), angleDeg: 0.53 },
    sky: { haze: A.uHaze.value, hazeH: A.uHazeH.value, groundAlbedo: arr(pipe.atmo.groundAlbedo.toArray(), 4), camAlt: +pipe.camAlt.toFixed(3) },
    post: { exposure: post.exposure ?? 0.25, wb: post.wb || [1, 1, 1], contrast: post.contrast ?? 1.12, sat: post.sat ?? 1.12, shutter: post.shutter ?? 0.5, dof: post.dof || null, aerial: post.aerial ?? 1 },
    ground, nodes, lights, transforms,
  };
}

// The engine's reflection environment (sky, cloud floor, ground) as Float32 RGBA, W x W/2, equirectangular (EQUI_FRAG).
export function envEquirect(pipe, W = 1024) {
  const r = pipe.renderer, H = W >> 1;
  const crt = new THREE.WebGLCubeRenderTarget(Math.max(64, W >> 2), { type: THREE.HalfFloatType });
  new THREE.CubeCamera(0.1, 100, crt).update(r, pipe.envScene);
  const pass = new Pass(EQUI_FRAG, { tCube: { value: crt.texture } });
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  pass.render(r, rt);
  const px = new Float32Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, px); r.setRenderTarget(null);
  crt.dispose(); rt.dispose(); pass.material.dispose();
  return { w: W, h: H, data: px };
}
export function envEquirectBase64(pipe, W) {
  const e = envEquirect(pipe, W), b = new Uint8Array(e.data.buffer); let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return { w: e.w, h: e.h, b64: btoa(s) };
}
