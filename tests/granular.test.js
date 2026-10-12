import test from 'node:test';
import assert from 'node:assert/strict';
import { Granular,GRAIN_STEP } from '../src/granular.js';
import { World } from '../src/world.js';
import { Probe } from '../src/physics.js';
import { FluidRenderer } from '../src/fluid-renderer.js';
import { PerspectiveCamera,Vector2 } from 'three';

test('granular presets reset deterministically and keep three distinct materials',()=>{
 const g=new Granular(),p=g.positions.slice();assert.deepEqual(g.counts,[110,364,222]);g.disturb([0,0,0]);g.reset();assert.deepEqual(g.positions,p);
 assert.ok(g.radius[0]>g.radius[g.counts[0]]);
});

test('dry particles settle into finite piles while cohesive mud retains a narrower clump',()=>{
 const g=new Granular();g.enabled=true;const count=g.count;
 for(let i=0;i<180;i++)g.step(GRAIN_STEP);
 const spread=[0,0,0],height=[0,0,0];
 for(let i=0;i<g.count;i++){const o=i*3,k=g.kind[i];assert.ok(Number.isFinite(g.positions[o]));assert.ok(g.positions[o+1]>=g.radius[i]-.0001);spread[k]+=Math.hypot(g.positions[o]-(k-1)*3,g.positions[o+2]);height[k]=Math.max(height[k],g.positions[o+1]);}
 assert.equal(g.count,count);for(let k=0;k<3;k++)spread[k]/=g.counts[k];
 assert.ok(spread[2]<spread[1]*.85);assert.ok(height[2]>height[1]);
});

test('physical probe exchanges contact impulses with the gravel pile',()=>{
 const g=new Granular(),world=new World();g.enabled=true;world.terrainEnabled=true;world.showcaseEnabled=false;world.terrain=g.terrain;
 const probe=new Probe(world);probe.setMass(40);probe.dropAt([-3,1,0]);let contacts=0;
 for(let i=0;i<70;i++){probe.step(GRAIN_STEP/2);probe.step(GRAIN_STEP/2);g.step(GRAIN_STEP,probe);contacts+=g.contacts;}
 assert.ok(contacts>0);assert.ok(probe.position.toArray().every(Number.isFinite));assert.ok(probe.position.y>0);
});

test('granular render LOD keeps materials separate and never changes parcel state',()=>{
 const g=new Granular();g.enabled=true;const saved=g.positions.slice(),renderer=new FluidRenderer({uResolution:{value:new Vector2(500,500)}},{granular:true}),camera=new PerspectiveCamera(50,1,.1,220),probe=new Probe(new World());
 camera.position.set(7,6,9);camera.lookAt(0,0,0);camera.updateMatrixWorld();renderer.prepare(g,camera,probe,100);
 const kinds=new Set();for(let i=0;i<renderer.count;i++)kinds.add(renderer.arrays[4][i*4+1]);assert.deepEqual([...kinds].sort(),[0,1,2]);assert.ok(renderer.count<g.count);assert.deepEqual(g.positions,saved);renderer.dispose();
});
