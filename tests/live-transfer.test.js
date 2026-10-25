import test from 'node:test';
import assert from 'node:assert/strict';
import {StepReadback} from '../src/sand-lab/gpu-step-readback.js';
import {pollLabReadbacks,readLabPixelsAsync} from '../src/sand-lab/water-lab-readback.js';

function renderer(statuses){
 let target='previous',syncReads=0,copies=0,deleted=0;
 const gl={PIXEL_PACK_BUFFER:1,STREAM_READ:2,RGBA:3,FLOAT:4,SYNC_GPU_COMMANDS_COMPLETE:5,TIMEOUT_EXPIRED:6,WAIT_FAILED:7,
  createBuffer:()=>({}),bindBuffer(){},bufferData(){},readPixels(){},fenceSync:()=>({}),flush(){},
  clientWaitSync:()=>statuses.length>1?statuses.shift():statuses[0],
  getBufferSubData(kind,offset,data){copies++;for(let i=0;i<data.length;i++)data[i]=i;},deleteBuffer(){deleted++;},deleteSync(){deleted++;}};
 return {gl,getContext:()=>gl,getRenderTarget:()=>target,setRenderTarget:t=>target=t,render(){},
  readRenderTargetPixels(){syncReads++;throw Error('synchronous transfer forbidden');},
  get state(){return {target,syncReads,copies,deleted};}};
}
test('packed transfer never waits synchronously and retains the exact five-layer layout',async()=>{
 const r=renderer([6,8]),readback=new StepReadback(r),gpu={height:1,resultTexture:{}},transport={target:{textures:[{},{},{},{}]},unpack(n,buffers){return buffers;}};
 const result=await readback.read(gpu,transport,3,null,true);
 assert.deepEqual([...result.positions],Array.from({length:12},(_,i)=>i));
 for(let k=0;k<4;k++)assert.equal(result.transport[k][0],256*(k+1));
 assert.equal(r.state.syncReads,0);assert.equal(r.state.copies,1);assert.equal(r.state.deleted,2);assert.equal(r.state.target,'previous');readback.dispose();
});
test('frame polling completes a ready fence and a failed fence releases its resources',async()=>{
 for(const fail of [false,true]){
  const r=renderer([6,fail?7:8]),data=new Float32Array(8),pending=readLabPixelsAsync(r,{},1,2,data);
  pollLabReadbacks(r);
  if(fail)await assert.rejects(pending,/fence failed/);else{await pending;assert.deepEqual([...data],[0,1,2,3,4,5,6,7]);}
  assert.equal(r.state.deleted,2);assert.equal(r.state.copies,fail?0:1);
 }
});
