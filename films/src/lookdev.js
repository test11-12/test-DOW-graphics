// Look development: any packed glTF asset under the films' sky, sun, haze and grade.
//   ?glb=<path in films/assets>  (default: the first .glb packed)   ?el=<sun elevation> ?az=<sun azimuth>
//   ?dist=<camera distance, m>  ?h=<camera height, m>  ?fov=<deg>  ?exp=<exposure>  ?clouds=1
//   ?gc=<ground colour, hex rrggbb; default 8a7f70>  ?ga=<sky model's ground albedo, hex>  (pale concrete: gc=b9b5ab)
//   ?origin=1  keep the model's own origin over the world origin (only lifted onto the ground), so --cam can be given in model coordinates
//   ?pitch=<deg>  pitch the model (nose up positive) before standing it on the ground
//   ?roll=<deg>  camera roll (also applies to a --cam free camera)
//   ?emis=<k>  scale every emissive intensity (0 = afterburner surfaces cold)
// Time t (0..12 s) orbits the camera once around the asset.
import * as THREE from 'three';
import { startFilm, v3 } from '../engine/film.js';
import { LAYER } from '../engine/pipeline.js';
import { CloudLayer } from '../engine/clouds.js';
import { loadGLB, assetNames } from '../engine/assets.js';

const NARRATION = __NARRATION__;
const P = new URLSearchParams(location.search), num = (k, d) => (P.has(k) ? +P.get(k) : d);
let W;
async function build(film) {
  const pipe = film.pipe;
  pipe.atmo.setSun(num('az', 70), num('el', 10));
  pipe.atmo.uniforms.uHaze.value = num('haze', 1.2); pipe.atmo.groundAlbedo.setRGB(0.3, 0.26, 0.2);
  if (P.has('ga')) pipe.atmo.groundAlbedo.set(parseInt(P.get('ga'), 16)).convertSRGBToLinear();
  const name = P.get('glb') || assetNames().find(n => n.endsWith('.glb'));
  const { root } = await loadGLB(name, pipe);
  if (P.has('emis')) root.traverse(o => { if (o.isMesh && o.material.emissiveMap) o.material.emissiveIntensity *= +P.get('emis'); });
  if (P.has('pitch')) { root.rotation.z = +P.get('pitch') * Math.PI / 180; root.updateMatrixWorld(true); }
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group(); holder.add(root); root.position.set(P.has('origin') ? 0 : -c.x, -box.min.y, P.has('origin') ? 0 : -c.z); pipe.scene.add(holder);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: P.has('gc') ? parseInt(P.get('gc'), 16) : 0x8a7f70, roughness: 0.95 }));
  ground.receiveShadow = true; ground.layers.set(LAYER.STATIC); pipe.scene.add(ground);
  const clouds = P.has('clouds') ? new CloudLayer(pipe, { base: 2500, top: 4200, div: 3 }) : null;
  pipe.registerDynamic(holder);
  W = { holder, ground, size: Math.max(size.x, size.y, size.z), height: size.y, clouds };
  return W;
}
const orbit = t => { const R = num('dist', W.size * 1.35), a = t / 12 * Math.PI * 2 + 0.6; return v3(Math.cos(a) * R, num('h', W.height * 0.6 + 1.2), Math.sin(a) * R); };
const shots = [{ id: 'l1', name: 'Turntable', t0: 0, t1: 12, terrain: null,
  pose: (lt, t, f) => { f.place(W.holder, v3(0, 0, 0)); f.place(W.ground, v3(0, 0, 0)); },
  camera: (lt, t) => ({ pos: orbit(t), look: v3(0, W.height * 0.45, 0), fov: num('fov', 30), roll: num('roll', 0), focus: v3(0, W.height * 0.4, 0), focusRadius: W.size * 0.8 }),
  post: () => ({ exposure: num('exp', 0.24), contrast: 1.22, sat: 1.04, bloom: 0.06, grain: 0.02, vignette: 0.25, shutter: 0, clouds: W.clouds ? { cover: 0.4, scale: 0.7, density: 0.013, steps: 40 } : null }) }];
startFilm({ id: 'lookdev', title: 'Look development', duration: 12, fps: 30, poster: 2, narration: NARRATION, build, shots, cues: [] });
