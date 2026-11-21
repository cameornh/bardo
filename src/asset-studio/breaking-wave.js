// Horizontal compression folds the forward face of the same sheet of water.
// Shared profile samples carry forward displacement, height and their derivatives.
export const PROFILE_SIZE=257;
export const breakerProfile=new Float32Array(PROFILE_SIZE*4);
for(let i=0;i<PROFILE_SIZE;i++){
 const q=2*i/(PROFILE_SIZE-1)-1,w=1-q*q,g=1+.8*q,h=1-5.3*q*q-1.1*q;
 breakerProfile.set([1.06*w**4*g,.72*w**3*h,
  1.06*w**3*(.8*w-8*q*g),.72*w*w*(w*(-10.6*q-1.1)-6*q*h)],i*4);
}
function profile(q,k){
 const u=Math.min(PROFILE_SIZE-1,Math.max(0,(q+1)*.5*(PROFILE_SIZE-1))),a=Math.floor(u);
 const v=breakerProfile[4*a+k];
 return v+(breakerProfile[4*Math.min(a+1,PROFILE_SIZE-1)+k]-v)*(u-a);
}
export function crestFrame(c,age){
 const t=Math.min(1,Math.max(0,age/c.duration));
 const travel=c.travelSpeed*age;
 return {x:c.x+c.dx*travel,z:c.z+c.dz*travel,gain:t===1?0:Math.sin(Math.PI*t)**2,peel:.85*Math.cos(c.phase)*Math.sin(2*Math.PI*t)};
}
const bend=(s,c)=>c.curvature*s*s+c.skew*s;
export function lipPoint(c,s,u,age){
 const f=crestFrame(c,age),q=2*u-1.16,amp=f.gain*Math.max(0,1-s*s)**2*(1+f.peel*s);
 const along=c.width*(q+bend(s,c)),across=s*c.span;
 const baseX=f.x+c.dx*along-c.dz*across,baseZ=f.z+c.dz*along+c.dx*across;
 const push=c.width*amp*profile(q,0);
 return {baseX,baseZ,compression:-amp*profile(q,2),x:baseX+c.dx*push,y:c.width*amp*profile(q,1),z:baseZ+c.dz*push};
}
// The horizontal profile has a single negative-slope lobe. Locate both folds
// on the sampled curve so even a nearly vertical ray at a turning point sees
// every branch. Linear interpolation matches the vertex texture exactly.
const end=PROFILE_SIZE-1,step=2/end;
const segment=i=>(breakerProfile[4*i+4]-breakerProfile[4*i])/step;
let steepest=0;
for(let i=1;i<end;i++)if(segment(i)<segment(steepest))steepest=i;
function surfaceBranch(lo,hi,amp,target){
 const x=i=>i*step-1+amp*breakerProfile[4*i];
 const left=x(lo),right=x(hi),ascending=right>=left,eps=1e-10;
 if(target<Math.min(left,right)-eps||target>Math.max(left,right)+eps)return -Infinity;
 while(hi-lo>1){const m=(lo+hi)>>1;if((x(m)<target)===ascending)lo=m;else hi=m;}
 const a=x(lo),b=x(hi),f=b===a?0:Math.max(0,Math.min(1,(target-a)/(b-a)));
 return breakerProfile[4*lo+1]*(1-f)+breakerProfile[4*hi+1]*f;
}
export function crestLevel(c,x,z){
 const f=c.frame,xr=x-f.x,zr=z-f.z,s=(-c.dz*xr+c.dx*zr)/c.span;
 if(Math.abs(s)>=1||!f.gain)return 0;
 const target=(c.dx*xr+c.dz*zr)/c.width-bend(s,c);
 if(Math.abs(target)>1.65)return 0;
 const amp=f.gain*(1-s*s)**2*(1+f.peel*s);
 let height;
 if(1+amp*segment(steepest)>=0)height=surfaceBranch(0,end,amp,target);
 else{
  let lo=0,hi=steepest;
  while(hi-lo>1){const m=(lo+hi)>>1;if(1+amp*segment(m)>=0)lo=m;else hi=m;}
  const peak=hi;lo=steepest;hi=end-1;
  while(hi-lo>1){const m=(lo+hi)>>1;if(1+amp*segment(m)<0)lo=m;else hi=m;}
  height=Math.max(surfaceBranch(0,peak,amp,target),surfaceBranch(peak,hi,amp,target),surfaceBranch(hi,end,amp,target));
 }
 return Number.isFinite(height)?height*c.width*amp:0;
}
