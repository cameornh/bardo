import test from 'node:test';
import assert from 'node:assert/strict';
import {BeachFieldGrid,WATER,AIR} from '../src/rtx-sand-lab/fields/grid.js';
import {multiply,solveMultigrid,norm} from '../src/rtx-sand-lab/fields/multigrid.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {MATERIAL} from '../src/fluid-fields/model.js';
import {readFile} from 'node:fs/promises';
import {setDensityKernel} from '../src/sand-lab/native-density.js';
import {surfaceConstraints} from '../src/rtx-sand-lab/fields/surface-constraints.js';
import {buildNeighbors} from '../src/sand-lab/water-lab-model.js';
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
function fixture(dims=[12,10,8]){const g=new BeachFieldGrid({dims,h:1,origin:[0,0,0]});g.setPhase(Uint8Array.from({length:g.count},(_,i)=>g.coords[i][0]===5&&g.coords[i][1]<6?0:g.coords[i][1]<4?WATER:AIR));return g;}
test('variable-density pressure is symmetric positive definite across the real air/water interface',()=>{
 const g=fixture(),a=Float64Array.from({length:g.count},(_,i)=>Math.sin(i*.1)),b=a.map((_,i)=>Math.cos(i*.3)),aa=multiply(g.levels[0],a),ab=multiply(g.levels[0],b),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 close(dot(a,ab),dot(aa,b),1e-7);assert.ok(dot(a,aa)>0);
 assert.ok(g.faces.some(f=>f.coefficient.some((w,i)=>w>0&&g.phase[f.a[i]]===WATER&&g.phase[f.b[i]]===AIR)),'moving interface cannot be a rigid lid');
});
test('multigrid recovers manufactured pressure on an irregular two-density domain',()=>{
 const g=fixture(),exact=Float64Array.from({length:g.count},(_,i)=>g.phase[i]?Math.sin(i*.13):0),rhs=multiply(g.levels[0],exact),r=solveMultigrid(g.levels,rhs,{tolerance:1e-9,iterations:120});
 assert.ok(r.relativeResidual<1e-8);assert.ok(norm(r.potential.map((v,i)=>v-exact[i]))<1e-5);
 const diagonal=solveMultigrid(g.levels,rhs,{tolerance:1e-9,iterations:300,precondition:false});assert.ok(r.iterations<diagonal.iterations);
});
test('projection removes divergence and respects solids while sharing interface flux',()=>{
 const g=fixture();for(const f of g.faces)for(let i=0;i<f.velocity.length;i++)f.velocity[i]=f.coefficient[i]?Math.sin(i*.12)*.4:0;
 const before=norm(g.divergence()),r=g.solve(g.rhs(),.05);assert.ok(r.relativeResidual<3e-5);assert.ok(norm(g.divergence())<before*3e-5);
 for(const f of g.faces)for(let i=0;i<f.velocity.length;i++)if(!f.coefficient[i])close(f.velocity[i],0);
});
test('sealed disconnected water regions receive independent pressure gauges',()=>{
 const g=new BeachFieldGrid({dims:[10,8,8],h:1,origin:[0,0,0]});g.setPhase(Uint8Array.from({length:g.count},(_,i)=>{const [x,y,z]=g.coords[i];return y&&y<7&&z&&z<7&&x&&x<9&&x!==5?WATER:0;}));
 assert.equal(g.closed.length,2);for(const f of g.faces)for(let i=0;i<f.velocity.length;i++)if(f.coefficient[i])f.velocity[i]=Math.sin(i)*.1;
 g.solve(g.rhs(),.05);assert.ok(norm(g.divergence())<1e-5);
});
test('heat exchange conserves energy across density contrast and keeps humidity out of water',()=>{
 const g=fixture();for(let i=0;i<g.count;i++)g.temperature[i]=g.phase[i]===WATER?310:280;
 const before=g.totals();for(let i=0;i<100;i++)g.transport(.05);const after=g.totals();close(after.heat/before.heat,1,1e-12);close(after.vapour,before.vapour,1e-12);
 for(let i=0;i<g.count;i++){assert.ok(g.temperature[i]>=280&&g.temperature[i]<=310);if(g.phase[i]!==AIR)close(g.humidity[i],0);}
});
test('moving mask accounts for displaced heat and vapour rather than silently losing them',()=>{
 const g=fixture(),before=g.totals(),ledger={...g.ledger},phase=g.phase.slice();for(let i=0;i<g.count;i++)if(g.coords[i][1]===4)phase[i]=WATER;g.setPhase(phase);const after=g.totals();close(after.heat-before.heat,g.ledger.remapHeat-ledger.remapHeat,.01);close(after.vapour-before.vapour,g.ledger.remapVapour-ledger.remapVapour,1e-10);
});
test('open-air scalar transport balances the boundary ledger',()=>{
 const g=new BeachFieldGrid({dims:[8,6,6],h:1,origin:[0,0,0]});g.setPhase(g.phase.slice());for(const f of g.faces)f.velocity.fill(f.axis===0?.1:0);g.humidity.fill(.015);g.temperature.fill(302);const before=g.totals();for(let i=0;i<30;i++)g.transport(.04);const after=g.totals();close(after.heat-before.heat,g.ledger.boundaryHeat,.001);close(after.vapour-before.vapour,g.ledger.boundaryVapour,1e-10);assert.ok(g.humidity.every(v=>v>=0));
});
test('diagonal high-speed advection keeps scalars bounded and preserves a uniform field',()=>{
 const g=new BeachFieldGrid({dims:[8,6,6],h:1,origin:[0,0,0]});g.setPhase(g.phase.slice());g.temperature.fill(293.15);g.humidity.fill(.01);
 for(const f of g.faces)f.velocity.fill(7);g.humidity[80]=.02;
 for(let i=0;i<20;i++)g.transport(.06);
 assert.ok(g.humidity.every(v=>v>=0&&v<=.0200001));assert.ok(g.temperature.every(v=>Math.abs(v-293.15)<1e-9));
});
test('particle transfer leaves held and out-of-grid spray untouched, changes velocity without changing mass',()=>{
 const g=new BeachFieldGrid({dims:[8,6,6],h:1,origin:[0,0,0]}),p=new Float32Array([2.5,2.5,2.5,0,3.5,2.5,2.5,1,20,20,20,0]),next=p.slice();next[1]-=.01;next[9]-=.01;
 const rhs=g.deposit(p,next,.05,1,1,()=>1,()=>[0,0,0]);g.solve(rhs,.05);const out=g.transfer(p,next,.05,1,1);assert.equal(out.length,p.length);assert.deepEqual(out.slice(4,8),p.slice(4,8));assert.deepEqual(out.slice(8),next.slice(8));assert.ok(out.every(Number.isFinite));
});
test('snapshots and previous live fixtures do not opt into the new solver',()=>{
 const r={extensions:{has:()=>false}};assert.equal(new SandLab(r).bulkFields,undefined);assert.equal(new LiveSandLab(r).bulkFields,undefined);assert.ok(new LiveSandLab(r,{bulkFields:true}).bulkFields.enabled);
});
test('full beach CPU pipeline advances with coupled pressure and preserves water parcels',()=>{
 const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1;lab.configure('ocean');lab.wind=0;lab.tidesEnabled=false;lab.lunarCycle=false;lab.detail.enabled=false;
 const count=lab.count;for(let i=0;i<3;i++)lab.step(lab.timestep);
 assert.equal(lab.count,count);assert.ok(lab.positions.every(Number.isFinite));assert.ok(lab.bulkFields.stats.coupled>count*.8);assert.ok(lab.bulkFields.stats.relativeResidual<1e-3);assert.ok(lab.bulkFields.grid.temperature.every(Number.isFinite));
 const fields=lab.bulkFields;lab.configure('ocean');assert.equal(fields.grid,null);assert.equal(lab.bulkFields,fields);
});
test('rain and existing capillary drops share field temperatures without enabling sand condensation',()=>{
 const lab=new LiveSandLab({extensions:{has:()=>false}},{bulkFields:true});lab.bulkFields.ensure();const f=lab.bulkFields,g=f.grid;g.setPhase(new Uint8Array(g.count).fill(AIR));g.temperature.fill(300);
 const point=[0,3,0],body={position:[0,3,0],radius:1},p={volume:.0001,temperature:280};lab.rain.surfaceDrops.patches.set('test',p);lab.rain.surfaceDrops.frame=()=>({point,normal:[0,1,0]});
 const before=g.totals().heat,capacity=p.volume*lab.spec.scale**3*MATERIAL[WATER].density*MATERIAL[WATER].heatCapacity;f.thermal(.1);
 assert.ok(p.temperature>280);assert.ok(p.ambientHumidity>0);close((g.totals().heat-before)+(p.temperature-280)*capacity,0,.01);
});
test('native surface band matches the JS reference including held parcels and reciprocal interior forces',async()=>{
 await setDensityKernel(await readFile(new URL('../src/sand-lab/kernels/density.wasm',import.meta.url)));
 const g=new BeachFieldGrid({dims:[8,8,8],h:.3,origin:[0,0,0]});g.setPhase(Uint8Array.from({length:g.count},(_,i)=>g.coords[i][1]<5?WATER:AIR));
 const positions=new Float32Array(5*5*5*4);let at=0;for(let z=0;z<5;z++)for(let y=0;y<5;y++)for(let x=0;x<5;x++)positions.set([.7+x*.12,1+y*.12,.7+z*.12,at++===0?1:0],(at-1)*4);
 const neighbors=buildNeighbors(positions,.18).data,lab={spacing:.18,spec:{scale:1},solid:()=>10,collide:p=>p};
 const a=surfaceConstraints(lab,positions,neighbors,g,{native:false}),b=surfaceConstraints(lab,positions,neighbors,g);
 assert.equal(b.backend,'WebAssembly CPU');assert.ok(a.active>0&&a.active<positions.length/4);assert.equal(b.active,a.active);
 let error=0;for(let i=0;i<positions.length;i++)error=Math.max(error,Math.abs(a.positions[i]-b.positions[i]));assert.ok(error<2e-6,`${error}`);assert.deepEqual(b.positions.slice(0,4),positions.slice(0,4));
});
test('batched beach terrain and boulder contacts match the surface reference',()=>{
 const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1;lab.configure('ocean');Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true});lab.wind=0;lab.tidesEnabled=false;
 const context=lab.prepareStep(lab.timestep);lab.bulkFields.prepare(context);const neighbors=lab.gpu.neighborList(context.predicted,lab.spacing).data;
 const a=surfaceConstraints(lab,context.predicted,neighbors,lab.bulkFields.grid,{native:false}),b=surfaceConstraints(lab,context.predicted,neighbors,lab.bulkFields.grid);
 let error=0;for(let i=0;i<a.positions.length;i++)error=Math.max(error,Math.abs(a.positions[i]-b.positions[i]));assert.ok(error<2e-5,`${error}`);
});
