import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {Wetland,disturbPond,REED_TILE} from '../src/asset-studio/wetland.js';
import {exampleWorlds} from '../src/asset-studio/example-worlds.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';

const garden=exampleWorlds.find(t=>t.id==='wetland');

test('the same survey regenerates hills, open water and shoreline colonies in any travel order',()=>{
 for(const seed of [0,2187,0xffffffff]){
  const land=new Wetland(seed),revisit=new Wetland(seed),all=[];
  let flooded=0,highest=-Infinity,lowest=Infinity,samples=0;
  for(let x=-160;x<=160;x+=4)for(let z=-160;z<=160;z+=4){
   const h=land.height(x,z);flooded+=h<0;samples++;
   highest=Math.max(highest,h);lowest=Math.min(lowest,h);
   if(h>.85||h<-.68)assert.equal(land.suitability(x,z),0);
  }
  assert.ok(flooded/samples>.12&&flooded/samples<.68&&highest>3&&lowest<-1.3);
  const tiles=[[0,0],[-1,0],[0,-1],[1,0],[86,-127],[-71,179]];
  const first=tiles.map(([x,z])=>land.crowns(x,z));
  for(let i=tiles.length-1;i>=0;i--)assert.deepEqual(revisit.crowns(...tiles[i]),first[i]);
  for(const tile of first)for(const p of tile){
   assert.equal(p.y,land.height(p.x,p.z));assert.ok(p.y>=-.59&&p.y<=.70);
   all.push(p.x+','+p.z);
  }
  assert.ok(all.length>20);assert.equal(new Set(all).size,all.length);
  // Sample neighbouring cells from different sides of the tile seam.
  for(let i=-6;i<7;i++)assert.ok(Math.abs(land.height(i*REED_TILE-.001,-8)-land.height(i*REED_TILE+.001,-8))<.01);
  for(const i of garden.create(null,seed).world.instances){
   const [x,y,z]=i.transform.position;assert.equal(y,land.height(x,z));
  }
 }
});

test('pond water floats a light body, covers the actual bed, and takes released water back',async()=>{
 const library=garden.create(),land=new Wetland(library.world.wetlandSeed);
 let point=new Vector3(),deepest=Infinity;
 for(let x=-96;x<=96;x+=2)for(let z=-96;z<=96;z+=2){
  const h=land.height(x,z);if(h<deepest){deepest=h;point.set(x,0,z);}
 }
 assert.ok(deepest<-.7);
 library.world.wind.speed=0;
 library.world.instances=[['pumice',0],['china-ball',1]].map(([id,dx])=>({id,assetId:'example-'+id,
  transform:{position:[point.x+dx,.5,point.z],rotation:[0,0,0],scale:[1,1,1]}}));
 const sim=await StudioPhysics.create(library,'world');
 try{
  const water=library.materials.find(m=>m.id==='water'),surface=sim.matter.liquidColumn(sim,point.x,point.z);
  assert.ok(Math.abs(surface.top)<1e-9&&surface.bottom<-.6);assert.equal(surface.density,water.density);
  assert.ok(disturbPond(sim,point.clone().add(new Vector3(-1.3,0,0)),water));assert.equal(sim.heldDeposit.packets.length,9);
  sim.heldDeposit.grip.target.y=.7;
  for(let i=0;i<100;i++)sim.step();
  assert.ok(sim.heldDeposit.packets.every(p=>p.position.y>.55));
  sim.heldDeposit.grip.releaseAt=sim.time;
  for(let i=0;i<500;i++)sim.step();
  assert.equal(sim.matter.count,0);
  const float=sim.get('pumice','body'),heavy=sim.get('china-ball','body');
  assert.ok(float.wetFraction>.05&&float.wetFraction<.95);
  assert.ok(Math.abs(float.body.translation().y)<.35);
  const bottom=heavy.body.translation(),gap=bottom.y-sim.matter.groundHeight(sim,bottom.x,bottom.z);
  assert.ok(gap>.12&&gap<.40,'Rigid contact with the submerged bed, gap '+gap);
 }finally{sim.dispose();}
});
