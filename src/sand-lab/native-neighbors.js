import {PackedPointGrid} from './packed-neighbors.js';
// CPU accelerator only: no physical approximation, camera dependency, or new
// runtime package. The JS implementation remains the reference and fallback.
let module;
export const neighborKernelReady=typeof window==='undefined'?Promise.resolve(false):fetch(new URL('./kernels/neighbors.wasm',import.meta.url)).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}).then(async bytes=>{module=await WebAssembly.compile(bytes);return true;}).catch(()=>false);
export async function setNeighborKernel(bytes){module=await WebAssembly.compile(bytes);}
export function nativeNeighborsAvailable(){return !!module;}
export class NativeNeighbors {
 constructor(){this.grid=new PackedPointGrid();this.capacity=0;this.instance=new WebAssembly.Instance(module,{});this.memory=this.instance.exports.memory;}
 allocate(capacity){
  if(capacity<=this.capacity)return;this.capacity=capacity;
  let offset=1024;const reserve=(count,Type)=>{const start=offset;offset+=count*Type.BYTES_PER_ELEMENT;return {start,count,Type};};
  const layout={positions:reserve(capacity*4,Float32Array),table:reserve(capacity*4,Int32Array),xyz:reserve(capacity*3,Int32Array),starts:reserve(capacity+1,Uint32Array),indices:reserve(capacity,Uint32Array),data:reserve(capacity*128,Float32Array),counts:reserve(capacity,Uint32Array),sorted:reserve(capacity*3,Float32Array)};
  const pages=Math.ceil(offset/65536),current=this.memory.buffer.byteLength/65536;if(pages>current)this.memory.grow(pages-current);
  this.offsets={};for(const [key,{start,count,Type}] of Object.entries(layout)){this.offsets[key]=start;this[key]=new Type(this.memory.buffer,start,count);}
 }
 build(positions,spacing){
  const n=positions.length/4,reach=spacing*2.65,g=this.grid.build(positions,reach);this.allocate(g.capacity);
  this.positions.set(positions);this.table.set(g.table);this.xyz.set(g.xyz.subarray(0,g.cellCount*3));this.starts.set(g.starts.subarray(0,g.cellCount+1));this.indices.set(g.indices.subarray(0,n));
  const o=this.offsets,overflow=this.instance.exports.build(n,this.capacity,g.cellCount,reach,o.positions,o.table,o.xyz,o.starts,o.indices,o.data,o.counts,o.sorted);
  return {data:this.data.subarray(0,n*128),overflow,cells:g.cellCount};
 }
}
