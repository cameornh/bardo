import {waterTransmittance} from './water-material.js';

// CPU reference for the tracer lighting used by the GPU splat pass. All
// spectral attenuation comes from the shared water material, not a blue tint.
export function detailRadiance(kind,environment,ambient,viewPath,lightPath,turbidity=0,sunVisibility=1,sunlight=1,response=1) {
  const view=waterTransmittance(viewPath,turbidity),incoming=waterTransmittance(lightPath,turbidity);
  return environment.map((value,k)=>{
    const sun=Array.isArray(sunVisibility)?sunVisibility[k]:sunVisibility;
    const direct=(kind===0?2.4:kind===1?1.25:.1)*sun*sunlight*response,indirect=Math.max(0,value)*(kind===2?.8:1)*ambient;
    return (direct+indirect)*incoming[k]*view[k];
  });
}
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
export function detailResponse(kind,view,normal,light){
 const cosine=dot(view,light)*-1,g=kind===2?.45:.55,phase=(1-g*g)/(1+g*g-2*g*cosine)**1.5;
 if(kind!==1)return .45+.55*phase;
 const h=view.map((v,k)=>v+light[k]),length=Math.hypot(...h);if(length<1e-6)return .6;
 const half=h.map(v=>v/length),nv=Math.max(.05,dot(normal,view)),nl=Math.max(0,dot(normal,light)),nh=Math.max(0,dot(normal,half)),vh=Math.max(0,dot(view,half)),a2=.35**4,d=a2/(Math.PI*(nh*nh*(a2-1)+1)**2),k=.228;
 const geometry=nv/(nv*(1-k)+k)*nl/(nl*(1-k)+k),f=.02+.98*(1-vh)**5,specular=d*geometry*f/(4*nv);
 return .6+.4*nl+2*Math.PI*specular;
}
export const DETAIL_LIGHT_GLSL=`
vec2 detailEncodeNormal(vec3 n){n/=abs(n.x)+abs(n.y)+abs(n.z);return n.z>=0.?n.xy:(1.-abs(n.yx))*mix(vec2(1),vec2(-1),lessThan(n.xy,vec2(0)));}
vec3 detailDecodeNormal(vec2 p){vec3 n=vec3(p,1.-abs(p.x)-abs(p.y));if(n.z<0.)n.xy=(1.-abs(n.yx))*mix(vec2(1),vec2(-1),lessThan(n.xy,vec2(0)));return normalize(n);}
float detailResponse(float kind,vec3 view,vec3 normal,vec3 light){
 float cosine=-dot(view,light),g=kind>1.5?.45:.55,phase=(1.-g*g)/pow(1.+g*g-2.*g*cosine,1.5);if(kind<.5||kind>1.5)return .45+.55*phase;
 vec3 h=view+light;if(length(h)<1e-6)return .6;h=normalize(h);float nv=max(.05,dot(normal,view)),nl=max(0.,dot(normal,light)),nh=max(0.,dot(normal,h)),vh=max(0.,dot(view,h)),a2=pow(.35,4.),d=a2/(3.14159265*pow(nh*nh*(a2-1.)+1.,2.)),k=.228;
 float geometry=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k),f=.02+.98*pow(1.-vh,5.),specular=d*geometry*f/(4.*nv);return .6+.4*nl+6.28318531*specular;
}
vec3 detailLight(float kind,vec3 environment,float ambient,vec3 sunVisibility,float sunlight,float response){
 return vec3(kind<.5?2.4:kind<1.5?1.25:.1)*sunVisibility*sunlight*response+max(environment,vec3(0))*(kind>1.5?.8:1.)*ambient;
}
`;
