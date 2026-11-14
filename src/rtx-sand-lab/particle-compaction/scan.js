// Rendering-only stable stream compaction. Every surviving slot keeps its
// original ID and ordering. No camera-dependent simulation or count readback.
import {wait} from '../fields/particles/pipeline.js';
export const MAX_SLOTS=65536, GROUP_SIZE=256;
export function activeSlot(kind,id,state,velocity=state){
 const cell=kind==='sea'?id>>1:id,o=cell*4;
 if(kind==='sea')return !(state[o+(id&1)]<=Math.fround(.02)); // conservative: final shader retains its exact threshold
 if(kind==='grain')return !(state[o+3]<=0||state[o+3]>=velocity[o+3]);
 if(kind==='fine')return !(state[o+3]<0);
 throw Error('Unknown particle kind');
}
export function compactReference(kind,count,state,velocity=state){
 if(!Number.isInteger(count)||count<0||count>MAX_SLOTS)throw Error('Particle compaction capacity exceeded');
 return Uint32Array.from(Array.from({length:count},(_,i)=>i).filter(i=>activeSlot(kind,i,state,velocity)));
}
export function scanShader(kind){
 if(!['sea','grain','fine'].includes(kind))throw Error('Unknown particle kind');
 const active=kind==='sea'?`let cell=id/2u;let value=textureLoad(state,vec2i(i32(cell%params.width),i32(cell/params.width)),0);return !(value[id%2u]<=0.02);`:kind==='grain'?`let uv=vec2i(i32(id%params.width),i32(id/params.width));let life=textureLoad(state,uv,0).w;return !(life<=0.0||life>=textureLoad(velocity,uv,0).w);`:`return !(textureLoad(state,vec2i(i32(id%params.width),i32(id/params.width)),0).w<0.0);`;
 return `struct Params { count:u32, width:u32, groups:u32, unused:u32 };
@group(0) @binding(0) var state:texture_2d<f32>;
@group(0) @binding(1) var velocity:texture_2d<f32>;
@group(0) @binding(2) var<uniform> params:Params;
@group(0) @binding(3) var<storage,read_write> prefix:array<u32>;
@group(0) @binding(4) var<storage,read_write> totals:array<u32>;
@group(0) @binding(5) var<storage,read_write> offsets:array<u32>;
@group(0) @binding(6) var<storage,read_write> ids:array<f32>;
@group(0) @binding(7) var<storage,read_write> indirect:array<u32>;
var<workgroup> scan:array<u32,256>;
fn keepSlot(id:u32)->bool { ${active} }
fn inclusive(lane:u32) {
 for(var stride=1u;stride<256u;stride*=2u){
  workgroupBarrier();var before=0u;if(lane>=stride){before=scan[lane-stride];}
  workgroupBarrier();scan[lane]+=before;
 }
 workgroupBarrier();
}
@compute @workgroup_size(256) fn local(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
 let id=gid.x;var keep=0u;if(id<params.count){keep=select(0u,1u,keepSlot(id));}scan[lane]=keep;inclusive(lane);
 if(id<params.count){prefix[id]=select(0u,scan[lane],keep!=0u);}if(lane==255u){totals[group.x]=scan[255];}
}
@compute @workgroup_size(256) fn blocks(@builtin(local_invocation_index) lane:u32){
 var value=0u;if(lane<params.groups){value=totals[lane];}scan[lane]=value;inclusive(lane);
 if(lane<params.groups){offsets[lane]=scan[lane]-value;}
 if(lane==255u){indirect[0]=6u;indirect[1]=scan[255];indirect[2]=0u;indirect[3]=0u;indirect[4]=0u;}
}
@compute @workgroup_size(256) fn scatter(@builtin(global_invocation_id) gid:vec3u){
 let id=gid.x;if(id>=params.count){return;}let rank=prefix[id];if(rank>0u){ids[offsets[id/256u]+rank-1u]=f32(id);}
}`;
}
export class ActiveList {
 constructor(renderer,kind,capacity){
  if(!Number.isInteger(capacity)||capacity<1||capacity>MAX_SLOTS)throw Error('Particle compaction capacity exceeded');
  this.renderer=renderer;this.device=renderer.device;this.kind=kind;this.capacity=capacity;this.buffers=[];
  const make=(size,usage)=>{const b=renderer.createBuffer({label:'active '+kind,size,usage});this.buffers.push(b);return b;};
  this.params=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  this.prefix=make(capacity*4,GPUBufferUsage.STORAGE);
  this.totals=make(1024,GPUBufferUsage.STORAGE);this.offsets=make(1024,GPUBufferUsage.STORAGE);
  this.ids=make(capacity*4,GPUBufferUsage.STORAGE|GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_SRC);
  this.indirect=make(20,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC);
 }
 async prepare(){
  const d=this.device;d.pushErrorScope('validation');
  try{
   this.layout=d.createBindGroupLayout({entries:[0,1].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}})).concat([{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}],...[3,4,5,6,7].map(binding=>[{binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]))});
   const layout=d.createPipelineLayout({bindGroupLayouts:[this.layout]}),module=d.createShaderModule({label:'stable '+this.kind+' compaction',code:scanShader(this.kind)});this.pipelines=[];
   for(const entryPoint of ['local','blocks','scatter'])this.pipelines.push(await wait(d.createComputePipelineAsync({label:this.kind+' '+entryPoint,layout,compute:{module,entryPoint}}),30000,'Particle compaction compile'));
  }finally{const error=await d.popErrorScope();if(error)throw Error(error.message);}
 }
 enqueue(state,velocity,count){
  if(!this.pipelines)throw Error('Compaction was not prepared');
  if(this.pending)throw Error('An active-list draw is already queued; flush before reusing it');
  if(!Number.isInteger(count)||count<0||count>this.capacity)throw Error('Particle compaction capacity exceeded');
  const groups=Math.ceil(count/GROUP_SIZE),data=new Uint32Array([count,state.width,groups,0]);
  const entries=[state.view,(velocity||state).view,...[this.params,this.prefix,this.totals,this.offsets,this.ids,this.indirect].map(buffer=>({buffer}))].map((resource,binding)=>({resource,binding}));
  const bind=this.device.createBindGroup({layout:this.layout,entries});
  this.pending=true;
  this.renderer.commands.push({type:'compute',encode:(encoder,timestamps=()=>undefined)=>{
   this.pending=false;
   this.device.queue.writeBuffer(this.params,0,data);
   for(let i=0;i<3;i++){const label=this.kind+' active '+i,pass=encoder.beginComputePass({label,timestampWrites:timestamps(label)});pass.setPipeline(this.pipelines[i]);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(i===1?1:Math.max(1,groups));pass.end();}
  }});
  this.lastCount=count;
 }
 dispose(){if(this.pending||this.renderer.flushing)throw Error('Flush active-list work before disposal');for(const b of this.buffers)this.renderer.destroyResource(b);this.buffers=[];}
}
