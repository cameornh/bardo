import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pressureFixtures} from '../src/sand-lab/bounded-pressure-fixtures.js';
import {PRESSURE_LIMITS,pressureInputError,pressureDrawRanges,pressureStepReference,pressureComparison} from '../src/sand-lab/bounded-pressure-model.js';
import {PressureContacts} from '../src/sand-lab/pressure-contacts.js';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {solveDensityCPU} from '../src/sand-lab/density-cpu.js';
import {BoundedPressureGPU} from '../src/sand-lab/bounded-pressure-gpu.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {buildNeighbors} from '../src/sand-lab/water-lab-model.js';
await setDensityKernel(await readFile(new URL('../src/sand-lab/kernels/density.wasm',import.meta.url)));
const forbidden=()=>assert.fail('Unexpected GPU submission'),renderer={extensions:{has:()=>true},render:forbidden,compileAsync:forbidden,getContext:forbidden,getRenderTarget:forbidden,setRenderTarget:forbidden};

function separated(f,contacts,lab=null,iterations=3){
 contacts.begin(f.positions,f.spacing,f.collide,f.boundary,lab);let p=f.positions;
 for(let i=0;i<iterations;i++)p=contacts.project(pressureStepReference(p,f.neighbors,contacts.sample(p),f.spacing));
 return p.slice();
}
test('separated pressure and contacts agree with the existing solver including held samples',()=>{
 for(const f of pressureFixtures())for(const iterations of [1,2,3]){
  const actual=separated(f,new PressureContacts(),null,iterations),expected=solveDensityCPU(f.positions,f.neighbors,f.spacing,iterations,f.collide,f.boundary);
  const result=pressureComparison(actual,expected,f.positions,f.spacing);assert.ok(result.pass,JSON.stringify(result));assert.ok(result.error<1e-6);
 }
});
test('compact compiled contacts retain cups, boulders, player and carved sand through repeated solves',()=>{
 const lab=new SandLab(renderer,{boulders:true,physicalResolution:true});Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true,adaptivePressure:false});
 const cup=makeBody('glass','cup',.3,[0,1,2]);cup.tilt=.6;cup.pitch=.3;lab.balls.push(cup);lab.setPlayer([1,1.6,2],[0,0,0],.03,.17);
 lab.sand.wet.fill(.8);lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);lab.sand.update();lab.syncUniforms();
 const compact=new PressureContacts(),reference=new NativeDensity();
 for(const count of [175,280,63]){
  const p=new Float32Array(count*4);for(let i=0;i<count;i++)p.set([(i%7-3)*.12,.8+(Math.floor(i/7)%5)*.12,2.5+Math.floor(i/35)*.12,i%23===0?1:0],i*4);
  const spacing=.14,neighbors=buildNeighbors(p,spacing).data,f={positions:p,spacing,neighbors,collide:p=>lab.collide(p,spacing*.12),boundary:p=>lab.solid(p)};
  const expected=reference.solve(p,neighbors,spacing,3,f.collide,f.boundary,lab),actual=separated(f,compact,lab);
  // GPU positions round to float before contact projection, unlike the CPU
  // solver's double-precision intermediate. Bound this at 0.05% of spacing.
  const result=pressureComparison(actual,expected,p,spacing);assert.ok(result.pass,JSON.stringify(result));assert.ok(result.error<spacing*.0005,JSON.stringify(result));assert.equal(compact.backend,'WebAssembly CPU contacts');
  const js=new PressureContacts({native:false});js.begin(p,spacing,f.collide,f.boundary);compact.begin(p,spacing,f.collide,f.boundary,lab);
  const wall=compact.sample(p),jsWall=js.sample(p),projected=compact.project(p),jsProjected=js.project(p);
  for(let i=0;i<p.length;i++){assert.ok(Math.abs(wall[i]-jsWall[i])<1e-5);assert.ok(Math.abs(projected[i]-jsProjected[i])<1e-6);}
  assert.ok(compact.memoryBytes<reference.instance.exports.memory.buffer.byteLength/2,'no pressure pair cache in contact bridge');
  // A moved object must invalidate the next solve's sampled contact geometry.
  cup.position[0]+=.06;lab.syncUniforms();
 }
 lab.gpu.dispose();
});
test('compact contacts cover the entire physical beach without allocating pair caches',()=>{
 const lab=new SandLab(renderer,{boulders:true,physicalResolution:true}),compact=new PressureContacts(),p=lab.positions;
 compact.begin(p,lab.spacing,q=>lab.collide(q),q=>lab.solid(q),lab);const wall=compact.sample(p),next=compact.project(p);
 assert.ok(wall.every(Number.isFinite));assert.ok(next.every(Number.isFinite));assert.equal(next.length,p.length);
 assert.ok(compact.memoryBytes<4*1024*1024,compact.memoryBytes);lab.gpu.dispose();
});
test('unvalidated and stopped GPU paths never compile or draw and use the CPU reference',()=>{
 const gpu=new BoundedPressureGPU(renderer);
 for(const f of pressureFixtures()){
  const expected=solveDensityCPU(f.positions,f.neighbors,f.spacing,3,f.collide,f.boundary),actual=gpu.solve(f.positions,f.neighbors,f.spacing,3,f.collide,f.boundary);
  assert.ok(pressureComparison(actual,expected,f.positions,f.spacing).pass);
 }
 gpu.stop('test stop');assert.equal(gpu.validate(pressureFixtures()).pass,false);assert.equal(gpu.validated,false);gpu.dispose();
});
test('invalid data and excessive work are rejected before a GPU submission',()=>{
 const f=pressureFixtures()[0];assert.equal(pressureInputError(f.positions,f.neighbors,f.spacing),null);
 for(const spacing of [0,NaN,Infinity,1e-9])assert.ok(pressureInputError(f.positions,f.neighbors,spacing));
 assert.ok(pressureInputError(f.positions,f.neighbors,f.spacing,4));
 const p=f.positions.slice();p[0]=NaN;assert.ok(pressureInputError(p,f.neighbors,f.spacing));
 for(const invalid of [175,-2,.5,NaN,0]){const n=f.neighbors.slice();n[0]=invalid;assert.ok(pressureInputError(f.positions,n,f.spacing));}
 const n=f.neighbors.slice();n[0]=-1;assert.ok(pressureInputError(f.positions,n,f.spacing));
 assert.ok(pressureInputError(new Float32Array((PRESSURE_LIMITS.particles+1)*4),new Float32Array(0),.1));
 const gpu=new BoundedPressureGPU(renderer);assert.throws(()=>gpu.solve(p,f.neighbors,f.spacing),/Invalid/);gpu.dispose();
});
test('draw work is capped and covers each output row exactly once',()=>{
 for(const n of [1,63,64,65,2048,2049,13293,32768]){
  const ranges=pressureDrawRanges(n);let y=0;
  for(const r of ranges){assert.equal(r.y,y);assert.ok(r.height*64<=PRESSURE_LIMITS.perDraw);y+=r.height;}
  assert.equal(y,Math.ceil(n/64));
 }
});
test('GPU validation rejects nonfinite outputs, changed flags and displaced held water',()=>{
 const f=pressureFixtures()[0],actual=f.positions.slice();assert.ok(pressureComparison(actual,f.positions,f.positions,f.spacing).pass);
 actual[1]+=.000001;assert.equal(pressureComparison(actual,f.positions,f.positions,f.spacing).pass,false);
 actual.set(f.positions);actual[7]=1;assert.equal(pressureComparison(actual,f.positions,f.positions,f.spacing).pass,false);
 actual[0]=NaN;assert.equal(pressureComparison(actual,f.positions,f.positions,f.spacing).pass,false);
});

import {PressureBudget} from '../src/sand-lab/pressure-budget.js';
import {canUsePressureGeometry} from '../src/sand-lab/pressure-geometry-gpu.js';
test('offload requires measured savings and latches a slowdown without repeated probes',()=>{
 const budget=new PressureBudget();assert.equal(budget.accepts(3024),false);assert.equal(budget.ready,false);
 for(const ms of [200,40,42,38])budget.recordCPU(ms,13293);
 assert.equal(budget.cpuMs,40);assert.equal(budget.ready,true);assert.equal(budget.accepts(30000),false);
 for(const ms of [22,24,23])budget.recordGPU(ms);assert.equal(budget.reason,null);
 for(const ms of [48,44,45])budget.recordGPU(ms);assert.ok(budget.reason);assert.equal(budget.accepts(13293),false);
 for(let i=0;i<10;i++)budget.recordCPU(1000,13293);assert.equal(budget.accepts(13293),false);
});
test('complex or oversized scenes select CPU before any new GPU work',()=>{
 const lab=new SandLab(renderer,{boulders:true,physicalResolution:true}),gpu=new BoundedPressureGPU({...renderer,capabilities:{maxTextureSize:16384}}),f=pressureFixtures()[0];
 gpu.validated=gpu.geometryValidated=true;gpu.run=forbidden;
 assert.equal(canUsePressureGeometry(lab),true);
 lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);lab.sand.update();lab.syncUniforms();
 assert.equal(canUsePressureGeometry(lab),false);assert.ok(gpu.solve(f.positions,f.neighbors,.14,3,q=>lab.collide(q),q=>lab.solid(q),lab).every(Number.isFinite));
 // Probe only routing for an oversized count; no giant solver/test allocation.
 const big=new Float32Array((PRESSURE_LIMITS.particles+1)*4);let calls=0;gpu.cpuSolve=p=>{calls++;return p;};assert.equal(gpu.solve(big,new Float32Array(),.14,3,undefined,undefined,lab),big);assert.equal(calls,1);
 lab.configure('ocean');while(lab.balls.length<17)lab.balls.push(makeBody('glass','sphere',.1,[0,1,0]));lab.syncUniforms();assert.equal(canUsePressureGeometry(lab),false);
 gpu.solve(f.positions,f.neighbors,.14,3,q=>lab.collide(q),q=>lab.solid(q),lab);assert.equal(calls,2);gpu.dispose();lab.gpu.dispose();
});
test('a failed GPU step falls back once and is never dispatched again',()=>{
 const lab=new SandLab(renderer,{boulders:true,physicalResolution:true}),gpu=new BoundedPressureGPU({...renderer,capabilities:{maxTextureSize:16384}}),f=pressureFixtures()[0];let draws=0,cpu=0;
 gpu.validated=gpu.geometryValidated=true;gpu.run=()=>{draws++;throw Error('GPU pressure time budget exceeded.');};gpu.cpuSolve=p=>{cpu++;return p;};
 for(let i=0;i<3;i++)assert.equal(gpu.solve(f.positions,f.neighbors,.14,3,q=>q,q=>1,lab),f.positions);
 assert.equal(draws,1);assert.equal(cpu,3);assert.equal(gpu.geometryValidated,false);assert.match(gpu.backend,/CPU/);gpu.dispose();lab.gpu.dispose();
});
test('live opt-in routes pressure textures to transport without the old object shader',()=>{
 const lab=new SandLab(renderer,{boulders:true,physicalResolution:true}),f=pressureFixtures()[0],p=f.positions;let calls=0;
 lab.optimizations.gpuPressure=true;lab.gpu.contactGeometry=lab;lab.gpu.nativeDensity=true;
 lab.gpu.boundedPressure={backend:'bounded GPU test',solve:(...args)=>{calls++;assert.equal(args[6],lab);return p.slice();},dispose:()=>{}};
 assert.equal(lab.gpu.cpuContacts,true);const actual=lab.gpu.solve(p,.14,q=>q,3,q=>1,false,true);
 assert.deepEqual(actual,p);assert.equal(calls,1);assert.equal(lab.gpu.constraintBackend,'bounded GPU test');assert.deepEqual(lab.gpu.resultTexture.image.data.slice(0,p.length),p);
 lab.optimizations.gpuPressure=false;lab.gpu.solve(p,.14,q=>q,3,null);assert.equal(calls,1);assert.equal(lab.gpu.constraintBackend,'WebAssembly CPU');
 lab.gpu.dispose();
});
