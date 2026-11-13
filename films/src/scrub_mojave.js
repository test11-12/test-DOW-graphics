// Film 2 scrub field (see src/scrub.js): the unpaved ground of the Edwards airfield as the film dresses it, in the
// airfield's own axes (u along the runway, v across it towards the flight line). As in released photographs of the
// flight line: beside the runway a wide graded strip of bare, pale desert pavement; beyond it Mojave creosote-bursage
// scrub, low (about 0.5 to 1.5 m) and metres apart, with grey saltbush and burrobush between and a little dry grass,
// getting sparser, smaller and paler towards the lakebed. The infield between the runway and the parallel taxiway is
// graded too: only low, sparse burrobush and grass. Behind the hangar row the desert runs on, the same scrub thinning
// outwards (what the take-off shot sees past the flight line).
// scrubD(q): expected plants per slot over the whole dressed ground; scrubInst(q): the share drawn as plants. Where
// they are not drawn the terrain tints the graded ground with their cover (see terrain_mojave.js), so nothing ends
// on a line.
import { FIELD_U, FIELD_V } from './terrain_mojave.js';
import { SCRUB_DRAWN } from './scrub.js';

const U = 2300, V0 = -1150, V1 = 222, BARE = -125, B0 = 612, B1 = 2600;   // u extent; far edge; infield edge; graded strip; back band from / to
// hangars (u0, u1, v0, v1; see edwards_field.js) and the towers behind the apron: nothing grows on or against them
const HANGARS = [[40, 215, 668, 748], [452, 566, 655, 722], [610, 770, 660, 735], [-215, -40, 665, 742], [-470, -300, 660, 720], [820, 960, 670, 730]];
const GLSL = /* glsl */`
#define SCRUB_PITCH 2.0
#define SCRUB_FIELD_GLSL 1
const vec2 SM_FU = vec2(${FIELD_U[0].toFixed(5)}, ${FIELD_U[1].toFixed(5)}), SM_FV = vec2(${FIELD_V[0].toFixed(5)}, ${FIELD_V[1].toFixed(5)});
float scrubPatch(vec2 f){ return 0.5+0.5*sin(f.x*0.011+sin(f.y*0.004)*2.1)*cos(f.y*0.0075+sin(f.x*0.006)*1.7); }
float scrubWarp(vec2 f){ return sin(f.x*0.11+sin(f.y*0.083)*1.7)*cos(f.y*0.127+sin(f.x*0.071)*1.5); }
float scrubIsland(vec2 f){ return smoothstep(0.25, 0.75, 0.5+0.5*sin(f.x*0.031+sin(f.y*0.023)*2.3)*cos(f.y*0.027+sin(f.x*0.019)*1.9)); }
bool scrubBuilt(vec2 f){
${HANGARS.map(([a, b, c, d]) => `  if (f.x > ${(a - 12).toFixed(1)} && f.x < ${(b + 12).toFixed(1)} && f.y > ${(c - 14).toFixed(1)} && f.y < ${(d + 10).toFixed(1)}) return true;`).join('\n')}
  return length(f-vec2(-560.0, 760.0)) < 18.0 || length(f-vec2(1080.0, 800.0)) < 18.0;
}
// expected plants per slot: x grass, y shrubs
vec2 scrubD(vec2 q){
  vec2 f = vec2(dot(q, SM_FU), dot(q, SM_FV));
  if (abs(f.x) > ${U.toFixed(1)}) return vec2(0.0);
  bool far = f.y < -58.0 && f.y > ${V0.toFixed(1)}, infield = f.y > 58.0 && f.y < ${V1.toFixed(1)}, back = f.y > ${B0.toFixed(1)} && f.y < ${B1.toFixed(1)};
  if (!far && !infield && !back) return vec2(0.0);
  if (infield && (abs(f.x-40.0) < 16.0 || abs(abs(f.x)-1150.0) < 16.0 || abs(abs(f.x)-2262.0) < 16.0)) return vec2(0.0);   // taxiway connectors
  if (back && scrubBuilt(f)) return vec2(0.0);
  float p1 = scrubPatch(f), p2 = scrubPatch(f*1.7+vec2(311.0, -97.0)), isl = 0.35+1.0*scrubIsland(f);
  vec2 d;
  if (far){
    // the graded strip's edge wanders (30 to 80 m), the scrub gathers in islands with gaps between, and it thins out
    // to nothing by v = -1100
    float bare = ${BARE.toFixed(1)}-28.0*scrubWarp(f*0.6);
    d = vec2(0.03+0.07*p2, (0.05+0.13*p1*p1)*isl);
    d *= (1.0-smoothstep(bare-70.0, bare, f.y))*(1.0-smoothstep(700.0, 1100.0, -f.y));
    d.x += 0.012*(1.0-smoothstep(-90.0, -70.0, f.y))*smoothstep(4.0, 5.5, abs(f.y+96.0));   // a few tufts in the strip (none on the perimeter track)
    d.y += 0.004*smoothstep(0.55, 0.8, scrubWarp(f*1.3+vec2(37.0, 11.0)))*(1.0-smoothstep(bare-20.0, bare+8.0, f.y))*step(f.y, -100.0);   // outliers in the strip
  } else if (infield){
    d = vec2(0.03+0.05*p2, 0.008+0.02*p1)*smoothstep(58.0, 70.0, f.y)*(1.0-smoothstep(${(V1 - 10).toFixed(1)}, ${V1.toFixed(1)}, f.y));
  } else {
    d = vec2(0.04+0.08*p2, (0.035+0.1*p1*p1)*isl)*smoothstep(${B0.toFixed(1)}, ${(B0 + 60).toFixed(1)}, f.y)*(1.0-0.7*smoothstep(1000.0, 2300.0, f.y))*(1.0-smoothstep(${(B1 - 250).toFixed(1)}, ${B1.toFixed(1)}, f.y));
  }
  return d*(1.0-smoothstep(${(U - 200).toFixed(1)}, ${U.toFixed(1)}, abs(f.x)));
}
float scrubInst(vec2 q){ return 1.0; }
float scrubDensity(vec2 q){ vec2 d = scrubD(q); return d.x+d.y; }
float scrubGrassy(vec2 q){ vec2 d = scrubD(q); return d.x/max(d.x+d.y, 1e-4); }
${SCRUB_DRAWN}
`;
// the same field in JS (keep in step with GLSL)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const patch = (u, v) => 0.5 + 0.5 * Math.sin(u * 0.011 + Math.sin(v * 0.004) * 2.1) * Math.cos(v * 0.0075 + Math.sin(u * 0.006) * 1.7);
const warp = (u, v) => Math.sin(u * 0.11 + Math.sin(v * 0.083) * 1.7) * Math.cos(v * 0.127 + Math.sin(u * 0.071) * 1.5);
const island = (u, v) => sstep(0.25, 0.75, 0.5 + 0.5 * Math.sin(u * 0.031 + Math.sin(v * 0.023) * 2.3) * Math.cos(v * 0.027 + Math.sin(u * 0.019) * 1.9));
const built = (u, v) => HANGARS.some(([a, b, c, d]) => u > a - 12 && u < b + 12 && v > c - 14 && v < d + 10) || Math.hypot(u + 560, v - 760) < 18 || Math.hypot(u - 1080, v - 800) < 18;
function dens(x, z) {
  const u = x * FIELD_U[0] + z * FIELD_U[1], v = x * FIELD_V[0] + z * FIELD_V[1];
  if (Math.abs(u) > U) return [0, 0, v];
  const far = v < -58 && v > V0, infield = v > 58 && v < V1, back = v > B0 && v < B1;
  if (!far && !infield && !back) return [0, 0, v];
  if (infield && (Math.abs(u - 40) < 16 || Math.abs(Math.abs(u) - 1150) < 16 || Math.abs(Math.abs(u) - 2262) < 16)) return [0, 0, v];
  if (back && built(u, v)) return [0, 0, v];
  const p1 = patch(u, v), p2 = patch(u * 1.7 + 311, v * 1.7 - 97), isl = 0.35 + island(u, v);
  let g, s;
  if (far) {
    const bare = BARE - 28 * warp(u * 0.6, v * 0.6);
    const k = sstep(bare, bare - 70, v) * (1 - sstep(700, 1100, -v));
    g = (0.03 + 0.07 * p2) * k; s = (0.05 + 0.13 * p1 * p1) * isl * k;
    g += 0.012 * sstep(-70, -90, v) * sstep(4, 5.5, Math.abs(v + 96));
    s += 0.004 * sstep(0.55, 0.8, warp(u * 1.3 + 37, v * 1.3 + 11)) * sstep(bare + 8, bare - 20, v) * (v <= -100 ? 1 : 0);
  } else if (infield) {
    const k = sstep(58, 70, v) * (1 - sstep(V1 - 10, V1, v));
    g = (0.03 + 0.05 * p2) * k; s = (0.008 + 0.02 * p1) * k;
  } else {
    const k = sstep(B0, B0 + 60, v) * (1 - 0.7 * sstep(1000, 2300, v)) * (1 - sstep(B1 - 250, B1, v));
    g = (0.04 + 0.08 * p2) * k; s = (0.035 + 0.1 * p1 * p1) * isl * k;
  }
  const e = 1 - sstep(U - 200, U, Math.abs(u));
  return [g * e, s * e, v];
}
const density = (x, z) => { const [g, s] = dens(x, z); return g + s; };
// 0 creosote, 1 saltbush (the "mesquite" slot of the atlas), 2 burrobush ("snakeweed" slot), 3 grass; the infield and
// the graded strip carry only the low ones
function species(x, z, h) {
  const [g, s, v] = dens(x, z), gr = g / Math.max(g + s, 1e-4);
  if (h < gr) return 3;
  const t = (h - gr) / Math.max(1 - gr, 1e-4);
  if (v > BARE && v < B0) return t < 0.3 ? 1 : 2;
  return t < 0.45 ? 0 : (t < 0.72 ? 1 : 2);
}
// smaller plants towards the edges of the dressed ground (the far side thins out from v = -700, the back band from 1200)
const scaleAt = (x, z) => { const v = x * FIELD_V[0] + z * FIELD_V[1]; return 1 - 0.5 * sstep(700, 1100, -v) - 0.35 * sstep(1200, 2400, v); };
const corners = [[-U, V0], [U, V0], [-U, B1], [U, B1]].map(([u, v]) => [u * FIELD_U[0] + v * FIELD_V[0], u * FIELD_U[1] + v * FIELD_V[1]]);
export const SCRUB_FIELD_MOJAVE = {
  pitch: 2, cell: 96, density, species, scaleAt, glsl: GLSL, clump: 3,
  bounds: [Math.min(...corners.map(c => c[0])), Math.max(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])), Math.max(...corners.map(c => c[1]))],
  // cells wholly outside the dressed ground are never built
  skip: (x0, z0, cell) => { let lo = Infinity, hi = -Infinity, ulo = Infinity; for (const [x, z] of [[x0, z0], [x0 + cell, z0], [x0, z0 + cell], [x0 + cell, z0 + cell]]) { const u = x * FIELD_U[0] + z * FIELD_U[1], v = x * FIELD_V[0] + z * FIELD_V[1]; lo = Math.min(lo, v); hi = Math.max(hi, v); ulo = Math.min(ulo, Math.abs(u)); } return hi < V0 || lo > B1 || ulo > U || (lo > V1 + 10 && hi < B0 - 10) || (lo > -58 && hi < 58); },
  // per species: size on the baked plant, and [gain, saturation] on its baked albedo (1: as baked)
  sizes: { creosote: 0.9, mesquite: 1.0, snakeweed: 1.0, grass: 0.9 },
  // tone: the bake's leaves graded to real albedos, but a dense canopy shades itself; these gains bring the sunlit
  // plants to what the photographs show beside the ground (creosote about 0.65 of it, saltbush and burrobush nearly
  // as bright as it, dry grass a little brighter)
  tone: { creosote: [2.8, 0.95], mesquite: [2.5, 1.0], snakeweed: [2.5, 1.0], grass: [1.8, 1.0] },
};
