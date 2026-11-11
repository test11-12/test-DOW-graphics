// Southern New Mexico, stylised from the real layout around Spaceport America (origin = runway midpoint):
// Jornada del Muerto basin, San Andres Mountains to the east, the Tularosa Basin and the White Sands
// gypsum dunes beyond them, Caballo / Fra Cristobal ranges and the Rio Grande to the west.
// Coordinates in km: +x east, +y south.
export const FIELD_ALT = 1401.0;

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
  h = mix(h, ${FIELD_ALT.toFixed(1)}-0.12, fl);
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
void shadeTerrain(vec2 p, float h, inout vec3 N, float lap, vec4 m0, vec4 m1, float fp, float dist, out vec3 alb, out float spec){
  float slope = 1.0-N.y; float fk = fp*0.001;
  float n1 = texture2D(tDetail, duv(0)).r, n2 = texture2D(tDetail, duv(1)+0.3).g;
  float n3 = texture2D(tDetail, duv(2)).r, n4 = texture2D(tDetail, duv(3)+0.7).g;
  vec4 t5 = texture2D(tDetail, duv(4)); float n6 = texture2D(tDetail, duv(5)).g;
  vec3 soil = mix(vec3(0.47,0.37,0.26), vec3(0.42,0.30,0.21), smoothstep(0.32,0.7,n1));
  soil = mix(soil, vec3(0.52,0.45,0.35), smoothstep(0.48,0.8,n2)*0.75);
  soil *= 0.84+0.32*n3; soil *= 0.93+0.14*n4;
  soil *= mix(1.0, 0.9+0.2*t5.r, smoothstep(40.0, 4.0, fp))*mix(1.0, 0.92+0.16*n6, smoothstep(4.0, 0.3, fp));
  // bedrock with bedding picked out by height
  vec3 rock = mix(vec3(0.27,0.225,0.19), vec3(0.37,0.32,0.275), n2);
  float strata = texture2D(tDetail, vec2(h*0.0041+n3*0.06, p.x*0.02+p.y*0.013)).r;
  rock *= 0.72+0.6*strata;
  float rk = smoothstep(0.03, 0.11, slope);
  alb = mix(soil, rock, rk);
  // gullies hold pale sediment, spurs carry dark varnish
  alb *= mix(1.0, mix(1.2, 0.84, smoothstep(0.25,0.75,m0.b)), clamp(rk+0.25,0.0,1.0));
  // washes: meandering pale channels with a darker brush fringe
  vec2 warp = vec2(texture2D(tDetail, duv(10)).r, texture2D(tDetail, duv(10)+0.5).g)-0.5;
  float w1 = abs(texture2D(tDetail, duv(7)+warp*2.6*uScale[7]).r-0.5);
  float w2 = abs(texture2D(tDetail, duv(8)+warp*2.6*uScale[8]+0.3).g-0.5);
  float flat1 = (1.0-rk)*(1.0-m0.r*0.8);
  float wash = max(lineAA(w1, 0.006, fk*0.02), 0.6*lineAA(w2, 0.012, fk*0.09));
  float fringe = max(lineAA(w1, 0.022, fk*0.02), 0.6*lineAA(w2, 0.04, fk*0.09));
  alb = mix(alb, alb*0.78, (fringe-wash)*flat1*0.7);
  alb = mix(alb, vec3(0.60,0.52,0.40), wash*flat1*0.7);
  // scrub: dark shrubs that merge into a mottled tone with distance
  float patch1 = smoothstep(0.3,0.72, texture2D(tDetail, duv(9)+0.2).r);
  float dots = (1.0-smoothstep(0.16,0.33, t5.b))*step(0.35, texture2D(tDetail, duv(11)).g);
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
  float b0 = n4, b1 = texture2D(tDetail, duv(3)+0.7+vec2(0.012,0.0)).g, b2 = texture2D(tDetail, duv(3)+0.7+vec2(0.0,0.012)).g;
  N.xz += vec2(b0-b1, b0-b2)*(1.2*rk+0.05)*smoothstep(900.0, 60.0, fp)*3.0;
  float c0 = t5.r, c1 = texture2D(tDetail, duv(4)+vec2(0.016,0.0)).r, c2 = texture2D(tDetail, duv(4)+vec2(0.0,0.016)).r;
  N.xz += vec2(c0-c1, c0-c2)*(0.9*rk+0.1)*smoothstep(60.0, 4.0, fp)*2.0;
  spec = m1.r;
  if (spec > 0.0) alb = mix(alb, vec3(0.03,0.06,0.07), spec);
}
`;

export const NM_TERRAIN = {
  height, mask, shade, scales, groundAlt: FIELD_ALT,
  near: { center: [40, 8], extent: 128, res: 4096 },
  far: { center: [20, 0], extent: 1100, res: 2048 },
};
