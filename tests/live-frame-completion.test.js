import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';

function fixture({timeout=false,lose=false}={}){
 let time=0,id=0,lost=false;const submitted=[],deleted=[],fences=[],failures=[];
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,TIMEOUT_EXPIRED:4,
  isContextLost:()=>lost,fenceSync(){const fence={id:++id,ready:id===1};fences.push(fence);return fence;},
  clientWaitSync:(f,flags,timeout)=>{assert.equal(flags,0);assert.equal(timeout,0);return f.ready?2:4;},deleteSync:f=>deleted.push(f.id),flush(){}};
 const renderer={getContext:()=>gl,render:scene=>submitted.push(scene.name)};
 const gate=new FrameCompletion(renderer,{timeoutMs:10,now:()=>time,wait:async()=>{time+=6;if(lose)lost=true;else if(!timeout)for(const f of fences)f.ready=true;},onFailure:e=>failures.push(e)});
 const draw=name=>renderer.render({name,traverse:fn=>fn({material:{name}})});
 return {gate,gl,draw,submitted,deleted,failures,fences};
}

test('one frame stays pending until every pass completes, without blocking GL waits',async()=>{
 const f=fixture();const pending=f.gate.run(()=>{f.draw('terrain');f.draw('water');});
 await assert.rejects(f.gate.run(()=>assert.fail('overlapping frame')),/already pending/);
 await pending;
 assert.deepEqual(f.submitted,['terrain','water']);assert.equal(f.gate.lastCompleted,'water');assert.equal(f.gate.pending,null);
 assert.deepEqual(f.deleted,[1,2,3]);assert.equal(f.failures.length,0);
 await f.gate.run(()=>f.draw('next frame'));assert.equal(f.gate.lastCompleted,'next frame');
});

test('a stalled earlier pass is identified instead of blaming the last submitted display shader',async()=>{
 const f=fixture({timeout:true});
 await assert.rejects(f.gate.run(()=>{f.draw('water lighting');f.draw('display');}),/First outstanding: water lighting/);
 assert.equal(f.failures.length,1);assert.equal(f.gate.lastCompleted,'work queued before frame');
 assert.equal(f.gate.snapshot().firstUnconfirmed,'water lighting');
 assert.deepEqual(f.gate.snapshot().unconfirmedPasses,['water lighting','display']);
 assert.deepEqual(f.deleted,[1,2,3]);
 await assert.rejects(f.gate.run(()=>assert.fail('retry after stall')),/completion budget/);
 assert.throws(()=>f.draw('later pass'),/completion budget/);assert.deepEqual(f.submitted,['water lighting','display']);
});

test('context loss stops polling and submission without querying or deleting lost resources',async()=>{
 const f=fixture({lose:true});
 await assert.rejects(f.gate.run(()=>f.draw('density reconstruction')),/first outstanding pass: density reconstruction/);
 assert.deepEqual(f.deleted,[1]);assert.equal(f.failures.length,1);assert.equal(f.gate.pending,null);
 assert.equal(f.gate.snapshot().firstUnconfirmed,'density reconstruction');
});

test('queued simulation work completes before the frame starts; draw failures are not retried',async()=>{
 const f=fixture();f.gl.fenceSync=()=>{const fence={id:1,ready:false};f.fences.push(fence);return fence;};
 await assert.rejects(f.gate.run(()=>{assert.ok(f.fences[0].ready);throw Error('draw rejected');}),/draw rejected/);
 assert.equal(f.gate.active,false);assert.equal(f.failures.length,1);
});

test('asynchronous physics cannot submit another step while a frame is pending',()=>{
 const lab=Object.assign(Object.create(LiveSandLab.prototype),{renderPending:true,asyncSimulation:true,enabled:true,paused:false,gpu:{cpu:false},accumulator:1});
 Object.defineProperty(lab,'timestep',{value:1/15});lab.startAsyncStep();assert.equal(lab.asyncPending,undefined);assert.equal(lab.accumulator,1);
});

test('CPU overlap cannot submit graphics or leak an asynchronous job into another frame',async()=>{
 const f=fixture();await assert.rejects(f.gate.run(()=>f.draw('frame'),{cpuWork:()=>f.draw('illegal compute draw')}),/CPU overlap attempted/);assert.deepEqual(f.submitted,['frame']);
 const g=fixture();await assert.rejects(g.gate.run(()=>g.draw('frame'),{cpuWork:()=>Promise.resolve()}),/must be synchronous/);
});
