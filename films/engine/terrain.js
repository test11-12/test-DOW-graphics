// Baked procedural terrain: a recipe (GLSL height + mask functions) is rendered once into height and
// mask textures (a detailed "near" map and a coarse "far" map). Geometry is a camera-centred polar grid
// with earth curvature that only writes depth; the lighting runs afterwards as one full-screen pass
// (deferred), so the expensive shader runs exactly once per pixel whatever the triangle density.
import * as THREE from 'three';
import { NOISE, DEPTH, FSQ_VERT } from './glsl.js';
import { Pass, LAYER, RG } from './pipeline.js';
import { loadTexture } from './assets.js';

// ---------------------------------------------------------------- photoscanned material layers (optional)
// recipe.layers = [{ name, albedo, normal, orm, scale, rotate, sharp, hcontrast }]: packed textures (paths under
// films/assets), scale = metres per texture tile (the scan's real size), rotate = random rotation per hex cell
// (0..1; 0 for directional textures), sharp / hcontrast = hex-blend sharpness and height weighting.
// File layouts: albedo RGB (sRGB); normal OpenGL tangent space, either standard RGB or one grey image twice as wide
// as tall (left half x, right half y); orm R occlusion, G roughness, A height (0..1).
// All layers are packed at load into two texture arrays (A: albedo + height, B: normal xy + roughness + occlusion),
// so any number of layers costs two samplers.
const HEXS = 3.4641016151377544;   // 2*sqrt(3): hex cells are about 0.58 texture tiles across
const LAYERS_GLSL = names => /* glsl */`
#define TERRAIN_LAYERS 1
#define TERRAIN_NLAYERS ${names.length}
${names.map((n, i) => `#define L_${n.toUpperCase()} ${i}`).join('\n')}
uniform highp sampler2DArray tLayerA, tLayerB;
uniform vec4 uLayerK[${names.length}];   // x: texture tiles per metre, y: random rotation 0..1, z: hex sharpness, w: height weighting
uniform vec4 uLayerP[${names.length}];   // xy: camera position in the skewed hex lattice (fraction), zw: texture phase at the lattice anchor
uniform ivec2 uLayerI[${names.length}];  // integer lattice anchor, so the per-cell random transforms stay fixed to the world
uniform vec4 uLayerMA[${names.length}], uLayerMB[${names.length}];   // each layer's mean (albedo + height, normal + roughness + occlusion)
// Lighting inputs a recipe sets through surfApply(); tRough < 0 keeps the default terrain lighting.
float tRough = -1.0, tAO = 1.0, tF0 = 0.03, tFp = 1.0, tW = 0.0;   // tW: weight of the layered lighting (fade it out where the recipe hands over to its own far-field look)
// A sampled surface. d: slope perturbation in world (x, z), added to the normal as N += vec3(d.x, 0.0, d.y).
struct Surf { vec3 alb; float h; vec2 d; float rough; float ao; };
uvec2 lPcg(uvec2 v){ v = v*1664525u+1013904223u; v.x += v.y*1664525u; v.y += v.x*1664525u; v ^= v>>16u; v.x += v.y*1664525u; v.y += v.x*1664525u; v ^= v>>16u; return v; }
vec4 lRand(ivec2 c){ uvec2 h = lPcg(uvec2(c)); return vec4(float(h.x&65535u), float(h.x>>16u), float(h.y&65535u), float(h.y>>16u))/65535.0; }
Surf surfMix(Surf a, Surf b, float t){ Surf s; s.alb = mix(a.alb, b.alb, t); s.h = mix(a.h, b.h, t); s.d = mix(a.d, b.d, t); s.rough = mix(a.rough, b.rough, t); s.ao = mix(a.ao, b.ao, t); return s; }
// b takes over from a as t goes 0 -> 1, first where b stands proud of a (height-aware blend; soft: transition width)
Surf surfBlendH(Surf a, Surf b, float t, float soft){
  float ha = a.h+1.0-2.0*t, hb = b.h-1.0+2.0*t, m = max(ha, hb)-max(soft, 1e-3);
  float wa = max(ha-m, 0.0), wb = max(hb-m, 0.0);
  return surfMix(a, b, wb/max(wa+wb, 1e-5));
}
// the layer's average (measured from its last mip at load): what it converges to far away
Surf layerMean(int k){
  vec4 a = uLayerMA[k], b = uLayerMB[k];
  Surf s; s.alb = a.rgb; s.h = a.a; s.d = vec2(0.0); s.rough = max(b.b, 0.93); s.ao = 1.0; return s;
}
vec3 layerMeanAlbedo(int k){ return uLayerMA[k].rgb; }
// world slope from a tangent-space normal sampled with texture coords rotated by R relative to world (x, -z). The
// layer's mean normal is taken out first: a scan's slight overall tilt, turned a different way in every hex cell,
// would otherwise show as a patchwork under a grazing sun.
vec2 lSlope(vec2 nt, mat2 R, int k){ vec2 n = (nt-uLayerMB[k].xy)*2.0; float nz = sqrt(max(1.0-dot(n, n), 0.25)); n = n*R; return vec2(n.x, -n.y)/nz; }
// metres -> roughness rises as the micro-relief falls below a pixel (keeps far ground from turning glossy)
float lRoughAt(float r, float tilesPerPx){ return mix(r, max(r, 0.93), smoothstep(0.004, 0.06, tilesPerPx)); }
// occlusion relative to the layer's mean: local cavity contrast only (a recipe sets the overall tone by its grade)
float lAO(float ao, int k){ return clamp(ao/max(uLayerMB[k].a, 0.3), 0.0, 1.0); }
// layer k in a mapping of the caller's own: st in texture tiles, dx / dy its footprint per pixel, ang the rotation of
// st relative to world (x, -z) (for per-slab offsets, directional finishes, ...). No hex tiling.
Surf layerSampleST(int k, vec2 st, vec2 dx, vec2 dy, float ang){
  float cs = cos(ang), sn = sin(ang); mat2 R = mat2(cs, sn, -sn, cs);
  vec3 c = vec3(st, float(k));
  vec4 a = textureGrad(tLayerA, c, dx, dy), b = textureGrad(tLayerB, c, dx, dy);
  Surf s; s.alb = a.rgb; s.h = a.a; s.d = lSlope(b.xy, R, k); s.rough = lRoughAt(b.b, tFp*uLayerK[k].x); s.ao = lAO(b.a, k); return s;
}
// metres-per-pixel footprint axes of this pixel in world (x, -z), for building dx / dy of layerSampleST
vec2 lFootX(){ return vec2(gGx.x, -gGx.y)*1000.0; }
vec2 lFootY(){ return vec2(gGy.x, -gGy.y)*1000.0; }
// layer k at this pixel, hex-tiled (Mikkelsen 2022): three world-fixed hex cells, each with its own random offset (and
// rotation), blended by barycentric weight sharpened by height. Footprint-correct gradients; far away it fades to the
// layer mean, which costs one cached tap.
Surf layerSample(int k){
  vec4 K = uLayerK[k], P = uLayerP[k];
  float tpp = tFp*K.x;                                   // texture tiles per pixel
  float far = smoothstep(0.035, 0.12, tpp);
  if (far >= 1.0) return layerMean(k);
  bool nrm = tpp < 0.05;                                 // normals, roughness and occlusion average out first
  vec2 dX = lFootX()*K.x, dY = lFootY()*K.x;
  vec2 u = vec2(vRel.x, -vRel.z)*K.x;
  vec2 sk = vec2(u.x, -0.57735027*u.x+1.15470054*u.y)*${HEXS.toFixed(10)}+P.xy;
  vec2 b0 = floor(sk), f = sk-b0; float tz = 1.0-f.x-f.y;
  float sg = tz < 0.0 ? 1.0 : 0.0, s2 = 2.0*sg-1.0;
  vec3 bw = vec3(-tz*s2, sg-f.y*s2, sg-f.x*s2);
  vec2 V[3]; V[0] = b0+vec2(sg); V[1] = b0+vec2(sg, 1.0-sg); V[2] = b0+vec2(1.0-sg, sg);
  vec2 uL = vec2(sk.x, 0.5*sk.x+0.8660254*sk.y)/${HEXS.toFixed(10)};
  vec4 A[3], B[3]; mat2 R[3]; vec3 W = pow(bw, vec3(K.z));
  for (int i=0;i<3;i++){
    A[i] = vec4(0.0); B[i] = vec4(0.5, 0.5, 0.0, 1.0); R[i] = mat2(1.0);
    if (W[i] < 0.002) continue;                          // deep inside another cell: skip the taps
    vec4 r = lRand(ivec2(V[i])+uLayerI[k]);
    float ang = (r.x*2.0-1.0)*3.14159265*K.y, cs = cos(ang), sn = sin(ang);
    R[i] = mat2(cs, sn, -sn, cs);
    vec2 ci = vec2(V[i].x, 0.5*V[i].x+0.8660254*V[i].y)/${HEXS.toFixed(10)};
    vec3 st = vec3(R[i]*(uL-ci)+ci+r.zw+P.zw, float(k));
    A[i] = textureGrad(tLayerA, st, R[i]*dX, R[i]*dY);
    B[i] = nrm ? textureGrad(tLayerB, st, R[i]*dX, R[i]*dY) : uLayerMB[k];
  }
  W *= exp2(K.w*(vec3(A[0].a, A[1].a, A[2].a)-0.5));
  W /= W.x+W.y+W.z;
  Surf s;
  s.alb = A[0].rgb*W.x+A[1].rgb*W.y+A[2].rgb*W.z; s.h = A[0].a*W.x+A[1].a*W.y+A[2].a*W.z;
  s.d = nrm ? (lSlope(B[0].xy, R[0], k)*W.x+lSlope(B[1].xy, R[1], k)*W.y+lSlope(B[2].xy, R[2], k)*W.z)*(1.0-smoothstep(0.025, 0.05, tpp)) : vec2(0.0);
  s.rough = lRoughAt(B[0].b*W.x+B[1].b*W.y+B[2].b*W.z, tpp); s.ao = lAO(B[0].a*W.x+B[1].a*W.y+B[2].a*W.z, k);
  if (far > 0.0) s = surfMix(s, layerMean(k), far);
  return s;
}
// write a surface into shadeTerrain's outputs; k scales the normal detail. Switches the pixel to the layered lighting.
void surfApply(Surf s, float k, inout vec3 alb, inout vec3 N){
  alb = s.alb; N = normalize(N+vec3(s.d.x, 0.0, s.d.y)*k); tRough = s.rough; tAO = s.ao; tW = 1.0;
}
`;
const PACK_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tAlb, tNrm, tOrm; uniform vec4 uHas; uniform int uWhich;   // uHas: normal, normal pair layout, orm, half-texel of a pair half
varying vec2 vUv;
void main(){
  vec4 o = uHas.z > 0.5 ? texture2D(tOrm, vUv) : vec4(1.0, 0.85, 0.0, 0.5);
  if (uWhich == 0){ gl_FragColor = vec4(texture2D(tAlb, vUv).rgb, o.a); return; }
  vec2 n = vec2(0.5);
  if (uHas.x > 0.5){
    if (uHas.y > 0.5){ float x = clamp(vUv.x, uHas.w, 1.0-uHas.w)*0.5; n = vec2(texture2D(tNrm, vec2(x, vUv.y)).g, texture2D(tNrm, vec2(x+0.5, vUv.y)).g); }
    else n = texture2D(tNrm, vUv).rg;
  }
  gl_FragColor = vec4(n, o.g, o.r);
}`;

// Slope-following erosion noise (after Fewes / Clay John): gullies and spurs that run down the fall line.
export const EROSION = /* glsl */`
vec3 erosionK(vec2 p, vec2 dir){
  vec2 ip = floor(p), fp = fract(p); vec3 va = vec3(0.0); float wt = 0.0;
  for (int i=-2;i<=1;i++) for (int j=-2;j<=1;j++){
    vec2 o = vec2(float(i), float(j));
    vec2 pp = fp+o-hash22(ip-o)*0.5;
    float w = exp(-dot(pp,pp)*2.0); wt += w;
    float mag = dot(pp,dir)*6.2831853;
    va += vec3(cos(mag), -sin(mag)*dir)*w;
  }
  return va/wt;
}
// p: position in erosion cells, slope: gradient of the macro shape. Returns x: 0..1 (0 = gully floor, 1 = spur crest)
float erosion(vec2 p, vec2 slope, float branch, int oct, float lodCells){
  vec2 dir = slope.yx*vec2(1.0,-1.0);
  vec3 h = vec3(0.0); float a = 0.5, f = 1.0, tot = 0.0;
  for (int i=0;i<6;i++){
    if (i>=oct || f*lodCells > 0.5) break;
    h += erosionK(p*f, dir+h.zy*vec2(1.0,-1.0)*branch)*a*vec3(1.0,f,f);
    tot += a; a *= 0.5; f *= 2.0;
  }
  return tot > 0.0 ? 0.5+0.5*h.x/tot : 0.5;
}
`;

const BAKE_H = recipe => /* glsl */`
precision highp float;
${NOISE}
${EROSION}
uniform vec2 uCenter; uniform float uExtent, uTexel;   // km
varying vec2 vUv;
${recipe}
void main(){
  vec2 p = uCenter+(vUv-0.5)*uExtent;
  gl_FragColor = vec4(terrainH(p, uTexel), 0.0, 0.0, 1.0);
}`;

const BAKE_M = recipe => /* glsl */`
precision highp float;
${NOISE}
${EROSION}
uniform sampler2D tH; uniform vec2 uCenter; uniform float uExtent, uTexel, uRes; uniform vec3 uSunDir; uniform int uWhich;
varying vec2 vUv;
${recipe}
float shadow(vec2 uv, float h){
  vec2 hd = uSunDir.xz; float hl = length(hd);
  if (hl < 1e-4) return 1.0;
  float tanEl = uSunDir.y/hl; vec2 dUV = hd/hl/(uExtent*1000.0);
  float s = 1.0, t = uTexel*1000.0*1.5;
  for (int i=0;i<72;i++){
    vec2 q = uv+dUV*t;
    if (q.x<0.0||q.y<0.0||q.x>1.0||q.y>1.0) break;
    float d = h+t*tanEl-texture2D(tH, q).r;
    s = min(s, 0.5+7.0*d/t);
    if (s <= 0.0) break;
    t *= 1.12;
  }
  return clamp(s, 0.0, 1.0);
}
void main(){
  vec2 p = uCenter+(vUv-0.5)*uExtent;
  float e = 1.0/uRes;
  float h = texture2D(tH, vUv).r;
  float hx = texture2D(tH, vUv+vec2(e,0)).r-texture2D(tH, vUv-vec2(e,0)).r;
  float hz = texture2D(tH, vUv+vec2(0,e)).r-texture2D(tH, vUv-vec2(0,e)).r;
  vec2 grad = vec2(hx,hz)/(2.0*uTexel*1000.0);
  vec4 m0, m1; terrainMask(p, h, grad, uTexel, m0, m1);
  if (uWhich == 0) gl_FragColor = vec4(m0.rgb, shadow(vUv, h));
  else gl_FragColor = m1;
}`;

const TERRAIN_COMMON = /* glsl */`
uniform sampler2D tHNear, tHFar;
uniform vec4 uNear, uFar;     // centre.xz (m), extent (m), texel (m)
float nearW(vec2 w){ vec2 u = abs((w-uNear.xy)/uNear.z); return smoothstep(0.495, 0.44, max(u.x,u.y)); }
float hLod(vec2 w, float lodM){
  float bn = nearW(w);
  if (bn >= 1.0) return textureLod(tHNear, (w-uNear.xy)/uNear.z+0.5, log2(max(lodM/uNear.w,1.0))).r;
  float hf = textureLod(tHFar, (w-uFar.xy)/uFar.z+0.5, log2(max(lodM/uFar.w,1.0))).r;
  if (bn <= 0.0) return hf;
  return mix(hf, textureLod(tHNear, (w-uNear.xy)/uNear.z+0.5, log2(max(lodM/uNear.w,1.0))).r, bn);
}
`;

// for objects that sit on the ground (plants, decals): float hLod(vec2 worldXZ, float lodMetres) with
// terrain.heightUniforms (tHNear, tHFar, uNear, uFar)
export const TERRAIN_HEIGHT = TERRAIN_COMMON;

// depth-only geometry. Log depth is written per vertex (triangles are small) so early-Z stays enabled.
const TERRAIN_VERT = /* glsl */`
${TERRAIN_COMMON}
uniform float uYaw, uSector, logDepthBufFC; uniform vec3 uOrigin;
void main(){
  float az = uYaw+position.x*uSector; vec2 d = vec2(cos(az), sin(az)); float r = position.y;
  vec2 w = uOrigin.xz+d*r;
  float h = hLod(w, position.z);
  vec3 p = vec3(d.x*r, h-uOrigin.y-r*r/(2.0*${RG.toFixed(1)}), d.y*r);
  gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
  gl_Position.z = (log2(max(1e-6, 1.0+gl_Position.w))*logDepthBufFC-1.0)*gl_Position.w;
}`;
const TERRAIN_FRAG = /* glsl */`
void main(){ gl_FragColor = vec4(0.0); }   // alpha 0 marks "terrain here" for the shading pass
`;

// full-screen lighting pass: scene.rgb + terrain * (1 - scene.a)
const SHADE_FRAG = shade => /* glsl */`
precision highp float;
${NOISE}
${DEPTH}
${TERRAIN_COMMON}
uniform sampler2D tScene, tDepth, tM0Near, tM0Far, tM1Near, tM1Far, tDetail, tAmbient;
uniform mat4 uInvProj; uniform mat3 uCamRot;
uniform vec3 uOrigin, uSunDir, uSunGround; uniform float uTime, uPixAngle; uniform int uDebug; uniform vec2 uRes;
uniform vec2 uPhase[12]; uniform vec2 uScale[12];
uniform sampler2D tShadow; uniform mat4 uShadowMat; uniform vec3 uShadowK;   // enabled, texel size, softness (texels)
uniform sampler2D tSky; uniform float uMieG;
varying vec2 vUv;
// sky radiance in direction d, from the pipeline's sky-view table (for reflections off water and pavement)
vec3 skyRefl(vec3 d){
  d.y = max(d.y, 0.004); d = normalize(d);
  float el = asin(d.y), v = clamp(0.5+0.5*sqrt(el/1.5707963), 0.004, 0.996), u = atan(d.z, d.x)/6.2831853+0.5;
  float c = dot(d, uSunDir), g = uMieG, g2 = g*g;
  float pR = 0.0596831*(1.0+c*c), pM = 0.1193662*((1.0-g2)*(1.0+c*c))/((2.0+g2)*pow(max(1.0+g2-2.0*g*c, 1e-4), 1.5));
  return textureLod(tSky, vec2(u, v/3.0), 0.0).rgb*pR+textureLod(tSky, vec2(u, (v+1.0)/3.0), 0.0).rgb*min(pM, 6.0)+textureLod(tSky, vec2(u, (v+2.0)/3.0), 0.0).rgb;
}
vec3 vRel; vec2 gGx, gGy;     // camera-relative position (m) and ground-footprint axes (km) of this pixel
// shadow of the hero objects (the sun's shadow map rendered with the scene pass) falling on the ground
float heroShadow(vec3 P){
  if (uShadowK.x < 0.5) return 1.0;
  vec4 s4 = uShadowMat*vec4(P, 1.0); vec3 s = s4.xyz/s4.w;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0 || s.z <= 0.0) return 1.0;
  float acc = 0.0;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
    float dz = dot(texture2D(tShadow, s.xy+vec2(float(i),float(j))*uShadowK.y*uShadowK.z), vec4(5.9371964e-8, 1.5199223e-5, 3.8910506e-3, 0.99609375));
    acc += step(s.z-0.0012, dz);
  }
  return acc/9.0;
}
// detail-texture coordinates for scale slot i, anchored with a double-precision phase so they stay stable
// right under the camera
vec2 duv(int i){ return vRel.xz*0.001*uScale[i]+uPhase[i]; }
// anisotropically filtered detail lookup for slot i with explicit gradients (safe at depth edges)
vec4 dtex(vec2 uv, int i){ return textureGrad(tDetail, uv, gGx*uScale[i], gGy*uScale[i]); }
float terrainSunShadow(vec2 wxz, float h);   // optional hook (cloud shadows); default defined below
${shade}
#ifndef TERRAIN_SHADOW_HOOK
float terrainSunShadow(vec2 wxz, float h){ return 1.0; }
#endif
void main(){
  vec4 sc = texture2D(tScene, vUv);
  float cov = 1.0-sc.a;
  if (cov <= 0.004){ gl_FragColor = vec4(sc.rgb, 1.0); return; }
  float d = texture2D(tDepth, vUv).x;
  if (cov < 0.996 || d >= 0.999999){ // silhouette pixel: use the farthest non-sky neighbour as the ground depth
    vec2 t = 1.0/uRes; float m = d >= 0.999999 ? 0.0 : d, q;
    q = texture2D(tDepth, vUv+vec2(t.x,0.0)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv-vec2(t.x,0.0)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv+vec2(0.0,t.y)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv-vec2(0.0,t.y)).x; if (q < 0.999999) m = max(m,q);
    d = m;
  }
  vec4 q4 = uInvProj*vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 vd = normalize(q4.xyz/q4.w);
  vec3 rd = normalize(uCamRot*vd);
  float dist = viewZ(d)/max(-vd.z, 1e-4);
  vRel = rd*dist;
  vec2 w = uOrigin.xz+vRel.xz;
  vec3 V = -rd;
  float bn = nearW(w);
  // footprint of a pixel on the ground: across the view, and (stretched) along it
  float across = max(dist*uPixAngle, 0.002), stretch = min(1.0/max(V.y,0.02), 12.0);
  vec2 fw = normalize(rd.xz+1e-6);
  gGx = vec2(-fw.y, fw.x)*across*0.001; gGy = fw*across*min(stretch, 5.0)*0.001;
  float fp = across*min(stretch, 5.0);
  float tex = mix(uFar.w, uNear.w, bn);
  float e = max(fp, tex);
  float h0 = hLod(w, e);
  float hE = hLod(w+vec2(e,0.0), e), hW = hLod(w-vec2(e,0.0), e), hS = hLod(w+vec2(0.0,e), e), hN = hLod(w-vec2(0.0,e), e);
  float lap = (hE+hW+hS+hN-4.0*h0)/(e*e);
  vec3 N = normalize(vec3(-(hE-hW)/(2.0*e), 1.0, -(hS-hN)/(2.0*e)));
  vec2 un = (w-uNear.xy)/uNear.z+0.5, uf = (w-uFar.xy)/uFar.z+0.5;
  float ln = log2(max(fp/uNear.w, 1.0)), lf = log2(max(fp/uFar.w, 1.0));
  vec4 m0, m1;
  if (bn >= 1.0){ m0 = textureLod(tM0Near, un, ln); m1 = textureLod(tM1Near, un, ln); }
  else if (bn <= 0.0){ m0 = textureLod(tM0Far, uf, lf); m1 = textureLod(tM1Far, uf, lf); }
  else { m0 = mix(textureLod(tM0Far, uf, lf), textureLod(tM0Near, un, ln), bn); m1 = mix(textureLod(tM1Far, uf, lf), textureLod(tM1Near, un, ln), bn); }
  vec3 alb; float spec = 0.0;
#ifdef TERRAIN_LAYERS
  tFp = fp;
#endif
  shadeTerrain(w*0.001, h0, N, lap, m0, m1, fp, dist, alb, spec);
  N = normalize(N);
  float nl = max(dot(N, uSunDir), 0.0);
  // Oren-Nayar-ish dusty response: flatter, brighter towards grazing light
  float nv = max(dot(N, V), 0.0);
  float s = dot(uSunDir, V)-nl*nv; float tt = s>0.0 ? max(nl,nv) : 1.0;
  float on = nl*(0.84+0.30*s/max(tt,0.05));
  float sh = m0.a*terrainSunShadow(w, h0)*heroShadow(vRel+vec3(0.0, 0.04, 0.0));
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  float ao = clamp(1.0+lap*30.0, 0.55, 1.0);
  vec3 col = alb*0.3183*(uSunGround*max(on,0.0)*sh + amb*ao*(0.55+0.45*N.y));
  { // dry-ground sheen towards the sun at grazing angles
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0);
    float fr = 0.03+0.97*pow(1.0-max(dot(V,Hh),0.0), 5.0);
    col += uSunGround*sh*nl*pow(nh, 10.0)*0.45*fr*0.35*(0.4+alb.g);
  }
#ifdef TERRAIN_LAYERS
  if (tW > 0.0 && tRough >= 0.0){ // photoscanned layers: cavity occlusion and micro-shadowing, GGX specular, rough sky reflection
    float msh = mix(1.0, smoothstep(0.15, 0.95, tAO), 0.55*(1.0-nl));   // cavities lose a grazing sun first
    vec3 cl = alb*0.3183*(uSunGround*max(on,0.0)*sh*msh + amb*ao*tAO*(0.55+0.45*N.y));
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0), vh = max(dot(V,Hh),0.0);
    float a = max(tRough*tRough, 0.03), a2 = a*a, dd = nh*nh*(a2-1.0)+1.0, D = a2/(3.14159*dd*dd);
    float nv2 = max(nv, 0.03);
    // Smith visibility, capped: clods and pebbles shadow and mask far more than a microfacet height field at grazing
    // angles, so rough ground keeps a soft forward sheen instead of a mirror-like glare
    float Vis = min(0.5/(nl*sqrt(nv2*nv2*(1.0-a2)+a2)+nv2*sqrt(nl*nl*(1.0-a2)+a2)+1e-4), mix(4.0, 0.9, smoothstep(0.55, 0.9, tRough)));
    cl += uSunGround*sh*msh*tAO*D*Vis*(tF0+(1.0-tF0)*pow(1.0-vh, 5.0))*nl;
    float fs = tF0+(max(1.0-tRough, tF0)-tF0)*pow(1.0-nv, 5.0);
    cl += mix(skyRefl(reflect(-V, N)), amb*0.3183, tRough*tRough)*fs*tAO*ao;
    col = mix(col, cl, tW);
  }
#endif
  if (spec < 0.0){ // pavement: a broad glossy lobe towards a low sun, and the sky's sheen at grazing angles
    float k = -spec;
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0), vh = max(dot(V,Hh),0.0);
    float fr = 0.04+0.96*pow(1.0-vh, 5.0);
    float a2 = 0.05, dd = nh*nh*(a2-1.0)+1.0, D = a2/(3.14159*dd*dd);
    col += uSunGround*sh*D*fr*min(nl/(4.0*max(nv,0.02)*max(nl,0.02)+0.3), 2.0)*nl*k;
    float fs = pow(1.0-nv, 5.0);
    col = mix(col, skyRefl(reflect(-V, N)), fs*k*0.2);
  }
  if (spec > 0.0){ // open water: mirror of the sky + sun glitter
    vec3 Hh = normalize(uSunDir+V); float nh = max(dot(N,Hh),0.0);
    float fr = 0.02+0.98*pow(1.0-nv, 5.0);
    col = mix(col, skyRefl(reflect(-V, N))*fr+alb*0.02, spec);
    col += spec*uSunGround*pow(nh, 900.0)*40.0*sh;
  }
  if (uDebug == 1) col = vec3(sh);
  else if (uDebug == 2) col = N.xzy*0.5+0.5;
  else if (uDebug == 3) col = alb;
#ifdef TERRAIN_LAYERS
  else if (uDebug == 4) col = vec3(tAO);
  else if (uDebug == 5) col = vec3(nl*4.0);
  else if (uDebug == 6) col = vec3(tRough);
#endif
  gl_FragColor = vec4(sc.rgb+col*cov, 1.0);
}`;

function ringGeometry(cols, rings) {
  const nv = (cols + 1) * rings.length;
  const pos = new Float32Array(nv * 3);
  let k = 0;
  for (let j = 0; j < rings.length; j++) {
    const r = rings[j], sp = j === 0 ? rings[1] - rings[0] : r - rings[j - 1];
    for (let i = 0; i <= cols; i++) { pos[k++] = i / cols - 0.5; pos[k++] = r; pos[k++] = sp; }
  }
  const idx = new Uint32Array(cols * (rings.length - 1) * 6);
  k = 0;
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}
// ring radii: spacing never finer than the far field needs (it grows with distance past ~35 km).
// q (0.4..1) coarsens the grid for small render targets, where the vertex work would otherwise dominate.
function ringsFor(preset, q = 1) {
  const out = []; let r;
  const lin = (to, step) => { while (r < to) { out.push(r); r += step / q; } };
  const geo = (to, k) => { const kk = 1 + (k - 1) / q; while (r < to) { out.push(r); r *= kk; } };
  const grow = (to, step, k) => { while (r < to) { out.push(r); r += Math.max(step, r * k) / q; } };
  if (preset === 'ground') { r = 0; out.push(0); r = 0.6; geo(5000, 1.07); grow(80000, 100, 0.0065); geo(520000, 1.06); }
  else if (preset === 'top') { r = 0; lin(24000, 70); geo(520000, 1.07); }
  else { r = 0; lin(4000, 125); grow(130000, 160, 0.006); geo(520000, 1.045); }
  out.push(r);
  return out;
}

export class Terrain {
  // recipe: { height: glsl (float terrainH(vec2 km, float lodKm)), mask: glsl (void terrainMask(...)), shade: glsl (void shadeTerrain(...)),
  //           scales: detail slots, near: {center:[xkm,zkm], extent km, res}, far: {center, extent, res}, groundAlt,
  //           uniforms: extra uniforms for the shading pass, defines: GLSL prepended to it }
  constructor(pipe, recipe) {
    this.pipe = pipe; this.recipe = recipe;
    const mk = (res, type, fmt, mip) => {
      const t = new THREE.WebGLRenderTarget(res, res, { type, format: fmt, depthBuffer: false, generateMipmaps: mip, minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter });
      t.texture.anisotropy = type === THREE.FloatType ? 1 : Math.min(4, pipe.maxAniso); return t;
    };
    const lvl = (cfg) => ({ cfg, h: mk(cfg.res, THREE.FloatType, THREE.RedFormat, true), m0: mk(cfg.res, THREE.UnsignedByteType, THREE.RGBAFormat, true), m1: mk(cfg.res, THREE.UnsignedByteType, THREE.RGBAFormat, true) });
    this.near = lvl(recipe.near); this.far = lvl(recipe.far);
    this.pH = new Pass(BAKE_H(recipe.height), { uCenter: { value: new THREE.Vector2() }, uExtent: { value: 1 }, uTexel: { value: 1 } });
    this.pM = new Pass(BAKE_M(recipe.height + '\n' + recipe.mask), { tH: { value: null }, uCenter: { value: new THREE.Vector2() }, uExtent: { value: 1 }, uTexel: { value: 1 }, uRes: { value: 1 }, uSunDir: pipe.atmo.uniforms.uSunDir, uWhich: { value: 0 } });
    const S = pipe.shared;
    const heights = this.heightUniforms = { tHNear: { value: this.near.h.texture }, tHFar: { value: this.far.h.texture }, uNear: { value: new THREE.Vector4() }, uFar: { value: new THREE.Vector4() } };
    this.uniforms = {
      ...heights,
      tScene: { value: null }, tDepth: S.tDepth, uLogFar: S.uLogFar, uInvProj: S.uInvProj, uCamRot: S.uCamRot, uRes: S.uRes,
      tM0Near: { value: this.near.m0.texture }, tM0Far: { value: this.far.m0.texture },
      tM1Near: { value: this.near.m1.texture }, tM1Far: { value: this.far.m1.texture },
      tDetail: S.tDetail, tAmbient: S.tAmbient, uOrigin: S.uOrigin, uSunDir: S.uSunDir, uTime: S.uTime, tSky: S.tSky, uMieG: pipe.atmo.uniforms.uMieG,
      uSunGround: { value: new THREE.Color() }, uDebug: { value: 0 }, uPixAngle: { value: 0.001 },
      tShadow: { value: pipe.white }, uShadowMat: { value: new THREE.Matrix4() }, uShadowK: { value: new THREE.Vector3(0, 1 / 2048, 1.3) },
      uPhase: { value: Array.from({ length: 12 }, () => new THREE.Vector2()) },
      uScale: { value: Array.from({ length: 12 }, (_, i) => { const v = (recipe.scales || [])[i] ?? 1; return Array.isArray(v) ? new THREE.Vector2(v[0], v[1]) : new THREE.Vector2(v, v); }) },
      ...(recipe.uniforms || {}),
    };
    this.meshUniforms = { ...heights, uOrigin: S.uOrigin, uYaw: { value: 0 }, uSector: { value: Math.PI * 2 }, logDepthBufFC: { value: 2 / (Math.log(pipe.quality.far + 1) / Math.LN2) } };
    this.material = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG, uniforms: this.meshUniforms });
    // optional photoscanned layers: the film awaits terrain.ready before its first frame
    const L = this.layers = recipe.layers && recipe.layers.length ? recipe.layers : null;
    if (L) {
      Object.assign(this.uniforms, {
        tLayerA: { value: null }, tLayerB: { value: null },
        uLayerK: { value: L.map(l => new THREE.Vector4(1 / l.scale, l.rotate ?? 1, l.sharp ?? 6, l.hcontrast ?? 5)) },
        uLayerP: { value: L.map(() => new THREE.Vector4()) }, uLayerI: { value: new Int32Array(L.length * 2) },
        uLayerMA: { value: L.map(() => new THREE.Vector4(0.3, 0.3, 0.3, 0.5)) }, uLayerMB: { value: L.map(() => new THREE.Vector4(0.5, 0.5, 0.85, 1)) },
      });
    }
    this.shadePass = new Pass(SHADE_FRAG((L ? LAYERS_GLSL(L.map(l => l.name)) : '') + (recipe.defines || '') + recipe.shade), this.uniforms);
    this.ready = L ? this.loadLayers(L) : Promise.resolve(this);
    this.geos = {};
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false; this.mesh.layers.set(LAYER.STATIC); this.mesh.matrixAutoUpdate = false;
    pipe.scene.add(this.mesh);
    pipe.deferred.push(this);
    this.bakedSun = new THREE.Vector3();
  }
  // decode every layer's textures and pack them on the GPU into the two mipmapped texture arrays
  async loadLayers(L) {
    const pipe = this.pipe, r = pipe.renderer, n = L.length, S = this.recipe.layerSize || 1024;
    const mk = srgb => {
      const t = new THREE.WebGLArrayRenderTarget(S, S, n, { depthBuffer: false }), x = t.texture;
      x.format = THREE.RGBAFormat; x.type = THREE.UnsignedByteType; x.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      x.wrapS = x.wrapT = THREE.RepeatWrapping; x.magFilter = THREE.LinearFilter; x.minFilter = THREE.LinearMipmapLinearFilter;
      x.generateMipmaps = false;   // three.js would bind the array as TEXTURE_2D; mipmaps are generated below
      x.anisotropy = Math.min(this.recipe.layerAniso ?? 2, pipe.maxAniso);
      return t;
    };
    const A = this.layerA = mk(true), B = this.layerB = mk(false);
    B.texture.anisotropy = 1;   // normals, roughness, occlusion: trilinear is enough (and far cheaper on a software rasteriser)
    const tex = (name, srgb) => name ? loadTexture(name, pipe, { srgb, mips: false, aniso: 1 }) : Promise.resolve(null);
    const src = await Promise.all(L.map(l => Promise.all([tex(l.albedo, true), tex(l.normal, false), tex(l.orm, false)])));
    const pack = new Pass(PACK_FRAG, { tAlb: { value: null }, tNrm: { value: null }, tOrm: { value: null }, uHas: { value: new THREE.Vector4() }, uWhich: { value: 0 } });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), u = pack.u;
    src.forEach(([a, nm, o], k) => {
      const pair = !!nm && nm.image.width === 2 * nm.image.height;
      u.tAlb.value = a; u.tNrm.value = nm || a; u.tOrm.value = o || a;
      u.uHas.value.set(nm ? 1 : 0, pair ? 1 : 0, o ? 1 : 0, nm ? 0.5 / (pair ? nm.image.height : nm.image.width) : 0);
      u.uWhich.value = 0; r.setRenderTarget(A, k); r.render(pack.mesh, cam);
      u.uWhich.value = 1; r.setRenderTarget(B, k); r.render(pack.mesh, cam);
    });
    r.setRenderTarget(null);
    const gl = r.getContext();
    for (const t of [A, B]) { r.state.bindTexture(gl.TEXTURE_2D_ARRAY, r.properties.get(t.texture).__webglTexture); gl.generateMipmap(gl.TEXTURE_2D_ARRAY); r.state.unbindTexture(); }
    for (const s of src) for (const t of s) if (t) { t.image.close?.(); t.dispose(); }
    pack.material.dispose();
    // each layer's mean from its 1x1 mip, read back once, so shaders get it as a uniform instead of a texture tap
    const mean = new THREE.WebGLRenderTarget(n, 2, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const mp = new Pass(`precision highp float; precision highp sampler2DArray; uniform sampler2DArray tA, tB; uniform float uN; varying vec2 vUv;
      void main(){ float k = floor(vUv.x*uN); gl_FragColor = vUv.y < 0.5 ? textureLod(tA, vec3(0.5, 0.5, k), 14.0) : textureLod(tB, vec3(0.5, 0.5, k), 14.0); }`,
    { tA: { value: A.texture }, tB: { value: B.texture }, uN: { value: n } });
    mp.render(r, mean);
    const px = new Float32Array(n * 2 * 4); r.readRenderTargetPixels(mean, 0, 0, n, 2, px); r.setRenderTarget(null);
    for (let k = 0; k < n; k++) { this.uniforms.uLayerMA.value[k].fromArray(px, k * 4); this.uniforms.uLayerMB.value[k].fromArray(px, (n + k) * 4); }
    mean.dispose(); mp.material.dispose();
    this.uniforms.tLayerA.value = A.texture; this.uniforms.tLayerB.value = B.texture;
    return this;
  }
  // deferred hook: called by the pipeline after the opaque scene pass
  shade(renderer, sceneTex, target) {
    if (!this.mesh.visible) return false;
    this.uniforms.tScene.value = sceneTex;
    const sh = this.pipe.sun.shadow, U = this.uniforms;
    if (this.pipe.sun.castShadow && sh.map && this.heroShadows !== false) { U.tShadow.value = sh.map.texture; U.uShadowMat.value.copy(sh.matrix); U.uShadowK.value.set(1, 1 / sh.mapSize.x, 1.3); }
    else U.uShadowK.value.x = 0;
    this.shadePass.render(renderer, target);
    return true;
  }
  bakeLevel(L, masksOnly) {
    const r = this.pipe.renderer, c = L.cfg, tex = c.extent / c.res;
    if (!masksOnly) {
      const u = this.pH.u; u.uCenter.value.set(c.center[0], c.center[1]); u.uExtent.value = c.extent; u.uTexel.value = tex;
      this.pH.render(r, L.h);
    }
    const m = this.pM.u; m.tH.value = L.h.texture; m.uCenter.value.set(c.center[0], c.center[1]); m.uExtent.value = c.extent; m.uTexel.value = tex; m.uRes.value = c.res;
    m.uWhich.value = 0; this.pM.render(r, L.m0);
    m.uWhich.value = 1; this.pM.render(r, L.m1);
    const U = L === this.near ? this.uniforms.uNear : this.uniforms.uFar;
    U.value.set(c.center[0] * 1000, c.center[1] * 1000, c.extent * 1000, tex * 1000);
  }
  // (re)bake; cheap to call every frame — only re-renders the sun-dependent masks when the sun has moved
  bake() {
    const sun = this.pipe.atmo.sunDir;
    if (!this.baked) { this.bakeLevel(this.far, false); this.bakeLevel(this.near, false); this.baked = true; this.bakedSun.copy(sun); this.pipe.renderer.setRenderTarget(null); return; }
    if (this.bakedSun.distanceTo(sun) > 0.004) { this.bakeLevel(this.far, true); this.bakeLevel(this.near, true); this.bakedSun.copy(sun); this.pipe.renderer.setRenderTarget(null); }
  }
  // preset: 'air' | 'ground' | 'top'
  update(preset = 'air') {
    const pipe = this.pipe, cam = pipe.camera, mu = this.meshUniforms;
    this.bake();
    const full = preset === 'top';
    // grid density follows the render size: about one column per 3.4 px, rings to match
    const q = Math.min(1, Math.max(0.4, pipe.h / 1080)), cols = Math.round((full ? 768 : (preset === 'ground' ? 560 : 448)) * Math.min(1, Math.max(0.35, pipe.w / 1920)) / 8) * 8, gk = `${preset}:${cols}:${q.toFixed(2)}`;
    if (!this.geos[gk]) this.geos[gk] = ringGeometry(cols, ringsFor(preset, q));
    this.mesh.geometry = this.geos[gk];
    pipe.atmo.sunIrradiance(this.recipe.groundAlt ?? 1400, this.uniforms.uSunGround.value);
    this.uniforms.uPixAngle.value = 2 * Math.tan(cam.fov * Math.PI / 360) / pipe.h;
    mu.logDepthBufFC.value = 2 / (Math.log(cam.far + 1) / Math.LN2);
    const sc = this.uniforms.uScale.value, ph = this.uniforms.uPhase.value, o = pipe.origin;
    for (let i = 0; i < 12; i++) { const ax = o.x * 0.001 * sc[i].x, az = o.z * 0.001 * sc[i].y; ph[i].set(ax - Math.floor(ax), az - Math.floor(az)); }
    if (this.layers) { // hex-lattice anchors in double precision: cell ids stay fixed to the world under a moving camera
      const K = this.uniforms.uLayerK.value, P = this.uniforms.uLayerP.value, I = this.uniforms.uLayerI.value, fr = x => x - Math.floor(x);
      for (let k = 0; k < this.layers.length; k++) {
        const s = K[k].x, ux = o.x * s, uy = -o.z * s, sx = ux * HEXS, sy = (-0.57735027 * ux + 1.15470054 * uy) * HEXS;
        const ix = Math.floor(sx), iy = Math.floor(sy);
        P[k].set(sx - ix, sy - iy, fr(ix / HEXS), fr((0.5 * ix + 0.8660254 * iy) / HEXS)); I[2 * k] = ix; I[2 * k + 1] = iy;
      }
    }
    if (full) { mu.uYaw.value = 0; mu.uSector.value = Math.PI * 2; return; }
    // azimuth sector covering the view frustum
    cam.updateMatrixWorld();
    const f = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    const yaw = Math.atan2(f.z, f.x);
    const t = Math.tan(cam.fov * Math.PI / 360), a = cam.aspect;
    let lo = 0, hi = 0, steep = false;
    const v = new THREE.Vector3();
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      v.set(x * t * a, y * t, -1).normalize().transformDirection(cam.matrixWorld);
      if (Math.hypot(v.x, v.z) < 0.12) { steep = true; continue; }
      let d = Math.atan2(v.z, v.x) - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      lo = Math.min(lo, d); hi = Math.max(hi, d);
    }
    if (steep || hi - lo > 2.6 || Math.hypot(f.x, f.z) < 0.25) { mu.uYaw.value = 0; mu.uSector.value = Math.PI * 2; }
    else { const half = Math.max(-lo, hi) * 1.12 + 0.03; mu.uYaw.value = yaw; mu.uSector.value = half * 2; }
  }
}
