// Western Mojave Desert, stylised from the real layout around Edwards Air Force Base (origin = main runway
// midpoint): Rogers and Rosamond dry lakes, the Antelope Valley floor, low buttes, and the basin-and-range
// country to the north and east (Rand / El Paso mountains, Cuddeback, Harper, Koehn and Searles dry lakes),
// with the Tehachapi, San Gabriel and Sierra Nevada ranges on the far rim.
// Coordinates in km: +x east, +y south. The airfield (runway, taxiways, aprons) is painted in the shading pass.
export const FIELD_ALT = 704.0;
export const RWY_HDG = 238;                 // departure heading used in the film (deg true)
const hr = RWY_HDG * Math.PI / 180;
export const FIELD_U = [Math.sin(hr), -Math.cos(hr)];   // along the runway, in (east, south)
export const FIELD_V = [Math.cos(hr), Math.sin(hr)];    // to the right of it (the flight-line side)
// parking spot used in the ramp shots, in field metres (u along the runway, v across), nose towards +v
export const SPOT = { u: 120, v: 404 };

// Optional photoscanned close-range materials (engine/terrain.js layers, textures built by blender/ground_tex.py): a
// film opts in by passing `layers: MOJAVE_LAYERS` (plus layerAniso / layerAnisoB) to its Terrain. Without them the
// recipe renders exactly as before; with them, the painted pavements and the graded ground take their grain, relief
// and fine tone variation from the scans within about a metre per pixel.
const TEX = 'shared/tex/ground/';
const layer = (name, scale, o = {}) => ({ name, scale, albedo: `${TEX}${name}_albedo.webp`, normal: `${TEX}${name}_normal.webp`, orm: `${TEX}${name}_orm.webp`, ...o });
export const MOJAVE_LAYERS = [
  layer('concrete_broom', 2.5, { rotate: 0, detail: [5, 0.8], relief: 0.003 }), layer('concrete_worn', 3.0, { rotate: 0, detail: [5, 0.8], relief: 0.003 }),
  layer('asphalt', 4.04, { detail: [6, 0.8], relief: 0.006 }), layer('soil', 2.0, { detail: [4, 1], relief: 0.028 }), layer('soil_fine', 2.48, { detail: [5, 1], relief: 0.012 }),
];

const FIELD_FN = /* glsl */`
const vec2 MJ_FU = vec2(${FIELD_U[0].toFixed(5)}, ${FIELD_U[1].toFixed(5)});
const vec2 MJ_FV = vec2(${FIELD_V[0].toFixed(5)}, ${FIELD_V[1].toFixed(5)});
vec2 mjField(vec2 p){ vec2 q = p*1000.0; return vec2(dot(q, MJ_FU), dot(q, MJ_FV)); }
`;

const height = /* glsl */`
${FIELD_FN}
const float MJ_PEAK = 1050.0;
// gaussian mask around a wandering ridge line a->b
float mjSeg(vec2 p, vec2 a, vec2 b, float w, float wob, float seed){
  vec2 ab = b-a; float L = length(ab); float t = clamp(dot(p-a,ab)/(L*L), 0.0, 1.0);
  vec2 n = vec2(-ab.y, ab.x)/L;
  float off = wob*(vnoise(vec2(t*L*0.05+seed, seed*1.7))-0.5)*2.0 + 0.3*wob*(vnoise(vec2(t*L*0.17, seed+4.1))-0.5);
  float d = length(p-(a+ab*t)-n*off)/w;
  return exp(-d*d);
}
// dry lake: irregular flat pan, 1 inside
float mjPlaya(vec2 p, vec2 c, vec2 r, float seed){
  vec2 d = (p-c)/r;
  float w = 0.30*(vnoise(p*0.13+seed)-0.5)+0.14*(vnoise(p*0.45+seed*2.0)-0.5);
  return smoothstep(1.0, 0.86, length(d)+w);
}
float mjPlayas(vec2 p){
  float m = mjPlaya(p, vec2(8.4,-4.6), vec2(5.4,9.2), 1.0);            // Rogers
  m = max(m, mjPlaya(p, vec2(-24.0,9.0), vec2(4.6,3.9), 2.0));          // Rosamond
  m = max(m, mjPlaya(p, vec2(-7.0,-57.0), vec2(5.5,2.3), 3.0));         // Koehn
  m = max(m, mjPlaya(p, vec2(40.0,-47.0), vec2(3.3,4.4), 4.0));         // Cuddeback
  m = max(m, mjPlaya(p, vec2(46.5,-12.0), vec2(4.2,3.0), 5.0));         // Harper
  m = max(m, mjPlaya(p, vec2(12.0,38.0), vec2(4.2,2.1), 6.0));          // El Mirage
  m = max(m, mjPlaya(p, vec2(48.0,-101.0), vec2(6.0,10.0), 7.0));       // Searles
  m = max(m, mjPlaya(p, vec2(21.0,-97.0), vec2(4.0,4.2), 8.0));         // China Lake
  m = max(m, mjPlaya(p, vec2(79.0,-37.0), vec2(3.2,3.0), 9.0));         // Superior
  m = max(m, mjPlaya(p, vec2(62.0,-62.0), vec2(2.4,3.4), 10.0));
  m = max(m, mjPlaya(p, vec2(26.0,-33.0), vec2(1.7,1.2), 11.0));
  m = max(m, mjPlaya(p, vec2(17.5,-62.0), vec2(2.2,1.4), 12.0));
  return m;
}
// x: basin + bajada surface (m), y: mountain weight 0..~1.6, z: bajada weight
vec3 mjMacro(vec2 p){
  float h = 706.0 + 70.0*(vnoise(p*0.010+vec2(1.3,5.7))-vnoise(vec2(1.3,5.7))) + 18.0*(vnoise(p*0.05+21.0)-vnoise(vec2(21.0)));
  h += 2.2*max(p.y, 0.0) + 0.9*max(-p.x-10.0, 0.0);                    // valley floor climbs towards the San Gabriels and Tehachapis
  h -= 1.4*clamp(-p.y-20.0, 0.0, 70.0);                                 // and falls away north into Fremont / Searles valleys
  float mt = 0.0, bj = 0.0, k;
  k = mjSeg(p, vec2(-42.0,-34.0), vec2(-104.0,16.0), 9.0, 5.0, 1.0)*(0.75+0.5*vnoise(p*0.05+3.0)); mt = max(mt,k);   // Tehachapi
  bj = max(bj, mjSeg(p, vec2(-42.0,-34.0), vec2(-104.0,16.0), 23.0, 5.0, 1.0));
  k = mjSeg(p, vec2(-70.0,72.0), vec2(62.0,84.0), 9.5, 5.0, 2.0)*(0.9+0.6*vnoise(p*0.045+7.0)); mt = max(mt,k);       // San Gabriel
  bj = max(bj, mjSeg(p, vec2(-70.0,72.0), vec2(62.0,84.0), 26.0, 5.0, 2.0));
  k = mjSeg(p, vec2(62.0,84.0), vec2(140.0,70.0), 10.0, 5.0, 3.0)*(0.9+0.6*vnoise(p*0.04+9.0)); mt = max(mt,k);       // San Bernardino
  bj = max(bj, mjSeg(p, vec2(62.0,84.0), vec2(140.0,70.0), 26.0, 5.0, 3.0));
  k = mjSeg(p, vec2(-50.0,-50.0), vec2(-62.0,-250.0), 15.0, 7.0, 4.0)*(1.0+0.6*vnoise(p*0.03+2.0)); mt = max(mt,k);   // Sierra Nevada
  bj = max(bj, mjSeg(p, vec2(-50.0,-50.0), vec2(-62.0,-250.0), 34.0, 7.0, 4.0));
  k = mjSeg(p, vec2(-22.0,-63.0), vec2(12.0,-53.0), 3.8, 2.0, 5.0)*(0.42+0.24*vnoise(p*0.2+5.0)); mt = max(mt,k);     // El Paso
  bj = max(bj, 0.7*mjSeg(p, vec2(-22.0,-63.0), vec2(12.0,-53.0), 10.0, 2.0, 5.0));
  k = mjSeg(p, vec2(15.0,-55.0), vec2(43.0,-40.0), 3.6, 2.0, 6.0)*(0.46+0.26*vnoise(p*0.22+8.0)); mt = max(mt,k);     // Rand
  bj = max(bj, 0.7*mjSeg(p, vec2(15.0,-55.0), vec2(43.0,-40.0), 9.5, 2.0, 6.0));
  k = mjSeg(p, vec2(34.0,-22.0), vec2(53.0,-31.0), 2.8, 1.5, 7.0)*(0.30+0.2*vnoise(p*0.25+1.0)); mt = max(mt,k);      // Fremont Peak, Black Hills
  bj = max(bj, 0.5*mjSeg(p, vec2(34.0,-22.0), vec2(53.0,-31.0), 7.5, 1.5, 7.0));
  k = mjSeg(p, vec2(66.0,-30.0), vec2(104.0,-8.0), 4.6, 3.0, 8.0)*(0.38+0.24*vnoise(p*0.15+4.0)); mt = max(mt,k);     // Calico / Paradise
  bj = max(bj, 0.7*mjSeg(p, vec2(66.0,-30.0), vec2(104.0,-8.0), 12.0, 3.0, 8.0));
  k = mjSeg(p, vec2(50.0,-74.0), vec2(70.0,-48.0), 3.6, 2.0, 9.0)*(0.4+0.2*vnoise(p*0.2+6.0)); mt = max(mt,k);        // Lava Mountains
  bj = max(bj, 0.6*mjSeg(p, vec2(50.0,-74.0), vec2(70.0,-48.0), 9.0, 2.0, 9.0));
  k = mjSeg(p, vec2(28.0,-78.0), vec2(36.0,-118.0), 4.0, 2.5, 10.0)*(0.5+0.3*vnoise(p*0.13+2.0)); mt = max(mt,k);     // Spangler / Argus
  bj = max(bj, 0.7*mjSeg(p, vec2(28.0,-78.0), vec2(36.0,-118.0), 11.0, 2.5, 10.0));
  k = mjSeg(p, vec2(64.0,-90.0), vec2(74.0,-200.0), 9.0, 5.0, 11.0)*(0.8+0.5*vnoise(p*0.05+1.0)); mt = max(mt,k);     // Slate / Panamint
  bj = max(bj, mjSeg(p, vec2(64.0,-90.0), vec2(74.0,-200.0), 22.0, 5.0, 11.0));
  k = mjSeg(p, vec2(24.0,21.0), vec2(46.0,30.0), 2.6, 2.0, 12.0)*(0.2+0.14*vnoise(p*0.25+3.0)); mt = max(mt,k);       // Shadow Mountains
  bj = max(bj, 0.5*mjSeg(p, vec2(24.0,21.0), vec2(46.0,30.0), 7.0, 2.0, 12.0));
  // isolated buttes on the valley floor
  k = mjSeg(p, vec2(15.5,-12.0), vec2(22.0,-4.5), 1.5, 0.8, 13.0)*0.13; mt = max(mt,k);
  k = mjSeg(p, vec2(-14.0,-8.0), vec2(-8.0,-3.5), 1.5, 0.8, 14.0)*0.11; mt = max(mt,k);
  k = mjSeg(p, vec2(-30.0,-9.0), vec2(-27.0,-5.0), 1.2, 0.5, 15.0)*0.22; mt = max(mt,k);
  k = mjSeg(p, vec2(28.0,-2.0), vec2(40.0,6.0), 2.2, 1.0, 16.0)*0.13; mt = max(mt,k);
  k = mjSeg(p, vec2(-2.0,13.0), vec2(6.0,17.0), 1.3, 0.6, 17.0)*0.09; mt = max(mt,k);
  k = smoothstep(0.78, 0.93, vnoise(p*0.085+31.0))*0.2*smoothstep(7.0, 16.0, length(p)); mt = max(mt,k);
  // generic basin-and-range beyond the mapped area
  float far = smoothstep(120.0, 190.0, max(abs(p.x-20.0), abs(p.y+40.0)));
  k = far*smoothstep(0.5, 0.8, vnoise(vec2(p.x*0.012, p.y*0.02)+17.0)); mt = max(mt,k); bj = max(bj, far*0.5);
  h += bj*210.0;
  return vec3(h, mt, bj);
}
float mjBody(vec2 p, float mt, int oct){ return mt*(0.30+0.95*ridged(p*0.23+9.0, oct))*MJ_PEAK; }
float mjShape(vec2 p){ vec3 m = mjMacro(p); return m.x+mjBody(p, m.y, 4); }
vec2 mjSlope(vec2 p){ float e = 0.25;
  return vec2(mjShape(p+vec2(e,0.0))-mjShape(p-vec2(e,0.0)), mjShape(p+vec2(0.0,e))-mjShape(p-vec2(0.0,e)))/(2.0*e*1000.0); }
// 1 on the levelled airfield
float mjFieldFlat(vec2 p){ vec2 f = mjField(p); return smoothstep(1.0, 0.62, max(abs(f.x)/3300.0, abs(f.y-240.0)/1250.0)); }
float terrainH(vec2 p, float lod){
  vec3 m = mjMacro(p);
  vec2 g = mjSlope(p);
  float er = erosion(p*0.9, g*4.4, 1.35, 5, lod*0.9);
  float hm = mjBody(p, m.y, 6)+(er-0.5)*min(m.y,1.0)*540.0;
  float st = hm/120.0; float tq = (floor(st)+smoothstep(0.15,0.85,fract(st)))*120.0;      // benches along the bedding
  hm = mix(hm, tq, 0.35*smoothstep(0.08,0.35,m.y));
  float h = m.x+max(hm, -30.0*m.y);
  h += (er-0.5)*m.z*(1.0-min(m.y,1.0))*20.0;                 // arroyos on the fans
  h += 2.0*(vnoise(p*1.9)-0.5) + (lod<0.06 ? 0.6*(vnoise(p*9.0)-0.5) : 0.0);
  // dry lakes: dead-flat pans a little below their surroundings
  float P = mjPlayas(p);
  if (P > 0.0){ float lvl = 699.0+30.0*(vnoise(p*0.012+40.0)-0.5)*step(16.0, length(p-vec2(8.4,-4.6))); h = mix(h, min(h, lvl), P); }
  h = mix(h, ${FIELD_ALT.toFixed(1)}, mjFieldFlat(p));
  return h;
}
`;

const mask = /* glsl */`
void terrainMask(vec2 p, float h, vec2 grad, float lod, out vec4 m0, out vec4 m1){
  vec3 m = mjMacro(p);
  float er = erosion(p*0.9, mjSlope(p)*4.4, 1.35, 5, lod*0.9);
  float P = mjPlayas(p)*(1.0-mjFieldFlat(p));
  float slope = length(grad);
  // dark volcanic rock on some of the low ranges
  float dark = smoothstep(0.55, 0.8, vnoise(p*0.06+50.0))*smoothstep(0.03, 0.15, slope)*0.8;
  float veg = (0.30+0.5*vnoise(p*0.14+9.0))*(1.0-smoothstep(0.06, 0.3, slope));
  veg = max(veg, smoothstep(1500.0, 2300.0, h)*0.9);          // pinyon / forest on the high ranges
  veg *= (1.0-P);
  // irrigated circles and fields in the Antelope Valley, west of the base
  vec2 q = p-vec2(-44.0, 14.0); vec2 cell = floor(q/0.82); vec2 lc = fract(q/0.82)-0.5;
  float on = step(0.62, hash12(cell+7.0))*smoothstep(15.0, 9.0, length(q/vec2(1.5,1.0)));
  float green = on*smoothstep(0.47, 0.44, length(lc))*(0.4+0.6*hash12(cell+3.0));
  m0 = vec4(P, dark, er, 1.0);
  m1 = vec4(0.0, veg, green, 0.0);
}
`;

// detail slots: 0-6 isotropic octaves, 7/8 stretched wash networks, 9 patchiness, 10 warp, 11 shrub presence
const scales = [0.004, 0.02, 0.17, 1.3, 11, 90, 700, [0.085, 0.02], [0.36, 0.09], 0.75, 0.045, 5.5];

const shade = /* glsl */`
${FIELD_FN}
float lineAA(float d, float w, float fp){ return (1.0-smoothstep(w, w+fp*1.2, d))*min(1.0, w/max(fp*0.7,1e-5)); }
float rwBox(float a, float b, float x, float w){ return smoothstep(a-w, a+w, x)-smoothstep(b-w, b+w, x); }
// painted stripe of half-width hw about d = 0; fades out instead of shimmering once it is thinner than a pixel
float stripe(float d, float hw, float w){ return (1.0-smoothstep(hw-w, hw+w, abs(d)))*min(1.0, hw/max(w*0.8, 1e-5)); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
float sq(float x){ return x*x; }
// detail noise at k cycles per metre with a mip level chosen from the pixel footprint (no screen derivatives here)
vec4 dn(vec2 q, float k, float fp){ return textureLod(tDetail, q*k, clamp(log2(max(fp*k*512.0, 1.0)), 0.0, 8.0)); }

// x: runway, y: taxiways, z: aprons, w: asphalt shoulders and overruns. f: field metres (along, across)
vec4 mjPaveMask(vec2 f, float w){
  float rw = rwBox(-45.7, 45.7, f.y, w)*rwBox(-2290.0, 2290.0, f.x, w);
  float sh = rwBox(-54.0, 54.0, f.y, w)*rwBox(-2400.0, 2400.0, f.x, w);
  float tw = rwBox(228.0, 251.0, f.y, w)*rwBox(-2290.0, 2290.0, f.x, w);
  float cu = min(min(abs(f.x+2262.0), abs(f.x+1150.0)), min(abs(f.x-1150.0), abs(f.x-2262.0)));
  cu = min(cu, abs(f.x-40.0));
  tw = max(tw, (1.0-smoothstep(11.5-w, 11.5+w, cu))*rwBox(45.7, 240.0, f.y, w));
  float ap = rwBox(-650.0, 650.0, f.x, w)*rwBox(251.0, 590.0, f.y, w);
  ap = max(ap, rwBox(880.0, 1500.0, f.x, w)*rwBox(251.0, 430.0, f.y, w));
  sh = max(sh, rwBox(222.0, 257.0, f.y, w)*rwBox(-2296.0, 2296.0, f.x, w));
  sh = max(sh, rwBox(-656.0, 656.0, f.x, w)*rwBox(245.0, 596.0, f.y, w));
  return vec4(rw, tw, ap, sh);
}
// jointed concrete: rgb albedo, a = gloss multiplier. size: slab edge (m)
vec4 mjConcrete(vec2 f, float size, float fp, vec3 base, float n5, float n6, float n7){
  vec2 s = f/size, g = abs(fract(s)-0.5), id = floor(s);
  float jw = max(fp/size, 0.0012);
  float wob = 0.0012*(n7-0.5)*2.0;
  float joint = smoothstep(0.5-0.0026-wob-jw, 0.5-jw*0.3, max(g.x,g.y))*clamp(0.011/jw, 0.0, 1.0);
  float hsh = h21(id), tone = 0.88+0.22*hsh, near = clamp(5.0/max(fp,0.01), 0.0, 1.0);
  tone = mix(1.0, tone, near);
  vec3 c = base*tone*(0.8+0.25*n5)*(0.9+0.2*n6)*(0.93+0.14*n7);
  // a few replaced slabs (paler, smoother) and patched ones (darker)
  float fresh = step(0.94, hsh)*near, patchd = step(hsh, 0.045)*near;
  c = mix(c, base*vec3(1.16,1.15,1.12), fresh*0.7); c *= 1.0-0.3*patchd;
  // weathering runs with the slab: darker towards the joints where water sits
  float edge = smoothstep(0.34, 0.5, max(g.x,g.y));
  c *= 1.0-0.10*edge*near;
  c = mix(c, vec3(0.085,0.08,0.075), joint*0.85);
  return vec4(c, (0.75+0.5*hsh)*(1.0-0.5*joint)+0.5*fresh);
}
// Main runway: 4,580 x 91 m concrete, painted markings, rubber in the touchdown zones. f.x along, f.y across.
vec4 mjRunway(vec2 f, float fp, float n5, float n6, float n7){
  float ax = abs(f.y), az = abs(f.x), w = max(fp*0.6, 0.012);
  vec4 cc = mjConcrete(f, 7.62, fp, vec3(0.47,0.46,0.43), n5, n6, n7); vec3 c = cc.rgb;
  float tz = smoothstep(2250.0,1980.0,az)*smoothstep(1250.0,1650.0,az);
  float streak = dn(vec2(f.y, f.x*0.011), 0.35, fp).r;
  float track = exp(-sq((ax-4.2)/2.2))+0.4*exp(-sq(ax/1.4));
  c = mix(c, vec3(0.07), tz*track*smoothstep(0.25,0.8,streak)*0.5);
  float paint = rwBox(43.3, 44.2, ax, w);
  paint = max(paint, stripe(f.y, 0.45, w)*rwBox(0.0, 36.6, mod(f.x+2290.0, 61.0), w)*step(az, 2195.0));
  paint = max(paint, rwBox(2215.0, 2262.0, az, w)*rwBox(2.0, 41.0, ax, w)*rwBox(0.0, 0.5, fract(ax/3.6), w/3.6));
  paint = max(paint, rwBox(1940.0, 1986.0, az, w)*rwBox(10.0, 21.0, ax, w));
  paint = max(paint, rwBox(0.0, 22.5, mod(az-1390.0, 150.0), w)*step(1380.0, az)*step(az, 1900.0)*rwBox(9.0, 16.5, ax, w)*rwBox(0.0, 0.62, fract((ax-9.0)/2.5), w/2.5));
  paint = max(paint, rwBox(2117.0, 2140.0, az, w)*rwBox(9.0, 16.5, ax, w)*rwBox(0.0, 0.62, fract((ax-9.0)/2.5), w/2.5));
  c = mix(c, vec3(0.84,0.83,0.78)*(0.5+0.5*n6), paint*0.92*(1.0-0.5*tz*track));
  return vec4(c, cc.a*(1.0+0.6*tz*track));
}
vec4 mjTaxiway(vec2 f, float fp, float n5, float n6, float n7){
  float w = max(fp*0.6, 0.01);
  vec4 cc = mjConcrete(f+vec2(3.1,1.7), 7.62, fp, vec3(0.44,0.43,0.405), n5, n6, n7); vec3 c = cc.rgb;
  // centre lines: along the parallel taxiway and down each connector
  float cu = min(min(abs(f.x+2262.0), abs(f.x+1150.0)), min(abs(f.x-1150.0), abs(f.x-2262.0))); cu = min(cu, abs(f.x-40.0));
  float d = f.y > 226.0 ? abs(f.y-239.5) : cu;
  float wear = 0.45+0.55*n6;
  c = mix(c, vec3(0.05), stripe(d, 0.16, w)*0.55);
  c = mix(c, vec3(0.80,0.60,0.07)*wear, stripe(d, 0.075, w)*0.9);
  float tr = dn(vec2(d, f.x+f.y), 0.3, fp).g;
  c *= 1.0-0.22*exp(-sq((d-2.4)/1.3))*smoothstep(0.3, 0.7, tr);                  // tyre-polished band either side
  return vec4(c, cc.a);
}
// ---------------------------------------------------------------- photoscanned asphalt (blender/fury_ground.py)
precision highp sampler2DArray;
uniform sampler2DArray tGround;   // per material: albedo (sRGB) | normal x,y + roughness | height, occlusion, cavity
uniform vec4 uGround;             // x: metres per scan tile, y: 1 when the scan is loaded
uniform vec4 uAcAO;               // aircraft standing on the pavement: world x, z (m), heading (rad from north), strength
uniform vec4 uAcGear;             // its gear in body metres: nose-wheel x, main-wheel x, main-wheel half track, tyre width
mat2 gRot(vec2 v){ float a = h21(v*0.731+vec2(3.1, 7.7))*6.2831853; float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
// Hex-tiled read (after Mikkelsen 2022): three randomly turned and shifted copies of the scan blended across a
// triangle grid, so the 3 m scan never repeats visibly. st: position in scan tiles; dx, dy: pixel footprint (tiles);
// L: first layer of the material; full: also read the height / occlusion layer (close up only).
void gScan(vec2 st, vec2 dx, vec2 dy, float L, bool full, out vec3 alb, out vec2 nxy, out float rough, out vec3 hac){
  vec2 s = st*1.55;
  vec2 sk = vec2(s.x-0.57735027*s.y, 1.15470054*s.y);
  vec2 b = floor(sk); vec3 t = vec3(fract(sk), 0.0); t.z = 1.0-t.x-t.y;
  float sg = step(0.0, -t.z), s2 = 2.0*sg-1.0;
  vec3 w = max(vec3(-t.z*s2, sg-t.y*s2, sg-t.x*s2), 0.0);
  w = w*w*w; w = w*w; w /= max(dot(w, vec3(1.0)), 1e-6);          // ^6: narrow seams between the copies
  alb = vec3(0.0); nxy = vec2(0.0); rough = 0.0; hac = vec3(0.0);
  for (int i=0;i<3;i++){
    vec2 v = b+(i==0 ? vec2(sg) : (i==1 ? vec2(sg, 1.0-sg) : vec2(1.0-sg, sg)));
    float wi = i==0 ? w.x : (i==1 ? w.y : w.z);
    if (wi < 0.003) continue;
    vec2 cen = vec2(v.x+0.5*v.y, 0.8660254*v.y)/1.55;
    mat2 R = gRot(v);
    vec2 uv = R*(st-cen)+cen+vec2(h21(v+0.19), h21(v.yx+5.3));
    vec2 gx = R*dx, gy = R*dy;
    alb += textureGrad(tGround, vec3(uv, L), gx, gy).rgb*wi;
    vec3 n = textureGrad(tGround, vec3(uv, L+1.0), gx, gy).rgb;
    nxy += (transpose(R)*(n.rg*2.0-1.0))*wi; rough += n.b*wi;
    if (full) hac += textureGrad(tGround, vec3(uv, L+2.0), gx, gy).rgb*wi;
  }
  alb = pow(alb, vec3(2.2));
  if (!full) hac = vec3(0.5, 1.0, 0.5);
}
// Sky light the aircraft takes from the pavement under it, and the dark line where each tyre meets the ground, as an
// albedo multiplier: full occlusion where the aircraft also shades the sun, much less where the low sun gets under it.
float acOcclusion(vec2 wxz){
  if (uAcAO.w <= 0.0) return 1.0;
  vec2 d = wxz-uAcAO.xy; float s = sin(uAcAO.z), c = cos(uAcAO.z);
  float lx = dot(d, vec2(s, -c)), lz = dot(d, vec2(c, s));          // body metres: forward, right
  if (abs(lx) > 9.0 || abs(lz) > 6.0) return 1.0;
  float fus = exp(-sq(lz/0.9))*smoothstep(-5.4, -3.6, lx)*smoothstep(5.8, 3.2, lx);
  float wng = exp(-sq(lz/3.0))*exp(-sq((lx+0.5)/1.8));
  float occ = clamp(fus*0.5+wng*0.22, 0.0, 0.62);
  float tyre = exp(-sq((lx-uAcGear.x)/0.12)-sq(lz/(uAcGear.w*0.55)));
  tyre = max(tyre, exp(-sq((lx-uAcGear.y)/0.15)-sq((abs(lz)-uAcGear.z)/(uAcGear.w*0.55))));
  float sh = heroShadow(vRel+vec3(0.0, 0.04, 0.0));
  float g = mix(1.0-occ, 1.0-0.28*occ, sh)*(1.0-0.7*tyre);
  return mix(1.0, g, uAcAO.w);
}
// Apron in asphalt, as on the Edwards flight line in released photographs: the scan, laid in 3.66 m paving lanes with
// their construction joints; transverse thermal cracks, most filled with sealant; saw-cut patches; oil and hydraulic
// stains that gather where aircraft stand; rubber along the lead-in lines; worn yellow paint; tie-down collars; sand.
// f: field metres; a: metres from the parking spot (x along the runway axis, y towards the parked aircraft's nose);
// wxz: world metres. Returns albedo (rgb) and gloss (a); Nt receives the surface tilt (world x, z).
vec4 mjApron(vec2 f, vec2 a, vec2 wxz, float fp, float n6, float n7, out vec2 Nt){
  float w = max(fp*0.6, 0.0015);
  float near = clamp(3.0/max(fp, 0.01), 0.0, 1.0);
  // ---- the scan, fading to its mean where a pixel covers more than a few centimetres
  vec3 c = vec3(0.118, 0.116, 0.104); vec2 nxy = vec2(0.0); float rough = 0.77; float hgt = 0.5, cav = 0.5, aoS = 1.0;
  const float LIFT = 1.32;          // the scan is a little darker than the sun-bleached desert apron
  float kd = uGround.y*smoothstep(0.75, 0.22, fp);
  if (kd > 0.0){
    vec3 sa, sh; vec2 sn; float sr; float tile = uGround.x;
    gScan(wxz/tile, gGx*(1000.0/tile), gGy*(1000.0/tile), 0.0, fp < 0.05, sa, sn, sr, sh);
    float kh = smoothstep(0.05, 0.02, fp);
    c = mix(c, sa, kd); nxy = sn*kd; rough = mix(rough, sr, kd);
    hgt = mix(0.5, sh.x, kh); aoS = mix(1.0, sh.y, kh); cav = mix(0.5, sh.z, kh);
  }
  float gl = mix(1.35, 0.22, rough);
  vec2 tilt = nxy*smoothstep(0.9, 0.06, fp);
  // ---- macro tone: paving lanes, sun-bleached oxidation, newer overlays
  float lv = (f.y-251.0)/3.66, lane = floor(lv), lfr = fract(lv);
  float tone = (0.93+0.14*h21(vec2(lane, 3.7)))*(0.84+0.32*dn(f, 0.011, fp).r)*(0.9+0.2*dn(f+vec2(41.0, 7.0), 0.07, fp).g);
  c *= tone*LIFT;
  // lane construction joint: a straight seam, slightly darker and open, intermittently sealed
  float dj = min(lfr, 1.0-lfr)*3.66+(dn(vec2(f.x, lane*13.7), 0.7, fp).r-0.5)*0.02;
  float jSeal = smoothstep(0.45, 0.6, dn(vec2(f.x*0.4, lane*7.3), 0.05, fp).r);
  // transverse cracks every 7 to 16 m, wandering across the lanes
  float cx = f.x/11.0, ci = floor(cx), dmin = 1.0e3, sdm = 0.0, cs = 0.0, ck = 0.0;
  for (int k=-1;k<=1;k++){
    float i = ci+float(k);
    float xc = (i+0.5+0.62*(h21(vec2(i, 1.3))-0.5))*11.0;
    float wob = (dn(vec2(i*7.31, f.y), 0.085, fp).r-0.5)*2.4+(dn(vec2(i*3.1, f.y), 0.55, fp).g-0.5)*0.36+(dn(vec2(i*1.7, f.y), 4.1, fp).r-0.5)*0.035;
    float pres = step(0.2, h21(vec2(i, lane)));
    float sd = f.x-xc-wob, dd = abs(sd)+(1.0-pres)*1.0e3;
    if (dd < dmin){ dmin = dd; sdm = sd; cs = h21(vec2(i, 9.1)); ck = i; }
  }
  // sealant: black, glossy, a little proud of the surface; fresh where cs is low, dusted grey where it is old
  float hwS = 0.024+0.034*dn(vec2(f.y*0.9, ck*5.1), 0.6, fp).g;
  float sealT = stripe(dmin, hwS, w)*step(0.25, cs);
  float sealJ = stripe(dj, 0.03+0.02*n7, w)*jSeal;
  float seal = max(sealT, sealJ);
  float crack = max(lineAA(dmin, 0.0025, fp)*(1.0-step(0.25, cs)), lineAA(dj, 0.002, fp)*(1.0-jSeal)*0.7)*near;
  // saw-cut patches: newer, darker asphalt with a sealed edge
  vec2 pcl = floor(f/vec2(27.0, 19.0)), pr = f/vec2(27.0, 19.0)-pcl;
  float ph = h21(pcl+11.0);
  vec2 p0 = vec2(0.25+0.5*h21(pcl+2.0), 0.25+0.5*h21(pcl+5.0)), ps = vec2(0.05+0.18*h21(pcl+8.0), 0.07+0.2*h21(pcl+9.0));
  vec2 pdm = (abs(pr-p0)-ps)*vec2(27.0, 19.0);
  float pdist = max(pdm.x, pdm.y), inP = step(0.8, ph)*(1.0-smoothstep(-w, w, pdist));
  c = mix(c, c*0.5+vec3(0.004), inP); gl = mix(gl, gl*1.25, inP);
  seal = max(seal, step(0.8, ph)*stripe(pdist, 0.018, w));
  // where aircraft stand: oil and hydraulic stains, drips under the engine bay and gear
  float sx = mod(a.x+18.0, 36.0)-18.0;
  float under = exp(-sq(sx/3.4))*exp(-sq((a.y+1.2)/5.8));
  float blot = smoothstep(0.55, 0.75, dn(f+vec2(7.0, 3.0), 0.23, fp).r*0.65+dn(f, 1.1, fp).g*0.35);
  float st = blot*under*0.6;
  st = max(st, 0.4*smoothstep(0.74, 0.88, dn(f+vec2(19.0, 41.0), 0.045, fp).r)*smoothstep(0.45, 0.65, dn(f, 0.33, fp).g));
  // drips: sparse round spots, one chance per 0.32 m cell, densest under the engine bay
  vec2 dcl = floor(f/0.32), dpp = f/0.32-dcl, dctr = vec2(h21(dcl+3.1), h21(dcl+7.7))*0.6+0.2;
  float dR = (0.018+0.04*h21(dcl+1.3))/0.32, dd = length(dpp-dctr)/dR;
  float dEnv = exp(-sq(sx/1.5))*exp(-sq((a.y+2.6)/2.2));
  float drips = (1.0-smoothstep(0.6, 1.0, dd))*step(h21(dcl+9.2), 0.35*dEnv)*near;
  drips = max(drips, 0.5*(1.0-smoothstep(0.75, 1.6, dd))*step(h21(dcl+9.2), 0.35*dEnv)*near);
  c *= 1.0-0.45*st; gl += 0.9*st;
  c = mix(c, c*0.35, drips*0.85); gl += 1.4*drips;
  // rubber: main-gear tracks into each stand, sweeping turns, and the taxilane's worn band
  float tl = abs(f.y-330.0);
  vec2 ac = vec2(sx-12.0, a.y+62.0); float ar = length(ac);
  float onArc = (ac.x <= 0.0 && ac.y <= 0.0) ? 1.0 : 0.0, onStr = (a.y > -62.0 && a.y < 1.95) ? 1.0 : 0.0;
  float tb = dn(vec2(f.x, f.y*0.07), 0.6, fp).g, tb2 = dn(vec2(f.x*0.06, f.y), 0.45, fp).r;
  float rub = onStr*(exp(-sq((abs(sx)-0.86)/0.11))*0.9+exp(-sq((abs(sx)-1.18)/0.13))*0.7+exp(-sq((abs(sx)-2.0)/0.2))*0.4)*smoothstep(0.3, 0.7, tb);
  rub = max(rub, onArc*(exp(-sq((ar-11.1)/0.16))+exp(-sq((ar-12.9)/0.16)))*smoothstep(0.3, 0.7, dn(f, 0.31, fp).g)*0.8);
  rub = max(rub, (exp(-sq((tl-0.95)/0.25))+exp(-sq((tl-1.6)/0.35))*0.8)*smoothstep(0.3, 0.75, tb2));
  c = mix(c, c*0.55+vec3(0.006), rub*0.7*near); gl += 0.45*rub;
  // paint (yellow): taxilane centre line, lead-in arc and line, nose-wheel stop bar, apron edge lines, a stand spot.
  // Tyres and sun wear it off the aggregate tops first, so the scan shows through.
  float lead = min(onArc > 0.5 ? abs(ar-12.0) : 1.0e3, onStr > 0.5 ? abs(sx) : 1.0e3);
  float yl = max(stripe(min(tl, lead), 0.075, w), stripe(abs(f.y-262.0), 0.075, w));
  yl = max(yl, stripe(abs(f.y-262.45), 0.075, w));
  yl = max(yl, (abs(sx) < 0.75 ? 1.0 : 0.0)*stripe(a.y-1.95, 0.15, w));
  float spot = 1.0-smoothstep(0.42-w, 0.42+w, length(vec2(sx, (a.y-7.6)*1.6)));
  float wear = 0.35+0.4*smoothstep(0.3, 0.75, n6+0.3*(n7-0.5))+0.35*max(rub, 0.0);
  float flake = smoothstep(0.6, 0.72, dn(f+vec2(9.0, 2.0), 2.8, fp).g)*near;
  float pv = max(yl, spot*0.95)*(1.0-wear*smoothstep(0.52, 0.78, hgt))*(1.0-flake*0.8);
  vec3 paint = mix(vec3(0.44, 0.27, 0.02), vec3(0.55, 0.19, 0.02), spot)*(0.7+0.3*n7);
  paint = mix(paint, c*2.0, 0.18+0.3*smoothstep(0.4, 0.8, dn(f, 0.19, fp).r));  // grime and tyre rubber over the paint
  c = mix(c, paint, pv*0.93); gl = mix(gl, 0.85, pv); tilt *= 1.0-0.65*pv;
  // stand corner brackets (white)
  { float bx = abs(sx), by = abs(a.y-0.2);
    float lx = (by > 6.5 && by < 8.05) ? abs(bx-6.5) : 1.0e3, ly = (bx > 5.0 && bx < 6.55) ? abs(by-8.0) : 1.0e3;
    float wv = stripe(min(lx, ly), 0.05, w)*(1.0-wear*smoothstep(0.52, 0.78, hgt));
    c = mix(c, vec3(0.62, 0.61, 0.58)*(0.75+0.25*n7), wv*0.85); gl = mix(gl, 0.85, wv); }
  // sealant on top of everything it crosses
  float sealAge = smoothstep(0.25, 1.0, cs);
  vec3 sealC = mix(vec3(0.018, 0.017, 0.016), vec3(0.06, 0.055, 0.05), sealAge*0.7)*(0.85+0.3*n7);
  c = mix(c, sealC, seal*0.96); gl = mix(gl, mix(2.4, 1.2, sealAge), seal); tilt *= 1.0-0.85*seal;
  c = mix(c, vec3(0.02), crack*0.85);
  // the sealant band stands a few millimetres proud: its rounded edges catch the low sun
  { float e = stripe(dmin, hwS+0.006, w)-sealT; float sgn = sign(sdm);
    vec2 fu = vec2(MJ_FU.x, MJ_FU.y);
    tilt += fu*sgn*e*0.35*near; }
  // tie-down collars: a concrete ring with a steel bar, on a 7.6 m grid around the stands
  { vec2 q = a+vec2(3.81, 3.81), cell = floor(q/7.62), tq = (fract(q/7.62)-0.5)*7.62;
    float pres = step(0.42, h21(cell*1.7+0.3));
    float r = length(tq);
    float coll = (1.0-smoothstep(0.29-w, 0.29+w, r))*pres;
    float ring = stripe(r-0.105, 0.014, w)*pres, hole = (1.0-smoothstep(0.09-w, 0.09+w, r))*pres;
    float bar = stripe(tq.y, 0.012, w)*step(r, 0.1)*pres;
    vec3 conc = vec3(0.30, 0.29, 0.27)*(0.8+0.4*c.g/0.12);
    c = mix(c, conc, coll*0.9); gl = mix(gl, 0.5, coll);
    c = mix(c, vec3(0.025), max(ring, hole*0.7)*0.9);
    c = mix(c, vec3(0.16, 0.085, 0.045), bar*0.9);
    tilt += normalize(tq+1e-5)*stripe(r-0.29, 0.02, w)*0.25*pres*near; }
  // slot drain across the apron
  { float dr = abs(f.y-498.0), drain = 1.0-smoothstep(0.16-w, 0.16+w, dr);
    c = mix(c, vec3(0.045)*(0.6+0.8*step(0.5, fract(f.x/0.06))*clamp(0.03/max(fp, 1e-3), 0.0, 1.0)), drain*0.92);
    c *= 1.0-0.14*exp(-dr/1.6)*(0.5+0.5*n6); gl = mix(gl, 0.4, drain); }
  // wind-blown sand: in the low spots of the surface, along seams and sealant edges, drifted against the apron edges
  float sandA = smoothstep(0.42, 0.66, dn(f+vec2(5.0, 1.0), 0.06, fp).g)*0.55+0.45*smoothstep(0.7, 0.88, dn(f, 0.014, fp).r);
  float valley = smoothstep(0.5, 0.3, hgt);
  float edgeS = stripe(dmin, hwS+0.05, w)*(1.0-seal)*0.6+exp(-min(abs(f.y-251.0), abs(f.y-590.0))/2.5)*0.6;
  float sand = clamp(sandA*mix(0.25, valley, step(fp, 0.05))*0.75+edgeS*sandA, 0.0, 1.0);
  c = mix(c, vec3(0.43, 0.35, 0.26)*(0.9+0.2*n7), sand*0.6); gl = mix(gl, 0.25, sand*0.8); tilt *= 1.0-0.5*sand;
  c *= mix(1.0, aoS, 0.6);
  Nt = tilt;
  return vec4(c, gl);
}

void shadeTerrain(vec2 p, float h, inout vec3 N, float lap, vec4 m0, vec4 m1, float fp, float dist, out vec3 alb, out float spec){
  float slope = 1.0-N.y; float fk = fp*0.001;
  float n1 = dtex(duv(0), 0).r, n2 = dtex(duv(1)+0.3, 1).g;
  float n3 = dtex(duv(2), 2).r, n4 = dtex(duv(3)+0.7, 3).g;
  vec4 t5 = dtex(duv(4), 4); float n6 = dtex(duv(5), 5).g;
  vec3 soil = mix(vec3(0.49,0.40,0.29), vec3(0.43,0.33,0.235), smoothstep(0.32,0.7,n1));
  soil = mix(soil, vec3(0.55,0.48,0.38), smoothstep(0.48,0.8,n2)*0.7);
  soil *= 0.85+0.3*n3; soil *= 0.93+0.14*n4;
  soil *= mix(1.0, 0.9+0.2*t5.r, smoothstep(40.0, 4.0, fp))*mix(1.0, 0.92+0.16*n6, smoothstep(4.0, 0.3, fp));
  // bedrock with bedding picked out by height; dark desert varnish and basalt on some ranges
  vec3 rock = mix(vec3(0.29,0.24,0.20), vec3(0.40,0.335,0.275), n2);
  rock = mix(rock, vec3(0.12,0.105,0.095), m0.g);
  float strata = textureLod(tDetail, vec2(h*0.0037+n3*0.06, p.x*0.02+p.y*0.013), clamp(log2(fp*0.0037*512.0), 0.0, 6.0)).r;
  rock *= 0.72+0.6*strata;
  float rk = smoothstep(0.03, 0.11, slope);
  alb = mix(soil, rock, rk);
  alb *= mix(1.0, mix(1.2, 0.84, smoothstep(0.25,0.75,m0.b)), clamp(rk+0.25,0.0,1.0));
  // washes: braided pale channels with a darker brush fringe
  vec2 warp = vec2(dtex(duv(10), 10).r, dtex(duv(10)+0.5, 10).g)-0.5;
  float w1 = abs(dtex(duv(7)+warp*2.6*uScale[7], 7).r-0.5);
  float w2 = abs(dtex(duv(8)+warp*2.6*uScale[8]+0.3, 8).g-0.5);
  float flat1 = (1.0-rk)*(1.0-m0.r);
  float wash = max(lineAA(w1, 0.006, fk*0.02), 0.6*lineAA(w2, 0.012, fk*0.09));
  float fringe = max(lineAA(w1, 0.022, fk*0.02), 0.6*lineAA(w2, 0.04, fk*0.09));
  alb = mix(alb, alb*0.8, (fringe-wash)*flat1*0.6);
  alb = mix(alb, vec3(0.62,0.54,0.42), wash*flat1*0.65);
  // creosote scrub: dark shrubs that merge into a mottled tone with distance
  float patch1 = smoothstep(0.3,0.72, dtex(duv(9)+0.2, 9).r);
  float dots = (1.0-smoothstep(0.16,0.33, t5.b))*step(0.35, dtex(duv(11), 11).g);
  float vv = mix(dots*(0.5+0.5*patch1), 0.28+0.3*patch1, smoothstep(2.5, 18.0, fp));
  alb = mix(alb, vec3(0.105,0.11,0.07), m1.g*vv*0.7);
  alb = mix(alb, mix(vec3(0.10,0.17,0.06), vec3(0.30,0.27,0.16), step(0.7, n4)), m1.b);
  // dry lake beds: pale clay with faint water stains, vehicle tracks, and mud cracks close up
  if (m0.r > 0.002){
    vec3 clay = vec3(0.70,0.645,0.55)*(0.92+0.12*n3)*(0.96+0.08*n4);
    clay *= 1.0-0.10*smoothstep(0.55,0.8, dtex(duv(1)*3.0, 1).r);
    float trk = lineAA(abs(dtex(duv(2)*vec2(1.0,3.0)+0.2, 2).g-0.5), 0.004, fk*0.3);
    clay = mix(clay, clay*1.07, trk*0.6);
    float cr = smoothstep(0.50, 0.62, t5.b)*smoothstep(12.0, 1.5, fp);
    clay *= 1.0-0.22*cr;
    // lakebed runways are marked with lines of oil
    vec2 lf = mjField(p)-vec2(-4400.0, -700.0);
    float lr = min(abs(abs(lf.y)-45.0), abs(abs(lf.y*0.94+lf.x*0.34-900.0)-45.0));
    clay = mix(clay, vec3(0.10,0.09,0.08), lineAA(lr, 1.2, fp)*0.6*step(abs(lf.x), 3800.0));
    alb = mix(alb, clay, m0.r);
  }
  // roads: highways, base roads, a street grid to the north
  float rd = min(abs(p.y+13.6), min(abs(p.x+31.2), abs(p.x-52.0)));
  rd = min(rd, min(abs(p.x+3.1), abs(p.y-5.2)));
  float road = lineAA(rd, 0.008, fk)*(1.0-rk)*(1.0-m0.r);
  vec2 cq = (p-vec2(-18.0,-27.0)); vec2 cg = abs(fract(cq/0.42)-0.5)*0.42;
  float grid = lineAA(min(cg.x,cg.y), 0.004, fk)*smoothstep(1.0, 0.9, max(abs(cq.x)/10.0, abs(cq.y)/7.0))*(1.0-rk);
  alb = mix(alb, vec3(0.22,0.21,0.20), road*0.7);
  alb = mix(alb, vec3(0.60,0.54,0.45), grid*0.5);
  // fine relief
  float b0 = n4, b1 = dtex(duv(3)+0.7+vec2(0.012,0.0), 3).g, b2 = dtex(duv(3)+0.7+vec2(0.0,0.012), 3).g;
  N.xz += vec2(b0-b1, b0-b2)*(1.2*rk+0.05)*(1.0-m0.r)*smoothstep(900.0, 60.0, fp)*3.0;
  float c0 = t5.r, c1 = dtex(duv(4)+vec2(0.016,0.0), 4).r, c2 = dtex(duv(4)+vec2(0.0,0.016), 4).r;
  N.xz += vec2(c0-c1, c0-c2)*(0.9*rk+0.1)*(1.0-m0.r*0.85)*smoothstep(60.0, 4.0, fp)*2.0;
  spec = 0.0;
  vec2 f = mjField(p), wxz = uOrigin.xz+vRel.xz;
  bool onField = abs(f.x) < 3300.0 && f.y > -700.0 && f.y < 1300.0;
  // airfield ground: graded, compacted dirt between the pavements, with mower / grader lines and vehicle ruts
  if (onField){
    float gk = smoothstep(1.0, 0.8, max(abs(f.x)/3200.0, abs(f.y-240.0)/1150.0));
    vec3 graded = vec3(0.50,0.42,0.31)*(0.86+0.28*n3)*(0.92+0.16*n4)*(0.9+0.2*t5.r);
    float gl2 = dn(vec2(f.x*0.02, f.y), 0.11, fp).r;
    graded *= 0.94+0.12*gl2;
#ifdef SCRUB_FIELD_GLSL
    alb = mix(alb, graded, gk*0.8);
    { // the dressed scrub (src/scrub_mojave.js) where its plants are not drawn: their cover tints the graded ground, as
      // the drawn plants would hide it, so the scrub band thins into the distance instead of ending on a line
      vec2 sd = scrubD(wxz);
      float lam = (sd.x+sd.y)*(1.0-scrubDrawn(dist*uPixAngle)*scrubInst(wxz))/(SCRUB_PITCH*SCRUB_PITCH);
      if (lam > 0.0){
        vec3 V = -normalize(vRel);
        float gr = sd.x/max(sd.x+sd.y, 1e-4)*0.86;
        float cover = 1.0-exp(-lam*mix(0.9, 0.5, gr)/max(V.y, 0.03));
        float back = smoothstep(-0.3, 0.8, dot(normalize(-V.xz), normalize(uSunDir.xz)));
        vec3 veg = mix(mix(vec3(0.13, 0.135, 0.1), vec3(0.4, 0.33, 0.21), gr), mix(vec3(0.045, 0.045, 0.035), vec3(0.22, 0.17, 0.1), gr), back);
        alb = mix(alb, veg, cover);
      }
    }
#else
    alb = mix(alb, mix(graded, alb, 0.35*vv), gk*0.8);
#endif
    // perimeter track on the far side of the runway
    float pt = abs(f.y+96.0);
    float ruts = exp(-sq((pt-0.85)/0.3));
    alb = mix(alb, vec3(0.56,0.48,0.37)*(0.9+0.2*n6), (1.0-smoothstep(2.4, 3.6, pt))*0.8);
    alb *= 1.0-0.2*ruts;
  }
  // close to the lens: gravel, grit and small relief that a low sun picks out (procedural: only without the scans)
#ifdef TERRAIN_LAYERS
  if (fp < 0.25 && !onField){
#else
  if (fp < 0.25){
#endif
    float k = smoothstep(0.25, 0.012, fp);
    vec4 d5 = dtex(duv(5)+0.13, 5), d6 = dtex(duv(6), 6);
    float peb = smoothstep(0.30, 0.12, d6.b)*step(0.45, d5.r);
    alb *= 1.0+k*((d5.b-0.5)*0.30+(d6.a-0.5)*0.22);
    alb = mix(alb, mix(vec3(0.34,0.31,0.28), vec3(0.62,0.57,0.50), d5.g), peb*k*0.7);
    float e5 = 0.006, e6 = 0.012;
    vec2 g5 = vec2(dtex(duv(5)+0.13+vec2(e5,0.0), 5).r-d5.r, dtex(duv(5)+0.13+vec2(0.0,e5), 5).r-d5.r);
    vec2 g6 = vec2(dtex(duv(6)+vec2(e6,0.0), 6).r-d6.r, dtex(duv(6)+vec2(0.0,e6), 6).r-d6.r);
    N.xz -= (g5*0.9+g6*1.3)*k;
  }
  if (onField && abs(f.x) < 2410.0 && f.y > -56.0 && f.y < 598.0){
    float w = max(fp*0.6, 0.012);
    vec4 pm = mjPaveMask(f, w);
    float cov = max(max(pm.x, pm.y), max(pm.z, pm.w));
    if (cov > 0.001){
      float n7 = dtex(duv(6), 6).r;
      vec3 asph = vec3(0.085,0.082,0.078)*(0.78+0.44*n6)*(0.9+0.2*t5.r);
      asph = mix(asph, vec3(0.16,0.15,0.14), smoothstep(0.55, 0.8, dn(f, 0.04, fp).r)*0.6);     // sun-bleached patches
      vec3 c = asph; float gl = 0.7;
      vec2 g7 = dtex(duv(6)+0.37, 6).rg-0.5;
      vec2 Nt = g7*0.04*smoothstep(0.6, 0.02, fp)+vec2(n6-0.5, t5.g-0.5)*0.012;
      if (pm.z > 0.001){ vec2 Na; vec4 a = mjApron(f, f-vec2(${SPOT.u.toFixed(1)}, ${SPOT.v.toFixed(1)}), wxz, fp, n6, n7, Na); c = mix(c, a.rgb, pm.z); gl = mix(gl, a.a, pm.z); Nt = mix(Nt, Na, pm.z); }
      if (pm.y > 0.001){ vec4 a = mjTaxiway(f, fp, t5.r, n6, n7); c = mix(c, a.rgb, pm.y); gl = mix(gl, a.a, pm.y); }
      if (pm.x > 0.001){ vec4 a = mjRunway(f, fp, t5.r, n6, n7); c = mix(c, a.rgb, pm.x); gl = mix(gl, a.a, pm.x); }
      alb = mix(alb, c, cov);
      N = normalize(mix(N, normalize(vec3(Nt.x, 1.0, Nt.y)), cov));
      spec = mix(spec, -gl, cov);
    }
  }
#ifdef TERRAIN_LAYERS
  // close range: photoscanned grain under the painted airfield. The paint, joints, stains and colours above stay as
  // they are; the scans modulate them (each scan relative to its own mean) and supply the fine relief. The apron has
  // its own scanned asphalt (mjApron) and is left as it is.
  if (onField && fp < 1.3){
    float k = 1.0-smoothstep(0.5, 1.3, fp);
    vec4 pm = vec4(0.0);
    if (abs(f.x) < 2410.0 && f.y > -56.0 && f.y < 598.0) pm = mjPaveMask(f, max(fp*0.6, 0.012));
    float conc = max(pm.x, pm.y)*(1.0-pm.z), pav = max(max(conc, pm.w), pm.z);
    const vec3 Y3 = vec3(0.2126, 0.7152, 0.0722);
    vec3 gain = vec3(1.0); vec2 rel = vec2(0.0);
    if (conc > 0.001){ // jointed concrete: every slab its own stretch of the two scans; the broom grain runs across the pavement
      float size = 7.62; vec2 off = pm.x < 0.5 ? vec2(3.1, 1.7) : vec2(0.0);
      vec4 r = lRand(ivec2(floor((f+off)/size))+ivec2(4099, 2741));
      const float ch = ${Math.cos(hr).toFixed(6)}, sh = ${Math.sin(hr).toFixed(6)};
      mat2 Ra = mat2(sh, -ch, ch, sh), Rb = mat2(ch, sh, -sh, ch);              // field axes from world (x, -z): across-grain and plain mappings
      vec2 fx = lFootX(), fy = lFootY();
      Surf b = layerSampleST(L_CONCRETE_BROOM, vec2(f.x, -f.y)/2.5+r.xy*13.0, Ra*fx/2.5, Ra*fy/2.5, ${(hr - Math.PI / 2).toFixed(6)});
      Surf w = layerSampleST(L_CONCRETE_WORN, vec2(f.y, f.x)/3.0+r.zw*11.0, Rb*fx/3.0, Rb*fy/3.0, ${hr.toFixed(6)});
      b.alb = vec3(dot(b.alb, Y3)/max(dot(layerMeanAlbedo(L_CONCRETE_BROOM), Y3), 1e-3));
      w.alb = vec3(dot(w.alb, Y3)/max(dot(layerMeanAlbedo(L_CONCRETE_WORN), Y3), 1e-3));
      Surf c = surfBlendH(b, w, 0.25+0.5*r.z, 0.4);
      gain = mix(gain, vec3(clamp(c.alb.r, 0.7, 1.3)), conc*0.85); rel += c.d*conc*0.8;
    }
    if (pm.w*(1.0-pm.z) > 0.001 && conc < 0.999){ // asphalt shoulders and overruns
      Surf a = layerSample(L_ASPHALT); float wa = pm.w*(1.0-conc)*(1.0-pm.z);
      gain = mix(gain, vec3(clamp(dot(a.alb, Y3)/max(dot(layerMeanAlbedo(L_ASPHALT), Y3), 1e-3), 0.6, 1.5)), wa); rel += a.d*wa;
    }
    if (pav < 0.999){ // graded ground: soil with small stones, fine sand where it has drifted
      float gw = 1.0-pav;
      Surf g = layerSample(L_SOIL); g.alb /= max(layerMeanAlbedo(L_SOIL), vec3(1e-3));
      float wF = smoothstep(0.45, 0.65, dtex(duv(11)+0.37, 11).g*0.6+dtex(duv(4)+0.53, 4).g*0.4);
      if (wF > 0.02){ Surf s2 = layerSample(L_SOIL_FINE); s2.alb /= max(layerMeanAlbedo(L_SOIL_FINE), vec3(1e-3)); g = surfBlendH(g, s2, wF, 0.22); }
      gain = mix(gain, clamp(mix(vec3(dot(g.alb, Y3)), g.alb, 0.6), 0.45, 1.7), gw); rel += g.d*gw;
      tRough = mix(0.86, 0.98, g.rough); tAO = mix(1.0, g.ao, k); tSh = mix(1.0, g.sh, k); tW = gw*k;   // layered lighting on the bare ground only
    }
    alb *= mix(vec3(1.0), gain, k);
    N = normalize(N+vec3(rel.x, 0.0, rel.y)*k);
  }
#endif
  if (onField) alb *= acOcclusion(wxz);
}
`;

export const MOJAVE_TERRAIN = {
  height, mask, shade, scales, groundAlt: FIELD_ALT,
  near: { center: [18, -30], extent: 128, res: 4096 },
  far: { center: [20, -30], extent: 1100, res: 2048 },
};
