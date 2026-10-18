import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed} from '../src/sand-lab/sand.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {shapeRadius,shapeHeight,shapeBlend,shapeDistance,cutShape,packSandShapes} from '../src/sand-lab/sand-shape.js';

const empty=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
const flat=()=>{const b=new SandBed(33);b.base.fill(-.7);b.update();return b;};
function add(b,position,r,wet=0,aspect=1){const p={id:b.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*aspect*.56,packing:.56,wet,memory:wet,aspect};b.parcels.push(p);return p;}
const run=(b,seconds)=>{for(let i=0;i<seconds*30;i++)b.step(1/30,empty,calm,10);};

test('settled kernels join adjacent dry portions without changing their stock or wetting them',()=>{
 const b=flat(),a=add(b,[-.12,.5,0],.12,0,.35),c=add(b,[.12,.5,0],.12,0,.35),point=[0,.54,0];
 const mass=b.totalMass();assert.ok(shapeDistance(a,point)>0&&shapeDistance(c,point)>0);
 assert.ok(b.distance(point)>0,'narrow kernels leave the seam open');
 a.surfaceBlend=c.surfaceBlend=.18;
 assert.ok(b.distance(point)<0,'reconstructed surface fills the inter-parcel seam');
 assert.equal(b.totalMass(),mass);assert.equal(b.materialAt(point),0);
 // The joined surface has a smooth tangent across the former parcel boundary.
 const e=.0001,d=b.distance(point),left=(d-b.distance([-e,point[1],0]))/e,right=(b.distance([e,point[1],0])-d)/e;
 assert.ok(Math.abs(left-right)<.01);
 const q=cutShape(a,[-.16,.52,0],.035);assert.ok(q);
 assert.equal(shapeBlend(a),Math.min(.08,shapeRadius(a)*.5),'a new brush cut must not be filled back in by wide reconstruction');
});

test('broad footprint support releases dry sand balanced on a narrow contact, but retains wet adhesion',()=>{
 const fixture=wet=>{const b=flat(),stem=add(b,[0,.1,0],.1,.95),cap=add(b,[0,.272,0],.16,wet,.45);stem.anchored=cap.anchored=true;cap.layer=true;cap.looseResolved=true;return {b,stem,cap};};
 const dry=fixture(0),wet=fixture(.95),stock=dry.b.totalMass();run(dry.b,8);run(wet.b,8);
 assert.ok(dry.cap.mass===0||dry.cap.position[1]<.12,'dry cap must slide off a point-supported shelf');
 assert.ok(wet.cap.anchored&&wet.cap.position[1]>.25,'a bonded cap keeps its structure');
 assert.ok(Math.abs(dry.b.totalMass()-stock)<1e-9);
});

test('successive dry drops shed excess stock instead of building a tower of supported disks',()=>{
 const b=flat(),base=add(b,[0,.3,0],.32,.95);b.deposit(base,base.mass);let total=b.totalMass();
 const columns=b.mass.reduce((a,v)=>a+v,0);let dropped=0;
 for(let i=0;i<4;i++){
  const y=Math.max(...b.parcels.map(p=>p.position[1]+shapeHeight(p)))+.6,p=add(b,[0,y,0],.19);total+=p.mass;dropped+=p.mass;run(b,16);
  assert.ok(Math.max(...b.parcels.map(p=>p.position[1]+shapeHeight(p)))<.9,'loose stock may not build a steep column');
  assert.ok(b.parcels.length<=26,'settling stays bounded after repeated drops');
 }
 assert.ok(b.mass.reduce((a,v)=>a+v,0)-columns>dropped*.6);
 assert.ok(Math.abs(b.totalMass()-total)<1e-9);assert.deepEqual(base.position,[0,.3,0]);
});

test('reconstruction widths update spatial caches and packed CSG offsets correctly',()=>{
 const lab=new SandLab({extensions:{has:()=>false}}),b=lab.sand;
 const a=add(b,[0,2,3],.1),c=add(b,[.2,2,3],.1,.95);
 cutShape(c,[.26,2,3],.07);b.update();lab.syncUniforms();const before=lab.sandBinRebuilds;
 a.surfaceBlend=.18;b.update();lab.syncUniforms();assert.ok(lab.sandBinRebuilds>before);
 const data=packSandShapes(b.parcels).data;
 assert.ok(Math.abs(data[8]-.18)<1e-7);assert.equal(data[18],6);assert.equal(data[19],1);
 assert.ok(Math.abs(data[data[18]*4]-.26)<1e-7);
 const point=[.03,2.04,3];assert.ok(Math.abs(lab.solid(point,false,false)-b.distance(point))<1e-6);
 const version=lab.sandBinRebuilds;c.wet=.37;b.update();lab.syncUniforms();assert.equal(lab.sandBinRebuilds,version);
 assert.ok(Math.abs(lab.u.uSandParcels.value.image.data[16]-.37)<1e-7);
});
