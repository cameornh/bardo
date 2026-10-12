import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { World } from '../src/world.js';
import { sampleSurface } from '../src/sampling.js';
import { Probe, FixedStepper } from '../src/physics.js';

test('analytic fields have signed interiors, accurate sphere distances, and unit normals',()=>{
 const world=new World();
 // Keep the GPU's conservative static-group rejection valid when moving or
 // resizing a laboratory object; the dynamic probe is intentionally excluded.
 for(const o of world.objects.slice(0,5))assert.ok(Math.hypot(o.center[0],o.center[1]-1,o.center[2]-1)+o.bound<5.5);
 assert.equal(world.localDistance(2,0,0,0),-.98);
 assert.ok(Math.abs(world.localDistance(2,0,.98,0))<1e-10);
 assert.equal(world.localDistance(2,0,1.98,0),1);
 assert.ok(world.localDistance(1,0,0,0)>0,'torus center must remain hollow');
 assert.ok(world.localDistance(1,.85,0,0)<0);
 for(const p of [[.6,.5,.5],[1,.3,.2],[-.5,.8,.4]])assert.ok(Math.abs(Math.hypot(...world.normal(0,p,true))-1)<1e-8);
});

test('carving changes authoritative geometry, ray hits, and generated samples; undo restores it',()=>{
 const world=new World(),origin=[-3,1.03,5],direction=[0,0,-1];
 const before=world.raycast(origin,direction,0);assert.ok(before);
 assert.equal(world.carve(before.point,.4),true);
 assert.ok(world.distanceTo(0,before.point)>.39,'cut center must become empty');
 const after=world.raycast(origin,direction,0);assert.ok(after.distance>before.distance+.2);
 const samples=sampleSurface(world,0,.15);
 for(let i=0;i<samples.count;i++){
   const p=samples.centers.subarray(i*3,i*3+3);
   assert.ok(Math.abs(world.localDistance(0,...p))<.025,'samples stay on the edited field');
 }
 assert.ok(world.undo());assert.ok(Math.abs(world.raycast(origin,direction,0).distance-before.distance)<1e-6);
});

test('surface sampling is deterministic and finer levels increase surface coverage',()=>{
 const world=new World();const coarse=sampleSurface(world,2,.20),fine=sampleSurface(world,2,.11),repeat=sampleSurface(world,2,.20);
 assert.deepEqual(coarse.centers,repeat.centers);assert.ok(fine.count>coarse.count*2);
 for(let i=0;i<fine.count;i++){
  assert.ok(Math.abs(Math.hypot(...fine.centers.subarray(i*3,i*3+3))-.98)<.003);
  assert.ok(Math.abs(Math.hypot(...fine.normals.subarray(i*3,i*3+3))-1)<1e-6);
 }
});

test('free-flight gravity preserves spin angular momentum and follows expected acceleration',()=>{
 const world=new World(),probe=new Probe(world);probe.position.set(0,20,0);probe.active=true;probe.angularVelocity.set(1,2,3);
 const spin=probe.angularVelocity.clone();for(let i=0;i<60;i++)probe.step(1/120);
 assert.ok(Math.abs(probe.velocity.y+4.905)<1e-8);assert.ok(probe.angularVelocity.distanceTo(spin)<1e-10);
 assert.ok(Math.abs(probe.rotation.length()-1)<1e-8);
});

test('off-center impulses generate the expected torque',()=>{
 const probe=new Probe(new World());const f=new Vector3(0,0,2),r=new Vector3(.43,0,0);probe.impulse(f,r);
 assert.ok(Math.abs(probe.angularVelocity.y-(-.86*probe.inverseInertia))<1e-10);assert.equal(probe.velocity.z,2);
});

test('ground contact prevents penetration and friction transfers sliding into rolling',()=>{
 const probe=new Probe(new World());probe.position.set(7,2,0);probe.velocity.set(2,0,0);probe.active=true;
 let minY=Infinity;for(let i=0;i<700;i++){probe.step(1/120);minY=Math.min(minY,probe.position.y);}
 assert.ok(minY>=probe.radius-1e-5);assert.ok(probe.contacts>0);assert.ok(Math.abs(probe.angularVelocity.z)>.1);
 assert.ok(probe.velocity.length()<2.1,'inelastic contacts should not inject energy');
});

test('fixed stepping gives identical outcomes across display refresh rates',()=>{
 function run(fps){const probe=new Probe(new World());probe.drop();const s=new FixedStepper();for(let i=0;i<fps*2;i++)s.advance(1/fps,dt=>probe.step(dt));return probe;}
 const a=run(30),b=run(120);assert.ok(a.position.distanceTo(b.position)<1e-6);assert.ok(a.velocity.distanceTo(b.velocity)<1e-6);
});

test('long stalls are bounded and discarded simulation time is reported',()=>{
 const stepper=new FixedStepper();let calls=0;stepper.advance(2,()=>calls++);assert.equal(calls,12);assert.ok(stepper.droppedTime>1.8);assert.ok(stepper.accumulator<stepper.step);
});
