import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SandLab} from '../src/sand-lab/lab.js';
import {LabFluidGPU} from '../src/sand-lab/water-lab-gpu.js';
import {EmitterProbes} from '../src/sand-lab/emitter-probes.js';
import {configureRTXLab,applyRTXBackend,RTX_FRAME_HZ} from '../src/rtx-sand-lab/profile.js';
import {rtxPressureFixtures,verifyRTXPressure} from '../src/rtx-sand-lab/verify.js';
import {solveDensityCPU} from '../src/sand-lab/density-cpu.js';
import {buildNeighbors} from '../src/sand-lab/water-lab-model.js';

function device(supported=true){
 let target=null;const draws=[];
 return {draws,extensions:{has:()=>supported},getRenderTarget:()=>target,setRenderTarget:t=>target=t,
  render(scene){draws.push({target,material:scene.children[0].material});}};
}

test('RTX policy enables all existing optimizations without changing the physics timestep',()=>{
 const r=device(),lab=new SandLab(r,{boulders:true,physicalResolution:true}),dt=lab.timestep;
 configureRTXLab(lab);assert.equal(lab.timestep,dt);assert.equal(lab.frameHz,RTX_FRAME_HZ);assert.equal(lab.asyncSimulation,false);
 for(const [key,value] of Object.entries(lab.optimizations))if(key!=='gpuPressure')assert.equal(value,true,key);
 assert.equal(lab.gpu.cpuContacts,true); // before validation completes
 applyRTXBackend(lab,'gpu');assert.equal(lab.gpu.cpu,false);assert.equal(lab.gpu.cpuContacts,false);assert.equal(lab.air.cpu,false);
 for(const [quality,width] of [[1,.4],[3,2]]){
  lab.resolutions.ocean=quality;lab.configure('ocean',width);
  assert.equal(lab.gpu.cpuContacts,false);assert.equal(lab.gpu.forceCPUConstraints,false);
 }
 lab.gpu.dispose();
});

test('full GPU profile dispatches pressure and object contacts rather than the CPU restriction',()=>{
 const r=device(),lab=new SandLab(r,{boulders:true}),p=new Float32Array([0,.4,0,0,.13,.4,0,1]);
 configureRTXLab(lab);applyRTXBackend(lab,'gpu');lab.gpu.uniforms.uPackedGpuNeighbors.value=true;
 const result=lab.gpu.solve(p,.2,q=>q,3,q=>q[1],false,true);
 assert.equal(r.draws.length,6);assert.equal(lab.gpu.resultTexture,result.texture);assert.equal(lab.gpu.constraintBackend,'GPU');
 assert.equal(lab.gpu.uniforms.uBodyCount.value,lab.balls.length);assert.ok(lab.balls.length>0);
 const probes=new EmitterProbes(r,lab.u),transport={target:{textures:[null,null,{}]}};
 assert.ok(probes.update(lab.gpu,transport,2,.2));assert.equal(r.draws.length,7);
 applyRTXBackend(lab,'safe');r.draws.length=0;
 const cpu=lab.gpu.solve(p,.2,q=>q,3,null,false,true);assert.ok(cpu.every(Number.isFinite));assert.equal(r.draws.length,0);
 assert.equal(probes.update(lab.gpu,transport,2,.2),null);probes.dispose();lab.gpu.dispose();
});

test('snapshots retain the mandatory CPU path unless the experiment explicitly opts in',()=>{
 const r=device(),gpu=new LabFluidGPU(r,{uStation:{value:6},uBodyCount:{value:2}});
 assert.equal(gpu.cpuContacts,true);gpu.allowGPUObjectContacts=true;assert.equal(gpu.cpuContacts,false);
 gpu.forceCPUConstraints=true;assert.equal(gpu.cpuContacts,true);gpu.dispose();
});

test('split GPU is mutually exclusive with full GPU, and missing capability uses CPU reference',()=>{
 const lab=new SandLab(device());configureRTXLab(lab);
 assert.throws(()=>applyRTXBackend(lab,'bounded'),/Validate/);
 const split={geometryValidated:true,dispose(){}};applyRTXBackend(lab,'bounded',null,split);
 assert.equal(lab.gpu.boundedPressure,split);assert.equal(lab.optimizations.gpuPressure,true);
 applyRTXBackend(lab,'gpu');assert.equal(lab.gpu.boundedPressure,null);assert.equal(lab.optimizations.gpuPressure,false);
 applyRTXBackend(lab,'cpu');assert.equal(lab.gpu.cpu,true);assert.equal(lab.air.cpu,true);
 lab.renderer.extensions.has=()=>false;assert.equal(applyRTXBackend(lab,'gpu'),'cpu');assert.equal(lab.gpu.cpu,true);
 assert.throws(()=>applyRTXBackend(lab,'invalid'),/Unknown/);lab.gpu.dispose();
});

test('target-machine validation fixtures cover contacts, held samples and actual edited sand',()=>{
 const lab=new SandLab(device(),{boulders:true}),fixtures=rtxPressureFixtures(lab);
 for(const f of fixtures){
  f.prepare?.();assert.equal(f.positions.length/4,175);
  const neighbors=buildNeighbors(f.positions,f.spacing).data;
  const output=solveDensityCPU(f.positions,neighbors,f.spacing,3,f.collision?f.collide:undefined,f.collision?f.boundary:null);
  assert.ok(output.every(Number.isFinite));
  for(let o=0;o<f.positions.length;o+=4)if(f.positions[o+3])assert.deepEqual(output.slice(o,o+4),f.positions.slice(o,o+4));
 }
 assert.ok(lab.u.uSandCount.value>0);lab.gpu.dispose();
});

test('failed target validation is cached and cannot resubmit graphics work',async()=>{
 let queries=0;
 const r={getContext(){queries++;throw Error('unavailable');}};
 const a=verifyRTXPressure(r),b=verifyRTXPressure(r);assert.equal(a,b);
 const result=await a;assert.equal(result.pass,false);assert.equal(result.reason,'unavailable');assert.equal(queries,1);
});

test('branch routing defaults to the isolated RTX entry and preserves the original safe entry',async()=>{
 const entry=await readFile(new URL('../src/entry.js',import.meta.url),'utf8');
 assert.match(entry,/profile.*safe/);assert.match(entry,/else import\('\.\/rtx-sand-lab\/main\.js'\)/);
 const safe=await readFile(new URL('../src/sand-lab/main.js',import.meta.url),'utf8');
 assert.match(safe,/forceCPUConstraints=true/);assert.doesNotMatch(safe,/rtx-sand-lab/);
 const rtx=await readFile(new URL('../src/rtx-sand-lab/main.js',import.meta.url),'utf8');
 assert.match(rtx,/setRTXBackend\(params\.get\('backend'\)\|\|'gpu'\)/);
});
