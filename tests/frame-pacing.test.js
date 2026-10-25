import test from 'node:test';
import assert from 'node:assert/strict';
import {FramePacer} from '../src/rtx-sand-lab/frame-pacing.js';

test('60 FPS pacing stays near 60 on fast displays, including 144 Hz',()=>{
 for(const hz of [60,75,90,120,144,165,240]){
  const pacer=new FramePacer(60);let frames=0;
  for(let i=0;i<hz*10;i++)frames+=pacer.shouldRender(i*1000/hz);
  assert.ok(Math.abs(frames-600)<=1,`${hz} Hz: ${frames} frames in 10 seconds`);
 }
});
test('hard rendering frames are not slowed further by the FPS limit',()=>{
 for(const hz of [15,24,30,45]){
  const pacer=new FramePacer(60);
  for(let i=0;i<hz*10;i++)assert.equal(pacer.shouldRender(i*1000/hz),true);
 }
});
test('a stall cannot trigger a burst of catch-up renders',()=>{
 const pacer=new FramePacer(60);
 assert.equal(pacer.shouldRender(0),true);assert.equal(pacer.shouldRender(5),false);
 assert.equal(pacer.shouldRender(1000),true);
 for(let i=1;i<16;i++)assert.equal(pacer.shouldRender(1000+i),false);
 assert.equal(pacer.shouldRender(1000+1000/60),true);
 assert.equal(pacer.shouldRender(1000+1000/60),false);
});
