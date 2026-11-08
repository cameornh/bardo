import {ConnectedFields,ConnectedPipeline} from '../connected/pipeline.js';
import {LOCAL_PRESSURE_WGSL} from '../research/local-pressure.js';
import {wait,unpackParticles,PARTICLE_LIMITS} from '../particles/pipeline.js';
import {WaterStateJournal,decodeWaterMirror} from './journal.js';
import {RESIDENT_WATER_WGSL} from './shaders.js';
import {waterWindDrag} from '../../../sand-lab/wind-response.js';
import {LocalPressurePipeline} from '../research/local-pressure.js';
import {verifyResident} from './verify.js';

const sourceCopy='for(var k=0u;k<16u;k++){input[o+k]=faceData[F()*16u+i*17u+k];}input[o+64u]=faceData[F()*16u+i*17u+16u];';
const residentCopy=`if(c[6].w<.5){${sourceCopy}}else{input[o+64u]=faceData[F()*16u+i];}`;

if(!LOCAL_PRESSURE_WGSL.includes(sourceCopy))throw Error('Resident stencil integration no longer matches connected solver');
export const RESIDENT_CONNECTED_WGSL=LOCAL_PRESSURE_WGSL.replace(sourceCopy,residentCopy);
class ResidentFields extends ConnectedFields {
 constructor(p){super(p,RESIDENT_CONNECTED_WGSL);this.journal=new WaterStateJournal();}
 async initialize(){
  await super.initialize();const d=this.particles.device;d.pushErrorScope('validation');
  const module=d.createShaderModule({label:'resident water state',code:RESIDENT_WATER_WGSL});
  const info=await wait(module.getCompilationInfo(),5000,'Resident state compilation'),errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.lineNum+': '+e.message).join('\n'));
  this.stateLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},...Array.from({length:8},(_,i)=>({binding:i+1,visibility:GPUShaderStage.COMPUTE,buffer:{type:[2,3,5,6].includes(i)?'read-only-storage':'storage'}}))]});
  const layout=d.createPipelineLayout({bindGroupLayouts:[this.stateLayout]});this.statePipelines={};
  for(const entryPoint of ['applyEdits','predict','airBase','airFirst','airSecond','publish'])this.statePipelines[entryPoint]=await wait(d.createComputePipelineAsync({label:'water-state-'+entryPoint,layout,compute:{module,entryPoint}}),5000,entryPoint+' compilation');
  const error=await d.popErrorScope();if(error)throw Error(error.message);return this;
 }
 pack(context,lab,grid,geometry){
  this.active=this.particles.residentEnabled();this.lab=lab;
  if(!this.active){this.journal.invalidate();lab.completeWaterPrediction?.(context);}
  this.particlePacker=this.active?(ctx,l,g)=>{this.plan=this.journal.plan(ctx,l,g);return Float32Array.from(g.particleCell,(c,i)=>!ctx.old[i*4+3]&&c>=0&&g.phase[c]===1?1:0);}:null;
  const packed=super.pack(context,lab,grid,geometry);packed.fieldConfig[23]=+this.particles.localEnabled();packed.fieldConfig[27]=+this.active;return packed;
 }
 prepareResident(encoder,buffers,timingBatch){
  if(!this.active)return;
  const p=this.particles,d=p.device,U=GPUBufferUsage,capacity=PARTICLE_LIMITS.particles,{n,patches,changed,reset}=this.plan,g=this.grid,lab=this.lab,ctx=this.context;
  const cfg=new Float32Array(32);cfg.set([n,changed,+!!ctx.predictionDeferred,0,ctx.dt,ctx.s,ctx.scale,lab.time||0,lab.wind||0,lab.windTurbulence??1,lab.jet?.025:waterWindDrag(lab.wind||0,lab.reactiveWaves),+!!lab.reactiveWaves,...g.dims,g.count,...g.origin,0,...g.cellSize,+(!!lab.wind||!!lab.jet),...this.packed.fieldConfig.subarray(16,19),0]);
  const config=p.buffer('waterStateConfig',128,U.UNIFORM|U.COPY_DST),patch=p.buffer('waterStatePatches',capacity*64,U.STORAGE|U.COPY_DST),prediction=p.buffer('waterStatePrediction',capacity*16,U.STORAGE|U.COPY_DST),air=p.buffer('waterStateAir',4096*3*16,U.STORAGE|U.COPY_DST),topo=p.buffer('connectedTopology',200000*4,U.STORAGE|U.COPY_DST),published=p.buffer('waterStatePublished',capacity*80,U.STORAGE|U.COPY_SRC);
  d.queue.writeBuffer(config,0,cfg);if(changed)d.queue.writeBuffer(patch,0,patches);if(!ctx.predictionDeferred)d.queue.writeBuffer(prediction,0,ctx.predicted);
  // Reset/CPU fallback may supply an air field computed outside this pipeline.
  // Normal steps retain the exact GPU air extension, avoiding a lattice upload.
  if(reset){const a=new Float32Array(g.count*4);if(g.airVelocity)for(let i=0;i<g.count;i++){for(let k=0;k<3;k++)a[i*4+k]=g.airVelocity[i*3+k];a[i*4+3]=g.airValid[i];}d.queue.writeBuffer(air,g.count*32,a);}
  this.stateBind=d.createBindGroup({layout:this.stateLayout,entries:[config,buffers[1],buffers[7],patch,prediction,air,buffers[2],topo,published].map((buffer,binding)=>({binding,resource:{buffer}}))});
  this.stateDispatch=(key,n)=>{if(!n)return;const pass=encoder.beginComputePass({timestampWrites:p.timing?.writes(timingBatch,'water-state-'+key)});pass.setPipeline(this.statePipelines[key]);pass.setBindGroup(0,this.stateBind);pass.dispatchWorkgroups(Math.ceil(n/64));pass.end();};
  this.stateDispatch('applyEdits',changed);this.stateDispatch('predict',n);this.published=published;
  this.stateStats={resident:true,gpuPrediction:!!ctx.predictionDeferred,reset,patchedParticles:changed,particleUploadBytes:n*4+patches.byteLength+(ctx.predictionDeferred?0:ctx.predicted.byteLength),airUploadBytes:reset?g.count*16:0,cpuMirrors:true};
 }
 publishResident(){
  if(!this.active)return null;
  for(const key of ['airBase','airFirst','airSecond'])this.stateDispatch(key,this.grid.count);
  this.stateDispatch('publish',this.plan.n);return this.published;
 }
 decodeResident(data,n){
  if(!this.active)return unpackParticles(data,n);
  const result=decodeWaterMirror(data,n);this.journal.commit(data);return result;
 }
}
export class ResidentWaterPipeline extends ConnectedPipeline {
 constructor({residentEnabled=()=>true,localEnabled=()=>true}={}){super();this.residentEnabled=residentEnabled;this.localEnabled=localEnabled;}
 createFields(){return new ResidentFields(this);}
 async verifyState(){
  this.reference=await new LocalPressurePipeline().initialize({device:this.device});
  try{return await verifyResident(this);}catch(e){this.validated=false;throw e;}finally{this.reference.dispose();this.reference=null;}
 }
 async solve(...args){try{const r=await super.solve(...args);if(this.fields.active){Object.assign(r.stats,this.fields.stateStats);r.stats.backend='WebGPU resident water / connected pressure / contacts; CPU feature mirrors';}return r;}catch(e){this.fields.journal.invalidate();throw e;}}
}
