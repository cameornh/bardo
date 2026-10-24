import {bodyRayHit,BODY_RAY_GLSL} from './body-ray.js';
import {bodyNormal} from './objects.js';
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
// A straight-through approximation, not a refractive caustic solver. Finite
// chord coverage makes transparent silhouettes approach air continuously.
export function glassShadowTransmission(cosine,path,color=[1,1,1]){
 const interfaces=1-.0784*smooth(0,.35,cosine);
 return [.07,.028,.02].map((a,k)=>interfaces*Math.exp(-(a-Math.log(Math.max(.01,color[k]))*.4)*path));
}
export function bodyLightTransmission(p,d,maxDistance,balls,{scale=1,sourceRadius=.06,angularRadius=0}={}){
 const result=[1,1,1];
 for(const b of balls){const q=b.position.map((v,k)=>v-p[k]),t=dot(q,d),r=b.radius,bound=r*(b.shape==='cup'?1.55:1);
  if(t<=.008)continue;const nearest=Math.min(t,maxDistance),miss=Math.hypot(...q.map((v,k)=>v-d[k]*nearest)),soft=.004+angularRadius*nearest+sourceRadius*nearest/maxDistance,coverage=1-smooth(bound-soft,bound+soft,miss);if(coverage<=0)continue;
  let cosine=Math.sqrt(Math.max(0,1-Math.min(1,miss*miss/(r*r)))),path=2*r*cosine*scale;
  if(b.shape==='cup'){const travel=bodyRayHit(p,d,b,maxDistance,.012);if(!Number.isFinite(travel))continue;cosine=Math.abs(dot(bodyNormal(p.map((v,k)=>v+d[k]*travel),b),d));path=.32*r*scale/Math.max(.2,cosine);}
  else if(Math.hypot(...q)<r-.001)continue;
  const trans=b.kind==='glass'?glassShadowTransmission(cosine,path,b.color):[0,0,0];for(let k=0;k<3;k++)result[k]*=1-coverage*(1-trans[k]);
 }
 return result;
}
export const BODY_SHADOW_GLSL=`
${BODY_RAY_GLSL}
uniform bool uBodyShadows;
vec3 bodyTransmissionExcept(vec3 p,vec3 direction,float limit,float scale,float sourceRadius,float angularRadius,int exclude){
 vec3 visibility=vec3(1);if(!uBodyShadows)return visibility;
 for(int i=0;i<uBodyCount;i++){if(i==exclude)continue;vec4 b=labBody(i);vec3 q=b.xyz-p;float t=dot(q,direction),radius=b.w;bool cup=bodyExtra(i,0).w>.5;float bound=radius*(cup?1.55:1.);
  if(t<=.008)continue;
  float nearest=min(t,limit),miss=length(q-direction*nearest),soft=.004+angularRadius*nearest+sourceRadius*nearest/limit,coverage=1.-smoothstep(bound-soft,bound+soft,miss);if(coverage<=0.)continue;
  float cosine=sqrt(max(0.,1.-min(1.,miss*miss/(radius*radius)))),path=2.*radius*cosine*scale;
  if(cup){float travel=bodyRayHit(p,direction,i,limit,.012);if(travel>=1e20)continue;cosine=abs(dot(bodyNormal(p+direction*travel,i),direction));path=.32*radius*scale/max(.2,cosine);}
  else if(length(q)<radius-.001)continue;
  vec3 transmission=vec3(0);float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;
  if(kind<.5){float interfaces=1.-.0784*smoothstep(0.,.35,cosine);transmission=vec3(interfaces)*exp(-(vec3(.07,.028,.02)-log(max(bodyExtra(i,0).rgb,vec3(.01)))*.4)*path);}
  visibility*=mix(vec3(1),transmission,coverage);if(max(visibility.r,max(visibility.g,visibility.b))<.001)break;
 }return visibility;
}
vec3 bodyTransmission(vec3 p,vec3 direction,float limit,float scale,float sourceRadius,float angularRadius){return bodyTransmissionExcept(p,direction,limit,scale,sourceRadius,angularRadius,-1);}
vec3 bodySun(vec3 p,float scale){return bodyTransmission(p,normalize(uDaySun),10000.,scale,0.,.0047);}
`;
