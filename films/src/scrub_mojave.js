// Film 2 scrub field (see src/scrub.js): the unpaved ground of the Edwards airfield as the film dresses it: the
// infield between the runway and the parallel taxiway, and the open desert on the far side of the runway, in the
// airfield's own axes (u along the runway, v across it towards the flight line). Mojave creosote-bursage scrub:
// creosote well spaced, grey saltbush and burrobush between, sparse dry bunchgrass.
import { FIELD_U, FIELD_V } from './terrain_mojave.js';
import { SCRUB_DRAWN } from './scrub.js';

const U = 2300, V0 = -960, V1 = 222;
const GLSL = /* glsl */`
#define SCRUB_PITCH 2.0
const vec2 SM_FU = vec2(${FIELD_U[0].toFixed(5)}, ${FIELD_U[1].toFixed(5)}), SM_FV = vec2(${FIELD_V[0].toFixed(5)}, ${FIELD_V[1].toFixed(5)});
float scrubPatch(vec2 f){ return 0.5+0.5*sin(f.x*0.011+sin(f.y*0.004)*2.1)*cos(f.y*0.0075+sin(f.x*0.006)*1.7); }
float scrubDensity(vec2 q){
  vec2 f = vec2(dot(q, SM_FU), dot(q, SM_FV));
  if (abs(f.x) > ${U.toFixed(1)}) return 0.0;
  bool far = f.y < -58.0 && f.y > ${V0.toFixed(1)}, infield = f.y > 58.0 && f.y < ${V1.toFixed(1)};
  if (!far && !infield) return 0.0;
  if (infield && (abs(f.x-40.0) < 16.0 || abs(abs(f.x)-1150.0) < 16.0 || abs(abs(f.x)-2262.0) < 16.0)) return 0.0;   // taxiway connectors
  if (far && abs(f.y+96.0) < 4.5) return 0.0;                                                                         // perimeter track
  float d = 0.16+0.5*scrubPatch(f);
  d *= far ? (1.0-smoothstep(-70.0, -58.0, f.y))*smoothstep(${V0.toFixed(1)}, ${(V0 + 260).toFixed(1)}, f.y) : 0.55*smoothstep(58.0, 66.0, f.y)*(1.0-smoothstep(${(V1 - 8).toFixed(1)}, ${V1.toFixed(1)}, f.y));
  return d*(1.0-smoothstep(${(U - 200).toFixed(1)}, ${U.toFixed(1)}, abs(f.x)));
}
${SCRUB_DRAWN}
`;
// the same field in JS (keep in step with GLSL)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function density(x, z) {
  const u = x * FIELD_U[0] + z * FIELD_U[1], v = x * FIELD_V[0] + z * FIELD_V[1];
  if (Math.abs(u) > U) return 0;
  const far = v < -58 && v > V0, infield = v > 58 && v < V1;
  if (!far && !infield) return 0;
  if (infield && (Math.abs(u - 40) < 16 || Math.abs(Math.abs(u) - 1150) < 16 || Math.abs(Math.abs(u) - 2262) < 16)) return 0;
  if (far && Math.abs(v + 96) < 4.5) return 0;
  let d = 0.16 + 0.5 * (0.5 + 0.5 * Math.sin(u * 0.011 + Math.sin(v * 0.004) * 2.1) * Math.cos(v * 0.0075 + Math.sin(u * 0.006) * 1.7));
  d *= far ? (1 - sstep(-70, -58, v)) * sstep(V0, V0 + 260, v) : 0.55 * sstep(58, 66, v) * (1 - sstep(V1 - 8, V1, v));
  return d * (1 - sstep(U - 200, U, Math.abs(u)));
}
const species = (x, z, h) => h < 0.2 ? 3 : (h < 0.44 ? 2 : (h < 0.6 ? 1 : 0));   // creosote 40 %, saltbush 16 %, burrobush 24 %, grass 20 %
const corners = [[-U, V0], [U, V0], [-U, V1], [U, V1]].map(([u, v]) => [u * FIELD_U[0] + v * FIELD_V[0], u * FIELD_U[1] + v * FIELD_V[1]]);
export const SCRUB_FIELD_MOJAVE = {
  pitch: 2, cell: 96, density, species, glsl: GLSL,
  bounds: [Math.min(...corners.map(c => c[0])), Math.max(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])), Math.max(...corners.map(c => c[1]))],
  // cells wholly outside the dressed strip are never built
  skip: (x0, z0, cell) => { let lo = Infinity, hi = -Infinity, ulo = Infinity; for (const [x, z] of [[x0, z0], [x0 + cell, z0], [x0, z0 + cell], [x0 + cell, z0 + cell]]) { const u = x * FIELD_U[0] + z * FIELD_U[1], v = x * FIELD_V[0] + z * FIELD_V[1]; lo = Math.min(lo, v); hi = Math.max(hi, v); ulo = Math.min(ulo, Math.abs(u)); } return hi < V0 || lo > V1 || ulo > U; },
};
