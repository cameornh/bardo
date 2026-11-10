import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FieldPressure,setPressureKernel} from '../src/rtx-sand-lab/fields/native-pressure.js';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {loadSIMDKernel,simdKernel} from '../src/rtx-sand-lab/simd/kernels.js';
import {BeachFieldGrid,AIR,WATER} from '../src/rtx-sand-lab/fields/grid.js';
import {buildNeighbors,collideBoundary} from '../src/sand-lab/water-lab-model.js';
import {makeBody,bodyDistance} from '../src/sand-lab/objects.js';
import {SandLab} from '../src/sand-lab/lab.js';
const file=p=>readFile(new URL('../src/'+p,import.meta.url));
await setPressureKernel(await file('rtx-sand-lab/fields/kernels/pressure.wasm'));
await setDensityKernel(await file('sand-lab/kernels/density.wasm'));
for(const name of ['pressure','density'])assert.equal(await loadSIMDKernel(name,await file('rtx-sand-lab/simd/'+name+'.wasm')),true);

test('SIMD pressure retains exact f64 results and iterations across odd tails, masks, resizing and initial guesses',()=>{
 const scalar=new FieldPressure(),simd=new FieldPressure(simdKernel('pressure'),'SIMD');
 for(const dims of [[3,3,3],[8,6,9],[17,9,13],[4,4,4]]){
  const g=new BeachFieldGrid({dims,h:1,extent:dims.map((n,k)=>n*(1+k*.13))});
  for(const level of [1,3]){
   g.setPhase(Uint8Array.from(g.coords,c=>c[0]===2&&c[1]===1?0:c[1]<level?WATER:AIR));
   for(const zero of [true,false])for(const initial of [undefined,new Float64Array(g.count).fill(.001)]){
    const rhs=Float64Array.from({length:g.count},(_,i)=>g.phase[i]&&!zero?Math.sin(i*.31)*.1:0),opts={initial,tolerance:1e-7};
    const a=scalar.solve(g.levels,rhs,opts),b=simd.solve(g.levels,rhs,opts);
    assert.deepEqual(b.potential,a.potential);assert.equal(a.iterations,b.iterations);assert.equal(a.relativeResidual,b.relativeResidual);assert.ok(b.potential.every(Number.isFinite));
   }
  }
 }
});
test('unsupported SIMD module leaves scalar fallback available and precondition=false retains reference solver',async()=>{
 assert.equal(await loadSIMDKernel('unsupported',new Uint8Array([0])),false);assert.equal(simdKernel('unsupported'),null);
 const g=new BeachFieldGrid({dims:[3,3,3],h:1});g.setPhase(new Uint8Array(27).fill(AIR));
 assert.equal(new FieldPressure(simdKernel('unsupported')).solve(g.levels,new Float64Array(27)).backend,'WebAssembly CPU multigrid-PCG');
 assert.equal(new FieldPressure(simdKernel('pressure')).solve(g.levels,new Float64Array(27),{precondition:false}).backend,'CPU diagonal-PCG');
});
test('SIMD reciprocal pair forces exactly match scalar with held markers, odd counts and cups',()=>{
 const scalar=new NativeDensity(),simd=new NativeDensity(simdKernel('density')),cup=makeBody('glass','cup',.3,[0,.2,0]);cup.pitch=.5;cup.tilt=.7;
 const solid=p=>Math.min((p[1]+.1-.2*p[0])*.65,bodyDistance(p,cup));
 for(const n of [0,1,37,175,420,63])for(const steps of [1,3,5])for(const boundary of [null,solid]){
  const p=Float32Array.from({length:n*4},(_,i)=>i%4===3?(i%36===3?1:0):((i%4===0?Math.floor(i/4)%7:i%4===1?Math.floor(i/28)%5:Math.floor(i/140))-2.3)*.13);
  const neighbors=buildNeighbors(p,.14).data,collide=q=>collideBoundary(q,.14*.12,solid);
  const a=scalar.solve(p,neighbors,.14,steps,collide,boundary),b=simd.solve(p,neighbors,.14,steps,collide,boundary);
  assert.deepEqual(b,a);assert.ok(b.every(Number.isFinite));
 }
});
test('SIMD active surface mask and compiled contacts preserve carved wet sand, player and tilted cups',()=>{
 const lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true});
 Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true,adaptivePressure:true});
 const cup=makeBody('glass','cup',.27,[.2,1.1,2.8]);cup.tilt=.63;cup.pitch=.41;lab.balls.push(cup);lab.setPlayer([.5,1.6,2],[.1,0,0],.028,.165);
 lab.sand.extract([0,lab.sand.height(0,3),3],.2,[0,0,0],true);lab.sand.update();lab.syncUniforms();
 const p=Float32Array.from({length:255*4},(_,i)=>i%4===3?(i%28===3?1:0):i%4===0?(Math.floor(i/4)%6-3)*.13:i%4===1?.2+Math.floor(i/24)%5*.12:Math.floor(i/120)*.13-.4);
 const neighbors=buildNeighbors(p,lab.spacing).data,a=new NativeDensity(),b=new NativeDensity(simdKernel('density'));
 assert.deepEqual(b.solve(p,neighbors,lab.spacing,5,q=>lab.collide(q),q=>lab.solid(q),lab),a.solve(p,neighbors,lab.spacing,5,q=>lab.collide(q),q=>lab.solid(q),lab));
 assert.deepEqual(b.activeCounts,a.activeCounts);lab.gpu.dispose();
});

test('live scalar/SIMD switching preserves complete CPU state through edits, moving bodies and reset',async()=>{
 const {LiveSandLab}=await import('../src/rtx-sand-lab/live-lab.js');
 const {setTransferKernel}=await import('../src/rtx-sand-lab/fields/native-transfer.js');
 const {setTransportKernel}=await import('../src/rtx-sand-lab/fields/native-transport.js');
 const {setNeighborKernel}=await import('../src/sand-lab/native-neighbors.js');
 await setTransferKernel(await file('rtx-sand-lab/fields/kernels/transfer.wasm'));
 await setTransportKernel(await file('rtx-sand-lab/fields/kernels/transport.wasm'));
 await setNeighborKernel(await file('sand-lab/kernels/neighbors.wasm'));
 const make=()=>{
  const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});
  lab.resolutions.ocean=1;lab.configure('ocean');lab.wind=12;lab.tidesEnabled=false;lab.detail.enabled=false;
  lab.detail.advance=()=>{};lab.grains={advance(){},reset(){}};lab.seaFoam=null;lab.bulkFields.publishAir=()=>{};
  Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true});return lab;
 };
 const a=make(),b=make();
 for(let round=0;round<2;round++){
  if(round)for(const l of [a,b])l.configure('ocean');
  for(let step=0;step<16;step++){
   if(step===3)for(const l of [a,b]){
    const chunks=l.sand.extract([0,l.sand.height(0,3),3],.2,[0,0,0],true);for(const p of chunks){p.held=false;p.position[1]+=.3;}
    l.sand.carve([.4,l.sand.height(.4,3),3],.12);l.sand.update();
    const ball=makeBody('glass','cup',.18,[0,1.5,1]);ball.tilt=.5;ball.velocity=[.1,0,0];l.balls.push(ball);
   }
   b.optimizations.simdPressure=step%4!==0;b.optimizations.simdParticles=step%3!==0;
   a.step(a.timestep);b.step(b.timestep);
   for(const key of ['positions','velocities','chem'])assert.deepEqual(b[key],a[key],key);
   for(const key of ['mass','wet','memory','packing','parcels'])assert.deepEqual(b.sand[key],a.sand[key],key);
   for(const key of ['temperature','humidity','pressure'])assert.deepEqual(b.bulkFields.grid[key],a.bulkFields.grid[key],key);
   assert.deepEqual(b.balls,a.balls);assert.equal(b.time,a.time);
  }
 }
 a.gpu.dispose();b.gpu.dispose();
});
