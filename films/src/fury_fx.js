// Film-local effects for "Fox Three": the missile's exhaust trail as a ray-marched volume.
// The trail lives in its own frame: origin where the motor lit, +x along the launch heading, +y up, +z to the right.
// Smoke stays where it was made (the air is still) and spreads with age, so at any film time the volume is a pure
// function of the motor kinematics and "now": frames can be rendered in any order.
// What it models, after photographs of rocket-motor trails:
//   - a narrow, dense jet behind the nozzle that flares within a few metres and then spreads slowly;
//   - billows about as wide as the trail itself: a cellular (Worley) field fixed in the air decides where the smoke
//     surface bulges and where it is eaten away, cross-faded to the next larger octave as the trail widens, so
//     lumps merge and grow with age without sliding along the smoke;
//   - puffs along the length (the motor's output is never even), a centreline that meanders more the older it is,
//     and break-up into separate wisps;
//   - light: the sun's optical depth through the neighbouring smoke (three probes), so each billow has a lit and
//     a shadowed side and the far side of the trail goes grey; forward-peaked scattering (bright when backlit);
//     dimmer, deeper-reaching octaves for multiple scattering; sky from above, the cloud deck from below; and the
//     motor's flame glowing through the youngest smoke;
//   - the camera's shutter: seen from an aircraft in formation the smoke streams past, so lumps shorter than the
//     distance travelled during the exposure fade into their mean (and a shot may stretch them along the track).
import * as THREE from 'three';
import { NOISE, DEPTH } from '../engine/glsl.js';
import { LAYER } from '../engine/pipeline.js';
import { attitude } from '../engine/geo.js';

// K: { V (launch-aircraft speed, m/s), A1, T1 (boost acceleration and duration), A2 (sustain), burn (s),
//      climbT0, climbK, climbT1 (the gentle loft: h = K u^2 until T1, then linear) }
export function makeMissileTrail(pipe, noise3, K) {
  const S = pipe.shared;
  const U = {
    tDepth: S.tDepth, uRes: S.uRes, uLogFar: S.uLogFar, uFrame: S.uFrame, tAmbient: S.tAmbient, uSunColor: S.uSunColor,
    tNoise3: { value: noise3 }, uSunT: { value: new THREE.Vector3(0, 1, 0) }, uCamT: { value: new THREE.Vector3() },
    uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3(1, 1, 1) },
    uKin: { value: new THREE.Vector4(K.V, K.A1, K.T1, K.A2) }, uClimb: { value: new THREE.Vector3(K.climbT0, K.climbK, K.climbT1) },
    uNow: { value: 0 }, uANow: { value: 0 }, uDrift: { value: new THREE.Vector3(0.15, 0.06, 0.0) },
    // radius (m) at age t: x + y (1 - exp(-t / z)) + w sqrt(t): the jet flares, then turbulence spreads it
    uRad: { value: new THREE.Vector4(0.07, 0.22, 0.05, 0.68) },
    // x: tile (m) of the lump field where the radius is 0.25 m (a cell is a quarter of it: about the radius),
    // y: how far the lumps move the surface, z: edge softness young, w: old
    uShape: { value: new THREE.Vector4(1.35, 1.1, 0.2, 0.6) },
    // x: extinction (1/m) of smoke at radius 1 m, y: wisps (interior erosion), z: break-up into puffs, w: burst at ignition
    uMass: { value: new THREE.Vector4(1.6, 0.75, 0.85, 1.1) },
    uPlume: { value: new THREE.Vector3(1.0, 0.6, 0.28) }, uPlumeK: { value: 1 },
    uDeck: { value: new THREE.Vector3(0.5, 0.45, 0.4) }, uBlur: { value: 0 }, uStretch: { value: 1 }, uPix: { value: 0.002 }, uAlbedo: { value: new THREE.Vector3(0.9, 0.92, 0.95) },
  };
  const ENV = 1.62;      // the smoke surface never lies outside this many radii
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: U,
    vertexShader: /* glsl */`
      uniform vec3 uBoxMin, uBoxMax; varying vec3 vT; varying float vZ;
      void main(){
        vT = mix(uBoxMin, uBoxMax, position+0.5);
        vec4 mv = modelViewMatrix*vec4(vT, 1.0); vZ = -mv.z;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */`
      precision highp float; precision highp sampler3D;
      ${NOISE}
      ${DEPTH}
      uniform sampler2D tDepth, tAmbient; uniform sampler3D tNoise3; uniform vec2 uRes; uniform float uFrame;
      uniform vec3 uSunColor, uSunT, uCamT, uBoxMin, uBoxMax, uClimb, uPlume, uDrift, uDeck, uAlbedo; uniform vec4 uKin, uRad, uShape, uMass;
      uniform float uNow, uANow, uPlumeK, uBlur, uStretch, uPix;
      varying vec3 vT; varying float vZ;
      const float ENV = ${ENV.toFixed(2)};
      float sceneDist(){ float d = texture2D(tDepth, gl_FragCoord.xy/uRes).x; return d >= 0.999999 ? 1.0e9 : viewZ(d); }
      // when was the smoke at along-track distance a made?
      float emitTime(float a){
        float V = uKin.x, A1 = uKin.y, t1 = uKin.z, A2 = uKin.w, a1 = V*t1+0.5*A1*t1*t1;
        if (a <= a1) return (-V+sqrt(V*V+2.0*A1*a))/A1;
        float v1 = V+A1*t1; return t1+(-v1+sqrt(v1*v1+2.0*A2*(a-a1)))/A2;
      }
      float climb(float tau){ float u = max(tau-uClimb.x, 0.0); return u < uClimb.z ? uClimb.y*u*u : uClimb.y*uClimb.z*(2.0*u-uClimb.z); }
      float radiusAt(float age){ return uRad.x+uRad.y*(1.0-exp(-age/uRad.z))+uRad.w*sqrt(age); }
      // how much smoke the motor made at along-track distance a (0..1): long puffs with shorter ones riding on them
      float puff(float a){ return 0.5+0.27*sin(a*0.173+0.6)+0.15*sin(a*0.419+2.3)+0.08*sin(a*1.07+4.1); }
      // x: distance outside the trail's envelope (m), y: age (s), z: radius (m), w: radial position in radii;
      // q: offset from the axis, pf: the motor's output there
      vec4 tube(vec3 p, out vec2 q, out float pf){
        float a = clamp(p.x, 0.0, uANow), tau = emitTime(a);
        float age = max(uNow-tau, 0.0), R = radiusAt(age);
        pf = puff(a);
        // the first metres (the motor lighting on the rail) burst wide; the width follows the motor's output
        R *= (0.8+0.4*pf)*(1.0+uMass.w*exp(-a/5.0)*smoothstep(0.0, 0.3, age));
        // the trail sinks a little and meanders more the older it is (wake, light shear)
        float w = min(age, 12.0), m = 0.2*w+0.03*w*w;
        vec2 c = vec2(climb(tau)-uDrift.y*w+m*(0.6*sin(a*0.043+1.3)+0.4*sin(a*0.131)),
                      uDrift.x*w+m*(0.6*sin(a*0.031+0.4)+0.4*sin(a*0.117+2.0)));
        q = p.yz-c;
        float d = length(q)-R*ENV;
        d = max(d, max(-p.x-0.2, p.x-uANow));
        return vec4(d, age, R, length(q)/R);
      }
      // extinction (1/m) at p. lod: 0..1, 1 = lumps fully resolved, 0 = smaller than a pixel or than the shutter's
      // smear (they fade to their mean instead of sparkling)
      float density(vec3 p, vec4 tb, float pf, float lod){
        if (tb.x > 0.0) return 0.0;
        vec3 pn = vec3(p.x/uStretch, p.yz);
        float age = tb.y, R = tb.z, rr = tb.w;
        // two octaves of cells, the nearer one about as wide as the trail; which pair depends on the width, so
        // the lumps stay where they are and hand over to the next size as the trail spreads
        float l = log2(max(R, 0.1)/0.25), i0 = floor(l), f = l-i0, La = uShape.x*exp2(i0);
        vec3 oa = fract(vec3(0.37, 0.71, 0.13)*(i0+3.0)), ob = fract(vec3(0.37, 0.71, 0.13)*(i0+4.0));
        vec4 n = mix(texture(tNoise3, pn/La+oa), texture(tNoise3, pn/(2.0*La)+ob), f);
        n = 0.7+(n-0.7)/sqrt(f*f+(1.0-f)*(1.0-f));                       // the blend of two fields keeps its contrast
        float big = mix(0.5, smoothstep(0.46, 0.9, n.g), lod), fine = mix(0.5, smoothstep(0.5, 0.88, n.b*0.55+n.a*0.45), lod);
        // the smoke surface: pushed out where a cell sits, eaten in between; old smoke breaks into separate puffs
        float brk = uMass.z*smoothstep(1.5, 9.0, age)*(1.0-smoothstep(0.35, 0.8, pf));
        float edge = 1.0+uShape.y*(big-0.55)*1.25-brk;
        float soft = mix(uShape.z, uShape.w, smoothstep(0.15, 6.0, age));
        float d = clamp((edge-rr)/soft, 0.0, 1.0); d *= d*(3.0-2.0*d);
        d *= mix(1.0, 0.25+1.5*fine*fine, uMass.y*smoothstep(0.05, 2.5, age));   // wisps and hollows once it has aged
        float rho = uMass.x/(R*R)*(0.55+0.9*pf);                         // the same smoke over a wider section
        return d*rho*smoothstep(0.004, 0.035, age)*(1.0-smoothstep(11.0, 18.0, age));
      }
      float hg(float c, float g){ return (1.0-g*g)/(12.566371*pow(max(1.0+g*g-2.0*g*c, 1e-3), 1.5)); }
      void main(){
        vec3 ro = uCamT, dv = vT-uCamT; float far = length(dv); vec3 rd = dv/far;
        vec3 inv = 1.0/rd, ta = (uBoxMin-ro)*inv, tb2 = (uBoxMax-ro)*inv, tmn = min(ta, tb2), tmx = max(ta, tb2);
        float tN = max(max(tmn.x, tmn.y), max(tmn.z, 0.0)), tF = min(min(tmx.x, tmx.y), tmx.z);
        tF = min(tF, sceneDist()*far/max(vZ, 1e-3));
        if (tF <= tN) discard;
        float cv = dot(rd, uSunT);
        // each scattering order is dimmer, reaches deeper and forgets more of the sun's direction
        float ph0 = mix(hg(cv, 0.72), hg(cv, -0.25), 0.35), ph1 = mix(hg(cv, 0.36), hg(cv, -0.12), 0.35), ph2 = 0.0796;
        vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb*0.3183;
        // smoke this white photographs paler than the low sun's own colour (thin edges are lit by the whole sky as well)
        vec3 sunC = mix(uSunColor, vec3(dot(uSunColor, vec3(0.3, 0.55, 0.15))), 0.5);
        float jit = hash12(gl_FragCoord.xy+fract(uFrame*0.618)*61.0), perp = length(rd.yz);   // grain, not a hatch pattern
        float t = tN, T = 1.0; vec3 C = vec3(0.0); bool inside = false;
        for (int i=0;i<128;i++){
          if (t >= tF || T < 0.015) break;
          vec3 p = ro+rd*t; vec2 q; float pf; vec4 tb = tube(p, q, pf);
          if (tb.x > 0.0){ t += max(tb.x*0.7, 0.03+t*0.002); inside = false; continue; }
          float R = tb.z, age = tb.y;
          float ds = max(clamp(R*0.11, 0.015, 1.5), t*0.003);
          if (!inside){ inside = true; t += ds*jit; p = ro+rd*t; tb = tube(p, q, pf); R = tb.z; age = tb.y; }
          float cell = 0.6*uShape.x*R;
          float lod = (1.0-smoothstep(0.35, 1.3, t*uPix/cell))*(1.0-smoothstep(0.9, 2.6, uBlur*perp/cell));
          float rho = density(p, tb, pf, lod);
          if (rho > 0.0005){
            // optical depth towards the sun through the neighbouring smoke
            float tau = 0.0, sl = R*0.32; vec3 ps = p;
            for (int k=0;k<3;k++){
              ps += uSunT*sl; vec2 qs; float pfs; vec4 ts = tube(ps, qs, pfs);
              tau += density(ps, ts, pfs, lod)*sl; sl *= 1.9;
            }
            vec3 sun = sunC*(ph0*exp(-tau)+0.32*ph1*exp(-tau*0.4)+0.09*ph2*exp(-tau*0.13));
            float up = clamp(0.5+0.5*q.x/max(R*1.2, 1e-3), 0.0, 1.0), sky = 0.35+0.65*exp(-tau*0.35);
            vec3 L = (sun*3.14159+amb*(0.35+0.75*up)*sky+uDeck*amb*(1.0-up)*0.5)*uAlbedo;
            // the flame lights the youngest smoke from inside
            L += uPlume*(uPlumeK*dot(uSunColor, vec3(0.1))*(exp(-age/0.03)*3.0+exp(-age/0.1)*0.08))*(0.35+0.65*(1.0-clamp(tb.w, 0.0, 1.0)));
            float a = 1.0-exp(-rho*ds);
            C += T*a*L; T *= 1.0-a;
          }
          t += ds;
        }
        if (T > 0.999) discard;
        gl_FragColor = vec4(C, 1.0-T);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  mesh.frustumCulled = false; mesh.layers.set(LAYER.FX); mesh.renderOrder = 3; mesh.visible = false;
  const inv = new THREE.Matrix4(), qi = new THREE.Quaternion();
  mesh.onBeforeRender = (r, s, camera) => {
    inv.copy(mesh.matrixWorld).invert(); U.uCamT.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv);
    U.uPix.value = 2 / (camera.projectionMatrix.elements[5] * S.uRes.value.y);      // a pixel's width per metre of distance
  };
  const ahead = t => t < K.T1 ? 0.5 * K.A1 * t * t : 0.5 * K.A1 * K.T1 * K.T1 + K.A1 * K.T1 * (t - K.T1) + 0.5 * K.A2 * (t - K.T1) * (t - K.T1);
  const climb = t => { const u = Math.max(t - K.climbT0, 0); return u < K.climbT1 ? K.climbK * u * u : K.climbK * K.climbT1 * (2 * u - K.climbT1); };
  // now: seconds since the motor lit; ignRel: ignition point relative to the render origin; hdg: launch heading (deg)
  // o: { density, plume (glow in the young smoke), blur (m of travel during the exposure), stretch, deck: [r,g,b] light from
  //      below, rad, shape, mass (look development: replace uRad, uShape, uMass) }
  mesh.userData.set = (now, ignRel, hdg, sunDir, o = {}) => {
    if (now <= 0.002) { mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.copy(ignRel); attitude(hdg, 0, 0, mesh.quaternion);
    U.uSunT.value.copy(sunDir).applyQuaternion(qi.copy(mesh.quaternion).invert());
    if (o.rad) U.uRad.value.fromArray(o.rad); if (o.shape) U.uShape.value.fromArray(o.shape); if (o.mass) U.uMass.value.fromArray(o.mass);
    const tb = Math.min(now, K.burn), aNow = K.V * tb + ahead(tb);
    U.uNow.value = now; U.uANow.value = aNow;
    const R = U.uRad.value, M = U.uMass.value, w = Math.min(now, 12), m = 0.2 * w + 0.03 * w * w, dr = U.uDrift.value;
    const Rm = (R.x + R.y + R.w * Math.sqrt(now)) * ENV * 1.2 * (1 + M.w);       // widest: full output, the ignition burst
    U.uBoxMin.value.set(-0.25, -Rm - m - dr.y * w - 0.3, -Rm - m - 0.3);
    U.uBoxMax.value.set(aNow + 0.05, climb(tb) + Rm + m + 0.3, Rm + m + dr.x * w + 0.3);
    U.uMass.value.x = (o.mass ? o.mass[0] : 1.6) * (o.density ?? 1); U.uPlumeK.value = o.plume ?? 1; U.uBlur.value = o.blur ?? 0; U.uStretch.value = o.stretch ?? 1;
    if (o.deck) U.uDeck.value.fromArray(o.deck);
  };
  return mesh;
}
