// MACH 1.21 — Hermeus Quarterhorse Mk 2.1, flight 3, May 26 2026.
// A simulated visualization. What is documented: third flight, from Spaceport America, over White Sands
// Missile Range airspace, peak Mach 1.21, remotely piloted, P&W F100. Everything else on screen (time of
// day, altitude, the exact Mach trace, camera positions) is illustrative.
import * as THREE from 'three';
import { startFilm, clamp, lerp, smooth, ease, easeOut, curve, wobble, v3 } from '../engine/film.js';
import { LAYER } from '../engine/pipeline.js';
import { Terrain } from '../engine/terrain.js';
import { CloudLayer } from '../engine/clouds.js';
import { attitude } from '../engine/geo.js';
import { makePlume, makeHeatHaze, makeShockCone } from '../engine/fx.js';
import { NM_TERRAIN, FIELD_ALT } from './terrain_nm.js';
import { buildQuarterhorse, QH } from './quarterhorse_model.js';

const NARRATION = __NARRATION__;
const D = Math.PI / 180;
const SUN = { az: 68, el: 8 };
const GROUND_Y = FIELD_ALT - QH.groundY;    // aircraft origin height when sitting on its wheels
const RWY_START_Z = 1700;                    // brake-release point, south end; take-off run heads north (-z)

// ------------------------------------------------------------------ airfield
function buildAirfield(pipe) {
  const g = new THREE.Group(); g.name = 'airfield';
  // scrub: creosote and dry grass across the levelled basin floor
  const rnd = (() => { let s = 20260526; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const lumpy = (detail, amt) => { const b = new THREE.IcosahedronGeometry(1, detail); const p = b.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amt * Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 5.7 + x * 2.1); p.setXYZ(i, x * k, Math.max(y, -0.25) * k, z * k); } b.computeVertexNormals(); return b; };
  const N = pipe.quality.lowTerrain ? 30000 : 130000;
  // scrub is lit per vertex with a tiny shader: there are ~100k of them and each covers only a few pixels
  const bushMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: pipe.shared.uSunDir, uSunColor: pipe.shared.uSunColor, tAmbient: pipe.shared.tAmbient },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform vec3 uSunDir, uSunColor; uniform sampler2D tAmbient; varying vec3 vSun, vAmb, vP; varying float vRim;
      void main(){
        vec4 wp = modelMatrix*instanceMatrix*vec4(position,1.0);
        vec3 n = normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normalize(position));
        float up = clamp(position.y*0.7+0.5, 0.0, 1.0);                 // darker towards the base (self-shadowing)
        float nl = max(dot(n, uSunDir), 0.0)*0.8+0.2*max(dot(n, uSunDir)*0.5+0.5, 0.0);
        vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
        vSun = instanceColor*0.3183*uSunColor*nl*(0.3+0.7*up); vAmb = instanceColor*0.3183*amb*(0.3+0.7*up);
        vP = position*(4.0+3.0*fract(instanceColor.r*91.7));
        vec4 mv = viewMatrix*wp;
        vRim = abs(dot(normalize(mat3(viewMatrix)*n), normalize(-mv.xyz)));
        gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vSun, vAmb, vP; varying float vRim;
      float h3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 c = floor(vP*2.6); float a = h3(c), b = h3(c+7.3);
        if (vRim < 0.5 && a > vRim*1.7+0.12) discard;               // ragged, twiggy silhouette
        #include <logdepthbuf_fragment>
        float gap = step(0.3, b);                                    // gaps between leaf clumps fall into shade
        gl_FragColor = vec4(vSun*(0.25+0.95*gap)*(0.7+0.6*a)+vAmb*(0.55+0.45*gap), 1.0);
      }`,
  });
  const bushGeo = lumpy(1, 0.34), cells = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const patch = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.011 + Math.sin(z * 0.004) * 2.1) * Math.cos(z * 0.0075 + Math.sin(x * 0.006) * 1.7);
  let n = 0, guard = 0;
  while (n < N && guard++ < N * 30) {
    const near = rnd() < 0.72, x = (rnd() * 2 - 1) * (near ? 420 : 860), z = (rnd() * 2 - 1) * 2280;
    if (Math.abs(x) < 42 || (x < -30 && x > -350 && z > -1700 && z < -1500) || Math.abs(x + 58) < 9 || (x > -62 && x < -38 && z > RWY_START_Z + 8 && z < RWY_START_Z + 36)) continue;
    if (rnd() > 0.25 + 0.75 * patch(x, z)) continue;
    const grass = rnd() < 0.3, w = grass ? 0.16 + rnd() * 0.2 : 0.28 + rnd() * 0.5, h = grass ? 0.2 + rnd() * 0.22 : w * (0.6 + rnd() * 0.6);
    ps.set(x, h * 0.2, z); q.setFromAxisAngle(up, rnd() * 6.28); sc.set(w, h, w * (0.8 + rnd() * 0.4));
    m4.compose(ps, q, sc);
    if (grass) col.setRGB(0.36 + rnd() * 0.12, 0.31 + rnd() * 0.1, 0.18 + rnd() * 0.06); else { const k = rnd(); col.setRGB(0.05 + k * 0.035, 0.06 + k * 0.035, 0.034 + k * 0.02); }
    const key = Math.floor((x + 900) / 180) + 64 * Math.floor((z + 2300) / 180);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ m: m4.clone(), c: col.clone(), w, h, x, z }); n++;
  }
  // one instanced mesh per 180 m cell, so the renderer can skip cells outside the view
  const bush = new THREE.Group(); bush.name = 'scrub';
  // long low-sun shadows: one soft dark streak per plant, laid on the ground away from the sun. They darken the
  // terrain placeholder (alpha = shadow strength), so the deferred terrain pass lights that much less of it.
  const sd = pipe.atmo.sunDir, sh = Math.hypot(sd.x, sd.z), tanEl = Math.max(sd.y / sh, 0.05), ax = -sd.x / sh, az = -sd.z / sh;
  const shGeo = new THREE.PlaneGeometry(1, 1); shGeo.rotateX(-Math.PI / 2); shGeo.translate(0.5, 0, 0);
  const shMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix*viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec2 vUv;
      void main(){
        #include <logdepthbuf_fragment>
        float across = 1.0-smoothstep(0.12, 0.5, abs(vUv.y-0.5)*(1.0+vUv.x*0.5));
        float along = smoothstep(0.0, 0.06, vUv.x)*(1.0-smoothstep(0.45, 1.0, vUv.x));
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.62*across*along);
      }`,
  });
  const bx = new THREE.Vector3(), by = new THREE.Vector3(0, 1, 0), bz = new THREE.Vector3();
  for (const [key, list] of cells) {
    const im = new THREE.InstancedMesh(bushGeo, bushMat, list.length), sm = new THREE.InstancedMesh(shGeo, shMat, list.length);
    let cx = 0, cz = 0;
    list.forEach((it, k) => {
      im.setMatrixAt(k, it.m); im.setColorAt(k, it.c); cx += it.x; cz += it.z;
      const L = Math.min(1.25 * it.h / tanEl, 16), wd = it.w * 1.9;
      bx.set(ax * L, 0, az * L); bz.set(-az * wd, 0, ax * wd); m4.makeBasis(bx, by, bz); m4.setPosition(it.x - ax * it.w * 0.4, 0.03, it.z - az * it.w * 0.4);
      sm.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.frustumCulled = true;
    sm.instanceMatrix.needsUpdate = true; sm.computeBoundingSphere(); sm.frustumCulled = true; sm.renderOrder = 2;
    im.userData = sm.userData = { cx: cx / list.length, cz: cz / list.length, n: list.length };
    bush.add(im, sm);
  }
  g.add(bush);

  // buildings on the west apron
  const bld = (x, z, w, d, h, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.1 })); m.position.set(x, h / 2 - 0.1, z); g.add(m); return m; };
  bld(-640, -1650, 70, 110, 13, 0x8a8478); bld(-600, -1790, 24, 30, 7, 0x9a958c); bld(-720, -1560, 40, 28, 9, 0x6f6a62); bld(-560, -1500, 10, 10, 20, 0xa7a39b);
  g.traverse(o => { if (o.isMesh) { o.layers.set(LAYER.STATIC); o.castShadow = false; } });
  return { group: g, bush, cells };
}

// ------------------------------------------------------------------ flight profile (illustrative; peak as reported)
const T_AIR = 22.5, T_END = 80;
const MACH_PTS = [[22.5, 0.90], [28.5, 0.915], [33, 0.955], [36.4, 0.985], [38.2, 1.0], [41, 1.06], [44, 1.13], [47, 1.185], [49.2, 1.21], [80, 1.21]];
const A_SOUND = 297;                                   // m/s near the tropopause
const machAt = t => curve(MACH_PTS, t);
const TRACK = { x: 44000, alt: 11900, z0: 33500 };      // northbound along the San Andres range
const ROLL_PTS = [[22.5, 0], [70.6, 0], [72.6, 58], [80, 62]];
const STATE = (() => {
  const dt = 1 / 120, n = Math.ceil((T_END + 2 - T_AIR) / dt) + 1, A = new Float64Array(n * 6);
  let x = TRACK.x, y = TRACK.alt, z = TRACK.z0, hdg = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const t = T_AIR + i * dt, v = machAt(t) * A_SOUND;
    const r = t < 70.6 ? 0 : curve(ROLL_PTS, t);
    A.set([x, y, z, hdg, r, vy], i * 6);
    const om = 9.81 * Math.tan(r * D) / v;                    // coordinated turn
    hdg += om / D * dt; vy = lerp(vy, r > 5 ? 22 : 0, dt * 0.8);
    x += Math.sin(hdg * D) * v * dt; z -= Math.cos(hdg * D) * v * dt; y += vy * dt;
  }
  return { A, dt, n };
})();
function air(t, out = { p: v3(), hdg: 0, roll: 0, pitch: 2, mach: 0.9 }) {
  const f = clamp((t - T_AIR) / STATE.dt, 0, STATE.n - 1.001), i = Math.floor(f), k = f - i, A = STATE.A, a = i * 6, b = a + 6;
  out.p.set(lerp(A[a], A[b], k), lerp(A[a + 1], A[b + 1], k), lerp(A[a + 2], A[b + 2], k));
  out.hdg = lerp(A[a + 3], A[b + 3], k); out.roll = lerp(A[a + 4], A[b + 4], k) + wobble(t * 0.7, 3) * 0.9;
  out.pitch = 2.2 + wobble(t * 0.9, 5) * 0.25 + clamp(A[a + 5] / 22, 0, 1) * 5; out.mach = machAt(t);
  return out;
}
// take-off run for the tracking shot (time-cut into the roll)
function roll(tau) { // tau seconds into shot 3b
  const v0 = 64, a = 5.4, s = v0 * tau + 0.5 * a * tau * tau, tl = 2.5, c = Math.max(0, tau - tl);
  return { z: 330 - s, y: GROUND_Y + Math.min(0.5 * 3.2 * c * c, 0.5 * 3.2 * 16 + 12.8 * Math.max(0, c - 4)), pitch: 9.5 * smooth(1.55, 2.7, tau) + 3 * smooth(2.7, 5.5, tau), v: v0 + a * tau };
}

// ------------------------------------------------------------------ world
let W;
async function build(film) {
  const pipe = film.pipe;
  pipe.atmo.setSun(SUN.az, SUN.el);
  pipe.atmo.uniforms.uHaze.value = 0.55; pipe.atmo.groundAlbedo.setRGB(0.30, 0.24, 0.18);
  const nearRes = film.quality.lowTerrain ? 1024 : (+film.params.get('nres') || 4096);
  const clouds = new CloudLayer(pipe, { base: 4300, top: 6100, div: +film.params.get('cdiv') || 3 });
  const cs = clouds.terrainShadow();
  const terrain = new Terrain(pipe, { ...NM_TERRAIN, uniforms: { ...(NM_TERRAIN.uniforms || {}), ...cs.uniforms }, defines: (NM_TERRAIN.defines || '') + cs.defines, near: { ...NM_TERRAIN.near, res: nearRes }, far: { ...NM_TERRAIN.far, res: film.quality.lowTerrain ? 1024 : 2048 } });
  const field = buildAirfield(pipe); pipe.scene.add(field.group);
  const ac = await buildQuarterhorse(pipe); pipe.scene.add(ac);
  const plume = makePlume(pipe, { length: 11.5, radius: QH.nozzleR, diamonds: 6 }); plume.position.set(QH.nozzleX + 0.05, QH.nozzleY, 0); ac.add(plume);
  const haze = makeHeatHaze(pipe, { length: 46, radius: 0.5, spread: 3.4, strength: 0.0042 }); haze.position.set(QH.nozzleX, QH.nozzleY, 0); ac.add(haze);
  const shocks = [[QH.noseX + 0.3, 0.03, 1.0], [QH.noseX - 7.6, -0.2, 0.7], [QH.nozzleX + 0.6, 0.3, 0.8]].map(([x, y, k]) => { const s = makeShockCone(pipe, { length: 150, strength: 0.0052 * k }); s.position.set(x, y, 0); s.userData.k = k; ac.add(s); return s; });
  pipe.registerDynamic(ac);
  if (film.off.has('cshadow')) CLOUDS.shadow = GROUND_CLOUDS.shadow = 0;
  if (film.off.has('clouds')) { CLOUDS.cover = GROUND_CLOUDS.cover = 0; CLOUDS.shadow = GROUND_CLOUDS.shadow = 0; }
  W = { terrain, field, ac, plume, haze, shocks, clouds };
  return W;
}

// pose helpers
const q1 = new THREE.Quaternion(), tmp = v3(), tmp2 = v3();
function poseAir(t, film, o = {}) {
  const s = air(t);
  film.place(W.ac, s.p); attitude(s.hdg, s.pitch, s.roll, W.ac.quaternion);
  W.ac.userData.setGear(false);
  const ab = o.ab ?? 1; W.ac.userData.setAfterburner(ab); W.plume.userData.set(ab, o.abGain ?? 7); W.haze.userData.set(o.haze ?? 0.6);
  for (const sh of W.shocks) sh.userData.set(s.mach, (o.shock ?? 1), (o.line ?? 0) * sh.userData.k);
  W.field.group.visible = false;
  return s;
}
function poseGround(film, z, y, pitch, ab, haze = 1, abGain = 15) {
  tmp.set(0, y, z); film.place(W.ac, tmp); attitude(0, pitch + QH.sitPitch, 0, W.ac.quaternion);
  W.ac.userData.setGear(true); W.ac.userData.setAfterburner(ab); W.plume.userData.set(ab, abGain); W.haze.userData.set(haze);
  for (const sh of W.shocks) sh.userData.set(0, 0, 0);
  W.field.group.visible = true; tmp.set(0, FIELD_ALT, 0); film.place(W.field.group, tmp);
}
// camera position from an offset in the aircraft's body axes [forward, up, right]
function bodyCam(s, off, out) {
  attitude(s.hdg, 0, 0, q1); // heading only: a chase ship flies level
  return out.set(off[0], off[1], off[2]).applyQuaternion(q1).add(s.p);
}

const CLOUDS = { cover: 0.5, scale: 0.6, wind: [0.012, 0.004], density: 0.014, tile: 4200, steps: 56, shadow: 0.8 };
// seen from the field, the cloud thins out along the line of sight to the low sun
const SUN_GAP = (() => { const az = SUN.az * Math.PI / 180, d = (5200 - FIELD_ALT) / Math.tan(SUN.el * Math.PI / 180); return [Math.sin(az) * d, RWY_START_Z - Math.cos(az) * d, 9500, 0.8]; })();
const GROUND_CLOUDS = { ...CLOUDS, hole: SUN_GAP };
const GROUND_POST = { clouds: GROUND_CLOUDS, exposure: 0.22, contrast: 1.22, sat: 1.04, wb: [0.985, 1.0, 1.05], aerial: 0.9, grain: 0.04, bloom: 0.08, cirrus: { alt: 13300, cover: 0.42, opacity: 0.5, scale: 1.2, wind: [0.004, 0.001] } };
const AIR_POST = { clouds: CLOUDS, exposure: 0.2, contrast: 1.32, sat: 1.24, wb: [1.05, 1.0, 0.93], aerial: 0.82, grain: 0.035, bloom: 0.06, cirrus: { alt: 14200, cover: 0.38, opacity: 0.45, scale: 1.4, wind: [0.003, 0.001] } };
// what the bare metal reflects (engine env probe): the broken cloud layer overhead (thin cirrus at altitude), and a clear
// sky no more saturated than the one on screen
Object.assign(GROUND_POST, { envOver: { base: 4300, cover: 0.5 }, envDesat: 0.3 });
Object.assign(AIR_POST, { envOver: { base: 14200, cover: 0.2, gain: 1.5 }, envDesat: 0.3 });

const shots = [
  { id: 's01', name: 'First light', t0: 0, t1: 6.5, terrain: 'ground', note: 'Wide and low from the scrub beside the runway, pushing in: the jet against the sunrise, light shafts through the cloud.',
    pose: (lt, t, f) => poseGround(f, RWY_START_Z, GROUND_Y, 0, 0, 1.2),
    camera: (lt) => { const k = ease(lt / 6.5); return { pos: v3(-58.5 + k * 6, FIELD_ALT + 0.85 + k * 0.3, RWY_START_Z + 27 - k * 3), look: v3(-2, FIELD_ALT + 4.6 - k * 1.0, RWY_START_Z - 1), fov: 32, shake: { rot: 0.02, freq: 0.35, seed: 1 }, focus: v3(0, GROUND_Y, RWY_START_Z), focusRadius: 22 }; },
    post: { ...GROUND_POST, exposure: GROUND_POST.exposure * 0.85, shutter: 0.5, vignette: 0.34, rays: 0.5, flare: { ghost: 0.05, halo: 0.03, streak: 0.14, thr: 8 }, sunDisk: 0.5, bloom: 0.1, dof: { focus: 60, fstop: 3.2, max: 10 } } },
  { id: 's02', name: 'Walkaround', t0: 6.5, t1: 12.5, terrain: 'ground', note: 'Slow lateral move along the bare-metal fuselage in raking morning light.',
    pose: (lt, t, f) => poseGround(f, RWY_START_Z, GROUND_Y, 0, 0, 1.2),
    camera: (lt) => { const k = ease(lt / 6.2); return { pos: v3(10.2 - k * 0.8, FIELD_ALT + 1.55 + k * 0.25, RWY_START_Z + 4.2 - k * 9.6), look: v3(0.6, GROUND_Y + 0.12, RWY_START_Z + 3.0 - k * 9.0), fov: 21, shake: { rot: 0.03, freq: 0.35, seed: 2 }, focus: v3(0, GROUND_Y, RWY_START_Z), focusRadius: 11 }; },
    post: { ...GROUND_POST, exposure: 0.2, shutter: 0.5 } },
  { id: 's03', name: 'Light-off', t0: 12.5, t1: 16.6, terrain: 'ground', note: 'Low off the tail, looking into the sunrise, as the afterburner lights and the jet starts to roll.',
    pose: (lt, t, f) => { const r = Math.max(0, lt - 1.75); poseGround(f, RWY_START_Z - 0.5 * 5.2 * r * r, GROUND_Y, 0, smooth(0.7, 1.25, lt), 1.6); },
    camera: (lt) => { const r = Math.max(0, lt - 1.75), z = RWY_START_Z - 0.5 * 5.2 * r * r; return { pos: v3(-19.5 + lt * 0.35, FIELD_ALT + 0.72, RWY_START_Z + 12.5), look: v3(-0.6, GROUND_Y + 0.55, lerp(RWY_START_Z + 2.5, z + 2.5, 0.5)), fov: 30, shake: { rot: 0.02 + 0.16 * smooth(0.7, 1.4, lt), freq: 2.6, seed: 3, jolt: 0.05 * smooth(0.7, 1.4, lt) }, focus: v3(0, GROUND_Y, z), focusRadius: 16 }; },
    post: (lt) => ({ ...GROUND_POST, exposure: GROUND_POST.exposure * (0.8 - 0.1 * smooth(0.8, 1.6, lt)), bloom: 0.12, shutter: 0.5, rays: 0.6, flare: { ghost: 0.05, halo: 0.03, streak: 0.14, thr: 8 }, sunDisk: 0.5 }) },
  { id: 's04', name: 'Rotation', t0: 16.6, t1: 22.5, terrain: 'ground', note: 'Tracking camera east of the runway: nose up, wheels off, climbing out.',
    pose: (lt, t, f) => { const r = roll(lt); poseGround(f, r.z, r.y, r.pitch, 1, 1.4); },
    camera: (lt, t) => { const r = roll(lt), l = roll(lt - 0.12); return { pos: v3(330, FIELD_ALT + 7.5, -46), look: v3(0, lerp(l.y, FIELD_ALT + 6, 0.12) + 0.4, l.z - 4), fov: 4.3 - 0.4 * smooth(2, 6, lt), shake: { rot: 0.022, freq: 1.3, seed: 4 }, focus: v3(0, r.y, r.z), focusRadius: 12 }; },
    post: { ...GROUND_POST, shimmer: [1.6, 30, 260], shutter: 0.5, exposure: 0.21 } },
  { id: 's05', name: 'Flight three', t0: 22.5, t1: 28.5, terrain: 'air', note: 'Air-to-air from the sunlit side; San Andres Mountains behind.',
    pose: (lt, t, f) => poseAir(t, f, { ab: 0.0, haze: 0.5 }),
    camera: (lt, t) => { const s = air(t); const k = ease(lt / 6); return { pos: bodyCam(s, [17 - 5 * k, 3.4 - 0.8 * k, 15.5 - 1.5 * k], v3()), look: tmp2.copy(s.p).clone(), fov: 25, shake: { rot: 0.05, freq: 0.5, seed: 5 }, focus: s.p.clone(), focusRadius: 11 }; },
    post: { ...AIR_POST } },
  { id: 's06', name: 'Throttle', t0: 28.5, t1: 36.2, terrain: 'air', note: 'Rear quarter on the shadow side as the afterburner lights and the jet pulls away.',
    pose: (lt, t, f) => poseAir(t, f, { ab: smooth(0.5, 1.5, lt), haze: 0.9 }),
    camera: (lt, t) => { const s = air(t); const k = lt / 7.7; return { pos: bodyCam(s, [-17 - 26 * k * k, 2.4 + 1.5 * k, -8.5 - 2 * k], v3()), look: bodyCam(s, [2, 0, 0], v3()), fov: 30 - 6 * k, shake: { rot: 0.07 + 0.05 * k, freq: 0.8, seed: 6 }, focus: s.p.clone(), focusRadius: 11 }; },
    post: { ...AIR_POST, exposure: 0.17, bloom: 0.085 } },
  { id: 's07', name: 'Mach one', t0: 36.2, t1: 41.2, terrain: 'top', note: 'Straight down over the San Andres ridges in long morning shadow: shock fronts appear as the jet passes Mach 1 (visualization aid).',
    pose: (lt, t, f) => poseAir(t, f, { ab: 1, haze: 0.5, shock: 2.4, line: 0.9 }),
    camera: (lt, t) => { const s = air(t); return { pos: bodyCam(s, [-3 + lt * 0.5, 46 - lt * 1.2, 0.01], v3()), look: bodyCam(s, [-3 + lt * 0.5, 0, 0], v3()), up: v3(0, 0, -1).applyAxisAngle(v3(0, 1, 0), -0.5 + lt * 0.03), fov: 31, shake: { rot: 0.03, freq: 0.6, seed: 7 }, focus: s.p.clone(), focusRadius: 11 }; },
    post: (lt, t) => { const s = air(t); return { ...AIR_POST, exposure: 0.3, sat: 0.98, contrast: 1.34, aerial: 0.6, cirrus: null, clouds: { ...CLOUDS, hole: [s.p.x, s.p.z, 9000, 0.8] } }; } },
  { id: 's08', name: 'Pass', t0: 41.2, t1: 47, terrain: 'air', note: 'Fixed camera in the sky. The jet arrives before its sound; the double boom follows.',
    pose: (lt, t, f) => poseAir(t, f, { ab: 1, haze: 0.8, shock: 1.6, line: 0.12 }),
    camera: (lt, t) => { const sp = air(PASS_T); const cam = v3(sp.p.x + 62, sp.p.y + 9, sp.p.z); const s = air(t - 0.05); const jolt = Math.exp(-Math.max(0, t - BOOM_T) * 2.6) * (t > BOOM_T ? 1 : 0); const d = cam.distanceTo(s.p), fov = clamp(2 * Math.atan(15 / d) * 180 / Math.PI, 1.9, 24);   // a tracking mount: long lens while the jet is far, wide as it goes by
      return { pos: cam, look: s.p.clone(), fov, shake: { rot: (0.05 + 0.5 * jolt) * Math.min(1, fov / 20), freq: 1.2 + 6 * jolt, seed: 8, jolt: 0.25 * jolt }, focus: air(t).p.clone(), focusRadius: 11 }; },
    post: { ...AIR_POST, shutter: 0.5, exposure: 0.21 } },
  { id: 's09', name: 'Mach 1.21', t0: 47, t1: 52, terrain: 'air', note: 'Long lens from the sunlit side at peak speed.',
    pose: (lt, t, f) => poseAir(t, f, { ab: 1, haze: 0.7, shock: 1.0, line: 0.05 }),
    camera: (lt, t) => { const s = air(t); return { pos: bodyCam(s, [7 - lt * 1.1, 11, 73], v3()), look: bodyCam(s, [-0.5, 0.1, 0], v3()), fov: 8.6, shake: { rot: 0.035, freq: 1.5, seed: 9 }, focus: s.p.clone(), focusRadius: 11 }; },
    post: { ...AIR_POST, exposure: 0.2 } },
  { id: 's10', name: 'The pace', t0: 52, t1: 63, terrain: 'air', note: 'High and wide: a small silver airplane over the range, cloud shadows on the desert below.',
    pose: (lt, t, f) => poseAir(t, f, { ab: 1, haze: 0.5, shock: 0.6 }),
    camera: (lt, t) => { const s = air(t); const k = lt / 11; return { pos: bodyCam(s, [-50 + 80 * k, 132 - 12 * k, 62 - 8 * k], v3()), look: bodyCam(s, [5, -6, -6], v3()), fov: 19 - 3 * k, shake: { rot: 0.04, freq: 0.4, seed: 10 }, focus: s.p.clone(), focusRadius: 11 }; },
    post: (lt, t) => { const s = air(t); return { ...AIR_POST, exposure: 0.3, clouds: { ...CLOUDS, hole: [s.p.x - 3500, s.p.z, 8500, 0.75] } }; } },
  { id: 's11', name: 'Bare metal', t0: 63, t1: 69.6, terrain: 'air', note: 'Close along the fuselage: rivets, panel seams, the name.',
    pose: (lt, t, f) => poseAir(t, f, { ab: 0.85, haze: 0.4, shock: 0.5 }),
    camera: (lt, t) => { const s = air(t); const k = ease(lt / 6.6); return { pos: bodyCam(s, [8.6 - 7.6 * k, 2.3, 9.8], v3()), look: bodyCam(s, [6.9 - 6.8 * k, 1.25, 0.6], v3()), fov: 24, shake: { rot: 0.05, freq: 0.9, seed: 11 }, focus: s.p.clone(), focusRadius: 11 }; },
    post: { ...AIR_POST, exposure: 0.185 } },
  { id: 's12', name: 'Break', t0: 69.6, t1: 75.2, terrain: 'air', note: 'The jet rolls toward the sun and peels away.',
    pose: (lt, t, f) => poseAir(t, f, { ab: 1, haze: 0.7, shock: 0.6 }),
    camera: (lt, t) => { const s0 = air(69.6), s = air(t); const cam = bodyCam({ p: tmp.copy(s0.p).add(v3(0, 0, -(t - 69.6) * machAt(69.6) * A_SOUND)), hdg: 0 }, [-24, 2.6, -7.5], v3()); return { pos: cam, look: s.p.clone().lerp(cam, 0.02), fov: 31 - 7 * smooth(1, 5.6, lt), shake: { rot: 0.06, freq: 0.8, seed: 12 }, focus: s.p.clone(), focusRadius: 11 }; },
    post: (lt) => ({ ...AIR_POST, exposure: 0.25, sunDisk: 0.06, bloom: 0.08 }) },
  { id: 's13', name: 'End card', t0: 75.2, t1: 80, terrain: 'air', note: 'Empty sky over the basin; title, date, sources.',
    pose: (lt, t, f) => poseAir(t, f, { ab: 1, haze: 0.3, shock: 0 }),
    camera: (lt, t) => { const s = air(75.2); return { pos: v3(s.p.x - 400, s.p.y - 300, s.p.z + 6000 - lt * 30), look: v3(s.p.x - 3000 + lt * 40, s.p.y - 900, s.p.z - 30000), fov: 34, shake: { rot: 0.03, freq: 0.3, seed: 13 } }; },
    post: { ...AIR_POST, exposure: 0.17 } },
];
const PASS_T = 44.15;      // closest approach in the pass shot
const BOOM_T = PASS_T + 0.13;

// ------------------------------------------------------------------ overlays
const cues = [
  { type: 'l3', t0: 0.9, t1: 6.2, kicker: 'May 26, 2026 · Flight 3', title: 'Spaceport America', sub: 'Sierra County, New Mexico' },
  { type: 'l3', t0: 13.2, t1: 20.5, kicker: 'Hermeus', title: 'Quarterhorse Mk 2.1', sub: 'Uncrewed · remotely piloted · one Pratt &amp; Whitney F100' },
  { type: 'l3', t0: 28.9, t1: 35.2, kicker: 'Restricted airspace', title: 'White Sands Missile Range' },
  { type: 'stat', t0: 47.4, t1: 51.7, value: 'MACH 1.21', label: 'Top speed, as announced by Hermeus' },
  { type: 'stat', side: 'left', t0: 52.6, t1: 57.2, value: '&lt; 3 MONTHS', label: 'After Mk 2.1 first flew' },
  { type: 'stat', side: 'left', t0: 57.5, t1: 62.6, value: '364 DAYS', label: 'After the first flight of the company’s first aircraft, Mk 1' },
  { type: 'quote', t0: 63.4, t1: 69.2, text: '“A pace of execution that is extremely rare in modern aviation.”', cite: 'AJ Piplica, CEO and co-founder, Hermeus · May 26, 2026' },
  { type: 'card', t0: 75.5, t1: 80, fadeOut: 0.9, html: `<div class="k">Hermeus · Quarterhorse Mk 2.1</div><div class="t">Mach 1.21</div><div class="row"><span>Flight 3</span><span>May 26, 2026</span><span>Spaceport America, N.M.</span></div><div class="src">Sources: Hermeus press releases (Mk 2.1 first flight; “Hermeus Achieves Its First Unmanned Supersonic Flight,” May 26, 2026); New Atlas; Army Recognition.</div><div class="dis">Simulated visualization. Not actual footage. Time of day, weather, altitude, flight path and the Mach trace are illustrative; top speed, date, location and flight number are as reported.</div>` },
];
const HUD_CSS = `
.hud-mach{right:2.6cqw;top:2.3cqw;text-align:right;font-family:var(--f-data);color:var(--ink);text-shadow:0 0 .6cqw rgba(0,0,0,.75)}
.hud-mach .lab{font-size:.86cqw;letter-spacing:.3em;color:var(--ink-2)}
.hud-mach .num{font:700 4.3cqw/.9 var(--f-display);font-variant-numeric:tabular-nums;margin-top:.4cqw;letter-spacing:.03em}
.hud-mach.sup .num{color:var(--amber)}
.hud-mach .tape{position:relative;width:17cqw;height:.9cqw;margin:.7cqw 0 0 auto;border-bottom:1px solid var(--line)}
.hud-mach .tape u{position:absolute;bottom:0;width:1px;height:.45cqw;background:var(--ink-2)}
.hud-mach .tape u.one{height:.9cqw;background:var(--amber)}
.hud-mach .tape b{position:absolute;bottom:-.1cqw;width:.22cqw;height:1.15cqw;background:var(--ink);transform:translateX(-50%)}
.hud-mach .tape s{position:absolute;top:1.25cqw;font-size:.66cqw;letter-spacing:.08em;color:var(--ink-2);transform:translateX(-50%);text-decoration:none}
.hud-mach .note{font-size:.66cqw;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);margin-top:1.7cqw}`;
let hud;
function buildHud(root) {
  const st = document.createElement('style'); st.textContent = HUD_CSS; root.append(st);
  const M0 = 0.85, M1 = 1.25, px = m => ((m - M0) / (M1 - M0) * 100).toFixed(2) + '%';
  const e = document.createElement('div'); e.className = 'hud-mach';
  e.innerHTML = `<div class="lab">MACH</div><div class="num">0.90</div><div class="tape">${[0.9, 1.0, 1.1, 1.2].map(m => `<u class="${m === 1 ? 'one' : ''}" style="left:${px(m)}"></u><s style="left:${px(m)}">${m.toFixed(1)}</s>`).join('')}<b></b></div><div class="note">Illustrative trace · peak as reported</div>`;
  root.append(e);
  hud = { e, num: e.querySelector('.num'), mark: e.querySelector('b'), px };
}
function updateHud(t) {
  const a = smooth(23.2, 24, t) * (1 - smooth(62.6, 63.2, t)), m = machAt(t);
  hud.e.style.opacity = a.toFixed(3);
  const txt = m.toFixed(2); if (hud._t !== txt) { hud._t = txt; hud.num.textContent = txt; hud.mark.style.left = hud.px(m); hud.e.classList.toggle('sup', m >= 1); }
}

// ------------------------------------------------------------------ sound
function score(m) {
  const Dm = [73.42, 110, 146.83, 174.61, 220], Bb = [58.27, 116.54, 146.83, 174.61, 233.08], F = [87.31, 130.81, 174.61, 220, 261.63], C = [65.41, 130.81, 164.81, 196, 261.63];
  // desert air and a jet at idle
  m.wind({ env: [[0, 0], [1, 0.05], [12, 0.05], [13, 0.02], [22.4, 0.02], [22.5, 0]], freq: 420 });
  m.jet({ env: [[0, 0], [1.5, 0.018], [6.4, 0.022], [6.5, 0.06], [12.4, 0.07], [12.5, 0.11], [13.3, 0.14], [14.2, 0.42], [16.5, 0.34], [16.6, 0.09], [19.5, 0.2], [21.6, 0.34], [22.45, 0.2], [22.5, 0]],
    pitch: [[0, 0.7], [12.5, 0.72], [13.4, 1.0], [16.6, 1.05], [21.2, 1.12], [22.5, 0.86]], ab: [[0, 0], [13.2, 0], [13.45, 0.42], [16.5, 0.34], [16.6, 0.07], [21.6, 0.3], [22.45, 0.16], [22.5, 0]], pan: 0 });
  m.thump(13.25, { gain: 0.9, f0: 90, f1: 34, dur: 0.7 });
  m.hit(0.35, { gain: 0.5 });
  m.pad(0.4, 12.2, [Dm[0], Dm[2], Dm[4]], { gain: 0.035, bright: 600 });
  // at altitude
  m.wind({ env: [[22.5, 0], [22.6, 0.07], [41.1, 0.08], [41.2, 0.035], [44, 0.03], [47, 0.06], [75, 0.07], [80, 0]], freq: 760 });
  m.jet({ env: [[22.5, 0], [22.6, 0.06], [28.4, 0.06], [29.4, 0.13], [36.1, 0.2], [36.2, 0.05], [41.1, 0.05], [41.2, 0.0]], pitch: [[22.5, 0.9], [36.2, 1.06], [41.2, 1.0]], ab: [[22.5, 0], [28.9, 0], [29.5, 0.16], [36.1, 0.22], [36.2, 0.03], [41.2, 0]], pan: -0.1, whine: 0.3 });
  m.pad(22.6, 36, Dm, { gain: 0.045, bright: 900 });
  m.pulse(28.6, 36.1, 0.86, { freq: 49, gain: 0.3, accel: 0.035 });
  m.riser(32.5, 38.15, { gain: 0.16 });
  m.hit(38.2, { gain: 0.95 });
  m.pad(38.2, 47, Bb, { gain: 0.05, bright: 1100, attack: 1.2 });
  // the pass: silence, then the airplane, then its sound
  m.whoosh(PASS_T - 0.28, { dur: 0.7, gain: 0.75, f0: 500, f1: 4200, pan: [0.7, -0.7] });
  m.boom(BOOM_T, { gain: 1.25 });
  m.jet({ env: [[BOOM_T, 0], [BOOM_T + 0.15, 0.5], [BOOM_T + 1.4, 0.2], [47, 0.05], [47.01, 0]], pitch: [[BOOM_T, 0.8], [47, 0.6]], ab: [[BOOM_T, 0], [BOOM_T + 0.15, 0.5], [BOOM_T + 1.5, 0.16], [47, 0.03]], pan: -0.5, whine: 0 });
  m.jet({ env: [[47, 0], [47.1, 0.07], [62.9, 0.07], [63, 0.1], [69.5, 0.1], [69.6, 0.12], [72, 0.1], [75.2, 0.03], [80, 0]], pitch: [[47, 1.05], [80, 0.95]], ab: [[47, 0], [47.1, 0.07], [69.6, 0.09], [75.2, 0.02], [80, 0]], pan: 0.1, whine: 0.25 });
  m.pad(46.5, 58, F, { gain: 0.055, bright: 1300 });
  m.pad(57, 67.5, C, { gain: 0.05, bright: 1200 });
  m.pad(66.5, 79.4, Dm, { gain: 0.055, bright: 1000, release: 0.6 });
  m.hit(75.3, { gain: 0.6 });
  for (const t of [23.3, 47.45, 52.65, 57.55]) m.beep(t, { freq: 1568, gain: 0.03, dur: 0.05 });
}

startFilm({
  id: 'quarterhorse', title: 'Mach 1.21', duration: T_END, fps: 30, poster: 49.6, narration: NARRATION,
  build, shots, cues, buildHud, updateHud, score,
  frame(t, shot, lt, film, c) {
    W.terrain.update(shot.terrain); W.field.bush.visible = shot.terrain === 'ground' && !film.off.has('scrub');
    if (W.field.bush.visible) { // thin the scrub out with distance: plants under about a pixel are skipped
      const pxPerM = film.pipe.h / (2 * Math.tan(c.fov * Math.PI / 360));
      for (const im of W.field.bush.children) {
        const u = im.userData, d = Math.hypot(u.cx - c.pos.x, u.cz - c.pos.z, FIELD_ALT - c.pos.y);
        const f = clamp((0.55 * pxPerM / Math.max(d - 130, 30) - 0.8) / 1.7, 0, 1);
        im.count = Math.round(u.n * f); im.visible = im.count > 0;
      }
    }
    if (film.off.size) { // dev profiling switches
      if (film.off.has('env')) film.pipe.scene.environment = null;
      if (film.off.has('ac')) W.ac.visible = false;
      if (film.off.has('field')) W.field.group.visible = false;
      if (film.off.has('terrain')) W.terrain.mesh.visible = false;
    }
  },
});
