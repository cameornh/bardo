import {transportFluid,physicalCoefficients,WATER_DENSITY,WATER_SURFACE_TENSION} from '../../sand-lab/water-lab-transport.js';
let module;
export async function setTransportKernel(bytes){module=await WebAssembly.compile(bytes);}
export const transportKernelReady=typeof window==='undefined'?Promise.resolve(false):fetch(new URL('./kernels/transport.wasm',import.meta.url)).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}).then(setTransportKernel).then(()=>true).catch(()=>false);
// Explicit CPU implementation, not GPU compute. Historical labs retain their
// original GPU transport. The hybrid live lab already has its state on the CPU.
export class FieldTransport {
 allocate(n){
  if(!this.instance){if(!module)return false;this.instance=new WebAssembly.Instance(module,{});}
  if(n<=this.capacity)return true;
  this.capacity=2**Math.ceil(Math.log2(Math.max(64,n)));const c=this.capacity,layout={};let bytes=65536;
  const reserve=(name,count,Type=Float32Array)=>{bytes=Math.ceil(bytes/8)*8;layout[name]={offset:bytes,count,Type};bytes+=count*Type.BYTES_PER_ELEMENT;};
  for(const name of ['old','next','previous','chem','predicted','raw','velocities','out','metrics'])reserve(name,c*4);
  reserve('neighbors',c*128);reserve('counts',c,Uint16Array);reserve('activity',c*2);reserve('breakup',c);reserve('accum',c*12,Float64Array);
  const memory=this.instance.exports.memory,pages=Math.ceil(bytes/65536);if(memory.buffer.byteLength/65536<pages)memory.grow(pages-memory.buffer.byteLength/65536);
  this.offsets={};for(const [name,{offset,count,Type}] of Object.entries(layout)){this.offsets[name]=offset;this[name]=new Type(memory.buffer,offset,count);}return true;
 }
 solve(old,next,previous,chem,neighbors,s,scale,dt,predicted=null,reciprocal=false){
  const n=next.length/4;
  if(!n||!this.allocate(n)){this.backend='JavaScript CPU reference';return transportFluid(old,next,previous,chem,neighbors,s,scale,dt,predicted);}
  this.backend='WebAssembly CPU transport';
  for(const [key,data] of Object.entries({old,next,previous,chem,neighbors,...(predicted?{predicted}:{})}))this[key].set(data);
  const p=this.offsets,c=physicalCoefficients(s,scale,dt);
  this.instance.exports.transport(n,p.old,p.next,p.previous,p.chem,p.neighbors,predicted?p.predicted:0,p.raw,p.velocities,p.out,p.metrics,p.counts,p.activity,p.breakup,p.accum,reciprocal,s,scale,dt,c.viscosity,c.capillary,WATER_SURFACE_TENSION,WATER_DENSITY);
  return {velocities:this.velocities.slice(0,n*4),chem:this.out.slice(0,n*4),metrics:this.metrics.slice(0,n*4),counts:this.counts.slice(0,n),activity:this.activity.slice(0,n*2),breakup:this.breakup.slice(0,n)};
 }
}
