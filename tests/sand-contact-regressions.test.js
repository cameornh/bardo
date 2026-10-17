import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed,SAND,aggregateRadius} from '../src/sand-lab/sand.js';
import {shapeDistance,cutShape,sphereIntersection} from '../src/sand-lab/sand-shape.js';
import {makeBody,bodyVolume,playerBodyContact,bodyDistance,bodyNormal} from '../src/sand-lab/objects.js';
import {Walker} from '../src/sand-lab/walker.js';
import {shoreImage,reconstructionSample} from '../src/sand-lab/reconstruction.js';
const empty=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
const flat=()=>{const b=new SandBed(33);b.base.fill(-.7);b.update();return b;};
const chunk=(bed,position,r)=>{const p={id:bed.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*SAND.packing,packing:SAND.packing,wet:.95,memory:.95,anchored:true};bed.parcels.push(p);return p;};

test('small sand brush cuts only its intersection from a large placed clump',()=>{
 const bed=flat(),p=chunk(bed,[0,.4,0],.4),before=bed.totalMass(),original=p.mass,r=.01,point=[.399,.4,0];
 const pieces=bed.extract(point,r,[0,0,0],true),mass=pieces.reduce((s,p)=>s+p.mass,0);
 assert.equal(pieces.length,1);assert.ok(!p.held);assert.ok(mass>0&&mass<original*.0001);
 assert.ok(Math.abs(mass-sphereIntersection(.4,r,.399)*SAND.packing)<1e-12);
 assert.equal(aggregateRadius(p),.4);assert.ok(shapeDistance(p,point)>0);assert.ok(shapeDistance(pieces[0],[.397,.4,0])<0);
 assert.ok(pieces.every(q=>q.wet===.95));assert.ok(Math.abs(bed.totalMass()-before)<1e-12);
 assert.equal(cutShape(p,point,r),null,'already empty material cannot be picked up twice');
});
test('moving the supporting clump releases attached sand instead of suspending it',()=>{
 const bed=flat(),base=chunk(bed,[0,.2,0],.2),top=chunk(bed,[0,.45,0],.05),before=bed.totalMass();
 bed.releaseUnsupported();assert.ok(top.anchored);
 const picked=bed.extract([0,.1,0],.31,[0,0,0],true);assert.ok(picked.some(p=>p.mass===base.mass||p.shapeRadius===undefined));
 assert.ok(!top.anchored);const y=top.position[1];for(let i=0;i<8;i++)bed.step(.03,empty,calm,10);
 assert.ok(top.position[1]<y-.01);assert.ok(Math.abs(bed.totalMass()-before)<1e-12);
});
test('player-body contacts transfer equal and opposite momentum, with mass-dependent response',()=>{
 for(const kind of ['glass','mirror','rock','light']){
  const body=makeBody(kind,'sphere',.02,[.05,.1,0]),walker={position:[0,1.65,0],velocity:[3,0,0],radius:.28};
  const scale=10,mass=bodyVolume(body)*body.ratio*1000*scale**3,before=80*walker.velocity[0];
  assert.ok(playerBodyContact(walker,body,[.24,1,0],scale));
  assert.ok(body.velocity[0]>0);assert.ok(walker.velocity[0]<3);
  assert.ok(Math.abs(80*walker.velocity[0]+mass*body.velocity[0]*scale-before)<1e-8);
 }
});
test('walking into an object pushes it rather than treating it as immovable scenery',()=>{
 const walker=new Walker(),body=makeBody('rock','sphere',.2,[1,.25,0]);walker.grounded=true;
 const solid=q=>{const d=bodyDistance(q,body);return d<q[1]?{distance:d,normal:bodyNormal(q,body),resolve:(w,p)=>playerBodyContact(w,body,p)}:{distance:q[1],normal:[0,1,0]};};
 for(let i=0;i<90;i++){walker.step(1/60,{forward:[1,0,0],move:[0,1]},solid);body.position[0]+=body.velocity[0]/60;body.velocity[0]*=.98;}
 assert.ok(body.position[0]>2);assert.ok(walker.position[0]>.6);assert.ok(body.position.every(Number.isFinite));
});
test('shore reconstruction keeps a level free surface level across the sloping contact line',()=>{
 for(const slope of [.25,.48,.8]){
  const spacing=.2,bed=(x,z)=>slope*z,items=[];
  for(let x=-.8;x<=.8;x+=spacing)for(let y=-.5;y<=1;y+=spacing)for(let z=-1;z<=1/slope+.4;z+=spacing){
   if(y<bed(x,z)+spacing*.12)continue;const p={position:[x,y,z],radius:spacing*.85,volume:spacing**3};items.push(p);const image=shoreImage(p,bed);if(image){assert.equal(image.position[1],p.position[1]);items.push(image);}
  }
  const top=z=>{let lo=bed(0,z),hi=1.5;for(let j=0;j<16;j++){const y=(lo+hi)/2,d=items.reduce((s,p)=>s+reconstructionSample(p,[0,y,z]),0);if(d>=.18)lo=y;else hi=y;}return (lo+hi)/2;};
  const far=top(0),edge=top(.95/slope);assert.ok(Math.abs(edge-far)<spacing*.25,`${slope}: ${edge} vs ${far}`);
 }
});
