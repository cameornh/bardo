import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SandLab} from '../src/sand-lab/lab.js';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {NativeNeighbors,setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
import {transportFluid} from '../src/sand-lab/water-lab-transport.js';
import {predictBeach} from '../src/sand-lab/beach-predict.js';
import {distantWaterScale,waterSupportCeiling} from '../src/sand-lab/beach-throughput.js';
import {boundaryMetric} from '../src/sand-lab/water-lab-model.js';
import {makeBody} from '../src/sand-lab/objects.js';
await setDensityKernel(await readFile(new URL('../src/sand-lab/kernels/density.wasm',import.meta.url)));
await setNeighborKernel(await readFile(new URL('../src/sand-lab/kernels/neighbors.wasm',import.meta.url)));
const forbidden=()=>assert.fail('Unexpected graphics work'),renderer={extensions:{has:()=>true},render:forbidden,getRenderTarget:forbidden,setRenderTarget:forbidden};
function make(){const lab=new SandLab(renderer,{boulders:true,physicalResolution:true});lab.resolutions.ocean=1.4;lab.configure('ocean');lab.wind=0;lab.air.grid=null;lab.tidesEnabled=false;return lab;}
const maxError=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
function solve(lab,points,solver,mode){Object.assign(lab.optimizations,{batchedContacts:mode!==0,adaptivePressure:mode===2});const neighbors=new NativeNeighbors().build(points,lab.spacing).data;return solver.solve(points,neighbors,lab.spacing,3,p=>lab.collide(p),p=>lab.solid(p),lab);}
test('batch contacts match original results with cups, player, edited sand and held samples',()=>{
 const lab=make(),solver=new NativeDensity();const cup=makeBody('glass','cup',.3,[0,.4,-1]);cup.tilt=.7;cup.pitch=.3;lab.balls.push(cup);lab.setPlayer([1,1,-2],[0,0,0],.03,.17);
 lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);lab.sand.update();lab.syncUniforms();
 const points=lab.positions.slice();for(let i=0;i<points.length;i+=4){points[i]+=.02*Math.sin(i);points[i+1]-=.02;if(i%96===0)points[i+3]=1;}
 const old=solve(lab,points,solver,0),batch=solve(lab,points,solver,1);assert.equal(maxError(old,batch),0);
 for(let i=0;i<points.length;i+=4)if(points[i+3])assert.deepEqual(batch.slice(i,i+4),points.slice(i,i+4));
});
test('adaptive pressure is bounded against the original solver and ignores camera state',()=>{
 const lab=make(),solver=new NativeDensity(),points=lab.positions.slice();for(let i=0;i<points.length;i+=4){points[i+1]-=.004;points[i]+=.002*Math.sin(i);}
 const old=solve(lab,points,solver,1),fast=solve(lab,points,solver,2);assert.ok(maxError(old,fast)<lab.spacing*.025);assert.ok(solver.activeCounts.some(n=>n<lab.count*.7));
 lab.camera={position:[1000,1000,1000]};assert.deepEqual(solve(lab,points,solver,2),fast);
 lab.held={ids:[0]};assert.deepEqual(solve(lab,points,solver,2),old);assert.equal(solver.activeCounts.length,0);
 lab.held=null;lab.jet={origin:[0,2,0],direction:[1,0,0]};assert.deepEqual(solve(lab,points,solver,2),old);
});
test('coupled pressure/transport remains stable over four seconds with exact parcel mass',()=>{
 const output=[];
 for(const mode of [1,2]){
  const lab=make(),solver=new NativeDensity(),neighbors=new NativeNeighbors();let peakSpeed=0;
  // Local disturbance, with all water still participating in every prediction.
  for(let i=0;i<lab.count;i++){const o=i*4;if(Math.hypot(lab.positions[o],lab.positions[o+2]+1)<.6)lab.velocities[o]=.3;}
  for(let step=0;step<60;step++){
   const dt=lab.timestep,old=lab.positions,predicted=old.slice();predictBeach(lab,old,predicted,dt);
   Object.assign(lab.optimizations,{batchedContacts:true,adaptivePressure:mode===2});const list=neighbors.build(predicted,lab.spacing).data;
   const next=solver.solve(predicted,list,lab.spacing,3,p=>lab.collide(p),p=>lab.solid(p),lab),t=transportFluid(old,next,lab.velocities,lab.chem,list,lab.spacing,lab.spec.scale,dt,predicted);
   lab.positions=next;lab.velocities=t.velocities;lab.chem=t.chem;lab.neighborCounts=t.counts;lab.surfaceMetrics=t.metrics;
   for(let o=0;o<next.length;o+=4){assert.ok(Number.isFinite(next[o]+next[o+1]+next[o+2]));assert.ok(lab.solid(Array.from(next.slice(o,o+3)))>-.025);peakSpeed=Math.max(peakSpeed,Math.hypot(...t.velocities.slice(o,o+3)));}
  }
  const y=Array.from({length:lab.count},(_,i)=>lab.positions[i*4+1]).sort((a,b)=>a-b);
  output.push({count:lab.count,volume:lab.count*lab.spacing**3,mean:y.reduce((s,v)=>s+v,0)/y.length,upper:y[Math.floor(y.length*.95)],peakSpeed});
 }
 assert.equal(output[0].volume,output[1].volume);assert.ok(Math.abs(output[0].mean-output[1].mean)<.025);assert.ok(Math.abs(output[0].upper-output[1].upper)<.05);assert.ok(output[1].peakSpeed<output[0].peakSpeed*1.5);
 console.log('coupled pressure reference',JSON.stringify(output));
});
test('distant optical budget is continuous, monotone and retains near fidelity',()=>{
 assert.equal(distantWaterScale(.01,.2,300),1);assert.equal(distantWaterScale(100,.2,300),8);
 let previous=1;for(let d=.01;d<100;d+=.001){const current=distantWaterScale(d,.2,300);assert.ok(current>=previous-1e-12);assert.ok(current-previous<.005);previous=current;}

});

test('underwater pass bound includes tilted covariance and interpolation halo',()=>{
 const p={position:[0,2,0],radius:.4,flatten:3,normal:[.6,.8,0]};
 const top=waterSupportCeiling([p],.1);assert.ok(top>2+3*.4*.95);
 for(let a=0;a<Math.PI*2;a+=.01){const tangentY=-.6,normalY=.8,y=2+3*.4*.95*(Math.cos(a)*normalY*3+Math.sin(a)*tangentY);assert.ok(y+.1<=top+1e-9);}
 assert.equal(waterSupportCeiling([],.1),-Infinity);
});

test('compiled edited-sand contacts match flattened, overlapping and carved geometry after edits',()=>{
 const lab=make(),solver=new NativeDensity(),rand=i=>Math.sin(i*17.891)*.5+.5;
 for(let i=0;i<48;i++)lab.sand.parcels.push({id:lab.sand.nextId++,position:[rand(i*3)*8-4,rand(i*3+1)*2,rand(i*3+2)*8-4],velocity:[0,0,0],mass:.01+rand(i)*.06,wet:.7,packing:.6,aspect:i%3===0?.15:1,cuts:i%2?[{offset:[.08,0,0],radius:.11,aspect:.7},{offset:[0,.02,0],radius:-.45,aspect:1}]:[]});
 for(let edit=0;edit<2;edit++){
  if(edit){lab.sand.parcels[0].position[1]+=.3;lab.sand.parcels[1].cuts.push({offset:[0,0,0],radius:.2});lab.balls[0].position[0]+=.2;}
  lab.sand.touchShapes();lab.sand.update();lab.syncUniforms();
  const positions=[];for(let i=0;i<220;i++)positions.push(rand(i*5)*10-5,rand(i*5+1)*3-1,rand(i*5+2)*9-4.5,i%23===0?1:0);
  for(const p of lab.sand.parcels)positions.push(...p.position,0,p.position[0]+.1,p.position[1]+.15,p.position[2]+.03,0);
  const points=new Float32Array(positions);
  lab.optimizations.nativeSandContacts=false;const expected=solve(lab,points,solver,1);
  lab.optimizations.nativeSandContacts=true;const actual=solve(lab,points,solver,1);
  assert.ok(maxError(expected,actual)<1e-6);assert.equal(solver.referenceQueries,0);
  for(let o=0;o<points.length;o+=4){const p=Array.from(points.slice(o,o+3)),ref=boundaryMetric(p,q=>lab.solid(q),lab.spacing*2);assert.equal(solver.instance.exports.metric(...p,lab.spacing*2,solver.offsets.geometry,solver.offsets.metric),0);assert.ok(Math.abs(ref.distance-solver.metric[3])<1e-7);for(let k=0;k<3;k++)assert.ok(Math.abs(ref.normal[k]-solver.metric[k])<1e-7);}
 }
});

import {effectiveOptimizations} from '../src/sand-lab/optimization-controls.js';
test('new optimization dependencies disable transitively without losing selections',()=>{
 const selected={nativeContacts:false,terrainCache:true,batchedContacts:true,nativeSandContacts:true,adaptivePressure:true,distanceDetail:true,distantOptics:true},flags=effectiveOptimizations(selected);
 for(const key of ['batchedContacts','nativeSandContacts','adaptivePressure'])assert.equal(flags[key],false);
 assert.equal(flags.distantOptics,true);assert.equal(selected.nativeSandContacts,true);
 selected.nativeContacts=true;assert.deepEqual(effectiveOptimizations(selected),selected);
});
