// Exact compact-cell sampling of the existing poly6 water kernel. This is a
// CPU query index, not a coarser simulation or a camera-dependent fluid field.
export class FluidSampler {
 build(positions,velocities,reach){
  this.positions=positions;this.velocities=velocities;this.reach=reach;
  const n=positions.length/4,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let o=0;o<positions.length;o+=4)for(let k=0;k<3;k++){const q=Math.floor(positions[o+k]/reach);lo[k]=Math.min(lo[k],q);hi[k]=Math.max(hi[k],q);}
  if(!n){lo.fill(0);hi.fill(0);}this.min=lo;this.size=hi.map((v,k)=>v-lo[k]+1);const [nx,ny,nz]=this.size,cells=nx*ny*nz;
  if(cells>4e6){this.fallback=new Map();for(let i=0;i<n;i++){const o=i*4,key=[0,1,2].map(k=>Math.floor(positions[o+k]/reach)).join(',');if(!this.fallback.has(key))this.fallback.set(key,[]);this.fallback.get(key).push(i);}return this;}
  this.fallback=null;if(!this.counts||this.counts.length<cells){this.counts=new Uint32Array(cells);this.starts=new Uint32Array(cells+1);this.cursors=new Uint32Array(cells);}
  if(!this.indices||this.indices.length<n){this.indices=new Uint32Array(n);this.particleCells=new Uint32Array(n);}
  this.counts.fill(0,0,cells);
  for(let i=0;i<n;i++){const o=i*4,c=Math.floor(positions[o]/reach)-lo[0]+nx*(Math.floor(positions[o+1]/reach)-lo[1]+ny*(Math.floor(positions[o+2]/reach)-lo[2]));this.particleCells[i]=c;this.counts[c]++;}
  let offset=0;for(let c=0;c<cells;c++){this.starts[c]=this.cursors[c]=offset;offset+=this.counts[c];}this.starts[cells]=offset;
  for(let i=0;i<n;i++)this.indices[this.cursors[this.particleCells[i]]++]=i;
  return this;
 }
 sample(p){
  const h=this.reach,h2=h*h,a=this.positions,v=this.velocities,[nx,ny,nz]=this.size,lo=this.min;
  const cx=Math.floor(p[0]/h),cy=Math.floor(p[1]/h),cz=Math.floor(p[2]/h);let density=0,vx=0,vy=0,vz=0;
  for(let z=cz-1;z<=cz+1;z++)for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++){
   let list,begin,end;
   if(this.fallback){list=this.fallback.get(`${x},${y},${z}`);if(!list)continue;begin=0;end=list.length;}
   else{const ix=x-lo[0],iy=y-lo[1],iz=z-lo[2];if(ix<0||ix>=nx||iy<0||iy>=ny||iz<0||iz>=nz)continue;const c=ix+nx*(iy+ny*iz);list=this.indices;begin=this.starts[c];end=this.starts[c+1];}
   for(let j=begin;j<end;j++){const o=list[j]*4,dx=p[0]-a[o],dy=p[1]-a[o+1],dz=p[2]-a[o+2],q=1-(dx*dx+dy*dy+dz*dz)/h2;if(q<=0)continue;const w=315/(512*Math.PI)*q*q*q;density+=w;vx+=v[o]*w;vy+=v[o+1]*w;vz+=v[o+2]*w;}
  }
  const d=Math.max(.00001,density);return {density,velocity:[vx/d,vy/d,vz/d]};
 }
}
