import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed,aggregateRadius,SAND} from '../src/sand-lab/sand.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {carryDistance,solidRayHit,waterRayHit} from '../src/sand-lab/interaction.js';
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
const totalWet=b=>b.mass.reduce((s,m,k)=>s+m*b.wet[k],0)+b.parcels.reduce((s,p)=>s+p.mass*p.wet,0);
const totalVolume=b=>b.mass.reduce((s,m,k)=>s+m/b.packing[k],0)+b.parcels.reduce((s,p)=>s+p.mass/p.packing,0);

test('clumps get stable irregular sizes and positions while conserving stock, moisture and volume',()=>{
 const b=new SandBed(),copy=new SandBed();for(let i=0;i<b.mass.length;i++){b.wet[i]=copy.wet[i]=(i%7)/7;b.packing[i]=copy.packing[i]=.56+(i%4)*.04;}
 const mass=b.totalMass(),wet=totalWet(b),volume=totalVolume(b),point=[0,b.height(0,3),3];
 const pieces=b.extract(point,.7,[0,0,0],true),same=copy.extract(point,.7,[0,0,0],true);
 assert.deepEqual(pieces,same);near(b.totalMass(),mass);near(totalWet(b),wet);near(totalVolume(b),volume);
 assert.ok(pieces.every(p=>p.mass>0&&p.packing>=SAND.packing&&p.packing<=SAND.maxPacking));
 const sizes=pieces.map(aggregateRadius);assert.ok(Math.max(...sizes)/Math.min(...sizes)>1.4);
 const offGrid=pieces.filter(p=>Math.abs((p.position[0]+5.5)/b.dx-Math.round((p.position[0]+5.5)/b.dx))>.03);assert.ok(offGrid.length>pieces.length*.7);
});

test('wet sand retains moisture through carrying, dropping, regrabbing and depositing over dry ground',()=>{
 const sand=new SandBed();for(const [k] of sand.footprint(0,3,1))sand.wet[k]=.9;
 const point=[0,sand.height(0,3),3],initial=sand.totalMass(),pieces=sand.extract(point,.45,[0,0,0],true);
 const lab={sand,sandHeld:pieces,spec:{scale:10},radius:.45,revision:0};
 for(const p of pieces)p.offset=p.position.map((v,k)=>v-point[k]);lab.sandHoldDistance=carryDistance(.7,10);
 SandLab.prototype.moveHeld.call(lab,[2,3,3],[0,0,-1]);
 assert.ok(pieces.every(p=>p.wet>.89&&p.held));near(sand.materialAt(pieces[0].position),.9);
 lab.tool='grab-sand';SandLab.prototype.interact.call(lab,[2,3,3],[0,0,-1]);assert.equal(lab.sandHeld,null);assert.ok(pieces.every(p=>!p.held&&p.wet>.89));
 const picked=sand.extract(pieces[0].position,.8,[0,0,0],true);assert.ok(picked.includes(pieces[0]));assert.ok(picked.every(p=>p.wet>.89));near(sand.totalMass(),initial);
 for(const p of picked){p.held=false;p.position=[2,sand.height(2,3),3];sand.deposit(p,p.mass);}
 assert.ok(sand.sample(2,3)>.01);near(sand.totalMass(),initial);
});

test('rays hit near solids before hidden objects and water, without phantom sky hits',()=>{
 const sand=new SandBed(),front=makeBody('rock','sphere',.3,[0,2,2]),back=makeBody('glass','sphere',.5,[0,2,0]);
 const hit=solidRayHit(sand,[back,front],[0,2,4],[0,0,-1]);assert.equal(hit.body,front);near(hit.distance,1.7,.01);
 assert.equal(waterRayHit(new Float32Array([0,2,0,0]),.2,[0,2,4],[0,0,-1],hit.distance),null);
 const land=solidRayHit(sand,[makeBody('rock','sphere',.2,[0,-1,3])],[0,3,3],[0,-1,0]);assert.equal(land.kind,'sand');near(land.point[1],sand.height(0,3),.006);
 assert.equal(solidRayHit(sand,[],[0,3,3],[0,1,0]),null);
 const liquid=waterRayHit(new Float32Array([0,2,0,0]),.2,[0,2,4],[0,0,-1]);near(liquid.distance,3.84);near(liquid.point[0],0);
});

test('carry clearance is one physical metre for small objects and scales with large selections',()=>{
 near(carryDistance(.08,10)*10,1.8);near(carryDistance(.2,4)*4,1.8);
 assert.ok(carryDistance(.45,10)<.65);assert.ok(carryDistance(2,10)>2);
});

test('loose aggregates can be picked at their visible surface above the bed',()=>{
 const sand=new SandBed(),p={position:[0,3,0],mass:.05,packing:.56,wet:.9,memory:.9,held:false};sand.parcels.push(p);
 const hit=solidRayHit(sand,[],[0,3,3],[0,0,-1]);assert.equal(hit.kind,'sand');near(hit.point[2],aggregateRadius(p),.008);
});

import {scrollHeldDistance,heldDistance} from '../src/sand-lab/interaction.js';
test('wheel distance moves all held materials along the view ray without changing the tool',()=>{
 const fixtures=[
  {heldBody:makeBody('rock','cup',.3,[0,0,0]),objectDistance:1},
  {sandHeld:[{offset:[.1,0,0],mass:.01,packing:.56}],sandHoldDistance:1},
  {held:{ids:[0],offsets:[[.1,0,0]],distance:1}}
 ];
 for(const state of fixtures){const lab={...state,spec:{scale:10},spacing:.1,tool:'grab-sand'},before=heldDistance(lab);
  assert.equal(scrollHeldDistance(lab,-100),true);assert.ok(heldDistance(lab)>before);assert.equal(lab.tool,'grab-sand');
  assert.equal(scrollHeldDistance(lab,100),true);near(heldDistance(lab),before);
  for(let i=0;i<50;i++)scrollHeldDistance(lab,500);assert.ok(heldDistance(lab)>.18);
  for(let i=0;i<50;i++)scrollHeldDistance(lab,-500);assert.ok(heldDistance(lab)<=10);
 }
});
test('empty hands leave wheel navigation alone and trackpad/line wheel deltas agree',()=>{
 const empty={spec:{scale:10}};assert.equal(scrollHeldDistance(empty,-100),false);assert.equal(heldDistance(empty),null);
 const make=()=>({spec:{scale:10},spacing:.1,held:{ids:[0],offsets:[[0,0,0]],distance:1}}),pixel=make(),line=make();
 scrollHeldDistance(pixel,-48,0);scrollHeldDistance(line,-3,1);near(heldDistance(pixel),heldDistance(line));
 const before=heldDistance(line);scrollHeldDistance(line,0);scrollHeldDistance(line,NaN);near(heldDistance(line),before);
});
