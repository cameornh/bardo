import {NEIGHBORS,boundaryMetric,boundaryKernel,WATER_CONTACT_SKIN} from '../../sand-lab/water-lab-model.js';
import {WATER} from './grid.js';
import {NativeDensity,nativeDensityAvailable} from '../../sand-lab/native-density.js';
// Only the narrow surface/contact band needs local density work after the
// bulk projection. No artificial attraction and no change to parcel volumes.
export function surfaceConstraints(lab,positions,neighbors,grid,{native=true}={}){
 const n=positions.length/4,s=lab.spacing,h=2*s,volume=s**3,W=315/(64*Math.PI*h**3),G=-45/(Math.PI*h**6),lambda=new Float32Array(n),wall=new Float32Array(n*4),active=[];
 const kernel=native&&nativeDensityAvailable()?(lab.fieldSurfaceKernel??=new NativeDensity()):null;
 const next=positions.slice(),point=[0,0,0];
 const band=new Uint8Array(grid.count);for(let i=0;i<grid.count;i++)if(grid.phase[i]!==WATER)band[i]=1;
 for(const face of grid.faces)for(let k=0;k<face.a.length;k++){const a=face.a[k],b=face.b[k];if(grid.phase[a]!==WATER&&b>=0)band[b]=1;if(grid.phase[b]!==WATER&&a>=0)band[a]=1;}
 const geometry=kernel&&lab.sand&&lab.optimizations?.terrainCache!==false&&lab.optimizations?.batchedContacts===true;
 if(kernel){
  if(geometry)lab.syncSandUniforms();
  const parcels=geometry?lab.sandRenderParcels||[]:[],nativeSand=geometry&&parcels.length>0&&lab.optimizations.nativeSandContacts===true;
  const extra=nativeSand?lab.u.uSandBins.value.image.data.length+parcels.reduce((v,p)=>v+8+(p.cuts?.length||0)*5,0):0;
  kernel.allocate(n,geometry?32+lab.sand.n**2+lab.balls.length*16+1024+extra:0);kernel.positions.set(positions);kernel.neighbors.set(neighbors);
  if(geometry){
   kernel.prepareGeometry(lab,nativeSand);const o=kernel.offsets,count=kernel.instance.exports.boundaryBatch(n,o.positions,o.wall,o.geometry,o.metric,o.missing,h,o.boundaryPositions,false);
   for(let at=0;at<count;at++){const i=kernel.missing[at],p=Array.from(positions.subarray(i*4,i*4+3)),metric=boundaryMetric(p,q=>lab.solid(q),h),b=boundaryKernel(metric.distance,h),f=b.density>1e-6?b.gradient:0;kernel.wall.set([metric.normal[0]*f,metric.normal[1]*f,metric.normal[2]*f,b.density],i*4);}
   wall.set(kernel.wall.subarray(0,n*4));
  }
 }
 for(let i=0;i<n;i++){
  const o=4*i;if(positions[o+3])continue;point[0]=positions[o];point[1]=positions[o+1];point[2]=positions[o+2];
  const cell=grid.cellAt(point.map(v=>v*lab.spec.scale)),surface=cell<0||band[cell];
  const distance=geometry?(wall[o+3]>1e-6?0:h):lab.solid(point);if(!surface&&distance>=h)continue;active.push(i);
  if(!geometry&&distance<h){const metric=boundaryMetric(point,p=>lab.solid(p),h),b=boundaryKernel(metric.distance,h),f=b.density>1e-6?b.gradient:0;wall.set([metric.normal[0]*f,metric.normal[1]*f,metric.normal[2]*f,b.density],i*4);}
  if(kernel)continue;
  let rho=volume*W+wall[i*4+3],sum=0,gx=wall[i*4],gy=wall[i*4+1],gz=wall[i*4+2];
  for(let k=0;k<NEIGHBORS;k++){const j=neighbors[i*NEIGHBORS+k];if(j<0)break;const p=4*j,x=positions[o]-positions[p],y=positions[o+1]-positions[p+1],z=positions[o+2]-positions[p+2],r2=x*x+y*y+z*z;if(r2>=h*h)continue;
   const q=1-r2/(h*h);rho+=volume*W*q*q*q;const r=Math.sqrt(r2);if(r<1e-6)continue;const f=volume*G*(h-r)**2/r,a=x*f,b=y*f,c=z*f;sum+=a*a+b*b+c*c;gx+=a;gy+=b;gz+=c;
  }
  lambda[i]=-Math.max(0,rho-1)/(sum+gx*gx+gy*gy+gz*gz+.04/(h*h));
 }
 if(kernel){
  kernel.wall.set(wall);kernel.active.fill(0,0,n);for(const i of active)kernel.active[i]=1;
  const o=kernel.offsets,e=kernel.instance.exports,pairs=e.activePairs(n,o.positions,o.neighbors,o.pairs,o.accum,s,o.active);
  e.activeDensity(n,o.accum,o.wall,o.lambda,s,o.active);
  // No PBF artificial attraction in the hybrid layer. Keep reciprocal forces
  // on neighbours just inside the band, rather than deleting their reaction.
  for(let k=0;k<pairs;k++)kernel.pairs[k*5+4]=0;
  e.correction(n,pairs,o.positions,o.pairs,o.wall,o.lambda,o.delta,s);
 }
 for(let i=0;i<n;i++){const o=4*i;if(positions[o+3])continue;let dx=lambda[i]*wall[o],dy=lambda[i]*wall[o+1],dz=lambda[i]*wall[o+2];
  if(kernel){dx=kernel.delta[i*3]-positions[o];dy=kernel.delta[i*3+1]-positions[o+1];dz=kernel.delta[i*3+2]-positions[o+2];}else{
  for(let k=0;k<NEIGHBORS;k++){const j=neighbors[i*NEIGHBORS+k];if(j<0)break;const p=j*4,x=positions[o]-positions[p],y=positions[o+1]-positions[p+1],z=positions[o+2]-positions[p+2],r2=x*x+y*y+z*z;if(r2<1e-12||r2>=h*h)continue;const r=Math.sqrt(r2),f=(lambda[i]+lambda[j])*volume*G*(h-r)**2/r;dx+=x*f;dy+=y*f;dz+=z*f;}
  }
  const cap=Math.min(1,s*.12/Math.max(1e-12,Math.hypot(dx,dy,dz)));point[0]=positions[o]+dx*cap;point[1]=positions[o+1]+dy*cap;point[2]=positions[o+2]+dz*cap;
  if(geometry){kernel.delta.set(point,i*3);continue;}
  const p=lab.solid(point)<s*WATER_CONTACT_SKIN?lab.collide(point):point;next[o]=p[0];next[o+1]=p[1];next[o+2]=p[2];
 }
 if(geometry){const o=kernel.offsets,count=kernel.instance.exports.contactBatch(n,o.positions,o.delta,o.geometry,o.metric,o.missing,s*WATER_CONTACT_SKIN);
  for(let at=0;at<count;at++){const i=kernel.missing[at];if(positions[i*4+3])continue;kernel.positions.set(lab.collide(Array.from(kernel.delta.subarray(i*3,i*3+3))),i*4);}next.set(kernel.positions.subarray(0,n*4));
 }
 return {positions:next,active:active.length,backend:kernel?'WebAssembly CPU':'JavaScript CPU reference'};
}
