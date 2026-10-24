import {NativeDensity,nativeDensityAvailable} from './native-density.js';
import {boundaryMetric,boundaryKernel,WATER_CONTACT_SKIN} from './water-lab-model.js';

// Reuse the verified geometry exports, without allocating the CPU solver's
// enormous pair cache or neighbor arrays. Native point storage is 92 B/point.
class CompactContacts extends NativeDensity {
 allocate(n,geometrySize=0){
  if(n<=this.capacity&&geometrySize<=this.geometryCapacity)return;
  this.capacity=Math.max(this.capacity,2**Math.ceil(Math.log2(Math.max(64,n))));
  this.geometryCapacity=Math.max(this.geometryCapacity||0,geometrySize);
  let offset=65536;const layout={};
  const reserve=(name,count,Type)=>{offset=Math.ceil(offset/8)*8;layout[name]={start:offset,count,Type};offset+=count*Type.BYTES_PER_ELEMENT;};
  const c=this.capacity;reserve('positions',c*4,Float32Array);reserve('delta',c*3,Float64Array);
  reserve('wall',c*4,Float64Array);reserve('boundaryPositions',c*4,Float32Array);reserve('missing',c,Int32Array);
  reserve('geometry',this.geometryCapacity,Float64Array);reserve('metric',4,Float64Array);
  const memory=this.instance.exports.memory,pages=Math.ceil(offset/65536),current=memory.buffer.byteLength/65536;
  if(pages>current)memory.grow(pages-current);this.offsets={};
  for(const [key,{start,count,Type}] of Object.entries(layout)){this.offsets[key]=start;this[key]=new Type(memory.buffer,start,count);}
 }
}

export class PressureContacts {
 constructor({native=true}={}){this.useNative=native;}
 begin(positions,spacing,collide=p=>p,boundary=null,lab=null){
  this.n=positions.length/4;this.spacing=spacing;this.collide=collide;this.boundary=boundary;this.original=positions;
  const geometry=lab?.sand&&lab.optimizations?.terrainCache!==false?lab:null;
  this.native=this.useNative&&geometry&&nativeDensityAvailable()?(this.native||new CompactContacts()):null;
  this.backend=this.native?'WebAssembly CPU contacts':'JavaScript CPU contacts';this.referenceQueries=0;
  if(this.wall?.length!==positions.length){this.wall=new Float32Array(positions.length);this.result=new Float32Array(positions.length);}
  if(this.native){
   geometry.syncSandUniforms();const parcels=geometry.sandRenderParcels||[],full=parcels.length>0,
    extra=full?geometry.u.uSandBins.value.image.data.length+parcels.reduce((n,p)=>n+8+(p.cuts?.length||0)*5,0):0;
   this.native.allocate(this.n,32+geometry.sand.n**2+geometry.balls.length*16+1024+extra);
   this.native.prepareGeometry(geometry,full);
  }
 }
 sample(positions){
  if(!this.boundary){this.wall.fill(0);return this.wall;}
  const s=this.native,h=this.spacing*2;let count=this.n;
  if(s){s.positions.set(positions);const o=s.offsets;count=s.instance.exports.boundaryBatch(this.n,o.positions,o.wall,o.geometry,o.metric,o.missing,h,o.boundaryPositions,false);this.wall.set(s.wall.subarray(0,this.n*4));}
  this.referenceQueries+=count;
  for(let at=0;at<count;at++){
   const i=s?s.missing[at]:at,o=i*4,metric=boundaryMetric(Array.from(positions.subarray(o,o+3)),this.boundary,h),b=boundaryKernel(metric.distance,h),f=b.density>1e-6?b.gradient:0;
   this.wall.set([metric.normal[0]*f,metric.normal[1]*f,metric.normal[2]*f,b.density],o);
  }
  return this.wall;
 }
 project(corrected){
  const s=this.native,r=this.spacing*WATER_CONTACT_SKIN;let count=this.n;
  this.result.set(corrected);
  // Held flags/positions are authoritative even if a GPU result is malformed.
  for(let i=0;i<this.n;i++)if(this.original[i*4+3]>.5)this.result.set(this.original.subarray(i*4,i*4+4),i*4);
  if(s){
   s.positions.set(this.result);for(let i=0;i<this.n;i++)s.delta.set(this.result.subarray(i*4,i*4+3),i*3);
   const o=s.offsets;count=s.instance.exports.contactBatch(this.n,o.positions,o.delta,o.geometry,o.metric,o.missing,r);
   this.result.set(s.positions.subarray(0,this.n*4));
  }
  this.referenceQueries+=count;
  for(let at=0;at<count;at++){
   const i=s?s.missing[at]:at,o=i*4;if(this.original[o+3]>.5)continue;
   this.result.set(this.collide(Array.from(corrected.subarray(o,o+3))),o);
  }
  return this.result;
 }
 get memoryBytes(){return this.native?.instance.exports.memory.buffer.byteLength||0;}
}
