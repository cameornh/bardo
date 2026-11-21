import * as THREE from 'three';
import {BED_CELL,bedKey} from './material-bed.js';

// The footprint grows only where material arrives. Neighbouring cells share
// vertices and normals so shallow deposits meet the receiving surface smoothly.
export class DepositSurface extends THREE.Mesh{
 constructor(bed,material){
  super(new THREE.BufferGeometry(),material);this.bed=bed;this.version=-1;this.supportVersion=-1;
  this.frustumCulled=false;if(bed.liquid)this.layers.set(1);
 }
 update(sim){
  const bed=this.bed;
  let supportVersion=sim.sand?.version||0;
  if(bed.liquid)for(const other of sim.matter.beds.values())if(!other.liquid)supportVersion+=other.version;
  if(this.version===bed.version&&this.supportVersion===supportVersion)return;
  this.version=bed.version;this.supportVersion=supportVersion;
  const cell=BED_CELL,lookup=new Map(),cells=new Set(),points=[],indices=[];
  const id=bedKey;
  const vertex=(x,z)=>{
   const k=id(x,z);let i=lookup.get(k);if(i!==undefined)return i;
   const h=bed.at(x,z)?.h||0,wx=x*cell,wz=z*cell;
   const support=bed.liquid?sim.matter.groundHeight(sim,wx,wz):sim.sand?.height(wx,wz)||0;
   i=points.length;lookup.set(k,i);points.push([wx,support+h,wz,h]);return i;
  };
  for(const c of bed.nodes.values()){
   if(c.h<.0006)continue;
   for(let z=c.z-1;z<=c.z;z++)for(let x=c.x-1;x<=c.x;x++){
    const k=id(x,z);if(cells.has(k))continue;cells.add(k);
    const a=vertex(x,z),b=vertex(x+1,z),d=vertex(x,z+1),e=vertex(x+1,z+1);
    indices.push(a,d,b,b,d,e);
   }
  }
  const geo=this.geometry;
  if(points.length>(geo.attributes.position?.count||0)||indices.length>(geo.index?.count||0)){
   const capacity=n=>2**Math.ceil(Math.log2(Math.max(32,n)));
   const count=capacity(points.length);
   // Dispose before replacing attributes so the renderer releases old buffers.
   geo.dispose();
   for(const [name,width] of [['position',3],['normal',3],['layerDepth',1]])
    geo.setAttribute(name,new THREE.BufferAttribute(new Float32Array(count*width),width).setUsage(THREE.DynamicDrawUsage));
   geo.setIndex(new THREE.BufferAttribute(new Uint32Array(capacity(indices.length)),1).setUsage(THREE.DynamicDrawUsage));
  }
  geo.setDrawRange(0,indices.length);this.visible=!!indices.length;if(!this.visible)return;
  const {position,normal,layerDepth}=geo.attributes;
  normal.array.fill(0,0,points.length*3);
  for(let i=0;i<points.length;i++){const [x,y,z,h]=points[i];position.setXYZ(i,x,y,z);layerDepth.setX(i,h);}
  for(let k=0;k<indices.length;k+=3){
   const a=points[indices[k]],b=points[indices[k+1]],c=points[indices[k+2]];
   const nx=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
   const nz=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
   for(let j=k;j<k+3;j++){const at=3*indices[j];normal.array[at]+=nx;normal.array[at+1]+=cell*cell;normal.array[at+2]+=nz;}
  }
  for(let i=0;i<points.length;i++){
   const x=normal.getX(i),y=normal.getY(i),z=normal.getZ(i),d=Math.sqrt(x*x+y*y+z*z)||1;normal.setXYZ(i,x/d,y/d,z/d);
  }
  geo.index.array.set(indices);
  for(const [attribute,count] of [[position,3*points.length],[normal,3*points.length],[layerDepth,points.length],[geo.index,indices.length]]){
   attribute.clearUpdateRanges();attribute.addUpdateRange(0,count);attribute.needsUpdate=true;
  }
  geo.computeBoundingSphere();
 }
 ownerAt(point){
  for(const x of [Math.round(point.x/BED_CELL),Math.floor(point.x/BED_CELL),Math.ceil(point.x/BED_CELL)])
   for(const z of [Math.round(point.z/BED_CELL),Math.floor(point.z/BED_CELL),Math.ceil(point.z/BED_CELL)]){
    const cell=this.bed.at(x,z);if(cell?.h>.0006)return cell.owner;
   }
 }
}
