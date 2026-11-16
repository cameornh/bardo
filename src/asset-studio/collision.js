import {field,gridSpec} from './sculpt.js';
// Fixed world-space authoring proxy, independent of render spacing and camera.
// Exact primitives when possible; bounded greedy occupied boxes preserve carved openings.
export function collisionProxy(part){
 const adds=part.stamps.filter(s=>s.mode==='add');
 if(!adds.length)return {shapes:[],spacing:0};
 if(part.stamps.length===1){const s=adds[0];if(s.shape==='box')return {shapes:[{type:'box',center:s.position,half:s.size,materialId:s.materialId}],spacing:0};
 if(s.shape==='sphere'&&s.size.every(v=>Math.abs(v-s.size[0])<1e-6))return {shapes:[{type:'ball',center:s.position,radius:s.size[0],materialId:s.materialId}],spacing:0};
 if(s.shape==='capsule')return {shapes:[{type:'capsule',center:s.position,radius:s.size[0],halfHeight:s.size[1],materialId:s.materialId}],spacing:0};}
 const bounds=gridSpec(part.stamps,.15),extent=bounds.dims.map(n=>(n-1)*bounds.h);let h=Math.max(.12,Math.max(...extent)/24);
 for(let attempt=0;attempt<10;attempt++,h*=1.35){
  const dims=extent.map(v=>Math.ceil(v/h)),[nx,ny,nz]=dims,count=nx*ny*nz;if(count>10000)continue;
  const cells=new Int32Array(count).fill(-1),ids=[...new Set(part.stamps.map(s=>s.materialId))],index=(x,y,z)=>x+nx*(y+ny*z);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const p=[x,y,z].map((v,k)=>bounds.origin[k]+(v+.5)*h),[d,m]=field(p,part.stamps);if(d<0)cells[index(x,y,z)]=ids.indexOf(part.stamps[m].materialId);}
  const shapes=[];
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const material=cells[index(x,y,z)];if(material<0)continue;let w=1,hh=1,dd=1;
   while(x+w<nx&&cells[index(x+w,y,z)]===material)w++;
   const row=(yy,zz)=>{for(let xx=x;xx<x+w;xx++)if(cells[index(xx,yy,zz)]!==material)return false;return true;};
   while(y+hh<ny&&row(y+hh,z))hh++;
   const slab=zz=>{for(let yy=y;yy<y+hh;yy++)if(!row(yy,zz))return false;return true;};
   while(z+dd<nz&&slab(z+dd))dd++;
   for(let zz=z;zz<z+dd;zz++)for(let yy=y;yy<y+hh;yy++)for(let xx=x;xx<x+w;xx++)cells[index(xx,yy,zz)]=-1;
   shapes.push({type:'box',center:[x+w/2,y+hh/2,z+dd/2].map((v,k)=>bounds.origin[k]+v*h),half:[w,hh,dd].map(v=>v*h/2),materialId:ids[material]});
  }
  if(shapes.length<=128)return {shapes,spacing:h};
 }
 throw Error('Collision proxy budget exceeded. Split this part into smaller pieces.');
}
