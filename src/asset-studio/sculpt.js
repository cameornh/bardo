import {LIMITS} from './model.js';
export function primitive(p,s){const q=p.map((x,i)=>x-s.position[i]);if(s.shape==='sphere')return (Math.hypot(...q.map((x,i)=>x/s.size[i]))-1)*Math.min(...s.size);if(s.shape==='capsule'){q[1]-=Math.max(-s.size[1],Math.min(s.size[1],q[1]));return Math.hypot(...q)-s.size[0];}const d=q.map((x,i)=>Math.abs(x)-s.size[i]);return Math.hypot(...d.map(x=>Math.max(x,0)))+Math.min(Math.max(...d),0);}
export function smoothMin(a,b,k){if(k<=0)return Math.min(a,b);const h=Math.max(0,k-Math.abs(a-b))/k;return Math.min(a,b)-h*h*k*.25;}
export function field(p,stamps){let d=1e6,material=0;for(let i=0;i<stamps.length;i++){const s=stamps[i],b=primitive(p,s);if(s.mode==='paint'){if(b<=0)material=i;continue;}if(s.mode==='subtract'){d=-smoothMin(-d,b,s.blend);continue;}if(b<d)material=i;d=smoothMin(d,b,s.blend);}return [d,material];}
export function gridSpec(stamps,spacing){
 const adds=stamps.filter(s=>s.mode==='add');if(!adds.length)return null;
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const s of adds)for(let k=0;k<3;k++){const r=s.shape==='capsule'?(k===1?s.size[0]+s.size[1]:s.size[0]):s.size[k];lo[k]=Math.min(lo[k],s.position[k]-r-s.blend-.2);hi[k]=Math.max(hi[k],s.position[k]+r+s.blend+.2);}
 let h=spacing,dims;do{dims=hi.map((x,k)=>Math.ceil((x-lo[k])/h)+1);if(dims.reduce((a,b)=>a*b,1)<=LIMITS.grid)break;h*=1.08;}while(true);
 return {origin:lo,h,dims,count:dims.reduce((a,b)=>a*b,1)};
}
export function sampleGridCPU(stamps,g){const data=new Float32Array(g.count*2),[nx,ny]=g.dims;for(let i=0;i<g.count;i++){const p=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))].map((x,k)=>g.origin[k]+x*g.h);data.set(field(p,stamps),i*2);}return data;}
const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]],edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
export function extractSurface(data,g,stamps){
 if(!g)return {positions:[],normals:[],materials:[],spacing:0,truncated:false};
 const positions=[],normals=[],materials=[],[nx,ny,nz]=g.dims,ix=(x,y,z)=>x+nx*(y+ny*z),dist=(x,y,z)=>data[ix(Math.max(0,Math.min(nx-1,x)),Math.max(0,Math.min(ny-1,y)),Math.max(0,Math.min(nz-1,z)))*2];let truncated=false;
 for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
  const ds=corners.map(c=>dist(x+c[0],y+c[1],z+c[2]));if(ds.every(v=>v>=0)||ds.every(v=>v<0))continue;
  const p=[0,0,0];let count=0;for(const [a,b]of edges){if((ds[a]<0)===(ds[b]<0))continue;const t=ds[a]/(ds[a]-ds[b]);for(let k=0;k<3;k++)p[k]+=corners[a][k]+t*(corners[b][k]-corners[a][k]);count++;}for(let k=0;k<3;k++)p[k]/=count;
  const n=[(ds[1]+ds[3]+ds[5]+ds[7]-ds[0]-ds[2]-ds[4]-ds[6]),(ds[2]+ds[3]+ds[6]+ds[7]-ds[0]-ds[1]-ds[4]-ds[5]),(ds[4]+ds[5]+ds[6]+ds[7]-ds[0]-ds[1]-ds[2]-ds[3])],len=Math.hypot(...n)||1;
  if(positions.length/3>=LIMITS.splats){truncated=true;continue;}positions.push(...p.map((v,k)=>g.origin[k]+([x,y,z][k]+v)*g.h));normals.push(...n.map(v=>v/len));
  const nearest=corners.map((c,i)=>[Math.abs(ds[i]),data[ix(x+c[0],y+c[1],z+c[2])*2+1]]).sort((a,b)=>a[0]-b[0])[0][1];materials.push(stamps[Math.round(nearest)]?.materialId||stamps[0].materialId);
 }
 return {positions,normals,materials,spacing:g.h,truncated};
}
export function bakeCPU(stamps,spacing){const grid=gridSpec(stamps,spacing);return grid?extractSurface(sampleGridCPU(stamps,grid),grid,stamps):extractSurface(null,null,stamps);}
