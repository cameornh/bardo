import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {Wetland,REED_TILE} from '../src/asset-studio/wetland.js';
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
  const sea=sim.pondSea,grab=point.clone().add(new Vector3(-1.3,0,0));
  sea.lift(grab.x,grab.z);assert.ok(sea.held.length>1);
  const scoop=sea.held[0].drop.scoop;assert.ok(scoop.volume>0);
  grab.y=.7;sea.moveLift(grab);
  for(let i=0;i<100;i++)sim.step();
  assert.ok(sea.held.every(p=>p.drop.y>.45));
  sea.release();
  for(let i=0;i<500;i++)sim.step();
  assert.equal(sim.matter.count,0);assert.ok(scoop.volume<1e-8);
  const float=sim.get('pumice','body'),heavy=sim.get('china-ball','body');
  assert.ok(float.wetFraction>.05&&float.wetFraction<.95);
  assert.ok(Math.abs(float.body.translation().y)<.35);
  const bottom=heavy.body.translation(),gap=bottom.y-sim.matter.groundHeight(sim,bottom.x,bottom.z);
  assert.ok(gap>.12&&gap<.40,'Rigid contact with the submerged bed, gap '+gap);
 }finally{sim.dispose();}
});

test('a falling body activates remote reeds with bendable stems and grabbable blades without a camera',async()=>{
 const library=garden.create(null,2187),land=new Wetland(2187);
 let site;
 for(let x=8;x<18&&!site;x++)site=land.crowns(x,4).find(c=>c.y>.15);
 assert.ok(site);
 library.world.wind.speed=0;
 library.world.instances=[{id:'weight',assetId:'example-china-ball',
  transform:{position:[site.x,site.y+2,site.z],rotation:[0,0,0],scale:[1,1,1]}}];
 const sim=await StudioPhysics.create(library,'world');
 try{
  assert.equal(sim.stand.records.size,0);
  sim.step();
  const clump=sim.stand.active.get(site.id);
  assert.ok(clump?.links.length>1);
  const tip=clump.records.find(r=>r.part.joint.parentId!=='ground'&&r.part.marks.length);
  assert.equal(sim.get(site.id,tip.part.id),tip);
  const point=new Vector3(0,2*tip.part.stamps[0].size[1],0);
  const start=point.clone().applyMatrix4(tip.matrix);
  const hinge=sim.paintedHinges.parts.get(tip.key).find(h=>h.mark.flex>0);
  const mark=hinge.mark,grab=new Vector3(...mark.root).addScaledVector(new Vector3(...mark.axis),.8*mark.length).applyMatrix4(tip.matrix);
  assert.equal(sim.paintedHinges.grab(tip.key,mark.id,grab),hinge);
  hinge.cursorForce.copy(new Vector3(...mark.up).transformDirection(tip.matrix)).multiplyScalar(1.5);
  sim.addPulse(tip.key,point,new Vector3(.9,0,0),.1);
  let contact=false;
  for(let i=0;i<135;i++){
   sim.step();
   for(const r of clump.records)sim.world.contactPairsWith(r.body.collider(0),other=>{
    if(other.parent()?.handle===sim.get('weight','body').body.handle)contact=true;
   });
  }
  const end=point.applyMatrix4(tip.matrix);
  assert.ok(end.distanceTo(start)>.003&&Number.isFinite(end.y));
  assert.ok(Math.abs(hinge.angle)>.004);
  assert.ok(contact,'the falling porcelain must actually contact a landscape stem');
  assert.ok(sim.stand.active.size<=12);
 }finally{sim.dispose();}
});

test('wind waves advance and recede across the same physical bank',async()=>{
 const library=garden.create(null,2187);
 library.world.wind={speed:14,heading:-25,turbulence:.8};library.world.instances=[];
 const sim=await StudioPhysics.create(library,'world');
 try{
  const sea=sim.pondSea,points=[];
  for(let x=-20;x<=20;x+=.5)for(let z=-20;z<=20;z+=.5){
   if(Math.abs(sea.bedHeight(x,z))<.035)points.push({x,z,wet:false,dry:false});
  }
  for(let i=0;i<=30;i++){
   sea.sampleTime(i*.2);
   for(const p of points){
    const col=sim.matter.liquidColumn(sim,p.x,p.z);
    if(!col){p.dry=true;continue;}
    p.wet=true;
    assert.ok(Math.abs(col.top-sea.height(p.x,p.z))<1e-8);
    assert.ok(Math.abs(col.bottom-sea.bedHeight(p.x,p.z))<1e-8);
   }
  }
  assert.ok(points.length>30&&points.filter(p=>p.wet&&p.dry).length>.5*points.length);
 }finally{sim.dispose();}
});
