import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed} from '../src/sand-lab/sand.js';
import {cutShape,shapeDistance} from '../src/sand-lab/sand-shape.js';
import {makeBody,resolveSandContacts} from '../src/sand-lab/objects.js';
import {bodyContactPoints,resolveBodyTerrain,integrateOrientation,bodyMass} from '../src/sand-lab/rigid-contacts.js';
import {BoundsGrid} from '../src/sand-lab/spatial-bounds.js';
import {resolveCarvedSandContacts} from '../src/rtx-sand-lab/carved-sand-contacts.js';
import {SandEditPolicy} from '../src/rtx-sand-lab/sand-edit-policy.js';
import {LiveSandLab,LIVE_WIND_BRUSH} from '../src/rtx-sand-lab/live-lab.js';
import {createSandWind} from '../src/sand-lab/sand-air.js';
import {labAirVelocity} from '../src/sand-lab/water-lab-air.js';
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function bowlFixture(){
 const bed=new SandBed(33);bed.editPolicy=new SandEditPolicy();bed.base.fill(-.7);bed.wet.fill(.95);bed.memory.fill(.95);bed.update();
 const sand={id:bed.nextId++,position:[0,1,0],velocity:[0,0,0],mass:4*Math.PI/3*.56,packing:.56,wet:.95,memory:.95,anchored:true};
 bed.parcels.push(sand);bed.update();const mass=bed.totalMass();bed.carve([0,1.7,0],.8);near(bed.totalMass()+bed.removedMass,mass);
 return {bed,sand};
}
test('a ball placed inside a carved bowl is not ejected by the original sand sphere',()=>{
 const {sand}=bowlFixture(),old=makeBody('rock','sphere',.18,[0,1.4,0]),body=makeBody('rock','sphere',.18,[0,1.4,0]);
 resolveSandContacts([sand],[old],1/60);assert.ok(old.position[1]>2,'reproduces the previous sphere-bound ejection');
 const fixed=sand.position.slice();for(let i=0;i<20;i++)resolveCarvedSandContacts([sand],[body],1/60,new BoundsGrid());
 assert.deepEqual(body.position,[0,1.4,0]);assert.deepEqual(body.velocity,[0,0,0]);assert.deepEqual(sand.position,fixed);assert.ok(sand.anchored);
});
test('glass, mirror, rock and light balls fall to the carved floor, not the old top',()=>{
 for(const kind of ['glass','mirror','rock','light']){
  const {bed,sand}=bowlFixture(),b=makeBody(kind,'sphere',.18,[0,2.5,0]),grid=new BoundsGrid(),start=bed.totalMass();
  for(let i=0;i<480;i++){const h=1/120;resolveCarvedSandContacts(bed.parcels,[b],h,grid);b.velocity[1]-=9.81*h;for(let k=0;k<3;k++)b.position[k]+=b.velocity[k]*h;integrateOrientation(b,h);resolveBodyTerrain(b,p=>bed.distance(p),h);}
  assert.ok(b.position[1]>1.07&&b.position[1]<1.12,`${kind}: ${b.position}`);
  assert.ok(Math.min(...bodyContactPoints(b).map(p=>bed.distance(p)))>-.001);assert.ok(sand.anchored);near(bed.totalMass(),start);
 }
});
test('carved walls push objects into the cavity, and tilted cups use their actual surfaces',()=>{
 for(const shape of ['sphere','cup'])for(const tilt of [0,.6,1.3]){
  const {bed,sand}=bowlFixture(),b=makeBody('rock',shape,.15,[.63,1.33,0]);b.tilt=tilt;b.pitch=.3;const x=b.position[0];
  for(let i=0;i<12;i++){resolveCarvedSandContacts([sand],[b],1/60);resolveBodyTerrain(b,p=>bed.distance(p),1/60);}
  assert.ok(b.position[0]<x,`${shape} ${tilt}: ${b.position}`);
  assert.ok(b.position[1]<1.8);assert.ok(Math.min(...bodyContactPoints(b).map(p=>shapeDistance(sand,p)))>-.002);
 }
});
test('enclosed spherical cavities and intersection-cut portions do not acquire false walls',()=>{
 for(const intersection of [false,true]){
  const {sand}=bowlFixture();sand.cuts=[{offset:[0,0,0],radius:.65}];
  if(intersection)sand.cuts.push({offset:[0,.1,0],radius:-.9});
  for(const shape of ['sphere','cup']){const b=makeBody('glass',shape,.15,[0,1,0]);b.tilt=.8;const position=b.position.slice();
   const report=resolveCarvedSandContacts([sand],[b],1/60,new BoundsGrid());assert.deepEqual(b.position,position);assert.equal(report.contacts,0);
  }
 }
});
test('surface caches refresh after another cut or motion, with identical broadphase results',()=>{
 const {sand}=bowlFixture(),a=makeBody('rock','sphere',.18,[0,1.4,0]);resolveCarvedSandContacts([sand],[a],1/60);
 cutShape(sand,[.6,1.4,0],.35);sand.position[0]=2;
 const copy=structuredClone(sand),b=makeBody('rock','cup',.18,[2.6,1.4,0]);b.tilt=.9;const c=structuredClone(b);
 for(let i=0;i<8;i++){resolveCarvedSandContacts([sand],[b],1/60);resolveCarvedSandContacts([copy],[c],1/60,new BoundsGrid());}
 assert.deepEqual(b,c);assert.deepEqual(sand,copy);assert.ok([...b.position,...b.velocity,...b.omega].every(Number.isFinite));
});
test('mobile carved sand and a body exchange equal and opposite linear momentum',()=>{
 const {sand}=bowlFixture();sand.anchored=false;sand.velocity=[0,0,0];
 const b=makeBody('rock','sphere',.2,[.67,1.3,0],[1,-.4,0]),mass=bodyMass(b),before=b.velocity.map(v=>v*mass);
 resolveCarvedSandContacts([sand],[b],1/60);
 for(let k=0;k<3;k++)near(b.velocity[k]*mass+sand.velocity[k]*sand.mass*2.65,before[k]);
 assert.ok(b.omega.some(v=>Math.abs(v)>0));
});
test('a small carved piece inside a larger held object is expelled without phantom cavity contacts',()=>{
 const p={position:[.05,1,0],velocity:[0,0,0],shapeRadius:.15,mass:.001,packing:.56,wet:.9,memory:.9,cuts:[{offset:[0,.12,0],radius:.12}]},b=makeBody('rock','sphere',.6,[0,1,0]);b.held=true;
 const before=p.position.slice();for(let i=0;i<6;i++)resolveCarvedSandContacts([p],[b],1/60);
 assert.ok(Math.hypot(...p.position.map((v,k)=>v-before[k]))>.3);assert.deepEqual(b.position,[0,1,0]);assert.ok(p.position.every(Number.isFinite));
});
test('the shared live scene selects carved contacts and retains the historical ordinary-grain path',()=>{
 const lab=new LiveSandLab({extensions:{has:()=>false}}),{bed}=bowlFixture();lab.sand=bed;const b=makeBody('rock','sphere',.18,[0,1.4,0]);lab.balls=[b];lab.resolveSandObjectContacts(1/60);
 assert.equal(lab.sandContactStats.carvedPairs,1);assert.deepEqual(b.position,[0,1.4,0]);
 const a={position:[0,.2,0],velocity:[0,0,0],mass:.56*4*Math.PI/3*.2**3,packing:.56,wet:.95,memory:.95,anchored:true},c=makeBody('rock','sphere',.15,[0,.5,0],[0,-1,0]),aa=structuredClone(a),cc=structuredClone(c);
 resolveCarvedSandContacts([a],[c],1/60);resolveSandContacts([aa],[cc],1/60);assert.deepEqual(a,aa);assert.deepEqual(c,cc);
});
test('the actual live prepare-step path keeps an object in the carved cavity',()=>{
 const lab=new LiveSandLab({extensions:{has:()=>false}}),{bed}=bowlFixture();lab.sand=bed;lab.wind=0;lab.tidesEnabled=false;lab.rain.enabled=false;
 lab.positions=new Float32Array();lab.velocities=new Float32Array();lab.chem=new Float32Array();lab.neighborCounts=new Uint16Array();lab.fluidIndex=null;
 const b=makeBody('rock','sphere',.18,[0,1.4,0]);lab.balls=[b];const context=lab.prepareStep(1/60);
 assert.equal(context.predicted.length,0);assert.equal(lab.sandContactStats.carvedPairs,1);assert.ok(b.position[1]>1.39&&b.position[1]<1.4,`${b.position}`);
});
test('live wind brush gives ten times the previous live surface velocity and maximum',()=>{
 assert.equal(LIVE_WIND_BRUSH.initial/240,10);assert.equal(LIVE_WIND_BRUSH.max/900,10);
 const live=new LiveSandLab({extensions:{has:()=>false}});assert.equal(live.windStrength,2400);live.configure('ocean');assert.equal(live.windStrength,2400);
 const make=strength=>{const {bed}=bowlFixture();bed.parcels=[];bed.update();return {sand:bed,balls:[],spec:{scale:10},time:0,wind:0,windTurbulence:1,windStrength:strength,radius:.5,jet:{origin:[0,2,0],direction:[0,-1,0]},optimizations:{windGeometry:true}};};
 const old=createSandWind(make(240)),strong=createSandWind(make(LIVE_WIND_BRUSH.initial));
 for(const point of [[.2,.03,0],[.35,.06,.1],[-.2,.1,.1]]){
  const a=old(point),b=strong(point);assert.ok(Math.hypot(...b)>0);for(let k=0;k<3;k++)near(b[k],a[k]*10);
 }
 for(const strength of [LIVE_WIND_BRUSH.initial,LIVE_WIND_BRUSH.max]){
  const lab=make(strength);lab.solid=p=>p[1];const v=labAirVelocity([.1,1,0],lab);assert.ok(v.every(Number.isFinite));assert.ok(Math.hypot(...v)>strength/100);
 }
});
