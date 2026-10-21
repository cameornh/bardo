import test from 'node:test';
import assert from 'node:assert/strict';
import {FluidSampler} from '../src/sand-lab/fluid-sampling.js';
import {SandBed} from '../src/sand-lab/sand.js';
import {programConstants,specializeSource} from '../src/sand-lab/program-specialization.js';
const rand=i=>Math.sin(i*17.891)*.5+.5;
function direct(a,v,p,h){let density=0,velocity=[0,0,0];for(let o=0;o<a.length;o+=4){const q=1-((p[0]-a[o])**2+(p[1]-a[o+1])**2+(p[2]-a[o+2])**2)/h**2;if(q<=0)continue;const w=315/(512*Math.PI)*q**3;density+=w;for(let k=0;k<3;k++)velocity[k]+=v[o+k]*w;}return {density,velocity:velocity.map(x=>x/Math.max(.00001,density))};}
test('compact water queries preserve poly6 density and momentum, including boundaries',()=>{
 const a=new Float32Array(1800*4),v=a.slice(),f=new FluidSampler();
 for(let o=0;o<a.length;o+=4)for(let k=0;k<3;k++){a[o+k]=rand(o+k)*5-2.5;v[o+k]=rand(o*3+k)*8-4;}
 f.build(a,v,.4);
 for(let i=0;i<300;i++){const p=[rand(i*3)*6-3,rand(i*3+1)*6-3,rand(i*3+2)*6-3],actual=f.sample(p),expected=direct(a,v,p,.4);assert.ok(Math.abs(actual.density-expected.density)<1e-12);for(let k=0;k<3;k++)assert.ok(Math.abs(actual.velocity[k]-expected.velocity[k])<1e-12);}
 f.build(new Float32Array(0),new Float32Array(0),.4);assert.deepEqual(f.sample([0,0,0]),{density:0,velocity:[0,0,0]});
 const wide=new Float32Array([0,0,0,0,1000,1000,1000,0]);f.build(wide,wide,.1);assert.ok(f.fallback);assert.deepEqual(f.sample([0,0,0]),direct(wide,wide,[0,0,0],.1));
});
test('sand broadphase preserves the full smooth CSG field, including flattened and cut stock',()=>{
 const bed=new SandBed(17);for(let i=0;i<90;i++)bed.parcels.push({id:i+1,position:[rand(i*3)*8-4,rand(i*3+1)*3,rand(i*3+2)*8-4],mass:.004+rand(i)*.03,wet:.5,packing:.6,aspect:i%3?.12:1,held:i%7===0,windborne:i%11===0,cuts:i%2?[{offset:[.08,0,0],radius:.11}]:[]});
 for(let i=0;i<450;i++){const p=[rand(i*5)*12-6,rand(i*5+1)*6-1,rand(i*5+2)*12-6];bed.optimizations={sandQueryBounds:false};const expected=bed.distance(p,i%2===0);bed.optimizations.sandQueryBounds=true;assert.ok(Math.abs(bed.distance(p,i%2===0)-expected)<1e-12);}
});
test('program specialization changes only draw-constant features and invalidates when objects appear',()=>{
 const uniforms={uStation:{value:6},uBodyCount:{value:0},uSandCount:{value:2},uSandMin:{value:{x:0,y:0,z:0}},uSandMax:{value:{x:0,y:0,z:0}},uFieldLinear:{value:true}};
 const constants=programConstants(uniforms);assert.deepEqual(constants.uBodyCount,['int',0]);assert.deepEqual(constants.uSandCount,['int',0]);
 const source='uniform int uStation; uniform float uScale; uniform bool uFieldLinear;';assert.equal(specializeSource(source,constants),'const int uStation=6; uniform float uScale; const bool uFieldLinear=true;');
 uniforms.uBodyCount.value=1;uniforms.uSandMax.value.y=1;assert.equal(programConstants(uniforms).uBodyCount,undefined);assert.equal(programConstants(uniforms).uSandCount,undefined);assert.deepEqual(programConstants(uniforms,false),{});
});

import {PackedNeighbors} from '../src/sand-lab/packed-neighbors.js';
import {buildNeighbors,normalAt,clamp,length} from '../src/sand-lab/water-lab-model.js';
import {SandStress} from '../src/sand-lab/sand-stress.js';
import {stressFixture} from '../src/sand-lab/stress-qa.js';
import {predictBeach} from '../src/sand-lab/beach-predict.js';
import {windPressure} from '../src/beach-wind.js';
import {labAirVelocity} from '../src/sand-lab/water-lab-air.js';

test('neighbor cell rejection and ordered ranges preserve reciprocal lists and overflow exactly',()=>{
 const packed=new PackedNeighbors();for(const n of [0,1,175,1500,17])for(const crowded of [false,true]){
  const a=new Float32Array(n*4);for(let i=0;i<n;i++)for(let k=0;k<3;k++)a[i*4+k]=(rand(i*3+k)-.5)*(crowded?.2:5);
  const expected=buildNeighbors(a,.24),actual=packed.build(a,.24,true);assert.equal(actual.overflow,expected.overflow);assert.deepEqual(actual.data,expected.data);
 }
});
test('pruning stress queries preserves dry load on wet supports and bonded fracture',()=>{
 for(const wet of [0,.001,.3,.95])for(const dryCap of [false,true]){
  const make=()=>{const b=new SandBed(33);b.base.fill(-.7);b.update();const parts=stressFixture(b,{length:5,wet,x:0,z:0});if(wet===0)for(const p of parts)p.memory=0;if(dryCap){const p=parts.at(-1);b.parcels.push({...p,id:b.nextId++,wet:0,memory:0,position:[p.position[0],p.position[1]+.35,p.position[2]],velocity:[0,0,0]});}return b;};
  const a=make(),b=make();a.optimizations={stressPruning:false};b.optimizations={stressPruning:true};const sa=new SandStress(),sb=new SandStress(),air=()=>[10,0,0],water=()=>({density:.2});
  for(let i=0;i<30;i++){sa.step(a,.03,air,10,water);sb.step(b,.03,air,10,water);assert.equal(sa.maxLoad,sb.maxLoad);assert.deepEqual([...sa.damage],[...sb.damage]);assert.equal(sa.failures,sb.failures);assert.deepEqual(a.parcels,b.parcels);}
 }
});
test('lean beach predictor preserves gravity, wind, holding, player impulses and travel limits',()=>{
 for(const wind of [0,30])for(const grid of [false,true]){
  const a=new Float32Array(180*4),vel=a.slice(),chem=a.slice();for(let o=0;o<a.length;o+=4){a.set([rand(o)*4-2,rand(o+1)*3,rand(o+2)*4-2,o%28===0?1:0],o);vel.set([rand(o)*.5,rand(o+1)*2,rand(o+2)*.2,0],o);chem[o+3]=rand(o);}
  const lab={spacing:.2,spec:{scale:10},velocities:vel,chem,time:2,wind,windTurbulence:1,radius:.4,windStrength:60,jet:{origin:[-2,1,0],direction:[1,0,0]},kind:'ocean',balls:[],motion:{position:[0,0,0],tilt:0,spin:0,pitch:0},sampleFastSurface:i=>i%2===0,air:{grid,sampleGrid:p=>[p[1],.2,1]},player:{velocity:[1,.3,0]},playerDistance:p=>Math.hypot(p[0],p[1]-1,p[2])-.4};
  const fast=a.slice(),expected=a.slice(),dt=1/15,s=lab.spacing,scale=lab.spec.scale;predictBeach(lab,a,fast,dt);
  for(let i=0;i<a.length/4;i++){const o=i*4;if(a[o+3])continue;const p=Array.from(a.subarray(o,o+3)),v=Array.from(vel.subarray(o,o+3));v[1]-=9.81/scale*dt;
   if((chem[o+3]>.01||lab.sampleFastSurface(i))&&(wind||lab.jet)){const air=grid?lab.air.sampleGrid(p):labAirVelocity(p,lab);for(let k=0;k<3;k++){const relative=air[k]-v[k];v[k]+=dt*.025*relative*Math.abs(relative);}v[1]-=dt*windPressure(p[0]*scale,p[2]*scale,lab.time,wind,0,1)*Math.min(1,(length(air)*scale/Math.max(wind,1e-6))**2)/(scale*Math.max(.2,s*scale));}
   if(lab.playerDistance(p)<s){const n=normalAt(p,q=>lab.playerDistance(q)),relative=lab.player.velocity.reduce((sum,x,k)=>sum+(x-v[k])*n[k],0),w=clamp(1-lab.playerDistance(p)/s,0,1);if(relative>0)for(let k=0;k<3;k++)v[k]+=n[k]*relative*w*.22;}
   const speed=length(v),limit=s*.45/dt;if(speed>limit)for(let k=0;k<3;k++)v[k]*=limit/speed;expected.set(p.map((x,k)=>x+v[k]*dt),o);
  }assert.deepEqual(fast,expected);
 }
});

test('read-only terrain snapshot preserves cubic heights including clamped borders and edits',()=>{
 const bed=new SandBed(49);for(let k=0;k<bed.mass.length;k++){bed.mass[k]*=.1+rand(k);bed.packing[k]=.3+rand(k+11)*.4;}
 const heights=Float64Array.from(bed.mass,(_,k)=>bed.heightAt(k));for(let i=0;i<1000;i++){const x=(rand(i)-.5)*15,z=(rand(i+2)-.5)*14;assert.ok(Math.abs(bed.heightCached(x,z,heights)-bed.height(x,z))<2e-15);}
});
test('specialization handles grouped declarations without changing unselected uniforms',()=>{
 assert.equal(specializeSource('uniform highp int uCount,uPass;uniform bool uCollision,uBoundaryDensity;', {uPass:['int',1],uCollision:['bool',false]}),'uniform highp int uCount; const int uPass=1;const bool uCollision=false; uniform bool uBoundaryDensity;');
});

import {LabDetail} from '../src/sand-lab/water-lab-detail.js';
test('cached emission preserves marker positions, velocities, lifetimes, histories and supply',()=>{
 const render={extensions:{has:()=>false}},a=new LabDetail(render,1024),b=new LabDetail(render,1024),n=320,positions=new Float32Array(n*4),velocities=positions.slice(),surfaceMetrics=positions.slice(),surfaceBreakup=new Float32Array(n),neighborCounts=new Uint16Array(n).fill(25),aerationActivity=new Float32Array(n*2).fill(3);
 for(let i=0;i<n;i++){positions.set([rand(i),1,rand(i+2),i%29===0?1:0],i*4);surfaceMetrics.set([0,1,0,rand(i)*2],i*4);surfaceBreakup[i]=rand(i+41);}
 const lab={positions,velocities,surfaceMetrics,surfaceBreakup,neighborCounts,aerationActivity,spacing:.15,spec:{scale:2},count:n,solid:p=>p[1]-.1};
 for(let j=0;j<20;j++){a.pending=b.pending=0;lab.time=j/30;lab.optimizations={fastEmission:false};a.emit(lab,1/30);lab.optimizations.fastEmission=true;b.emit(lab,1/30);assert.equal(a.emitted,b.emitted);assert.equal(a.pending,b.pending);for(let k=0;k<3;k++)assert.deepEqual(a.spawn[k].image.data,b.spawn[k].image.data);for(const k of ['budget','strength','weights','sources','breakupHistory'])assert.deepEqual(a[k],b[k]);}
 a.dispose();b.dispose();
});

import {SandAirGeometry} from '../src/sand-lab/sand-air-geometry.js';
import {bodyDistance,makeBody} from '../src/sand-lab/objects.js';
test('live scalar terrain sampling and refreshed wind geometry preserve changing CSG',()=>{
 const bed=new SandBed(33),bodies=[makeBody('rock','sphere',.4,[1,2,1]),makeBody('glass','cup',.3,[-1,1,0])];bodies[1].tilt=.71;
 for(let i=0;i<70;i++)bed.parcels.push({id:i+1,position:[rand(i*3)*8-4,rand(i*3+1)*3,rand(i*3+2)*8-4],mass:.01,packing:.6,aspect:i%3?.12:1,held:i%7===0,cuts:i%2?[{offset:[.1,0,0],radius:.12}]:[]});
 const geometry=new SandAirGeometry(bed,bodies);
 for(let i=0;i<1000;i++){
  const p=[rand(i*5)*13-6.5,rand(i*5+1)*6-1,rand(i*5+2)*13-6.5];bed.mass[i%bed.mass.length]*=.99;bed.parcels[i%70].position[1]-=.0001;
  bed.optimizations={fastHeight:false,sandQueryBounds:false};let expected=bed.distance(p);for(const body of bodies)expected=Math.min(expected,bodyDistance(p,body));
  const height=bed.height(p[0],p[2]);bed.optimizations.fastHeight=true;assert.ok(Math.abs(height-bed.height(p[0],p[2]))<2e-15);
  geometry.refresh(i%2===0);assert.ok(Math.abs(geometry.distance(p)-expected)<1e-12);
 }
});

import {SandLab} from '../src/sand-lab/lab.js';
import {PerspectiveCamera} from 'three';
test('predictive scheduling avoids an over-budget second solve while preserving fixed time and debt',()=>{
 const lab=new SandLab({extensions:{has:()=>false}}),camera=new PerspectiveCamera();lab.paused=false;lab.physicsBudgetMs=95;
 let now=0,integrated=0;const original=performance.now;Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
 try{
  lab.step=dt=>{integrated+=dt;now+=70;};lab.detail.advance=()=>{};
  lab.advance(.25,camera);assert.equal(integrated,lab.timestep);assert.ok(Math.abs(lab.accumulator-(.25-lab.timestep))<1e-12);
  lab.advance(.1,camera);assert.equal(integrated,lab.timestep*2);assert.equal(lab.stepCostEstimate,70);
  lab.optimizations.predictBudget=false;const before=integrated;lab.advance(.1,camera);assert.ok(Math.abs(integrated-before-2*lab.timestep)<1e-12);
  lab.optimizations.predictBudget=true;lab.step=dt=>{integrated+=dt;now+=1;};lab.stepCostEstimate=1;lab.advance(.1,camera);assert.ok(lab.accumulator<lab.timestep);assert.equal(lab.droppedTime,0);
 }finally{Object.defineProperty(performance,'now',{configurable:true,value:original});}
});
test('changing compact sand mode rebuilds geometry without requiring an edit',()=>{
 const lab=new SandLab({extensions:{has:()=>false}});lab.sand.parcels.push({id:1,position:[0,2,0],velocity:[0,0,0],mass:.01,packing:.6,wet:0,windborne:true},{id:2,position:[1,2,0],velocity:[0,0,0],mass:.01,packing:.6,wet:.9});lab.sand.update();lab.syncSandUniforms();assert.equal(lab.u.uSandCount.value,1);
 for(const compact of [false,true,false,true]){lab.optimizations.compactSand=compact;lab.sandRevision=-1;lab.syncSandUniforms();assert.equal(lab.u.uSandCount.value,compact?1:2);assert.ok(lab.solid([1,2,0],false,false)<0);}
});

import {SandContactIndex,settlingPatchLimit,mergeWindDeposits} from '../src/sand-lab/sand-contact-index.js';
import {loosePatches} from '../src/sand-lab/sand-support.js';
import {createSandWind} from '../src/sand-lab/sand-air.js';
test('incremental settling indices preserve ordered contact and column queries after moves',()=>{
 const bed=new SandBed(33);for(let i=0;i<120;i++)bed.parcels.push({id:i+1,position:[rand(i*3)*4-2,rand(i*3+1)*3,rand(i*3+2)*4],velocity:[0,0,0],mass:.001+rand(i)*.02,wet:rand(i),packing:.6,anchored:true,aspect:i%3?.15:1,cuts:i%4?[{offset:[.04,0,0],radius:.07}]:[]});
 const index=new SandContactIndex(bed.parcels);
 for(let i=0;i<300;i++){
  const parcel=bed.parcels[i%120];parcel.position[0]+=.01;parcel.position[1]-=.01;if(i%13===0)parcel.anchored=false;index.update(parcel);
  const p=[rand(i*7)*6-3,rand(i*7+1)*4-1,rand(i*7+2)*6-1],radius=rand(i)*.4;
  bed.layerContactIndex=null;const d=bed.contactDistance(p,radius),h=bed.supportHeight(p[0],p[2],p[1],-1,null);
  bed.layerContactIndex=index;assert.equal(bed.contactDistance(p,radius),d);assert.equal(bed.supportHeight(p[0],p[2],p[1],-1,null),h);
 }
 bed.layerContactIndex=null;
 const other=new SandBed(33);other.parcels=structuredClone(bed.parcels);other.optimizations={settlingIndex:true};bed.optimizations={settlingIndex:false};
 for(let i=0;i<6;i++){bed.settleLayers(1/15,10);other.settleLayers(1/15,10);assert.deepEqual(other.parcels,bed.parcels);assert.equal(other.layerContactIndex,null);}
});
test('world-resolution settling floor preserves tiny deposit mass, wetness and occupied volume',()=>{
 let id=2;for(const wet of [0,.1,.5,.9]){
  const p={id:1,position:[1,2,3],velocity:[0,0,0],mass:1e-7,packing:.56,wet,memory:.9},limit=settlingPatchLimit(p,.17,.15),parts=loosePatches(p,()=>id++,limit,.6);
  assert.equal(limit,1);assert.equal(parts.length,1);assert.equal(parts.reduce((s,p)=>s+p.mass,0),1e-7);assert.equal(parts[0].wet,wet);assert.equal(parts[0].memory,.9);assert.equal(parts[0].packing,.56);
 }
 const p={mass:.005,packing:.56};assert.equal(settlingPatchLimit(p,.17,.15),25);assert.ok(settlingPatchLimit({mass:1e-5,packing:.56},.05,.05)>settlingPatchLimit({mass:1e-5,packing:.56},.17,.15));
});
test('forty seconds of wind deposition does not recursively multiply sub-resolution stock',()=>{
 const sand=new SandBed(66),lab={sand,balls:[],time:0,spec:{scale:10},wind:24,windTurbulence:1,radius:.45,windStrength:60,optimizations:{windGeometry:true}};
 sand.optimizations={mergeWindDeposits:true,patchFloor:true,settlingIndex:true,sandCache:true,broadphase:true,fastHeight:true,sandQueryBounds:true,stressPruning:true};let maxParcels=0;
 const water=p=>({density:p[1]<1.4&&p[2]<3.9?.7:0,velocity:[0,0,0]});
 for(let i=0;i<600;i++){lab.time=i/15;sand.step(1/15,water,createSandWind(lab),10,0,.191);maxParcels=Math.max(maxParcels,sand.parcels.length);}
 assert.ok(maxParcels<160,`unbounded fragmentation: ${maxParcels}`);assert.ok(Math.abs(sand.totalMass()-sand.initialMass)/sand.initialMass<1e-10);
 for(const p of sand.parcels){assert.ok(p.wet>=0&&p.wet<=1);assert.ok(p.mass>0);assert.ok(p.position.every(Number.isFinite));}
});

test('coalescing overlapping wind deposits conserves grain/pore volume, wetness, history and centre of mass',()=>{
 const bed=new SandBed(33),parcel=(id,x,wet)=>({id,position:[x,2,0],velocity:[0,0,0],mass:1e-6,packing:.4+wet*.2,wet,memory:wet,windborne:true,anchored:true});
 bed.parcels=[parcel(1,0,.2),parcel(2,.004,.8),{...parcel(3,0,.5),held:true},{...parcel(4,0,.5),cuts:[{offset:[0,0,0],radius:.001}]},{...parcel(5,0,.5),userEdited:true},{...parcel(6,0,.5),windborne:false}];
 const volume=bed.parcels.slice(0,2).reduce((s,p)=>s+p.mass/p.packing,0),mass=bed.totalMass(),protectedBefore=structuredClone(bed.parcels.slice(2));
 assert.equal(mergeWindDeposits(bed),1);assert.equal(bed.totalMass(),mass);const q=bed.parcels[0];assert.equal(q.mass,2e-6);assert.ok(Math.abs(q.mass/q.packing-volume)<1e-20);assert.equal(q.wet,.5);assert.equal(q.memory,.5);assert.equal(q.position[0],.002);assert.deepEqual(bed.parcels.slice(2),protectedBefore);
});
