// Sea surface. A camera-centred polar grid displaced by a deterministic sum of trochoidal waves is drawn
// depth-only; one full-screen pass then lights every sea pixel from the depth buffer: analytic wave slopes
// plus scrolling detail normals (filtered by pixel footprint, with what is filtered out folded into
// roughness), Fresnel reflection of the sky table with the cloud layer in it, a planar reflection of nearby
// geometry, cloud and hull shadows, sun glitter that breaks into moving glints, whitecaps where crests
// pinch, and foam from a top-down wake map. Sea level is world y = 0. Everything is a pure function of time.
import * as THREE from 'three';
import { NOISE, ATMOSPHERE, DEPTH } from './glsl.js';
import { LAYER, RG, Pass } from './pipeline.js';
import { CLOUD_COVER } from './clouds.js';

const NW = 14, NS = 8, G = 9.81;

const WAVES = /* glsl */`
#define NW ${NW}
uniform vec4 uWA[NW];   // dir.x, dir.z, wavenumber, amplitude
uniform vec2 uWB[NW];   // angular frequency, phase
uniform float uTime, uChop;
uniform vec4 uCalm;     // sheltered water: centre x, z, inner radius, outer radius
uniform float uCalmK;   // wave amplitude factor inside the inner radius (1 = no shelter)
float shelter(vec2 w){ return mix(uCalmK, 1.0, smoothstep(uCalm.z, uCalm.w, length(w-uCalm.xy))); }
`;

// depth-only geometry; log depth per vertex (triangles are small) keeps early-Z
const OCEAN_VERT = /* glsl */`
${WAVES}
uniform float uYaw, uSector, logDepthBufFC; uniform vec3 uOrigin;
void main(){
  float az = uYaw+position.x*uSector; vec2 d = vec2(cos(az), sin(az)); float r = position.y, sp = position.z;
  vec2 w = uOrigin.xz+d*r;
  vec3 disp = vec3(0.0);
  for (int i=0;i<NW;i++){
    vec4 A = uWA[i]; vec2 B = uWB[i];
    float att = clamp(1.0-sp*A.z*0.53, 0.0, 1.0);          // fade waves the grid cannot resolve
    float ph = dot(A.xy, w)*A.z-B.x*uTime+B.y;
    disp.y += A.w*sin(ph)*att;
    disp.xz += A.xy*(A.w*cos(ph)*att*uChop);
  }
  disp *= shelter(w);
  vec3 p = vec3(d.x*r+disp.x, disp.y-uOrigin.y-r*r/(2.0*${RG.toFixed(1)}), d.y*r+disp.z);
  gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
  gl_Position.z = (log2(max(1e-6, 1.0+gl_Position.w))*logDepthBufFC-1.0)*gl_Position.w;
}`;
const OCEAN_DEPTH_FRAG = /* glsl */`
void main(){ gl_FragColor = vec4(0.0); }   // alpha 0 marks "sea here" for the shading pass
`;

// full-screen lighting pass: scene.rgb + sea * (1 - scene.a)
const OCEAN_FRAG = /* glsl */`
precision highp float;
${NOISE}
${ATMOSPHERE}
${DEPTH}
${WAVES}
#define NS ${NS}
uniform sampler2D tScene, tDepth, tSky, tAmbient, tDetail, tWavelet, tRefl, tReflDepth, tWake, tShadow;
uniform mat4 uInvProj, uReflVP, uShadowMat; uniform mat3 uCamRot;
uniform vec4 uWakeRegion; uniform vec3 uOrigin, uSunColor, uWaterCol, uFoamCol, uShadowK; uniform vec2 uRes;
uniform float uPixAngle, uReflOn, uFogK, uDetailAmp, uGlitter, uThermal, uSparkle, uWhitecap, uSlick; uniform int uShadeWaves;
uniform vec4 uBandAmp;    // rms slope of the four short-wave bands
uniform vec3 uCloudK;     // cloud layer for reflections and shadows: mid altitude (m), shadow strength, reflection strength
uniform vec2 uPh[NS]; uniform float uSc[NS];
${CLOUD_COVER}
varying vec2 vUv;
vec3 vRel; vec2 gGx, gGy;     // camera-relative position (m); pixel footprint axes on the water (m)
uniform vec4 uRot[NS];        // per-band rotation and stretch of the detail coordinates (2x2 matrix)
vec2 duv(int i){ vec4 m = uRot[i]; vec2 p = vRel.xz*uSc[i]; return vec2(dot(m.xy, p), dot(m.zw, p))+uPh[i]; }
vec4 dtexR(vec2 uv, int i){ vec4 m = uRot[i]; vec2 gx = gGx*uSc[i], gy = gGy*uSc[i]; return textureGrad(tDetail, uv, vec2(dot(m.xy, gx), dot(m.zw, gx)), vec2(dot(m.xy, gy), dot(m.zw, gy))); }
// unit-rms slope of the wavelet map for band i (its mip chain filters what the pixel cannot resolve)
vec2 wslope(int i){ vec4 m = uRot[i]; vec2 gx = gGx*uSc[i], gy = gGy*uSc[i]; return (textureGrad(tWavelet, duv(i), vec2(dot(m.xy, gx), dot(m.zw, gx)), vec2(dot(m.xy, gy), dot(m.zw, gy))).rg-0.5)*6.0; }
// slope contribution of a detail band, rotated back into world axes
vec2 bandSlope(int i, vec2 ch){ vec4 m = uRot[i]; return vec2(m.x*ch.x+m.z*ch.y, m.y*ch.x+m.w*ch.y); }
float h21(vec2 p){ p = fract(p*vec2(0.1031, 0.1030)); p += dot(p, p.yx+33.33); return fract((p.x+p.y)*p.y); }
// glints: a sparse set of bright facets on a world-anchored grid whose cell size follows the pixel footprint,
// so they neither alias in the distance nor smear up close; each cell twinkles on its own clock
float glints(vec2 w, float fp, float t){
  float l = log2(max(fp*1.6, 0.004)), l0 = floor(l), f = l-l0, acc = 0.0;
  for (int k=0;k<2;k++){
    float cell = exp2(l0+float(k));
    vec2 q = w/cell, id = floor(q), u = fract(q)-0.5;
    float r = h21(id+float(k)*17.0), ph = h21(id*1.7+3.1);
    float tw = fract(t*(1.5+3.0*r)+ph*7.0), on = smoothstep(0.0, 0.25, tw)*(1.0-smoothstep(0.35, 0.9, tw));
    float g = step(0.80, r)*on*smoothstep(0.5, 0.15, length(u))*14.0;
    acc += g*(k == 0 ? 1.0-f : f);
  }
  return acc;
}
vec4 dtex(vec2 uv, int i){ return dtexR(uv, i); }
vec3 skyRad(vec3 d){
  vec2 uv = skyUV(d); float v = clamp(uv.y, 0.004, 0.996); float cv = dot(d, uSunDir);
  return textureLod(tSky, vec2(uv.x,(v+0.0)/3.0), 0.0).rgb*phaseR(cv)
       + textureLod(tSky, vec2(uv.x,(v+1.0)/3.0), 0.0).rgb*min(phaseM(cv), 9.0)
       + textureLod(tSky, vec2(uv.x,(v+2.0)/3.0), 0.0).rgb;
}
// mean Fresnel reflectance of a rough sea (Bruneton & Neyret)
float meanFresnel(float cosV, float sigma){ return pow(1.0-cosV, 5.0*exp(-2.69*sigma))/(1.0+22.7*pow(sigma, 1.5)); }
// shadow of the hero objects (the sun's shadow map) on the water
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
void main(){
  vec4 sc = texture2D(tScene, vUv);
  float cov = 1.0-sc.a;
  if (cov <= 0.004){ gl_FragColor = vec4(sc.rgb, 1.0); return; }
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.999999){ gl_FragColor = sc; return; }   // this sample sees sky: the atmosphere pass fills what is uncovered
  if (cov < 0.996){ // silhouette pixel: use the farthest non-sky neighbour as the water depth
    vec2 t = 1.0/uRes; float m = d >= 0.999999 ? 0.0 : d, q;
    q = texture2D(tDepth, vUv+vec2(t.x,0.0)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv-vec2(t.x,0.0)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv+vec2(0.0,t.y)).x; if (q < 0.999999) m = max(m,q);
    q = texture2D(tDepth, vUv-vec2(0.0,t.y)).x; if (q < 0.999999) m = max(m,q);
    d = m;
  }
  vec4 q4 = uInvProj*vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 vd = normalize(q4.xyz/q4.w), rd = normalize(uCamRot*vd);
  float dist = viewZ(d)/max(-vd.z, 1e-4);
  vRel = rd*dist;
  vec2 vW = uOrigin.xz+vRel.xz;
  vec3 V = -rd;
  float across = max(dist*uPixAngle, 0.0005), stretch = min(1.0/max(V.y, 0.02), 14.0);
  vec2 fw = normalize(rd.xz+1e-6);
  gGx = vec2(-fw.y, fw.x)*across; gGy = fw*across*stretch;
  float fp = across*min(stretch, 9.0);            // pixel footprint along the line of sight (m)

  // wind streaks and slicks: slow, large patches where the small waves are damped or roughened
  float slick = dtex(duv(5), 5).r; float sl2 = dtex(duv(5)*3.7+0.31, 5).g;
  float calm = 1.0-uSlick*smoothstep(0.52, 0.78, slick*0.7+sl2*0.3);

  // resolved wave slopes, plus the slope variance of everything too fine to resolve
  vec2 slope = vec2(0.0); float var = 0.0, pinch = 0.0;
  for (int i=0;i<NW;i++){
    if (i >= uShadeWaves) break;
    vec4 A = uWA[i]; vec2 B = uWB[i];
    float att = clamp(1.0-fp*A.z*0.32, 0.0, 1.0);
    float ka = A.z*A.w*(i >= 8 ? calm : 1.0);
    if (att <= 0.0){ var += 0.5*ka*ka; continue; }   // too fine for this pixel: it only roughens the surface
    float ph = dot(A.xy, vW)*A.z-B.x*uTime+B.y;
    slope += A.xy*(ka*cos(ph)*att);
    pinch += ka*sin(ph)*att;                          // sum of k a sin: crests pinch where this is large
    var += 0.5*ka*ka*(1.0-att*att);
  }
  { float sk = shelter(vW); slope *= sk; pinch *= sk; var *= sk*sk; }
  // short wind waves: four scales of the wavelet map (rms slope each). The texture's mip chain averages away
  // what the pixel cannot resolve; "res" estimates the share of each band's slope variance still resolved
  // (its spectrum spans about four octaves) so the rest goes into roughness.
  vec4 amp = uBandAmp*uDetailAmp*vec4(1.0, 1.0, calm, calm);
  vec4 res = clamp(1.0-log2(max(across*vec4(uSc[0], uSc[1], uSc[2], uSc[6])*96.0, 1.0))/4.0, 0.0, 1.0);
  if (res.x > 0.0) slope += bandSlope(0, wslope(0))*amp.x;
  if (res.y > 0.0) slope += bandSlope(1, wslope(1))*amp.y;
  if (res.z > 0.0) slope += bandSlope(2, wslope(2))*amp.z;
  if (res.w > 0.0) slope += bandSlope(6, wslope(6))*amp.w;
  var += dot(amp*amp, 1.0-res)+0.0004*calm;

  // wake map: r foam, g bow-wave ridge, b churned water
  float foam = 0.0, churn = 0.0;
  if (uWakeRegion.w > 0.5){
    vec2 wuv = (vW-uWakeRegion.xy)/uWakeRegion.z+0.5;
    if (wuv.x > 0.002 && wuv.y > 0.002 && wuv.x < 0.998 && wuv.y < 0.998){
      float wl = clamp(log2(fp/uWakeRegion.z*1024.0), 0.0, 6.0);
      vec4 wk = textureLod(tWake, wuv, wl);
      float e = 1.5/1024.0;
      float gx = textureLod(tWake, wuv+vec2(e,0.0), wl).g-textureLod(tWake, wuv-vec2(e,0.0), wl).g;
      float gz = textureLod(tWake, wuv+vec2(0.0,e), wl).g-textureLod(tWake, wuv-vec2(0.0,e), wl).g;
      slope += vec2(gx, gz)*(170.0/uWakeRegion.z)*clamp(1.0-fp*0.15, 0.0, 1.0);
      vec4 fn = dtex(duv(3), 3); float fn2 = dtex(duv(4), 4).r;
      // foam is lace: bright along the walls between bubble cells (far from the cellular feature points), at
      // two cell sizes, broken up by fBm; fresh white water fills in, old foam thins to the walls alone
      float c1 = dtex(duv(4)*1.7+0.21, 4).b, c2 = dtex(duv(3)*2.9+0.57, 3).b;
      float lace = max(smoothstep(0.34, 0.56, c1), 0.75*smoothstep(0.38, 0.6, c2));
      float n = clamp(lace*0.7+fn.r*0.45+0.3*(fn2-0.5), 0.0, 1.0);
      n = mix(n, 0.55, clamp(fp*0.5, 0.0, 1.0));
      foam = smoothstep(1.0-wk.r*1.08, 1.0-wk.r*1.08+0.16, n);
      foam = max(foam, smoothstep(0.94, 1.0, wk.r)*(0.7+0.3*lace));
      foam = mix(foam, smoothstep(0.2, 0.8, wk.r)*0.85, clamp(fp*0.6-0.2, 0.0, 1.0));   // too far to resolve the lace: an even white
      churn = wk.b*(0.55+0.9*fn.r);
      var += churn*0.03;                                 // aerated water is matt: no glitter in the wash
    }
  }
  // whitecaps: crests about to fold over, broken up into streaks along the wind
  if (uWhitecap > 0.0 && pinch*uChop > uWhitecap-0.2){
    float wn = dtex(duv(3)*0.61+0.17, 3).r*0.6+dtex(duv(4)*0.5, 4).b*0.4;
    float wc = smoothstep(uWhitecap, uWhitecap+0.16, pinch*uChop+0.22*(wn-0.5)+0.10*(slick-0.5));
    wc *= smoothstep(0.35, 0.6, wn+wc*0.3)*clamp(1.0-fp*0.02, 0.25, 1.0);
    foam = max(foam, wc*0.9);
  }
  vec3 N = normalize(vec3(-slope.x, 1.0-uChop*pinch*0.6, -slope.y));
  float sigma = sqrt(max(var, 1.0e-5));
  float NV = max(dot(N, V), 0.02);
  float F = 0.02+0.98*meanFresnel(NV, sigma);

  // light reaching the water: cloud shadows and the shadows of nearby hulls
  float shadow = heroShadow(vRel+vec3(0.0, 0.05, 0.0));
  if (uCloudK.y > 0.0){
    vec2 cq = vW+uSunDir.xz*(uCloudK.x/max(uSunDir.y, 0.05));
    shadow *= 1.0-uCloudK.y*smoothstep(0.3, 0.85, cloudCoverL(cq, 0.5));
  }

  // reflected sky; rough water at grazing angles sees sky from higher up than the mirror direction
  vec3 R = reflect(-V, N);
  R.y = abs(R.y)+sigma*1.1*(1.0-NV)+0.003; R = normalize(R);
  vec3 refl = skyRad(R);
  vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb;
  if (uCloudK.z > 0.0){   // the cloud layer, seen in the water
    float tc = uCloudK.x/max(R.y, 0.03);
    if (tc < 90000.0){
      float cc = smoothstep(0.32, 0.8, cloudCoverL(vW+R.xz*tc, 1.0+clamp(sigma*8.0, 0.0, 2.0)));
      float cs = max(dot(R, uSunDir), 0.0);
      vec3 cloudCol = uSunColor*(0.035+0.10*pow(cs, 6.0)+0.05*(1.0-cs))+amb*0.21;
      refl = mix(refl, cloudCol, cc*uCloudK.z*exp(-tc*uFogK*0.5));
    }
  }
  if (uReflOn > 0.5){
    // planar reflection: project a point along the reflected ray into the mirrored camera
    float L = 3.0+dist*0.25;
    vec3 Rg = reflect(-V, normalize(vec3(-slope.x*0.6, 1.0, -slope.y*0.6)));
    vec4 rc = uReflVP*vec4(vRel+Rg*L, 1.0);
    vec2 ruv = rc.xy/rc.w*0.5+0.5;
    if (rc.w > 0.0 && ruv.x > 0.0 && ruv.y > 0.0 && ruv.x < 1.0 && ruv.y < 1.0){
      vec2 rt = 2.5/vec2(textureSize(tRefl, 0));
      vec4 pr = (textureLod(tRefl, ruv+vec2(rt.x, 0.0), 0.0)+textureLod(tRefl, ruv-vec2(rt.x, 0.0), 0.0)+textureLod(tRefl, ruv+vec2(0.0, rt.y), 0.0)+textureLod(tRefl, ruv-vec2(0.0, rt.y), 0.0))*0.25;
      pr.a *= 0.75*exp(-sigma*5.0);
      float dz = textureLod(tReflDepth, ruv, 0.0).x;
      float rdist = dz >= 0.999999 ? 0.0 : viewZ(dz);
      float T = exp(-uFogK*rdist);
      float edge = smoothstep(0.0, 0.03, min(min(ruv.x, ruv.y), min(1.0-ruv.x, 1.0-ruv.y)));
      refl = mix(refl, pr.rgb, pr.a*T*edge);
    }
  }
  float sunUp = max(uSunDir.y, 0.0);
  vec3 body = uWaterCol*0.3183*(uSunColor*sunUp*shadow+amb);
  body = mix(body, vec3(0.20, 0.38, 0.36)*0.3183*(uSunColor*sunUp*shadow+amb), clamp(churn*0.7, 0.0, 0.75));   // aerated water: pale turquoise
  // light scattered forward through thin crests when looking up-sun
  float crest = clamp(dot(slope, -normalize(uSunDir.xz+1e-5))*2.2, 0.0, 1.0);
  body += vec3(0.02, 0.09, 0.075)*uSunColor*shadow*0.3183*crest*pow(max(dot(-V, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
  vec3 col = mix(body, refl, F);

  // sun glitter: a microfacet lobe whose width follows the unresolved slope variance, broken into glints
  vec3 Hh = normalize(uSunDir+V);
  float NH = max(dot(N, Hh), 0.0);
  float a2 = clamp(2.0*var, 0.0007, 0.25);
  float dd = NH*NH*(a2-1.0)+1.0;
  float Dg = a2/(3.14159265*dd*dd);
  float Fh = 0.02+0.98*pow(1.0-max(dot(V, Hh), 0.0), 5.0);
  float vis = clamp(dot(N, uSunDir)*6.0, 0.0, 1.0)*smoothstep(-0.01, 0.03, uSunDir.y);
  float glint = 1.0;
  if (uSparkle > 0.0) glint = mix(1.0, 0.35+glints(vW, across, uTime), uSparkle);
  vec3 gl = uSunColor*uGlitter*min(Dg*Fh/(4.0*max(NV, 0.1)), 220.0)*vis*shadow*glint;
  col += gl*min(1.0, 2.0e4/max(max(gl.r, max(gl.g, gl.b)), 1e-6));   // glints stay inside half-float range

  // foam: diffuse, lit by sun and sky
  float fl = max(dot(N, uSunDir), 0.0)*0.8+sunUp*0.2;
  vec3 foamC = uFoamCol*0.3183*(uSunColor*fl*shadow+amb);
  col = mix(col, foamC, clamp(foam, 0.0, 1.0));
  col += uThermal*vec3(1.0)*(foam*0.9+churn*0.12);   // disturbed water reads warm in the simulated IR view
  gl_FragColor = vec4(sc.rgb+col*cov, 1.0);
}`;

const WAKE_VERT = /* glsl */`
uniform vec3 uRegion; attribute vec4 aDat; varying vec4 vDat; varying float vType;
void main(){ vDat = aDat; vType = position.z; gl_Position = vec4((position.xy-uRegion.xy)/uRegion.z*2.0, 0.0, 1.0); }`;
const WAKE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tDetail; varying vec4 vDat; varying float vType;
void main(){
  vec4 o = vec4(0.0, 0.5, 0.0, 1.0);
  float k = vDat.w;
  if (vType < 0.5){            // propulsion wash: x lateral -1..1, y age 0..1, z distance along track
    float ax = abs(vDat.x), prof = max(1.0-ax*ax, 0.0);
    float n = texture2D(tDetail, vec2(vDat.z*0.035, vDat.x*0.33+0.5)).r, n2 = texture2D(tDetail, vec2(vDat.z*0.16, vDat.x*1.1)).g;
    float fresh = exp(-vDat.y*30.0);                                          // boiling white water off the transom
    float edge = smoothstep(0.5, 0.82, ax)*(1.0-smoothstep(0.9, 1.0, ax));    // the two bright shoulders of the wake
    float core = 1.0-smoothstep(0.0, 0.8, ax);
    o.r = (fresh*pow(prof, 0.4)*1.15+edge*exp(-vDat.y*8.0)*(0.25+0.8*n)+core*exp(-vDat.y*16.0)*(0.15+1.1*n*n2*2.0))*k*0.85;
    o.b = pow(prof, 0.8)*exp(-vDat.y*2.2)*k;
  } else if (vType < 1.5){     // bow-wave arm
    float prof = max(1.0-vDat.x*vDat.x, 0.0);
    float n = texture2D(tDetail, vec2(vDat.z*0.11, vDat.x*0.4)).g;
    o.r = pow(prof, 1.3)*exp(-vDat.y*5.0)*(0.6+0.8*n)*k;
    o.g = 0.5+0.5*prof*exp(-vDat.y*2.4)*k;
  } else {                     // disc: xy in -1..1, z age 0..1 — white water that opens into a spreading ring
    float r = length(vDat.xy); if (r > 1.0) discard;
    float n = texture2D(tDetail, vDat.xy*0.37+vDat.z*0.2).r;
    float hole = smoothstep(0.15, 0.95, vDat.z)*0.92;
    float ring = smoothstep(hole-0.25, hole, r)*(1.0-smoothstep(0.78, 1.0, r));
    o.r = ring*(1.0-vDat.z*vDat.z)*(0.55+0.9*n)*k;
    o.b = (1.0-r)*(1.0-vDat.z)*k;
    o.g = 0.5+0.5*smoothstep(0.7, 0.9, r)*(1.0-smoothstep(0.9, 1.0, r))*(1.0-vDat.z)*k;
  }
  gl_FragColor = clamp(o, 0.0, 1.0);
}`;

// Tileable slope map of short wind waves: many sharp-crested wavelets with whole-number wave vectors (so the
// tile repeats), travelling within a spread about +x. r,g = slope along x,y scaled to unit rms (0.5 = flat,
// one unit = 1/6); b = height. Sampled at several scales and rotations to give the surface its fine facets.
export function makeWaveletTexture(aniso = 8, N = 512) {
  const rnd = (() => { let s = 20260712; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const waves = [];
  for (let i = 0; i < 72; i++) {
    const k = 3 * Math.pow(16, (i + rnd()) / 72);                                // 3 .. 48 cycles per tile, even per octave
    const th = (rnd() + rnd() + rnd() - 1.5) * 1.5 + (i % 6 === 3 ? (rnd() < 0.5 ? 1.5 : -1.5) : 0);   // spread about +x, some cross waves
    const kx = Math.round(k * Math.cos(th)), ky = Math.round(k * Math.sin(th)), kk = Math.hypot(kx, ky);
    if (kk < 2.5) continue;
    waves.push({ kx, ky, a: Math.pow(kk, -1.35) * (0.7 + 0.6 * rnd()), ph: rnd() * 6.2831853, p: 0.55 + 0.35 * rnd() });
  }
  const h = new Float32Array(N * N), cx = new Float32Array(N), sx = new Float32Array(N);
  for (const w of waves) {
    // crest profile: a cusp at the crest, a round trough (1 - 2|sin(t/2)|^p), evaluated per row
    for (let y = 0; y < N; y++) {
      const base = 6.2831853 * w.ky * y / N + w.ph, o = y * N;
      for (let x = 0; x < N; x++) { const t = 6.2831853 * w.kx * x / N + base; h[o + x] += w.a * (1 - 2 * Math.pow(Math.abs(Math.sin(t * 0.5)), w.p)); }
    }
  }
  const gx = new Float32Array(N * N), gy = new Float32Array(N * N); let ss = 0, mn = 1e9, mx = -1e9;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, xm = y * N + (x + N - 1) % N, xp = y * N + (x + 1) % N, ym = ((y + N - 1) % N) * N + x, yp = ((y + 1) % N) * N + x;
    gx[i] = (h[xp] - h[xm]) * 0.5; gy[i] = (h[yp] - h[ym]) * 0.5; ss += gx[i] * gx[i] + gy[i] * gy[i];
    mn = Math.min(mn, h[i]); mx = Math.max(mx, h[i]);
  }
  const rms = Math.sqrt(ss / (N * N)), data = new Uint8Array(N * N * 4), q = v => Math.max(0, Math.min(255, Math.round((0.5 + v / (6 * rms)) * 255)));
  for (let i = 0; i < N * N; i++) { data[i * 4] = q(gx[i]); data[i * 4 + 1] = q(gy[i]); data[i * 4 + 2] = Math.round((h[i] - mn) / (mx - mn) * 255); data[i * 4 + 3] = 255; }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = aniso; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

function ringGeometry(cols, rings) {
  const nv = (cols + 1) * rings.length, pos = new Float32Array(nv * 3);
  let k = 0;
  for (let j = 0; j < rings.length; j++) {
    const r = rings[j], sp = j === 0 ? rings[1] - rings[0] : r - rings[j - 1];
    for (let i = 0; i <= cols; i++) { pos[k++] = i / cols - 0.5; pos[k++] = r; pos[k++] = sp; }
  }
  const idx = new Uint32Array(cols * (rings.length - 1) * 6); k = 0;
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < cols; i++) {
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

export class Ocean {
  constructor(pipe, o = {}) {
    this.pipe = pipe; this.profName = 'sea';
    const S = pipe.shared, A = pipe.atmo.uniforms;
    this.wakeSize = o.wakeSize || 1024;
    this.rtWake = new THREE.WebGLRenderTarget(this.wakeSize, this.wakeSize, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    // detail bands: tile size (m), drift (m/s), and a rotation plus stretch each so the shared texture never lines up
    this.scales = [1 / 23, 1 / 6.1, 1 / 1.7, 1 / 5.4, 1 / 1.3, 1 / 2600, 1 / 0.47, 1 / 0.43];
    this.drift = [[0.55, 0.3], [-0.35, 0.6], [0.7, -0.45], [0.05, 0.03], [-0.04, 0.06], [0.9, 0.5], [0.35, -0.22], [-0.27, 0.31]];
    this.rots = [[27, 1, 0.45], [-41, 1, 0.4], [73, 1, 0.5], [12, 1, 0.6], [-58, 1, 0.7], [20, 1, 0.35], [-17, 1, 0.55], [0, 1, 1]];
    const cl = o.clouds || null;
    this.cloudK = { value: new THREE.Vector3(5000, 0, 0) };
    this.meshUniforms = {
      uOrigin: S.uOrigin, uTime: S.uTime, uChop: { value: 0.75 }, uYaw: { value: 0 }, uSector: { value: Math.PI * 2 }, logDepthBufFC: { value: 1 },
      uCalm: { value: new THREE.Vector4(0, 0, 0, 1) }, uCalmK: { value: 1 },
      uWA: { value: Array.from({ length: NW }, () => new THREE.Vector4()) }, uWB: { value: Array.from({ length: NW }, () => new THREE.Vector2()) },
    };
    const mu = this.meshUniforms;
    this.uniforms = {
      ...A, tScene: { value: null }, tDepth: S.tDepth, uLogFar: S.uLogFar, uInvProj: S.uInvProj, uCamRot: S.uCamRot, uRes: S.uRes,
      tSky: S.tSky, tAmbient: S.tAmbient, tDetail: S.tDetail, tWavelet: { value: makeWaveletTexture(Math.min(o.aniso ?? 8, pipe.maxAniso)) }, uBandAmp: { value: new THREE.Vector4(0.12, 0.12, 0.10, 0.08) }, tRefl: { value: pipe.black }, tReflDepth: { value: pipe.white }, tWake: { value: this.rtWake.texture },
      tShadow: { value: pipe.white }, uShadowMat: { value: new THREE.Matrix4() }, uShadowK: { value: new THREE.Vector3(0, 1 / 2048, 1.3) },
      uReflVP: { value: new THREE.Matrix4() }, uWakeRegion: { value: new THREE.Vector4(0, 0, 400, 0) },
      uOrigin: S.uOrigin, uSunColor: S.uSunColor, uTime: S.uTime,
      uWaterCol: { value: new THREE.Vector3(0.018, 0.06, 0.066) }, uFoamCol: { value: new THREE.Vector3(0.86, 0.9, 0.92) },
      uPixAngle: { value: 0.001 }, uReflOn: { value: 0 }, uFogK: { value: 0 }, uDetailAmp: { value: 1 }, uGlitter: { value: 1 }, uThermal: { value: 0 }, uChop: mu.uChop,
      uSparkle: { value: 0.8 }, uWhitecap: { value: 0 }, uSlick: { value: 0.6 }, uCloudK: this.cloudK, uShadeWaves: { value: NW },
      uCov: cl ? cl.cover.uCov : { value: new THREE.Vector4(0, 1, 0, 0) }, uCovHole: cl ? cl.cover.uCovHole : { value: new THREE.Vector4(0, 0, 1, 0) },
      uWA: mu.uWA, uWB: mu.uWB, uCalm: mu.uCalm, uCalmK: mu.uCalmK,
      uPh: { value: Array.from({ length: NS }, () => new THREE.Vector2()) }, uSc: { value: this.scales },
      uRot: { value: this.rots.map(([deg, sx, sy]) => { const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a); return new THREE.Vector4(c * sx, sn * sx, -sn * sy, c * sy); }) },
    };
    this.clouds = cl;
    this.material = new THREE.ShaderMaterial({ vertexShader: OCEAN_VERT, fragmentShader: OCEAN_DEPTH_FRAG, uniforms: mu });
    this.shadePass = new Pass(OCEAN_FRAG, this.uniforms);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(LAYER.STATIC);
    this.geos = {};
    pipe.scene.add(this.mesh);
    pipe.deferred.push(this);
    this.setSea(o.sea || {});

    // wake map
    this.wakeScene = new THREE.Scene(); this.wakeCam = new THREE.Camera();
    this.MAXV = 4096;
    const wg = this.wakeGeo = new THREE.BufferGeometry();
    this.wPos = new THREE.BufferAttribute(new Float32Array(this.MAXV * 3), 3); this.wDat = new THREE.BufferAttribute(new Float32Array(this.MAXV * 4), 4);
    this.wPos.setUsage(THREE.DynamicDrawUsage); this.wDat.setUsage(THREE.DynamicDrawUsage);
    wg.setAttribute('position', this.wPos); wg.setAttribute('aDat', this.wDat);
    this.wIdx = new THREE.BufferAttribute(new Uint16Array(this.MAXV * 3), 1); this.wIdx.setUsage(THREE.DynamicDrawUsage); wg.setIndex(this.wIdx);
    this.wakeMat = new THREE.ShaderMaterial({
      vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, uniforms: { uRegion: { value: new THREE.Vector3(0, 0, 400) }, tDetail: S.tDetail },
      depthTest: false, depthWrite: false, side: THREE.DoubleSide, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const wm = new THREE.Mesh(wg, this.wakeMat); wm.frustumCulled = false; this.wakeScene.add(wm);
    this.wakes = [];     // { pos(time, outVec3), beam, on(time) }
    this.discs = [];     // { x, z, t0, dur, r0, r1, k }

    // planar reflection
    this.vcam = new THREE.PerspectiveCamera();
    this.rtRefl = null; this.reflect = true;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
  }

  // wind: direction the waves travel towards (deg clockwise from north); amp: overall height scale; long: weight of the long swell
  setSea({ wind = 40, amp = 0.6, long = 1, chop = 0.75, spread = 38 } = {}) {
    this.sea = { wind, amp, long, chop, spread };
    const lam = [93, 61, 43, 30, 21.5, 15.2, 10.8, 7.6, 5.4, 3.8, 2.7, 1.9, 1.35, 0.95];
    const rnd = (() => { let s = 977; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const WA = this.meshUniforms.uWA.value, WB = this.meshUniforms.uWB.value;
    this.waves = [];
    for (let i = 0; i < NW; i++) {
      const th = (wind + (rnd() * 2 - 1) * spread * (0.55 + 0.45 * i / NW) + (i % 5 === 3 ? 70 : 0)) * Math.PI / 180;
      const dx = Math.sin(th), dz = -Math.cos(th), k = 2 * Math.PI / lam[i];
      const a = 0.0046 * Math.pow(lam[i], 1.12) * amp * (lam[i] > 25 ? long : 1) * (0.75 + 0.5 * rnd());
      const om = Math.sqrt(G * k), ph = rnd() * 6.2831853;
      WA[i].set(dx, dz, k, a); WB[i].set(om, ph);
      this.waves.push({ dx, dz, k, a, om, ph });
    }
    this.meshUniforms.uChop.value = chop;
    // the short-wave bands run with the wind, each a little off it so their crests cross
    const wa = Math.atan2(-Math.cos(wind * Math.PI / 180), Math.sin(wind * Math.PI / 180)), R = this.uniforms.uRot.value;
    [[0, 22], [1, -28], [2, 9], [6, -14]].forEach(([b, off]) => { const a = wa + off * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a); R[b].set(c, sn, -sn * 0.85, c * 0.85); });
  }
  // deferred lighting of the sea pixels (called by the pipeline after the scene pass)
  shade(renderer, sceneTex, target) {
    if (!this.mesh.visible) return false;
    const U = this.uniforms, sh = this.pipe.sun.shadow;
    U.tScene.value = sceneTex;
    if (this.pipe.sun.castShadow && sh.map && this.heroShadows !== false) { U.tShadow.value = sh.map.texture; U.uShadowMat.value.copy(sh.matrix); U.uShadowK.value.set(1, 1 / sh.mapSize.x, 1.3); }
    else U.uShadowK.value.x = 0;
    this.shadePass.render(renderer, target);
    return true;
  }
  // surface height (m) at world x,z and time t (vertical term only)
  heightAt(x, z, t) {
    let h = 0; for (const w of this.waves) h += w.a * Math.sin((w.dx * x + w.dz * z) * w.k - w.om * t + w.ph);
    const c = this.meshUniforms.uCalm.value, k = this.meshUniforms.uCalmK.value;
    if (k < 1) { const d = Math.hypot(x - c.x, z - c.y), u = Math.min(1, Math.max(0, (d - c.z) / (c.w - c.z))); h *= k + (1 - k) * u * u * (3 - 2 * u); }
    return h;
  }
  // sheltered water (a harbour basin): waves scale down to `k` inside r0 and recover by r1
  setShelter(x, z, r0, r1, k) { this.meshUniforms.uCalm.value.set(x, z, r0, r1); this.meshUniforms.uCalmK.value = k; }

  _ribbons(t) {
    const P = this.wPos.array, D = this.wDat.array, I = this.wIdx.array;
    let nv = 0, ni = 0;
    const p = this._a, q = this._b;
    const strip = (pts, type) => { // pts: [x, z, nx, nz, halfWidth, age01, along, k]
      const base = nv;
      for (const s of pts) for (const side of [-1, 1]) {
        if (nv >= this.MAXV) return;
        P[nv * 3] = s[0] + s[2] * s[4] * side; P[nv * 3 + 1] = s[1] + s[3] * s[4] * side; P[nv * 3 + 2] = type;
        D[nv * 4] = side; D[nv * 4 + 1] = s[5]; D[nv * 4 + 2] = s[6]; D[nv * 4 + 3] = s[7]; nv++;
      }
      for (let j = 0; j < pts.length - 1; j++) { const a = base + j * 2; if (a + 3 >= this.MAXV) break; I[ni++] = a; I[ni++] = a + 1; I[ni++] = a + 2; I[ni++] = a + 1; I[ni++] = a + 3; I[ni++] = a + 2; }
    };
    for (const w of this.wakes) {
      if (w.on && !w.on(t)) continue;
      const beam = w.beam ?? 1.2, life = w.life ?? 22, M = 46, tan = w.tan ?? 0.2;
      const sample = (time) => { w.pos(time, p); w.pos(time + 0.06, q); const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1e-6; return [p.x, p.z, dx / l, dz / l, l / 0.06]; };
      const now = sample(t), v0 = Math.max(now[4], 0.5);
      const core = [], aL = [], aR = [];
      for (let j = 0; j < M; j++) {
        const a = Math.pow(j / (M - 1), 1.7) * life;
        const s = sample(t - a - (w.stern ?? 3.3) / v0), k = Math.min(1, Math.max(0, (s[4] - 2.5) / 7));
        core.push([s[0], s[1], -s[3], s[2], beam * 0.72 + 0.62 * Math.pow(a, 0.62), a / life, (t - a) * 9, k * (w.k ?? 1)]);
        if (a < life * 0.5) {
          const b = sample(t - a + (w.bow ?? 0.8) / v0), off = beam * 0.8 + s[4] * a * tan, hw = 0.16 + 0.13 * Math.pow(a, 0.85), ka = Math.min(1, Math.max(0, (b[4] - 3) / 7)) * (w.k ?? 1);
          aL.push([b[0] - b[3] * off, b[1] + b[2] * off, -b[3], b[2], hw, a / (life * 0.5), (t - a) * 9, ka]);
          aR.push([b[0] + b[3] * off, b[1] - b[2] * off, -b[3], b[2], hw, a / (life * 0.5), (t - a) * 9 + 3.7, ka]);
        }
      }
      strip(core, 0); strip(aL, 1); strip(aR, 1);
    }
    for (const d of this.discs) {
      const age = (t - d.t0) / d.dur; if (age < 0 || age > 1 || nv + 4 > this.MAXV) continue;
      const r = d.r0 + (d.r1 - d.r0) * Math.pow(age, 0.6), b = nv;
      for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P[nv * 3] = d.x + cx * r; P[nv * 3 + 1] = d.z + cz * r; P[nv * 3 + 2] = 2; D[nv * 4] = cx; D[nv * 4 + 1] = cz; D[nv * 4 + 2] = age; D[nv * 4 + 3] = d.k ?? 1; nv++; }
      I[ni++] = b; I[ni++] = b + 1; I[ni++] = b + 2; I[ni++] = b; I[ni++] = b + 2; I[ni++] = b + 3;
    }
    this.wPos.needsUpdate = true; this.wDat.needsUpdate = true; this.wIdx.needsUpdate = true;
    this.wakeGeo.setDrawRange(0, ni);
    return ni;
  }

  // call once per frame after the camera and scene are posed and before pipe.render().
  // opt: { wake: {x, z, size} | null, reflect: bool, thermal: 0..1, glitter, sparkle, whitecap (threshold, 0 = none),
  //        slick, detail, water: [r,g,b], cloudShadow, cloudReflect, cloudsOn }
  update(t, opt = {}) {
    const pipe = this.pipe, r = pipe.renderer, cam = pipe.camera, U = this.uniforms, o = pipe.origin;
    cam.updateMatrixWorld(true);
    U.uPixAngle.value = 2 * Math.tan(cam.fov * Math.PI / 360) / pipe.h;
    for (let i = 0; i < NS; i++) {
      const s = this.scales[i], m = U.uRot.value[i], px = (o.x + this.drift[i][0] * t) * s, pz = (o.z + this.drift[i][1] * t) * s;
      const ax = m.x * px + m.y * pz, az = m.z * px + m.w * pz; U.uPh.value[i].set(ax - Math.floor(ax), az - Math.floor(az));
    }
    const H = pipe.atmo.uniforms; U.uFogK.value = 4.44e-6 * H.uHaze.value + 1.3e-5;
    U.uThermal.value = opt.thermal ?? 0;

    // azimuth sector covering the view frustum
    const f = this._a.set(0, 0, -1).transformDirection(cam.matrixWorld), yaw = Math.atan2(f.z, f.x), flat = Math.hypot(f.x, f.z);
    const tn = Math.tan(cam.fov * Math.PI / 360), asp = cam.aspect; let lo = 0, hi = 0, steep = false; const v = this._b;
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      v.set(x * tn * asp, y * tn, -1).normalize().transformDirection(cam.matrixWorld);
      if (Math.hypot(v.x, v.z) < 0.12) { steep = true; continue; }
      let d = Math.atan2(v.z, v.x) - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      lo = Math.min(lo, d); hi = Math.max(hi, d);
    }
    const mu = this.meshUniforms;
    if (steep || hi - lo > 2.6 || flat < 0.25) { mu.uYaw.value = 0; mu.uSector.value = Math.PI * 2; }
    else { mu.uYaw.value = yaw; mu.uSector.value = (Math.max(-lo, hi) * 1.12 + 0.03) * 2; }
    mu.logDepthBufFC.value = 2 / (Math.log(cam.far + 1) / Math.LN2);
    // grid density follows the render size (about one column per 3 px); a full circle needs more columns
    const full = mu.uSector.value > 6, q = Math.min(1, Math.max(0.4, pipe.h / 1080));
    const cols = Math.round((full ? 900 : 640) * Math.min(1, Math.max(0.35, pipe.w / 1920)) / 8) * 8, gk = `${cols}:${q.toFixed(2)}`;
    if (!this.geos[gk]) { const rings = [0]; let rr = 0.25; const kk = 1 + 0.034 / q; while (rr < 560000) { rings.push(rr); rr *= kk; } rings.push(rr); this.geos[gk] = ringGeometry(cols, rings); }
    this.mesh.geometry = this.geos[gk];
    // look of the water this frame
    U.uShadeWaves.value = opt.shadeWaves ?? NW;
    if (opt.bands) U.uBandAmp.value.set(opt.bands[0], opt.bands[1], opt.bands[2], opt.bands[3]); else U.uBandAmp.value.set(0.12, 0.12, 0.10, 0.08);
    U.uGlitter.value = opt.glitter ?? 1; U.uSparkle.value = opt.sparkle ?? 0.8; U.uWhitecap.value = opt.whitecap ?? 0; U.uSlick.value = opt.slick ?? 0.6; U.uDetailAmp.value = opt.detail ?? 1;
    if (opt.water) U.uWaterCol.value.set(opt.water[0], opt.water[1], opt.water[2]);
    const cl = this.clouds, cs = opt.cloudShadow ?? (cl ? 0.75 : 0), cr = opt.cloudReflect ?? (cl ? 0.9 : 0);
    this.cloudK.value.set(cl ? (cl.base + cl.top) / 2 : 5000, opt.cloudsOn === false ? 0 : cs, opt.cloudsOn === false ? 0 : cr);

    // wake map
    const wk = opt.wake;
    if (wk && (this.wakes.length || this.discs.length)) {
      U.uWakeRegion.value.set(wk.x, wk.z, wk.size, 1); this.wakeMat.uniforms.uRegion.value.set(wk.x, wk.z, wk.size);
      this._ribbons(t);
      r.setRenderTarget(this.rtWake); r.setClearColor(new THREE.Color(0, 0.5, 0), 1); r.clear(); r.render(this.wakeScene, this.wakeCam);
    } else U.uWakeRegion.value.w = 0;

    // planar reflection of the scene about the sea plane
    const doRefl = (opt.reflect ?? this.reflect);
    if (doRefl) {
      const w = Math.max(2, pipe.w >> 1), h = Math.max(2, pipe.h >> 1);
      if (!this.rtRefl || this.rtRefl.width !== w || this.rtRefl.height !== h) {
        this.rtRefl?.dispose();
        const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType); dt.minFilter = dt.magFilter = THREE.NearestFilter;
        this.rtRefl = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, depthTexture: dt, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        U.tRefl.value = this.rtRefl.texture; U.tReflDepth.value = dt;
      }
      const e = cam.matrixWorld.elements, yw = -o.y, vc = this.vcam;
      vc.position.set(e[12], 2 * yw - e[13], e[14]); vc.up.set(e[4], -e[5], e[6]);
      this._c.set(e[12] - e[8], 2 * yw - (e[13] - e[9]), e[14] - e[10]); vc.lookAt(this._c);
      vc.fov = cam.fov; vc.aspect = cam.aspect; vc.near = cam.near; vc.far = cam.far;
      vc.projectionMatrix.copy(cam.projectionMatrix); vc.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
      vc.updateMatrixWorld(true); vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
      U.uReflVP.value.multiplyMatrices(vc.projectionMatrix, vc.matrixWorldInverse);
      vc.layers.set(LAYER.STATIC); vc.layers.enable(LAYER.DYNAMIC);
      this.mesh.visible = false; if (pipe.skyQuad) pipe.skyQuad.visible = false;
      r.shadowMap.needsUpdate = true;
      r.setRenderTarget(this.rtRefl); r.setClearColor(0x000000, 0); r.clear(); r.render(pipe.scene, vc);
      this.mesh.visible = true; if (pipe.skyQuad) pipe.skyQuad.visible = true;
      U.uReflOn.value = 1;
    } else U.uReflOn.value = 0;
    r.setRenderTarget(null);
  }
}
