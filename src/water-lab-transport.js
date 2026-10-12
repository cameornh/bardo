import {NEIGHBORS} from './water-lab-model.js';
import {WATER_MATERIAL} from './water-material.js';
export const WATER_DENSITY=WATER_MATERIAL.density,WATER_KINEMATIC_VISCOSITY=WATER_MATERIAL.kinematicViscosity,WATER_SURFACE_TENSION=WATER_MATERIAL.surfaceTension;
export function physicalCoefficients(spacing,scale,dt){const h=spacing*scale;return {viscosity:1-Math.exp(-6*WATER_KINEMATIC_VISCOSITY*dt/(h*h)),capillary:WATER_SURFACE_TENSION/(WATER_DENSITY*h*h*scale)};}
// One reciprocal neighbor traversal handles smoothing, conserved diffusion,
// surface normals and velocity variance. No temporary arrays per pair.
export function transportFluid(old,next,previousVelocity,chem,neighbors,s,scale,dt,wind=0){const n=next.length/4,vel=new Float32Array(next.length),out=chem.slice(),metrics=new Float32Array(next.length),counts=new Uint16Array(n),raw=new Float32Array(next.length),h=2*s,invH2=1/(h*h),w0=315/(512*Math.PI),diff=Math.min(.006,dt*.12),coeff=physicalCoefficients(s,scale,dt);
 for(let i=0;i<n;i++)for(let k=0;k<3;k++)raw[i*4+k]=old[i*4+3]?0:(next[i*4+k]-old[i*4+k])/dt;
 for(let i=0;i<n;i++){const o=i*4;let weight=0,ax=0,ay=0,az=0,nx=0,ny=0,nz=0,shear=0,count=0,c0=0,c1=0,c2=0;
  for(let a=0;a<NEIGHBORS;a++){const j=neighbors[i*NEIGHBORS+a];if(j<0)break;const q=j*4,x=next[o]-next[q],y=next[o+1]-next[q+1],z=next[o+2]-next[q+2],r2=x*x+y*y+z*z;if(r2>=h*h)continue;const v=1-r2*invH2,w=w0*v*v*v,r=Math.sqrt(r2),vx=raw[q]-raw[o],vy=raw[q+1]-raw[o+1],vz=raw[q+2]-raw[o+2];weight+=w;ax+=vx*w;ay+=vy*w;az+=vz*w;shear+=(vx*vx+vy*vy+vz*vz)*w;nx+=x*w;ny+=y*w;nz+=z*w;if(r<s*1.9)count++;const d=(1-r/h)*diff;c0+=(chem[q]-chem[o])*d;c1+=(chem[q+1]-chem[o+1])*d;c2+=(chem[q+2]-chem[o+2])*d;}
  counts[i]=count;const normalLength=Math.hypot(nx,ny,nz),inv=1/Math.max(normalLength,1e-8),surface=Math.min(1,normalLength/s*12),tke=Math.sqrt(shear/Math.max(.2,weight))*scale,impact=Math.max(0,Math.hypot(raw[o]-previousVelocity[o],raw[o+1]-previousVelocity[o+1]+9.81/scale*dt,raw[o+2]-previousVelocity[o+2])*scale-.35),airShear=Math.max(0,Math.hypot(raw[o]*scale,raw[o+1]*scale,raw[o+2]*scale-wind)-3)*.08,energy=surface*Math.min(5,Math.max(0,tke-.12)+impact*.55+airShear),smooth=.012+coeff.viscosity/Math.max(.1,weight),cap=coeff.capillary*dt*surface;
  if(!old[o+3]){vel[o]=raw[o]+ax*smooth-nx*inv*cap;vel[o+1]=raw[o+1]+ay*smooth-ny*inv*cap;vel[o+2]=raw[o+2]+az*smooth-nz*inv*cap;}
  out[o]+=c0;out[o+1]+=c1;out[o+2]+=c2;out[o+3]=Math.min(1,chem[o+3]*Math.exp(-dt*.65)+energy*dt*.3);metrics.set([nx*inv,ny*inv,nz*inv,old[o+3]?0:energy],o);
 }return {velocities:vel,chem:out,metrics,counts};}
