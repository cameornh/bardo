import {shapeRadius,shapeBlend,sandIsTracer} from '../sand-lab/sand-shape.js';
import {sandExtent} from '../sand-lab/sand-bins.js';
import {floatTexture} from '../sand-lab/uniforms.js';

const power=n=>2**Math.ceil(Math.log2(Math.max(1,n)));
const cell=(v,axis)=>Math.max(0,Math.min(31,Math.floor((v+(axis===0?5.5:4.9))/(axis===0?11:9.8)*32)));
function cellsFor(p){const e=sandExtent(p),out=[];for(let z=cell(p.position[2]-e[2],2);z<=cell(p.position[2]+e[2],2);z++)for(let x=cell(p.position[0]-e[0],0);x<=cell(p.position[0]+e[0],0);x++)out.push(x+32*z);return out;}
// Three.js texture ranges are components, and each upload must fit one row.
export function dirtyRows(texture,rows){for(const row of rows)texture.addUpdateRange(row*texture.image.width*4,texture.image.width*4);if(rows.size)texture.needsUpdate=true;}
const touch=(rows,start,count)=>{for(let r=Math.floor(start/1024);r<=Math.floor((start+count-1)/1024);r++)rows.add(r);};
function texture(u,key,data){u[key].value.dispose();u[key].value=floatTexture(data,256,data.length/1024);}

export class IncrementalSand {
 constructor(bed){this.bed=bed;this.records=[];this.cells=Array.from({length:1024},()=>new Set());this.blocks=[];this.tail=0;this.binCapacity=0;this.capacity=0;this.cutCapacity=0;this.stats={changedShapes:0,changedBins:0,uploadedRows:0,stable:0,moving:0};}
 update(lab){
  const bed=this.bed,u=lab.u,parcels=bed.parcels.filter(p=>p.mass>0&&!sandIsTracer(p));lab.sandRenderParcels=parcels;
  if(!lab.terrainHeights||lab.terrainHeights.length!==bed.mass.length)lab.terrainHeights=new Float64Array(bed.mass.length);
  if(this.bedRevision!==bed.bedGeometryRevision){for(let i=0;i<bed.mass.length;i++)lab.terrainHeights[i]=bed.heightAt(i);this.bedRevision=bed.bedGeometryRevision;}
  const groundRows=new Set(),ground=u.uSand.value;
  if(!this.ground||this.ground.length!==bed.data.length){this.ground=bed.data.slice();ground.needsUpdate=true;}
  else{for(let i=0;i<bed.data.length;i++)if(this.ground[i]!==bed.data[i]){this.ground[i]=bed.data[i];groundRows.add(Math.floor(i/(bed.n*4)));}dirtyRows(ground,groundRows);}
  let neededCuts=1;for(const p of parcels)neededCuts=Math.max(neededCuts,p.cuts?.length||0);
  const grow=parcels.length>this.capacity||neededCuts>this.cutCapacity||!this.capacity;
  if(grow){this.capacity=power(Math.max(16,parcels.length));this.cutCapacity=power(neededCuts);texture(u,'uSandParcels',new Float32Array(Math.ceil((this.capacity*12+this.capacity*this.cutCapacity*8)/1024)*1024));}
  const data=u.uSandParcels.value.image.data,rows=new Set(),dirty=new Set();let changed=0,stable=0,moving=0;
  for(let i=parcels.length;i<this.records.length;i++)for(const c of this.records[i].cells){this.cells[c].delete(i);dirty.add(c);}
  this.records.length=parcels.length;
  for(let i=0;i<parcels.length;i++){
   const p=parcels[i],r=shapeRadius(p),a=p.aspect||1,k=shapeBlend(p),old=this.records[i];
   const geometry=!old||old.p!==p||old.r!==r||old.a!==a||old.k!==k||old.cuts!==p.cuts||old.cutCount!==(p.cuts?.length||0)||p.position.some((v,j)=>v!==old.position[j]);
   if(geometry){changed++;if(old)for(const c of old.cells){this.cells[c].delete(i);dirty.add(c);}const cells=cellsFor(p);for(const c of cells){this.cells[c].add(i);dirty.add(c);}
    this.records[i]={p,r,a,k,cuts:p.cuts,cutCount:p.cuts?.length||0,position:p.position.slice(),cells,wet:p.wet};
   }
   if(p.anchored&&!p.held)stable++;else moving++;
   const offset=i*12,cutStart=this.capacity*12+i*this.cutCapacity*8;
   if(grow||geometry){data.set([...p.position,r,p.wet,a,cutStart/4,p.cuts?.length||0,k,0,0,0],offset);touch(rows,offset,12);
    for(let j=0;j<(p.cuts?.length||0);j++){const c=p.cuts[j];data.set([...c.offset.map((v,t)=>v+p.position[t]),c.radius,c.aspect||1,0,0,0],cutStart+j*8);}if(p.cuts?.length)touch(rows,cutStart,p.cuts.length*8);
   }else if(this.records[i].wet!==p.wet){data[offset+4]=p.wet;this.records[i].wet=p.wet;touch(rows,offset+4,1);}
  }
  dirtyRows(u.uSandParcels.value,rows);
  let maxCount=0,liveCapacity=0;for(const c of this.cells){maxCount=Math.max(maxCount,c.size);liveCapacity+=power(c.size);}
  // Per-cell blocks prevent one crowded bin from padding all 1,024 bins.
  // Reclaim abandoned growth blocks occasionally, never on every edit.
  if(this.tail>Math.max(4096,liveCapacity*3)){this.blocks=[];this.tail=0;for(let i=0;i<1024;i++)dirty.add(i);}
  if(!this.binCapacity)for(let i=0;i<1024;i++)dirty.add(i);
  for(const c of dirty)if(!this.blocks[c]||this.blocks[c].capacity<this.cells[c].size){const capacity=power(this.cells[c].size);this.blocks[c]={start:this.tail,capacity};this.tail+=capacity;}
  if(this.tail>this.binCapacity){this.binCapacity=power(Math.max(1024,this.tail));const data=new Float32Array(4096+this.binCapacity);if(this.blocks.length)data.set(u.uSandBins.value.image.data.subarray(0,data.length));texture(u,'uSandBins',data);}
  const bins=u.uSandBins.value.image.data,binRows=new Set();
  for(const c of dirty){const ids=[...this.cells[c]].sort((a,b)=>a-b),start=this.blocks[c].start;bins[c*4]=start;bins[c*4+1]=ids.length;bins.set(ids,4096+start);touch(binRows,c*4,4);if(ids.length)touch(binRows,4096+start,ids.length);}
  dirtyRows(u.uSandBins.value,binRows);
  if(changed||dirty.size){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of parcels){const e=sandExtent(p);for(let k=0;k<3;k++){min[k]=Math.min(min[k],p.position[k]-e[k]);max[k]=Math.max(max[k],p.position[k]+e[k]);}}u.uSandMin.value.fromArray(parcels.length?min:[0,0,0]);u.uSandMax.value.fromArray(parcels.length?max:[0,0,0]);}
  u.uSandCount.value=parcels.length;lab.sandBinMaxCount=maxCount;lab.sandRevision=bed.revision;
  this.stats={changedShapes:changed,changedBins:dirty.size,uploadedRows:rows.size+binRows.size+groundRows.size,stable,moving};
 }
}
