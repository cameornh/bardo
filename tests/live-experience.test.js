import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {hardwarePolicy} from '../src/rtx-sand-lab/profile.js';
import {starVisibility,nightSkyVisibility,NIGHT_LOOK} from '../src/sand-lab/night-look.js';
import {atmosphereSky} from '../src/sand-lab/atmosphere-model.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {lunarDirection} from '../src/sand-lab/night-sky-model.js';
import {StarGaussians} from '../src/sand-lab/star-gaussians.js';
import {LabExposure,exposureStatistics,exposureTarget} from '../src/sand-lab/sky-exposure.js';

function fixture(){
 let resolve,reject;const calls=[],result={positions:new Float32Array([1,2,3,0]),transport:{},emitterSamples:null};
 const transfer=new Promise((a,b)=>{resolve=a;reject=b;});
 const lab=Object.assign(Object.create(LiveSandLab.prototype),{
  enabled:true,asyncSimulation:true,paused:false,qaRunning:false,generation:1,accumulator:1/15,completedDt:0,
  positions:new Float32Array(4),spec:{scale:10,spacing:.2},optimizations:{gpuBatch:true},
  detail:{enabled:false,advance(){}},renderer:{readRenderTargetPixelsAsync(){}},transportGPU:{solve(){calls.push('transport');}},
  gpu:{cpu:false,solve(){calls.push('pressure');},finishDeferredPressure(){calls.push('validate');}},
  stepReadback:{waitMs:2,read(...args){assert.equal(args.at(-1),true);calls.push('transfer');return transfer;}},
  prepareStep(){calls.push('prepare');return {predicted:new Float32Array(4),old:new Float32Array(4),s:.2,scale:10};},
  finishStep(){calls.push('finish');},lastAdvance:-Infinity,
 });
 Object.defineProperty(lab,'timestep',{value:1/15});
 return {lab,calls,result,resolve,reject};
}
test('one packed asynchronous step runs in order and never queues a second GPU job',async()=>{
 const f=fixture();f.lab.startAsyncStep();const pending=f.lab.asyncPending;
 f.lab.startAsyncStep();assert.equal(f.lab.asyncPending,pending);
 await Promise.resolve();assert.deepEqual(f.calls,['prepare','pressure','transport','transfer']);
 assert.equal(f.lab.completedDt,0);assert.equal(f.lab.accumulator,0);
 f.resolve(f.result);await pending;
 assert.deepEqual(f.calls,['prepare','pressure','transport','transfer','validate','finish']);
 assert.equal(f.lab.completedDt,1/15);assert.equal(f.lab.asyncPending,null);
});
test('reset discards pending results, and a failed transfer disables further asynchronous work',async()=>{
 const stale=fixture();stale.lab.startAsyncStep();const a=stale.lab.asyncPending;await Promise.resolve();
 stale.lab.generation++;stale.resolve(stale.result);await a;
 assert.ok(!stale.calls.includes('finish'));assert.equal(stale.lab.completedDt,0);
 const failed=fixture();failed.lab.startAsyncStep();const b=failed.lab.asyncPending;await Promise.resolve();
 failed.reject(Error('test fence failure'));await b;
 assert.equal(failed.lab.asyncSimulation,false);assert.equal(failed.lab.gpu.forceCPUConstraints,true);
 assert.equal(failed.lab.completedDt,0);assert.match(failed.lab.pipelineError,/fence failure/);
 const before=failed.calls.length;failed.lab.accumulator=1/15;failed.lab.startAsyncStep();
 assert.equal(failed.calls.length,before);assert.equal(failed.lab.asyncPending,null);
});
test('fixed-step simulation earns the same time at 30, 60 and 144 display refresh rates',async()=>{
 for(const hz of [30,60,144]){
  const f=fixture(),lab=f.lab;lab.accumulator=0;lab.optimizations.gpuBatch=false;lab.asyncSimulation=true;
  lab.frameDrivenLens=true;lab.rateWall=lab.rateSim=lab.droppedTime=0;lab.completedDt=0;lab.simulationSpeed=1;
  lab.wetting={setCamera(){},stepLens(){}};lab.queuedInteractions=[];lab.moveHeld=()=>{};
  let integrated=0;lab.step=dt=>{integrated+=dt;};const camera=new THREE.PerspectiveCamera();
  for(let i=0;i<hz*3;i++){lab.advance(1/hz,camera);await lab.asyncPending;}
  assert.ok(integrated<=3+1e-9);assert.ok(integrated>=3-1/15-1e-9);assert.ok(lab.simRate<=1);
 }
});
test('hardware policy reserves headroom for physics and hard frames with a shared 60 FPS presentation budget',()=>{
 const rtx=hardwarePolicy({adapter:'ANGLE NVIDIA GeForce RTX 5070 Ti OpenGL'}),mac=hardwarePolicy({adapter:'AMD Radeon Pro 560X Metal'});
 assert.equal(rtx.defaultBackend,'gpu');assert.equal(mac.defaultBackend,'safe');
 assert.equal(rtx.frameHz,60);assert.equal(mac.frameHz,60);
 for(const key of ['maxWidth','maxHeight','drawingScale'])assert.equal(rtx[key],mac[key]);
 assert.equal(rtx.maxWidth,960);assert.equal(rtx.drawingScale,.5);
});
test('stars follow actual exposure, with faint stars emerging gradually during dark adaptation',()=>{
 assert.equal(starVisibility(10,6),0);assert.equal(starVisibility(1e6,6),1);
 assert.equal(starVisibility(10,0),1);
 let previous=0;for(let i=0;i<=100;i++){
  const exposure=10**(i*.07),visible=starVisibility(exposure,6),displayed=exposure*visible;
  assert.ok(displayed>=previous);assert.ok(visible>=0&&visible<=1);previous=displayed;
 }
 assert.ok(1e6*starVisibility(1e6,6)>1e4*starVisibility(1e4,6)*100);
 assert.equal(nightSkyVisibility(1,1e-9),0);assert.equal(nightSkyVisibility(-1,.02),0);
});
test('live moonlight lights surfaces more strongly while producing less sky wash; snapshots retain their defaults',()=>{
 const lab=new SandLab({extensions:{has:()=>false}});lab.day=0;lab.lunarDay=14.765295;lab.syncUniforms();
 const before=lab.sunlight;lab.enhancedNightSky=true;lab.syncUniforms();assert.ok(lab.sunlight>before*5.9);
 const options={moonPhase:1,moonPosition:lunarDirection(Math.PI)},sun=[0,-1,0];
 const old=atmosphereSky([0,1,0],sun,options),live=atmosphereSky([0,1,0],sun,{...options,enhancedNightSky:true});
 assert.ok(live[2]<old[2]*.12);assert.ok(live.every(v=>v>0));lab.gpu.dispose();
});
test('all catalogue stars are Gaussian instances, and only the live look adds the galactic layer',()=>{
 const old=new StarGaussians({}),live=new StarGaussians({},{enhanced:true});
 assert.equal(old.geometry.instanceCount,live.geometry.instanceCount);assert.ok(live.geometry.instanceCount>8000);
 assert.equal(old.scene.children.length,1);assert.equal(live.scene.children.length,2);old.dispose();live.dispose();
});
test('scene metering stays stable while all sky radiance receives the final scene exposure',()=>{
 const r={setRenderTarget(){},render(){}},exposure=new LabExposure(r,{nightBrightness:2});
 const world={texture:{name:'physical scene'}},image={texture:{name:'scene plus fixed HDR stars'}},metered=[];
 exposure.meter=input=>{metered.push(input);return {};};
 for(let frame=0;frame<120;frame++)exposure.update(image,1/60,{meterImage:world});
 assert.equal(metered.length,120);assert.ok(metered.every(input=>input===world));
 assert.equal(exposure.output.uniforms.uImage.value,image.texture);
 const stats=exposureStatistics(new Float32Array([1e-7,1e-7,1e-7,1]));
 assert.ok(exposureTarget(stats,{nightBrightness:2})>exposureTarget(stats)*1.99);exposure.dispose();
});
