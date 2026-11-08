let module;
export async function setTransferKernel(bytes){module=await WebAssembly.compile(bytes);}
export const transferKernelReady=typeof window==='undefined'?Promise.resolve(false):fetch(new URL('./kernels/transfer.wasm',import.meta.url)).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}).then(setTransferKernel).then(()=>true).catch(()=>false);
export class FieldTransfer {
 allocate(grid,n){
  if(!module)return false;
  this.instance??=new WebAssembly.Instance(module,{});
  if(this.grid===grid&&n<=this.capacity)return true;
  this.grid=grid;this.capacity=2**Math.ceil(Math.log2(Math.max(64,n)));let bytes=65536;const layout={};
  const reserve=(name,count,Type)=>{bytes=Math.ceil(bytes/8)*8;layout[name]={offset:bytes,count,Type};bytes+=count*Type.BYTES_PER_ELEMENT;};
  for(const name of ['positions','predicted','result'])reserve(name,this.capacity*4,Float32Array);
  reserve('cells',this.capacity,Int32Array);reserve('phase',grid.count,Uint8Array);reserve('indices',this.capacity*24,Int32Array);reserve('weights',this.capacity*24,Float64Array);reserve('config',6,Float64Array);reserve('faces',24,Int32Array);
  for(const f of grid.faces)for(const name of ['before','weight','velocity','a','b'])reserve(f.axis+name,f.velocity.length,name==='a'||name==='b'?Int32Array:Float64Array);
  const memory=this.instance.exports.memory,pages=Math.ceil(bytes/65536);if(memory.buffer.byteLength<pages*65536)memory.grow(pages-memory.buffer.byteLength/65536);
  this.offsets={};for(const [name,{offset,count,Type}] of Object.entries(layout)){this.offsets[name]=offset;this[name]=new Type(memory.buffer,offset,count);}
  this.config.set([...grid.origin,...grid.cellSize]);
  for(const f of grid.faces){const o=this.offsets,axis=f.axis;this.faces.set([...f.dims,o[axis+'before'],o[axis+'weight'],o[axis+'velocity'],o[axis+'a'],o[axis+'b']],axis*8);this[axis+'a'].set(f.a);this[axis+'b'].set(f.b);}
  return true;
 }
 scatter(grid,positions,predicted,dt,scale){
  const n=positions.length/4;if(!this.allocate(grid,n))return false;
  this.positions.set(positions);this.predicted.set(predicted);this.cells.set(grid.particleCell);this.phase.set(grid.phase);this.indices.fill(-1,0,n*24);
  for(const f of grid.faces){this[f.axis+'before'].fill(0);this[f.axis+'weight'].fill(0);}
  const o=this.offsets;this.instance.exports.scatter(n,o.positions,o.predicted,o.cells,o.phase,o.indices,o.weights,o.config,o.faces,dt,scale);
  grid.stencilIndices=this.indices.subarray(0,n*24);grid.stencilWeights=this.weights.subarray(0,n*24);
  for(const f of grid.faces){f.before.set(this[f.axis+'before']);f.weight.set(this[f.axis+'weight']);}
  this.scattered=positions;this.prediction=predicted;return true;
 }
 gather(grid,positions,predicted,dt,scale,spacing){
  // Reference scatter or a reset can intervene; never consume stale stencils.
  if(this.scattered!==positions||this.prediction!==predicted||this.grid!==grid)return null;
  for(const f of grid.faces){this[f.axis+'before'].set(f.before);this[f.axis+'velocity'].set(f.velocity);}
  const o=this.offsets,n=positions.length/4;grid.coupled=this.instance.exports.gather(n,o.positions,o.predicted,o.cells,o.phase,o.indices,o.weights,o.faces,o.result,dt,scale,spacing);
  return this.result.slice(0,n*4);
 }
}
