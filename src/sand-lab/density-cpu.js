import {NEIGHBORS,boundaryMetric,boundaryKernel} from './water-lab-model.js';

// The same PBF equations and Float32 iteration boundaries as solveDensity.
// Integer powers stay as products: generic powers dominate this CPU loop.
// Scalar neighbor loops avoid millions of short-lived vectors in the safe
// sand/object path. Geometry callbacks remain the authoritative CPU SDF.
export function solveDensityCPU(positions,neighbors,spacing,iterations=3,collide=p=>p,boundary=null){
 const n=positions.length/4,h=spacing*2,h2=h*h,volume=spacing**3;
 const w=315/(64*Math.PI*h**3),g=-45/(Math.PI*h**6),reference=w*(1-.3*.3)**3;
 const lambda=new Float32Array(n),wall=new Float32Array(n*3);
 let pos=positions.slice(),next=positions.slice();
 for(let iteration=0;iteration<iterations;iteration++){
  for(let i=0;i<n;i++){
   const o=i*4;let rho=volume*w,sum=0,gx=0,gy=0,gz=0;
   for(let a=0;a<NEIGHBORS;a++){
    const j=neighbors[i*NEIGHBORS+a];if(j<0)break;const k=j*4;
    const x=pos[o]-pos[k],y=pos[o+1]-pos[k+1],z=pos[o+2]-pos[k+2],r2=x*x+y*y+z*z;
    if(r2>=h2)continue;const r=Math.sqrt(r2);const q=Math.max(0,1-r*r/h2);rho+=volume*w*q*q*q;
    if(r<1e-6)continue;const c=g*(h-r)**2/r;
    const xg=x*c*volume,yg=y*c*volume,zg=z*c*volume;
    sum+=xg*xg+yg*yg+zg*zg;gx+=xg;gy+=yg;gz+=zg;
   }
   if(boundary){
    const metric=boundaryMetric([pos[o],pos[o+1],pos[o+2]],boundary,h),b=boundaryKernel(metric.distance,h);
    const factor=b.density>1e-6?b.gradient:0;
    const x=metric.normal[0]*factor,y=metric.normal[1]*factor,z=metric.normal[2]*factor;
    wall[i*3]=x;wall[i*3+1]=y;wall[i*3+2]=z;rho+=b.density;gx+=x;gy+=y;gz+=z;
   }
   lambda[i]=-Math.max(0,rho-1)/(sum+gx*gx+gy*gy+gz*gz+.04/h2);
  }
  for(let i=0;i<n;i++){
   const o=i*4;if(pos[o+3]>.5)continue;
   let dx=lambda[i]*wall[i*3],dy=lambda[i]*wall[i*3+1],dz=lambda[i]*wall[i*3+2];
   for(let a=0;a<NEIGHBORS;a++){
    const j=neighbors[i*NEIGHBORS+a];if(j<0)break;const k=j*4;
    const x=pos[o]-pos[k],y=pos[o+1]-pos[k+1],z=pos[o+2]-pos[k+2],r2=x*x+y*y+z*z;
    if(r2<1e-12||r2>=h2)continue;const r=Math.sqrt(r2);
    const q=Math.max(0,1-r*r/h2),ratio=w*q*q*q/reference,ratio2=ratio*ratio,scorr=-.00015*ratio2*ratio2,c=g*(h-r)**2/r;
    const force=(lambda[i]+lambda[j]+scorr)*volume;
    dx+=force*(x*c);dy+=force*(y*c);dz+=force*(z*c);
   }
   const limit=Math.min(1,spacing*.2/(Math.hypot(dx,dy,dz)||1));
   const p=collide([pos[o]+dx*limit,pos[o+1]+dy*limit,pos[o+2]+dz*limit]);
   next[o]=p[0];next[o+1]=p[1];next[o+2]=p[2];
  }
  [pos,next]=[next,pos];
 }
 return pos;
}
