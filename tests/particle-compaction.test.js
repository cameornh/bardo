import test from 'node:test';
import assert from 'node:assert/strict';
import {ActiveList,compactReference,MAX_SLOTS} from '../src/rtx-sand-lab/particle-compaction/scan.js';
import {compactVertex,installActiveLists} from '../src/rtx-sand-lab/particle-compaction/experiment.js';
import {renderPassPlan} from '../src/webgpu-sand-lab/pass-plan.js';
test('stable sea list retains original land/water interleaving and threshold margin',()=>{
 const a=new Float32Array([0,.02,0,0,.02001,.6,0,0,.01,0,0,0]);
 assert.deepEqual([...compactReference('sea',6,a)],[2,3]);
});
test('grain list excludes delayed births and dead grains, includes sparse endpoints',()=>{
 const a=new Float32Array(1028*4),v=a.slice();for(const i of [0,255,256,513,1027]){a[i*4+3]=.5;v[i*4+3]=1;}
 a[12*4+3]=2;v[12*4+3]=1;
 assert.deepEqual([...compactReference('grain',1028,a,v)],[0,255,256,513,1027]);
});
test('fine visibility can compact empty, full and maximum lists without reordering',()=>{
 const a=new Float32Array(MAX_SLOTS*4);a.fill(-1);assert.equal(compactReference('fine',MAX_SLOTS,a).length,0);
 a.fill(0);const all=compactReference('fine',MAX_SLOTS,a);assert.equal(all.length,MAX_SLOTS);assert.equal(all.at(-1),MAX_SLOTS-1);
 assert.equal(compactReference('fine',0,a).length,0);assert.throws(()=>compactReference('fine',MAX_SLOTS+1,a),/capacity/);
});
test('vertex remapping retains original ID for randomness and texture lookup',()=>{
 assert.match(compactVertex('void main(){int id=gl_InstanceID;float seed=float(gl_InstanceID);}'),/int id=int\(compactParticleId\);float seed=float\(int\(compactParticleId\)\)/);
 assert.equal(compactVertex('in float aDetailId;void main(){int id=int(aDetailId);}'),'in float compactParticleId;void main(){int id=int(compactParticleId);}');
});
test('compute remains an ordering barrier between state writes and indirect draws',()=>{
 const state={},draw={type:'draw',state},compute={type:'compute'};const result=renderPassPlan([draw,compute,draw]);
 assert.deepEqual(result.map(x=>x.type),['render','compute','render']);assert.equal(result[1],compute);
});
test('unsupported renderer retains reference behavior without allocation',async()=>{
 const state=await installActiveLists({renderer:{}});assert.equal(state.backend,'reference direct draw');assert.equal(state.lists.length,0);
});
test('capacity and duplicate-queue guards stop before unsafe indirect work',async()=>{
 globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2,STORAGE:4,VERTEX:8,COPY_SRC:16,INDIRECT:32};globalThis.GPUShaderStage={COMPUTE:4};
 const resources=[],device={pushErrorScope(){},async popErrorScope(){return null;},createBindGroupLayout:x=>x,createPipelineLayout:x=>x,createShaderModule:x=>x,async createComputePipelineAsync(x){return x;},createBindGroup:x=>x,queue:{writeBuffer(){}}};
 const renderer={device,commands:[],createBuffer(d){const b={...d};resources.push(b);return b;},destroyResource(b){b.destroyed=true;}};
 assert.throws(()=>new ActiveList(renderer,'sea',MAX_SLOTS+1),/capacity/);assert.equal(resources.length,0);
 const list=new ActiveList(renderer,'sea',257);await list.prepare();const image={view:{},width:16};
 assert.throws(()=>list.enqueue(image,null,258),/capacity/);list.enqueue(image,null,257);assert.throws(()=>list.enqueue(image,null,1),/already queued/);
 const dispatches=[];renderer.commands.shift().encode({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(n){dispatches.push(n);},end(){}})});
 assert.deepEqual(dispatches,[2,1,2]);list.enqueue(image,null,0);assert.throws(()=>list.dispose(),/Flush/);
 renderer.commands.shift().encode({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}})});
 list.dispose();assert.ok(resources.every(b=>b.destroyed));
});
