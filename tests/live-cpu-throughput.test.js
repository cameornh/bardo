import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed} from '../src/sand-lab/sand.js';
import {SandAirGeometry} from '../src/sand-lab/sand-air-geometry.js';
import {LiveSandAirGeometry,installSandContactQueries} from '../src/rtx-sand-lab/sand-cpu-queries.js';
import {ParcelQueryTree} from '../src/rtx-sand-lab/parcel-query-tree.js';
import {CPUFrameStep} from '../src/rtx-sand-lab/cpu-frame-step.js';
const random=(()=>{let s=42;return ()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296);})();
function bedFixture(){const b=new SandBed(31);for(let i=0;i<240;i++)b.parcels.push({id:i+1,position:[random()*10-5,random()*2,random()*9-4.5],mass:.0005+random()*.02,packing:.56,wet:random(),aspect:.3+random()*1.7,velocity:[0,0,0],anchored:true,cuts:i%3?undefined:[{offset:[.01,0,.03],radius:.06}]});return b;}
test('live spatial wind queries match ordered exact SDF after movement, carving and deletion',()=>{
 const bed=bedFixture(),slow=new SandAirGeometry(bed,[]),fast=new LiveSandAirGeometry(bed,[]);
 for(let round=0;round<5;round++){
  if(round){for(let i=0;i<bed.parcels.length;i+=7){bed.parcels[i].position[0]+=.09;bed.parcels[i].mass*=.8;}bed.parcels.splice(3,1);}
  slow.refresh(false);fast.refresh();
  for(let i=0;i<2000;i++){const p=[random()*12-6,random()*4-1,random()*11-5.5];assert.ok(Math.abs(slow.distance(p)-fast.distance(p))<1e-12);}
 }
});
test('indexed swept sand contacts match all-parcel scan including exclusions and loose supports',()=>{
 const b=bedFixture(),reference=b.contactDistance.bind(b);installSandContactQueries(b,()=>true);
 for(let round=0;round<4;round++){
  if(round){b.parcels[12].anchored=false;b.parcels[18].position[2]+=.5;b.parcels.splice(4,1);}
  b.refreshContactQueries();
  for(let i=0;i<1500;i++){const p=[random()*11-5.5,random()*3-1,random()*10-5],radius=random()*.12,exclude=i%2?new Set([1,8,20]):3,ceiling=i%3?Infinity:1;
   assert.ok(Math.abs(b.contactDistance(p,radius,exclude,ceiling)-reference(p,radius,exclude,ceiling))<1e-12);
  }
 }
});
test('query cache is bounded by current geometry and only refits changed branches',()=>{
 const t=new ParcelQueryTree(),items=Array.from({length:1024},(_,i)=>({parcel:{},position:[i%32,Math.floor(i/32),0],radius:.2}));t.refresh(items);const builds=t.rebuilds;
 for(let i=0;i<1000;i++){items[10].position[0]+=.0001;t.refresh(items);t.query([10,0,0],.3);assert.ok(t.visits<50);}
 assert.equal(t.rebuilds,builds);assert.equal(t.nodes.length,2047);assert.equal(t.refits,1000);
 t.refresh(items.slice(0,12));assert.equal(t.nodes.length,23);
});
function fakeLab(){const order=[],l={generation:1,optimizations:{gpuBatch:true},bulkFields:{enabled:true,backend:'cpu',particleBackend:'cpu',solve(c,opts){assert.equal(opts.deferConsumers,true);order.push('cpu');return [2];},publishAir(){order.push('air');}},gpu:{cpu:false},count:3,enabled:true,paused:false,timestep:1/15,accumulator:1/15,completedDt:0,prepareStep(dt){order.push('prepare');return {dt,start:performance.now(),generation:l.generation};},finishStep(c,n){order.push('publish');assert.deepEqual(n,[2]);}};return {l,order};}
test('CPU frame overlap preserves one step and publishes graphics only after explicit completion',async()=>{
 const {l,order}=fakeLab(),step=new CPUFrameStep(l);assert.equal(step.begin(),true);const pending=l.asyncPending;assert.equal(step.begin(),false);step.compute();step.compute();assert.deepEqual(order,['prepare','cpu']);assert.equal(l.completedDt,0);step.publish();await pending;
 assert.deepEqual(order,['prepare','cpu','air','publish']);assert.equal(l.completedDt,l.timestep);assert.equal(l.accumulator,0);assert.equal(l.asyncPending,null);
});
test('reset/context failure never publishes a deferred CPU solve or consumes extra dt',async()=>{
 for(const fail of ['reset','graphics']){const {l,order}=fakeLab(),step=new CPUFrameStep(l);step.begin();const pending=l.asyncPending;step.compute();if(fail==='reset')l.generation++;else l.graphicsStopped=true;step.publish();await pending;assert.deepEqual(order,['prepare','cpu']);assert.equal(l.completedDt,0);assert.equal(step.begin(),false);}
});

test('catch-up uses at most two earned steps and keeps graphics consumers outside compute',()=>{
 for(const earned of [1,2,7]){
  const {l,order}=fakeLab();l.optimizations.cpuCatchup=true;l.accumulator=l.timestep*earned;
  l.finishCPUFieldStep=()=>order.push('cpu-finish');l.publishCPUFieldSteps=dt=>{order.push('visual-publish');assert.equal(dt,l.timestep*Math.min(2,earned));};
  const step=new CPUFrameStep(l,{now:()=>0});step.begin();step.compute();
  assert.equal(order.filter(x=>x==='cpu').length,Math.min(2,earned));assert.ok(!order.includes('visual-publish'));
  step.publish();assert.equal(l.cpuFrameSteps,Math.min(2,earned));assert.equal(l.completedDt,l.timestep*Math.min(2,earned));
  assert.ok(Math.abs(l.accumulator-l.timestep*Math.max(0,earned-2))<1e-12);
 }
 const {l}=fakeLab();let clock=0;l.optimizations.cpuCatchup=true;l.accumulator=l.timestep*3;l.finishCPUFieldStep=()=>clock+=130;l.publishCPUFieldSteps=()=>{};
 const step=new CPUFrameStep(l,{now:()=>clock});step.begin();step.compute();step.publish();assert.equal(l.cpuFrameSteps,1);
});

test('two overlapped CPU steps preserve the exact bulk, terrain, object and scalar state',async()=>{
 const {LiveSandLab}=await import('../src/rtx-sand-lab/live-lab.js');
 const make=()=>{
  const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1;lab.configure('ocean');lab.wind=12;lab.tidesEnabled=false;lab.detail.enabled=false;
  lab.detail.advance=()=>{};lab.grains={advance(){}};lab.seaFoam=null;lab.bulkFields.publishAir=()=>{};
  lab.enabled=true;lab.paused=false;lab.gpu.cpu=false;lab.asyncSimulation=true;lab.optimizations.gpuBatch=true;return lab;
 };
 const a=make(),b=make();a.step(a.timestep);a.step(a.timestep);
 b.accumulator=b.timestep*2;const step=new CPUFrameStep(b,{now:()=>0});assert.equal(step.begin(),true);step.compute();step.publish();
 for(const key of ['positions','velocities','chem'])assert.deepEqual(b[key],a[key],key);
 for(const key of ['mass','wet','memory','packing'])assert.deepEqual(b.sand[key],a.sand[key],key);
 for(const key of ['temperature','humidity','pressure'])assert.deepEqual(b.bulkFields.grid[key],a.bulkFields.grid[key],key);
 assert.deepEqual(b.balls,a.balls);assert.equal(b.steps,a.steps);assert.equal(b.time,a.time);
});

test('moving-group refits preserve exact wind shelter without rescanning unrelated edits',()=>{
 const bed=bedFixture(),a=new SandAirGeometry(bed,[]),b=new LiveSandAirGeometry(bed,[]);b.beginMoving();const builds=b.tree.rebuilds;
 for(let k=0;k<100;k++){
  const p=bed.parcels[k%bed.parcels.length];p.position[0]+=.02;p.mass*=.99;
  if(k===50){bed.parcels.push({...p,id:700,position:[1,2,3]});}
  b.moved([p]);b.refresh();a.refresh(false);
  for(let i=0;i<20;i++){const q=[random()*11-5.5,random()*3,random()*10-5];assert.ok(Math.abs(a.distance(q)-b.distance(q))<1e-12);}
 }
 assert.equal(b.tree.rebuilds,builds+1);assert.ok(b.tree.refits<=100);b.endMoving();
});
