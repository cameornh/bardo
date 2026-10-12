import { surfaceCovariance,tangentArea } from './gaussians.js';
import { fiberHash } from './fibers.js';

const add=(a,b)=>a.map((v,k)=>v+b[k]);
const scale=(a,s)=>a.map(v=>v*s);
const unit=a=>scale(a,1/(Math.hypot(...a)||1));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// Topology-based groups stay attached to the material as it moves. No moving
// world-space voxel membership, random thinning, or camera-dependent physics.
export function fabricSplats(patch,level=0){
 const p=patch.positions,stride=2**level,m=patch.parameters,cols=Math.ceil(patch.cols/stride),rows=Math.ceil(patch.rows/stride),sums=new Float64Array(cols*rows*18),nodes=[];
 for(const cell of patch.cells){
  if(!patch.cellVisible(cell))continue;
  const a=cell.nodes[0]*3,b=cell.nodes[1]*3,c=cell.nodes[2]*3,d=cell.nodes[3]*3;
  const ux=(p[b]-p[a]+p[d]-p[c])*.5,uy=(p[b+1]-p[a+1]+p[d+1]-p[c+1])*.5,uz=(p[b+2]-p[a+2]+p[d+2]-p[c+2])*.5;
  const vx=(p[c]-p[a]+p[d]-p[b])*.5,vy=(p[c+1]-p[a+1]+p[d+1]-p[b+1])*.5,vz=(p[c+2]-p[a+2]+p[d+2]-p[b+2])*.5;
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const area=Math.hypot(nx,ny,nz);if(area<1e-10)continue;nx/=area;ny/=area;nz/=area;
  const x=(p[a]+p[b]+p[c]+p[d])*.25,y=(p[a+1]+p[b+1]+p[c+1]+p[d+1])*.25,z=(p[a+2]+p[b+2]+p[c+2]+p[d+2])*.25;
  const w=3.2*.58**2*area,q=.58**2,h=.007**2,o=(Math.floor(cell.y/stride)*cols+Math.floor(cell.x/stride))*18,ul=Math.hypot(ux,uy,uz)||1;
  sums[o]+=w;sums[o+1]+=x*w;sums[o+2]+=y*w;sums[o+3]+=z*w;
  sums[o+4]+=(x*x+q*(ux*ux+vx*vx)+h*nx*nx)*w;sums[o+5]+=(x*y+q*(ux*uy+vx*vy)+h*nx*ny)*w;sums[o+6]+=(x*z+q*(ux*uz+vx*vz)+h*nx*nz)*w;
  sums[o+7]+=(y*y+q*(uy*uy+vy*vy)+h*ny*ny)*w;sums[o+8]+=(y*z+q*(uy*uz+vy*vz)+h*ny*nz)*w;sums[o+9]+=(z*z+q*(uz*uz+vz*vz)+h*nz*nz)*w;
  sums[o+10]+=nx*w;sums[o+11]+=ny*w;sums[o+12]+=nz*w;sums[o+13]+=ux/ul*w;sums[o+14]+=uy/ul*w;sums[o+15]+=uz/ul*w;
  let strain=0;for(const i of cell.edges)strain=Math.max(strain,patch.strain(patch.links[i]));sums[o+16]+=strain*w;
 }
 for(let o=0;o<sums.length;o+=18){
  const mass=sums[o];if(!mass)continue;const x=sums[o+1]/mass,y=sums[o+2]/mass,z=sums[o+3]/mass;
  const cov=[sums[o+4]/mass-x*x,sums[o+5]/mass-x*y,sums[o+6]/mass-x*z,sums[o+7]/mass-y*y,sums[o+8]/mass-y*z,sums[o+9]/mass-z*z];
  const normal=unit([sums[o+10],sums[o+11],sums[o+12]]),tangent=unit([sums[o+13],sums[o+14],sums[o+15]]);
  nodes.push({center:[x,y,z],cov,normal,tangent,mass,tau:mass/tangentArea(cov,normal),color:m.color,roughness:m.roughness,strain:sums[o+16]/mass,kind:0});
 }
 return nodes;
}

export function fiberSplats(groom,followers=6,level=0){
 const p=groom.positions,m=groom.parameters,nodes=[],stride=2**level,segments=groom.segments;
 for(let guide=0;guide<groom.guides;guide++){
  const root=groom.roots[guide],offsets=[];
  for(let f=0;f<followers;f++){
   const phase=f*2.39996323+root.phase,r=.13*Math.sqrt((f+.5)/followers),c=Math.cos(phase)*r,s=Math.sin(phase)*r;
   offsets.push([root.t[0]*c+root.b[0]*s,root.t[1]*c+root.b[1]*s,root.t[2]*c+root.b[2]*s,.8+.4*fiberHash(guide*37+f+groom.index*109)]);
  }
  for(let f0=0;f0<followers;f0+=stride)for(let s0=0;s0<segments;s0+=stride){
   let mass=0,mx=0,my=0,mz=0,xx=0,xy=0,xz=0,yy=0,yz=0,zz=0,tx=0,ty=0,tz=0,color=0;
   // Accumulate raw moments directly; avoid allocating thousands of temporary
   // leaf objects when a coarse bundle is all the camera can resolve.
   for(let f=f0;f<Math.min(f0+stride,followers);f++)for(let s=s0;s<Math.min(s0+stride,segments);s++){
    const o=(guide*(segments+1)+s)*3,offset=offsets[f],fa=1+.45*s/segments,fb=1+.45*(s+1)/segments;
    const ax=p[o]+offset[0]*fa,ay=p[o+1]+offset[1]*fa,az=p[o+2]+offset[2]*fa;
    const bx=p[o+3]+offset[0]*fb,by=p[o+4]+offset[1]*fb,bz=p[o+5]+offset[2]*fb;
    const dx=bx-ax,dy=by-ay,dz=bz-az,len=Math.max(1e-8,Math.hypot(dx,dy,dz)),nx=dx/len,ny=dy/len,nz=dz/len;
    const x=(ax+bx)*.5,y=(ay+by)*.5,z=(az+bz)*.5,width=m.width*(.95-.6*(s+.5)/segments),v=width*width,l=len*.34,k=l*l-v,w=2.2*l*width;
    mass+=w;mx+=x*w;my+=y*w;mz+=z*w;tx+=nx*w;ty+=ny*w;tz+=nz*w;color+=offset[3]*w;
    xx+=(x*x+v+k*nx*nx)*w;xy+=(x*y+k*nx*ny)*w;xz+=(x*z+k*nx*nz)*w;
    yy+=(y*y+v+k*ny*ny)*w;yz+=(y*z+k*ny*nz)*w;zz+=(z*z+v+k*nz*nz)*w;
   }
   const x=mx/mass,y=my/mass,z=mz/mass,cov=[xx/mass-x*x,xy/mass-x*y,xz/mass-x*z,yy/mass-y*y,yz/mass-y*z,zz/mass-z*z];
   const tangent=unit([tx,ty,tz]),normal=unit(cross(tangent,Math.abs(tangent[1])<.95?[0,1,0]:[1,0,0]));
   nodes.push({center:[x,y,z],cov,tangent,normal,mass,tau:mass/tangentArea(cov,normal),color:m.color.map(v=>v*color/mass),roughness:m.roughness,strain:0,kind:1});
  }
 }
 return nodes;
}
const scalpCache=new WeakMap();

export function scalpSplats(groom){
 if(scalpCache.has(groom))return scalpCache.get(groom);
 const nodes=[],count=160,r=groom.supportRadius;
 for(let i=0;i<count;i++){
  const y=1-2*(i+.5)/count,angle=i*2.39996323,radius=Math.sqrt(1-y*y),normal=[Math.cos(angle)*radius,y,Math.sin(angle)*radius],sigma=r*.17,tau=3;
  nodes.push({center:add(groom.center,scale(normal,r)),normal,tangent:unit(cross(normal,[0,1,0])),cov:surfaceCovariance(normal,sigma),tau,mass:tau*sigma*sigma,color:groom.parameters.color.map(v=>v*.6),roughness:.8,strain:0,kind:2});
 }
 scalpCache.set(groom,nodes);return nodes;
}

export function softLevels(subject,followers=0){
 const levels=[];
 // A tear must not be filled by a parent Gaussian spanning the missing cell.
 const maxLevel=followers?4:subject.broken?0:3;
 for(let level=0;level<=maxLevel;level++){
  const stride=2**level,count=followers?subject.guides*Math.ceil(followers/stride)*Math.ceil(subject.segments/stride):Math.ceil(subject.cols/stride)*Math.ceil(subject.rows/stride);
  const sigma=(followers?subject.parameters.length/subject.segments*.34:subject.width/subject.cols*.58)*stride;
  levels.push({count,sigma});
 }
 return levels;
}
