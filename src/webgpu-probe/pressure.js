import {BeachFieldGrid,AIR,WATER} from '../rtx-sand-lab/fields/grid.js';
import {multiply,norm} from '../rtx-sand-lab/fields/multigrid.js';

export const PROBE_LIMITS=Object.freeze({cells:512,neighbors:6,iterations:64,batch:8,waitMs:2000});
// A deliberately small first WebGPU experiment. This is the beach's actual
// variable-density pressure operator, not the beach renderer or a new solver
// selected automatically in the live scene. Weighted Jacobi tests the basic
// sparse stencil; it is NOT a replacement for multigrid convergence.
export function pressureFixture(){
 const grid=new BeachFieldGrid({dims:[8,6,6],h:1,origin:[0,0,0]});
 grid.setPhase(Uint8Array.from({length:grid.count},(_,i)=>{
  const [x,y,z]=grid.coords[i];return x===4&&y<3&&z>1?0:y<3?WATER:AIR;
 }));
 const operator=grid.levels[0],exact=Float64Array.from({length:grid.count},(_,i)=>grid.phase[i]?Math.sin(i*.23)+.3*Math.cos(i*.71):0);
 return {grid,operator,rhs:multiply(operator,exact),exact};
}
export function packPressure(operator,rhs){
 const {n,offset,column,diag,weight}=operator;
 if(!Number.isInteger(n)||n<1||n>PROBE_LIMITS.cells||rhs.length!==n)throw Error('Pressure probe cell budget exceeded');
 if(offset.length!==n+1||diag.length!==n||weight.length!==column.length||column.length>n*PROBE_LIMITS.neighbors||offset[0]!==0||offset[n]!==column.length)throw Error('Invalid pressure storage');
 const rows=new Float32Array(n*4),edges=new Float32Array(Math.max(2,column.length*2));
 for(let i=0;i<n;i++){
  const degree=offset[i+1]-offset[i];
  if(!Number.isInteger(offset[i])||!Number.isInteger(offset[i+1])||degree<0||degree>PROBE_LIMITS.neighbors||offset[i+1]>column.length||!Number.isFinite(diag[i])||diag[i]<0)throw Error('Invalid pressure row');
  rows.set([diag[i],offset[i],degree,0],i*4);
 }
 for(let k=0;k<column.length;k++){
  if(!Number.isInteger(column[k])||column[k]<0||column[k]>=n||!Number.isFinite(weight[k]))throw Error('Invalid pressure neighbor');
  edges.set([column[k],weight[k]],k*2);
 }
 const b=Float32Array.from(rhs);if(!b.every(Number.isFinite)||!rows.every(Number.isFinite)||!edges.every(Number.isFinite))throw Error('Non-finite pressure input');
 return {rows,edges,rhs:b,n};
}
function validatePacked({n,rows,edges,rhs}){
 if(!Number.isInteger(n)||n<1||n>PROBE_LIMITS.cells)throw Error('Pressure probe cell budget exceeded');
 if(!(rows instanceof Float32Array)||rows.length!==n*4||!(rhs instanceof Float32Array)||rhs.length!==n||!(edges instanceof Float32Array)||edges.length<2||edges.length%2||edges.length>Math.max(2,n*PROBE_LIMITS.neighbors*2))throw Error('Invalid packed pressure storage');
 if(!rows.every(Number.isFinite)||!edges.every(Number.isFinite)||!rhs.every(Number.isFinite))throw Error('Non-finite pressure input');
 for(let i=0;i<n;i++){
  const [diagonal,start,count]=rows.subarray(i*4,i*4+3);
  if(diagonal<0||!Number.isInteger(start)||!Number.isInteger(count)||start<0||count<0||count>PROBE_LIMITS.neighbors||(start+count)*2>edges.length)throw Error('Invalid packed pressure row');
 }
 for(let i=0;i<edges.length;i+=2)if(!Number.isInteger(edges[i])||edges[i]<0||edges[i]>=n)throw Error('Invalid packed pressure neighbor');
}
export function validateIterations(iterations){if(!Number.isInteger(iterations)||iterations<1||iterations>PROBE_LIMITS.iterations)throw Error('Pressure probe iteration budget exceeded');}
export function referencePressure(packed,iterations=32){
 validateIterations(iterations);validatePacked(packed);const {rows,edges,rhs,n}=packed,round=Math.fround;
 let x=new Float32Array(n),next=new Float32Array(n);
 for(let step=0;step<iterations;step++){
  for(let i=0;i<n;i++){
   let sum=rhs[i];const start=rows[i*4+1],count=rows[i*4+2],diag=rows[i*4];
   for(let k=0;k<count;k++){const edge=(start+k)*2;sum=round(sum+round(edges[edge+1]*x[edges[edge]]));}
   next[i]=diag>0?round(x[i]+round(round(.7)*round(round(sum/diag)-x[i]))):0;
  }
  [x,next]=[next,x];
 }
 return x;
}
export function pressureReport(fixture,result,reference){
 if(result.length!==reference.length||!result.every(Number.isFinite))return {pass:false,reason:'Invalid GPU output'};
 const maxError=result.reduce((m,v,i)=>Math.max(m,Math.abs(v-reference[i])),0),scale=Math.max(1,...reference.map(Math.abs));
 const residual=norm(multiply(fixture.operator,result).map((v,i)=>v-fixture.rhs[i]))/Math.max(1e-12,norm(fixture.rhs));
 return {pass:maxError<=scale*2e-5&&residual<.1,maxError,relativeResidual:residual,tolerance:scale*2e-5};
}

export const PRESSURE_WGSL=`
@group(0) @binding(0) var<storage,read> rows: array<vec4<f32>>;
@group(0) @binding(1) var<storage,read> edges: array<vec2<f32>>;
@group(0) @binding(2) var<storage,read> rhs: array<f32>;
@group(0) @binding(3) var<storage,read> inputPressure: array<f32>;
@group(0) @binding(4) var<storage,read_write> outputPressure: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
 let i=id.x;
 if (i>=arrayLength(&rows)) { return; }
 let row=rows[i]; var sum=rhs[i];
 for (var k=0u; k<6u; k=k+1u) {
  if (k>=u32(row.z)) { break; }
  let edge=edges[u32(row.y)+k]; sum=sum+edge.y*inputPressure[u32(edge.x)];
 }
 var value=0.0;
 if (row.x>0.0) { value=inputPressure[i]+0.7*(sum/row.x-inputPressure[i]); }
 outputPressure[i]=value;
}`;

export async function boundedWait(promise,label,ms=PROBE_LIMITS.waitMs){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded the probe time budget; no further work submitted')),ms);})]);}
 finally{clearTimeout(timer);}
}

export async function probeWebGPU(packed,{gpu=globalThis.navigator?.gpu,iterations=32,onProgress=()=>{},signal}={}){
 validateIterations(iterations);
 validatePacked(packed);
 if(!gpu)throw Error('WebGPU is not exposed by this browser. CPU reference remains available.');
 let device,lost,scopeCount=0;const buffers=[];
 const check=()=>{if(signal?.aborted)throw Error('Probe stopped');if(lost)throw Error('WebGPU device lost: '+lost);};
 try{
  onProgress('Requesting a WebGPU adapter; no scene is loaded');check();
  const adapter=await boundedWait(gpu.requestAdapter({powerPreference:'low-power'}),'Adapter request');
  if(!adapter)throw Error('No WebGPU adapter is available. CPU reference remains available.');check();
  const request=adapter.requestDevice();
  // If a timed-out request resolves later, release it instead of leaving a
  // hidden device alive. No automatic adapter retry or browser-flag changes.
  let accepted=false,timedOut=false;
  request.then(d=>{if(timedOut&&!accepted)d.destroy();},()=>{});
  try{device=await boundedWait(request,'Device request');accepted=true;}catch(error){timedOut=true;throw error;}
  device.lost.then(info=>{lost=info.message||info.reason;});
  for(const filter of ['internal','out-of-memory','validation']){device.pushErrorScope(filter);scopeCount++;}
  const module=device.createShaderModule({label:'bounded-pressure-stencil',code:PRESSURE_WGSL});
  const info=await boundedWait(module.getCompilationInfo(),'WGSL compilation');
  const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));check();
  const pipeline=await boundedWait(device.createComputePipelineAsync({label:'bounded-pressure-stencil',layout:'auto',compute:{module,entryPoint:'main'}}),'Compute pipeline');check();
  const storage=(label,data)=>{const b=device.createBuffer({label,size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});buffers.push(b);device.queue.writeBuffer(b,0,data);return b;};
  const rows=storage('rows',packed.rows),edges=storage('edges',packed.edges),rhs=storage('rhs',packed.rhs);
  const states=[storage('pressure-a',new Float32Array(packed.n)),storage('pressure-b',new Float32Array(packed.n))];
  const groups=states.map((_,i)=>device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[rows,edges,rhs,states[i],states[1-i]].map((buffer,binding)=>({binding,resource:{buffer}}))}));
  let cursor=0;const start=performance.now();
  // At most eight tiny dispatches outstanding. Each lane visits at most six
  // neighbors. Await each batch before recording the next one.
  for(let step=0;step<iterations;){
   check();const encoder=device.createCommandEncoder({label:'bounded-pressure-batch'}),end=Math.min(iterations,step+PROBE_LIMITS.batch);
   for(;step<end;step++){const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,groups[cursor]);pass.dispatchWorkgroups(Math.ceil(packed.n/64));pass.end();cursor=1-cursor;}
   device.queue.submit([encoder.finish()]);await boundedWait(device.queue.onSubmittedWorkDone(),'Pressure batch');check();onProgress(`Completed ${step} / ${iterations} pressure iterations`);
  }
  const computeAndWaitMs=performance.now()-start,read=device.createBuffer({label:'pressure-readback',size:packed.n*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});buffers.push(read);
  const copy=device.createCommandEncoder();copy.copyBufferToBuffer(states[cursor],0,read,0,packed.n*4);device.queue.submit([copy.finish()]);
  await boundedWait(read.mapAsync(GPUMapMode.READ),'Pressure readback');check();
  const result=new Float32Array(read.getMappedRange()).slice();read.unmap();
  while(scopeCount){scopeCount--;const error=await boundedWait(device.popErrorScope(),'Validation');if(error)throw Error(error.message);}
  return {result,computeAndWaitMs,backend:'WebGPU compute',adapter:adapter.info?.description||adapter.info?.architecture||'WebGPU adapter',iterations,cells:packed.n};
 }finally{
  while(scopeCount&&device){scopeCount--;device.popErrorScope().catch(()=>{});}
  for(const b of buffers)b.destroy();device?.destroy();
 }
}
