import { rayEllipsoid, opticalCoefficients, sampleRadii, fresnelDielectric, illuminationMask } from './optics.js';

// Finite-volume reduced-transport diffusion in the actual bounded ellipsoid:
// -div(D grad(phi)) + sigma_a phi = sigma_s' L_direct, D=1/(3 sigma_t').
// A Robin escape boundary is imposed on each exposed voxel face. PCG handles
// thin samples without the severe timestep/iteration restriction of Jacobi.
// This is a low-resolution diffusion approximation, not spectral path tracing.
export function solveDiffusion(sample,light,{split=false,size=[24,28,16],tolerance=1e-5,maxIterations=280}={}){
 const radii=sampleRadii(sample),{absorption,scattering}=opticalCoefficients(sample),sigmaS=scattering.map(v=>v*(1-sample.g));
 const [nx,ny,nz]=size,volume=nx*ny*nz,step=radii.map((r,i)=>2*r/size[i]),cellVolume=step.reduce((a,b)=>a*b,1);
 const map=new Int32Array(volume).fill(-1),points=[],voxels=[],offsets=[1,nx,nx*ny];
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const p=[(x+.5)*step[0]-radii[0],(y+.5)*step[1]-radii[1],(z+.5)*step[2]-radii[2]];
  if(p.reduce((s,v,i)=>s+(v/radii[i])**2,0)>=1)continue;
  const index=x+nx*(y+ny*z);map[index]=points.length;points.push(p);voxels.push(index);
 }
 const n=points.length,neighbors=new Int32Array(n*6).fill(-1),beamDepth=new Float64Array(n),mask=new Float64Array(n),entryF=new Float64Array(n);
 for(let i=0;i<n;i++){
  const p=points[i],v=voxels[i],coords=[v%nx,Math.floor(v/nx)%ny,Math.floor(v/(nx*ny))];
  for(let axis=0;axis<3;axis++)for(let side=0;side<2;side++){
   const sign=side?1:-1,c=coords[axis]+sign;
   if(c>=0&&c<size[axis])neighbors[i*6+axis*2+side]=map[v+sign*offsets[axis]];
  }
  const distance=rayEllipsoid(p,light,radii)[1],entry=p.map((v,k)=>v+light[k]*distance),normal=entry.map((v,k)=>v/radii[k]**2),length=Math.hypot(...normal);
  beamDepth[i]=distance;mask[i]=illuminationMask(entry,radii,split);
  entryF[i]=1-fresnelDielectric(normal.reduce((s,v,k)=>s+v/length*light[k],0),1,sample.ior);
 }
 const data=new Float32Array(volume*4),diffusion=[],boundary=[],energy=[],iterations=[];
 // Approximate diffuse Fresnel reflectance at an internal dielectric boundary.
 const eta=sample.ior,rd=Math.min(.95,Math.max(0,-1.440/eta**2+.710/eta+.668+.0636*eta)),A=(1+rd)/(1-rd);
 for(let channel=0;channel<3;channel++){
  const sa=absorption[channel],ss=sigmaS[channel],st=Math.max(sa+ss,1e-6),D=1/(3*st),escape=2*A*D;
  diffusion.push(D);boundary.push(escape);
  const conductance=step.map(h=>D/(h*h)),leak=step.map(h=>D/(h*(h*.5+escape)));
  const diagonal=new Float64Array(n),rhs=new Float64Array(n),x=new Float64Array(n),r=new Float64Array(n),z=new Float64Array(n),p=new Float64Array(n),ap=new Float64Array(n);
  let rz=0,normB=0;
  for(let i=0;i<n;i++){
   let diag=sa;for(let k=0;k<6;k++)diag+=neighbors[i*6+k]<0?leak[k>>1]:conductance[k>>1];diagonal[i]=diag;
   rhs[i]=ss*Math.exp(-st*beamDepth[i])*mask[i]*entryF[i];r[i]=rhs[i];z[i]=r[i]/diag;p[i]=z[i];rz+=r[i]*z[i];normB+=rhs[i]**2;
  }
  let iteration=0;
  if(normB>1e-25)for(;iteration<maxIterations;iteration++){
   let pap=0;for(let i=0;i<n;i++){let v=diagonal[i]*p[i];for(let k=0;k<6;k++){const j=neighbors[i*6+k];if(j>=0)v-=conductance[k>>1]*p[j];}ap[i]=v;pap+=p[i]*v;}
   if(pap<=1e-30)break;const alpha=rz/pap;let normR=0,nextRz=0;
   for(let i=0;i<n;i++){x[i]+=alpha*p[i];r[i]-=alpha*ap[i];normR+=r[i]*r[i];z[i]=r[i]/diagonal[i];nextRz+=r[i]*z[i];}
   if(normR<tolerance*tolerance*normB){iteration++;break;}
   const beta=nextRz/rz;for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];rz=nextRz;
  }
  let source=0,absorbed=0,escaped=0;
  for(let i=0;i<n;i++){
   data[voxels[i]*4+channel]=Math.max(0,x[i]);source+=rhs[i]*cellVolume;absorbed+=sa*x[i]*cellVolume;
   for(let k=0;k<6;k++)if(neighbors[i*6+k]<0)escaped+=leak[k>>1]*x[i]*cellVolume;
  }
  energy.push({source,absorbed,escaped});iterations.push(iteration);
 }
 for(const v of voxels)data[v*4+3]=1;
 // Sampling near the curved boundary must not mix with zero-valued empty voxels.
 // RGB/occupancy interpolation in the shader renormalizes this sparse field.
 return {data,size,radii,step,diffusion,boundary,energy,iterations,activeCells:n};
}
