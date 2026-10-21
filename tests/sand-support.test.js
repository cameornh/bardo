import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed,SAND,moisture} from '../src/sand-lab/sand.js';
import {shapeHeight,shapeDistance} from '../src/sand-lab/sand-shape.js';
import {sandFeet,supportsSand} from '../src/sand-lab/sand-support.js';

const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
const flat=()=>{const b=new SandBed(33);b.base.fill(-.7);b.update();return b;};
const add=(b,position,r,wet=0)=>{const p={id:b.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*SAND.packing,packing:SAND.packing,wet,memory:wet};b.parcels.push(p);return p;};
const run=(b,s)=>{for(let i=0;i<Math.ceil(s*30);i++)b.step(1/30,air,calm,10);};
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);

test('dry overhangs fall around a wet mound while its adhered shape stays put',()=>{
 const b=flat(),base=add(b,[0,.3,0],.3,.95);b.deposit(base,base.mass);
 const top=add(b,[0,1,0],.22),stock=top.mass,total=b.totalMass(),columns=b.mass.reduce((m,v)=>m+v,0);run(b,15);
 const loose=b.parcels.filter(p=>p!==base),resting=loose.filter(p=>p.position[1]>.4),fallen=b.mass.reduce((m,v)=>m+v,0)-columns;
 assert.ok(resting.length>3&&loose.length<20,'loose edges must shed without the supported center disappearing');
 assert.ok(fallen>stock*.1,'a material fraction falls, not merely an invisible tiny crumb');
 assert.ok(loose.every(p=>p.wet===0&&p.memory===0));near(loose.reduce((m,p)=>m+p.mass,0)+fallen,stock);
 assert.deepEqual(base.position,[0,.3,0]);near(b.totalMass(),total);
 assert.ok(loose.length<=25&&loose.every(p=>!p.cuts),'fixed, nonrecursive settling work');
 // Curved contact follows the mound, rather than a broad flat underside.
 assert.ok(resting.every(p=>Math.abs(shapeDistance(base,[p.position[0],p.position[1]-shapeHeight(p),p.position[2]]))<.006));
});

test('a dry support cannot hang from a wet chunk or transmit a tensile side bond',()=>{
 const b=flat(),wet=add(b,[0,.5,0],.25,.95),dry=add(b,[.39,.5,0],.15);
 assert.equal(supportsSand(wet,dry),false);
 assert.equal(supportsSand(dry,wet),false);
 dry.wet=dry.memory=.95;assert.equal(supportsSand(wet,dry),true,'wet adhesion can support the same touching geometry');
});

test('a mixed handful lands without leaving its wet top in the air after dry stock enters the bed',()=>{
 const b=flat(),dry=add(b,[0,.7,0],.25),wet=add(b,[0,1.06,0],.12,.95);
 dry.batch=wet.batch=7;dry.held=wet.held=true;run(b,.1);dry.held=wet.held=false;
 const total=b.totalMass();run(b,8);
 assert.equal(dry.mass,0);assert.ok(wet.anchored&&wet.position[1]<.25);
 near(wet.position[1]-shapeHeight(wet),b.height(wet.position[0],wet.position[2]),.002);
 near(b.totalMass(),total);assert.ok(wet.wet>.93);
});

test('wet support is rechecked after its loose supporting layer moves, without another user edit',()=>{
 const b=flat(),base=add(b,[0,.3,0],.3,.95);b.deposit(base,base.mass);
 const dry=add(b,[.3,.57,0],.1);dry.layer=true;dry.looseResolved=true;dry.anchored=true;
 const wet=add(b,[.32,.75,0],.08,.95);wet.anchored=true;
 const y=wet.position[1],total=b.totalMass();run(b,12);
 assert.ok(wet.position[1]<y-.15,'a wet cap follows the lost support down');
 near(b.totalMass(),total);
});

test('cut-away portions of a scoop never support a suspended wet cap',()=>{
 const b=flat(),p=add(b,[0,.3,0],.3,.95);p.shapeRadius=.3;p.cuts=[{offset:[0,-.24,0],radius:.36}];p.anchored=true;
 const lowest=()=>Math.min(...sandFeet(p).map(f=>f[1]+p.position[1]));assert.ok(lowest()>.25);
 b.releaseUnsupported();assert.equal(p.anchored,false);
 const total=b.totalMass();run(b,3);assert.ok(p.anchored);near(lowest(),0,.002);near(b.totalMass(),total);
});

test('a removed CSG region does not weld disconnected wet pieces into the same falling group',()=>{
 const b=flat(),low=add(b,[0,.1,0],.1,.95),high=add(b,[0,.3,0],.3,.95);
 high.shapeRadius=.3;high.cuts=[{offset:[0,-.24,0],radius:.36}];low.batch=high.batch=1;
 run(b,.1);assert.ok(low.anchored);assert.ok(!high.anchored);assert.ok(high.position[1]<.3);
});

test('cached support loses a drying bond continuously and rechecks when bond strength crosses its limit',()=>{
 const b=flat(),base=add(b,[0,.3,0],.3,.95),side=add(b,[.4,.25,0],.14,.65);
 base.anchored=side.anchored=true;side.memory=0;b.releaseUnsupported();assert.ok(side.anchored);
 // Fresh weakly wetted material has no permanent clay bond to retain.
 side.wet=moisture(side.wet,false,4000);b.releaseUnsupported();assert.equal(side.anchored,false);
});

test('cached and uncached settling match through motion, wetting and support removal',()=>{
 const make=cache=>{const b=flat();b.optimizations={sandCache:cache};const base=add(b,[0,.3,0],.3,.95);b.deposit(base,base.mass);add(b,[0,1,0],.2);return b;};
 const a=make(true),b=make(false),state=b=>({mass:[...b.mass],parcels:b.parcels.map(p=>({position:p.position,velocity:p.velocity,mass:p.mass,aspect:p.aspect,wet:p.wet,anchored:p.anchored}))});
 run(a,8);run(b,8);assert.deepEqual(state(a),state(b));
 for(const bed of [a,b]){for(const p of bed.parcels)if(p.id!==1)p.wet=.9;run(bed,1);bed.parcels[0].held=true;bed.parcels[0].anchored=false;bed.parcels[0].position[0]=2;run(bed,3);}
 assert.deepEqual(state(a),state(b));
});
