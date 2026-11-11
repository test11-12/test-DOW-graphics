// Film 2 scrub field (see src/scrub.js): the unpaved ground of the Edwards airfield as the film dresses it, in the
// airfield's own axes (u along the runway, v across it towards the flight line). As in released photographs of the
// flight line: beside the runway a wide graded strip of bare, pale desert pavement; beyond it Mojave creosote-bursage
// scrub, low (about 0.5 to 1.5 m) and metres apart, with grey saltbush and burrobush between and a little dry grass,
// thinning out towards the lakebed. The infield between the runway and the parallel taxiway is graded too: only low,
// sparse burrobush and grass.
import { FIELD_U, FIELD_V } from './terrain_mojave.js';
import { SCRUB_DRAWN } from './scrub.js';

const U = 2300, V0 = -1500, V1 = 222, BARE = -125;    // u extent; far edge; infield edge; the far side's graded strip ends here
const GLSL = /* glsl */`
#define SCRUB_PITCH 2.0
const vec2 SM_FU = vec2(${FIELD_U[0].toFixed(5)}, ${FIELD_U[1].toFixed(5)}), SM_FV = vec2(${FIELD_V[0].toFixed(5)}, ${FIELD_V[1].toFixed(5)});
float scrubPatch(vec2 f){ return 0.5+0.5*sin(f.x*0.011+sin(f.y*0.004)*2.1)*cos(f.y*0.0075+sin(f.x*0.006)*1.7); }
// expected plants per slot: x grass, y shrubs
vec2 scrubD(vec2 q){
  vec2 f = vec2(dot(q, SM_FU), dot(q, SM_FV));
  if (abs(f.x) > ${U.toFixed(1)}) return vec2(0.0);
  bool far = f.y < -58.0 && f.y > ${V0.toFixed(1)}, infield = f.y > 58.0 && f.y < ${V1.toFixed(1)};
  if (!far && !infield) return vec2(0.0);
  if (infield && (abs(f.x-40.0) < 16.0 || abs(abs(f.x)-1150.0) < 16.0 || abs(abs(f.x)-2262.0) < 16.0)) return vec2(0.0);   // taxiway connectors
  float p1 = scrubPatch(f), p2 = scrubPatch(f*1.7+vec2(311.0, -97.0));
  vec2 d;
  if (far){
    d = vec2(0.03+0.07*p2, 0.05+0.13*p1*p1);
    d *= (1.0-smoothstep(${(BARE - 70).toFixed(1)}, ${BARE.toFixed(1)}, f.y))*(1.0-0.65*(1.0-smoothstep(-1300.0, -450.0, f.y)))*smoothstep(${V0.toFixed(1)}, ${(V0 + 200).toFixed(1)}, f.y);
    d.x += 0.012*(1.0-smoothstep(-90.0, -70.0, f.y))*smoothstep(4.0, 5.5, abs(f.y+96.0));   // a few tufts in the strip (none on the perimeter track)
  } else {
    d = vec2(0.03+0.05*p2, 0.008+0.02*p1)*smoothstep(58.0, 70.0, f.y)*(1.0-smoothstep(${(V1 - 10).toFixed(1)}, ${V1.toFixed(1)}, f.y));
  }
  return d*(1.0-smoothstep(${(U - 200).toFixed(1)}, ${U.toFixed(1)}, abs(f.x)));
}
float scrubDensity(vec2 q){ vec2 d = scrubD(q); return d.x+d.y; }
float scrubGrassy(vec2 q){ vec2 d = scrubD(q); return d.x/max(d.x+d.y, 1e-4); }
${SCRUB_DRAWN}
`;
// the same field in JS (keep in step with GLSL)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const patch = (u, v) => 0.5 + 0.5 * Math.sin(u * 0.011 + Math.sin(v * 0.004) * 2.1) * Math.cos(v * 0.0075 + Math.sin(u * 0.006) * 1.7);
function dens(x, z) {
  const u = x * FIELD_U[0] + z * FIELD_U[1], v = x * FIELD_V[0] + z * FIELD_V[1];
  if (Math.abs(u) > U) return [0, 0, v];
  const far = v < -58 && v > V0, infield = v > 58 && v < V1;
  if (!far && !infield) return [0, 0, v];
  if (infield && (Math.abs(u - 40) < 16 || Math.abs(Math.abs(u) - 1150) < 16 || Math.abs(Math.abs(u) - 2262) < 16)) return [0, 0, v];
  const p1 = patch(u, v), p2 = patch(u * 1.7 + 311, v * 1.7 - 97);
  let g, s;
  if (far) {
    const k = sstep(BARE, BARE - 70, v) * (1 - 0.65 * sstep(-450, -1300, v)) * sstep(V0, V0 + 200, v);
    g = (0.03 + 0.07 * p2) * k; s = (0.05 + 0.13 * p1 * p1) * k;
    g += 0.012 * sstep(-70, -90, v) * sstep(4, 5.5, Math.abs(v + 96));
  } else {
    const k = sstep(58, 70, v) * (1 - sstep(V1 - 10, V1, v));
    g = (0.03 + 0.05 * p2) * k; s = (0.008 + 0.02 * p1) * k;
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
  if (v > BARE) return t < 0.3 ? 1 : 2;
  return t < 0.5 ? 0 : (t < 0.7 ? 1 : 2);
}
const corners = [[-U, V0], [U, V0], [-U, V1], [U, V1]].map(([u, v]) => [u * FIELD_U[0] + v * FIELD_V[0], u * FIELD_U[1] + v * FIELD_V[1]]);
export const SCRUB_FIELD_MOJAVE = {
  pitch: 2, cell: 96, density, species, glsl: GLSL,
  bounds: [Math.min(...corners.map(c => c[0])), Math.max(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])), Math.max(...corners.map(c => c[1]))],
  // cells wholly outside the dressed strip are never built
  skip: (x0, z0, cell) => { let lo = Infinity, hi = -Infinity, ulo = Infinity; for (const [x, z] of [[x0, z0], [x0 + cell, z0], [x0, z0 + cell], [x0 + cell, z0 + cell]]) { const u = x * FIELD_U[0] + z * FIELD_U[1], v = x * FIELD_V[0] + z * FIELD_V[1]; lo = Math.min(lo, v); hi = Math.max(hi, v); ulo = Math.min(ulo, Math.abs(u)); } return hi < V0 || lo > V1 || ulo > U; },
  // creosote 0.45 to 1.4 m, saltbush and burrobush under a metre; saltbush pale grey-green, burrobush grey
  sizes: { creosote: 0.6, mesquite: 0.9, snakeweed: 1.15, grass: 0.8 },
  tone: { creosote: 2.6, mesquite: [3.6, 0.7], snakeweed: [3.6, 0.45], grass: 2.2 },
};
