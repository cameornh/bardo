import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

test('first-use observation can finish late without extending subsequent scene frame budgets',async()=>{
 let time=0,delay=30;
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,TIMEOUT_EXPIRED:4,
  isContextLost:()=>false,fenceSync:()=>({ready:time+delay}),clientWaitSync:f=>time>=f.ready?2:4,deleteSync(){},flush(){}};
 const renderer={getContext:()=>gl,render(){}};
 const gate=new FrameCompletion(renderer,{timeoutMs:10,now:()=>time,wait:async()=>{time+=5;}});
 const draw=()=>renderer.render({traverse:visit=>visit({material:{name:'one pixel'}})});
 // No prior work: the longer interval applies only after this draw.
 delay=0;
 await gate.run(()=>{delay=30;draw();},{completionTimeoutMs:50});
 assert.equal(time,30);assert.equal(gate.timeoutMs,10);assert.equal(gate.failed,null);
 delay=0;
 await assert.rejects(gate.run(()=>{delay=30;draw();}),/completion budget/);
 assert.equal(time,45);assert.equal(gate.snapshot().firstUnconfirmed,'one pixel');
});

test('startup observation does not extend the budget of work queued before the draw',async()=>{
 let time=0,submitted=false;
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,TIMEOUT_EXPIRED:4,isContextLost:()=>false,fenceSync:()=>({}),clientWaitSync:()=>4,deleteSync(){},flush(){}};
 const renderer={getContext:()=>gl,render(){}};
 const gate=new FrameCompletion(renderer,{timeoutMs:10,now:()=>time,wait:async()=>{time+=5;}});
 await assert.rejects(gate.run(()=>{submitted=true;},{completionTimeoutMs:50}),/completion budget/);
 assert.equal(submitted,false);assert.equal(time,15);
});
