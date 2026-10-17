import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed,SAND,aggregateRadius} from '../src/sand-lab/sand.js';
import {makeBody,resolveSandContacts} from '../src/sand-lab/objects.js';

const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);
const flat=()=>{const bed=new SandBed(33);bed.base.fill(-.7);bed.update();return bed;};
const chunk=(bed,position,wet=.95,radius=.2)=>{
 const p={id:bed.nextId++,position:position.slice(),velocity:[0,0,0],mass:4*Math.PI/3*radius**3*SAND.packing,packing:SAND.packing,wet,memory:wet,held:false};bed.parcels.push(p);return p;
};
const run=(bed,seconds,water=air,dt=1/30)=>{for(let t=0;t<seconds-1e-8;t+=dt)bed.step(dt,water,calm,10,0,.12);};

test('wet landing bonds the original SDF shape and moisture instead of diluting into a dry bed',()=>{
 const bed=flat(),p=chunk(bed,[0,.8,0]),initial=bed.totalMass(),mass=p.mass,r=aggregateRadius(p),columns=bed.mass.slice();
 run(bed,2);assert.equal(p.anchored,true);near(p.mass,mass);near(aggregateRadius(p),r);assert.deepEqual(bed.mass,columns);
 assert.ok(p.wet>.94);assert.ok(bed.materialAt([0,p.position[1]+r,0])>.94);near(bed.sample(0,0),0);
 const landed=p.position.slice(),surface=bed.distance([0,landed[1]+r,0]);run(bed,30);
 assert.deepEqual(p.position,landed);assert.deepEqual(p.velocity,[0,0,0]);near(bed.distance([0,landed[1]+r,0]),surface);
 assert.ok(p.wet>.88);near(bed.totalMass(),initial);
});

test('a second wet chunk sticks onto the first and can be grabbed again with its moisture intact',()=>{
 const bed=flat(),base=chunk(bed,[0,.2,0]);bed.deposit(base,base.mass);
 const top=chunk(bed,[.05,1,0]),initial=bed.totalMass();run(bed,2);
 assert.ok(top.anchored&&base.anchored);assert.ok(top.position[1]>.55);
 const positions=bed.parcels.map(p=>p.position.slice());run(bed,10);assert.deepEqual(bed.parcels.map(p=>p.position),positions);
 const picked=bed.extract(top.position,.12,[0,0,0],true);assert.ok(picked.length>0&&!picked.includes(top));assert.equal(top.held,false);assert.ok(picked.every(p=>p.held&&!p.anchored&&p.wet>.92));near(bed.totalMass(),initial);
});

test('held dry sand wets through exterior water contact without moving or losing stock',()=>{
 const bed=flat(),p=chunk(bed,[0,2,0],0);p.held=true;p.batch=1;
 const position=p.position.slice(),mass=p.mass;
 // Its own displaced cavity is dry. Surrounding water still wets the sand.
 const water=q=>({density:Math.hypot(...q.map((v,k)=>v-position[k]))>.23?1:0,velocity:[2,0,0]});
 run(bed,12,water);assert.ok(p.wet>.9);assert.ok(p.memory>.9);assert.deepEqual(p.position,position);near(p.mass,mass);assert.equal(p.held,true);
 p.held=false;run(bed,3);assert.ok(p.anchored);assert.ok(p.wet>.9);assert.ok(bed.materialAt(p.position)>.9);
});

test('a wet selection lands as one cohesive shape instead of settling each support sphere independently',()=>{
 const bed=flat(),a=chunk(bed,[-.1,.7,0]),b=chunk(bed,[.1,.9,0]);a.batch=b.batch=7;
 const offset=b.position.map((v,k)=>v-a.position[k]),initial=bed.totalMass();run(bed,2);
 assert.ok(a.anchored&&b.anchored);for(let k=0;k<3;k++)near(b.position[k]-a.position[k],offset[k]);near(bed.totalMass(),initial);
});

test('disconnected pieces in one grab do not become suspended when another piece lands',()=>{
 const bed=flat(),low=chunk(bed,[0,.2,0]),high=chunk(bed,[1,1,0]);low.batch=high.batch=1;
 run(bed,.3);assert.ok(low.anchored);assert.ok(!high.anchored);assert.ok(high.position[1]<1&&high.position[1]>.8);run(bed,2);assert.ok(high.anchored);assert.ok(high.position[1]<.21);
});

test('steep wet terrain does not repose, and dried clay retains its shape memory',()=>{
 const bed=flat(),k=16*bed.n+16;bed.mass[k]+=.5;bed.wet.fill(.9);bed.memory.fill(.9);const mass=bed.mass.slice();
 run(bed,2);assert.deepEqual(bed.mass,mass);bed.wet.fill(0);run(bed,2);assert.deepEqual(bed.mass,mass);
});

test('dry deposits settle through the continuous bed while conserving grains',()=>{
 const bed=flat(),p=chunk(bed,[0,.21,0],0,.2),initial=bed.totalMass();run(bed,.3);assert.equal(p.mass,0);assert.ok(!bed.parcels.includes(p));
 const k=16*bed.n+16;bed.mass[k]+=.3;const mound=bed.heightAt(k),stock=bed.totalMass();run(bed,4);assert.ok(bed.heightAt(k)<mound);near(bed.totalMass(),stock);near(stock,initial+.3);
});

test('bonded SDF deposits resist body contacts but can still be pushed deliberately',()=>{
 const bed=flat(),p=chunk(bed,[0,.2,0]);bed.deposit(p,p.mass);const position=p.position.slice(),body=makeBody('rock','sphere',.15,[0,.5,0],[0,-1,0]);
 resolveSandContacts([p],[body],1/30);assert.deepEqual(p.position,position);assert.ok(body.position[1]>.549);assert.ok(body.velocity[1]>=0);
 const initial=bed.totalMass(),moved=bed.push([0,.4,0],.2,[1,0,0],.15);assert.ok(moved.some(q=>!q.anchored&&!q.held&&q.velocity[0]>0));near(bed.totalMass(),initial);
 const before=moved[0].position[0];run(bed,1/30);assert.ok(moved[0].position[0]>before);assert.ok(!moved[0].anchored);near(bed.totalMass(),initial);
});

test('swept landing catches fast wet chunks without burying them in the terrain',()=>{
 const bed=flat(),p=chunk(bed,[0,1,0],.95,.08);p.velocity=[0,-20,0];bed.step(.1,air,calm,10);
 assert.ok(p.anchored);assert.ok(p.position[1]>=.079);near(bed.totalMass(),bed.initialMass+p.mass);
});
