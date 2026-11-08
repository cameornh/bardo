import {PARTICLE_WGSL} from './shaders.js';
import {NativeDensity,nativeDensityAvailable} from '../../../sand-lab/native-density.js';
import {physicalCoefficients,WATER_SURFACE_TENSION,WATER_DENSITY} from '../../../sand-lab/water-lab-transport.js';
import {WATER} from '../grid.js';
export const PARTICLE_LIMITS=Object.freeze({particles:32768,buckets:8192,bucketSlots:64,neighbors:128,bodies:32,parcelsPerCell:32,cuts:16,geometryFloats:1048576,contactWork:500000,waitMs:2000,stepMs:150});
export function validateParticleInput(context,lab,grid){
 const n=context.old.length/4;
 if(!Number.isInteger(n)||n<1||n>PARTICLE_LIMITS.particles)throw Error('Particle compute capacity exceeded');
 if(context.predicted.length!==n*4||lab.velocities.length!==n*4||lab.chem.length!==n*4||grid.stencilIndices?.length!==n*24||grid.stencilWeights?.length!==n*24)throw Error('Particle compute input size mismatch');
 if(!(context.s>0&&context.scale>0&&context.dt>0&&context.dt<=.15))throw Error('Invalid particle timestep or scale');
 for(const data of [context.old,context.predicted,lab.velocities,lab.chem])for(let i=0;i<data.length;i++)if(!Number.isFinite(data[i]))throw Error('Non-finite particle input');
 if(lab.balls.length>PARTICLE_LIMITS.bodies||lab.sand.n>512)throw Error('Geometry exceeds bounded GPU contact budget');
 const bins=lab.u.uSandBins.value.image.data,parcels=lab.sandRenderParcels||[];
 let maxCell=0;for(let i=0;i<1024;i++)maxCell=Math.max(maxCell,bins[i*4+1]);
 if(maxCell>PARTICLE_LIMITS.parcelsPerCell)throw Error('Edited sand requires CPU contacts');
 if(parcels.some(p=>(p.cuts?.length||0)>PARTICLE_LIMITS.cuts))throw Error('Carved sand requires CPU contacts');
 const cuts=parcels.reduce((m,p)=>Math.max(m,p.cuts?.length||0),0);if(n*(1+2*lab.balls.length+maxCell*(1+cuts))>PARTICLE_LIMITS.contactWork)throw Error('Contact workload requires CPU fallback');
 return n;
}
export function packParticles(context,lab,grid,geometry){
 const n=validateParticleInput(context,lab,grid),input=new Float32Array(n*68),config=new Float32Array(32),faceOffsets=[];
 let length=0;for(const f of grid.faces){faceOffsets.push(length);length+=f.velocity.length;}
 const bandOffset=length*4,geometryOffset=bandOffset+grid.count,field=new Float32Array(geometryOffset+geometry.length);
 if(geometry.length>PARTICLE_LIMITS.geometryFloats||!geometry.every(Number.isFinite))throw Error('Invalid GPU collision geometry');
 const band=new Uint8Array(grid.count);for(let i=0;i<grid.count;i++)if(grid.phase[i]!==WATER)band[i]=1;
 for(let axis=0;axis<3;axis++){const f=grid.faces[axis];for(let k=0;k<f.a.length;k++){
  const a=f.a[k],b=f.b[k],at=(faceOffsets[axis]+k)*4;field[at]=f.velocity[k];field[at+1]=f.before[k];field[at+2]=grid.phase[a]===WATER||grid.phase[b]===WATER?1:0;
  if(grid.phase[a]!==WATER&&b>=0)band[b]=1;if(grid.phase[b]!==WATER&&a>=0)band[a]=1;
 }}field.set(band,bandOffset);field.set(geometry,geometryOffset);
 let coupled=0;
 for(let i=0;i<n;i++){const o=i*68;for(let k=0;k<4;k++){const at=i*4+k;input[o+k]=context.old[at];input[o+4+k]=context.predicted[at];input[o+8+k]=lab.velocities[at];input[o+12+k]=lab.chem[at];}
  for(let axis=0;axis<3;axis++)for(let k=0;k<8;k++){const at=i*24+axis*8+k,j=grid.stencilIndices[at];input[o+16+axis*8+k]=j<0?-1:j+faceOffsets[axis];input[o+40+axis*8+k]=grid.stencilWeights[at];}
  const cell=grid.particleCell[i];if(!context.old[i*4+3]&&cell>=0&&grid.phase[cell]===WATER){input[o+64]=1;coupled++;}
 }
 const coeff=physicalCoefficients(context.s,context.scale,context.dt);
 config.set([n,context.s,context.scale,context.dt,1-Math.exp(-context.dt*1.5),coeff.viscosity,coeff.capillary,WATER_SURFACE_TENSION/WATER_DENSITY,...grid.origin,0,...grid.cellSize,0,geometryOffset,bandOffset,0,0,...grid.dims,0]);
 for(let i=0;i<field.length;i++)if(!Number.isFinite(field[i]))throw Error('Non-finite field transfer input');
 for(let i=0;i<input.length;i++)if(!Number.isFinite(input[i]))throw Error('Non-finite field transfer input');
 grid.coupled=coupled;return {n,input,config,field};
}
export function unpackParticles(data,n){
 if(data.length!==n*20)throw Error('Invalid GPU particle result');for(let i=0;i<data.length;i++)if(!Number.isFinite(data[i]))throw Error('Invalid GPU particle result');
 const positions=new Float32Array(n*4),velocities=positions.slice(),chem=positions.slice(),metrics=positions.slice(),counts=new Uint16Array(n),activity=new Float32Array(n*2),breakup=new Float32Array(n);
 for(let i=0;i<n;i++){const at=i*20,o=i*4;for(let k=0;k<4;k++){positions[o+k]=data[at+k];velocities[o+k]=data[at+4+k];chem[o+k]=data[at+8+k];metrics[o+k]=data[at+12+k];}counts[i]=data[at+16];activity[i*2]=data[at+17];activity[i*2+1]=data[at+18];breakup[i]=data[at+19];}
 return {positions,transport:{velocities,chem,metrics,counts,activity,breakup}};
}
export const wait=(promise,ms,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded time budget')),ms);})]).finally(()=>clearTimeout(timer));};
export class ParticlePipeline {
 constructor(){this.buffers={};this.validated=false;this.disabled=false;this.busy=false;}
 async initialize(gpu=globalThis.navigator?.gpu){
  if(!gpu)throw Error('WebGPU unavailable; CPU particle pipeline remains active');
  const adapter=await wait(gpu.requestAdapter({powerPreference:'high-performance'}),3000,'WebGPU adapter');if(!adapter)throw Error('No WebGPU adapter');
  this.adapter={vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device,description:adapter.info?.description};
  const request=adapter.requestDevice();let expired=false;request.then(d=>{if(expired)d.destroy();},()=>{});
  try{this.device=await wait(request,3000,'WebGPU device');}catch(e){expired=true;throw e;}
  const d=this.device;d.lost.then(info=>{this.disabled=true;this.failure=info.message||'WebGPU device closed';});d.addEventListener('uncapturederror',e=>{this.disabled=true;this.failure=e.error.message;});
  d.pushErrorScope('validation');
  try{
   const module=d.createShaderModule({label:'bounded beach particle kernels',code:PARTICLE_WGSL});const info=await wait(module.getCompilationInfo(),5000,'Particle shader compilation');const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.lineNum+': '+e.message).join('\n'));
   const entries=[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},...Array.from({length:7},(_,i)=>({binding:i+1,visibility:GPUShaderStage.COMPUTE,buffer:{type:i<2?'read-only-storage':'storage'}}))];
   this.layout=d.createBindGroupLayout({entries});const layout=d.createPipelineLayout({bindGroupLayouts:[this.layout]});this.pipelines=[];
   for(const entryPoint of ['gather','findNeighbors','density','collide','transport'])this.pipelines.push(await wait(d.createComputePipelineAsync({label:entryPoint,layout,compute:{module,entryPoint}}),5000,entryPoint+' compilation'));
   const error=await d.popErrorScope();if(error)throw Error(error.message);
  }catch(e){this.dispose();throw e;}
  return this;
 }
 buffer(name,size,usage){size=Math.max(16,Math.ceil(size/16)*16);let b=this.buffers[name];if(!b||b.size<size){b?.destroy();b=this.device.createBuffer({label:name,size,usage});this.buffers[name]=b;}return b;}
 geometry(lab){
  if(!nativeDensityAvailable())throw Error('CPU collision reference still preparing');lab.syncSandUniforms();const parcels=lab.sandRenderParcels||[],extra=parcels.length?lab.u.uSandBins.value.image.data.length+parcels.reduce((v,p)=>v+8+(p.cuts?.length||0)*5,0):0;
  const size=32+lab.sand.n**2+lab.balls.length*16+1024+extra;if(size>PARTICLE_LIMITS.geometryFloats)throw Error('Geometry budget exceeded');
  const kernel=this.geometryKernel??=new NativeDensity();kernel.allocate(1,size);kernel.prepareGeometry(lab,parcels.length>0);return Float32Array.from(kernel.geometry.subarray(0,size));
 }
 async solve(context,lab,grid,{geometry=null,debug=false,connected=null}={}){
  if(this.disabled||!this.device)throw Error(this.failure||'Particle GPU is unavailable');if(this.busy)throw Error('Only one particle job may be in flight');
  if(!this.warmed&&context.old.length/4>64)throw Error('Run the small verification fixture before particle playback');
  this.busy=true;const start=performance.now();let submitted=false;
  try{
   const packed=connected?connected.pack(context,lab,grid,geometry||this.geometry(lab)):packParticles(context,lab,grid,geometry||this.geometry(lab)),{n,input,config,field}=packed,d=this.device,U=GPUBufferUsage,capacity=PARTICLE_LIMITS.particles;
   // Stable binding sizes keep rain, tides and resets from reallocating shader
   // storage during playback. Storage is bounded (35.5 MiB plus readback).
   if(field.length>PARTICLE_LIMITS.geometryFloats+65536)throw Error('Field upload exceeds GPU capacity');
   const buffers=[this.buffer('config',128,U.UNIFORM|U.COPY_DST),this.buffer('input',capacity*68*4,U.STORAGE|U.COPY_DST),this.buffer('field',(PARTICLE_LIMITS.geometryFloats+65536)*4,U.STORAGE|U.COPY_DST|U.COPY_SRC),this.buffer('work',capacity*64,U.STORAGE|U.COPY_SRC),this.buffer('counts',8193*4,U.STORAGE|U.COPY_DST|U.COPY_SRC),this.buffer('buckets',8192*64*4,U.STORAGE),this.buffer('neighbors',capacity*129*4,U.STORAGE|U.COPY_SRC),this.buffer('output',capacity*80,U.STORAGE|U.COPY_SRC)];
   if(debug&&n>1024)throw Error('Debug readback budget exceeded');const extraOffset=n*80+16+(debug?n*(64+516):0),read=this.buffer('readback',extraOffset+(connected?.extraBytes||0),U.COPY_DST|U.MAP_READ);d.queue.writeBuffer(buffers[0],0,config);if(!connected)d.queue.writeBuffer(buffers[1],0,input);d.queue.writeBuffer(buffers[2],0,field);
   const bind=d.createBindGroup({layout:this.layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});const encoder=d.createCommandEncoder();encoder.clearBuffer(buffers[4]);if(connected)connected.encode(encoder,buffers);
   for(const pipeline of this.pipelines){const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();}
   encoder.copyBufferToBuffer(buffers[7],0,read,16,n*80);encoder.copyBufferToBuffer(buffers[4],8192*4,read,0,4);if(debug){encoder.copyBufferToBuffer(buffers[3],0,read,16+n*80,n*64);encoder.copyBufferToBuffer(buffers[6],0,read,16+n*144,n*516);}if(connected)connected.copy(encoder,buffers,read,extraOffset);const dispatch=performance.now();d.queue.submit([encoder.finish()]);submitted=true;
   await wait(read.mapAsync(GPUMapMode.READ),PARTICLE_LIMITS.waitMs,'Particle pipeline');const mapped=read.getMappedRange(),overflow=new Uint32Array(mapped,0,1)[0],data=new Float32Array(mapped,16,n*20).slice();const intermediate=debug?{work:new Float32Array(mapped,16+n*80,n*16).slice(),neighbors:new Uint32Array(mapped,16+n*144,n*129).slice()}:null;let fieldResult;try{fieldResult=connected?.result(mapped,extraOffset);}finally{read.unmap();}
   this.stats={backend:'WebGPU particle transfer / neighbors / contacts / transport',adapter:this.adapter,packMs:dispatch-start,waitMs:performance.now()-dispatch,totalMs:performance.now()-start,readbackBytes:n*80+4+(connected?.extraBytes||0),particles:n,warmup:!this.warmed};
   if(overflow)throw Error(overflow===1?'GPU spatial bucket full; exact CPU fallback':'GPU neighbor list full; exact CPU fallback');
   if(this.disabled)throw Error(this.failure||'GPU particle device failed');const unpackStart=performance.now(),result=unpackParticles(data,n);this.stats.unpackMs=performance.now()-unpackStart;this.stats.totalMs=performance.now()-start;this.stats.storageBytes=buffers.reduce((s,b)=>s+b.size,0);this.slowJobs=this.warmed&&this.stats.waitMs>PARTICLE_LIMITS.stepMs?(this.slowJobs||0)+1:0;if(this.slowJobs>=3){this.disabled=true;this.failure='GPU particle jobs exceeded the throughput budget';}
   this.warmed=true;return {...result,intermediate,fieldResult,stats:this.stats};
  }catch(e){if(submitted&&!/bucket full|neighbor list full|requires CPU fallback/.test(e.message)){this.failure=e.message;this.dispose();}throw e;}finally{this.busy=false;}
 }
 dispose(){this.disabled=true;for(const b of Object.values(this.buffers))b.destroy();this.buffers={};this.device?.destroy();this.device=null;}
}
