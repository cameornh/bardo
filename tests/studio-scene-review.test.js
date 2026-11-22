import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {studioTests} from '../src/asset-studio/workbenches.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {fractureGrid} from '../src/asset-studio/fracture-grid.js';
import {cellOwner,fractureCells} from '../src/asset-studio/fracture-cells.js';
import {seedLibrary,stamp,transform,validateLibrary} from '../src/asset-studio/model.js';
import {BED_CELL,MaterialBed} from '../src/asset-studio/material-bed.js';
import {disturbDeposit} from '../src/asset-studio/deposit-tools.js';
import {moveChunk,releaseChunk} from '../src/asset-studio/ground-interaction.js';

const step=(sim,n)=>{for(let i=0;i<n;i++)sim.step();};
async function play(id,verify){
 const scene=studioTests.find(s=>s.id===id),library=scene.create();
 validateLibrary(library);
 const sim=await StudioPhysics.create(library,'world');
 try{scene.start?.(sim);verify(sim);}finally{sim.dispose();}
}
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);

test('the same cubic stock makes chips, splinters or flakes with continuous grain, preserving volume and pick ownership',()=>{
 const original=seedLibrary().materials.find(m=>m.id==='wood');
 function fragmentExtents(grain){
  const material={...original,fractureGrain:grain};
  const grid=fractureGrid([{type:'box',center:[0,0,0],half:[.5,.5,.5],materialId:'wood'}],[1,1,1],new Map([['wood',material]]));
  const cells=fractureCells(grid),extents=new Vector3();let total=0;
  for(const [i,parts] of cells.parts.entries())for(const shape of parts){
   const weight=shape.volume??8*shape.half.reduce((v,x)=>v*x,1);
   extents.addScaledVector(new Vector3(...shape.half),2*weight);total+=weight;
   assert.equal(cellOwner(grid,cells.sites[i].toArray(),i),i);
  }
  close(total,1);return extents;
 }
 const neutral=fragmentExtents(0),partial=fragmentExtents(.5),fibres=fragmentExtents(1),layers=fragmentExtents(-1);
 assert.ok(neutral.x/neutral.y<1.3&&neutral.y/neutral.z<1.3);
 assert.ok(partial.x/partial.y>neutral.x/neutral.y&&partial.x/partial.y<fibres.x/fibres.y);
 assert.ok(fibres.x>2.8*Math.max(fibres.y,fibres.z));
 assert.ok(Math.min(layers.x,layers.z)>3.4*layers.y);
 const legacy=seedLibrary();delete legacy.materials[0].fractureGrain;delete legacy.materials[0].fractureDelay;
 validateLibrary(legacy);assert.equal(legacy.materials[0].fractureGrain,0);assert.equal(legacy.materials[0].fractureDelay,.24);
});

test('a brief overload separates brittle stock while equal-strength stock with a longer damage time holds',async()=>{
 async function load(delay){
  const library=seedLibrary(),part=library.assets[0].parts[0];
  Object.assign(library.materials.find(m=>m.id==='wood'),{fractureDelay:delay});
  library.world={groundMaterialId:'stone',wind:{speed:0,heading:0},instances:[{id:'beam',assetId:'starter',transform:{...transform(),position:[0,30,0]}}]};
  part.stamps=[stamp('box','add',[1.5,0,0],[1.5,.08,.08],'wood',0)];part.physics={fixed:true};
  const sim=await StudioPhysics.create(library,'world');
  try{
   step(sim,10);
   return sim.structures[0].bodies.size;
  }finally{sim.dispose();}
 }
 assert.ok(await load(.04)>1);assert.equal(await load(.9),1);
});

test('all three fracture samples break on their first drop; ordinary sculpts, float assemblies and motor mounts survive playback',async()=>{
 await play('fracture',sim=>{
  // Splitting in mid-motion and resting adjacent faces may dissipate energy.
  // A gentle drop must never fire a shard across the test world.
  let fastest=0;
  for(let i=0;i<360;i++){
   sim.step();
   for(const {body} of sim.bodies.values()){
    const v=body.linvel();fastest=Math.max(fastest,Math.hypot(v.x,v.y,v.z));
   }
  }
  assert.ok(fastest<2*Math.sqrt(2*9.81*.9));assert.equal(sim.structures.length,3);
  for(const s of sim.structures)assert.ok(s.bodies.size>1);
 });
 for(const id of ['joints','sculpts','tidepool'])await play(id,sim=>{
  const original=sim.bodies.size,link=sim.joints[0];let swing=0;
  for(let i=0;i<720;i++){
   sim.step();
   if(link)swing=Math.max(swing,Math.abs(link.child.body.rotation().z));
  }
  assert.equal(sim.broken,0,id);assert.equal(sim.bodies.size,original,id);
  if(link)assert.ok(swing>.075,id+' arm should swing');
 });
});

test('the notched beam supports its own end weight until the player pushes down',async()=>play('load',sim=>{
 step(sim,440);const beam=sim.get('cantilever','body');
 assert.equal(beam.structure.bodies.size,1);assert.equal(sim.broken,0);
 sim.addPulse(beam.key,new Vector3(1.31,1.02,0),new Vector3(0,-4200,0),.4);step(sim,140);
 assert.ok(beam.structure.bodies.size>1);assert.equal(sim.broken,0);
}));

test('a nudge on the rim spills the sand the bowl caught',async()=>play('deposition',sim=>{
 const count=sim.matter.count;step(sim,160);
 assert.equal(count,64);assert.equal(sim.matter.count,count);
 const bowl=sim.get('bowl','body');
 sim.addPulse(bowl.key,new Vector3(.23,.22,0),new Vector3(480,2400,0),.25);step(sim,680);
 assert.ok(sim.matter.count<count/4);assert.ok(sim.sandTerrain);
 assert.equal(sim.structures.filter(s=>s.bodies.size>1).length,0);
}));

test('the graphite bridge conducts again when returned to the two copper contacts',async()=>play('current',sim=>{
 step(sim,60);const bridge=sim.get('bridge','body'),body=bridge.body;
 const rest=body.translation(),rotation=body.rotation();
 const watts=()=>bridge.field.sites.reduce((v,s)=>v+s.watts,0);
 const closed=watts();assert.ok(closed>1);
 body.setTranslation({x:rest.x,y:rest.y+2,z:rest.z},true);step(sim,24);assert.ok(watts()<.01);
 body.setTranslation(rest,true);body.setRotation(rotation,true);body.setLinvel(new Vector3(),true);body.setAngvel(new Vector3(),true);
 step(sim,60);assert.ok(watts()>closed*.65);
}));

test('adding water to the burning tinder cools the touched face and puts out its flame',async()=>play('fire',sim=>{
 step(sim,46);const hot=sim.get('tinder','body').field.sites.reduce((a,b)=>a.t>b.t?a:b);
 const before=hot.t;assert.ok(hot.burning>0);
 sim.materialWorld.apply(hot,'wet',3);step(sim,16);
 assert.ok(hot.t<before-200);assert.equal(hot.burning,0);
}));

test('brine outruns oil, and a player can lift, drop and splash a finite oil pool on bronze',async()=>play('runoff',sim=>{
 step(sim,260);
 const oil=sim.matter.beds.get('oil'),brine=sim.matter.beds.get('brine');
 function weightedRadius(bed){
  const cells=[...bed.nodes.values()],total=cells.reduce((s,c)=>s+c.h,0);
  const x=cells.reduce((s,c)=>s+c.x*c.h,0)/total,z=cells.reduce((s,c)=>s+c.z*c.h,0)/total;
  return cells.reduce((s,c)=>s+c.h*((c.x-x)**2+(c.z-z)**2),0)/total;
 }
 assert.ok(weightedRadius(brine)>1.25*weightedRadius(oil));
 const top=()=>{const c=[...oil.nodes.values()].reduce((a,b)=>a.h>b.h?a:b);return new Vector3(c.x*BED_CELL,c.h,c.z*BED_CELL);};
 const point=top(),initial=oil.volume(),world=sim.materialWorld;
 const contact=world.target(sim,{bedMaterial:'oil',point});assert.equal(contact.material.id,'oil');world.apply(contact,'heat',.03);
 assert.ok(disturbDeposit(sim,oil,point));
 const group=sim.heldDeposit;assert.ok(group.thermal.t>293.15);
 close(group.packets.reduce((v,p)=>v+p.volume,0)+oil.volume(),initial);
 assert.equal(sim.cuts.nodes.size,0);
 moveChunk(sim,point.clone().add(new Vector3(.6,.8,0)));step(sim,60);
 assert.ok(group.packets.every(p=>p.body.translation().y>.5));
 releaseChunk(sim,true);step(sim,360);assert.equal(sim.heldDeposit,null);
 close(oil.volume(),initial);assert.equal(sim.cuts.nodes.size,0);
 assert.ok(disturbDeposit(sim,oil,top(),2000));
 const splash=[...sim.matter.parts.values()].find(g=>g.thermal?.material===oil.material);
 assert.ok(splash.packets.every(p=>p.body.linvel().y>0));assert.equal(sim.cuts.nodes.size,0);
}));

test('probing loose sand does not glue grains to the floor',()=>{
 const sand=seedLibrary().materials.find(m=>m.id==='sand');
 const bed=new MaterialBed(sand,false);bed.add(0,0,.04,'sand');
 assert.equal(bed.thermalAt(0,0,true).melt,0);
 bed.advance(.1,{speed:0,heading:0},()=>0);
 assert.ok(bed.at(0,0).h<.99);close(bed.volume(),.04);
});
