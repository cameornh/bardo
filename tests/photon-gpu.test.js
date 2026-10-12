import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLightScene } from '../src/light-transport.js';
import { emissionRay } from '../src/photon-map.js';
import { photonInputs, photonKernel, photonGPUAvailability, photonLedger } from '../src/photon-gpu-data.js';

test('GPU packet upload preserves reference rays, RGB channels, power, and padded rows',()=>{
 for(const source of ['broad','laser','rgb'])for(const color of ['white','red','green','blue']){
  const scene=makeLightScene({source,color}),count=101,data=photonInputs(scene,count);
  assert.ok(data.width*data.height>=count);
  let energy=0;
  for(let i=0;i<count;i++){
   const r=emissionRay(scene,i,count);
   assert.deepEqual(Array.from(data.origins.subarray(i*4,i*4+4)),[...r.origin,r.channel].map(Math.fround));
   assert.deepEqual(Array.from(data.directions.subarray(i*4,i*4+4)),[...r.direction,r.power].map(Math.fround));energy+=data.directions[i*4+3];
  }
  assert.ok(Math.abs(energy-scene.light.power)<1e-5);
  assert.ok(data.directions.subarray(count*4).every(x=>x===0));
 }
});

test('GPU gather conserves every source texel at edges, corners, and the receiver seam',()=>{
 for(const size of [32,64,256])for(const radius of [.02,.045,.15]){
  const kernel=photonKernel(size,radius);
  for(let row=0;row<3;row++)for(const p of [0,1,Math.floor(size/2),size-2,size-1]){
   const offset=(p+row*size)*4,sum=kernel[offset],sigma=kernel[offset+1],support=Math.ceil(3*sigma);let accumulated=0;
   for(let j=-support;j<=support;j++)if(p+j>=0&&p+j<size)accumulated+=Math.exp(-.5*(j/sigma)**2)/sum;
   assert.ok(Math.abs(accumulated-1)<1e-6);
  }
 }
 assert.throws(()=>photonKernel(256,1),/support/);
});

test('GPU backend rejects software devices or incomplete compute capabilities',()=>{
 const caps={floatTargets:true,floatBlend:true,attachments:3,vertexTextures:16,device:'AMD Radeon'};
 assert.equal(photonGPUAvailability(caps),null);
 for(const broken of [{floatTargets:false},{floatBlend:false},{attachments:2},{vertexTextures:0},{device:'ANGLE SwiftShader'},{device:'llvmpipe'}])assert.ok(photonGPUAvailability({...caps,...broken}));
});

test('GPU reduced diagnostics reject blank, nonfinite, and nonconserving solutions',()=>{
 const valid=photonLedger([2,3,1,20],[4,54,4,50],60);assert.equal(valid.receiver,54);assert.equal(valid.tir,4);
 for(const losses of [[0,0,0,0],[2,3,2,20],[NaN,3,1,20]])assert.throws(()=>photonLedger(losses,[4,54,4,50],60),/energy/);
 assert.throws(()=>photonLedger([0,0,0,0],[0,0,0,0],60),/energy/);
});
