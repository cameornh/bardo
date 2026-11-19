import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
import {setBatchKernel,installFieldBatch} from '../src/rtx-sand-lab/fields/batch/grid.js';
import {setTransferKernel} from '../src/rtx-sand-lab/fields/native-transfer.js';
import {installSpatialCPU} from '../src/rtx-sand-lab/fields/spatial-cpu/install.js';
import {TightNeighbors,setTightNeighborKernel,tightNeighborsAvailable} from '../src/rtx-sand-lab/fields/spatial-cpu/neighbors.js';
import {NativeNeighbors,setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
import {SnapshotHeights} from '../src/rtx-sand-lab/fields/spatial-cpu/terrain-height.js';
import {SandBed} from '../src/sand-lab/sand.js';
const file=p=>readFile(new URL('../src/'+p,import.meta.url));
await setTransferKernel(await file('rtx-sand-lab/fields/kernels/transfer.wasm'));
await setBatchKernel(await file('rtx-sand-lab/fields/batch/grid.wasm'));
await setTightNeighborKernel(await file('rtx-sand-lab/fields/spatial-cpu/neighbors.wasm'));
await setNeighborKernel(await file('sand-lab/kernels/neighbors.wasm'));
test('full live physics matches through toggles, edits, moving bodies, brush, rain and reset',async()=>{
 const {LiveSandLab}=await import('../src/rtx-sand-lab/live-lab.js');
 const {makeBody}=await import('../src/sand-lab/objects.js');
 const {setTransportKernel}=await import('../src/rtx-sand-lab/fields/native-transport.js');
 const {setPressureKernel}=await import('../src/rtx-sand-lab/fields/native-pressure.js');
 const {setNeighborKernel}=await import('../src/sand-lab/native-neighbors.js');
 const {setDensityKernel}=await import('../src/sand-lab/native-density.js');
 for(const [set,path] of [[setTransportKernel,'rtx-sand-lab/fields/kernels/transport.wasm'],[setPressureKernel,'rtx-sand-lab/fields/kernels/pressure.wasm'],[setNeighborKernel,'sand-lab/kernels/neighbors.wasm'],[setDensityKernel,'sand-lab/kernels/density.wasm']])await set(await file(path));
 const make=()=>{const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1;lab.configure('ocean');lab.wind=12;lab.tidesEnabled=false;lab.detail.enabled=false;lab.detail.advance=()=>{};lab.grains={advance(){},reset(){}};lab.seaFoam=null;lab.bulkFields.publishAir=()=>{};Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true});installFieldLocality(lab);return lab;};
 const a=make(),b=make();installFieldBatch(a);installFieldBatch(b);installSpatialCPU(b);
 for(let round=0;round<2;round++){
  if(round)for(const l of [a,b])l.configure('ocean');
  for(let step=0;step<16;step++){
   if(step===3)for(const l of [a,b]){l.sand.carve([.4,l.sand.height(.4,3),3],.2);l.sand.update();const cup=makeBody('glass','cup',.18,[0,1.5,1]);cup.tilt=.5;cup.velocity=[.1,0,0];l.balls.push(cup);l.setPlayer([.5,1.6,2],[.1,0,0],.028,.165);}
   for(const l of [a,b]){l.rain.enabled=step>6;l.rain.rate=120;l.jet=step>9?{origin:[0,1,1],direction:[1,.1,0]}:null;}
   b.optimizations.snapshotHeights=step%4!==0;b.optimizations.tightNeighbors=step%5!==0;a.step(a.timestep);b.step(b.timestep);
   for(const key of ['positions','velocities','chem','balls'])assert.deepEqual(b[key],a[key],key);
   for(const key of ['mass','wet','memory','packing','parcels'])assert.deepEqual(b.sand[key],a.sand[key],key);
   for(const key of ['temperature','humidity','pressure','airVelocity','ledger'])assert.deepEqual(b.bulkFields.grid[key],a.bulkFields.grid[key],key);
   assert.equal(b.time,a.time);
  }
 }a.gpu.dispose();b.gpu.dispose();
});
test('occupied cell bounds retain exact ordered neighbors, dense overflow and cutoff decisions',()=>{
 const a=new NativeNeighbors(),b=new TightNeighbors();
 for(const [n,dense] of [[0,false],[1,false],[17,false],[384,true],[3024,false],[12000,false],[70,false]]){
  const p=Float32Array.from({length:n*4},(_,i)=>i%4===3?0:Math.sin(i*23.4)*(dense?.025:3));
  const expected=a.build(p,.23);assert.deepEqual(b.build(p,.23),expected);
  for(let i=0;i<p.length;i+=4)p[i]+=.000001;assert.deepEqual(b.build(p,.23),a.build(p,.23));
 }
 for(const spacing of [.01,.25,2]){
  const reach=spacing*2.65,p=new Float32Array([0,0,0,0,reach,0,0,0,-reach,0,0,0,reach-1e-7,0,0,0,-reach+1e-7,0,0,0]);
  assert.deepEqual(b.build(p,spacing),a.build(p,spacing));
 }
});
test('snapshot heights never round positions, retain stale edits, or grow past their bound',()=>{
 let bed=new SandBed(31),heights=Float64Array.from(bed.mass,(_,i)=>bed.heightAt(i));const cache=new SnapshotHeights(64);
 for(let revision=0;revision<6;revision++){
  if(revision===3){bed=new SandBed(45);heights=Float64Array.from(bed.mass,(_,i)=>bed.heightAt(i));}
  for(let i=0;i<heights.length;i++)heights[i]+=.001*Math.sin(i*7.91+revision);
  for(let pass=0;pass<2;pass++)for(let i=0;i<700;i++){
   const x=Math.sin(i*2.17)*7,z=Math.cos(i*31.81)*6;
   assert.equal(cache.sample(bed,heights,revision,x,z),bed.heightCached(x,z,heights));
   assert.equal(cache.sample(bed,heights,revision,x+1e-10,z),bed.heightCached(x+1e-10,z,heights));
  }
  assert.equal(cache.size,64);assert.ok(cache.columns.size<=64);
 }
 assert.ok(cache.hits>0);assert.equal(cache.resets,6);
});
test('height cache invalidates when the synchronized array is replaced without a revision change',()=>{
 const bed=new SandBed(17),a=Float64Array.from(bed.mass,(_,i)=>bed.heightAt(i)),b=a.map(v=>v+.5),cache=new SnapshotHeights();
 assert.equal(cache.sample(bed,a,1,0,2),bed.heightCached(0,2,a));assert.equal(cache.sample(bed,b,1,0,2),bed.heightCached(0,2,b));
});
test('missing or invalid accelerator retains the reference neighbor path',async()=>{
 const {FieldNeighbors}=await import('../src/rtx-sand-lab/fields/neighbors.js');
 await setTightNeighborKernel(null);
 try{
  await assert.rejects(setTightNeighborKernel(new Uint8Array([0,97,115,109,1,0,0,0])),/Invalid occupied-cell/);
  assert.equal(tightNeighborsAvailable(),false);
  const lab={optimizations:{},terrainHeight:()=>0,bulkFields:{neighbors:new FieldNeighbors()}};installSpatialCPU(lab);
  const p=Float32Array.from({length:800},(_,i)=>i%4===3?0:Math.sin(i*2.1));
  const expected=new FieldNeighbors().build(p,.2);
  assert.deepEqual(lab.bulkFields.neighbors.build(p,.2),expected);
 }finally{await setTightNeighborKernel(await file('rtx-sand-lab/fields/spatial-cpu/neighbors.wasm'));}
});
