import {NEIGHBORS} from './water-lab-model.js';
import {WATER_MATERIAL} from '../water-material.js';
export const WATER_DENSITY=WATER_MATERIAL.density,WATER_KINEMATIC_VISCOSITY=WATER_MATERIAL.kinematicViscosity,WATER_SURFACE_TENSION=WATER_MATERIAL.surfaceTension;
export function physicalCoefficients(spacing,scale,dt){const h=spacing*scale;return {viscosity:1-Math.exp(-6*WATER_KINEMATIC_VISCOSITY*dt/(h*h)),capillary:WATER_SURFACE_TENSION/(WATER_DENSITY*h*h*scale)};}
// One reciprocal neighbor traversal handles smoothing, conserved diffusion,
// surface normals and velocity variance. No temporary arrays per pair.
export function transportFluid(old,next,previousVelocity,chem,neighbors,s,scale,dt,predicted=null){const n=next.length/4,vel=new Float32Array(next.length),out=chem.slice(),metrics=new Float32Array(next.length),counts=new Uint16Array(n),activity=new Float32Array(n*2),breakup=new Float32Array(n),raw=new Float32Array(next.length),h=2*s,invH2=1/(h*h),w0=315/(512*Math.PI),diff=Math.min(.006,dt*.12),coeff=physicalCoefficients(s,scale,dt),threshold=Math.max(.08,.3*Math.sqrt(9.81*s*scale));
 for(let i=0;i<n;i++)for(let k=0;k<3;k++)raw[i*4+k]=old[i*4+3]?0:(next[i*4+k]-old[i*4+k])/dt;
 for(let i=0;i<n;i++){const o=i*4;let weight=0,ax=0,ay=0,az=0,nx=0,ny=0,nz=0,strain=0,count=0,c0=0,c1=0,c2=0;
  for(let a=0;a<NEIGHBORS;a++){const j=neighbors[i*NEIGHBORS+a];if(j<0)break;const q=j*4,x=next[o]-next[q],y=next[o+1]-next[q+1],z=next[o+2]-next[q+2],r2=x*x+y*y+z*z;if(r2>=h*h)continue;const v=1-r2*invH2,w=w0*v*v*v,r=Math.sqrt(r2),vx=raw[q]-raw[o],vy=raw[q+1]-raw[o+1],vz=raw[q+2]-raw[o+2];weight+=w;ax+=vx*w;ay+=vy*w;az+=vz*w;const radial=(vx*x+vy*y+vz*z)/Math.max(r,1e-8);strain+=radial*radial*w;nx+=x*w;ny+=y*w;nz+=z*w;if(r<s*1.9)count++;const d=(1-r/h)*diff;c0+=(chem[q]-chem[o])*d;c1+=(chem[q+1]-chem[o+1])*d;c2+=(chem[q+2]-chem[o+2])*d;}
  // Deforming flow and kinetic energy lost in the constraint/contact solve
  // identify aeration sites. Fast translation, gravity-driven free fall and
  // rigid rotation alone must not keep spraying an otherwise coherent sheet.
  const ix=predicted?(predicted[o]-old[o])/dt:previousVelocity[o],iy=predicted?(predicted[o+1]-old[o+1])/dt:previousVelocity[o+1]-9.81/scale*dt,iz=predicted?(predicted[o+2]-old[o+2])/dt:previousVelocity[o+2];
  const lostSpeed=Math.sqrt(Math.max(0,ix*ix+iy*iy+iz*iz-raw[o]**2-raw[o+1]**2-raw[o+2]**2))*scale;
  // A changing momentum direction can be an impact even with no speed loss.
  const turn=Math.hypot(ix-raw[o],iy-raw[o+1],iz-raw[o+2])*scale,impactSpeed=Math.max(lostSpeed,turn);
  counts[i]=count;const normalLength=Math.hypot(nx,ny,nz),inv=1/Math.max(normalLength,1e-8),surface=Math.min(1,normalLength/s*12),deformation=Math.sqrt(strain/Math.max(.2,weight))*scale,breaking=Math.max(0,deformation-threshold*.9)/(threshold+.35),impact=Math.max(0,impactSpeed-threshold*1.2)/(threshold+.35),energy=surface*Math.min(1,weight/.18)*Math.min(5,breaking*.8+impact*.7),smooth=.012+coeff.viscosity/Math.max(.1,weight),cap=coeff.capillary*dt*surface;
  if(!old[o+3]){vel[o]=raw[o]+ax*smooth-nx*inv*cap;vel[o+1]=raw[o+1]+ay*smooth-ny*inv*cap;vel[o+2]=raw[o+2]+az*smooth-nz*inv*cap;}
  // Outward velocity relative to connected liquid detects a stretching lip
  // before it becomes a separate blob. Translation and rigid rotation cancel
  // in this normal projection. Surface tension supplies a physical speed floor.
  const outward=-(ax*nx+ay*ny+az*nz)*inv/Math.max(.02,weight)*scale,capillarySpeed=Math.sqrt(WATER_SURFACE_TENSION/(WATER_DENSITY*s*scale));
  breakup[i]=old[o+3]?0:surface*Math.min(1,weight/.12)*Math.min(3,Math.max(0,outward-Math.max(4*capillarySpeed,threshold*.5))/Math.max(.15,threshold));
  activity[i*2]=Math.max(deformation,Math.max(0,outward));activity[i*2+1]=impactSpeed;out[o]+=c0;out[o+1]+=c1;out[o+2]+=c2;out[o+3]=Math.min(1,chem[o+3]*Math.exp(-dt*.65)+energy*dt*.3);metrics.set([nx*inv,ny*inv,nz*inv,old[o+3]?0:energy],o);
 }return {velocities:vel,chem:out,metrics,counts,activity,breakup};}
