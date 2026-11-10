import test from 'node:test';
import assert from 'node:assert/strict';
import {deferredQueueCompletion} from '../native/completion.js';
import {SharedSceneWebGPU} from '../src/webgpu-sand-lab/renderer.js';

function renderer(queueCompletion){
 const events=[];let complete,reject;
 const gpu=new Promise((a,b)=>{complete=a;reject=b;});
 const r=Object.create(SharedSceneWebGPU.prototype);
 Object.assign(r,{options:{queueCompletion},commands:[{type:'clear',state:{colors:[{view:{}}]},color:[0,0,0,0]}],temporary:[],info:{render:{}},
  device:{pushErrorScope(){events.push('scope');},async popErrorScope(){events.push('pop');return null;},createCommandEncoder(){return {beginRenderPass(){return {end(){}};},finish(){return {};}};},
   queue:{submit(){events.push('submit');},onSubmittedWorkDone(){events.push('native-wait');return gpu;}}}});
 return {r,events,complete,reject};
}
test('native frame submits first, runs CPU work before entering the blocking binding, and still waits for completion',async()=>{
 const {r,events,complete}=renderer(deferredQueueCompletion);let finished=false;
 const frame=r.flush({cpuWork:()=>events.push('physics')}).then(()=>finished=true);
 assert.deepEqual(events,['scope','submit','physics']);assert.equal(r.flushing,true);
 await Promise.resolve();assert.deepEqual(events,['scope','submit','physics','native-wait']);assert.equal(finished,false);
 // The independent one-outstanding-frame guard must still prevent resubmission.
 await assert.rejects(r.flush(),/already outstanding/);
 complete();await frame;assert.equal(finished,true);assert.equal(r.flushing,false);assert.equal(events.at(-1),'pop');
});
test('browser completion order is unchanged without the native execution policy',async()=>{
 const {r,events,complete}=renderer();const frame=r.flush({cpuWork:()=>events.push('physics')});
 assert.deepEqual(events,['scope','submit','native-wait','physics']);complete();await frame;
});
test('failed native completion stops the renderer before any subsequent GPU submission',async()=>{
 const {r,events,reject}=renderer(deferredQueueCompletion);const frame=r.flush();await Promise.resolve();reject(Error('device lost'));
 await assert.rejects(frame,/device lost/);await assert.rejects(r.flush(),/device lost/);assert.equal(events.filter(e=>e==='submit').length,1);assert.equal(r.flushing,false);
});
test('native scheduling preserves the frame completion timeout',async()=>{
 const {r,events}=renderer(deferredQueueCompletion);await assert.rejects(r.flush({timeoutMs:10}),/time budget/);await assert.rejects(r.flush(),/time budget/);assert.equal(events.filter(e=>e==='submit').length,1);
});
test('synchronous runtime exceptions become rejected completion promises',async()=>{
 const p=deferredQueueCompletion({onSubmittedWorkDone(){throw Error('runtime failure');}});await assert.rejects(p,/runtime failure/);
});
