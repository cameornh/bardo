import {bodyRayHit} from './body-ray.js';
import {soluteCoefficients} from './water-lab-solutes.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';
// Only glass strictly in FRONT of a bead tints it. In particular a bead on
// the near side of its own receiver must not inherit that receiver's tint.
export function beadGlassTransmission(eye,point,radius,bodies){
 const delta=point.map((v,k)=>v-eye[k]),depth=Math.hypot(...delta),ray=delta.map(v=>v/Math.max(depth,1e-9)),tint=[1,1,1];let nearest=1e4;
 for(const b of bodies){if(b.kind!=='glass')continue;const t=bodyRayHit(eye,ray,b,depth-radius*1.5);
  if(!Number.isFinite(t))continue;nearest=Math.min(nearest,t);for(let k=0;k<3;k++)tint[k]*=Math.max(.02,b.color[k])**.4;
 }return [...tint,nearest];
}
export function beadTransport(light,segments,organic=0,turbidity=0,glass=[1,1,1,1e4]){
 const T=[1,1,1],scatter=[0,0,0];
 for(const s of segments){const c=soluteCoefficients(s.chem||[0,0,0],organic,turbidity);for(let k=0;k<3;k++){const tr=Math.exp(-c.extinction[k]*s.length);scatter[k]+=T[k]*(1-tr)*c.scatter[k]/c.extinction[k]*s.incident[k]*(s.depth>glass[3]?glass[k]:1);T[k]*=tr;}}
 return light.map((v,k)=>v*T[k]*glass[k]+scatter[k]);
}
// Twelve occupied-water intervals, evaluated per Gaussian vertex, never per
// covered fragment. The host field and CPU volume ledger remain unchanged.
export const BEAD_TRANSPORT_GLSL=`
${LAB_FIELD_GLSL}
uniform bool uBeadWater;uniform float uScale,uTurbidity;
in vec4 aGlass;flat out vec3 vBeadTransmission,vBeadScatter;
void beadViewTransport(vec3 point){
 vBeadTransmission=aGlass.rgb;vBeadScatter=vec3(0);if(!uBeadWater)return;
 vec3 delta=point-uEye,ray=normalize(delta),trans=vec3(1);float stepSize=length(delta)/12.;
 float sh[16];basisSH(vec3(0,1,0),sh);vec3 ambient=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;ambient+=uSH[i]*sh[i]*diffuseSHBand(i);}
 vec3 incident=max(ambient,vec3(0))*uAmbient+LAB_SUN*uSunlight*.25;
 for(int i=0;i<12;i++){float depth=(float(i)+.5)*stepSize;vec4 field=parcelSample(uEye+ray*depth);float lengthWet=smoothstep(.12,.24,field.x)*stepSize*uScale;if(lengthWet<=0.)continue;
 vec3 chem=field.yzw/max(field.x,.0001),ext=soluteExtinction(chem,uTannins,uTurbidity),tr=exp(-ext*lengthWet);
 vBeadScatter+=trans*(1.-tr)*soluteScatter(chem,uTannins,uTurbidity)/ext*incident*(depth>aGlass.w?aGlass.rgb:vec3(1));trans*=tr;
 }vBeadTransmission*=trans;
}`;
