// Shared GLSL chunks. World units are metres, +x east, +y up, +z south.

export const NOISE = /* glsl */`
float hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2  hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y); }
// value noise with analytic derivatives: x = value 0..1, yz = d/dp
vec3 noised(vec2 p){ vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*f*(f*(f*6.-15.)+10.); vec2 du=30.*f*f*(f*(f-2.)+1.);
  float a=hash12(i), b=hash12(i+vec2(1,0)), c=hash12(i+vec2(0,1)), d=hash12(i+vec2(1,1));
  return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y, du*(vec2(b-a,c-a)+(a-b-c+d)*u.yx)); }
float fbm(vec2 p, int oct){ float a=.5, s=0.; mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<8;i++){ if(i>=oct) break; s+=a*vnoise(p); p=m*p; a*=.5; } return s; }
float ridged(vec2 p, int oct){ float a=.5, s=0., w=1.; mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<8;i++){ if(i>=oct) break; float n=1.-abs(vnoise(p)*2.-1.); n*=n; s+=a*n*w; w=clamp(n*1.6,0.,1.); p=m*p; a*=.5; } return s; }
// interleaved gradient noise (screen-space dither)
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

// Physically based single-scatter atmosphere with an isotropic multi-scatter estimate.
// Planet space: origin at planet centre, camera at (0, RG + alt, 0).
export const ATMOSPHERE = /* glsl */`
uniform vec3  uSunDir;
uniform vec3  uSunE;      // sun irradiance at top of atmosphere (linear RGB)
uniform float uHaze;      // aerosol (Mie) density multiplier
uniform float uHazeH;     // aerosol scale height (m)
uniform float uMieG;
uniform float uMS;        // multiple-scatter gain
const float RG = 6360000.0;
const float RT = 6440000.0;
const vec3  BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float H_R = 8000.0;
const float BETA_M_S = 3.996e-6;
const float BETA_M_E = 4.440e-6;
const vec3  BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);

// density-weighted path length (m) from radius r to space along a ray with zenith cosine mu,
// for an exponential atmosphere of scale height H (Chapman-function approximation).
float odExp(float r, float mu, float H){
  float c = sqrt(1.5707963*r/H);
  float e = exp(-(r-RG)/H);
  if (mu >= 0.0) return H*e*c/((c-1.0)*mu+1.0);
  float r0 = r*sqrt(max(0.0, 1.0-mu*mu));
  if (r0 < RG-200.0) return 1.0e9;
  float c0 = sqrt(1.5707963*r0/H);
  float e0 = exp(-(r0-RG)/H);
  return H*(2.0*e0*c0 - e*c/((c-1.0)*(-mu)+1.0));
}
float odOzone(float r, float mu){
  float ro = RG+25000.0;
  float s2 = (r*r)/(ro*ro)*(1.0-mu*mu);
  return 15000.0/sqrt(max(1.0-s2, 0.004));
}
vec3 sunTau(float r, float mu){
  return BETA_R*odExp(r,mu,H_R) + (BETA_M_E*uHaze)*odExp(r,mu,uHazeH) + BETA_O*odOzone(r,mu);
}
float phaseR(float c){ return 0.0596831*(1.0+c*c); }
float phaseM(float c){ float g=uMieG, g2=g*g;
  return 0.1193662*((1.0-g2)*(1.0+c*c))/((2.0+g2)*pow(max(1.0+g2-2.0*g*c,1e-4),1.5)); }

// Integrates in-scattered radiance and transmittance over [0,tMax] along ro+rd*t.
// LR/LM are returned WITHOUT their phase functions so they can be stored in a smooth LUT.
void atmoIntegrate(vec3 ro, vec3 rd, float tMax, float dither, int N,
                   out vec3 LR, out vec3 LM, out vec3 LMS, out vec3 T){
  float b = dot(ro,rd), c = dot(ro,ro)-RT*RT;
  float tTop = -b+sqrt(max(b*b-c,0.0));
  float t1 = min(tMax, tTop);
  vec3 od = vec3(0.0);
  LR = vec3(0.0); LM = vec3(0.0); LMS = vec3(0.0);
  float fN = float(N);
  for (int i=0;i<32;i++){
    if (i>=N) break;
    float a0=float(i)/fN, a1=float(i+1)/fN, am=(float(i)+dither)/fN;
    float ds = t1*(a1*a1-a0*a0), t = t1*am*am;
    vec3 p = ro+rd*t; float r = length(p); float alt = max(r-RG,0.0);
    float dR = exp(-alt/H_R), dM = exp(-alt/uHazeH)*uHaze, dO = max(0.0,1.0-abs(alt-25000.0)/15000.0);
    vec3 odS = od+0.5*ds*vec3(dR,dM,dO);
    vec3 tauV = BETA_R*odS.x+BETA_M_E*odS.y+BETA_O*odS.z;
    float mu = dot(p,uSunDir)/r;
    vec3 tauS = sunTau(r,mu);
    vec3 Tv = exp(-tauV);
    vec3 Ts = Tv*exp(-tauS);
    LR += ds*Ts*(BETA_R*dR);
    LM += ds*Ts*(BETA_M_S*dM);
    // second-order light: roughly the hemisphere-averaged sky at the sample
    vec3 amb = exp(-0.55*tauS)*0.085 + vec3(0.0006,0.0010,0.0022)*smoothstep(-0.25,0.1,mu);
    LMS += ds*Tv*(BETA_R*dR+BETA_M_S*dM)*amb;
    od += ds*vec3(dR,dM,dO);
  }
  T = exp(-(BETA_R*od.x+BETA_M_E*od.y+BETA_O*od.z));
  LR *= uSunE; LM *= uSunE; LMS *= uSunE*uMS;
}
vec3 atmoCombine(vec3 LR, vec3 LM, vec3 LMS, float cosV){ return LR*phaseR(cosV)+LM*phaseM(cosV)+LMS; }

// sky-view LUT mapping: u = azimuth, v = elevation (non-linear, dense near the horizon)
vec2 skyUV(vec3 d){
  float el = asin(clamp(d.y,-1.0,1.0));
  float v = 0.5+0.5*sign(el)*sqrt(abs(el)/1.5707963);
  float u = atan(d.z,d.x)/6.2831853+0.5;
  return vec2(u,v);
}
vec3 skyDir(vec2 uv){
  float s = uv.y*2.0-1.0; float el = sign(s)*s*s*1.5707963;
  float az = (uv.x-0.5)*6.2831853;
  return vec3(cos(el)*cos(az), sin(el), cos(el)*sin(az));
}
`;

// log-depth decode (matches three.js logarithmicDepthBuffer)
export const DEPTH = /* glsl */`
uniform float uLogFar;   // log2(far+1)
float viewZ(float d){ return exp2(d*uLogFar)-1.0; }
`;

export const FSQ_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
