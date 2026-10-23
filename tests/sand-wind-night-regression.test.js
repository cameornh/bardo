import test from 'node:test';
import assert from 'node:assert/strict';
import {SandLab} from '../src/sand-lab/lab.js';
import {SandBed} from '../src/sand-lab/sand.js';
import {returnWindDeposits,mergeWindDeposits} from '../src/sand-lab/sand-contact-index.js';
import {simulationAllowance} from '../src/sand-lab/simulation-clock.js';
import {lunarState,moonPhaseState,LUNAR_MONTH,TideBoundary} from '../src/sand-lab/tides.js';
import {lunarDirection} from '../src/sand-lab/night-sky-model.js';
import {detailLightScale} from '../src/sand-lab/water-lab-detail-renderer.js';
import {Vector3} from 'three';
const close=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const totals=b=>{const t=[0,0,0,0];for(let k=0;k<b.mass.length;k++){const m=b.mass[k];t[0]+=m;t[1]+=m/b.packing[k];t[2]+=m*b.wet[k];t[3]+=m*b.memory[k];}for(const p of b.parcels){t[0]+=p.mass;t[1]+=p.mass/p.packing;t[2]+=p.mass*p.wet;t[3]+=p.mass*(p.memory||0);}return t;};
test('settled wind stock rejoins matching bed conserving grains, pore volume, wetness and history',()=>{
 const b=new SandBed(33);b.wet.fill(.7);b.memory.fill(.8);const make=(id,x,wet=.7)=>({id,position:[x,b.height(x,3)+.05,3],velocity:[0,0,0],mass:4*Math.PI/3*.05**3*.56,packing:.56,wet,memory:.8,anchored:true,windborne:true});
 b.parcels=[make(1,0),{...make(2,1),userEdited:true},make(3,-1,0),{...make(4,2),held:true}];const before=totals(b);assert.equal(returnWindDeposits(b),1);totals(b).forEach((v,k)=>close(v,before[k],1e-9));assert.equal(b.parcels[0].mass,0);assert.ok(b.parcels.slice(1).every(p=>p.mass>0));
});
test('wind deposit compaction preserves separate wet/dry layers and edited shapes',()=>{
 const b=new SandBed(33),make=(id,wet)=>({id,position:[0,1,0],velocity:[0,0,0],mass:.001,packing:.56,wet,memory:wet,anchored:true,windborne:true});b.parcels=[make(1,0),make(2,0),make(3,1),{...make(4,0),userEdited:true}];const before=totals(b);assert.equal(mergeWindDeposits(b),1);totals(b).forEach((v,k)=>close(v,before[k],1e-9));assert.ok(b.parcels[2].mass>0&&b.parcels[3].mass>0);
});
test('fixed-step allowance drops overload without repaying it faster than the requested speed',()=>{
 for(const speed of [.1,.5,1,2]){const dt=1/60;let acc=0,sim=0,wall=0,dropped=0;for(let i=0;i<1200;i++){const elapsed=i%3===0?.11:.017,a=simulationAllowance(acc,elapsed,speed,dt);wall+=elapsed;acc=a.time;dropped+=a.dropped;let steps=Math.floor((acc+1e-12)/dt);if(i<300)steps=Math.min(1,steps);sim+=steps*dt;acc=Math.max(0,acc-steps*dt);assert.ok(sim<=wall*speed+dt);if(i>=300)assert.ok(steps*dt<=elapsed*speed+dt+1e-10);}assert.ok(dropped>0||speed===.1);}
 const a=simulationAllowance(.49,.02,1,1/60);assert.ok(a.time<.02+1/60);assert.ok(a.dropped>.45);
});
test('changing the solar clock leaves lunar direction and phase untouched',()=>{
 const lab=new SandLab({extensions:{has:()=>false}});lab.lunarDay=12;const state=lunarState(12),expected=lunarDirection(state.elongation);
 for(const day of [0,6,12,18,23.95]){lab.day=day;lab.syncUniforms();close(lab.moonPhase,state.illuminated);assert.deepEqual(lunarDirection(lunarState(lab.lunarDay).elongation),expected);}
 lab.moonPhaseOffset=LUNAR_MONTH/2-12;lab.syncUniforms();close(lab.moonPhase,1);assert.deepEqual(expected,lunarDirection(lunarState(lab.lunarDay).elongation));lab.moonPhaseOffset=-12;lab.syncUniforms();close(lab.moonPhase,0);close(moonPhaseState(lab).illuminated,0);
 assert.notDeepEqual(expected,lunarDirection(lunarState(20).elongation));close(lunarState(LUNAR_MONTH*.5).illuminated,1);
});
test('night foam radiance encoding retains tiny lighting without changing extinction or creating light',()=>{
 const sh=[new Vector3(2e-10,4e-10,8e-10)],scale=detailLightScale(0,1,sh,0);assert.ok(scale>1e8);for(const light of [1e-10,1e-8,.01])close((light*scale)/scale,light,1e-12);assert.equal(detailLightScale(1,1,sh,0),1);
});
test('tide import/export stays submerged despite airborne water above the boundary',()=>{
 const points=[];for(let z=-4.5;z<-3.7;z+=.25)for(let x=-4.6;x<4.7;x+=.25)for(let y=0;y<1;y+=.25)points.push(x,y,z,0);
 for(let i=0;i<12;i++)points.push(i*.25,7+i*.3,-4.2,0);
 const lab={day:6,lunarDay:0,tidesEnabled:true,tideAmplitude:1.5,spec:{scale:10},spacing:.25,positions:new Float32Array(points),velocities:new Float32Array(points.length),chem:new Float32Array(points.length),get count(){return this.positions.length/4;},particleBudget:3000,solid:()=>1,detail:{remapEmitters(){}},gpu:{},revision:0};
 const tide=new TideBoundary();tide.step(lab,.3);lab.day=12;let imported=0;
 for(let step=0;step<20;step++){const old=lab.count;tide.step(lab,.3);for(let i=old;i<lab.count;i++){assert.ok(lab.positions[i*4+1]<=tide.exchangeCeiling+1e-6);assert.ok(lab.positions[i*4+1]<.8);}imported+=lab.count-old;}
 assert.ok(imported>0);lab.day=6;for(let i=0;i<20;i++)tide.step(lab,.3);assert.equal(Array.from(lab.positions).filter((v,k)=>k%4===1&&v>6).length,12);
});

import {createSandWind} from '../src/sand-lab/sand-air.js';
import {erodeSand} from '../src/sand-lab/sand-wind.js';
test('batched erosion air queries preserve reference stock and velocities as sources shrink',()=>{
 const a=new SandLab({extensions:{has:()=>false}}),b=new SandLab({extensions:{has:()=>false}});
 for(const lab of [a,b]){lab.wind=45;lab.sand.optimizations=lab.optimizations;for(let i=0;i<12;i++)lab.sand.parcels.push({id:lab.sand.nextId++,position:[i*.14-1,lab.sand.height(i*.14-1,3)+.08,3],velocity:[0,0,0],mass:.002,packing:.56,wet:.03,memory:.05,windborne:true,anchored:true});lab.sand.update();}
 a.optimizations.windBatch=false;b.optimizations.windBatch=true;const water=()=>({density:0,velocity:[0,0,0]});
 for(let i=0;i<6;i++){a.time=b.time=i*.13;for(const lab of [a,b])erodeSand(lab.sand,.13,createSandWind(lab),lab.spec.scale,water);}
 assert.deepEqual(a.sand.mass,b.sand.mass);assert.deepEqual(a.sand.parcels,b.sand.parcels);
});
