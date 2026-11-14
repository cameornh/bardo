import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BeachFieldGrid} from '../src/rtx-sand-lab/fields/grid.js';
import {FieldTransfer,setTransferKernel} from '../src/rtx-sand-lab/fields/native-transfer.js';
import {setBatchKernel,batchedDeposit,batchedAir,batchedTransport,installFieldBatch} from '../src/rtx-sand-lab/fields/batch/grid.js';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
const file=p=>readFile(new URL('../src/'+p,import.meta.url));
await setBatchKernel(await file('rtx-sand-lab/fields/batch/grid.wasm'));
await setTransferKernel(await file('rtx-sand-lab/fields/kernels/transfer.wasm'));
test('incomplete kernel is rejected without replacing the working module',async()=>{
 await assert.rejects(setBatchKernel(await file('rtx-sand-lab/fields/kernels/transfer.wasm')),/Incomplete CPU grid kernel/);
 await assert.rejects(setBatchKernel(new Uint8Array([0])),WebAssembly.CompileError);
});
test('compiled face batch is identical across walls, shallow water, spray, held markers and anisotropic grids',()=>{
 for(const dims of [[3,4,5],[12,8,9]]){
  const options={dims,h:1,origin:[-1,-.5,-1],extent:dims.map((v,k)=>v*(.7+k*.13))},a=new BeachFieldGrid(options),b=new BeachFieldGrid(options);
  a.nativeTransfer=new FieldTransfer();b.nativeTransfer=new FieldTransfer();b.deposit=batchedDeposit;b.buildAirVelocity=batchedAir;b.transport=batchedTransport;
  for(let iteration=0;iteration<8;iteration++){
   const n=iteration===6?1025:iteration===7?0:511,scale=2,spacing=.3,dt=iteration%2?.033:.066;
   const p=Float32Array.from({length:n*4},(_,i)=>i%4===3?(i%68===3?1:0):i%4===0?(Math.floor(i/4)%11-1)*.29:i%4===1?(Math.floor(i/44)%5-1)*.29:(Math.floor(i/220)%8-1)*.29),next=p.map((v,i)=>i%4===3?v:v+Math.sin(i*.17)*dt*.4);
   const args=[p,next,dt,scale,spacing,p=>p[1]+.12*Math.sin(p[0])+iteration*.03,p=>[Math.sin(p[2]+iteration)*10,.3,Math.cos(p[0])*.3],p=>[p[2]*.1,.03,-.05]];
   const ra=a.deposit(...args),rb=b.deposit(...args);assert.deepEqual(rb,ra,'rhs');
   for(const key of ['phase','fill','particleCell','temperature','humidity','ledger'])assert.deepEqual(b[key],a[key],key);
   for(let i=0;i<3;i++)for(const key of ['velocity','before','weight','wall','valid','coefficient'])assert.deepEqual(b.faces[i][key],a.faces[i][key],key);
   const phi=Float64Array.from(a.phase,(_,i)=>Math.sin(i*.33)*.001);a.project(phi,dt);b.project(phi,dt);
   assert.deepEqual(b.transfer(p,next,dt,scale,spacing),a.transfer(p,next,dt,scale,spacing));
   a.buildAirVelocity();b.buildAirVelocity();assert.deepEqual(b.airVelocity,a.airVelocity);assert.deepEqual(b.airValid,a.airValid);
   a.transport(dt);b.transport(dt);assert.deepEqual(b.temperature,a.temperature);assert.deepEqual(b.humidity,a.humidity);assert.deepEqual(b.ledger,a.ledger);
  }
 }
});
test('no compiled transfer uses the unmodified reference and live toggles leave snapshots alone',()=>{
 const a=new BeachFieldGrid(),b=new BeachFieldGrid();b.deposit=batchedDeposit;
 const args=[new Float32Array([0,1,0,0]),new Float32Array([0,.99,0,0]),.03,1,.3,p=>p[1],()=>[1,0,0]];
 assert.deepEqual(b.deposit(...args),a.deposit(...args));assert.equal(b.faceBatch,undefined);
 const lab={bulkFields:{grid:b},optimizations:{}};installFieldLocality(lab);installFieldBatch(lab);
 assert.equal(b.deposit,batchedDeposit);lab.optimizations.fieldBatch=false;lab.bulkFields.configureTopology(b);assert.equal(b.deposit,BeachFieldGrid.prototype.deposit);
 assert.equal(new BeachFieldGrid().deposit,BeachFieldGrid.prototype.deposit);
});
test('standalone scalar/air batch preserves nonuniform fields, CFL substeps and heat/vapour accounting',()=>{
 const a=new BeachFieldGrid({dims:[7,6,5],h:1}),b=new BeachFieldGrid({dims:[7,6,5],h:1});b.buildAirVelocity=batchedAir;b.transport=batchedTransport;
 for(const g of [a,b]){
  g.setPhase(Uint8Array.from(g.coords,([x,y,z])=>x===3&&z===2?0:y<3?1:2));
  g.temperature.set(Float64Array.from(g.phase,(_,i)=>282+Math.sin(i*.31)*8));g.humidity.set(Float64Array.from(g.phase,(_,i)=>.01+Math.sin(i*.19)*.002));
  for(const f of g.faces)f.velocity.set(Float64Array.from(f.velocity,(_,i)=>Math.sin(i*.7)*4));
 }
 for(let i=0;i<8;i++){
  a.buildAirVelocity();b.buildAirVelocity();assert.deepEqual(b.airVelocity,a.airVelocity);assert.deepEqual(b.airValid,a.airValid);
  a.transport(.09);b.transport(.09);for(const key of ['temperature','humidity','ledger','time'])assert.deepEqual(b[key],a[key],key);
 }
 const before=b.temperature.slice(),ledger={...b.ledger},time=b.time;
 assert.throws(()=>a.transport(2),/CFL budget/);assert.throws(()=>b.transport(2),/CFL budget/);
 assert.deepEqual(b.temperature,before);assert.deepEqual(b.ledger,ledger);assert.equal(b.time,time);
});
test('full live physics matches through toggles, edits, moving bodies, brush, rain and reset',async()=>{
 const {LiveSandLab}=await import('../src/rtx-sand-lab/live-lab.js');
 const {makeBody}=await import('../src/sand-lab/objects.js');
 const {setTransportKernel}=await import('../src/rtx-sand-lab/fields/native-transport.js');
 const {setPressureKernel}=await import('../src/rtx-sand-lab/fields/native-pressure.js');
 const {setNeighborKernel}=await import('../src/sand-lab/native-neighbors.js');
 const {setDensityKernel}=await import('../src/sand-lab/native-density.js');
 for(const [set,path] of [[setTransportKernel,'rtx-sand-lab/fields/kernels/transport.wasm'],[setPressureKernel,'rtx-sand-lab/fields/kernels/pressure.wasm'],[setNeighborKernel,'sand-lab/kernels/neighbors.wasm'],[setDensityKernel,'sand-lab/kernels/density.wasm']])await set(await file(path));
 const make=()=>{const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1;lab.configure('ocean');lab.wind=12;lab.tidesEnabled=false;lab.detail.enabled=false;lab.detail.advance=()=>{};lab.grains={advance(){},reset(){}};lab.seaFoam=null;lab.bulkFields.publishAir=()=>{};Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true});installFieldLocality(lab);return lab;};
 const a=make(),b=make();installFieldBatch(b);
 for(let round=0;round<2;round++){
  if(round)for(const l of [a,b])l.configure('ocean');
  for(let step=0;step<16;step++){
   if(step===3)for(const l of [a,b]){l.sand.carve([.4,l.sand.height(.4,3),3],.2);l.sand.update();const cup=makeBody('glass','cup',.18,[0,1.5,1]);cup.tilt=.5;cup.velocity=[.1,0,0];l.balls.push(cup);l.setPlayer([.5,1.6,2],[.1,0,0],.028,.165);}
   for(const l of [a,b]){l.rain.enabled=step>6;l.rain.rate=120;l.jet=step>9?{origin:[0,1,1],direction:[1,.1,0]}:null;}
   b.optimizations.fieldBatch=step%4!==0;a.step(a.timestep);b.step(b.timestep);
   for(const key of ['positions','velocities','chem','balls'])assert.deepEqual(b[key],a[key],key);
   for(const key of ['mass','wet','memory','packing','parcels'])assert.deepEqual(b.sand[key],a.sand[key],key);
   for(const key of ['temperature','humidity','pressure','airVelocity','ledger'])assert.deepEqual(b.bulkFields.grid[key],a.bulkFields.grid[key],key);
   assert.equal(b.time,a.time);
  }
 }a.gpu.dispose();b.gpu.dispose();
});
