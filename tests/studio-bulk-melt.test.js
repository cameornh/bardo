import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {materialBench} from '../src/asset-studio/workbenches.js';
import {stamp} from '../src/asset-studio/model.js';
import {jointDefaults} from '../src/asset-studio/physics-data.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {activeMass,heat,surfaceState} from '../src/asset-studio/material-reactions.js';
import {conductInterior,releaseMelt} from '../src/asset-studio/bulk-melt.js';
import {MaterialBed,BED_CELL} from '../src/asset-studio/material-bed.js';

const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const sum=(xs,f)=>xs.reduce((t,x)=>t+f(x),0);
function specimen(id='wax'){
 const l=materialBench();l.world.instances=l.world.instances.filter(i=>i.id===id);
 return l;
}
test('surface heating conducts into the core, conserves energy and cannot spend latent heat twice',async()=>{
 const sim=await StudioPhysics.create(specimen(),'world','wax',0);
 try{
  const r=sim.get('wax','sample'),w=sim.materialWorld,[a,b]=r.field.sites;
  near(sum([a,b],s=>s.mass+s.core.mass),r.body.mass());
  const start=a.core.t;
  heat(a,activeMass(a)*(a.material.latentHeat+120*a.material.heatCapacity));
  assert.equal(a.melt,1);assert.equal(a.core.melt,0);
  const energy=()=>a.h*a.mass+a.core.h*a.core.mass;
  const initial=energy();conductInterior(a,1);assert.ok(a.core.t>start);near(energy(),initial,1e-7);
  releaseMelt(sim,r);assert.equal(sim.matter.count,0);
  w.apply(b,'bulkCool',.15);assert.ok(b.core.t<start);
 }finally{sim.dispose();}
});
test('whole moving sculpt melts once, with its remaining mass, heat, film and momentum',async()=>{
 const l=specimen(),placed=l.world.instances[0];placed.transform.position=[1,4,-3];placed.transform.rotation=[24,35,-16];
 const snapshot=JSON.stringify(l),sim=await StudioPhysics.create(l,'world','wax',0);
 try{
  const r=sim.get('wax','sample'),s=r.field.sites[0],m=s.material;
  r.body.setLinvel({x:2,y:.5,z:-1},true);r.body.setAngvel({x:.2,y:.5,z:2},true);
  s.lost=.08;s.water=.018;sim.materialWorld.apply(s,'bulkHeat',1);
  const states=r.field.sites.flatMap(s=>[s,s.core]);
  const mass=sum(states,activeMass),energy=sum(states,s=>s.h*activeMass(s)),film=sum(states,s=>s.water);
  releaseMelt(sim,r);
  const [g]=sim.matter.parts.values(),liquid=sim.materialWorld.probe;
  assert.equal(sim.bodies.size,0);assert.equal(sim.colliderCount,0);assert.equal(sim.structures[0].bodies.size,0);
  assert.equal(g.kind,2);assert.equal(liquid.group,g);assert.equal(liquid.material.id,m.id);
  near(mass,sum(g.packets,p=>p.body.mass()));near(mass,g.packets.length*g.packets[0].volume*m.density);
  near(liquid.h*activeMass(liquid),energy,1e-6);near(film,liquid.water);near(sim.matter.meltedMass,mass);
  for(const [axis,want] of [['x',2],['y',.5],['z',-1]])near(sum(g.packets,p=>p.body.linvel()[axis])/g.packets.length,want);
  assert.ok(g.packets.every(p=>p.position.y>3.5&&p.position.z<-2));assert.ok(new Set(g.packets.map(p=>p.body.linvel().x)).size>1);
  for(let i=0;i<45;i++)sim.step();near(sim.matter.meltedMass,mass);assert.equal(JSON.stringify(l),snapshot);
 }finally{sim.dispose();}
});
test('melting a custom material frees its joint and preserves the cold painted region of the same sculpt',async()=>{
 const l=specimen(),a=l.assets.find(a=>a.id==='wax'),p=a.parts[0];
 l.materials.push({...l.materials.find(m=>m.id==='wax'),id:'binder',name:'Custom binder'});
 p.stamps=[stamp('box','add',[0,.4,0],[.65,.4,.4],'binder',0),stamp('box','paint',[.47,.4,0],[.25,.6,.6],'porcelain',0)];
 p.joint={...jointDefaults(),parentId:'ground',type:'ball',anchor:[-.4,.4,0]};
 const sim=await StudioPhysics.create(l,'world',a.id,0);
 try{
  const r=sim.get('wax','sample'),s=r.field.sites.find(s=>s.material.id==='binder'),before=r.body.mass();
  assert.equal(sim.joints.length,1);assert.ok(r.field.sites.some(s=>s.material.id==='porcelain'));
  sim.materialWorld.apply(s,'bulkHeat',1);for(let i=0;i<15;i++)sim.step();
  const solids=[...sim.bodies.values()];assert.ok(solids.length);
  assert.ok(solids.every(r=>r.field.sites.every(s=>s.material.id==='porcelain')));assert.equal(sim.joints.length,0);
  assert.ok(sim.matter.count>0);assert.ok([...sim.matter.parts.values()].every(g=>g.material.id==='binder'));
  near(before,sum(solids,r=>r.body.mass())+sim.matter.meltedMass,.001);
  for(let i=0;i<20;i++)sim.step();assert.ok(solids.every(r=>r.body.isValid()));
 }finally{sim.dispose();}
});
test('a full parcel pool defers melting without removing the support; retries after space is available',async()=>{
 const sim=await StudioPhysics.create(specimen(),'world','wax',0);
 try{
  const r=sim.get('wax','sample');sim.materialWorld.apply(r.field.sites[0],'bulkHeat');
  sim.matter.count=767;releaseMelt(sim,r);assert.equal(sim.get('wax','sample'),r);assert.ok(r.body.isValid());
  sim.matter.count=764;releaseMelt(sim,r);assert.equal(sim.matter.count,768);assert.equal(sim.bodies.size,0);
 }finally{sim.dispose();}
});
test('heating one end of a sculpt keeps a disconnected region of the same material cold',async()=>{
 const l=specimen(),p=l.assets.find(a=>a.id==='wax').parts[0];
 p.stamps=[stamp('box','add',[0,.4,0],[.65,.4,.4],'wax',0),stamp('box','paint',[0,.4,0],[.18,.6,.6],'porcelain',0)];
 const sim=await StudioPhysics.create(l,'world','wax',0);
 try{
  const r=sim.get('wax','sample'),ends=[...new Set(r.field.mapping)].filter(zone=>zone[0].material.id==='wax');
  assert.equal(ends.length,2);
  ends.sort((a,b)=>a[0].local.x-b[0].local.x);
  const cold=ends[1][0],expected=sum(ends[0],s=>activeMass(s)+activeMass(s.core));
  sim.materialWorld.apply(ends[0][0],'bulkHeat');
  for(let i=0;i<16;i++)sim.step();
  near(sim.matter.meltedMass,expected,.001);
  const surviving=[...sim.bodies.values()].flatMap(body=>body.field.sites).filter(s=>s.material.id==='wax');
  assert.ok(surviving.length&&surviving.every(s=>s.core.t<cold.material.initialTemperature+1&&s.melt===0));
  assert.ok(sim.materialWorld.nodes.every(s=>!s.record||s.record.body.isValid()));
 }finally{sim.dispose();}
});
test('separate landings keep their heat through spreading and conserve mass, fuel and film',()=>{
 const m=materialBench().materials.find(m=>m.id==='wax'),bed=new MaterialBed(m,true);
 const hot=surfaceState(m,'hot',new Vector3(),1,2),warm=surfaceState(m,'warm',new Vector3(),1,3);
 heat(hot,activeMass(hot)*400000);heat(warm,activeMass(warm)*300000);
 hot.water=.2;warm.water=.01;hot.fuel=.4;
 bed.add(-1,0,2/m.density,'a',hot);bed.add(1,0,3/m.density,'b',warm);
 near(bed.thermalAt(-1,0).h,hot.h);near(bed.thermalAt(1,0).h,warm.h);
 for(let i=0;i<16;i++)bed.advance(.05,{speed:0,heading:0},()=>0);
 const sites=bed.thermalCells.map(c=>c.thermal);
 near(sum(sites,activeMass),5);near(sum(sites,s=>s.water),.21);
 near(sum(sites,s=>s.h*activeMass(s)),hot.h*2+warm.h*3,1e-6);
 near(sum(sites,s=>s.fuel*activeMass(s)),3.8);
 near(bed.volume()*m.density,5);assert.ok(bed.nodes.size>2);
 for(const c of bed.thermalCells)near(c.h*BED_CELL**2*m.density,activeMass(c.thermal));
});
test('released wax reaches a spreading, probeable deposit in normal playback',async()=>{
 const sim=await StudioPhysics.create(specimen(),'world','wax');
 try{
  const r=sim.get('wax','sample'),initial=r.body.mass();
  sim.materialWorld.apply(r.field.sites[0],'bulkHeat');
  for(let i=0;i<480;i++)sim.step();
  const bed=sim.matter.beds.get('wax'),p=sim.materialWorld.probe;
  assert.equal(sim.matter.count,0);assert.ok(bed.liquid&&bed.nodes.size>4);
  near(bed.volume()*bed.material.density,initial,.00001);
  assert.ok(p.deposit&&p.t>p.material.meltingPoint);
  assert.equal(sim.materialWorld.target(sim,{bedMaterial:'wax',point:p.position}),p);
 }finally{sim.dispose();}
});

test('freezing rate controls trapped inclusions and remelting clears them',()=>{
 const ice=materialBench().materials.find(m=>m.id==='ice');
 const freeze=duration=>{
  const site=surfaceState(ice,'lens',new Vector3(),1,1);
  heat(site,ice.heatCapacity*(ice.meltingPoint-ice.initialTemperature)+ice.latentHeat);
  assert.equal(site.melt,1);
  for(let i=0;i<40;i++)heat(site,-ice.latentHeat/40,duration/40);
  assert.ok(site.melt<1e-8);
  return site;
 };
 const slow=freeze(180),fast=freeze(2);
 assert.ok(slow.trapped<.08&&fast.trapped>.9);
 heat(fast,ice.latentHeat+1);
 assert.equal(fast.trapped,0);
});
