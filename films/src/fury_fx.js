// Film-local effects for "Fox Three": the missile's exhaust trail as a ray-marched volume.
// The trail lives in its own frame: origin where the motor lit, +x along the launch heading, +y up, +z to
// the right. Smoke stays where it was made (the air is still) and widens with age, so at any film time the
// volume is a pure function of the motor kinematics and "now": frames can be rendered in any order.
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
    uNow: { value: 0 }, uANow: { value: 0 }, uDens: { value: 1 }, uStretch: { value: 1 }, uSigma: { value: 9 },
    uPlume: { value: new THREE.Vector3(1.0, 0.5, 0.2) }, uPlumeK: { value: 1 }, uRad: { value: new THREE.Vector3(0.10, 0.55, 0.12) },
  };
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
      uniform vec3 uSunColor, uSunT, uCamT, uBoxMin, uBoxMax, uClimb, uPlume, uRad; uniform vec4 uKin;
      uniform float uNow, uANow, uDens, uStretch, uSigma, uPlumeK;
      varying vec3 vT; varying float vZ;
      float sceneDist(){ float d = texture2D(tDepth, gl_FragCoord.xy/uRes).x; return d >= 0.999999 ? 1.0e9 : viewZ(d); }
      // when was the smoke at along-track distance a made?
      float emitTime(float a){
        float V = uKin.x, A1 = uKin.y, t1 = uKin.z, A2 = uKin.w, a1 = V*t1+0.5*A1*t1*t1;
        if (a <= a1) return (-V+sqrt(V*V+2.0*A1*a))/A1;
        float v1 = V+A1*t1; return t1+(-v1+sqrt(v1*v1+2.0*A2*(a-a1)))/A2;
      }
      float climb(float tau){ float u = max(tau-uClimb.x, 0.0); return u < uClimb.z ? uClimb.y*u*u : uClimb.y*uClimb.z*(2.0*u-uClimb.z); }
      // x: distance to the tube surface (approximate), y: age (s), z: radius (m), w: radial position 0..1; q: offset from the axis
      vec4 tube(vec3 p, out vec2 q){
        float tau = emitTime(clamp(p.x, 0.0, uANow));
        float age = max(uNow-tau, 0.0), R = uRad.x+uRad.y*sqrt(age)+uRad.z*age;
        float wob = min(age, 7.0);                       // the trail drifts and kinks as it ages
        vec2 c = vec2(climb(tau)+0.2*wob+0.34*wob*sin(p.x*0.047+1.3)+0.16*wob*sin(p.x*0.131), 0.42*wob*sin(p.x*0.033+0.4)+0.15*wob*sin(p.x*0.117+2.0));
        q = p.yz-c;
        float d = length(q)-R;
        d = max(d, max(-p.x, p.x-uANow));
        return vec4(d, age, R, length(q)/R);
      }
      float density(vec3 p, vec4 tb){
        if (tb.x > 0.0) return 0.0;
        float age = tb.y, R = tb.z, rr = tb.w;
        vec3 P = vec3(p.x*uStretch, p.y-age*0.25, p.z);
        vec4 n1 = texture(tNoise3, P*0.21+vec3(0.0, 0.0, age*0.03));
        float lo = n1.r*0.62+n1.g*0.38;
        float base = 1.0-smoothstep(0.0, 1.0, rr);
        float d = clamp((base+lo-0.86)*2.6, 0.0, 1.0);
        if (d > 0.0 && d < 0.98){ vec4 n2 = texture(tNoise3, P*0.93+0.37); d = clamp(d-(1.0-(n2.g*0.6+n2.b*0.4))*0.5*(1.0-d), 0.0, 1.0); }
        float rho0 = pow(0.25/max(R, 0.25), 1.55);
        return d*rho0*uDens*smoothstep(0.004, 0.035, age)*(1.0-smoothstep(5.5, 11.0, age));
      }
      float hgN(float c, float g){ return (1.0-g*g)/pow(max(1.0+g*g-2.0*g*c, 1e-3), 1.5); }
      void main(){
        vec3 ro = uCamT, dv = vT-uCamT; float far = length(dv); vec3 rd = dv/far;
        vec3 inv = 1.0/rd, ta = (uBoxMin-ro)*inv, tb2 = (uBoxMax-ro)*inv, tmn = min(ta, tb2), tmx = max(ta, tb2);
        float tN = max(max(tmn.x, tmn.y), max(tmn.z, 0.0)), tF = min(min(tmx.x, tmx.y), tmx.z);
        tF = min(tF, sceneDist()*far/max(vZ, 1e-3));
        if (tF <= tN) discard;
        float cv = dot(rd, uSunT);
        float ph = min(1.25*(0.65*hgN(cv, 0.6)+0.35*hgN(cv, -0.3)), 4.5);
        vec3 amb = texture2D(tAmbient, vec2(0.5)).rgb*0.3183;
        vec2 s2 = uSunT.yz; float sm = max(length(s2), 0.1); vec2 sh = s2/sm;
        float jit = fract(ign(gl_FragCoord.xy)+uFrame*0.618);
        float t = tN, T = 1.0; vec3 C = vec3(0.0); bool inside = false;
        for (int i=0;i<110;i++){
          if (t >= tF || T < 0.015) break;
          vec3 p = ro+rd*t; vec2 q; vec4 tb = tube(p, q);
          if (tb.x > 0.0){ t += max(tb.x*0.8, 0.03+t*0.002); inside = false; continue; }
          float ds = max(clamp(tb.z*0.2, 0.035, 2.5), t*0.0032);
          if (!inside){ inside = true; t += ds*jit; p = ro+rd*t; tb = tube(p, q); }
          float rho = density(p, tb);
          if (rho > 0.0008){
            float R = tb.z, age = tb.y;
            // optical depth towards the sun: a short probe for local structure, then the rest of the tube analytically
            vec2 qs; vec4 ts = tube(p+uSunT*R*0.38, qs);
            float b = dot(q, sh), chord = (-b+sqrt(max(b*b+R*R-dot(q,q), 0.0)))/sm;
            float rho0 = pow(0.25/max(R, 0.25), 1.55)*uDens;
            float tau = uSigma*(density(p+uSunT*R*0.38, ts)*R*0.5+rho0*0.42*max(chord-R*0.38, 0.0));
            float Ts = 0.72*exp(-tau)+0.28*exp(-tau*0.22);
            float up = clamp(0.5+0.5*q.x/max(R, 1e-3), 0.0, 1.0);
            vec3 L = 0.94*(uSunColor*0.3183*ph*Ts+amb*(0.55+0.65*up)*(0.55+0.45*tb.w));
            L += uPlume*uPlumeK*exp(-age/0.045)*(0.4+0.6*(1.0-tb.w));
            float a = 1.0-exp(-uSigma*rho*ds);
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
  mesh.onBeforeRender = (r, s, camera) => { inv.copy(mesh.matrixWorld).invert(); U.uCamT.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv); };
  const ahead = t => t < K.T1 ? 0.5 * K.A1 * t * t : 0.5 * K.A1 * K.T1 * K.T1 + K.A1 * K.T1 * (t - K.T1) + 0.5 * K.A2 * (t - K.T1) * (t - K.T1);
  const climb = t => { const u = Math.max(t - K.climbT0, 0); return u < K.climbT1 ? K.climbK * u * u : K.climbK * K.climbT1 * (2 * u - K.climbT1); };
  // now: seconds since the motor lit; ignRel: ignition point relative to the render origin; hdg: launch heading (deg)
  mesh.userData.set = (now, ignRel, hdg, sunDir, o = {}) => {
    if (now <= 0.002) { mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.copy(ignRel); attitude(hdg, 0, 0, mesh.quaternion);
    U.uSunT.value.copy(sunDir).applyQuaternion(qi.copy(mesh.quaternion).invert());
    const tb = Math.min(now, K.burn), aNow = K.V * tb + ahead(tb);
    U.uNow.value = now; U.uANow.value = aNow;
    const R = U.uRad.value, Rm = R.x + R.y * Math.sqrt(now) + R.z * now, wob = Math.min(now, 7);
    U.uBoxMin.value.set(-0.5, -Rm - 0.7 * wob - 0.3, -Rm - 0.6 * wob - 0.3);
    U.uBoxMax.value.set(aNow + 0.3, climb(tb) + Rm + 0.9 * wob + 0.3, Rm + 0.6 * wob + 0.3);
    U.uDens.value = o.density ?? 1; U.uStretch.value = o.stretch ?? 1; U.uPlumeK.value = o.plume ?? 1; U.uSigma.value = o.sigma ?? 9;
  };
  return mesh;
}
