import test from 'node:test';
import assert from 'node:assert/strict';
import {sandParticleMaterial,particleRelease,grainBirth} from '../src/sand-lab/particulate-material.js';
import {grainStep,grainDrag} from '../src/sand-lab/sand-grain-motion.js';
import {sandAlbedo} from '../src/sand-lab/sand-material.js';
import {detailEmissionWeight} from '../src/sand-lab/water-lab-detail.js';
import {WATER_MATERIAL} from '../src/water-material.js';
import {erodeSand} from '../src/sand-lab/sand-wind.js';
import {SandBed} from '../src/sand-lab/sand.js';
import {Walker} from '../src/sand-lab/walker.js';
import {bodyDistance,bodyNormal,makeBody,playerBodyContact,bodyVolume} from '../src/sand-lab/objects.js';
const floor=p=>({distance:p[1],normal:[0,1,0]}),empty=()=>({density:0,velocity:[0,0,0]}),air=speed=>()=>[speed/10,0,0];
const flat=wet=>{const b=new SandBed(33);b.base.fill(-.7);b.wet.fill(wet);b.memory.fill(wet);b.update();return b;};
const run=(w,seconds,options={},water=()=>0,environment={},solid=floor)=>{for(let i=0;i<seconds*60;i++)w.step(1/60,options,solid,water,environment);};

test('binding properties raise particle release threshold continuously, not a wet-sand exclusion',()=>{
 let previous=0;for(const wet of [0,.04,.1,.2,.3,.6,1]){const m=sandParticleMaterial(wet,wet),a=particleRelease(m,{speed:80});assert.ok(a.threshold>=previous);previous=a.threshold;}
 assert.ok(particleRelease(sandParticleMaterial(),{speed:40}).excess>0);
 assert.equal(particleRelease(sandParticleMaterial(1,1),{speed:80}).excess,0);
 assert.ok(particleRelease(sandParticleMaterial(1,1),{speed:180}).excess>0);
 assert.ok(sandParticleMaterial(0,1).yieldStress>sandParticleMaterial().yieldStress);
});
test('wet beds and wet deposits shed conservative fine stock under extreme air or water forcing',()=>{
 for(const submerged of [false,true]){const b=flat(1),before=b.totalMass(),water=submerged?()=>({density:1,velocity:[4,0,0]}):empty;
  erodeSand(b,.2,air(submerged?0:180),10,water);assert.ok(b.windEvents.length>0);assert.ok(b.windEvents.every(e=>e.material.cohesion===1&&e.submerged===submerged));assert.ok(Math.abs(b.totalMass()-before)<1e-10);}
 const b=flat(1),p={id:b.nextId++,position:[0,.3,0],mass:.01,packing:.56,wet:1,memory:1,anchored:true,velocity:[0,0,0]};b.parcels.push(p);const before=b.totalMass();erodeSand(b,.2,air(180),10,empty);assert.ok(p.mass<.01);assert.ok(Math.abs(b.totalMass()-before)<1e-10);
});
test('dry births spread trajectories and time; cohesion narrows spread without enlarging grains',()=>{
 const event={seed:42,position:[0,1,0],velocity:[1,0,0],normal:[0,1,0],spread:.1,speed:80};
 const samples=wet=>Array.from({length:128},(_,i)=>grainBirth({...event,material:sandParticleMaterial(wet,wet)},i,10));
 const dry=samples(0),wet=samples(1),variance=a=>a.reduce((s,b)=>s+b.velocity[2]**2,0)/a.length;
 assert.ok(variance(dry)>variance(wet)*30);assert.deepEqual(dry.map(a=>a.radius),wet.map(a=>a.radius));
 assert.ok(Math.max(...dry.map(a=>a.delay))-Math.min(...dry.map(a=>a.delay))>.1);
 assert.ok(Math.max(...dry.map(a=>a.drag))/Math.min(...dry.map(a=>a.drag))>3);
 const end=dry.map(a=>grainStep(a.position,a.velocity,.4,[4,0,0],10,a.drag).position);
 assert.ok(Math.max(...end.map(p=>p[2]))-Math.min(...end.map(p=>p[2]))>.3,'a cloud disperses laterally instead of tracking one packet');
 for(const w of [0,.25,.5,.75,1])for(const b of samples(w))assert.deepEqual(b.albedo,sandAlbedo(w),'airborne grains use the solid sand palette at the same wetness');
});
test('heavy sand accelerates more slowly in air while retaining current response under water',()=>{
 const position=[0,2,0],velocity=[0,0,0],flow=[4,0,0],base=2.5;
 const previous=grainStep(position,velocity,.4,flow,10,base),airborne=grainStep(position,velocity,.4,flow,10,grainDrag(base,0));
 assert.ok(airborne.velocity[0]>0&&airborne.velocity[0]<previous.velocity[0]*.6);
 assert.ok(airborne.position[1]<previous.position[1],'gravity wins sooner over upward drag');
 assert.equal(grainDrag(base,1),base*8,'submerged drag is preserved');
 for(let i=1;i<=100;i++)assert.ok(grainDrag(base,i/100)>grainDrag(base,(i-1)/100),'immersion blends continuously');
});
test('shared water release threshold preserves its previously tuned Weber response',()=>{
 for(const scale of [.1,1,10])for(const spacing of [.02,.2])for(const activity of [0,.01,.1,1,4]){
  const h=scale*spacing,weber=WATER_MATERIAL.density*h*activity*activity/WATER_MATERIAL.surfaceTension,expected=(h/.25)**3*Math.max(0,Math.min(1,(weber-2)/18));
  assert.ok(Math.abs(detailEmissionWeight(spacing,scale,18,activity)-expected)<1e-9);
 }
});
test('gravity/drag reference remains independent of substeps for diverse grain sizes and submerged density',()=>{
 for(const drag of [.6,2.5,8])for(const gravity of [1,1-1000/2650]){const p=[1,2,3],v=[2,-1,.5],a=[4,.3,1],full=grainStep(p,v,.4,a,10,drag,gravity);let q={position:p,velocity:v};for(let i=0;i<8;i++)q=grainStep(q.position,q.velocity,.05,a,10,drag,gravity);for(const key of ['position','velocity'])for(let k=0;k<3;k++)assert.ok(Math.abs(q[key][k]-full[key][k])<1e-12);}
});
test('a stationary player resists mild wind but is pushed by strong wind without WASD',()=>{
 const low=new Walker(),high=new Walker();run(low,2,{},()=>0,{air:[5,0,0]});run(high,2,{},()=>0,{air:[80,0,0]});assert.ok(Math.abs(low.position[0])<.02);assert.ok(high.position[0]>5&&high.velocity[0]>5);assert.ok(high.grounded);
});
test('currents and rising waves carry a player; Space floats, releasing Space sinks',()=>{
 const w=new Walker();w.position=[0,8,0];const current=()=>({density:1,velocity:[2,.6,0]});run(w,2,{},current,{},()=>null);assert.ok(w.position[0]>2&&w.velocity[0]>1.5);const falling=w.velocity[1];
 run(w,2,{buoyant:true},current,{},()=>null);assert.ok(w.velocity[1]>.6&&w.velocity[1]>falling);
 run(w,2,{},()=>({density:1,velocity:[0,0,0]}),{},()=>null);assert.ok(w.velocity[1]<0);
});
test('moving bodies impart persistent player momentum and equal opposing impulse',()=>{
 const w=new Walker(),b=makeBody('rock','sphere',.3,[-.5,.82,0],[4,0,0]),mass=bodyVolume(b)*b.ratio*1000,before=4*mass;
 assert.ok(playerBodyContact(w,b,[0,.82,0]));assert.ok(w.velocity[0]>1);assert.ok(Math.abs(w.velocity[0]*w.mass+b.velocity[0]*mass-before)<1e-8);
 const x=w.position[0];w.step(1/60,{},floor);assert.ok(w.position[0]>x+.01);assert.ok(w.velocity[0]>.5,'idle controls did not erase the impulse');
});
test('idle slope contact stays stable, jumping and diagonal input still work',()=>{
 const n=Math.hypot(.3,1),slope=p=>({distance:(p[1]-.3*p[0])/n,normal:[-.3/n,1/n,0]}),w=new Walker();w.position=[0,3,0];run(w,3,{},()=>0,{},slope);const start=w.position.slice();run(w,5,{},()=>0,{},slope);assert.ok(Math.hypot(...w.position.map((x,k)=>x-start[k]))<.02);
 const jump=new Walker();run(jump,.1);jump.step(1/60,{jump:true},floor);assert.ok(jump.velocity[1]>4);run(jump,2);assert.ok(jump.grounded&&Math.abs(jump.position[1]-jump.eyeHeight)<.005);
 const a=new Walker(),b=new Walker();run(a,2,{move:[0,1]});run(b,2,{move:[1,1]});assert.ok(Math.abs(Math.hypot(a.position[0],a.position[2])-Math.hypot(b.position[0],b.position[2]))<1e-6);
});
test('carved cohesive deposits can erode, preserving the scaled CSG void instead of filling it',()=>{
 const b=flat(1),p={id:b.nextId++,position:[0,1,0],mass:.1,shapeRadius:.4,packing:.56,wet:1,memory:1,anchored:true,velocity:[0,0,0],cuts:[{offset:[0,.3,0],radius:.2}]};b.parcels.push(p);const mass=b.totalMass();erodeSand(b,.2,air(180),10,empty);
 assert.ok(p.mass<.1);const shrink=Math.cbrt(p.mass/.1);assert.ok(Math.abs(p.cuts[0].radius-.2*shrink)<1e-12);assert.ok(Math.abs(p.cuts[0].offset[1]-.3*shrink)<1e-12);assert.ok(Math.abs(b.totalMass()-mass)<1e-10);
});
