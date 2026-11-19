import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
import {setBatchKernel,installFieldBatch} from '../src/rtx-sand-lab/fields/batch/grid.js';
import {setTransferKernel} from '../src/rtx-sand-lab/fields/native-transfer.js';
import {setContactKernel,installContactBatch} from '../src/rtx-sand-lab/fields/contact-batch/install.js';
const file=p=>readFile(new URL('../src/'+p,import.meta.url));
await setTransferKernel(await file('rtx-sand-lab/fields/kernels/transfer.wasm'));
await setBatchKernel(await file('rtx-sand-lab/fields/batch/grid.wasm'));
await setContactKernel(await file('rtx-sand-lab/fields/contact-batch/density.wasm'));
test('invalid contact module is rejected',async()=>{await assert.rejects(setContactKernel(await file('rtx-sand-lab/fields/batch/grid.wasm')),/Incomplete contact kernel/);});
test('full live physics matches through toggles, edits, moving bodies, brush, rain and reset',async()=>{
 const {LiveSandLab}=await import('../src/rtx-sand-lab/live-lab.js');
 const {makeBody}=await import('../src/sand-lab/objects.js');
 const {setTransportKernel}=await import('../src/rtx-sand-lab/fields/native-transport.js');
 const {setPressureKernel}=await import('../src/rtx-sand-lab/fields/native-pressure.js');
 const {setNeighborKernel}=await import('../src/sand-lab/native-neighbors.js');
 const {setDensityKernel}=await import('../src/sand-lab/native-density.js');
 for(const [set,path] of [[setTransportKernel,'rtx-sand-lab/fields/kernels/transport.wasm'],[setPressureKernel,'rtx-sand-lab/fields/kernels/pressure.wasm'],[setNeighborKernel,'sand-lab/kernels/neighbors.wasm'],[setDensityKernel,'sand-lab/kernels/density.wasm']])await set(await file(path));
 const make=()=>{const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1;lab.configure('ocean');lab.wind=12;lab.tidesEnabled=false;lab.detail.enabled=false;lab.detail.advance=()=>{};lab.grains={advance(){},reset(){}};lab.seaFoam=null;lab.bulkFields.publishAir=()=>{};Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true});installFieldLocality(lab);return lab;};
 const a=make(),b=make();installFieldBatch(a);installFieldBatch(b);installContactBatch(b);
 for(let round=0;round<2;round++){
  if(round)for(const l of [a,b])l.configure('ocean');
  for(let step=0;step<16;step++){
   if(step===3)for(const l of [a,b]){l.sand.carve([.4,l.sand.height(.4,3),3],.2);l.sand.update();const cup=makeBody('glass','cup',.18,[0,1.5,1]);cup.tilt=.5;cup.velocity=[.1,0,0];l.balls.push(cup);l.setPlayer([.5,1.6,2],[.1,0,0],.028,.165);}
   for(const l of [a,b]){l.rain.enabled=step>6;l.rain.rate=120;l.jet=step>9?{origin:[0,1,1],direction:[1,.1,0]}:null;}
   b.optimizations.contactHeightReuse=step%4!==0;a.step(a.timestep);b.step(b.timestep);
   for(const key of ['positions','velocities','chem','balls'])assert.deepEqual(b[key],a[key],key);
   for(const key of ['mass','wet','memory','packing','parcels'])assert.deepEqual(b.sand[key],a.sand[key],key);
   for(const key of ['temperature','humidity','pressure','airVelocity','ledger'])assert.deepEqual(b.bulkFields.grid[key],a.bulkFields.grid[key],key);
   assert.equal(b.time,a.time);
  }
 }a.gpu.dispose();b.gpu.dispose();
});
test('isolated contact source differs only by identical vertical height reuse',async()=>{
 const original=(await file('sand-lab/kernels/contact-geometry.ts')).toString();let expected=original.replace('function solid(x:f64,y:f64,z:f64,g:usize):f64{\n let d=(y-height(x,z,g))*.65;','function solid(x:f64,y:f64,z:f64,g:usize,bed:f64):f64{\n let d=(y-bed)*.65;').replace('const d=solid(x,y,z,g);','const bed=height(x,z,g),d=solid(x,y,z,g,bed);');
 for(const [x,y,z] of [['x','y+e','z'],['x','y-e','z']])expected=expected.replace(`solid(${x},${y},${z},g)`,`solid(${x},${y},${z},g,bed)`);
 for(const [x,y,z] of [['x+e','y','z'],['x-e','y','z'],['x','y','z+e'],['x','y','z-e']])expected=expected.replace(`solid(${x},${y},${z},g)`,`solid(${x},${y},${z},g,height(${x},${z},g))`);
 const actual=(await file('rtx-sand-lab/fields/contact-batch/contact-geometry.ts')).toString();assert.equal(actual.slice(actual.indexOf('@inline')),expected);
 assert.deepEqual(await file('rtx-sand-lab/fields/contact-batch/batched-contact.ts'),await file('sand-lab/kernels/batched-contact.ts'));
});
