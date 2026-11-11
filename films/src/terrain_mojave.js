// Western Mojave Desert, stylised from the real layout around Edwards Air Force Base (origin = main runway
// midpoint): Rogers and Rosamond dry lakes, the Antelope Valley floor, low buttes, and the basin-and-range
// country of the R-2508 complex to the north and east (Rand / El Paso mountains, Cuddeback, Harper, Koehn
// and Searles dry lakes), with the Tehachapi, San Gabriel and Sierra Nevada ranges on the far rim.
// Coordinates in km: +x east, +y south.
export const FIELD_ALT = 704.0;

const height = /* glsl */`
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
  float m = mjPlaya(p, vec2(7.6,-3.4), vec2(5.4,9.2), 1.0);            // Rogers
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
  return m;
}
// x: basin + bajada surface (m), y: mountain weight 0..~1.6, z: bajada weight
vec3 mjMacro(vec2 p){
  float h = 706.0 + 70.0*(vnoise(p*0.010+vec2(1.3,5.7))-vnoise(vec2(1.3,5.7))) + 18.0*(vnoise(p*0.05+21.0)-vnoise(vec2(21.0)));
  h += 2.2*max(p.y, 0.0) + 0.9*max(-p.x-10.0, 0.0);                    // valley floor climbs towards the San Gabriels and Tehachapis
  h -= 1.4*clamp(-p.y-20.0, 0.0, 70.0);                                 // and falls away north into Fremont / Searles valleys
  float mt = 0.0, bj = 0.0, k;
  k = mjSeg(p, vec2(-98.0,-78.0), vec2(-44.0,-27.0), 8.5, 5.0, 1.0)*(0.75+0.5*vnoise(p*0.05+3.0)); mt = max(mt,k);   // Tehachapi
  bj = max(bj, mjSeg(p, vec2(-98.0,-78.0), vec2(-44.0,-27.0), 22.0, 5.0, 1.0));
  k = mjSeg(p, vec2(-70.0,72.0), vec2(62.0,84.0), 9.5, 5.0, 2.0)*(0.9+0.6*vnoise(p*0.045+7.0)); mt = max(mt,k);       // San Gabriel
  bj = max(bj, mjSeg(p, vec2(-70.0,72.0), vec2(62.0,84.0), 26.0, 5.0, 2.0));
  k = mjSeg(p, vec2(62.0,84.0), vec2(140.0,70.0), 10.0, 5.0, 3.0)*(0.9+0.6*vnoise(p*0.04+9.0)); mt = max(mt,k);       // San Bernardino
  bj = max(bj, mjSeg(p, vec2(62.0,84.0), vec2(140.0,70.0), 26.0, 5.0, 3.0));
  k = mjSeg(p, vec2(-78.0,-105.0), vec2(-46.0,-240.0), 15.0, 7.0, 4.0)*(1.1+0.6*vnoise(p*0.03+2.0)); mt = max(mt,k);  // Sierra Nevada
  bj = max(bj, mjSeg(p, vec2(-78.0,-105.0), vec2(-46.0,-240.0), 34.0, 7.0, 4.0));
  k = mjSeg(p, vec2(-22.0,-63.0), vec2(12.0,-53.0), 3.6, 2.0, 5.0)*(0.34+0.2*vnoise(p*0.2+5.0)); mt = max(mt,k);      // El Paso
  bj = max(bj, 0.7*mjSeg(p, vec2(-22.0,-63.0), vec2(12.0,-53.0), 10.0, 2.0, 5.0));
  k = mjSeg(p, vec2(17.0,-53.0), vec2(43.0,-39.0), 3.2, 2.0, 6.0)*(0.30+0.2*vnoise(p*0.22+8.0)); mt = max(mt,k);      // Rand
  bj = max(bj, 0.7*mjSeg(p, vec2(17.0,-53.0), vec2(43.0,-39.0), 9.0, 2.0, 6.0));
  k = mjSeg(p, vec2(37.0,-21.0), vec2(53.0,-30.0), 2.6, 1.5, 7.0)*(0.22+0.16*vnoise(p*0.25+1.0)); mt = max(mt,k);     // Fremont Peak, Black Hills
  bj = max(bj, 0.5*mjSeg(p, vec2(37.0,-21.0), vec2(53.0,-30.0), 7.0, 1.5, 7.0));
  k = mjSeg(p, vec2(66.0,-30.0), vec2(104.0,-8.0), 4.6, 3.0, 8.0)*(0.34+0.24*vnoise(p*0.15+4.0)); mt = max(mt,k);     // Calico / Paradise
  bj = max(bj, 0.7*mjSeg(p, vec2(66.0,-30.0), vec2(104.0,-8.0), 12.0, 3.0, 8.0));
  k = mjSeg(p, vec2(52.0,-72.0), vec2(70.0,-48.0), 3.4, 2.0, 9.0)*(0.3+0.2*vnoise(p*0.2+6.0)); mt = max(mt,k);        // Lava Mountains
  bj = max(bj, 0.6*mjSeg(p, vec2(52.0,-72.0), vec2(70.0,-48.0), 9.0, 2.0, 9.0));
  k = mjSeg(p, vec2(28.0,-78.0), vec2(36.0,-118.0), 4.0, 2.5, 10.0)*(0.45+0.3*vnoise(p*0.13+2.0)); mt = max(mt,k);    // Spangler / Argus
  bj = max(bj, 0.7*mjSeg(p, vec2(28.0,-78.0), vec2(36.0,-118.0), 11.0, 2.5, 10.0));
  k = mjSeg(p, vec2(64.0,-90.0), vec2(74.0,-200.0), 9.0, 5.0, 11.0)*(0.8+0.5*vnoise(p*0.05+1.0)); mt = max(mt,k);     // Slate / Panamint
  bj = max(bj, mjSeg(p, vec2(64.0,-90.0), vec2(74.0,-200.0), 22.0, 5.0, 11.0));
  k = mjSeg(p, vec2(24.0,21.0), vec2(46.0,30.0), 2.6, 2.0, 12.0)*(0.2+0.14*vnoise(p*0.25+3.0)); mt = max(mt,k);       // Shadow Mountains
  bj = max(bj, 0.5*mjSeg(p, vec2(24.0,21.0), vec2(46.0,30.0), 7.0, 2.0, 12.0));
  // isolated buttes on the valley floor (Leuhman Ridge, Bissell Hills, Soledad, Saddleback...)
  k = mjSeg(p, vec2(15.5,-5.0), vec2(22.0,1.5), 1.5, 0.8, 13.0)*0.13; mt = max(mt,k);
  k = mjSeg(p, vec2(-13.0,-5.0), vec2(-6.5,1.0), 1.5, 0.8, 14.0)*0.10; mt = max(mt,k);
  k = mjSeg(p, vec2(-30.0,-9.0), vec2(-27.0,-5.0), 1.2, 0.5, 15.0)*0.22; mt = max(mt,k);
  k = mjSeg(p, vec2(28.0,-2.0), vec2(40.0,6.0), 2.2, 1.0, 16.0)*0.13; mt = max(mt,k);
  k = smoothstep(0.80, 0.93, vnoise(p*0.085+31.0))*0.16*smoothstep(5.0, 14.0, length(p)); mt = max(mt,k);
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
float terrainH(vec2 p, float lod){
  vec3 m = mjMacro(p);
  vec2 g = mjSlope(p);
  float er = erosion(p*0.9, g*4.4, 1.35, 5, lod*0.9);
  float hm = mjBody(p, m.y, 6)+(er-0.5)*min(m.y,1.0)*520.0;
  float h = m.x+max(hm, -30.0*m.y);
  h += (er-0.5)*m.z*(1.0-min(m.y,1.0))*18.0;                 // arroyos on the fans
  h += 2.0*(vnoise(p*1.9)-0.5) + (lod<0.06 ? 0.6*(vnoise(p*9.0)-0.5) : 0.0);
  // dry lakes: dead-flat pans a little below their surroundings
  float P = mjPlayas(p);
  if (P > 0.0){ float lvl = 700.0+30.0*(vnoise(p*0.012+40.0)-0.5)*step(14.0, length(p-vec2(7.6,-3.4))); h = mix(h, min(h, lvl)-1.0, P); }
  // level the airfield
  vec2 f = abs(p)/vec2(2.3, 4.6);
  float fl = smoothstep(1.0, 0.6, max(f.x,f.y));
  h = mix(h, ${FIELD_ALT.toFixed(1)}-0.12, fl);
  return h;
}
`;

const mask = /* glsl */`
void terrainMask(vec2 p, float h, vec2 grad, float lod, out vec4 m0, out vec4 m1){
  vec3 m = mjMacro(p);
  float er = erosion(p*0.9, mjSlope(p)*4.4, 1.35, 5, lod*0.9);
  float P = mjPlayas(p);
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
float lineAA(float d, float w, float fp){ return (1.0-smoothstep(w, w+fp*1.2, d))*min(1.0, w/max(fp*0.7,1e-5)); }
void shadeTerrain(vec2 p, float h, inout vec3 N, float lap, vec4 m0, vec4 m1, float fp, float dist, out vec3 alb, out float spec){
  float slope = 1.0-N.y; float fk = fp*0.001;
  float n1 = texture2D(tDetail, duv(0)).r, n2 = texture2D(tDetail, duv(1)+0.3).g;
  float n3 = texture2D(tDetail, duv(2)).r, n4 = texture2D(tDetail, duv(3)+0.7).g;
  vec4 t5 = texture2D(tDetail, duv(4)); float n6 = texture2D(tDetail, duv(5)).g;
  vec3 soil = mix(vec3(0.49,0.41,0.31), vec3(0.43,0.34,0.25), smoothstep(0.32,0.7,n1));
  soil = mix(soil, vec3(0.55,0.49,0.40), smoothstep(0.48,0.8,n2)*0.7);
  soil *= 0.85+0.3*n3; soil *= 0.93+0.14*n4;
  soil *= mix(1.0, 0.9+0.2*t5.r, smoothstep(40.0, 4.0, fp))*mix(1.0, 0.92+0.16*n6, smoothstep(4.0, 0.3, fp));
  vec3 rock = mix(vec3(0.30,0.25,0.21), vec3(0.40,0.34,0.28), n2);
  rock = mix(rock, vec3(0.13,0.11,0.10), m0.g);
  float strata = texture2D(tDetail, vec2(h*0.0037+n3*0.06, p.x*0.02+p.y*0.013)).r;
  rock *= 0.74+0.56*strata;
  float rk = smoothstep(0.03, 0.11, slope);
  alb = mix(soil, rock, rk);
  alb *= mix(1.0, mix(1.2, 0.84, smoothstep(0.25,0.75,m0.b)), clamp(rk+0.25,0.0,1.0));
  // washes
  vec2 warp = vec2(texture2D(tDetail, duv(10)).r, texture2D(tDetail, duv(10)+0.5).g)-0.5;
  float w1 = abs(texture2D(tDetail, duv(7)+warp*2.6*uScale[7]).r-0.5);
  float w2 = abs(texture2D(tDetail, duv(8)+warp*2.6*uScale[8]+0.3).g-0.5);
  float flat1 = (1.0-rk)*(1.0-m0.r);
  float wash = max(lineAA(w1, 0.006, fk*0.02), 0.6*lineAA(w2, 0.012, fk*0.09));
  float fringe = max(lineAA(w1, 0.022, fk*0.02), 0.6*lineAA(w2, 0.04, fk*0.09));
  alb = mix(alb, alb*0.8, (fringe-wash)*flat1*0.6);
  alb = mix(alb, vec3(0.62,0.55,0.44), wash*flat1*0.65);
  // creosote scrub
  float patch1 = smoothstep(0.3,0.72, texture2D(tDetail, duv(9)+0.2).r);
  float dots = (1.0-smoothstep(0.16,0.33, t5.b))*step(0.35, texture2D(tDetail, duv(11)).g);
  float vv = mix(dots*(0.5+0.5*patch1), 0.28+0.3*patch1, smoothstep(2.5, 18.0, fp));
  alb = mix(alb, vec3(0.11,0.115,0.075), m1.g*vv*0.7);
  alb = mix(alb, mix(vec3(0.10,0.17,0.06), vec3(0.30,0.27,0.16), step(0.7, n4)), m1.b);
  // dry lake beds: pale clay, faint stains and vehicle tracks
  vec3 clay = vec3(0.70,0.655,0.57)*(0.92+0.12*n3)*(0.96+0.08*n4);
  clay *= 1.0-0.10*smoothstep(0.55,0.8, texture2D(tDetail, duv(1)*3.0).r);
  float trk = lineAA(abs(texture2D(tDetail, duv(2)*vec2(1.0,3.0)+0.2).g-0.5), 0.004, fk*0.3);
  clay = mix(clay, clay*1.07, trk*0.6);
  alb = mix(alb, clay, m0.r);
  // roads: highways, base roads, the California City street grid
  float rd = min(abs(p.y+13.6), min(abs(p.x+31.2), abs(p.x-52.0)));
  rd = min(rd, min(abs(p.x+3.1), abs(p.y-5.2)));
  float road = lineAA(rd, 0.008, fk)*(1.0-rk)*(1.0-m0.r);
  vec2 cq = (p-vec2(-18.0,-27.0)); vec2 cg = abs(fract(cq/0.42)-0.5)*0.42;
  float grid = lineAA(min(cg.x,cg.y), 0.004, fk)*smoothstep(1.0, 0.9, max(abs(cq.x)/10.0, abs(cq.y)/7.0))*(1.0-rk);
  alb = mix(alb, vec3(0.22,0.21,0.20), road*0.7);
  alb = mix(alb, vec3(0.60,0.54,0.45), grid*0.5);
  // fine relief
  float b0 = n4, b1 = texture2D(tDetail, duv(3)+0.7+vec2(0.012,0.0)).g, b2 = texture2D(tDetail, duv(3)+0.7+vec2(0.0,0.012)).g;
  N.xz += vec2(b0-b1, b0-b2)*(1.2*rk+0.05)*(1.0-m0.r)*smoothstep(900.0, 60.0, fp)*3.0;
  float c0 = t5.r, c1 = texture2D(tDetail, duv(4)+vec2(0.016,0.0)).r, c2 = texture2D(tDetail, duv(4)+vec2(0.0,0.016)).r;
  N.xz += vec2(c0-c1, c0-c2)*(0.9*rk+0.1)*(1.0-m0.r*0.85)*smoothstep(60.0, 4.0, fp)*2.0;
  spec = 0.0;
}
`;

export const MOJAVE_TERRAIN = {
  height, mask, shade, scales, groundAlt: FIELD_ALT,
  near: { center: [18, -30], extent: 128, res: 4096 },
  far: { center: [20, -30], extent: 1100, res: 2048 },
};
