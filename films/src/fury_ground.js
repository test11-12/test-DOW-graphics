// Photoscanned close-range ground for the Mojave terrain recipe. blender/fury_ground.py bakes each material into
// three WebP layers (albedo; normal x,y + roughness; height, occlusion, cavity); here they are packed into one RGBA
// texture array, so the terrain shading pass spends a single sampler on all of them.
import * as THREE from 'three';
import { assetBuffer, hasAsset } from '../engine/assets.js';

// names: material names in assets/fury/tex/ground_<name>_<layer>.webp; layers are appended in order (3 per material).
// Returns null when the assets are not packed into the page (the recipe then falls back to its procedural ground).
export async function loadGroundArray(pipe, names = ['asphalt'], { size = 2048 } = {}) {
  const layers = [];
  for (const n of names) for (const l of ['a', 'n', 'h']) layers.push(`fury/tex/ground_${n}_${l}.webp`);
  if (!layers.every(hasAsset)) return null;
  const N = layers.length, px = size * size * 4, data = new Uint8Array(px * N);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < N; i++) {
    const bmp = await createImageBitmap(new Blob([await assetBuffer(layers[i])], { type: 'image/webp' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    g.clearRect(0, 0, size, size); g.drawImage(bmp, 0, 0, size, size); bmp.close?.();
    data.set(g.getImageData(0, 0, size, size).data, i * px);   // files are stored bottom-up: row 0 is v = 0
  }
  const tex = new THREE.DataArrayTexture(data, size, size, N);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType; tex.colorSpace = THREE.NoColorSpace;   // albedo is decoded in the shader
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.flipY = false; tex.unpackAlignment = 4;
  tex.anisotropy = Math.max(1, Math.min(8, pipe.maxAniso));
  tex.onUpdate = () => { tex.image.data = null; };            // uploaded once; release the CPU copy
  tex.needsUpdate = true;
  return tex;
}
