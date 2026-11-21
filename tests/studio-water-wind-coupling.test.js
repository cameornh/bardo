import test from 'node:test';
import assert from 'node:assert/strict';
import {seedLibrary,stamp,transform,validateLibrary,MAX_WIND_SPEED} from '../src/asset-studio/model.js';
import {WindSea,MAX_PARCELS} from '../src/asset-studio/ocean.js';
import {WindSand,SAND_CAP} from '../src/asset-studio/wind-sand.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {jointDefaults} from '../src/asset-studio/physics-data.js';

const dt=1/120;
test('steep moving crests overturn into bounded wind-driven parcels and a held handful survives a gale',()=>{
 const sea=new WindSea(24,0);let airborne=false,stillAttached=false;
 sea.lift(0,0);sea.moveLift({x:-3,y:2,z:0});
 for(let i=0;i<800;i++){
  sea.advance(dt);
  airborne||=sea.drops.some(p=>p.periodic&&p.y-sea.height(p.x,p.z)>.15&&p.vx>0);
  stillAttached||=sea.drops.some(p=>p.periodic&&p.crest&&p.u===0&&p.y<sea.height(p.x,p.z));
  assert.ok(sea.drops.length<=MAX_PARCELS);
 }
 assert.ok(airborne&&stillAttached);assert.equal(sea.drops.filter(p=>p.held).length,10);
 assert.ok(new Set(sea.drops.map(p=>p.r)).size>10);
 sea.release();sea.setWind(0,0);for(let i=0;i<500;i++)sea.advance(dt);
 assert.equal(sea.drops.length,0);
});
test('oncoming waves break against a fixed collider at its face and miss a raised collider',async()=>{
 for(const height of [0,10]){
  const l=seedLibrary(),p=l.assets[0].parts[0];p.stamps=[stamp('box','add',[0,0,0],[.5,1.4,2],'stone')];
  p.physics={fixed:true};l.world.instances=[{id:'pier',assetId:'starter',transform:{...transform(),position:[0,height,0]}}];
  l.world.groundMaterialId='water';l.world.wind={speed:18,heading:0};
  const sim=await StudioPhysics.create(l,'world','starter'),hits=[],sea=sim.sea;
  const emit=sea.breakCrest.bind(sea);sea.breakCrest=(x,z,e,dx,dz,periodic)=>{if(!periodic)hits.push({x,z,dx});emit(x,z,e,dx,dz,periodic);};
  try{for(let i=0;i<1200;i++)sim.step(dt);
   if(height)assert.equal(hits.length,0);
   else{assert.ok(hits.length>0);assert.ok(hits.every(p=>Math.abs(p.x+.56)<.01&&Math.abs(p.z)<=2.01&&p.dx<-.95));}
  }finally{sim.dispose();}
 }
});
test('wind loads a joint and can release a weak anchor without a nudge',async()=>{
 const l=seedLibrary(),p=l.assets[0].parts[0];p.stamps=[stamp('box','add',[0,0,0],[.08,.5,.6],'wood')];
 p.transform.position=[0,2,0];p.joint={...jointDefaults(),type:'fixed',parentId:'ground',anchor:[0,1.5,0],breakForce:250};
 l.world.instances=[{id:'vane',assetId:'starter',transform:transform()}];l.world.wind={speed:0,heading:0};
 const sim=await StudioPhysics.create(l,'world','starter',0);
 try{for(let i=0;i<24;i++)sim.step();assert.equal(sim.broken,0);
  sim.wind={speed:MAX_WIND_SPEED,heading:0};for(let i=0;i<120;i++)sim.step();
  assert.equal(sim.broken,1);assert.ok(sim.get('vane',p.id).body.translation().x>.1);
 }finally{sim.dispose();}
 l.world.wind.speed=MAX_WIND_SPEED;validateLibrary(l);
});
test('sand drifts with the wind, stays grounded below threshold, and returns its entire mobile load',()=>{
 const sand=new WindSand(),mat=seedLibrary().materials.find(m=>m.id==='sand');
 const total=()=>sand.bed.reduce((a,b)=>a+b,0)+sand.grains.reduce((a,b)=>a+b.load,0);
 const start=total();
 for(let i=0;i<100;i++)sand.advance(dt,{speed:4,heading:90},mat);assert.equal(sand.grains.length,0);
 for(let i=0;i<600;i++)sand.advance(dt,{speed:52,heading:90},mat);
 assert.ok(sand.grains.length>100&&sand.grains.length<=SAND_CAP);assert.ok(sand.grains.every(g=>g.vz>0));
 assert.ok(Math.abs(total()-start)<1e-6);assert.ok(new Set(sand.bed).size>100);
 for(let i=0;i<300;i++)sand.advance(dt,{speed:0,heading:90},mat);
 assert.equal(sand.grains.length,0);assert.ok(Math.abs(total()-start)<1e-6);
 mat.moisture=1;for(let i=0;i<120;i++)sand.advance(dt,{speed:20,heading:90},mat);
 assert.equal(sand.grains.length,0);
});
test('swept spray hits a solid wall and loses normal speed',async()=>{
 const l=seedLibrary(),p=l.assets[0].parts[0];p.stamps=[stamp('box','add',[0,0,0],[.08,2,2],'stone')];p.physics={fixed:true};
 l.world.instances=[{id:'wall',assetId:'starter',transform:transform()}];l.world.groundMaterialId='water';
 const sim=await StudioPhysics.create(l,'world','starter');
 try{const d={x:-.4,y:1,z:0,r:.06,vx:10,vy:0,vz:0};sim.sea.appendDrop(d);
  for(let i=0;i<12;i++)sim.step();assert.ok(d.x<-.08&&d.vx<0&&Math.abs(d.vx)<2);
 }finally{sim.dispose();}
});
test('authoring preview can generate spray on a placed part before physics starts',async()=>{
 const {Group}=await import('three'),{AuthoredWaveContacts}=await import('../src/asset-studio/authored-wave-contacts.js');
 const library=seedLibrary(),part=library.assets[0].parts[0],group=new Group(),object=new Group();
 part.stamps=[stamp('box','add',[0,0,0],[.5,1.4,2],'stone')];group.userData.assetId='starter';object.userData.partId=part.id;
 group.add(object);const sea=new WindSea(18,0),preview=new AuthoredWaveContacts();
 preview.rebuild({groups:new Map([['placed',group]]),library});
 let contact=false;
 for(let i=0;i<480;i++){preview.advance(sea);sea.advance(dt);contact||=sea.drops.some(d=>!d.periodic&&d.x<-.5);}
 assert.ok(contact);
});
