import {fountainDistance} from './water-lab-fountain.js';
const clamp=x=>Math.max(0,Math.min(1,x));
// Bound the ray, not its origin: a point beyond the rim can still be in shadow.
export function fountainRayInterval(p,d){let lo=.012,hi=40;for(let k=0;k<3;k++){const a=[-4.8,-.5,-4.8][k],b=[4.8,5.9,4.8][k];if(Math.abs(d[k])<1e-8){if(p[k]<a||p[k]>b)return null;continue;}const x=(a-p[k])/d[k],y=(b-p[k])/d[k];lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));}return lo<hi?[lo,hi]:null;}
export function fountainVisibility(p,d){const interval=fountainRayInterval(p,d);if(!interval)return 1;let [t,end]=interval,visibility=1;for(let i=0;i<128&&t<end;i++){const distance=fountainDistance(p.map((v,k)=>v+d[k]*t));if(distance<.002)return 0;visibility=Math.min(visibility,80*distance/Math.max(.04,t));t+=Math.max(.002,distance*.55);}return clamp(visibility);}
export const FOUNTAIN_VISIBILITY_GLSL=`
vec2 fountainRayInterval(vec3 p,vec3 d){vec3 safe=vec3(abs(d.x)<1e-8?1e-8:d.x,abs(d.y)<1e-8?1e-8:d.y,abs(d.z)<1e-8?1e-8:d.z),a=(vec3(-4.8,-.5,-4.8)-p)/safe,b=(vec3(4.8,5.9,4.8)-p)/safe,lo=min(a,b),hi=max(a,b);return vec2(max(.012,max(lo.x,max(lo.y,lo.z))),min(40.,min(hi.x,min(hi.y,hi.z))));}
float fountainVisibility(vec3 p,vec3 d){vec2 interval=fountainRayInterval(p,d);float t=interval.x,visibility=1.;for(int i=0;i<128;i++){if(t>=interval.y)break;float h=fountainDistance(p+d*t);if(h<.002)return 0.;visibility=min(visibility,80.*h/max(.04,t));t+=max(.002,h*.55);}return clamp(visibility,0.,1.);}
`;
// A photon has finite power, split between reflection and transmission. CPU
// reference for the same dielectric split in the GPU fountain photon pass.
export function fountainBounce(d,n){const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),c=Math.max(0,-dot(d,n)),eta=1/1.333,F=.02037318784+(1-.02037318784)*(1-c)**5,k=1-eta*eta*(1-c*c);return {reflected:d.map((v,i)=>v+2*c*n[i]),refracted:d.map((v,i)=>eta*v+(eta*c-Math.sqrt(k))*n[i]),reflection:F,transmission:1-F};}
export const FOUNTAIN_BOUNCE_GLSL=`
float fountainFresnel(float c){return .02037318784+(1.-.02037318784)*pow(1.-clamp(c,0.,1.),5.);}
`;
export const FOUNTAIN_RECEIVER_GLSL=`
#ifdef FOUNTAIN_LIGHTING
uniform sampler2D uFountainReceiver,uFountainReceiverNormal,uFountainBounceFlux,uFountainBounceDirection,uFountainGround;
uniform bool uFountainCaustics;
float fountainOpaqueDepth(vec2 uv){vec4 p=texture(uFountainReceiver,uv);return p.a>.5?distance(uEye,p.xyz):1e4;}
vec3 fountainGroundSky(vec3 p){if(any(greaterThan(abs(p.xz),vec2(9.8))))return vec3(1);return texture(uFountainGround,p.xz/20.+.5).rgb;}
vec3 fountainBounceLight(vec3 p,vec3 n,vec3 v,float roughness,vec3 f0,float diffuse){
 if(!uFountainCaustics)return vec3(0);vec4 clip=uProjection*uViewMatrix*vec4(p,1);if(clip.w<=0.)return vec3(0);vec2 uv=clip.xy/clip.w*.5+.5;if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec3(0);
 vec4 receiver=texture(uFountainReceiver,uv);if(receiver.a<.5||distance(receiver.xyz,p)>.08)return vec3(0);
 vec3 flux=texture(uFountainBounceFlux,uv).rgb;vec4 moment=texture(uFountainBounceDirection,uv);if(moment.w<1e-8)return vec3(0);vec3 l=normalize(moment.xyz);float cosine=max(.05,dot(n,l));
 // The photon footprint subtends a finite solid angle. Filter the conductor's
 // lobe accordingly instead of treating a caustic as an emissive white decal.
 float spread=1.-clamp(length(moment.xyz)/moment.w,0.,1.),r=max(roughness,sqrt(.035+spread*.4));
 vec3 brdf=vec3(labSpecular(n,v,l,r,f0.r),labSpecular(n,v,l,r,f0.g),labSpecular(n,v,l,r,f0.b))*3.14159265/cosine;
 return LAB_SUN*uSunlight*flux*mix(brdf,vec3(1),diffuse);
}
#else
float fountainOpaqueDepth(vec2 uv){return 1e4;}
vec3 fountainGroundSky(vec3 p){return vec3(1);}
vec3 fountainBounceLight(vec3 p,vec3 n,vec3 v,float r,vec3 f,float d){return vec3(0);}
#endif

`;
