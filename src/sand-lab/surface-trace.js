// Sand's spatial bins are a narrow-band query, not a globally conservative
// distance field. Never step across an unqueried bin or into the parcel bounds.
export const SAND_BOUNDS_GLSL=`
vec2 sandRayInterval(vec3 o,vec3 d){
 vec3 inv=vec3(abs(d.x)>1e-9?1./d.x:1e20,abs(d.y)>1e-9?1./d.y:1e20,abs(d.z)>1e-9?1./d.z:1e20);
 vec3 a=(uSandMin-o)*inv,b=(uSandMax-o)*inv,lo=min(a,b),hi=max(a,b);
 return vec2(max(0.,max(lo.x,max(lo.y,lo.z))),min(hi.x,min(hi.y,hi.z)));
}
float sandCellExit(vec3 p,vec3 d){
 vec2 size=vec2(11.,9.8)/32.,low=vec2(-5.5,-4.9),cell=clamp(floor((p.xz-low)/size),0.,31.);
 vec2 edge=low+(cell+vec2(greaterThanEqual(d.xz,vec2(0))))*size;
 vec2 t=vec2(abs(d.x)>1e-9?(edge.x-p.x)/d.x:1e20,abs(d.z)>1e-9?(edge.y-p.z)/d.z:1e20);
 if((d.x<0.&&cell.x==0.)||(d.x>0.&&cell.x==31.))t.x=1e20;
 if((d.z<0.&&cell.y==0.)||(d.z>0.&&cell.y==31.))t.y=1e20;
 return max(.00001,min(t.x,t.y)+.000001);
}
`;
export const SAND_TRACE_GLSL=`
uniform float uSandSkyCeiling;
float traceOpaque(vec3 o,vec3 d){
 float hit=1e4;
 for(int j=0;j<uBodyCount;j++)if(texelFetch(uBodies,ivec2((j*2+1)%256,(j*2+1)/256),0).w>.5)hit=min(hit,traceBody(o,d,j,hit));
 vec2 interval=uSandCount>0?sandRayInterval(o,d):vec2(1e4,-1.);
 float t=.00001,last=t;
 for(int i=0;i<256;i++){
  vec3 p=o+d*t;
  // Cubic terrain interpolation is a convex combination, and parcel bounds
  // include blending support. Above both, an upward ray cannot hit sand.
  // Bodies were traced separately, so tall / airborne objects still occlude.
  if(uStation==6&&d.y>=0.&&p.y>uSandSkyCeiling)break;
  float h=labOpaque(p);
  if(h<.00003){
   // A steep terrain edit or a finite-precision bin crossing may overshoot.
   // Locate the first boundary instead of shading an arbitrary interior point.
   if(h<0.){float lo=last,hi=t;for(int j=0;j<12;j++){float m=(lo+hi)*.5;if(labOpaque(o+d*m)>0.)lo=m;else hi=m;}t=(lo+hi)*.5;}
   return min(hit,t);
  }
  float advance=max(.00001,h*.7);
  if(interval.y>=interval.x&&t<interval.y){
   if(t<interval.x)advance=min(advance,max(.00001,interval.x-t+.000001));
   else advance=min(advance,sandCellExit(p,d));
  }
  last=t;t+=advance;if(t>min(hit,75.))break;
 }
 return hit;
}
`;

// Double-precision reference for the bounded GPU query (also usable without GL).
export function sandRayInterval(origin,direction,min,max){
 let enter=0,exit=Infinity;
 for(let k=0;k<3;k++){
  if(Math.abs(direction[k])<1e-9){if(origin[k]<min[k]||origin[k]>max[k])return [Infinity,-Infinity];continue;}
  const a=(min[k]-origin[k])/direction[k],b=(max[k]-origin[k])/direction[k];enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
 }
 return [enter,exit];
}
export function sandCellExit(point,direction){
 let distance=Infinity;
 for(const [k,low,span] of [[0,-5.5,11],[2,-4.9,9.8]]){
  const size=span/32,cell=Math.max(0,Math.min(31,Math.floor((point[k]-low)/size))),d=direction[k];
  if(Math.abs(d)<1e-9||d<0&&cell===0||d>0&&cell===31)continue;
  distance=Math.min(distance,(low+(cell+Number(d>=0))*size-point[k])/d);
 }
 return Math.max(.00001,distance+.000001);
}
export function traceSandSurface(origin,direction,{distance,min,max,limit=75}){
 const [enter,exit]=sandRayInterval(origin,direction,min,max),at=t=>origin.map((v,k)=>v+direction[k]*t);let t=.00001,last=t;
 for(let i=0;i<256;i++){
  const p=at(t),h=distance(p);
  if(h<.00003){if(h<0){let lo=last,hi=t;for(let j=0;j<12;j++){const m=(lo+hi)/2;if(distance(at(m))>0)lo=m;else hi=m;}t=(lo+hi)/2;}return t;}
  let advance=Math.max(.00001,h*.7);
  if(exit>=enter&&t<exit)advance=Math.min(advance,t<enter?Math.max(.00001,enter-t+.000001):sandCellExit(p,direction));
  last=t;t+=advance;if(t>limit)break;
 }
 return Infinity;
}
