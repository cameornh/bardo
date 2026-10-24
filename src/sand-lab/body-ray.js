import {bodyLocal} from './objects.js';
import {rotate} from './water-lab-model.js';

// Exact ray intervals for the same hollow cylinder used by bodyDistance.
// Subtract the cavity interval from the outer cylinder. This replaces nested
// SDF marches in lighting and rain contact queries, including thin tilted rims.
function cylinderInterval(q,d,r,bottom,top){
 let lo=-Infinity,hi=Infinity;
 if(Math.abs(d[1])<1e-10){if(q[1]<bottom||q[1]>top)return null;}
 else{const a=(bottom-q[1])/d[1],b=(top-q[1])/d[1];lo=Math.min(a,b);hi=Math.max(a,b);}
 const a=d[0]**2+d[2]**2,b=q[0]*d[0]+q[2]*d[2],c=q[0]**2+q[2]**2-r*r;
 if(a<1e-12){if(c>0)return null;}
 else{const disc=b*b-a*c;if(disc<0)return null;const root=Math.sqrt(disc);lo=Math.max(lo,(-b-root)/a);hi=Math.min(hi,(-b+root)/a);}
 return lo<=hi?[lo,hi]:null;
}
export function bodyRayHit(origin,direction,body,limit=Infinity,near=1e-6){
 const q=bodyLocal(origin,body),d=rotate(direction,body.tilt||0,body.spin||0,true,body.pitch||0),r=body.radius;
 if(body.shape!=='cup'){const b=q.reduce((s,v,k)=>s+v*d[k],0),c=q.reduce((s,v)=>s+v*v,0)-r*r,disc=b*b-c;if(disc<0)return Infinity;const root=Math.sqrt(disc),t=Math.max(near,-b-root);return t<=-b+root&&t<limit?t:Infinity;}
 const outer=cylinderInterval(q,d,r,-1.16*r,r);if(!outer)return Infinity;
 let t=Math.max(near,outer[0]);const inner=cylinderInterval(q,d,.68*r,-.84*r,1e20);
 if(inner&&t>=inner[0]&&t<=inner[1])t=inner[1];
 return t<=outer[1]&&t<limit?t:Infinity;
}
export const BODY_RAY_GLSL=`
vec2 bodyCylinderInterval(vec3 q,vec3 d,float r,float bottom,float top){
 float lo=-1e20,hi=1e20;
 if(abs(d.y)<1e-10){if(q.y<bottom||q.y>top)return vec2(1,-1);}
 else{vec2 cap=(vec2(bottom,top)-q.y)/d.y;lo=min(cap.x,cap.y);hi=max(cap.x,cap.y);}
 float a=dot(d.xz,d.xz),b=dot(q.xz,d.xz),c=dot(q.xz,q.xz)-r*r;
 if(a<1e-12){if(c>0.)return vec2(1,-1);}
 else{float disc=b*b-a*c;if(disc<0.)return vec2(1,-1);float root=sqrt(disc);lo=max(lo,(-b-root)/a);hi=min(hi,(-b+root)/a);}
 return vec2(lo,hi);
}
float bodyRayHit(vec3 origin,vec3 direction,int i,float limit,float near){
 vec4 b=labBody(i);vec3 q=bodyLocal(origin,i),d=bodyLocal(b.xyz+direction,i);float r=b.w;
 if(bodyExtra(i,0).w<.5){float along=dot(q,d),c=dot(q,q)-r*r,disc=along*along-c;if(disc<0.)return 1e20;float root=sqrt(disc),t=max(near,-along-root);return t<=-along+root&&t<limit?t:1e20;}
 vec2 outer=bodyCylinderInterval(q,d,r,-1.16*r,r);if(outer.x>outer.y)return 1e20;
 float t=max(near,outer.x);vec2 inner=bodyCylinderInterval(q,d,.68*r,-.84*r,1e20);
 if(inner.x<=inner.y&&t>=inner.x&&t<=inner.y)t=inner.y;
 return t<=outer.y&&t<limit?t:1e20;
}
`;
