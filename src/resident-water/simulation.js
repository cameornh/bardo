import {ParticlePipeline,wait} from '../rtx-sand-lab/fields/particles/pipeline.js';
import {RESIDENT_WGSL} from './compute.js';
import {LIMITS,gridPlan,parameters,outputState} from './model.js';

export class ResidentSimulation extends ParticlePipeline {
 async initialize(gpu){
  await super.initialize(gpu);const d=this.device;
  try{
   const module=d.createShaderModule({label:'resident MAC kernels',code:RESIDENT_WGSL});
   const info=await wait(module.getCompilationInfo(),5000,'Resident kernels');const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.lineNum+': '+e.message).join('\n'));
   this.residentLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},...Array.from({length:6},(_,i)=>({binding:i+1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}))]});
   const layout=d.createPipelineLayout({bindGroupLayouts:[this.residentLayout]});this.residentPipelines={};
   for(const entryPoint of ['predict','classify','stencils','deposit','rhs','pressureA','pressureB','project'])this.residentPipelines[entryPoint]=await wait(d.createComputePipelineAsync({label:'resident-'+entryPoint,layout,compute:{module,entryPoint}}),5000,entryPoint);
   return this;
  }catch(e){this.dispose();throw e;}
 }
 load(f){
  if(this.busy)throw Error('Cannot reset during submitted work');if(f.positions.length<4||f.positions.length%4||f.positions.length/4>LIMITS.particles)throw Error('Resident capacity exceeded');if(f.positions.length!==f.velocities.length||f.chem.length!==f.positions.length||![...f.positions,...f.velocities,...f.chem,...f.geometry].every(Number.isFinite)||!(f.dt>0&&f.dt<=1/15))throw Error('Invalid resident input');
  this.fixture=f;this.gridPlan=gridPlan(f);this.time=0;this.steps=0;const g=this.gridPlan,d=this.device,U=GPUBufferUsage,n=f.positions.length/4;
  const b=(key,size,usage=U.STORAGE|U.COPY_SRC|U.COPY_DST)=>this.buffer(key,size,usage);
  const buffers=[b('config',128,U.UNIFORM|U.COPY_DST),b('input',n*68*4),b('field',(g.geometryOffset+f.geometry.length)*4),b('work',n*64),b('counts',8193*4),b('buckets',8192*64*4),b('neighbors',n*129*4),b('output',n*80)];
  d.queue.writeBuffer(buffers[0],0,parameters(f,g));d.queue.writeBuffer(buffers[2],g.geometryOffset*4,f.geometry);d.queue.writeBuffer(buffers[7],0,outputState(f));
  this.particleBind=d.createBindGroup({layout:this.layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  this.gridCounts=b('gridCounts',(g.count+1)*4);this.gridSlots=b('gridSlots',g.count*LIMITS.slots*4);this.gridValues=b('gridValues',g.count*4*4);
  this.residentBind=d.createBindGroup({layout:this.residentLayout,entries:[buffers[0],buffers[1],buffers[2],buffers[7],this.gridCounts,this.gridSlots,this.gridValues].map((buffer,binding)=>({binding,resource:{buffer}}))});
  d.queue.writeBuffer(buffers[4],8192*4,new Uint32Array([0]));this.health=b('health',16,U.COPY_DST|U.MAP_READ);this.state=buffers[7];this.particleBuffers=buffers;this.bytes=Object.values(this.buffers).reduce((n,b)=>n+b.size,0);this.runtimeReadbackBytes=0;
 }
 encode(encoder,wind=0){
  if(!(this.batchSteps>=0&&this.batchSteps<3))throw Error('Resident submission exceeds three-step budget');
  if(this.disabled)throw Error(this.failure||'Resident GPU disabled');const n=this.fixture.positions.length/4,g=this.gridPlan;
  // Wind is a control uniform; particle/field state is never uploaded again.
  this.device.queue.writeBuffer(this.buffers.config,120,new Float32Array([wind,this.time]));
  encoder.clearBuffer(this.gridCounts);encoder.clearBuffer(this.buffers.counts);
  const dispatch=(name,count)=>{const pass=encoder.beginComputePass({label:name});pass.setPipeline(this.residentPipelines[name]);pass.setBindGroup(0,this.residentBind);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();};
  dispatch('predict',n);dispatch('classify',g.count);dispatch('stencils',n);dispatch('deposit',g.faces);dispatch('rhs',g.count);
  for(let i=0;i<LIMITS.iterations/2;i++){dispatch('pressureA',g.count);dispatch('pressureB',g.count);}dispatch('project',g.faces);
  encoder.copyBufferToBuffer(this.gridCounts,g.count*4,this.buffers.counts,8192*4,4);
  for(const pipeline of this.pipelines){const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,this.particleBind);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();}
  // Preserve every step's fault until the fence is inspected. A later step
  // must not erase an overflow that occurred earlier in this submission.
  encoder.copyBufferToBuffer(this.buffers.counts,8192*4,this.health,this.batchSteps*4,4);this.batchSteps++;
  this.time+=this.fixture.dt;this.steps++;
 }
 async submit(encode){
  if(this.busy)throw Error('Only one resident job may be outstanding');if(this.disabled)throw Error(this.failure||'GPU stopped');this.busy=true;
  try{const encoder=this.device.createCommandEncoder();this.batchSteps=0;encoder.clearBuffer(this.health);encode(encoder);if(!this.batchSteps)encoder.copyBufferToBuffer(this.buffers.counts,8192*4,this.health,0,4);this.device.queue.submit([encoder.finish()]);await wait(this.health.mapAsync(GPUMapMode.READ),LIMITS.timeout,'Resident frame');const fault=new Uint32Array(this.health.getMappedRange()).reduce((a,b)=>a|b,0);this.health.unmap();if(fault)throw Error('Capacity guard stopped resident simulation: '+fault);if(this.disabled)throw Error(this.failure);}
  catch(e){this.failure=e.message;this.dispose();throw e;}finally{this.busy=false;}
 }
 // Explicit checkpoint only: the frame loop never maps particle/grid buffers.
 async snapshot(){
  if(this.busy)throw Error('Wait for frame completion before diagnostics');const d=this.device,U=GPUBufferUsage,g=this.gridPlan;
  const n=this.fixture.positions.length/4,bytes=n*80+16+g.count*16+g.faces*16;
  const read=d.createBuffer({size:bytes,usage:U.COPY_DST|U.MAP_READ});const e=d.createCommandEncoder();e.copyBufferToBuffer(this.state,0,read,16,n*80);e.copyBufferToBuffer(this.buffers.counts,8192*4,read,0,4);e.copyBufferToBuffer(this.gridValues,0,read,16+n*80,g.count*16);e.copyBufferToBuffer(this.buffers.field,0,read,16+n*80+g.count*16,g.faces*16);d.queue.submit([e.finish()]);
  try{await wait(read.mapAsync(GPUMapMode.READ),LIMITS.timeout,'Resident checkpoint');const range=read.getMappedRange();return {fault:new Uint32Array(range,0,1)[0],state:new Float32Array(range,16,n*20).slice(),grid:new Float32Array(range,16+n*80,g.count*4).slice(),faces:new Float32Array(range,16+n*80+g.count*16,g.faces*4).slice()};}finally{read.unmap();read.destroy();}
 }
}
