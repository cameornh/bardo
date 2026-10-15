import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterLab} from '../src/water-lab.js';
import {seedWater,LAB_PRESETS,opaqueDistance,fixtureDistance,createMotion} from '../src/water-lab-model.js';
import {rainVisualCopies,rainVisualRadius} from '../src/water-lab-rain-renderer.js';
import {foamDecay,FoamContactField} from '../src/water-lab-foam-contact.js';
const mock={extensions:{has:()=>false}};

test('waterfall height changes the ledge, seeded sheet and pump together',()=>{
 for(const height of [1.2,4.8,7.2]){
  const p=[0,height+.1,-3];assert.ok(Math.abs(opaqueDistance(p,'waterfall',0,.1,height)-.1)<1e-8);
  assert.ok(Math.abs(fixtureDistance(p,'waterfall',createMotion(),0,.1,height)-.1)<1e-8);
  const seeds=seedWater('waterfall',{...LAB_PRESETS.waterfall,waterfallHeight:height});assert.ok(seeds.some(q=>q.p[1]>height));assert.ok(seeds.every(q=>q.p[1]<height+1));
  const lab=new WaterLab(mock);lab.waterfallHeight=height;lab.configure('waterfall');for(let i=1;i<lab.positions.length;i+=4)lab.positions[i]=.3;lab.pump(.2);assert.equal(lab.u.uWaterfallHeight.value,height);assert.ok(lab.pumped>0);
  assert.ok(lab.positions.every(Number.isFinite));assert.ok(lab.positions.some((v,i)=>i%4===1&&v>height+.4));
 }
});

test('rain appearance grows with physical scale and refinement with a fixed upper bound',()=>{
 assert.ok(rainVisualCopies(.05)<rainVisualCopies(1));assert.ok(rainVisualCopies(1)<rainVisualCopies(4));assert.ok(rainVisualCopies(1,1)<rainVisualCopies(1,2));assert.equal(rainVisualCopies(100,100),64);
 assert.ok(rainVisualRadius(.05,.5)>rainVisualRadius(4,.5)*50);
});

test('foam decay is fast in air, slow in water, slowest in close foam clusters',()=>{
 assert.ok(foamDecay(0,false)>foamDecay(1,true)*10);assert.ok(foamDecay(1,true)>foamDecay(1,true,true)*4);assert.equal(foamDecay(3,false),1);
 const lab=new WaterLab(mock),d=lab.detail;d.activeSpan=4;
 for(let i=0;i<4;i++){d.fallback[0].image.data.set([i<2?i*.01:2+i,1,0,.1],i*4);d.fallback[1].image.data.set([0,0,0,2],i*4);d.fallback[2].image.data.set([.008,i===3?3:1,.5,1],i*4);}
 d.contact.update(lab,true);assert.equal(d.contact.touching([0,1,0],.008,0),true);assert.equal(d.contact.touching([4,1,0],.008,2),false);assert.equal(d.contact.touching([5.01,1,0],.008,-1),false);
});

test('batched rain retains all water while bounded conversion raises pool and pane inventories',()=>{
 for(const kind of ['pool','pane']){
  const lab=new WaterLab(mock);lab.configure(kind);lab.detail.enabled=false;lab.rain.enabled=true;lab.rain.rate=1000;const initial=lab.count;
  for(let i=0;i<240;i++){lab.rain.step(1/60);assert.ok(lab.rain.work.releaseCandidates<=24);}
  assert.ok(lab.count>initial,kind);assert.ok(lab.rain.hits>0);assert.ok(lab.rain.transferred>0);
  const drift=lab.volume+lab.rain.unresolvedVolume*lab.spec.scale**3-lab.initialVolume-lab.rain.emitted*lab.spec.scale**3;assert.ok(Math.abs(drift)<1e-8,`${kind} ${drift}`);
 }
});

test('rain crown redistributes momentum radially without adding a net horizontal force',()=>{
 const lab=new WaterLab(mock);lab.configure('pool');lab.positions=new Float32Array(13*13*4);lab.velocities=lab.positions.slice();lab.chem=lab.positions.slice();lab.neighborCounts=new Uint16Array(169);
 const s=lab.spacing;for(let i=0;i<169;i++)lab.positions.set([(i%13-6)*s*.25,1,(Math.floor(i/13)-6)*s*.25],i*4);
 lab.rain.impact({volume:s**3*.8,velocity:[0,-8,0]},{point:[0,1,0],normal:[0,1,0],particle:84});
 let momentum=[0,0,0],outward=0;for(let i=0;i<169;i++){for(let k=0;k<3;k++)momentum[k]+=lab.velocities[i*4+k]*s**3;outward+=lab.positions[i*4]*lab.velocities[i*4]+lab.positions[i*4+2]*lab.velocities[i*4+2];}
 assert.ok(outward>0);assert.ok(Math.abs(momentum[0])+Math.abs(momentum[2])<1e-8);assert.ok(Math.abs(momentum[1]+8*s**3*.8)<1e-7);
});

test('a station reset discards pending GPU results and never launches overlapping solves',async()=>{
 const {PerspectiveCamera}=await import('three');const lab=new WaterLab({...mock,readRenderTargetPixelsAsync(){}}),camera=new PerspectiveCamera();lab.enabled=true;lab.gpu.cpu=false;
 let resolve,calls=0;lab.gpu.solve=()=>{calls++;return new Promise(r=>resolve=r);};lab.advance(.04,camera);assert.equal(calls,1);assert.ok(lab.asyncPending);
 const stale=lab.positions.slice();lab.configure('pane');const empty=lab.positions;lab.advance(.04,camera);assert.equal(calls,1);resolve(stale);await lab.asyncPending;
 assert.equal(lab.kind,'pane');assert.equal(lab.positions,empty);assert.equal(lab.count,0);assert.equal(lab.asyncPending,null);
});

test('dense foam shadow sampling has a fixed budget and retains its total optical weight',async()=>{
 const {shadowStride,SHADOW_MARKER_BUDGET}=await import('../src/water-lab-spray-shadows.js');
 for(const span of [32,16384,16385,32769,83001,131072]){const stride=shadowStride(span);assert.ok(Math.ceil(span/stride)<=SHADOW_MARKER_BUDGET);let weight=0;for(let i=0;i<span;i+=stride)weight+=Math.min(stride,span-i);assert.equal(weight,span);}
});

 test('backend changes wait for the outstanding solve and paused clicks survive it',async()=>{
 const {PerspectiveCamera}=await import('three');const lab=new WaterLab({...mock,readRenderTargetPixelsAsync(){}}),camera=new PerspectiveCamera();lab.enabled=true;lab.gpu.cpu=false;
 let resolve,calls=0;lab.gpu.solve=()=>{calls++;return new Promise(r=>resolve=r);};lab.advance(.04,camera);lab.gpu.cpu=true;lab.tool='rock';lab.interact([0,3,0],[0,0,-1]);lab.advance(.04,camera);assert.equal(calls,1);assert.equal(lab.balls.length,0);
 // Isolate scheduling from the numerical solver in this unit test.
 lab.finishStep=()=>{};resolve(lab.positions.slice());await lab.asyncPending;lab.paused=true;lab.advance(.04,camera);assert.equal(calls,1);assert.equal(lab.balls.length,1);assert.equal(lab.queuedInteractions.length,0);
});
