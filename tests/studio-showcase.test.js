import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {newStudioLibrary,validateLibrary,STORAGE_KEY} from '../src/asset-studio/model.js';
import {LibraryStore} from '../src/asset-studio/storage.js';
import {installCatalog} from '../src/asset-studio/example-catalog.js';
import {exampleWorlds} from '../src/asset-studio/example-worlds.js';
import {supportedMark} from '../src/asset-studio/gaussian-marks.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {CombustionPlume,PLUME_LIMIT} from '../src/asset-studio/combustion-plume.js';
import {charDomains,roundCharChip} from '../src/asset-studio/char-fracture.js';

test('the real library upgrades existing saves without replacing edits, placing samples or restoring deleted examples',async()=>{
 const saved=newStudioLibrary(),before=structuredClone(saved);
 saved.assets[0].name='My sculpture';
 const values=new Map([[STORAGE_KEY,JSON.stringify(saved)]]);
 const store=new LibraryStore({getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},async()=>({ok:false}));
 const {library}=await store.load();validateLibrary(library);
 assert.deepEqual(library.world,before.world);assert.equal(library.assets[0].name,'My sculpture');
 assert.equal(library.families.length,4);
 const id='example-china-ball';assert.ok(library.assets.some(a=>a.id===id));
 library.assets=library.assets.filter(a=>a.id!==id);
 library.assets.find(a=>a.id==='example-wax').name='My wax mould';
 await store.save(library);
 assert.deepEqual((await store.load()).library,library);
 const disk=new LibraryStore({getItem:()=>null},async()=>({ok:true,headers:{get:()=>'application/json'},json:async()=>({library:structuredClone(before)})}));
 assert.equal((await disk.load()).library.exampleCatalogVersion,1);
});

test('every catalog asset is placed in a fresh example and every ribbon has a real paintable mount',()=>{
 const l=installCatalog(newStudioLibrary()),catalog=l.assets.slice(1).map(a=>a.id);
 const placed=new Set();
 for(const example of exampleWorlds){
  const w=example.create();validateLibrary(w);
  for(const i of w.world.instances)placed.add(i.assetId);
 }
 assert.deepEqual(new Set(catalog),placed);
 const palette=new Map(l.materials.map(m=>[m.id,m]));
 for(const a of l.assets)for(const p of a.parts)for(const mark of p.marks??[])assert.ok(supportedMark(p,mark,palette),a.name);
 for(const f of l.families)assert.ok(f.members.length>=2&&f.members.every(m=>placed.has(m.assetId)));
});

function makeTrail(heading,count=1,multiplier=1){
 const plume=new CombustionPlume(33),wind={speed:6,heading};
 const nodes=Array.from({length:count},()=>({position:new Vector3(.21,0,-.08),radius:.3/Math.sqrt(count),
  burning:.012*multiplier/count,material:{fuelEnergy:1.6e7,smokeYield:.09}}));
 plume.setSources(nodes);
 for(let i=0;i<480;i++)plume.step(1/120,wind);
 return plume;
}
test('flame and smoke advect independently of the camera; dividing fuel among fragments cannot multiply emissions',()=>{
 const east=makeTrail(0),west=makeTrail(180),split=makeTrail(0,64);
 for(const kind of [0,1]){
  const select=p=>p.particles.filter(t=>t.kind===kind);
  const meanX=p=>select(p).reduce((sum,t)=>sum+t.x,0)/select(p).length;
  assert.equal(select(split).length,select(east).length);assert.ok(select(east).length>6);
  assert.ok(meanX(east)>.21+.13&&meanX(west)<.21-.13);
  assert.ok(select(east).some(t=>Math.hypot(t.x-t.tail[0],t.z-t.tail[2])>.035));
 }
 assert.ok(makeTrail(35,120,200).particles.length<=PLUME_LIMIT);
 east.setSources([]);
 for(let i=0;i<100;i++)east.step(1/120,{speed:6,heading:90});
 assert.ok(east.particles.length&&east.particles.every(p=>p.kind===1));
 for(let i=0;i<600;i++)east.step(1/120,{speed:6,heading:90});
 assert.equal(east.particles.length,0);
});

async function play(id,steps,check){
 const test=exampleWorlds.find(t=>t.id===id),l=test.create(),sim=await StudioPhysics.create(l,'world');
 try{
  test.start?.(sim);for(let i=0;i<steps;i++)sim.step();
  assert.deepEqual(sim.skipped,[]);
  assert.ok([...sim.bodies.values()].every(r=>Number.isFinite(r.body.translation().y)));
  await check(sim);
 }finally{sim.dispose();}
}

test('a heated cantilever sheds connected charred pieces while the identical cold span carries its weight',async()=>{
 await play('char',720,sim=>{
  const [hot,cold]=sim.structures;
  assert.equal(cold.bodies.size,1);assert.ok(hot.bodies.size>1);
  assert.ok(hot.grid.bonds.some(e=>e.broken&&e.char>.10));
  assert.ok([...hot.bodies].some(r=>r!==hot.root&&r.regions.length>1));
  assert.equal([...hot.bodies].reduce((n,r)=>n+r.regions.length,0),hot.grid.nodes.length);
  const ids=charDomains(hot.grid);
  for(const domain of new Set(ids)){
   const members=hot.indices.filter(i=>ids[i]===domain),seen=new Set([members[0]]);
   for(const i of seen)for(const e of hot.grid.bonds){
    const j=e.a===i?e.b:e.b===i?e.a:-1;if(ids[j]===domain)seen.add(j);
   }
   assert.equal(seen.size,members.length);
  }
  const grid={nodes:[{shapes:[{center:[0,0,0],half:[1,1,1]}]}]},skin={positions:[1,0,0,1,1,1],normals:[1,0,0,0,1,0]};
  roundCharChip(skin,grid,[0],.8);assert.equal(skin.positions[0],1);assert.ok(skin.positions[3]<.8);
  assert.ok(skin.normals[3]>0&&skin.normals[5]>0);
 });
});

test('the crosswind scene emits from burning material and leaves the damp control unlit',async()=>{
 await play('fire',240,sim=>{
  const w=sim.materialWorld;
  assert.ok(w.plume.particles.some(p=>p.kind===0)&&w.plume.particles.some(p=>p.kind===1));
  assert.ok(w.nodes.some(s=>s.burning>0));
  assert.ok(sim.get('damp','body').field.sites.every(s=>s.burning===0));
 });
});
test('the circuit runs through the separate graphite bridge and opens when it moves',async()=>{
 await play('current',90,sim=>{
  const bridge=sim.get('bridge','body'),w=sim.materialWorld;
  assert.ok(bridge.field.sites.reduce((n,s)=>n+s.watts,0)>.01);
  bridge.body.setTranslation({x:0,y:3,z:0},true);
  for(let i=0;i<20;i++)sim.step();
  assert.ok(w.edges.every(e=>e.a.record===e.b.record||(e.a.record!==bridge&&e.b.record!==bridge)));
 });
});

test('the melting, humidity, vegetation, suspension, water and loose-ground fixtures run through their real solvers',async()=>{
 await play('thaw',120,sim=>{
  const lens=sim.get('ice','body').field.sites[0];
  assert.ok(lens.core.melt>0&&lens.core.melt<1);
  assert.ok(Math.abs(lens.core.t-lens.material.meltingPoint)<1e-5);
  for(let i=0;i<420;i++)sim.step();
  assert.ok(sim.matter.meltedMass>0&&!sim.get('ice','body')&&!sim.get('wax','body'));
 });
 await play('dew',120,sim=>assert.ok(sim.get('contact','body').field.sites.some(s=>s.water>0)));
 await play('wetland',60,sim=>{assert.equal(sim.paintedHinges.parts.size,6);assert.equal(sim.bodies.size,6);});
 await play('load',180,sim=>assert.deepEqual(new Set(sim.joints.map(l=>l.j.type)),new Set(['hinge','ball','spring','fixed'])));
 await play('tidepool',35,sim=>assert.ok(sim.sea&&sim.sea.organicLoad>0));
 await play('runoff',90,sim=>assert.ok(sim.matter.beds.has('brine')&&sim.matter.beds.has('oil')));
 await play('deposition',150,sim=>assert.ok(sim.sandTerrain&&sim.matter.parts.size));
});
