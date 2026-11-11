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
// scale = the scan's real size (m); rotate 0 for the directional broom finish (mapped per slab by the recipe);
// detail: grain laid over a magnified scan (the materials a camera stands on)
const layers = [
  layer('concrete_broom', 2.5, { rotate: 0, detail: [5, 0.8] }), layer('concrete_worn', 3.0, { rotate: 0, detail: [5, 0.8] }), layer('asphalt', 4.04),
  layer('soil', 2.0, { detail: [4, 1] }), layer('soil_fine', 2.48, { detail: [5, 1] }), layer('gravel', 3.0), layer('caliche', 2.1),
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
  float shoulder = rwBox(-33.0, 33.0, q.x, w)*rwBox(-1838.0, 1838.0, q.y, w);
  if (shoulder <= 0.001) return vec4(0.0);
  vec2 s = q/7.62, f = abs(fract(s)-0.5), id = floor(s);
  float jw = max(fp/7.62, 0.0015);
  float joint = smoothstep(0.5-0.003-jw, 0.5-jw*0.3, max(f.x,f.y))*clamp(0.012/jw, 0.0, 1.0);
  float tone = 0.9+0.2*fract(sin(dot(id, vec2(12.9898,78.233)))*43758.5453);
  tone = mix(1.0, tone, clamp(4.0/max(fp,0.01), 0.0, 1.0));
#ifdef TERRAIN_LAYERS
  vec3 c = vec3(0.44,0.41,0.36)*mix(1.0, 0.93+0.13*fract(sin(id.x*12.9898)*43758.5453), clamp(4.0/max(fp,0.01), 0.0, 1.0))*(0.94+0.08*n5);
#else
  vec3 c = vec3(0.47,0.46,0.43)*tone*(0.8+0.25*n5)*(0.9+0.2*n6)*(0.92+0.16*n7);
#endif
  c = mix(c, vec3(0.15,0.14,0.13), joint*0.8);
  float tz = smoothstep(1790.0,1500.0,az)*smoothstep(900.0,1300.0,az);
  float streak = textureLod(tDetail, vec2(q.x*0.35, q.y*0.004), clamp(log2(fp*0.35*512.0), 0.0, 7.0)).r;
  float track = exp(-pow((ax-3.1)/1.5, 2.0))+0.35*exp(-pow(ax/1.1, 2.0));   // main-gear and nose-gear wheel tracks
  c = mix(c, vec3(0.07), tz*track*smoothstep(0.25,0.8,streak)*0.42);
  c = mix(c, vec3(0.84,0.83,0.78)*(0.5+0.5*n6), nmPaint(q, w)*0.92);
  vec3 asph = vec3(0.33,0.30,0.255)*(0.85+0.3*n6);   // weathered, sand-dusted shoulder
  return vec4(mix(asph, c, pave), shoulder);
}
#ifdef TERRAIN_LAYERS
// ---------------------------------------------------------------- close range: photoscanned materials
${SCRUB_FIELD}
const vec3 Y3 = vec3(0.2126, 0.7152, 0.0722);
// target mean albedos (linear), from photographs of the real field: pale grey-tan concrete, red-brown basin soil
const vec3 NM_CONC = vec3(0.45, 0.42, 0.37), NM_SHLD = vec3(0.34, 0.315, 0.275), NM_SOIL = vec3(0.275, 0.185, 0.128),
           NM_FINE = vec3(0.335, 0.235, 0.16), NM_GRAVEL = vec3(0.30, 0.235, 0.185), NM_CALICHE = vec3(0.47, 0.41, 0.33),
           NM_DUST = vec3(0.36, 0.265, 0.185), NM_PAINT = vec3(0.76, 0.75, 0.71);
// a scan regraded: its mean goes to target, its own variation kept (desaturated to sat)
vec3 nmGrade(vec3 a, int k, vec3 target, float sat){
  vec3 m = layerMeanAlbedo(k);
  return target*mix(vec3(dot(a, Y3)), a, sat)/max(mix(vec3(dot(m, Y3)), m, sat), vec3(1e-4));
}
// the scans' roughness, remapped to sun-dried outdoor ground (a range, keeping the scan's own variation)
float nmRough(float r, float lo, float hi){ return mix(lo, hi, clamp(r, 0.0, 1.0)); }
// how much of this pixel the photoscanned near field owns: the levelled airfield, out to about a metre per pixel
float nmNearW(vec2 q, float fp){ return (1.0-smoothstep(1250.0, 1650.0, abs(q.x)))*(1.0-smoothstep(2500.0, 3100.0, abs(q.y)))*(1.0-smoothstep(0.55, 1.5, fp)); }
// the runway's paved edge (m from the centre line): concrete to 30.5, a narrow shoulder beyond
const float NM_PAVE = 30.5, NM_SHOULDER = 33.0;
// Unpaved ground and the paved shoulder share three hex-tiled sample sites (a base scan, drifted fines over it, stones
// or crust standing proud of both); which scans they read depends on where the pixel is. Materials meet by height
// (stones stand proud of sand), not by a fade.
//   ground: red-brown soil with small stones, drifts of fine sand, lag gravel and pale caliche; the bladed strip
//           beside the pavement; the service track
//   shoulder: pale weathered asphalt, sand drifting onto it from the strip, a sealed joint against the concrete
Surf nmGround(vec2 q, float fp, float wash, bool shoulder){
  float m11 = dtex(duv(11)+0.37, 11).g, m5 = dtex(duv(5)+0.5, 5).r;
  vec4 t4 = dtex(duv(4)+0.11, 4); float m4 = t4.r, m4b = t4.b;
  float ax = abs(q.x);
  float graded = 1.0-smoothstep(41.0, 47.0, ax+(m4-0.5)*5.0+(m5-0.5)*1.5);   // bladed, compacted strip beside the pavement
  float wF = max(smoothstep(0.5, 0.68, m11*0.6+m4b*0.4), wash);
  float wG = smoothstep(0.6, 0.72, m4*0.7+m5*0.3)*(1.0-graded)+0.3*graded*smoothstep(0.45, 0.8, m5);
  float wC = smoothstep(0.66, 0.78, m4b*0.55+m11*0.45)*0.9*(1.0-graded)*smoothstep(60.0, 140.0, ax);
  wF = max(wF*(1.0-graded), smoothstep(0.0, 0.5, graded));   // the strip is bladed fines (one scan), stones scattered on it
  float tr = abs(q.x+58.0), ruts = 0.0;                                          // service track west of the runway
  if (tr < 6.5 && abs(q.y) < 2200.0){
    float tk = 1.0-smoothstep(2.7, 4.6, tr+(m5-0.5)*1.4+(m4-0.5)*0.8);
    ruts = exp(-pow((tr-0.85)/0.28, 2.0))*tk;
    wF = max(wF, tk); wG = mix(wG, 0.55*smoothstep(0.45, 0.0, tr)+0.5*smoothstep(2.2, 3.4, tr), tk); wC *= 1.0-tk;
  }
  wG *= 1.0-wC; wF *= 1.0-wC;
  float axs = max(ax, abs(q.y)-1830.0+NM_PAVE);
  float drift = smoothstep(31.9, 33.2, axs+(m5-0.5)*1.2+(dtex(duv(6)+0.13, 6).r-0.5)*0.3);
  // base: asphalt on the shoulder; soil, or fine sand alone where it has taken over
  bool fines = wF > 0.985;
  int kb = shoulder ? L_ASPHALT : (fines ? L_SOIL_FINE : L_SOIL);
  Surf g = layerSample(kb);
  g.alb = nmGrade(g.alb, kb, shoulder ? NM_SHLD : (fines ? NM_FINE : NM_SOIL), shoulder ? 0.5 : 0.82);
  g.rough = shoulder ? nmRough(g.rough, 0.82, 0.97) : g.rough;
  // drifted fines over it
  float wf = shoulder ? drift*0.9 : (fines ? 0.0 : wF);
  if (wf > 0.015){ Surf f = layerSample(L_SOIL_FINE); f.alb = nmGrade(f.alb, L_SOIL_FINE, NM_FINE, 0.8); g = surfBlendH(g, f, wf, shoulder ? 0.16 : 0.22); }
  if (shoulder){
    float j = lineAA(abs(ax-NM_PAVE), 0.012, fp); g.alb = mix(g.alb, vec3(0.045), j*0.85);
    return g;
  }
  // lag gravel, or caliche crust where that leads
  float wp = max(wG, wC);
  if (wp > 0.015){
    bool cal = wC > wG; int kp = cal ? L_CALICHE : L_GRAVEL;
    Surf v = layerSample(kp); v.alb = nmGrade(v.alb, kp, cal ? NM_CALICHE : NM_GRAVEL, cal ? 0.7 : 0.8); g = surfBlendH(g, v, wp, cal ? 0.2 : 0.14);
  }
  g.rough = nmRough(g.rough, 0.86, 0.98);
  g.alb *= (0.95+0.1*m4)*(1.0-0.1*graded);                                       // the bladed strip is a shade darker (damp fines)
  g.alb *= 1.0-0.14*ruts; g.d *= 1.0-0.55*ruts; g.rough = mix(g.rough, 0.8, ruts);   // ruts: packed, tyre-smoothed
  return g;
}
// runway concrete: paving lanes 7.6 m wide, each lane its own pour and tone, each slab its own stretch of the scans;
// the broom grain runs across the runway
Surf nmConcrete(vec2 q){
  vec2 id = floor(q/vec2(7.625, 7.62));
  vec4 r = lRand(ivec2(id)+ivec2(4099, 2741)), rl = lRand(ivec2(int(id.x)+977, 31));
  vec2 fx = lFootX(), fy = lFootY();
  Surf b = layerSampleST(L_CONCRETE_BROOM, vec2(q.y, q.x)/2.5+r.xy*13.0, vec2(-fx.y, fx.x)/2.5, vec2(-fy.y, fy.x)/2.5, 1.5707963);
  Surf w = layerSampleST(L_CONCRETE_WORN, vec2(q.x, -q.y)/3.0+r.zw*11.0, fx/3.0, fy/3.0, 0.0);
  b.alb = nmGrade(b.alb, L_CONCRETE_BROOM, NM_CONC, 0.35); w.alb = nmGrade(w.alb, L_CONCRETE_WORN, NM_CONC, 0.45);
  Surf c = surfBlendH(b, w, 0.25+0.5*rl.z, 0.4);
  float m4 = dtex(duv(4)+0.23, 4).b;
  c.alb *= (0.93+0.13*rl.w)*(0.975+0.05*r.w)*(0.97+0.06*m4); c.rough = nmRough(c.rough, 0.78, 0.95);
  c.d *= 0.8;
  return c;
}
// joints (sealed between lanes, sawn across them), dust from the edges, tyre rubber, worn paint
void nmRunwayDetail(vec2 q, float fp, inout Surf c){
  float ax = abs(q.x), az = abs(q.y);
  vec2 fl = fract(q/vec2(7.625, 7.62)), dj = min(fl, 1.0-fl)*vec2(7.625, 7.62);
  // each joint antialiased with the pixel's extent across it (lane joints: x, sawn joints: z)
  vec2 fxz = max(abs(gGx), abs(gGy))*1000.0;
  vec4 n6 = dtex(duv(6)+0.71, 6); float n5 = dtex(duv(5)+0.2, 5).g;
  float jx = dj.x+(n6.r-0.5)*0.004, jz = dj.y+(n6.g-0.5)*0.003;
  float seal = lineAA(jx, 0.011, fxz.x);                                         // poured sealant between paving lanes
  float sawn = lineAA(jz, 0.0045, fxz.y)*(0.55+0.45*smoothstep(0.3, 0.6, n5));   // sawn contraction joints, part filled with dust
  // fines, sealant smear and old water stains along the joints: what makes them read from a distance
  float damp = max(lineAA(jx, 0.06, fxz.x)*(0.7+0.6*n6.b), 0.5*lineAA(jz, 0.035, fxz.y));
  float tz = smoothstep(1815.0, 1560.0, az)*smoothstep(700.0, 1250.0, az);
  float trackW = exp(-pow((ax-2.9)/1.4, 2.0))+0.25*exp(-pow(ax/0.7, 2.0));
  float streak = textureLod(tDetail, vec2(q.x*0.42, q.y*0.0035), clamp(log2(fp*0.42*512.0), 0.0, 7.0)).r;
  float rub = (tz*0.6+0.05)*trackW*smoothstep(0.35, 0.8, streak);
  float dust = smoothstep(24.0, 30.5, ax)*(0.3+0.7*dtex(duv(5)+0.61, 5).g)+0.12*smoothstep(0.6, 0.85, dtex(duv(4)+0.37, 4).g);
  dust = clamp(dust*(1.3-c.h), 0.0, 1.0);
  c.alb *= 1.0-0.2*damp;
  c.alb = mix(c.alb, NM_DUST, dust*0.38);
  float pnt = nmPaint(q, max(fp*0.5, 0.004));
  if (pnt > 0.0){   // worn off the high spots first and along the tyre tracks; dusty
    float wn = dtex(duv(6)+0.29, 6).g;
    float pc = pnt*mix(1.0, smoothstep(0.1, 0.45, 1.15-c.h+(wn-0.5)*0.5-rub*1.5), 0.5);
    c.alb = mix(c.alb, mix(NM_PAINT*(0.9+0.1*wn), NM_DUST*1.6, dust*0.3), pc);
    c.rough = mix(c.rough, 0.55, pc); c.d *= 1.0-0.5*pc; c.ao = mix(c.ao, 1.0, pc*0.5);
  }
  c.alb = mix(c.alb, vec3(0.035), rub*0.6); c.rough = mix(c.rough, 0.62, rub);
  c.alb = mix(c.alb, vec3(0.10, 0.09, 0.08), sawn*0.75); c.ao *= 1.0-0.3*sawn;
  c.alb = mix(c.alb, vec3(0.045, 0.042, 0.04), seal*0.9); c.rough = mix(c.rough, 0.5, seal); c.ao *= 1.0-0.3*seal; c.d *= 1.0-0.7*seal;
}
// the near field over the procedural ground; wash: the procedural wash channels (sand)
void nmNear(vec2 p, float fp, float dist, float wash, inout vec3 N, inout vec3 alb, inout float spec){
  vec2 q = p*1000.0;
  float wL = nmNearW(q, fp);
  if (wL <= 0.0) return;
  float w = max(fp*0.4, 0.004);
  float edge = NM_SHOULDER+(dtex(duv(5)+0.83, 5).g-0.5)*0.7+(dtex(duv(6)+0.55, 6).g-0.5)*0.12;
  float wPave = rwBox(-NM_PAVE, NM_PAVE, q.x, w)*rwBox(-1830.0, 1830.0, q.y, w);
  float wSh = rwBox(-edge, edge, q.x, w)*rwBox(-1838.0, 1838.0, q.y, w)*(1.0-wPave);
  float wGr = max(1.0-wPave-wSh, 0.0);
  Surf s = Surf(vec3(0.0), 0.5, vec2(0.0), 0.9, 1.0);
  if (wPave < 0.999){
    // the shoulder's outer edge lies under drifted sand on both sides, so the two need no cross-fade
    s = nmGround(q, fp, wash, wSh > wGr);
    // plants too small to draw: their cover tints the ground (straw where grass leads, olive where shrubs do); seen
    // at a grazing angle they hide most of it
    float lam = scrubDensity(q)*(1.0-scrubDrawn(dist*uPixAngle))/(SCRUB_PITCH*SCRUB_PITCH);
    if (lam > 0.0){
      vec3 V = -normalize(vRel);
      float gr = scrubGrassy(q)*0.86;
      float cover = 1.0-exp(-lam*mix(0.9, 0.5, gr)/max(V.y, 0.03));
      float back = smoothstep(-0.3, 0.8, dot(normalize(-V.xz), normalize(uSunDir.xz)));   // looking into the sun: silhouettes
      vec3 veg = mix(mix(vec3(0.12, 0.125, 0.075), vec3(0.34, 0.25, 0.15), gr), mix(vec3(0.04, 0.045, 0.03), vec3(0.2, 0.15, 0.09), gr), back);
      s.alb = mix(s.alb, veg, cover); s.d *= 1.0-cover;
    }
  }
  if (wPave > 0.001){ Surf c = nmConcrete(q); nmRunwayDetail(q, fp, c); if (wPave < 0.999) s = surfMix(s, c, wPave); else s = c; }
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
    N.xz += vec2(c0-c1, c0-c2)*0.08*smoothstep(60.0, 4.0, fp)*smoothstep(40.0, 70.0, abs(p.x)*1000.0);
    if (abs(p.x) < 0.045 && abs(p.y) < 1.85) N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.9));
    alb = vec3(0.3); spec = 0.0;
    if (uDebug != 7) nmNear(p, fp, dist, wash, N, alb, spec);   // (uDebug 7: profiling switch)
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
  soil = mix(soil, vec3(0.285, 0.195, 0.135)*(0.84+0.32*n3)*(0.93+0.14*n4), (1.0-smoothstep(2.5, 7.0, length(p*vec2(1.0, 0.55))))*0.85);
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
  float vcov = m1.g*vv*0.74;
#ifdef TERRAIN_LAYERS
  { // around the field, plants seen at a grazing angle hide the ground, as the drawn plants do nearer the camera
    float vy = max(-normalize(vRel).y, 0.02), kk = 1.0-smoothstep(9.0, 16.0, length(p*vec2(1.0, 0.7)));
    float clump = 0.5+1.0*smoothstep(0.3, 0.7, n4);   // shrubs gather in clumps a few metres across, bare ground between
    vcov = max(vcov, 0.9*kk*smoothstep(0.0, 0.25, m1.g)*(1.0-exp(-0.16*clump/vy)));
  }
#endif
  alb = mix(alb, vec3(0.105,0.115,0.07), vcov);
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
  height, mask, shade, scales, groundAlt: FIELD_ALT, layers, layerAniso: 8, layerAnisoB: 4,
  near: { center: [40, 8], extent: 128, res: 4096 },
  far: { center: [20, 0], extent: 1100, res: 2048 },
};
