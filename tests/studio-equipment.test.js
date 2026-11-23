import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3} from 'three';
import {seedLibrary,validateLibrary} from '../src/asset-studio/model.js';
import {field} from '../src/asset-studio/sculpt.js';
import {installEquipment,opticsBench,placementPose} from '../src/asset-studio/studio-equipment.js';
import {StudioWalk} from '../src/asset-studio/walk.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {liftGround,releaseChunk,moveChunk} from '../src/asset-studio/ground-interaction.js';
import {grabBodies,dropBodies} from '../src/asset-studio/sphere-grip.js';
import {WindSea} from '../src/asset-studio/ocean.js';
const near=(a,b,t)=>assert.ok(Math.abs(a-b)<t,`${a} vs ${b}`);
const step=(s,n)=>{for(let i=0;i<n;i++)s.step();};

test('catalog upgrades preserve saved edits and round-trip all twelve solids',()=>{
 const lib=opticsBench();assert.equal(lib.world.instances.length,12);
 for(const style of ['optical-glass','silver-mirror','stone','lamp-ceramic']){
  const distance=(shape,x,y,z)=>field([x,y,z],lib.assets.find(a=>a.id==='equipment-'+style+'-'+shape).parts[0].stamps)[0];
  assert.ok(distance('cup',0,.55,0)>0&&distance('cup',.42,.45,0)<0&&distance('cup',0,.075,0)<0);
  assert.ok(distance('ball',0,.45,0)<0);
  if(['optical-glass','silver-mirror'].includes(style)){
   assert.ok(distance('convex',0,.54,.14)<0&&distance('convex',.43,.54,.14)>0);
   assert.ok(distance('concave',0,.54,.09)>0&&distance('concave',.4,.54,.09)<0);
  }
 }
 lib.assets.at(-1).name='My glazed lamp';const saved=JSON.parse(JSON.stringify(lib));
 validateLibrary(saved);installEquipment(saved);assert.deepEqual(saved,lib);
 assert.deepEqual(placementPose([1,2,3],{twist:5,size:.5},2,[3,2,1],[20,30,40],3),{position:[4,4,4],rotation:[20,35,40],scale:[3,3,3]});
});
test('upgrade adds six editable saturated lamp materials and distinct sculpts exactly once',()=>{
 const lib=opticsBench();lib.materials=lib.materials.filter(m=>!/^lamp-(cyan|magenta|yellow|red|green|blue)$/.test(m.id));lib.assets=lib.assets.filter(a=>!a.id.startsWith('luminaire-'));
 lib.studioEquipmentVersion=1;lib.assets=lib.assets.filter(a=>a.id!=='equipment-stone-cup');lib.world.instances=lib.world.instances.filter(i=>i.assetId!=='equipment-stone-cup');lib.assets[0].name='Saved sculpt';
 const before=[lib.materials.length,lib.assets.length];installEquipment(lib);installEquipment(lib);validateLibrary(lib);
 assert.deepEqual([lib.materials.length,lib.assets.length],before.map(n=>n+6));assert.equal(lib.assets[0].name,'Saved sculpt');
 const silhouettes=new Set();
 for(const color of ['cyan','magenta','yellow','red','green','blue']){
  const m=lib.materials.find(m=>m.id==='lamp-'+color),p=lib.assets.find(a=>a.id==='luminaire-'+color).parts[0];
  assert.ok(m.emission>0&&p.stamps.every(s=>s.materialId===m.id));
  let silhouette='';for(let x=-.5;x<.5;x+=.05)for(let y=0;y<1.2;y+=.05)silhouette+=Number(field([x,y,0],p.stamps)[0]<0);
  assert.ok(silhouette.includes('1'));silhouettes.add(silhouette);
 }
 assert.equal(silhouettes.size,6);
});
test('a walking camera jumps, floats above a moving waterline and restores its orbit',()=>{
 const camera=new PerspectiveCamera(),target=new Vector3(1,0,2);camera.position.set(2,8,4);camera.lookAt(target);
 const view={camera,controls:{target,update(){}},sand:{height:()=>0}};
 const walk=new StudioWalk(view);walk.enter();const eye=camera.position.y,keys=new Set(['Space','KeyW']);
 for(let i=0;i<30;i++)walk.step(1/60,keys);
 assert.ok(camera.position.y>eye+.8&&camera.position.z<4);
 keys.clear();for(let i=0;i<120;i++)walk.step(1/60,keys);near(camera.position.y,eye,.001);
 view.sea={height:()=>4};keys.add('Space');for(let i=0;i<180;i++)walk.step(1/60,keys);
 near(camera.position.y,4.28,.02);walk.exit();assert.deepEqual(camera.position.toArray(),[2,8,4]);assert.deepEqual(target.toArray(),[1,0,2]);
});
test('the radius controls lifted water volume and airborne drops can be re-grabbed',()=>{
 const s=new WindSea();s.lift(0,0,.2);const measure=()=>s.held.reduce((v,{drop})=>v+drop.r**3,0),small=measure();
 s.reset();s.lift(0,0,.4);near(measure()/small,8,.001);
 s.moveLift({x:2,y:2,z:2});s.release();const before=s.drops.length;
 assert.ok(s.grabDrops(new Vector3(2,2,2),.8));assert.equal(s.held.length,before);assert.equal(s.drops.length,before);
 s.release();assert.ok(s.drops.every(d=>!d.held));
});
test('spherical dry scoops conserve terrain volume and disperse, wet scoops attach and can be subdivided',async()=>{
 for(const wet of [0,1]){
  const lib=seedLibrary();lib.world.instances=[];lib.world.groundMaterialId='sand';lib.world.wind={speed:0,heading:0};
  lib.materials.find(m=>m.id==='sand').moisture=wet;const sim=await StudioPhysics.create(lib,'world','arch');
  try{
   const p=new Vector3(2,sim.sandTerrain.height(2,2),2);assert.ok(liftGround(sim,p,.45));
   const chunk=sim.heldChunk,group=sim.heldDeposit;
   const volume=wet?group.packets.reduce((v,p)=>v+p.volume,0):chunk.cut.volume;
   const mass=wet?group.packets.reduce((v,p)=>v+p.body.mass(),0):chunk.body.mass();
   near(mass,volume*sim.groundMaterial.density,.02);
   const target=new Vector3(0,1.6,0);moveChunk(sim,target);step(sim,100);releaseChunk(sim);
   if(!wet){const packets=[...sim.matter.parts.values()][0].packets;near(packets.reduce((v,p)=>v+p.volume,0),volume,1e-6);continue;}
   const distances=group.packets.slice(1).map(p=>p.position.distanceTo(group.packets[0].position));
   step(sim,220);assert.ok(sim.matter.capillary.links.size>0);
   assert.ok(group.packets.slice(1).some((p,i)=>Math.abs(p.position.distanceTo(group.packets[0].position)-distances[i])>.008),'impact changes internal distances');
   const edge=group.packets.reduce((a,b)=>a.position.x>b.position.x?a:b);
   assert.ok(grabBodies(sim,edge.position.clone(),.04));
   const held=sim.sphereGrip.packets.reduce((v,p)=>v+p.volume,0);assert.ok(held>0&&held<volume*.6);
   near(group.packets.reduce((v,p)=>v+p.volume,0),volume,1e-6);
   dropBodies(sim);step(sim,4);
  }finally{sim.dispose();}
 }
});


test('all cups stay connected on startup and a sphere removes only intersecting fragments',async()=>{
 const lib=opticsBench(),sim=await StudioPhysics.create(lib,'world',lib.assets[0].id);
 try{
  assert.equal(sim.bodies.size,12);
  const r=[...sim.bodies.values()].find(r=>r.asset.id==='equipment-stone-ball');
  const center=new Vector3().copy(r.body.worldCom());center.x+=.32;
  const mass=r.body.mass(),structure=r.structure;
  assert.ok(grabBodies(sim,center,.19));const carried=sim.sphereGrip.items.reduce((v,i)=>v+i.body.mass(),0);
  assert.ok(carried>0&&carried<mass*.65);
  near([...structure.bodies].reduce((v,r)=>v+r.body.mass(),0),mass,.01);
  assert.ok(sim.structures.filter(s=>s!==structure).every(s=>s.bodies.size===1));dropBodies(sim);
 }finally{sim.dispose();}
});

test('a second wet handful settles onto the first and stays joined above the ground',async()=>{
 const lib=seedLibrary();lib.world.instances=[];lib.world.groundMaterialId='sand';lib.world.wind={speed:0,heading:0};
 lib.materials.find(m=>m.id==='sand').moisture=1;
 const sim=await StudioPhysics.create(lib,'world','arch');
 try{
  function place(x,radius,target){
   const at=new Vector3(x,sim.sandTerrain.height(x,2),2);
   assert.ok(liftGround(sim,at,radius));const group=sim.heldDeposit;
   moveChunk(sim,target);step(sim,100);releaseChunk(sim);step(sim,220);
   return group;
  }
  const center=g=>g.packets.reduce((c,p)=>c.add(p.position),new Vector3()).divideScalar(g.packets.length);
  const base=place(2,.55,new Vector3(0,1.2,0));
  const target=center(base);target.y=Math.max(...base.packets.map(p=>p.position.y+p.radius))+.35;
  const top=place(3,.28,target);
  assert.ok([...sim.matter.capillary.links.values()].some(({a,b})=>a.group!==b.group),'handfuls join across the original boundary');
  assert.ok(sim.matter.capillary.islands.some(g=>g.packets.some(p=>p.group===base)&&g.packets.some(p=>p.group===top)));
  assert.ok(center(top).y>center(base).y+.08);
 }finally{sim.dispose();}
});
