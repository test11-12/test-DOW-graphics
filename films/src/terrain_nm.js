// Southern New Mexico, stylised from the real layout around Spaceport America (origin = runway midpoint):
// Jornada del Muerto basin, San Andres Mountains to the east, the Tularosa Basin and the White Sands
// gypsum dunes beyond them, Caballo / Fra Cristobal ranges and the Rio Grande to the west.
// Coordinates in km: +x east, +y south.
// Around the airfield, photoscanned materials (engine/terrain.js layers, built by blender/ground_tex.py) take over
// from the procedural ground at close range: concrete slabs, joints, sealant, rubber and worn paint on the runway,
// bleached asphalt shoulders, compacted fill, a service track, and desert soil with gravel, fine sand and caliche.
import { SCRUB_FIELD } from './scrub.js';
export const FIELD_ALT = 1401.0;
const TEX = 'shared/tex/ground/';
const layer = (name, scale, o = {}) => ({ name, scale, albedo: `${TEX}${name}_albedo.webp`, normal: `${TEX}${name}_normal.webp`, orm: `${TEX}${name}_orm.webp`, ...o });
// scale = the scan's real size (m); rotate 0 for the directional broom finish (mapped per slab by the recipe)
const layers = [
  layer('concrete_broom', 2.5, { rotate: 0 }), layer('concrete_worn', 3.0, { rotate: 0 }), layer('asphalt', 4.04),
  layer('soil', 4.0), layer('soil_fine', 2.48), layer('gravel', 3.0), layer('caliche', 2.1),
];

const height = /* glsl */`
const float NM_PEAK = 1180.0;
float nmRange(vec2 p, float x0, float z0, float z1, float wW, float wE, float wob, float seed){
  float cx = x0 + wob*(vnoise(vec2(p.y*0.03+seed, seed))-0.5)*2.0 + 3.0*(vnoise(vec2(p.y*0.09, seed+5.3))-0.5);
  float d = p.x-cx; float a = d<0.0 ? d/wW : d/wE;
  float along = smoothstep(z0-7.0, z0+9.0, p.y)*(1.0-smoothstep(z1-9.0, z1+7.0, p.y));
  return exp(-a*a)*along;
}
float nmDuneMask(vec2 p){
  vec2 d = (p-vec2(76.0,22.0))/vec2(15.0,19.0);
  float w = 0.28*(vnoise(p*0.09+4.0)-0.5)+0.12*(vnoise(p*0.31)-0.5);
  return smoothstep(1.05, 0.82, length(d)+w);
}
float nmLavaMask(vec2 p){
  float cx = 99.0+6.0*(vnoise(vec2(p.y*0.035, 8.8))-0.5)*2.0;
  float d = abs(p.x-cx)/(3.2+2.6*vnoise(vec2(p.y*0.12, 3.3)));
  float along = smoothstep(-118.0,-104.0,p.y)*(1.0-smoothstep(-52.0,-40.0,p.y));
  return smoothstep(1.0, 0.75, d+0.35*(vnoise(p*0.8)-0.5))*along;
}
float nmRiverX(float z){ return -21.0+3.5*sin(z*0.06+1.0)+1.6*sin(z*0.19); }
float nmLake(vec2 p){
  float d = abs(p.x-nmRiverX(p.y));
  float wdt = 0.9+1.1*vnoise(vec2(p.y*0.25, 1.7));
  float along = smoothstep(-34.0,-28.0,p.y)*(1.0-smoothstep(-9.0,-5.0,p.y));
  return smoothstep(wdt, wdt-0.25, d)*along;
}
// x: basin + bajada surface (m), y: mountain weight 0..1, z: bajada weight
vec3 nmMacro(vec2 p){
  float h = 1392.0 + 52.0*(vnoise(p*0.011+vec2(3.1,7.7))-0.5) + 16.0*(vnoise(p*0.045+11.0)-0.5);
  float mt = 0.0, bj = 0.0, k;
  // San Andres: long tilted fault block, steep eastern scarp
  k = nmRange(p, 38.0, -78.0, 60.0, 5.2, 2.7, 5.0, 1.0)*(0.56+0.44*vnoise(vec2(p.y*0.075, 2.2)));
  mt = max(mt,k); bj = max(bj, nmRange(p, 38.0, -84.0, 68.0, 17.0, 10.0, 5.0, 1.0));
  // Organ needles at the southern end
  k = nmRange(p, 42.0, 64.0, 92.0, 2.6, 2.2, 2.0, 9.0)*1.1; mt = max(mt,k);
  // Caballo and Fra Cristobal, west of the field
  k = nmRange(p, -27.0, -4.0, 34.0, 2.4, 4.0, 3.0, 3.0)*(0.42+0.3*vnoise(vec2(p.y*0.11, 5.2))); mt = max(mt,k);
  bj = max(bj, 0.8*nmRange(p, -27.0, -8.0, 38.0, 8.0, 13.0, 3.0, 3.0));
  k = nmRange(p, -19.0, -52.0, -26.0, 2.2, 3.4, 2.5, 4.0)*(0.34+0.24*vnoise(vec2(p.y*0.13, 7.2))); mt = max(mt,k);
  bj = max(bj, 0.7*nmRange(p, -19.0, -56.0, -22.0, 7.0, 10.0, 2.5, 4.0));
  // Sacramento / Sierra Blanca east of the Tularosa Basin
  k = nmRange(p, 122.0, -95.0, 70.0, 6.0, 20.0, 7.0, 5.0)*(0.62+0.5*vnoise(vec2(p.y*0.05, 9.2))); mt = max(mt,k);
  bj = max(bj, nmRange(p, 122.0, -100.0, 76.0, 18.0, 40.0, 7.0, 5.0));
  // Black Range and Gila country to the west
  k = nmRange(p, -78.0, -110.0, 80.0, 14.0, 8.0, 9.0, 6.0)*(0.55+0.55*vnoise(vec2(p.y*0.04, 4.4))); mt = max(mt,k);
  bj = max(bj, nmRange(p, -78.0, -115.0, 86.0, 32.0, 20.0, 9.0, 6.0));
  // generic basin-and-range beyond the mapped area
  float far = smoothstep(95.0, 150.0, max(abs(p.x-25.0)-90.0, abs(p.y)));
  k = far*smoothstep(0.52, 0.8, vnoise(vec2(p.x*0.021, p.y*0.008)+17.0))*0.8; mt = max(mt,k); bj = max(bj, far*0.5);
  h += bj*185.0;
  float dr = abs(p.x-nmRiverX(p.y)); h -= 78.0*exp(-dr*dr/7.0)*smoothstep(110.0,90.0,abs(p.y));
  return vec3(h, mt, bj);
}
float nmBody(vec2 p, float mt, int oct){ return mt*(0.30+0.95*ridged(p*0.21+5.0, oct))*NM_PEAK; }
float nmShape(vec2 p){ vec3 m = nmMacro(p); return m.x+nmBody(p, m.y, 4); }
vec2 nmSlope(vec2 p){ float e = 0.25;
  return vec2(nmShape(p+vec2(e,0.0))-nmShape(p-vec2(e,0.0)), nmShape(p+vec2(0.0,e))-nmShape(p-vec2(0.0,e)))/(2.0*e*1000.0); }
float terrainH(vec2 p, float lod){
  vec3 m = nmMacro(p);
  vec2 g = nmSlope(p);
  float er = erosion(p*0.85, g*4.2, 1.35, 5, lod*0.85);
  // mountain body: ridged massif, carved by gullies, benched along the bedding
  float hm = nmBody(p, m.y, 6)+(er-0.5)*m.y*560.0;
  float st = hm/135.0; float tq = (floor(st)+smoothstep(0.15,0.85,fract(st)))*135.0;
  hm = mix(hm, tq, 0.45*smoothstep(0.08,0.35,m.y));
  float h = m.x+max(hm, -40.0*m.y);
  // arroyos cut into the fans
  h += (er-0.5)*m.z*(1.0-m.y)*20.0;
  // basin-floor texture: low swells and coppice mounds
  h += 2.2*(vnoise(p*1.7)-0.5) + (lod<0.06 ? 0.7*(vnoise(p*9.0)-0.5) : 0.0);
  // gypsum dunes: sharp-crested transverse ridges
  float D = nmDuneMask(p);
  if (D > 0.0 && lod < 0.09){
    vec2 q = p+0.32*vec2(vnoise(p*1.3), vnoise(p*1.3+9.1));
    float a = sin((q.x*0.86+q.y*0.5)*27.0+3.0*vnoise(q*2.1));
    h += D*(pow(0.5+0.5*a, 1.7)*11.0+3.0*vnoise(q*8.0));
  }
  float L = nmLavaMask(p); h += L*(9.0+5.0*vnoise(p*5.0));
  float W = nmLake(p); h = mix(h, 1338.0, W);
  // level the airfield
  vec2 f = abs(p)/vec2(1.6, 4.2);
  float fl = smoothstep(1.0, 0.55, max(f.x,f.y));
  h = mix(h, ${FIELD_ALT.toFixed(1)}, fl);
  return h;
}
`;

const mask = /* glsl */`
void terrainMask(vec2 p, float h, vec2 grad, float lod, out vec4 m0, out vec4 m1){
  vec3 m = nmMacro(p);
  float er = erosion(p*0.85, nmSlope(p)*4.2, 1.35, 5, lod*0.85);
  float D = nmDuneMask(p), L = nmLavaMask(p), W = nmLake(p);
  // alkali flats beside the dune field and scattered playas on basin floors
  vec2 dl = (p-vec2(66.0,36.0))/vec2(7.0,10.0);
  float playa = smoothstep(1.0,0.7,length(dl)+0.3*(vnoise(p*0.2)-0.5))*0.75;
  playa = max(playa, smoothstep(0.80,0.9,vnoise(p*0.035+40.0))*(1.0-m.z)*(1.0-m.y)*0.7);
  float tul = smoothstep(52.0,62.0,p.x)*(1.0-smoothstep(96.0,108.0,p.x))*(1.0-m.z*1.3);
  float bright = max(max(D, playa), clamp(tul,0.0,1.0)*0.22*smoothstep(0.3,0.7,vnoise(p*0.07+2.0)));
  float slope = length(grad);
  float veg = (0.35+0.5*vnoise(p*0.13+9.0))*(1.0-smoothstep(0.05,0.3,slope));
  veg = max(veg, smoothstep(1900.0,2500.0,h)*0.85);
  veg *= (1.0-bright)*(1.0-L)*(1.0-W);
  float dr = abs(p.x-nmRiverX(p.y));
  float green = smoothstep(1.4,0.3,dr)*smoothstep(-5.0,2.0,p.y)*(1.0-W)*smoothstep(110.0,90.0,abs(p.y));
  m0 = vec4(bright, L, er, 1.0);
  m1 = vec4(W, veg, green, D);
}
`;

// detail slots: 0-6 isotropic octaves, 7/8 stretched wash networks, 9 patchiness, 10 warp
const scales = [0.004, 0.02, 0.17, 1.3, 11, 90, 700, [0.018, 0.085], [0.09, 0.36], 0.75, 0.045, 5.5];

const shade = /* glsl */`
float lineAA(float d, float w, float fp){ return (1.0-smoothstep(w, w+fp*1.2, d))*min(1.0, w/max(fp*0.7,1e-5)); }
// Spaceport America runway 16/34 (modelled north-south): 3,660 x 61 m concrete, painted markings, rubber, asphalt shoulders.
// q: metres from the runway centre (x across, y along), fp: pixel footprint (m)
float rwBox(float a, float b, float x, float w){ return smoothstep(a-w, a+w, x)-smoothstep(b-w, b+w, x); }
// painted markings: edge stripes, centreline dashes, threshold bars, aiming points, touchdown-zone bars (w: edge softness, m)
float nmPaint(vec2 q, float w){
  float ax = abs(q.x), az = abs(q.y);
  float paint = rwBox(28.3, 29.2, ax, w);
  paint = max(paint, rwBox(-0.45, 0.45, q.x, w)*rwBox(0.0, 36.6, mod(q.y+1830.0, 61.0), w)*step(az, 1745.0));
  paint = max(paint, rwBox(1760.0, 1805.0, az, w)*rwBox(1.5, 27.0, ax, w)*rwBox(0.0, 0.5, fract((ax-1.5)/3.4), w/3.4));
  paint = max(paint, rwBox(1480.0, 1525.0, az, w)*rwBox(8.0, 17.0, ax, w));
  paint = max(paint, rwBox(0.0, 22.5, mod(az-1180.0, 150.0), w)*step(1150.0, az)*step(az, 1470.0)*rwBox(9.0, 16.5, ax, w)*rwBox(0.0, 0.62, fract((ax-9.0)/2.5), w/2.5));
  return paint;
}
vec4 nmRunway(vec2 q, float fp, float n5, float n6, float n7){
  float ax = abs(q.x), az = abs(q.y), w = max(fp*0.6, 0.012);
  float pave = rwBox(-30.5, 30.5, q.x, w)*rwBox(-1830.0, 1830.0, q.y, w);
  float shoulder = rwBox(-38.5, 38.5, q.x, w)*rwBox(-1838.0, 1838.0, q.y, w);
  if (shoulder <= 0.001) return vec4(0.0);
  vec2 s = q/7.62, f = abs(fract(s)-0.5), id = floor(s);
  float jw = max(fp/7.62, 0.0015);
  float joint = smoothstep(0.5-0.003-jw, 0.5-jw*0.3, max(f.x,f.y))*clamp(0.012/jw, 0.0, 1.0);
  float tone = 0.9+0.2*fract(sin(dot(id, vec2(12.9898,78.233)))*43758.5453);
  tone = mix(1.0, tone, clamp(4.0/max(fp,0.01), 0.0, 1.0));
  vec3 c = vec3(0.47,0.46,0.43)*tone*(0.8+0.25*n5)*(0.9+0.2*n6)*(0.92+0.16*n7);
  c = mix(c, vec3(0.15,0.14,0.13), joint*0.8);
  float tz = smoothstep(1790.0,1500.0,az)*smoothstep(900.0,1300.0,az);
  float streak = textureLod(tDetail, vec2(q.x*0.35, q.y*0.004), clamp(log2(fp*0.35*512.0), 0.0, 7.0)).r;
  float track = exp(-pow((ax-3.1)/1.5, 2.0))+0.35*exp(-pow(ax/1.1, 2.0));   // main-gear and nose-gear wheel tracks
  c = mix(c, vec3(0.07), tz*track*smoothstep(0.25,0.8,streak)*0.42);
  c = mix(c, vec3(0.84,0.83,0.78)*(0.5+0.5*n6), nmPaint(q, w)*0.92);
  vec3 asph = vec3(0.075,0.073,0.07)*(0.8+0.4*n6);
  return vec4(mix(asph, c, pave), shoulder);
}
#ifdef TERRAIN_LAYERS
// ---------------------------------------------------------------- close range: photoscanned materials
${SCRUB_FIELD}
const vec3 Y3 = vec3(0.2126, 0.7152, 0.0722);
// target mean albedos (linear), from the real site: pale bleached concrete, reddish-brown basin soil
const vec3 NM_CONC = vec3(0.37, 0.355, 0.33), NM_ASPH = vec3(0.13, 0.125, 0.12), NM_SOIL = vec3(0.26, 0.195, 0.15),
           NM_FINE = vec3(0.30, 0.225, 0.17), NM_GRAVEL = vec3(0.25, 0.215, 0.18), NM_CALICHE = vec3(0.48, 0.44, 0.38),
           NM_DUST = vec3(0.34, 0.26, 0.195), NM_PAINT = vec3(0.72, 0.71, 0.67);
// a scan regraded: its mean goes to target, its own variation kept (desaturated to sat)
vec3 nmGrade(vec3 a, int k, vec3 target, float sat){
  vec3 m = layerMeanAlbedo(k);
  return target*mix(vec3(dot(a, Y3)), a, sat)/max(mix(vec3(dot(m, Y3)), m, sat), vec3(1e-4));
}
// the scans' roughness, remapped to sun-dried outdoor ground (a range, keeping the scan's own variation)
float nmRough(float r, float lo, float hi){ return mix(lo, hi, clamp(r, 0.0, 1.0)); }
// how much of this pixel the photoscanned near field owns: the levelled airfield, out to about a metre per pixel
float nmNearW(vec2 q, float fp){ return (1.0-smoothstep(1250.0, 1650.0, abs(q.x)))*(1.0-smoothstep(2500.0, 3100.0, abs(q.y)))*(1.0-smoothstep(0.55, 1.5, fp)); }
// desert ground: soil with patches of fine sand, lag gravel and pale caliche; the graded strip and the service track
Surf nmGround(vec2 q, float wash){
  float m11 = dtex(duv(11)+0.37, 11).g, m4 = dtex(duv(4)+0.11, 4).r, m4b = dtex(duv(4)+0.53, 4).g, m5 = dtex(duv(5)+0.5, 5).r;
  float ax = abs(q.x);
  float graded = 1.0-smoothstep(43.0, 54.0, ax+(m5-0.5)*6.0);                  // compacted fill beside the shoulders
  float wF = max(smoothstep(0.47, 0.64, m11*0.65+m5*0.35), wash);
  float wG = max(smoothstep(0.58, 0.7, m4*0.7+m5*0.3), graded*0.8);
  float wC = max(smoothstep(0.64, 0.75, m4b*0.6+m11*0.4)*0.85, graded*0.3);
  float tr = abs(q.x+58.0), ruts = 0.0;                                          // service track west of the runway
  if (tr < 5.5 && abs(q.y) < 2200.0){
    float tk = 1.0-smoothstep(2.9, 4.7, tr+(m5-0.5)*0.9);
    ruts = exp(-pow((tr-0.85)/0.3, 2.0))*tk;
    wF = max(wF, tk); wG = mix(wG, 0.6*smoothstep(0.5, 0.0, tr), tk); wC *= 1.0-tk;
  }
  // patches overlap little: caliche over gravel over fine sand over soil, at most two scans at a pixel
  wG *= 1.0-wC; wF *= 1.0-max(wC, wG);
  Surf g;
  if (wF > 0.98){ g = layerSample(L_SOIL_FINE); g.alb = nmGrade(g.alb, L_SOIL_FINE, NM_FINE, 0.75); wF = 0.0; }
  else { g = layerSample(L_SOIL); g.alb = nmGrade(g.alb, L_SOIL, NM_SOIL, 0.8); }
  if (wF > 0.02){ Surf f = layerSample(L_SOIL_FINE); f.alb = nmGrade(f.alb, L_SOIL_FINE, NM_FINE, 0.75); g = surfBlendH(g, f, wF, 0.3); }
  if (wG > 0.02){ Surf v = layerSample(L_GRAVEL); v.alb = nmGrade(v.alb, L_GRAVEL, NM_GRAVEL, 0.8); g = surfBlendH(g, v, wG, 0.18); }
  if (wC > 0.02){ Surf c = layerSample(L_CALICHE); c.alb = nmGrade(c.alb, L_CALICHE, NM_CALICHE, 0.7); g = surfBlendH(g, c, wC, 0.25); }
  g.rough = nmRough(g.rough, 0.84, 0.98);
  g.alb *= (1.0-0.16*ruts)*(0.93+0.14*m5); g.d *= 1.0-0.6*ruts; g.rough = mix(g.rough, 0.8, ruts);   // ruts: packed, tyre-smoothed
  return g;
}
// runway concrete: 7.6 m slabs, each its own pour (offset, finish, tone); the broom grain runs across the runway
Surf nmConcrete(vec2 q){
  vec2 id = floor(q/vec2(7.625, 7.62));
  vec4 r = lRand(ivec2(id)+ivec2(4099, 2741));
  vec2 fx = lFootX(), fy = lFootY();
  Surf b = layerSampleST(L_CONCRETE_BROOM, vec2(q.y, q.x)/2.5+r.xy*13.0, vec2(-fx.y, fx.x)/2.5, vec2(-fy.y, fy.x)/2.5, 1.5707963);
  Surf w = layerSampleST(L_CONCRETE_WORN, vec2(q.x, -q.y)/3.0+r.zw*11.0, fx/3.0, fy/3.0, 0.0);
  b.alb = nmGrade(b.alb, L_CONCRETE_BROOM, NM_CONC, 0.3); w.alb = nmGrade(w.alb, L_CONCRETE_WORN, NM_CONC, 0.4);
  Surf c = surfBlendH(b, w, 0.15+0.6*r.z, 0.35);
  c.alb *= 0.93+0.14*r.w; c.rough = nmRough(c.rough, 0.74, 0.95);
  return c;
}
// sealed joints, sand in the joints, dust from the edges, oil spots, tyre rubber, worn paint
void nmRunwayDetail(vec2 q, float fp, inout Surf c){
  float ax = abs(q.x), az = abs(q.y);
  vec2 fl = fract(q/vec2(7.625, 7.62)), dj = min(fl, 1.0-fl)*vec2(7.625, 7.62);
  // each joint antialiased with the pixel's extent across it (longitudinal joints: x, transverse joints: z)
  vec2 fxz = max(abs(gGx), abs(gGy))*1000.0;
  float wob = dtex(duv(6)+0.71, 6).r, n5 = dtex(duv(5)+0.2, 5).g, sw = 0.006+0.017*smoothstep(0.5, 0.85, wob), dw = 0.03+0.06*wob;
  float seal = max(lineAA(dj.x, sw, fxz.x), lineAA(dj.y, sw, fxz.y));
  float sand = max(lineAA(dj.x, dw, fxz.x), lineAA(dj.y, dw, fxz.y))*(0.3+0.7*smoothstep(0.3, 0.7, n5));
  float tz = smoothstep(1815.0, 1560.0, az)*smoothstep(700.0, 1250.0, az);
  float trackW = exp(-pow((ax-2.9)/1.5, 2.0))+0.3*exp(-pow(ax/0.8, 2.0));
  float streak = textureLod(tDetail, vec2(q.x*0.35, q.y*0.004), clamp(log2(fp*0.35*512.0), 0.0, 7.0)).r;
  float rub = (tz*0.55+0.08)*trackW*smoothstep(0.3, 0.85, streak);
  float dust = smoothstep(22.0, 30.5, ax)*(0.35+0.65*dtex(duv(5)+0.61, 5).g)+0.22*smoothstep(0.55, 0.85, dtex(duv(4)+0.37, 4).g);
  dust = clamp(dust*(1.25-c.h), 0.0, 1.0);
  float oil = smoothstep(0.12, 0.04, dtex(duv(5)+0.77, 5).b)*smoothstep(0.62, 0.8, dtex(duv(4)+0.91, 4).r)*(1.0-smoothstep(4.0, 14.0, ax));
  c.alb = mix(c.alb, NM_DUST, dust*0.42);
  c.alb = mix(c.alb, NM_DUST*1.05, sand*0.5);
  c.alb *= 1.0-0.4*oil; c.rough = mix(c.rough, 0.45, oil*0.6);
  float pnt = nmPaint(q, max(fp*0.5, 0.004));
  if (pnt > 0.0){   // worn off the high spots first and along the tyre tracks; dusty
    float wn = dtex(duv(6)+0.29, 6).g;
    float pc = pnt*mix(1.0, smoothstep(0.15, 0.5, 1.15-c.h+(wn-0.5)*0.6-rub*1.5), 0.55);
    c.alb = mix(c.alb, mix(NM_PAINT*(0.88+0.12*wn), NM_DUST*1.6, dust*0.3), pc);
    c.rough = mix(c.rough, 0.5, pc); c.d *= 1.0-0.55*pc; c.ao = mix(c.ao, 1.0, pc*0.5);
  }
  c.alb = mix(c.alb, vec3(0.03), rub*0.6); c.rough = mix(c.rough, 0.6, rub);
  c.alb = mix(c.alb, vec3(0.032, 0.03, 0.028), seal*0.92); c.rough = mix(c.rough, 0.42, seal); c.ao *= 1.0-0.35*seal;
}
// bleached asphalt shoulders, sand drifting onto their outer edge, a sealed joint against the concrete
Surf nmShoulder(vec2 q, float fp){
  Surf a = layerSample(L_ASPHALT); a.alb = nmGrade(a.alb, L_ASPHALT, NM_ASPH, 0.5); a.rough = nmRough(a.rough, 0.8, 0.97);
  float ax = abs(q.x), drift = smoothstep(34.5, 38.8, ax+(dtex(duv(5)+0.44, 5).r-0.5)*2.4);
  if (drift > 0.01){ Surf s = layerSample(L_SOIL_FINE); s.alb = nmGrade(s.alb, L_SOIL_FINE, NM_FINE, 0.75); a = surfBlendH(a, s, drift*0.85, 0.2); }
  float j = lineAA(abs(ax-30.5), 0.01, fp); a.alb = mix(a.alb, vec3(0.03), j*0.8);
  return a;
}
// the near field over the procedural ground; wash: the procedural wash channels (sand)
void nmNear(vec2 p, float fp, float dist, float wash, inout vec3 N, inout vec3 alb, inout float spec){
  vec2 q = p*1000.0;
  float wL = nmNearW(q, fp);
  if (wL <= 0.0) return;
  float w = max(fp*0.4, 0.004);
  float edge = 38.5+(dtex(duv(5)+0.83, 5).g-0.5)*0.5;
  float wPave = rwBox(-30.5, 30.5, q.x, w)*rwBox(-1830.0, 1830.0, q.y, w);
  float wSh = rwBox(-edge, edge, q.x, w)*rwBox(-1838.0, 1838.0, q.y, w)*(1.0-wPave);
  float wGr = max(1.0-wPave-wSh, 0.0);
  Surf s = Surf(vec3(0.0), 0.5, vec2(0.0), 0.9, 1.0); float acc = 0.0;
  if (wGr > 0.001){
    s = nmGround(q, wash); acc = wGr;
    // plants too small to draw: their cover darkens the ground; seen at a grazing angle they hide most of it
    float lam = scrubDensity(q)*(1.0-scrubDrawn(dist*uPixAngle))/(SCRUB_PITCH*SCRUB_PITCH);
    vec3 V = -normalize(vRel);
    float cover = 1.0-exp(-lam*0.35/max(V.y, 0.004));
    float back = smoothstep(-0.3, 0.8, dot(normalize(-V.xz), normalize(uSunDir.xz)));   // looking into the sun: silhouettes
    s.alb = mix(s.alb, mix(vec3(0.16, 0.155, 0.1), vec3(0.045, 0.05, 0.035), back), cover); s.d *= 1.0-cover;
  }
  if (wSh > 0.001){ Surf a = nmShoulder(q, fp); if (acc > 0.0) s = surfMix(a, s, acc/(acc+wSh)); else s = a; acc += wSh; }
  if (wPave > 0.001){ Surf c = nmConcrete(q); nmRunwayDetail(q, fp, c); if (acc > 0.0) s = surfMix(c, s, acc/(acc+wPave)); else s = c; }
  vec3 al = alb, Nl = N;
  surfApply(s, 1.0, al, Nl);
  alb = mix(alb, al, wL); N = normalize(mix(N, Nl, wL)); tW = wL;
  spec = mix(spec, 0.0, wL);
}
#endif
void shadeTerrain(vec2 p, float h, inout vec3 N, float lap, vec4 m0, vec4 m1, float fp, float dist, out vec3 alb, out float spec){
  float slope = 1.0-N.y; float fk = fp*0.001;
#ifdef TERRAIN_LAYERS
  float nearW = nmNearW(p*1000.0, fp);      // where the photoscanned near field owns the pixel, skip what it replaces
  if (nearW >= 0.999){                      // only the wash channels and the mid-scale relief carry over
    vec2 warp = vec2(dtex(duv(10), 10).r, dtex(duv(10)+0.5, 10).g)-0.5;
    float w1 = abs(dtex(duv(7)+warp*2.6*uScale[7], 7).r-0.5), w2 = abs(dtex(duv(8)+warp*2.6*uScale[8]+0.3, 8).g-0.5);
    float wash = max(lineAA(w1, 0.006, fk*0.02), 0.6*lineAA(w2, 0.012, fk*0.09));
    float c0 = dtex(duv(4), 4).r, c1 = dtex(duv(4)+vec2(0.016,0.0), 4).r, c2 = dtex(duv(4)+vec2(0.0,0.016), 4).r;
    N.xz += vec2(c0-c1, c0-c2)*0.2*smoothstep(60.0, 4.0, fp);
    if (abs(p.x) < 0.045 && abs(p.y) < 1.85) N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.9));
    alb = vec3(0.3); spec = 0.0;
    nmNear(p, fp, dist, wash, N, alb, spec);
    return;
  }
#else
  float nearW = 0.0;
#endif
  float n1 = dtex(duv(0), 0).r, n2 = dtex(duv(1)+0.3, 1).g;
  float n3 = dtex(duv(2), 2).r, n4 = dtex(duv(3)+0.7, 3).g;
  vec4 t5 = dtex(duv(4), 4); float n6 = dtex(duv(5), 5).g;
  vec3 soil = mix(vec3(0.47,0.37,0.26), vec3(0.42,0.30,0.21), smoothstep(0.32,0.7,n1));
  soil = mix(soil, vec3(0.52,0.45,0.35), smoothstep(0.48,0.8,n2)*0.75);
  soil *= 0.84+0.32*n3; soil *= 0.93+0.14*n4;
  soil *= mix(1.0, 0.9+0.2*t5.r, smoothstep(40.0, 4.0, fp))*mix(1.0, 0.92+0.16*n6, smoothstep(4.0, 0.3, fp));
#ifdef TERRAIN_LAYERS
  // around the airfield the basin soil is the photoscanned near field's soil, so the two meet without a seam
  soil = mix(soil, vec3(0.27, 0.205, 0.158)*(0.84+0.32*n3)*(0.93+0.14*n4), (1.0-smoothstep(2.5, 7.0, length(p*vec2(1.0, 0.55))))*0.85);
#endif
  // bedrock with bedding picked out by height
  vec3 rock = mix(vec3(0.27,0.225,0.19), vec3(0.37,0.32,0.275), n2);
  float strata = textureLod(tDetail, vec2(h*0.0041+n3*0.06, p.x*0.02+p.y*0.013), clamp(log2(fp*0.0041*512.0), 0.0, 6.0)).r;
  rock *= 0.72+0.6*strata;
  float rk = smoothstep(0.03, 0.11, slope);
  alb = mix(soil, rock, rk);
  // gullies hold pale sediment, spurs carry dark varnish
  alb *= mix(1.0, mix(1.2, 0.84, smoothstep(0.25,0.75,m0.b)), clamp(rk+0.25,0.0,1.0));
  // washes: meandering pale channels with a darker brush fringe
  vec2 warp = vec2(dtex(duv(10), 10).r, dtex(duv(10)+0.5, 10).g)-0.5;
  float w1 = abs(dtex(duv(7)+warp*2.6*uScale[7], 7).r-0.5);
  float w2 = abs(dtex(duv(8)+warp*2.6*uScale[8]+0.3, 8).g-0.5);
  float flat1 = (1.0-rk)*(1.0-m0.r*0.8);
  float wash = max(lineAA(w1, 0.006, fk*0.02), 0.6*lineAA(w2, 0.012, fk*0.09));
  float fringe = max(lineAA(w1, 0.022, fk*0.02), 0.6*lineAA(w2, 0.04, fk*0.09));
  alb = mix(alb, alb*0.78, (fringe-wash)*flat1*0.7);
  alb = mix(alb, vec3(0.60,0.52,0.40), wash*flat1*0.7);
  // scrub: dark shrubs that merge into a mottled tone with distance
  float patch1 = smoothstep(0.3,0.72, dtex(duv(9)+0.2, 9).r);
  float dots = (1.0-smoothstep(0.16,0.33, t5.b))*step(0.35, dtex(duv(11), 11).g);
  float vv = mix(dots*(0.5+0.5*patch1), 0.30+0.32*patch1, smoothstep(2.5, 18.0, fp));
  alb = mix(alb, vec3(0.105,0.115,0.07), m1.g*vv*0.74);
  alb = mix(alb, vec3(0.08,0.13,0.05), m1.b*(0.5+0.4*n4));
  // lava, gypsum / alkali
  alb = mix(alb, vec3(0.05,0.045,0.042)*(0.7+0.6*n4), m0.g);
  vec3 white = mix(vec3(0.80,0.77,0.70), vec3(0.95,0.945,0.925), m1.a);
  alb = mix(alb, white*(0.93+0.1*n4), m0.r);
  // range roads
  float rd = min(abs(p.x+2.4), abs(p.y-5.6));
  rd = min(rd, abs((p.x-11.0)*0.83+(p.y+14.0)*0.56));
  float road = lineAA(rd, 0.006, fk)*(1.0-rk)*(1.0-m1.r);
  alb = mix(alb, vec3(0.55,0.49,0.40), road*0.75);
  // fine relief
  float b0 = n4, b1 = dtex(duv(3)+0.7+vec2(0.012,0.0), 3).g, b2 = dtex(duv(3)+0.7+vec2(0.0,0.012), 3).g;
  N.xz += vec2(b0-b1, b0-b2)*(1.2*rk+0.05)*smoothstep(900.0, 60.0, fp)*3.0;
  float c0 = t5.r, c1 = dtex(duv(4)+vec2(0.016,0.0), 4).r, c2 = dtex(duv(4)+vec2(0.0,0.016), 4).r;
  N.xz += vec2(c0-c1, c0-c2)*(0.9*rk+0.1)*smoothstep(60.0, 4.0, fp)*2.0;
  // dirt service track beside the runway: bare, pale, with two wheel ruts
  float trk = abs(p.x+0.058)*1000.0;
  if (trk < 9.0 && abs(p.y) < 2.2){
    float tk = (1.0-smoothstep(3.0, 4.6, trk))*(0.85+0.15*n4);
    float ruts = exp(-pow((abs(trk-0.0)-0.95)/0.32, 2.0));
    alb = mix(alb, vec3(0.50,0.43,0.33)*(0.9+0.2*n6), tk*0.85);
    alb *= 1.0-0.22*ruts*tk;
  }
  // close to the lens: gravel, grit and small relief that a low sun picks out
  if (fp < 0.25 && nearW < 0.999){
    float k = smoothstep(0.25, 0.012, fp);
    vec4 d5 = dtex(duv(5)+0.13, 5), d6 = dtex(duv(6), 6);
    float peb = smoothstep(0.30, 0.12, d6.b)*step(0.45, d5.r);                // scattered pebbles
    alb *= 1.0+k*((d5.b-0.5)*0.30+(d6.a-0.5)*0.22);
    alb = mix(alb, mix(vec3(0.34,0.31,0.28), vec3(0.62,0.57,0.50), d5.g), peb*k*0.7);
    float e5 = 0.006, e6 = 0.012;
    float h5 = d5.r, h6 = d6.r+peb*0.6;
    vec2 g5 = vec2(dtex(duv(5)+0.13+vec2(e5,0.0), 5).r-h5, dtex(duv(5)+0.13+vec2(0.0,e5), 5).r-h5);
    vec2 g6 = vec2(dtex(duv(6)+vec2(e6,0.0), 6).r-d6.r, dtex(duv(6)+vec2(0.0,e6), 6).r-d6.r);
    N.xz -= (g5*0.35+g6*1.1)*k*(1.0-0.8*step(0.5, m1.r));
  }
  spec = m1.r;
  if (spec > 0.0) alb = mix(alb, vec3(0.03,0.06,0.07), spec);
  if (abs(p.x) < 0.045 && abs(p.y) < 1.85 && nearW < 0.999){
    vec4 rw = nmRunway(p*1000.0, fp, t5.r, n6, dtex(duv(6), 6).r);
    alb = mix(alb, rw.rgb, rw.a);
    if (rw.a > 0.5){
      vec2 g7 = dtex(duv(6)+0.37, 6).rg-0.5;
      N = normalize(mix(N, vec3(0.0,1.0,0.0), 0.9)+vec3(g7.x, 0.0, g7.y)*0.035*smoothstep(0.6, 0.02, fp));
    }
    spec = mix(spec, -1.0, rw.a);
  }
#ifdef TERRAIN_LAYERS
  if (nearW > 0.0){
    if (abs(p.x) < 0.045 && abs(p.y) < 1.85) N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.9));   // the paved strip is graded flat
    nmNear(p, fp, dist, wash*flat1, N, alb, spec);
  }
#endif
}
`;

export const NM_TERRAIN = {
  height, mask, shade, scales, groundAlt: FIELD_ALT, layers,
  near: { center: [40, 8], extent: 128, res: 4096 },
  far: { center: [20, 0], extent: 1100, res: 2048 },
};
