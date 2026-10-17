import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed,SAND,moisture} from '../src/sand-lab/sand.js';
import {sandAdhesion} from '../src/sand-lab/sand-material.js';
import {shapeRadius,shapeHeight,shapeDistance,cutShape} from '../src/sand-lab/sand-shape.js';

const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const bed=()=>{const b=new SandBed(33);b.base.fill(-.7);b.update();return b;};
const chunk=(b,position,r,wet=0)=>{const p={id:b.nextId++,position:position.slice(),velocity:[0,0,0],mass:4*Math.PI/3*r**3*SAND.packing,packing:SAND.packing,wet,memory:wet};b.parcels.push(p);return p;};
const run=(b,seconds,water=air,dt=1/30)=>{for(let i=0;i<Math.ceil(seconds/dt);i++)b.step(dt,water,calm,10,0,.08);};
function layered(){const b=bed(),base=chunk(b,[0,.3,0],.3,.95);b.deposit(base,base.mass);const top=chunk(b,[0,1,0],.15),initial=b.totalMass();run(b,8);return {b,base,top,initial};}

test('dry sand remains a loose visible layer above wet SDF stock, without inheriting its moisture',()=>{
 const {b,base,top,initial}=layered();
 assert.equal(b.parcels.length,2);assert.ok(top.anchored&&top.layer);
 assert.ok(top.position[1]>.6&&top.aspect<.34);near(top.wet,0);near(top.memory,0);
 near(top.position[1]-shapeHeight(top),.6,.002);
 near(b.materialAt([0,top.position[1]+shapeHeight(top),0]),0);
 assert.ok(b.materialAt([.29,.3,0])>.9);
 near(4*Math.PI/3*shapeRadius(top)**3*top.aspect,top.mass/top.packing);
 assert.ok(shapeDistance(base,[0,.6,0])<1e-8);near(b.totalMass(),initial);
});

test('dry deposits over wet ground retain their own surface moisture and mass',()=>{
 const b=bed();b.wet.fill(.95);b.memory.fill(.95);const columns=b.mass.slice(),p=chunk(b,[0,.6,0],.14),initial=b.totalMass();run(b,6);
 assert.ok(p.anchored&&p.mass>0&&p.aspect<.34);assert.deepEqual(b.mass,columns);
 near(b.materialAt([0,p.position[1]+shapeHeight(p),0]),0);near(b.totalMass(),initial);
});

test('loose dry sand slides off a steep wet support while wet sand adheres there',()=>{
 const land=wet=>{const b=bed(),base=chunk(b,[0,.3,0],.3,.95);b.deposit(base,base.mass);const p=chunk(b,[.3,.9,0],.1,wet),initial=b.totalMass();run(b,10);near(b.totalMass(),initial);return p;};
 const loose=land(0),bonded=land(.95);
 assert.ok(loose.position[1]<.1&&loose.position[0]>.34);
 assert.ok(bonded.position[1]>.5);near(bonded.position[0],.3);
});

test('wetting a loose layer bonds its current shape; slow drying has no last-frame collapse',()=>{
 const {b,base,top,initial}=layered(),water=q=>({density:q[1]>.48?1:0,velocity:[0,0,0]});
 run(b,15,water);assert.ok(top.wet>.94&&sandAdhesion(top.wet,top.memory)>.99);
 const position=top.position.slice(),aspect=top.aspect;run(b,8,water);
 assert.deepEqual(top.position,position);near(top.aspect,aspect);near(b.totalMass(),initial);
 // Advance evaporation on a long physical timescale without changing stock.
 for(let i=0;i<600;i++){base.wet=moisture(base.wet,false,15);top.wet=moisture(top.wet,false,15);b.stepParcels(.03,air,calm,10,0,.08);}
 assert.ok(top.wet<1e-6&&base.wet<1e-6);near(top.aspect,aspect);near(top.position[1],position[1],.003);
 assert.ok(sandAdhesion(top.wet,top.memory)>.18&&sandAdhesion(top.wet,top.memory)<.21);
 near(b.totalMass(),initial);
});

test('drying the support does not wet, absorb, or switch the loose layer above it',()=>{
 const {b,base,top,initial}=layered(),position=top.position.slice();
 for(let i=0;i<900;i++){base.wet=moisture(base.wet,false,10);b.stepParcels(.03,air,calm,10,0,.08);}
 assert.ok(base.wet<1e-6);near(top.wet,0);near(top.memory,0);assert.ok(top.mass>0);
 near(top.position[1],position[1],.003);near(b.totalMass(),initial);
});

test('removing wet support drops the loose cap instead of suspending or deleting it',()=>{
 const {b,base,top,initial}=layered(),y=top.position[1];base.held=true;base.anchored=false;base.position[0]=2;
 b.releaseUnsupported();assert.equal(top.anchored,false);run(b,2);
 assert.ok(top.position[1]<y-.3&&top.mass>0);near(b.totalMass(),initial);
});

test('a small grab intersects a flattened loose deposit and preserves both shapes and stock',()=>{
 const {b,top,initial}=layered(),point=[0,top.position[1]+shapeHeight(top)-.005,0],r=.025;
 const p=cutShape(top,point,r);assert.ok(p&&p.mass>0&&p.mass<top.mass*.1);
 assert.ok(shapeDistance(p,point)<0&&shapeDistance(top,point)>0);
 assert.ok(p.cuts.some(c=>c.aspect<.34));b.parcels.push(p);near(b.totalMass(),initial);
});

test('long wet compaction strokes stay bounded, preserve mass and keep the packing limit',()=>{
 const b=bed();b.wet.fill(.95);b.memory.fill(.95);b.update();const initial=b.totalMass(),before=b.height(0,3);
 for(let i=0;i<120;i++){const x=.1*Math.sin(i*.1);b.push([x,b.height(x,3),3],.35,[0,-.6,1],.09);run(b,1/30);}
 assert.ok(b.height(0,3)<before);near(b.totalMass(),initial,1e-8);assert.equal(b.parcels.length,0);
 assert.ok(b.packing.every(v=>v<=SAND.maxPacking&&v>=SAND.packing));
});

test('repeated pushing of deposited wet sand deforms existing stock without CSG multiplication',()=>{
 const b=bed(),p=chunk(b,[0,.2,0],.2,.95);b.deposit(p,p.mass);const initial=b.totalMass(),start=p.packing;
 for(let i=0;i<80;i++){b.push(p.position,.12,[1,-.1,0],.025);run(b,1/30);}
 assert.equal(b.parcels.length,1);assert.equal(p.cuts,undefined);assert.ok(p.packing>start&&p.packing<=SAND.maxPacking);
 assert.ok(p.position[0]>.02);near(b.totalMass(),initial);
});

test('adhesion is continuous through the dry limit and a previously wet shape has only a fraction left',()=>{
 near(sandAdhesion(0,1),.2);near(sandAdhesion(0,0),0);near(sandAdhesion(1,0),1);
 assert.ok(sandAdhesion(1e-6,1)-sandAdhesion(0,1)<1e-9);
 for(let w=0;w<.99;w+=.001)assert.ok(sandAdhesion(w+.001,.9)>=sandAdhesion(w,.9));
});
