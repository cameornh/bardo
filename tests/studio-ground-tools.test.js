import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Matrix4,Group} from 'three';
import {seedLibrary,stamp,transform} from '../src/asset-studio/model.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {AuthoredWaveContacts} from '../src/asset-studio/authored-wave-contacts.js';
import {parcelObstacle,resolveParcel} from '../src/asset-studio/parcel-contact.js';
import {WindSea} from '../src/asset-studio/ocean.js';
import {CELL,GroundCuts,impactResponse} from '../src/asset-studio/ground-tools.js';
import {liftGround,moveChunk,releaseChunk,strikeGround} from '../src/asset-studio/ground-interaction.js';
import {retention} from '../src/asset-studio/physics-data.js';
import {MaterialBed} from '../src/asset-studio/material-bed.js';
const near=(a,b,tol=.001)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
async function world(ground,instances=[]){
 const l=seedLibrary();l.world.groundMaterialId=ground;l.world.instances=instances;
 return StudioPhysics.create(l,'world','arch');
}
test('lifted and thrown water collides with the solid arch but passes through its opening in the authoring view',()=>{
 const library=seedLibrary(),p=library.assets.find(a=>a.id==='arch').parts[0],group=new Group(),part=new Group();
 group.userData.assetId='arch';part.userData.partId=p.id;group.position.set(-3,0,-1);group.add(part);
 const preview=new AuthoredWaveContacts();preview.rebuild({groups:new Map([['arch',group]]),library});
 const sea=new WindSea();sea.lift(-3,1);
 sea.moveLift({x:-3,y:.6,z:.5},preview.collideDrop);
 sea.moveLift({x:-3,y:.6,z:-2.8},preview.collideDrop);
 assert.ok(sea.held.every(({drop})=>drop.z<-2.4));
 sea.moveLift({x:-1.85,y:.8,z:-2.8},preview.collideDrop);
 sea.moveLift({x:-1.85,y:.8,z:.5},preview.collideDrop);
 for(let i=0;i<40;i++)sea.advance(1/120,preview.collideDrop);
 assert.ok(sea.held.every(({drop})=>drop.z<=-1.42-drop.r));
 sea.release();
 for(const d of sea.drops)d.vz=32;
 for(let i=0;i<12;i++)sea.advance(1/120,preview.collideDrop);
 assert.ok(sea.drops.length>0&&sea.drops.every(d=>d.z<-1.42));
});
test('a parcel starting inside a nonuniformly scaled moving wall is expelled on its exposed side',()=>{
 const matrix=new Matrix4().makeScale(2,1.3,.5);
 const wall=parcelObstacle([stamp('box','add',[0,0,0],[.3,.6,.2],'stone',0)],()=>matrix);
 for(const offset of [0,3]){
  matrix.setPosition(offset,0,0);
  const d={x:offset,y:0,z:.02,vx:0,vy:0,vz:0,r:.1};
  assert.ok(resolveParcel([wall],d,{...d}));assert.ok(d.z>=.199&&d.z<.203);
 }
});
test('during playback water thrown at the moving arch uses its current placement',async()=>{
 const l=seedLibrary();l.world.groundMaterialId='water';l.world.wind={speed:0,heading:0};
 l.world.instances=[{id:'arch',assetId:'arch',transform:transform()}];
 const s=await StudioPhysics.create(l,'world','arch',0);
 try{
  const r=[...s.bodies.values()][0];r.body.setTranslation({x:3,y:0,z:0},true);s.step();
  s.sea.lift(4.12,2);s.sea.moveLift({x:4.12,y:.9,z:1.1},s.collideDrop);s.sea.release();
  for(const d of s.sea.drops)d.vz=-40;
  for(let i=0;i<8;i++)s.step();
  assert.equal(s.sea.drops.length,10);assert.ok(s.sea.drops.every(d=>d.z>.42+d.r));
 }finally{s.dispose();}
});
test('a removed wood plug has the volume, mass and shape of its cavity, including terrain collision',async()=>{
 const s=await world('wood'),pos=new Vector3(-12,0,0);
 try{
  assert.ok(liftGround(s,pos));const c=s.heldChunk;
  near(c.body.mass(),c.cut.volume*c.material.density);near(s.cuts.offset(pos.x,0),-.32);
  const volume=c.cut.volume;moveChunk(s,new Vector3(-11,2,1));
  for(let i=0;i<140;i++)s.step();assert.ok(c.body.translation().y>1.6);
  releaseChunk(s);
  for(let i=0;i<180;i++)s.step();assert.ok(c.body.translation().y<.5);
  const floor=(x,z)=>2-s.world.castRay(new s.R.Ray({x,y:2,z},{x:0,y:-1,z:0}),6,true,undefined,undefined,undefined,c.body).timeOfImpact;
  for(const [dx,dz] of [[0,0],[.1,.11],[-.15,.16],[.5,0]])near(floor(pos.x+dx,dz),s.cuts.offset(pos.x+dx,dz));
  near(volume,.32*CELL**2);
 }finally{s.dispose();}
});
test('sand handful disaggregates at the drop location with the removed volume; an impulse also ejects sand',async()=>{
 const s=await world('sand');
 try{
  const p=new Vector3(1,s.sand.height(1,1),1);assert.ok(liftGround(s,p));const cut=s.heldChunk.cut;
  moveChunk(s,new Vector3(2,2,1));for(let i=0;i<90;i++)s.step();releaseChunk(s);
  const g=[...s.matter.parts.values()][0];near(g.packets.reduce((n,p)=>n+p.volume,0),cut.volume);
  assert.ok(g.packets.every(p=>p.position.y>1.5&&p.material.id==='sand'));assert.equal(s.chunks.size,0);
  assert.ok(strikeGround(s,new Vector3(4,0,0),5000));
  const eject=[...s.matter.parts.values()].at(-1);assert.ok(eject.packets.every(p=>p.body.linvel().y>0));
 }finally{s.dispose();}
});
test('an impulse propagates to a grounded box and decays with distance; airborne objects get no kick',async()=>{
 const l=seedLibrary(),a=l.assets[0];a.parts[0].stamps=[stamp('box','add',[0,0,0],[.15,.15,.15],'wood',0)];
 l.world.groundMaterialId='wood';l.world.instances=[0,1,2].map((x,i)=>({id:'b'+i,assetId:a.id,transform:{...transform(),position:[x,i===2?2:.15,0]}}));
 const s=await StudioPhysics.create(l,'world',a.id);
 try{
  strikeGround(s,new Vector3(0,0,0),1000);assert.equal(s.cuts.nodes.size,0);
  assert.equal(s.pulses.length,2);assert.ok(s.pulses[0].force.y>s.pulses[1].force.y);assert.ok(s.pulses.every(p=>!p.key.startsWith('b2:')));
  s.step();assert.ok(s.get('b0',a.parts[0].id).body.linvel().y>0);
 }finally{s.dispose();}
});
test('lifting from a same-material deposit starts at the top of the pile',async()=>{
 const s=await world('sand');
 try{
  const bed=new MaterialBed(s.groundMaterial,false);s.matter.beds.set('sand',bed);
  bed.add(0,0,.02,'ground:sand');const top=s.matter.groundHeight(s,0,0);
  assert.ok(liftGround(s,new Vector3(0,top,0)));
  near(s.heldChunk.cut.top.y,top);near(s.matter.groundHeight(s,0,0),top-s.heldChunk.cut.depth);
 }finally{s.dispose();}
});
test('cohesion, yield, rebound, stiffness and interface adhesion control the response',()=>{
 const m=seedLibrary().materials.find(m=>m.id==='wood'),response=impactResponse(m,45000);
 assert.ok(response.dent>0);assert.equal(impactResponse({...m,cohesion:1e7},45000).dent,0);
 assert.ok(impactResponse({...m,youngModulus:m.youngModulus*4},45000).reach>response.reach);
 const dents=[.1,.85].map(elastic=>{const cuts=new GroundCuts();cuts.displace(0,0,.1,elastic);for(let i=0;i<180;i++)cuts.relax(1/120);return -cuts.offset(0,0);});
 assert.ok(dents[0]>dents[1]*4);
 assert.equal(retention({...m,adhesion:0}),0);assert.ok(retention(m)>retention({...m,cohesion:0}));
});
test('water lift debits the volume of the handful and clears the deficit as the drops return',()=>{
 const sea=new WindSea();sea.lift(0,0);
 const v=sea.drops.reduce((v,d)=>v+4*Math.PI*d.r**3/3,0);
 for(const time of [0,.3]){
  sea.sampleTime(time);let removed=0;
  for(let i=0;i<120;i++){const r=(i+.5)*.01;removed-=sea.height(r,0)*2*Math.PI*r*.01;}
  near(removed,v,.0001);
 }
 for(let i=0;i<30;i++)sea.ripple(30+i,20,.002);
 assert.ok(sea.ripples.some(ring=>ring.scoop&&Math.abs(ring.volume-v)<1e-8));
 sea.release();for(let i=0;i<600;i++)sea.advance(1/120);
 assert.equal(sea.drops.length,0);near(sea.height(0,0),0);
});
test('lifting a custom gas ground produces a dispersing puff and the cavity closes',async()=>{
 const l=seedLibrary();l.world.groundMaterialId='clay';l.world.instances=[];
 Object.assign(l.materials.find(m=>m.id==='clay'),{phase:'gas',density:1.2,cohesion:0,liquidity:1});
 const s=await StudioPhysics.create(l,'world','arch');
 try{
  assert.ok(liftGround(s,new Vector3(3,0,0)));releaseChunk(s);
  assert.equal(s.matter.count,18);assert.ok(s.cuts.offset(3,0)<-.3);
  for(let i=0;i<360;i++)s.step();
  near(s.cuts.offset(3,0),0);assert.equal(s.matter.count,0);assert.equal(s.matter.beds.size,0);
 }finally{s.dispose();}
});
