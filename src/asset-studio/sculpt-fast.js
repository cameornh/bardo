// Exact allocation-light CPU alternative. The original sculpt.js remains the
// independent reference; grid, CSG order, surface coverage and material ties are unchanged.
import {gridSpec,smoothMin} from './sculpt.js';
import {LIMITS} from './model.js';
export function sampleGridFast(stamps,g){
 const data=new Float32Array(g.count*2),[nx,ny]=g.dims;
 for(let i=0;i<g.count;i++){
  const x=g.origin[0]+(i%nx)*g.h,y=g.origin[1]+(Math.floor(i/nx)%ny)*g.h,z=g.origin[2]+Math.floor(i/(nx*ny))*g.h;let d=1e6,material=0;
  for(let j=0;j<stamps.length;j++){
   const s=stamps[j],qx=x-s.position[0],qy=y-s.position[1],qz=z-s.position[2];let b;
   if(s.shape==='sphere')b=(Math.hypot(qx/s.size[0],qy/s.size[1],qz/s.size[2])-1)*Math.min(...s.size);
   else if(s.shape==='capsule')b=Math.hypot(qx,qy-Math.max(-s.size[1],Math.min(s.size[1],qy)),qz)-s.size[0];
   else{const dx=Math.abs(qx)-s.size[0],dy=Math.abs(qy)-s.size[1],dz=Math.abs(qz)-s.size[2];b=Math.hypot(Math.max(dx,0),Math.max(dy,0),Math.max(dz,0))+Math.min(Math.max(dx,dy,dz),0);}
   if(s.mode==='paint'){if(b<=0)material=j;continue;}if(s.mode==='subtract'){d=-smoothMin(-d,b,s.blend);continue;}if(b<d)material=j;d=smoothMin(d,b,s.blend);
  }
  data[i*2]=d;data[i*2+1]=material;
 }return data;
}
const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]],edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
export function extractSurfaceFast(data,g,stamps){
 if(!g)return {positions:[],normals:[],materials:[],spacing:0,truncated:false};
 const positions=[],normals=[],materials=[],[nx,ny,nz]=g.dims,offsets=[0,2,nx*2,(nx+1)*2,nx*ny*2,(nx*ny+1)*2,(nx*ny+nx)*2,(nx*ny+nx+1)*2],ds=new Float64Array(8);let truncated=false;
 for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
  const base=(x+nx*(y+ny*z))*2;let negative=0;
  for(let i=0;i<8;i++){ds[i]=data[base+offsets[i]];negative+=ds[i]<0;}
  if(negative===0||negative===8)continue;
  const p=[0,0,0];let count=0;
  for(const [a,b]of edges){if((ds[a]<0)===(ds[b]<0))continue;const t=ds[a]/(ds[a]-ds[b]);for(let k=0;k<3;k++)p[k]+=corners[a][k]+t*(corners[b][k]-corners[a][k]);count++;}
  for(let k=0;k<3;k++)p[k]/=count;
  const n=[(ds[1]+ds[3]+ds[5]+ds[7]-ds[0]-ds[2]-ds[4]-ds[6]),(ds[2]+ds[3]+ds[6]+ds[7]-ds[0]-ds[1]-ds[4]-ds[5]),(ds[4]+ds[5]+ds[6]+ds[7]-ds[0]-ds[1]-ds[2]-ds[3])],len=Math.hypot(...n)||1;
  if(positions.length/3>=LIMITS.splats){truncated=true;continue;}
  positions.push(g.origin[0]+(x+p[0])*g.h,g.origin[1]+(y+p[1])*g.h,g.origin[2]+(z+p[2])*g.h);normals.push(n[0]/len,n[1]/len,n[2]/len);
  let nearest=0;for(let i=1;i<8;i++)if(Math.abs(ds[i])<Math.abs(ds[nearest]))nearest=i;
  materials.push(stamps[Math.round(data[base+offsets[nearest]+1])]?.materialId||stamps[0].materialId);
 }return {positions,normals,materials,spacing:g.h,truncated};
}
export function bakeFast(stamps,spacing){const grid=gridSpec(stamps,spacing);return grid?extractSurfaceFast(sampleGridFast(stamps,grid),grid,stamps):extractSurfaceFast(null,null,stamps);}
