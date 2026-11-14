import {BeachFieldGrid,WATER,AIR} from '../grid.js';
import {MATERIAL,humidityAtRH} from '../../../fluid-fields/model.js';
let module;
export async function setBatchKernel(bytes){
 const candidate=await WebAssembly.compile(bytes),exports=new Set(WebAssembly.Module.exports(candidate).map(e=>e.name));
 if(!['memory','faces','air','scalars'].every(name=>exports.has(name)))throw Error('Incomplete CPU grid kernel');
 module=candidate;
}
export const batchKernelReady=typeof window==='undefined'?Promise.resolve(false):fetch(new URL('./grid.wasm',import.meta.url)).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}).then(setBatchKernel).then(()=>true).catch(()=>false);

class FaceBatch {
 constructor(grid){
  this.instance=new WebAssembly.Instance(module,{});let bytes=65536;const layout={};
  const reserve=(name,count,Type=Float64Array)=>{bytes=Math.ceil(bytes/8)*8;layout[name]={offset:bytes,count,Type};bytes+=count*Type.BYTES_PER_ELEMENT;};
  reserve('table',51,Int32Array);reserve('config',9);reserve('phase',grid.count,Uint8Array);
  reserve('airVelocity',grid.count*3);reserve('airValid',grid.count,Uint8Array);
  for(const key of ['temperature','humidity','heat','vapour','dilation'])reserve(key,grid.count);
  reserve('ledger',4);reserve('materials',9);
  for(const f of grid.faces){const axis=f.axis,n=f.velocity.length;for(const key of ['before','weight','velocity','coefficient','prior','target','delta'])reserve(axis+key,n);for(const key of ['a','b'])reserve(axis+key,n,Int32Array);reserve(axis+'valid',n,Uint8Array);reserve(axis+'advectionIndices',n*12,Int32Array);reserve(axis+'advectionWeights',n*12);reserve(axis+'position',n*3);}
  const memory=this.instance.exports.memory,pages=Math.ceil(bytes/65536);if(memory.buffer.byteLength<pages*65536)memory.grow(pages-memory.buffer.byteLength/65536);
  this.offsets={};for(const [name,{offset,count,Type}] of Object.entries(layout)){this.offsets[name]=offset;this[name]=new Type(memory.buffer,offset,count);}
  this.config.set([...grid.origin,...grid.cellSize,...grid.dims]);
  for(const phase of [WATER,AIR])this.materials.set([MATERIAL[phase].density,MATERIAL[phase].heatCapacity,MATERIAL[phase].conductivity],phase*3);
  for(const f of grid.faces){const axis=f.axis,o=this.offsets;this.table.set([...f.dims,f.velocity.length,...['a','b','before','weight','velocity','coefficient','valid','advectionIndices','advectionWeights','prior','target','delta','position'].map(k=>o[axis+k])],axis*17);for(const k of ['a','b','advectionIndices','advectionWeights'])this[axis+k].set(f[k]);for(let i=0;i<f.position.length;i++)this[axis+'position'].set(f.position[i],i*3);}
  this.cellPositions=grid.coords.map((_,i)=>grid.position(i));this.nextPhase=new Uint8Array(grid.count);this.bytes=bytes;
 }
 update(grid,dt,wind,wall){
  this.phase.set(grid.phase);const limit=grid.h*.42/dt;
  for(const f of grid.faces){const axis=f.axis;for(const k of ['before','weight','velocity','coefficient'])this[axis+k].set(f[k]);
   const target=this[axis+'target'];for(let i=0;i<f.velocity.length;i++){
    if(!f.coefficient[i])target[i]=f.wall[i]=Math.max(-limit,Math.min(limit,wall(f.position[i])[axis]));
    else if(grid.phase[f.a[i]]!==WATER&&grid.phase[f.b[i]]!==WATER)target[i]=wind(f.position[i])[axis];
   }
  }
  const o=this.offsets;this.instance.exports.faces(o.table,o.phase,o.config,dt,grid.h,1-Math.exp(-dt*2),MATERIAL[WATER].viscosity,MATERIAL[AIR].viscosity);
  for(const f of grid.faces){f.before.set(this[f.axis+'before']);f.velocity.set(this[f.axis+'velocity']);(f.valid??=new Uint8Array(f.velocity.length)).set(this[f.axis+'valid']);}
 }
 sync(grid){this.phase.set(grid.phase);for(const f of grid.faces){this[f.axis+'velocity'].set(f.velocity);this[f.axis+'coefficient'].set(f.coefficient);}}
 air(grid){
  this.sync(grid);const o=this.offsets;this.instance.exports.air(o.table,o.phase,o.config,o.airVelocity,o.airValid);
  (grid.airVelocity??=new Float64Array(grid.count*3)).set(this.airVelocity);(grid.airValid??=new Uint8Array(grid.count)).set(this.airValid);
 }
 transport(grid,dt){
  this.sync(grid);this.temperature.set(grid.temperature);this.humidity.set(grid.humidity);
  const keys=['boundaryHeat','boundaryVapour','remapHeat','remapVapour'];for(let i=0;i<4;i++)this.ledger[i]=grid.ledger[keys[i]];
  const o=this.offsets,steps=this.instance.exports.scalars(o.table,o.phase,o.config,o.materials,o.temperature,o.humidity,o.heat,o.vapour,o.dilation,o.ledger,dt,grid.volume,humidityAtRH(.55,293.15));
  if(steps<0)throw Error('Field scalar CFL budget exceeded');
  grid.temperature.set(this.temperature);grid.humidity.set(this.humidity);for(let i=0;i<4;i++)grid.ledger[keys[i]]=this.ledger[i];grid.time+=dt;
 }
}

export function batchedDeposit(positions,predicted,dt,scale,spacing,solid,wind,wall=()=>[0,0,0]){
 // CPU particle ownership is unchanged. If either compiled kernel is absent,
 // run the unmodified reference before changing any field/thermal state.
 const n=positions.length/4;
 if(!module||!this.nativeTransfer?.allocate(this,n))return BeachFieldGrid.prototype.deposit.call(this,positions,predicted,dt,scale,spacing,solid,wind,wall);
 const batch=this.faceBatch??=new FaceBatch(this),phase=batch.nextPhase,mass=this.fill;mass.fill(0);
 if(this.particleCell?.length!==n)this.particleCell=new Int32Array(n);
 const parcelVolume=(spacing*scale)**3/this.volume;
 for(let i=0;i<n;i++){const o=i*4,c=this.particleCell[i]=this.cellXYZ(positions[o]*scale,positions[o+1]*scale,positions[o+2]*scale);if(c>=0&&!positions[o+3])mass[c]+=parcelVolume;}
 for(let i=0;i<this.count;i++)phase[i]=mass[i]>.25?WATER:solid(batch.cellPositions[i])<0?0:AIR;
 this.setPhase(phase);
 this.nativeTransfer.scatter(this,positions,predicted,dt,scale);
 batch.update(this,dt,wind,wall);
 return this.rhs();
}

export function batchedAir(){if(!module)return BeachFieldGrid.prototype.buildAirVelocity.call(this);(this.faceBatch??=new FaceBatch(this)).air(this);}
export function batchedTransport(dt){if(!module)return BeachFieldGrid.prototype.transport.call(this,dt);(this.faceBatch??=new FaceBatch(this)).transport(this,dt);}

// Only the live application installs this. Historical tests retain their
// original grid methods; toggling or resetting never leaves stale inputs.
export function installFieldBatch(lab){
 const fields=lab.bulkFields;if(!fields)return;lab.optimizations.fieldBatch??=true;
 const configure=fields.configureTopology;
 fields.configureTopology=g=>{configure?.(g);const active=lab.optimizations.fieldBatch!==false;g.deposit=active?batchedDeposit:BeachFieldGrid.prototype.deposit;g.buildAirVelocity=active?batchedAir:BeachFieldGrid.prototype.buildAirVelocity;g.transport=active?batchedTransport:BeachFieldGrid.prototype.transport;};
 if(fields.grid)fields.configureTopology(fields.grid);
}
