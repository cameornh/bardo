import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed} from '../src/sand-lab/sand.js';
import {stressFixture} from '../src/sand-lab/stress-qa.js';
import {erodeSand,erosionThreshold} from '../src/sand-lab/sand-wind.js';
import {grainStep} from '../src/sand-lab/sand-grain-motion.js';
import {SandStress} from '../src/sand-lab/sand-stress.js';
const empty=()=>({density:0,velocity:[0,0,0]}),flat=()=>{const b=new SandBed(33);b.base.fill(-.7);b.update();return b;};
const advance=(b,seconds,wind=0)=>{for(let i=0;i<seconds*30;i++)b.stepParcels(1/30,empty,()=>[wind/10,0,0],10,0,0);};
const stock=b=>b.totalMass()+b.removedMass;

test('short wet and dried overhangs retain shape; a long wet overhang fractures under its own weight',()=>{
 for(const wet of [.95,0]){const b=flat(),parts=stressFixture(b,{length:1,wet,z:0,x:0}),start=parts.map(p=>p.position.slice());advance(b,5);assert.equal(b.stress.failures,0);assert.deepEqual(parts.map(p=>p.position),start);}
 const b=flat(),parts=stressFixture(b,{length:7,z:0,x:0}),mass=stock(b);advance(b,5);
 assert.ok(b.stress.failures>0);assert.ok(parts.at(-1).position[1]<.7);assert.ok(Math.abs(stock(b)-mass)<1e-10);
 assert.ok(parts[0].anchored,'grounded support survives');
});
test('wind bending accumulates down a column and dries to a more vulnerable structure',()=>{
 const run=(wind,wet)=>{const b=flat();stressFixture(b,{length:0,column:12,wet,z:0,x:0});advance(b,6,wind);return b;};
 assert.equal(run(0,.95).stress.failures,0);assert.equal(run(40,.95).stress.failures,0);
 assert.ok(run(80,.95).stress.failures>0);assert.ok(run(40,0).stress.failures>0);
});
test('a brief overload accumulates damage rather than breaking on one noisy frame',()=>{
 const b=flat();stressFixture(b,{length:7,z:0,x:0});b.stress=new SandStress();b.stress.step(b,1/1000,()=>[0,0,0],10,empty);assert.equal(b.stress.failures,0);
 const damage=[...b.stress.damage.values()].reduce((a,b)=>a+b,0);assert.ok(damage>0);
});
test('gravity loading scales in physical metres',()=>{
 const load=scale=>{const b=flat();stressFixture(b,{length:1,z:0,x:0});const s=new SandStress();s.step(b,0,()=>[0,0,0],scale,empty);return s.maxLoad;};
 assert.ok(load(20)>load(10)*1.9);assert.ok(load(5)<load(10)*.51);
});
test('wind moves dry bed stock without inventing mass; wet and sheltered surfaces resist',()=>{
 const run=(wet,wind)=>{const b=flat();b.wet.fill(wet);b.memory.fill(wet);const initial=stock(b);for(let i=0;i<12;i++)erodeSand(b,.12,()=>[wind/10,0,0],10,empty);assert.ok(Math.abs(stock(b)-initial)<1e-10);return b;};
 assert.equal(run(0,0).parcels.length,0);assert.equal(run(0,5).parcels.length,0);assert.equal(run(.95,40).parcels.length,0);
 const dry=run(0,40);assert.ok(dry.parcels.length>0&&dry.parcels.length<=32);assert.ok(dry.windEvents.length>0);assert.ok(erosionThreshold(0,.95)>erosionThreshold(0,0));
 const initial=stock(dry);advance(dry,15);assert.ok(Math.abs(stock(dry)-initial)<1e-10);assert.ok(dry.parcels.filter(p=>p.mass>0).length<32,'airborne stock returns to bed');
});
test('submerged bed does not emit airborne wind sand',()=>{
 const b=flat();erodeSand(b,.2,()=>[8,0,0],10,()=>({density:1,velocity:[0,0,0]}));assert.equal(b.parcels.length,0);
});
test('wind erosion throughput is bounded independently of terrain resolution',()=>{
 for(const n of [33,97]){const b=new SandBed(n);for(let i=0;i<20;i++)erodeSand(b,.12,()=>[8,0,0],10,empty);assert.ok(b.parcels.length<=32);assert.ok(b.windEvents.length<=128);assert.ok(Math.abs(stock(b)-b.initialMass)<1e-9);}
});
test('fine grain transport is independent of frame subdivision for constant wind',()=>{
 const p=[0,2,0],v=[1,2,-1],air=[4,0,1],full=grainStep(p,v,.6,air,10);let half=grainStep(p,v,.3,air,10);half=grainStep(half.position,half.velocity,.3,air,10);
 for(const key of ['position','velocity'])for(let k=0;k<3;k++)assert.ok(Math.abs(full[key][k]-half[key][k])<1e-12);
 assert.ok(grainStep(p,[0,0,0],.6,[0,0,0],10).position[1]<2);
});

test('water-mobilized clumps do not consume the separate wind transport budget',()=>{
 const b=flat();for(let i=0;i<40;i++)b.parcels.push({id:b.nextId++,position:[0,2,0],mass:.00001,wet:1,packing:.56,velocity:[0,0,0]});
 erodeSand(b,.2,()=>[4,0,0],10,empty);assert.ok(b.parcels.some(p=>p.windborne));assert.ok(b.parcels.filter(p=>p.windborne).length<=32);
});

test('stress graph reuses contacts when only retained moisture changes',()=>{
 const b=flat();stressFixture(b,{length:1,z:0,x:0});const s=new SandStress();s.step(b,.03,()=>[0,0,0],10,empty);const rebuilds=s.rebuilds;
 for(const p of b.parcels)p.wet=.4;s.step(b,.03,()=>[0,0,0],10,empty);assert.equal(s.rebuilds,rebuilds);
});

test('airborne transport is represented by fine grains, not opaque parent spheres',async()=>{
 const {packSandShapes}=await import('../src/sand-lab/sand-shape.js');const b=flat();erodeSand(b,.2,()=>[4,0,0],10,empty);const p=b.parcels[0];p.position[1]=2;
 assert.ok(b.distance(p.position)>0);assert.equal(packSandShapes([p]).data[3],-1);
 p.held=true;assert.ok(packSandShapes([p]).data[3]>0,'a deliberately held selection has a solid representation');
});

test('sand that reached full bonding before saturation retains its bond after drying',()=>{
 const b=flat(),parts=stressFixture(b,{length:1,wet:0,z:0,x:0});for(const p of parts)p.memory=.35;const start=parts.map(p=>p.position.slice());advance(b,5);
 assert.equal(b.stress.failures,0);assert.deepEqual(parts.map(p=>p.position),start);
});
