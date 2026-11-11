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
// Apron: 6.1 m slabs with sealant, crack repairs, stains, tyre scuffs, tie-down points, taxilane and stand paint.
// a: metres from the parking spot (x along the runway axis, y towards the flight line; the aircraft noses +y)
vec4 mjApron(vec2 f, vec2 a, float fp, float n5, float n6, float n7){
  float w = max(fp*0.6, 0.004);
  vec4 cc = mjConcrete(f+vec2(1.3,0.4), 6.096, fp, vec3(0.455,0.445,0.415), n5, n6, n7); vec3 c = cc.rgb; float gl = cc.a;
  float near = clamp(3.0/max(fp,0.01), 0.0, 1.0);
  // crack-seal: wandering tar lines, in clusters
  vec4 k1 = dn(f, 0.021, fp), k2 = dn(f+vec2(31.0,17.0), 0.047, fp);
  float cl = smoothstep(0.5, 0.62, dn(f, 0.006, fp).r);
  float crack = lineAA(abs(k1.g-0.5), 0.0035, fp*0.11)*cl+0.8*lineAA(abs(k2.r-0.47), 0.004, fp*0.22)*cl*step(0.5, k1.r);
  crack *= near;
  c = mix(c, vec3(0.045,0.043,0.042), crack*0.9); gl = mix(gl, 2.2, crack);
  // oil and hydraulic stains; darker, slightly glossy
  float st = smoothstep(0.60, 0.78, dn(f+vec2(7.0,3.0), 0.052, fp).r)*smoothstep(0.35, 0.6, k2.g);
  st = max(st, 0.8*smoothstep(0.72, 0.9, dn(f, 0.19, fp).g)*smoothstep(0.45, 0.6, k1.r));
  c *= 1.0-0.42*st; gl += 0.9*st;
  // drips under where aircraft stand: a loose scatter around each stand centre line
  float dsx = mod(a.x+18.0, 36.0)-18.0;
  float drip = smoothstep(0.80, 0.9, dn(f, 0.9, fp).r)*exp(-dsx*dsx/30.0)*smoothstep(-16.0, -4.0, a.y)*smoothstep(12.0, 2.0, a.y)*near;
  c *= 1.0-0.5*drip; gl += 0.6*drip;
  // tie-down / grounding points: a recessed ring at every other slab corner
  vec2 tq = (fract((f+vec2(1.3,0.4))/12.192)-0.5)*12.192; float td = length(tq);
  float ring = stripe(td-0.085, 0.022, w)*near, hole = (1.0-smoothstep(0.05-w, 0.05+w, td))*near;
  c = mix(c, vec3(0.30,0.29,0.27), ring*0.7); c = mix(c, vec3(0.03), hole*0.9);
  // slot drain across the apron
  float dr = abs(f.y-498.0);
  float drain = (1.0-smoothstep(0.16-w, 0.16+w, dr));
  c = mix(c, vec3(0.05,0.05,0.05)*(0.6+0.8*step(0.5, fract(f.x/0.06))*clamp(0.03/max(fp,1e-3), 0.0, 1.0)), drain*0.92);
  c *= 1.0-0.16*exp(-dr/1.6)*(0.5+0.5*n6);
  // taxilane centre line (yellow, black edged), a lead-in arc and line to each stand, nose-wheel stop bar
  float wear = 0.4+0.6*smoothstep(0.25, 0.7, n6+0.25*(n7-0.5));
  float tl = abs(f.y-330.0);
  float sx = mod(a.x+18.0, 36.0)-18.0;                                  // stand-local x (stands every 36 m)
  vec2 ac = vec2(sx-12.0, a.y+62.0); float ar = length(ac);            // arc centre; the taxilane is at a.y = -74
  float onArc = (ac.x <= 0.0 && ac.y <= 0.0) ? 1.0 : 0.0, onStr = (a.y > -62.0 && a.y < 1.95) ? 1.0 : 0.0;
  float lead = min(onArc > 0.5 ? abs(ar-12.0) : 1.0e3, onStr > 0.5 ? abs(sx) : 1.0e3);
  lead = min(lead, abs(sx) < 0.6 ? abs(a.y-1.95) : 1.0e3);
  float yd = min(tl, lead);
  c = mix(c, vec3(0.045), stripe(yd, 0.155, w)*0.5*near);
  c = mix(c, vec3(0.82,0.62,0.06)*wear, stripe(yd, 0.075, w)*0.92);
  // stand corner brackets (white)
  { float bx = abs(sx), by = abs(a.y-0.2);
    float lx = (by > 6.5 && by < 8.05) ? abs(bx-6.5) : 1.0e3, ly = (bx > 5.0 && bx < 6.55) ? abs(by-8.0) : 1.0e3;
    c = mix(c, vec3(0.80,0.79,0.75)*wear, stripe(min(lx, ly), 0.05, w)*0.85);
  }
  float el = min(abs(f.y-262.0), abs(f.y-262.45));
  c = mix(c, vec3(0.80,0.60,0.07)*wear, stripe(el, 0.075, w)*0.85);
  // tyre scuffs: polished tracks along the taxilane and sweeping turns onto the stands
  float trk = dn(vec2(f.x*0.05, f.y), 0.4, fp).r;
  float band = exp(-sq((tl-1.9)/0.9))*smoothstep(0.35, 0.75, trk);
  band = max(band, onArc*(exp(-sq((ar-10.1)/0.5))+exp(-sq((ar-13.9)/0.5)))*smoothstep(0.3, 0.7, dn(f, 0.31, fp).g));
  band = max(band, onStr*exp(-sq((abs(sx)-1.9)/0.45))*smoothstep(0.35, 0.7, dn(vec2(f.x, f.y*0.06), 0.5, fp).g));
  c = mix(c, c*0.62+vec3(0.012), band*0.75*near); gl += 0.5*band;
  // wind-blown sand lying in the joints and against the edges
  float sand = smoothstep(0.62, 0.8, dn(f, 0.013, fp).g)*smoothstep(0.36, 0.5, max(abs(fract((f.x+1.3)/6.096)-0.5), abs(fract((f.y+0.4)/6.096)-0.5)));
  c = mix(c, vec3(0.60,0.53,0.42), sand*0.35*near);
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
  vec2 f = mjField(p);
  bool onField = abs(f.x) < 3300.0 && f.y > -700.0 && f.y < 1300.0;
  // airfield ground: graded, compacted dirt between the pavements, with mower / grader lines and vehicle ruts
  if (onField){
    float gk = smoothstep(1.0, 0.8, max(abs(f.x)/3200.0, abs(f.y-240.0)/1150.0));
    vec3 graded = vec3(0.50,0.42,0.31)*(0.86+0.28*n3)*(0.92+0.16*n4)*(0.9+0.2*t5.r);
    float gl2 = dn(vec2(f.x*0.02, f.y), 0.11, fp).r;
    graded *= 0.94+0.12*gl2;
    alb = mix(alb, mix(graded, alb, 0.35*vv), gk*0.8);
    // perimeter track on the far side of the runway
    float pt = abs(f.y+96.0);
    float ruts = exp(-sq((pt-0.85)/0.3));
    alb = mix(alb, vec3(0.56,0.48,0.37)*(0.9+0.2*n6), (1.0-smoothstep(2.4, 3.6, pt))*0.8);
    alb *= 1.0-0.2*ruts;
  }
  // close to the lens: gravel, grit and small relief that a low sun picks out
  if (fp < 0.25){
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
      if (pm.z > 0.001){ vec4 a = mjApron(f, f-vec2(${SPOT.u.toFixed(1)}, ${SPOT.v.toFixed(1)}), fp, t5.r, n6, n7); c = mix(c, a.rgb, pm.z); gl = mix(gl, a.a, pm.z); }
      if (pm.y > 0.001){ vec4 a = mjTaxiway(f, fp, t5.r, n6, n7); c = mix(c, a.rgb, pm.y); gl = mix(gl, a.a, pm.y); }
      if (pm.x > 0.001){ vec4 a = mjRunway(f, fp, t5.r, n6, n7); c = mix(c, a.rgb, pm.x); gl = mix(gl, a.a, pm.x); }
      alb = mix(alb, c, cov);
      vec2 g7 = dtex(duv(6)+0.37, 6).rg-0.5;
      vec3 Np = normalize(vec3(0.0,1.0,0.0)+vec3(g7.x, 0.0, g7.y)*0.04*smoothstep(0.6, 0.02, fp)+vec3(n6-0.5, 0.0, t5.g-0.5)*0.012);
      N = normalize(mix(N, Np, cov));
      spec = mix(spec, -gl, cov);
    }
  }
}
`;

export const MOJAVE_TERRAIN = {
  height, mask, shade, scales, groundAlt: FIELD_ALT,
  near: { center: [18, -30], extent: 128, res: 4096 },
  far: { center: [20, -30], extent: 1100, res: 2048 },
};
