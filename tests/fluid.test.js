import test from 'node:test';
import assert from 'node:assert/strict';
import { Fluid, createFluidTerrain, FLUID_STEP } from '../src/fluid.js';
import { World } from '../src/world.js';
import { Probe, FixedStepper } from '../src/physics.js';
import { FluidRenderer } from '../src/fluid-renderer.js';
import { PerspectiveCamera, Vector2 } from 'three';

const sample=(array,i)=>Array.from(array.subarray(i*3,i*3+3));
test('pool and dam presets are deterministic, bounded, and leave external terrain edits alone',()=>{
 const world=new World();world.terrain.edit([16,0,0],1);const saved=world.terrain.serialize();
 const f=new Fluid(createFluidTerrain()),initial=f.positions.slice(0,f.count*3);assert.ok(f.count>300&&f.count<400);
 for(let i=0;i<f.count;i++)assert.ok(f.terrain.distance(sample(f.positions,i))>=f.radius);
 f.disturb([0,-1,0]);f.reset();assert.deepEqual(f.positions.slice(0,f.count*3),initial);
 f.reset('dam');assert.ok(f.count>100);for(let i=0;i<f.count;i++)assert.ok(f.positions[i*3]<0);
 assert.equal(world.terrain.serialize(),saved);
});

test('pressure relaxation keeps a closed pool finite and contained without losing particle mass',()=>{
 const f=new Fluid(createFluidTerrain());const count=f.count,mass=f.initialMass;
 for(let i=0;i<90;i++)f.step(FLUID_STEP);
 assert.equal(f.count,count);assert.equal(f.mass*f.count,mass);assert.ok(f.maxCompression<.12);
 for(let i=0;i<f.count;i++){assert.ok(sample(f.positions,i).every(Number.isFinite));assert.ok(f.terrain.distance(sample(f.positions,i))>=f.radius-.015);assert.ok(Math.hypot(...sample(f.velocities,i))<8);}
});

test('dam collapse flows across the initial partition',()=>{
 const f=new Fluid(createFluidTerrain());f.reset('dam');const count=f.count;
 for(let i=0;i<75;i++)f.step(FLUID_STEP);
 let crossed=0;for(let i=0;i<f.count;i++)if(f.positions[i*3]>.25)crossed++;
 assert.ok(crossed>count*.15);assert.equal(f.count,count);
});

test('isolated ball contact transfers equal and opposite linear momentum',()=>{
 const terrain={distance:()=>100,normal:()=>[0,1,0]},f=new Fluid(terrain),probe=new Probe(new World());
 f.count=1;f.predicted.set([.3,1,0]);probe.position.set(0,1,0);probe.velocity.set(0,0,0);probe.setMass(180);probe.active=true;
 const before=f.predicted.slice(0,3);f.collide(probe,FLUID_STEP);
 for(let axis=0;axis<3;axis++)assert.ok(Math.abs(f.mass*(f.predicted[axis]-before[axis])/FLUID_STEP+probe.mass*probe.velocity.getComponent(axis))<.002);
 assert.ok(probe.velocity.x<0);assert.ok(f.contacts>0);
});

test('actual falling ball displaces water and receives fluid contact impulses',()=>{
 const world=new World();world.terrainEnabled=true;world.showcaseEnabled=false;world.terrain=createFluidTerrain();const f=new Fluid(world.terrain),probe=new Probe(world);
 probe.setMass(180);probe.dropAt([0,.8,0]);let contacts=0;
 for(let i=0;i<70;i++){for(let j=0;j<4;j++)probe.step(FLUID_STEP/4);f.step(FLUID_STEP,probe);contacts+=f.contacts;}
 assert.ok(contacts>10);assert.ok(probe.position.toArray().every(Number.isFinite));assert.ok(Math.abs(probe.velocity.y)<20);
 assert.ok(probe.position.y>-3);assert.ok(f.maxCompression<.3);
});

test('heat is advected and pair diffusion conserves total heat while lowering the maximum',()=>{
 const f=new Fluid(createFluidTerrain());assert.ok(f.disturb([0,-1.4,0],{heat:true})>0);
 const temperatures=()=>Array.from(f.temperature.subarray(0,f.count)),sum=a=>a.reduce((s,v)=>s+v,0),initial=temperatures();
 for(let i=0;i<30;i++)f.step(FLUID_STEP);
 const final=temperatures();assert.ok(Math.abs(sum(final)-sum(initial))<.01);assert.ok(Math.max(...final)<Math.max(...initial));assert.ok(Math.min(...final)>=19.999);
});

test('render coarsening does not modify water mass, positions, or temperature',()=>{
 const f=new Fluid(createFluidTerrain()),probe=new Probe(new World()),renderer=new FluidRenderer({uResolution:{value:new Vector2(500,500)}}),camera=new PerspectiveCamera(50,1,.1,220);
 camera.position.set(6,5,7);camera.lookAt(0,-1,0);camera.updateMatrixWorld();const positions=f.positions.slice(),temperatures=f.temperature.slice(),count=f.count;
 renderer.prepare(f,camera,probe,1);const fine=renderer.count;renderer.prepare(f,camera,probe,100);assert.ok(renderer.count<fine);assert.equal(f.count,count);assert.deepEqual(f.positions,positions);assert.deepEqual(f.temperature,temperatures);renderer.dispose();
});

test('fixed fluid stepping produces the same result at different display rates',()=>{
 const run=rate=>{const f=new Fluid(createFluidTerrain(),{spacing:.6}),stepper=new FixedStepper(FLUID_STEP,12);for(let i=0;i<rate;i++)stepper.advance(1/rate,dt=>f.step(dt));return f;};
 const a=run(30),b=run(120);assert.equal(a.steps,b.steps);assert.deepEqual(a.positions,b.positions);
});


test('water LOD blends preserve optical depth for an isolated Gaussian',()=>{
 const f=new Fluid(createFluidTerrain()),probe=new Probe(new World()),renderer=new FluidRenderer({uResolution:{value:new Vector2(500,500)}}),camera=new PerspectiveCamera(50,1,.1,220);
 f.count=1;f.positions.set([0,-1,0]);camera.position.set(6,5,7);camera.lookAt(0,-1,0);camera.updateMatrixWorld();
 const projected=f.spacing*.65*250*camera.projectionMatrix.elements[5]/camera.position.length();
 for(const level of [.25,.5,.75,1,1.5,2.99]){
  renderer.prepare(f,camera,probe,projected*2**level/2);
  let opticalDepth=0;for(let i=0;i<renderer.count;i++)opticalDepth+=renderer.arrays[0][i*4+3];
  assert.ok(Math.abs(opticalDepth-.22)<1e-6);
  assert.ok(renderer.count<3);
 }
 renderer.dispose();
});

test('foam responds to relative surface motion and decays without continued agitation',()=>{
 const terrain={distance:()=>100,normal:()=>[0,1,0]},f=new Fluid(terrain);f.count=2;f.positions.set([-.2,0,0,.2,0,0]);f.velocities.set([-1,0,0,1,0,0]);f.foam.fill(0);
 f.step(FLUID_STEP,null,0);assert.ok(f.foam[0]>0);assert.ok(f.foam[1]>0);
 f.count=1;f.foam[0]=1;f.velocities.fill(0);for(let i=0;i<30;i++)f.step(FLUID_STEP,null,0);assert.ok(f.foam[0]<.6);assert.ok(f.foam[0]>0);
});
