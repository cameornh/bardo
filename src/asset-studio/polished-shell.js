import {BoxGeometry,BufferGeometry,Float32BufferAttribute,SphereGeometry} from 'three';
import {revolvedOptic} from './revolved-optic.js';
import {gridSpec} from './sculpt.js';
import {extractSurfaceFast,sampleGridFast} from './sculpt-fast.js';

// Connect the crossing cells of the same constructive field used by the sculpt
// brush. The shell has a single surface depth and interpolated geometric normals.
export function polishedShell(shape,shadow=false){
 const {primitives,center,size}=shape;
 if(primitives.length===1){
  const g=primitives[0].box?new BoxGeometry(2,2,2):new SphereGeometry(1,shadow?16:48,shadow?12:32);
  g.scale(size.x,size.y,size.z);g.translate(center.x,center.y,center.z);g.computeBoundingBox();return g;
 }
 const revolved=revolvedOptic(shape,shadow);if(revolved)return revolved;
 const stamps=primitives.map((s,i)=>({shape:s.box?'box':'sphere',position:s.center.toArray(),size:s.size.toArray(),mode:i?'subtract':'add',blend:0}));
 const grid=gridSpec(stamps,Math.max(.006,Math.max(size.x,size.y,size.z)/(shadow?9:26)));
 const [nx,ny,nz]=grid.dims,vertices=new Int32Array(grid.count).fill(-1);
 const data=sampleGridFast(stamps,grid),shell=extractSurfaceFast(data,grid,stamps,vertices);
 const indices=[],strides=[1,nx,nx*ny];
 for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){
  const i=x+nx*(y+ny*z),inside=data[2*i]<0;
  for(let k=0;k<3;k++){
   if(inside===(data[2*(i+strides[k])]<0))continue;
   const u=strides[(k+1)%3],v=strides[(k+2)%3];
   const a=vertices[i],b=vertices[i-u],c=vertices[i-u-v],d=vertices[i-v];
   if(Math.min(a,b,c,d)<0)continue;
   if(inside)indices.push(a,b,c,a,c,d);else indices.push(a,c,b,a,d,c);
  }
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(shell.positions,3));
 g.setAttribute('normal',new Float32BufferAttribute(shell.normals,3));g.setIndex(indices);g.computeBoundingBox();return g;
}
