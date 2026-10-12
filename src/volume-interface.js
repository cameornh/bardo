// Cube/plane intersection volume. Integrating the two smallest axes first
// avoids subtracting nearly equal cubes when an interface is axis-aligned.
function integratedSquareCDF(s,a,b){
 if(s<=0)return 0;if(s>=a+b)return s-(a+b)*.5;
 const flip=s>(a+b)*.5,r=flip?a+b-s:s;
 const j=r<=a?r*r*r/(6*a*b):(3*r*r-3*r*a+a*a)/(6*b);
 return flip?s-(a+b)*.5+j:j;
}
export function planeVolume(t,m){
 const a=m.filter(v=>v>1e-9).sort((x,y)=>x-y),n=a.length,total=a.reduce((s,v)=>s+v,0);
 if(t<=0||!n)return 0;if(t>=total)return 1;const flip=t>total*.5;if(flip)t=total-t;
 let v;if(n===1)v=t/a[0];else if(n===2)v=t<=a[0]?t*t/(2*a[0]*a[1]):(t-a[0]*.5)/a[1];
 else v=(integratedSquareCDF(t,a[0],a[1])-integratedSquareCDF(t-a[2],a[0],a[1]))/a[2];
 return Math.max(0,Math.min(1,flip?1-v:v));
}
export function planeOffset(alpha,m){let lo=0,hi=m[0]+m[1]+m[2];for(let i=0;i<14;i++){const mid=(lo+hi)*.5;if(planeVolume(mid,m)<alpha)lo=mid;else hi=mid;}return (lo+hi)*.5;}
export function planeFlux(alpha,normal,offset,axis,courant){if(alpha<1e-5||alpha>1-1e-5)return alpha;const c=Math.min(.999999,Math.abs(courant));if(c<1e-7)return alpha;const m=normal.map(Math.abs),high=(courant>=0)===(normal[axis]>=0);const b=offset-(high?m[axis]*(1-c):0);m[axis]*=c;return planeVolume(b,m);}
export const PLIC_GLSL=`
float integratedSquareCDF(float s,float a,float b){if(s<=0.)return 0.;if(s>=a+b)return s-(a+b)*.5;bool flip=s>(a+b)*.5;float r=flip?a+b-s:s;float j=r<=a?r*r*r/(6.*a*b):(3.*r*r-3.*r*a+a*a)/(6.*b);return flip?s-(a+b)*.5+j:j;}
float planeVolume(float t,vec3 m){vec3 a=vec3(min(m.x,min(m.y,m.z)),0.,max(m.x,max(m.y,m.z)));a.y=m.x+m.y+m.z-a.x-a.z;float total=a.x+a.y+a.z;if(t<=0.||total<=0.)return 0.;if(t>=total)return 1.;bool flip=t>total*.5;if(flip)t=total-t;float v;if(a.y<1e-9)v=t/a.z;else if(a.x<1e-9)v=t<=a.y?t*t/(2.*a.y*a.z):(t-a.y*.5)/a.z;else v=(integratedSquareCDF(t,a.x,a.y)-integratedSquareCDF(t-a.z,a.x,a.y))/a.z;return clamp(flip?1.-v:v,0.,1.);}
float planeOffset(float alpha,vec3 m){float lo=0.,hi=m.x+m.y+m.z;for(int k=0;k<14;k++){float mid=(lo+hi)*.5;if(planeVolume(mid,m)<alpha)lo=mid;else hi=mid;}return (lo+hi)*.5;}
float planeFlux(float alpha,vec4 plane,int axis,float courant){if(alpha<.00001||alpha>.99999)return alpha;float c=min(.999999,abs(courant));if(c<.0000001)return alpha;vec3 m=abs(plane.xyz);bool high=(courant>=0.)==(plane[axis]>=0.);float b=plane.w-(high?m[axis]*(1.-c):0.);m[axis]*=c;return planeVolume(b,m);}
`;
