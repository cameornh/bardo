import {solveMultigrid,multiply,norm} from './multigrid.js';
let compiled;
export async function setPressureKernel(bytes){compiled=await WebAssembly.compile(bytes);}
export const pressureKernelReady=typeof window==='undefined'?Promise.resolve(false):fetch(new URL('./kernels/pressure.wasm',import.meta.url)).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}).then(setPressureKernel).then(()=>true).catch(()=>false);
export class FieldPressure {
 prepare(levels){
  this.instance??=new WebAssembly.Instance(compiled,{});
  if(this.levels===levels)return;
  let bytes=65536;const entries=[];
  const reserve=(count,Type=Float64Array,data=null)=>{bytes=Math.ceil(bytes/8)*8;const entry={at:bytes,count,Type,data};entries.push(entry);bytes+=count*Type.BYTES_PER_ELEMENT;return entry;};
  const metadata=reserve(levels.length*10,Uint32Array),rows=levels.map(g=>[g.n,reserve(g.offset.length,Int32Array,g.offset),reserve(g.n,Float64Array,g.diag),reserve(g.column.length,Int32Array,g.column),reserve(g.weight.length,Float64Array,g.weight),reserve(g.parent?.length||0,Int32Array,g.parent),...Array.from({length:4},()=>reserve(g.n))]);
  const vectors=Object.fromEntries(['b','x','r','d','ax','z'].map(k=>[k,reserve(levels[0].n)])),memory=this.instance.exports.memory;
  const pages=Math.ceil(bytes/65536);if(pages>memory.buffer.byteLength/65536)memory.grow(pages-memory.buffer.byteLength/65536);
  for(const e of entries){e.view=new e.Type(memory.buffer,e.at,e.count);if(e.data)e.view.set(e.data);}
  rows.forEach((row,l)=>metadata.view.set(row.map(e=>typeof e==='number'?e:e.at),l*10));this.metadata=metadata;this.vectors=vectors;this.levels=levels;
 }
 solve(levels,b,options={}){
  if(!compiled||options.precondition===false)return solveMultigrid(levels,b,options);
  const start=performance.now();this.prepare(levels);const v=this.vectors;v.b.view.set(b);if(options.initial)v.x.view.set(options.initial);else v.x.view.fill(0);
  const iterations=this.instance.exports.pressure(this.metadata.at,levels.length,v.b.at,v.x.at,v.r.at,v.d.at,v.ax.at,v.z.at,options.tolerance??2e-5,options.iterations??80);
  const potential=v.x.view.slice(),residual=multiply(levels[0],potential,v.ax.view);for(let i=0;i<b.length;i++)residual[i]-=b[i];const absoluteResidual=norm(residual);
  return {potential,absoluteResidual,relativeResidual:absoluteResidual/Math.max(norm(b),1e-12),iterations,levels:levels.length,milliseconds:performance.now()-start,backend:'WebAssembly CPU multigrid-PCG'};
 }
}
