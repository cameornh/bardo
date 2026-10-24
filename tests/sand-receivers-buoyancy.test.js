import test from 'node:test';
import assert from 'node:assert/strict';
import {SandLab} from '../src/sand-lab/lab.js';
import {LabRain} from '../src/sand-lab/water-lab-rain.js';
import {makeBody,bodyDistance,bodySupport,playerBodyContact} from '../src/sand-lab/objects.js';
import {bodyMass,bodyImpulse,resolveBodyPairs,resolveBodyTerrain,integrateOrientation} from '../src/sand-lab/rigid-contacts.js';
import {applyBodyWaterDrag,bodyInertia} from '../src/sand-lab/body-water-drag.js';
const axes=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function samples(b,velocity=()=>[0,0,0],wet=()=>1){return axes.map(n=>{const p=b.position.map((v,k)=>v+n[k]*bodySupport(b,n));return {p,w:wet(p),sample:{velocity:velocity(p)}};});}
function energy(b){const I=bodyInertia(b);return .5*bodyMass(b)*b.velocity.reduce((s,v)=>s+v*v,0)+.5*b.omega.reduce((s,w,i)=>s+w*I[i].reduce((s,v,j)=>s+v*b.omega[j],0),0);}
function rainFixture(){const b=makeBody('glass','sphere',.5,[0,0,0]),lab={sand:{materialAt:()=>1,distance:p=>p[1]+1},spec:{scale:10},spacing:.3,balls:[b],positions:new Float32Array(),velocities:new Float32Array(),chem:new Float32Array(),neighborCounts:new Uint16Array(),count:0,particleBudget:100,waterAt:()=>({density:0}),solid:p=>Math.min(p[1]+1,bodyDistance(p,b))};const rain=new LabRain(lab);return {lab,rain,b,d:rain.surfaceDrops};}
const hit=point=>({point,normal:point.map(v=>v/.5),particle:-1});
test('player hits never create condensation or wet the sand underneath the player',()=>{
 const {lab,rain,d}=rainFixture();lab.player={};lab.playerDistance=()=>0;let soaked=0;d.absorb=()=>{soaked++;return .001;};
 rain.impact({volume:.001,velocity:[0,-1,0]},hit([0,.5,0]));d.step(.1);
 assert.equal(d.patches.size,0);assert.equal(d.beads().length,0);assert.equal(soaked,0);near(rain.depositVolume,.001);
});
test('partial immersion removes only wet beads; final removal invalidates rendering and never resurrects',()=>{
 const {lab,rain,b,d}=rainFixture();d.impact({volume:.001},hit([0,.5,0]));d.step(.1);d.impact({volume:.001},hit([.15,Math.sqrt(.25-.15**2),0]));d.step(.1);assert.equal(d.beads().length,2);
 lab.waterAt=p=>({density:p[1]<.59?1:0});d.step(.1);assert.equal(d.beads().length,1);near(d.volume,.001);near(rain.depositVolume,.002);
 const revision=d.revision;b.position[1]-=.3;d.step(.001);assert.equal(d.beads().length,0);assert.equal(d.patches.size,0);assert.ok(d.revision>revision);near(rain.depositVolume,.002);
 b.position[1]+=1;d.step(.1);assert.equal(d.beads().length,0);
});
test('immersion also merges an attached growing drop, conserving its reserved mass',()=>{
 const {lab,rain,b,d}=rainFixture(),volume=lab.spacing**3*1.5;d.impact({volume},hit([0,.5,0]));d.step(.1);assert.equal(d.births.length,1);
 b.position[1]-=1;lab.waterAt=()=>({density:1});d.step(.01);assert.equal(d.births.length,0);assert.equal(d.fieldItems().length,0);assert.equal(d.beads().length,0);near(rain.depositVolume,volume);
});
test('water drag monotonically removes kinetic energy for glass spheres and cups at any tested step',()=>{
 for(const shape of ['sphere','cup'])for(const radius of [.002,.3,1.2])for(const dt of [1/240,1/15,.5]){
  const b=makeBody('glass',shape,radius,[0,0,0],[.3,-.5,.1]);b.pitch=.7;b.tilt=.4;b.omega=[6,-3,4];let previous=energy(b);
  for(let i=0;i<40;i++){applyBodyWaterDrag(b,samples(b,()=>[0,0,0],p=>p[1]<=0?1:.1),dt);const next=energy(b);assert.ok(next<=previous*(1+1e-10),`${shape} ${radius} ${dt}`);assert.ok([...b.velocity,...b.omega].every(Number.isFinite));previous=next;}
 }
});
test('floating glass spin decays without freezing legitimate current-driven torque',()=>{
 for(const shape of ['sphere','cup']){
  const b=makeBody('glass',shape,.3,[0,0,0]);b.omega=[0,0,8];for(let i=0;i<300;i++)applyBodyWaterDrag(b,samples(b,()=>[0,0,0],()=>.3),1/60);
  assert.ok(Math.hypot(...b.omega)<.02,JSON.stringify(b.omega));
  const flow=makeBody('glass',shape,.3,[0,0,0]);for(let i=0;i<120;i++)applyBodyWaterDrag(flow,samples(flow,p=>[-p[1]*2,p[0]*2,0]),1/60);assert.ok(flow.omega[2]>.5);
  const drifting=makeBody('glass',shape,.3,[0,0,0],[1,2,3]);applyBodyWaterDrag(drifting,samples(drifting,()=>[1,2,3]),.2);drifting.velocity.forEach((v,k)=>near(v,k+1));assert.ok(Math.hypot(...drifting.omega)<1e-12);
 }
});
test('three embedded beach boulders are opt-in, fixed, and begin free of overlapping water',()=>{
 const mock={extensions:{has:()=>false}},original=new SandLab(mock),lab=new SandLab(mock,{boulders:true});assert.equal(original.balls.length,0);assert.equal(lab.balls.length,3);
 for(const b of lab.balls){assert.equal(b.fixed,true);assert.ok(b.radius>=.5);const ground=lab.sand.height(b.position[0],b.position[2]);assert.ok(b.position[1]-b.radius<ground&&b.position[1]+b.radius>ground);
  const before=structuredClone(b);bodyImpulse(b,b.position.map((v,k)=>v+(k===0?1:0)),[0,100,0]);integrateOrientation(b,1);resolveBodyTerrain(b,()=>-1,.1);assert.deepEqual(b,before);
  for(let i=0;i<lab.count;i++)assert.ok(bodyDistance(Array.from(lab.positions.subarray(i*4,i*4+3)),b)>=lab.spacing*.12-1e-6);
 }
 const positions=lab.balls.map(b=>b.position.slice());lab.stepBodies(1/15);assert.deepEqual(lab.balls.map(b=>b.position),positions);near(lab.initialVolume,lab.volume);
 lab.configure('ocean');assert.equal(lab.balls.length,3);
});
test('fixed rock collides with loose objects and the player without being pushed or grabbed',()=>{
 const rock=Object.assign(makeBody('rock','sphere',.7,[0,1,0]),{fixed:true}),ball=makeBody('glass','sphere',.2,[.8,1,0],[-1,0,0]),before=structuredClone(rock);
 resolveBodyPairs([rock,ball],1/60);assert.deepEqual(rock,before);assert.ok(ball.position[0]>.89);
 const walker={position:[.8,1,0],velocity:[-2,0,0],radius:.28,mass:100};playerBodyContact(walker,rock,[.8,1,0]);assert.deepEqual(rock,before);assert.ok(walker.position[0]>.97);
 const lab={tool:'grab-object',heldBody:null,objectPick:()=>rock};SandLab.prototype.interact.call(lab,[0,0,0],[1,0,0]);assert.equal(lab.heldBody,null);assert.equal(rock.held,false);
});
