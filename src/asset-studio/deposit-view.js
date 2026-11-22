import * as THREE from 'three';
import {BED_CELL,bedKey} from './material-bed.js';

// The footprint grows only where material arrives. Neighbouring cells share
// vertices and normals so shallow deposits meet the receiving surface smoothly.
export class DepositSurface extends THREE.Mesh{
 constructor(bed,material){
  super(new THREE.BufferGeometry(),material);this.bed=bed;this.version=-1;this.supportVersion=-1;
  this.activeCells=new Set();this.vertices=[];this.frustumCulled=false;if(bed.liquid)this.layers.set(1);
 }
 update(sim){
  const bed=this.bed;
  let supportVersion=(sim.sand?.version||0)+(sim.sandTerrain?.version||0)+(sim.cuts?.version||0);
  if(bed.liquid)for(const other of sim.matter.beds.values())if(!other.liquid)supportVersion+=other.version;
  if(this.version===bed.version&&this.supportVersion===supportVersion)return;
  this.version=bed.version;this.supportVersion=supportVersion;
  let footprintChanged=false;
  for(const c of bed.nodes.values()){
   if(c.h>=.0006){
    if(!this.activeCells.has(c)){this.activeCells.add(c);footprintChanged=true;}
   }else if(this.activeCells.delete(c))footprintChanged=true;
  }
  if(footprintChanged)this.rebuildFootprint();
  if(!this.activeCells.size){this.visible=false;return;}
  this.visible=true;
  const geo=this.geometry,{position,normal,layerDepth,trappedFraction}=geo.attributes;
  const points=this.vertices,indices=geo.index.array,cell=BED_CELL;
  normal.array.fill(0,0,points.length*3);
  for(let i=0;i<points.length;i++){
   const {x,z}=points[i],node=bed.at(x,z),h=node?.h||0,wx=x*cell,wz=z*cell;
   const support=bed.liquid?sim.matter.groundHeight(sim,wx,wz):
    (sim.sandTerrain?.height(wx,wz)??sim.sand?.height(wx,wz)??0)+(sim.cuts?.offset(wx,wz)||0);
   position.setXYZ(i,wx,support+h,wz);layerDepth.setX(i,h);trappedFraction.setX(i,node?.thermal?.trapped||0);
  }
  // Both triangles have the same horizontal area. Their horizontal normal
  // components are just height differences along the two cell axes.
  for(let k=0;k<geo.drawRange.count;k+=6){
   const a=indices[k],d=indices[k+1],b=indices[k+2],e=indices[k+5];
   const ya=position.getY(a),yb=position.getY(b),yd=position.getY(d),ye=position.getY(e);
   for(let j=0;j<6;j++){
    const at=3*indices[k+j];normal.array[at]+=(j<3?ya-yb:yd-ye)*cell;
    normal.array[at+1]+=cell*cell;normal.array[at+2]+=(j<3?ya-yd:yb-ye)*cell;
   }
  }
  for(let i=0;i<points.length;i++){
   const x=normal.getX(i),y=normal.getY(i),z=normal.getZ(i),d=Math.sqrt(x*x+y*y+z*z)||1;normal.setXYZ(i,x/d,y/d,z/d);
  }
  for(const attribute of [position,normal,layerDepth,trappedFraction]){
   attribute.clearUpdateRanges();attribute.addUpdateRange(0,attribute.itemSize*points.length);attribute.needsUpdate=true;
  }
  geo.computeBoundingSphere();
 }
 rebuildFootprint(){
  const geo=this.geometry,lookup=new Map(),cells=new Set(),points=[],indices=[];
  const vertex=(x,z)=>{
   const key=bedKey(x,z);let i=lookup.get(key);
   if(i===undefined){i=points.length;lookup.set(key,i);points.push({x,z});}
   return i;
  };
  for(const c of this.activeCells)for(let z=c.z-1;z<=c.z;z++)for(let x=c.x-1;x<=c.x;x++){
   const key=bedKey(x,z);if(cells.has(key))continue;cells.add(key);
   const a=vertex(x,z),b=vertex(x+1,z),d=vertex(x,z+1),e=vertex(x+1,z+1);
   indices.push(a,d,b,b,d,e);
  }
  this.vertices=points;geo.setDrawRange(0,indices.length);
  if(!points.length)return;
  if(points.length>(geo.attributes.position?.count||0)||indices.length>(geo.index?.count||0)){
   const capacity=n=>2**Math.ceil(Math.log2(Math.max(32,n)));
   geo.dispose();
   for(const [name,width] of [['position',3],['normal',3],['layerDepth',1],['trappedFraction',1]]){
    geo.setAttribute(name,new THREE.BufferAttribute(new Float32Array(capacity(points.length)*width),width).setUsage(THREE.DynamicDrawUsage));
   }
   geo.setIndex(new THREE.BufferAttribute(new Uint32Array(capacity(indices.length)),1).setUsage(THREE.DynamicDrawUsage));
  }
  geo.index.array.set(indices);geo.index.clearUpdateRanges();geo.index.addUpdateRange(0,indices.length);geo.index.needsUpdate=true;
 }
 ownerAt(point){
  for(const x of [Math.round(point.x/BED_CELL),Math.floor(point.x/BED_CELL),Math.ceil(point.x/BED_CELL)])
   for(const z of [Math.round(point.z/BED_CELL),Math.floor(point.z/BED_CELL),Math.ceil(point.z/BED_CELL)]){
    const cell=this.bed.at(x,z);if(cell?.h>.0006)return cell.owner;
   }
 }
}
