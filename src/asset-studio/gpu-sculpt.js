import {gridSpec,sampleGridCPU} from './sculpt.js';
import {stamp} from './model.js';
export const SCULPT_WGSL=`
struct Config {origin:vec4f,dims:vec4f,batch:vec4f};
struct Stamp {position:vec4f,size:vec4f,extra:vec4f};
@group(0) @binding(0) var<uniform> cfg:Config;
@group(0) @binding(1) var<storage,read> stamps:array<Stamp>;
@group(0) @binding(2) var<storage,read_write> values:array<vec2f>;
fn smin(a:f32,b:f32,k:f32)->f32{if(k<=0.){return min(a,b);}let h=max(0.,k-abs(a-b))/k;return min(a,b)-h*h*k*.25;}
fn sdf(p:vec3f,s:Stamp)->f32{var q=p-s.position.xyz;if(s.size.w==0.){return (length(q/s.size.xyz)-1.)*min(s.size.x,min(s.size.y,s.size.z));}if(s.size.w==2.){q.y-=clamp(q.y,-s.size.y,s.size.y);return length(q)-s.size.x;}let d=abs(q)-s.size.xyz;return length(max(d,vec3f(0)))+min(max(d.x,max(d.y,d.z)),0.);}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=u32(cfg.dims.w)){return;}let nx=u32(cfg.dims.x);let ny=u32(cfg.dims.y);let p=cfg.origin.xyz+vec3f(f32(i%nx),f32((i/nx)%ny),f32(i/(nx*ny)))*cfg.origin.w;var result=vec2f(1e6,0);if(cfg.batch.x>0.){result=values[i];}
 for(var j=u32(cfg.batch.x);j<u32(cfg.batch.y);j++){let s=stamps[j];let d=sdf(p,s);if(s.position.w==2.){if(d<=0.){result.y=f32(j);}}else if(s.position.w==1.){result.x=-smin(-result.x,d,s.extra.x);}else{if(d<result.x){result.y=f32(j);}result.x=smin(result.x,d,s.extra.x);}}values[i]=result;}`;
const bounded=(promise,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label+' timed out; compute stopped')),6000))]).finally(()=>clearTimeout(timer));};
export class SculptGPU{
 async init(){if(!navigator.gpu)throw Error('WebGPU unavailable');const adapter=await bounded(navigator.gpu.requestAdapter({powerPreference:'low-power'}),'GPU adapter');if(!adapter)throw Error('No compute adapter');this.device=await bounded(adapter.requestDevice().then(device=>{if(this.failed){device.destroy();throw Error('Compute initialization cancelled');}return device;}),'GPU device');this.failed=false;this.device.lost.then(()=>{this.failed=true;});this.device.addEventListener('uncapturederror',e=>{this.failed=true;this.error=e.error.message;});this.device.pushErrorScope('validation');const module=this.device.createShaderModule({label:'studio bounded sculpt grid',code:SCULPT_WGSL});this.pipeline=await bounded(this.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}}),'Sculpt compiler');const error=await this.device.popErrorScope();if(error)throw Error(error.message);return this;}
 async sample(stamps,g){if(this.failed||this.busy)throw Error('GPU sculpt unavailable or busy');this.busy=true;const d=this.device,buffers=[];try{
 const make=(size,usage)=>{const b=d.createBuffer({size,usage});buffers.push(b);return b;},U=GPUBufferUsage;
 const config=make(48,U.UNIFORM|U.COPY_DST),ops=make(Math.max(48,stamps.length*48),U.STORAGE|U.COPY_DST),values=make(g.count*8,U.STORAGE|U.COPY_SRC),read=make(g.count*8,U.MAP_READ|U.COPY_DST),packed=new Float32Array(Math.max(12,stamps.length*12));
 stamps.forEach((s,i)=>{packed.set([...s.position,['add','subtract','paint'].indexOf(s.mode),...s.size,['sphere','box','capsule'].indexOf(s.shape),s.blend,0,0,0],i*12);});d.queue.writeBuffer(ops,0,packed);
 const bind=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[config,ops,values].map((buffer,binding)=>({binding,resource:{buffer}}))});
 for(let start=0;start<stamps.length;start+=16){if(this.failed)throw Error(this.error||'GPU lost');d.queue.writeBuffer(config,0,new Float32Array([...g.origin,g.h,...g.dims,g.count,start,Math.min(stamps.length,start+16),0,0]));const e=d.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(this.pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(g.count/64));pass.end();d.queue.submit([e.finish()]);await bounded(d.queue.onSubmittedWorkDone(),'Sculpt batch');}
 const copy=d.createCommandEncoder();copy.copyBufferToBuffer(values,0,read,0,g.count*8);d.queue.submit([copy.finish()]);await bounded(read.mapAsync(GPUMapMode.READ),'Sculpt readback');const result=new Float32Array(read.getMappedRange().slice(0));read.unmap();return result;
 }catch(e){this.failed=true;this.device.destroy();throw e;}finally{buffers.forEach(b=>b.destroy());this.busy=false;}}
 async validate(){const cases=[
 [stamp('sphere','add',[.1,.2,-.1],[.6,.8,.5])],
 [stamp('box','add',[0,0,0],[.8,.7,.6]),stamp('sphere','subtract',[.4,.3,.2],[.5,.5,.5])],
 [stamp('capsule','add',[0,0,0],[.25,.6,.25]),stamp('sphere','add',[.3,.3,0],[.4,.4,.4],'wood',.25),stamp('box','paint',[0,.5,0],[.8,.2,.4],'bronze')]
 ];cases.push(Array.from({length:19},(_,i)=>stamp(i%2?'box':'sphere',i===18?'paint':'add',[(i%4)*.13,(i%3)*.11,(i%5)*.07],[.3,.32,.34],i===18?'bronze':'clay',.04)));let maximumError=0,materialErrors=0,points=0;for(const stamps of cases){const g=gridSpec(stamps,.24),cpu=sampleGridCPU(stamps,g),gpu=await this.sample(stamps,g);for(let i=0;i<cpu.length;i+=2){maximumError=Math.max(maximumError,Math.abs(cpu[i]-gpu[i]));if(cpu[i+1]!==gpu[i+1])materialErrors++;points++;}}const result={pass:maximumError<2e-5&&materialErrors===0,maximumError,materialErrors,points,cases:cases.length};if(!result.pass)throw Error('GPU reference mismatch: '+JSON.stringify(result));return result;}
 dispose(){this.device?.destroy();this.failed=true;}
}
