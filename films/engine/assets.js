// Assets made outside the code (Blender-baked glTF models, photoscanned textures) that tools/build.mjs packs
// into the page as window.__ASSETS__ = { 'film/name.glb': 'data:...' | 'assets/film/name.glb', ... }.
// Paths are relative to films/assets/.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const table = () => (typeof window !== 'undefined' && window.__ASSETS__) || {};
export const hasAsset = name => Object.prototype.hasOwnProperty.call(table(), name);
export const assetNames = () => Object.keys(table());

// raw bytes of a packed asset
export async function assetBuffer(name) {
  const src = table()[name];
  if (!src) throw new Error(`asset not packed into this page: ${name}`);
  if (src.startsWith('data:')) {
    const b64 = src.slice(src.indexOf(',') + 1), bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error(`asset ${name}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'clearcoatMap', 'clearcoatNormalMap', 'anisotropyMap', 'alphaMap'];

// A glTF model as a three.js group. Meshes cast and receive shadows and are never frustum-culled (the
// engine keeps a floating origin, so bounding volumes go stale); textures get anisotropic filtering.
// o: { cast, receive, aniso, envIntensity }
export async function loadGLB(name, pipe, o = {}) {
  const buf = await assetBuffer(name);
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const root = gltf.scene;
  const aniso = Math.max(1, Math.min(o.aniso ?? 8, pipe ? pipe.maxAniso : 8));
  root.traverse(obj => {
    if (!obj.isMesh) return;
    obj.castShadow = o.cast ?? true; obj.receiveShadow = o.receive ?? true; obj.frustumCulled = false;
    for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      for (const k of MAPS) if (m[k]) { m[k].anisotropy = aniso; m[k].needsUpdate = true; }
      if (o.envIntensity !== undefined) m.envMapIntensity = o.envIntensity;
    }
  });
  root.name = root.name || name;
  // provenance for the Cycles hero path (engine/hero.js, tools/export_shots.mjs): the asset on the root, the glTF node
  // index on every node. Object3D.clone copies userData, so meshes cloned out of the model keep it.
  root.userData.asset = name;
  root.traverse(obj => { const a = gltf.parser.associations.get(obj); if (a && a.nodes !== undefined) obj.userData.glbNode = [name, a.nodes]; });
  return { root, gltf };
}

// The first mesh under root whose name (or material name) matches, for wiring effects to parts of a model.
export function findMesh(root, test) {
  const t = typeof test === 'string' ? (s => s && s.includes(test)) : (s => s && test.test(s));
  let hit = null;
  root.traverse(o => { if (!hit && o.isMesh && (t(o.name) || t(o.material && o.material.name))) hit = o; });
  return hit;
}

// A packed image as a texture (decoded off the main thread where the browser allows).
// o: { srgb = true, repeat = true, aniso = 8, mips = true }
export async function loadTexture(name, pipe, o = {}) {
  const buf = await assetBuffer(name);
  const type = name.endsWith('.webp') ? 'image/webp' : name.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const bmp = await createImageBitmap(new Blob([buf], { type }), { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const tex = new THREE.Texture(bmp);
  tex.flipY = false;   // flipped while decoding: ImageBitmaps ignore texture.flipY
  tex.colorSpace = (o.srgb ?? true) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (o.repeat ?? true) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = o.mips ?? true;
  tex.minFilter = tex.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.anisotropy = Math.max(1, Math.min(o.aniso ?? 8, pipe ? pipe.maxAniso : 8));
  tex.needsUpdate = true;
  return tex;
}
