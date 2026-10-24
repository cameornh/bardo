import test from 'node:test';
import assert from 'node:assert/strict';
import {SeaFoamSurface,stepSeaFoam,organicFoam,focusSeaFoamSources,SEA_FOAM_MAX_COVERAGE,SEA_FOAM_WATER_LIFE,SEA_FOAM_SAND_LIFE} from '../src/sand-lab/sea-foam-model.js';
import {SeaFoam} from '../src/sand-lab/sea-foam.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {waterWindPressure,waterWindDrag,WATER_WIND_PRESSURE_GAIN,WATER_WIND_DRAG} from '../src/sand-lab/wind-response.js';
import {windPressure} from '../src/beach-wind.js';
const fixture=(n=12)=>{const state=new Float32Array(n*n*4),surface=state.slice(),flow=state.slice();for(let i=0;i<n*n;i++){surface.set([1,0,0,1],i*4);flow[i*4+3]=1;}return {n,state,surface,flow};};
const mass=a=>a.reduce((sum,x,i)=>sum+(i%4<2?x:0),0);
test('pure water produces no sea foam; activation is continuous and monotonic',()=>{
 const f=fixture();for(let i=0;i<200;i++)f.state=stepSeaFoam(f.state,f.surface,f.flow,f.n,.1);assert.equal(mass(f.state),0);
 let previous=0;for(const load of [.001,.01,.1,.5,1,2,10]){const s=f.surface.slice();for(let o=2;o<s.length;o+=4)s[o]=organicFoam(load);const next=stepSeaFoam(f.state,s,f.flow,f.n,1);assert.ok(mass(next)>previous);previous=mass(next);}
 f.surface.forEach((v,i)=>{if(i%4===2)f.surface[i]=1;if(i%4===3)f.surface[i]=0;});assert.equal(mass(stepSeaFoam(f.state,f.surface,f.flow,f.n,1)),0,'unbroken calm water does not emit');
});
test('surface transport follows current and conserves foam apart from explicit decay',()=>{
 const f=fixture();f.state[(5*f.n+4)*4]=.3;for(let i=0;i<f.n*f.n;i++)f.flow[i*4]=.6;
 const next=stepSeaFoam(f.state,f.surface,f.flow,f.n,.1);assert.ok(next[(5*f.n+5)*4]>0);assert.equal(next[(5*f.n+3)*4],0);
 assert.ok(Math.abs(mass(next)-mass(f.state)*Math.exp(-.1/SEA_FOAM_WATER_LIFE))<1e-7);
});
test('retreat deposits foam that persists on sand and rewets gradually',()=>{
 const f=fixture(),o=(5*f.n+5)*4;f.state[o]=.6;f.flow[o+3]=0;
 let next=stepSeaFoam(f.state,f.surface,f.flow,f.n,.1);assert.equal(next[o],0);assert.ok(next[o+1]>.59);
 for(let i=0;i<600;i++)next=stepSeaFoam(next,f.surface,f.flow,f.n,.1);
 assert.ok(Math.abs(next[o+1]-.6*Math.exp(-60.1/SEA_FOAM_SAND_LIFE))<2e-5);
 f.flow[o+3]=1;const wet=stepSeaFoam(next,f.surface,f.flow,f.n,.1);assert.ok(wet[o]>0&&wet[o]<next[o+1]);assert.ok(wet[o+1]>0&&wet[o+1]<next[o+1]);
});
test('a long storm stays finite and within the fixed coverage budget',()=>{
 const f=fixture();for(let o=0;o<f.state.length;o+=4){f.surface[o+2]=1;f.flow[o]=(o%7-3)*8;f.flow[o+1]=(o%11-5)*5;}
 let scratch=f.state.slice();for(let i=0;i<1800;i++){stepSeaFoam(f.state,f.surface,f.flow,f.n,1,scratch);[scratch,f.state]=[f.state,scratch];}
 for(let o=0;o<f.state.length;o+=4){assert.ok(Number.isFinite(f.state[o]));assert.ok(f.state[o]>=0&&f.state[o+1]>=0);assert.ok(f.state[o]+f.state[o+1]<=SEA_FOAM_MAX_COVERAGE+1e-6);}assert.ok(mass(f.state)<=f.n*f.n*SEA_FOAM_MAX_COVERAGE);
});
test('surface sampling uses the upper liquid layer and caches unchanged sand',()=>{
 let queries=0;const lab={spacing:.3,spec:{scale:10},sand:{revision:1},terrainHeight:()=>{queries++;return 0;},steps:1,count:2,positions:new Float32Array([0,.1,0,0,0,1,0,0]),velocities:new Float32Array([40,0,40,0,1,0,2,0]),chem:new Float32Array([0,0,0,0,0,.5,0,0]),neighborCounts:new Float32Array([20,20]),surfaceMetrics:new Float32Array([0,0,0,0,0,1,0,2]),balls:[]};
 const map=new SeaFoamSurface(20);map.update(lab);const o=(10*20+10)*4;assert.ok(map.flow[o+3]===1);assert.equal(map.flow[o],1);assert.equal(map.flow[o+1],2);assert.ok(Math.abs(map.surface[o+2]-organicFoam(.5))<1e-7);assert.equal(queries,400);map.update(lab);assert.equal(queries,400);lab.sand.revision++;map.update(lab);assert.equal(queries,800);
});
test('zero organics does no surface work; backend and reset never leak old foam',()=>{
 const foam=new SeaFoam(null,12),lab={generation:1,gpu:{cpu:true},tannins:0,chem:new Float32Array(8)};let calls=0;foam.surface.update=()=>calls++;
 foam.advance(.1,lab);assert.equal(calls,0);lab.tannins=1;foam.advance(.1,lab);assert.equal(calls,1);assert.equal(foam.backend,'CPU reference');foam.reference[0]=.5;foam.enabled=false;foam.advance(1,lab);assert.equal(foam.reference[0],.5);foam.enabled=true;lab.tannins=0;foam.advance(1,lab);assert.equal(mass(foam.reference),0);assert.equal(foam.active,false);foam.reference[0]=.2;lab.generation++;foam.generation(lab);assert.equal(mass(foam.reference),0);foam.dispose();
});
test('live water wind response is stronger at low speed; snapshot forces and calm remain unchanged',()=>{
 const report=[];for(const speed of [0,4,8,12,30,70]){let old2=0,new2=0;for(let i=0;i<2000;i++){const x=(i%50)*2-50,z=Math.floor(i/50)*2-40,t=i*.013,old=WATER_WIND_PRESSURE_GAIN*windPressure(x,z,t,speed,0,1),next=waterWindPressure(x,z,t,speed,1,true);assert.equal(waterWindPressure(x,z,t,speed,1),old);old2+=old*old;new2+=next*next;}if(speed===0)assert.equal(new2,0);else{const ratio=Math.sqrt(new2/old2);report.push({speed,pressureRmsGain:ratio});assert.ok(ratio>1.5);if(speed<=12)assert.ok(ratio>2.7);}assert.equal(waterWindDrag(speed),WATER_WIND_DRAG);assert.equal(waterWindPressure(1,2,3,speed,0,true),0);}console.log('Water wind response',report);
});
test('fast and reference prediction agree with stronger live waves',()=>{
 const lab=new SandLab({extensions:{has:()=>false}});lab.reactiveWaves=true;lab.wind=8;lab.time=2;lab.sand.step=()=>{};lab.stepRigidBodies=()=>{};lab.air.advance=()=>{};lab.wetting.step=()=>{};
 // Compare the same predictor with the two established optimization paths.
 lab.optimizations.fastPredict=true;const a=lab.prepareStep(1/60).predicted;lab.time-=1/60;lab.optimizations.fastPredict=false;const b=lab.prepareStep(1/60).predicted;
 let error=0;for(let i=0;i<a.length;i++)error=Math.max(error,Math.abs(a[i]-b[i]));assert.ok(error<1e-6,`prediction error ${error}`);
});

test('breakers replenish shallow bands preferentially, with extra focus where currents converge',()=>{
 const run=(depth,convergence)=>{const f=fixture();for(let z=0;z<f.n;z++)for(let x=0;x<f.n;x++){const o=(z*f.n+x)*4;f.surface[o]=depth/10;f.surface[o+3]=.7;f.flow[o]=(f.n/2-x)*convergence;}focusSeaFoamSources(f.surface,f.flow,f.n,10,.19);return f.surface[((6*f.n)+6)*4+3];};
 const shallow=run(1,.2),deep=run(15,.2),diverging=run(1,-.2);assert.ok(shallow>deep*5);assert.ok(shallow>diverging*1.5);assert.ok(shallow<=1);
});
test('input sampling runs at bounded simulation cadence and never follows camera refreshes',()=>{
 const foam=new SeaFoam(null,8),lab={generation:1,gpu:{cpu:true},tannins:1,chem:new Float32Array(8)};let calls=0;foam.surface.update=()=>calls++;
 for(let i=0;i<120;i++)foam.advance(1/60,lab);assert.ok(calls<=16&&calls>=14);assert.ok(Math.abs(foam.elapsed-2)<1e-10);lab.tannins=0;foam.clearCleanWater(lab);assert.equal(foam.active,false);assert.equal(mass(foam.read()),0);foam.dispose();
});
