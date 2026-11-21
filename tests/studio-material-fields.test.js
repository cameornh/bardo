import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {seedLibrary,validateLibrary,addStudioPresets} from '../src/asset-studio/model.js';
import {MaterialAir,AIR_OXYGEN,MAX_AIR} from '../src/asset-studio/material-air.js';
import {surfaceState,heat,enthalpyAt,addWater,react,exchangePair,chargeNetwork,conductance} from '../src/asset-studio/material-reactions.js';
import {liftGround,releaseChunk} from '../src/asset-studio/ground-interaction.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {materialBench} from './studio-material-fields-fixture.js';

const materials=Object.fromEntries(seedLibrary().materials.map(m=>[m.id,m]));
const surface=(id,m=materials[id])=>surfaceState(m,id,new Vector3(.2,.2,.2),1,1);
const near=(x,y,eps=1e-7)=>assert.ok(Math.abs(x-y)<=eps, x+' vs '+y);
const cell=()=>({heat:0,water:0,vapour:0,smoke:0,oxygenUsed:0});
test('older libraries gain presets once and keep custom materials, assets and authored overrides',()=>{
 const l=seedLibrary(),assets=structuredClone(l.assets);l.materials=l.materials.slice(0,7);
 for(const m of l.materials){delete m.waterContent;delete m.initialTemperature;}
 l.materials.push({...materials.copper,name:'Hand painted',color:'#102030'});
 const read=validateLibrary(l);
 addStudioPresets(read.materials);addStudioPresets(read.materials);
 assert.equal(read.materials.length,19);assert.deepEqual(read.assets,assets);
 assert.equal(read.materials.find(m=>m.id==='copper').color,'#102030');
 assert.equal(read.materials.find(m=>m.id==='water').waterContent,1);
 assert.equal(read.materials.find(m=>m.id==='wood').waterContent,0);
});
test('latent heat holds temperature at fusion while strength and expansion evolve',()=>{
 const s=surface('wax'),m=s.material;
 s.h=enthalpyAt(m,m.meltingPoint,false);
 heat(s,.5*m.latentHeat);near(s.t,m.meltingPoint);near(s.melt,.5);
 react(s,new MaterialAir(),cell(),.01,0);
 assert.ok(s.strength<.53&&s.strength>.5);assert.ok(s.scale>1.01);
 heat(s,2*m.latentHeat);assert.ok(s.t>m.meltingPoint&&s.melt===1);
});
test('contact heat transfer conserves energy and depends on both conductivities and heat capacities',()=>{
 const conduct=(m)=>{
  const a=surface('a',m),b=surface('b',m);heat(a,m.heatCapacity*90);
  const before=a.h+b.h;exchangePair(a,b,.3,.03);near(a.h+b.h,before,1e-6);assert.ok(b.t<=a.t);return b.t-293.15;
 };
 assert.ok(conduct(materials.copper)>40*conduct(materials.porcelain));
 assert.ok(conduct(materials.copper)>conduct({...materials.copper,heatCapacity:3*materials.copper.heatCapacity}));
 const q=emissivity=>{const s=surface('a',{...materials.copper,emissivity});heat(s,400*s.material.heatCapacity);const c=cell();react(s,new MaterialAir(),c,.1,0);return c.heat;};
 assert.ok(q(.95)>2*q(.05));
});
test('water rich liquid wicks into open pores, free films dry and evaporated water cools its source',()=>{
 const a=surface('water'),b=surface('sponge'),initial=a.bulkWater;
 exchangePair(a,b,.3,.5);assert.ok(b.water>.1);near(initial-a.bulkWater,b.water);near(a.lost,b.water);
 const air=new MaterialAir();air.humidity=0;const c=cell();
 const before=b.water;react(b,air,c,.25,0);
 assert.ok(b.water<before&&b.t<293.15);near(c.water,before-b.water);
 const src=surface('water'),cs=cell();air.humidity=.45;react(src,air,cs,.125,0);assert.ok(src.lost>0&&cs.water>0);
 const ice=surface('ice'),humid=new MaterialAir();humid.humidity=1;
 const humidCell=cell();react(ice,humid,humidCell,.25,0);assert.ok(ice.water>0&&humidCell.water<0);
});
test('boiled water humidifies the air and nonaqueous vapour stays separate',()=>{
 for(const [id,isWater] of [['water',true],['oil',false]]){
  const s=surface(id),m=s.material,air=new MaterialAir(),c=cell();air.humidity=0;
  heat(s,enthalpyAt(m,m.boilingPoint,true)+60000-s.h);react(s,air,c,.001,0);
  assert.ok(s.lost>.01);if(isWater){assert.ok(c.water>.01);near(c.vapour,0);}else{assert.ok(c.vapour>.01);near(c.water,0);}
  assert.ok(s.t<=m.boilingPoint+.001);
 }
});
test('fuel, oxygen and water control fire, smoke, heat and loss of load-bearing strength',()=>{
 const run=(m,{wet=false,oxygen=true,immersed=false}={})=>{
  const s=surface('x',m),air=new MaterialAir(),c=cell();heat(s,m.heatCapacity*(750-s.t));if(wet)addWater(s,1);
  c.oxygenUsed=oxygen?0:AIR_OXYGEN;s.submerged=immersed;react(s,air,c,.125,0);return {s,c};
 };
 const {s,c}=run(materials.cotton),burned=1-s.fuel;
 assert.ok(burned>0&&s.burning>0&&s.strength<1&&c.heat>0);near(c.smoke,burned*materials.cotton.smokeYield);
 assert.ok(run(materials.cotton,{wet:true}).s.burning<s.burning*.2);
 assert.equal(run(materials.cotton,{oxygen:false}).s.burning,0);
 assert.equal(run(materials.cotton,{immersed:true}).s.burning,0);
 assert.equal(run({...materials.cotton,fuelEnergy:0}).s.burning,0);
 assert.equal(run({...materials.cotton,ignitionTemperature:900}).s.burning,0);
 near(run({...materials.cotton,id:'custom-unrelated-material'}).s.burning,s.burning);
});
test('electrical contacts obey Ohmic power, heating, insulation and changes in film conductivity',()=>{
 const measure=m=>{
  const a=surface('left',materials.copper),b=surface('test',m),c=surface('right',materials.copper);
  const e=[{a,b,area:.05},{a:b,b:c,area:.05}];a.electrode=48;c.electrode=0;
  for(let i=0;i<20;i++)chargeNetwork([a,b,c],e,.125);
  const power=e.reduce((p,x)=>p+x.g*(x.a.volts-x.b.volts)**2,0);
  near(power,a.watts+b.watts+c.watts,1e-9);return {b,power};
 };
 const salt=measure(materials.brine),ins=measure(materials.porcelain);
 assert.ok(salt.power>100&&salt.b.t>293.15&&salt.b.volts>20&&salt.b.volts<28);
 assert.ok(ins.power<.001);
 const a=surface('sponge'),b=surface('sponge');const dry=conductance(a,b,.1);addWater(a,.2);addWater(b,.2);
 assert.ok(conductance(a,b,.1)>dry*100);
});
test('wind transports heat, water, smoke and oxygen deficits on the same bounded grid',()=>{
 const air=new MaterialAir(),from=air.cell(0,0,0,true);
 Object.assign(from,{heat:5000,smoke:.035,water:.007,oxygenUsed:.02});
 air.advance(.125,{speed:4,heading:0});const down=air.cell(1,0,0,false);
 assert.ok(down.smoke>air.cell(-1,0,0,false).smoke);near(down.heat/down.smoke,5000/.035,1e-8);
 near(down.water/down.smoke,.2);assert.ok(down.oxygenUsed>0&&air.read(down).temperature>293.15);
 for(let i=0;i<MAX_AIR*2;i++)air.cell(i,1,0,true);assert.ok(air.cells.size<=MAX_AIR);
});
test('explicitly anchored contacts conduct and separate when a bar moves',async()=>{
 const library=materialBench();
 for(const asset of library.assets.filter(a=>a.id==='copper'||a.id==='graphite'))asset.parts[0].physics={fixed:true};
 const sim=await StudioPhysics.create(library,'world','cotton',0);
 try{
  const w=sim.materialWorld,a=sim.get('copper','sample'),b=sim.get('graphite','sample');
  w.apply(a.field.sites[0],'positive');w.apply(b.field.sites[1],'return');
  for(let i=0;i<32;i++)sim.step();
  const seam=()=>w.edges.some(e=>[e.a.record,e.b.record].includes(a)&&[e.a.record,e.b.record].includes(b));
  assert.ok(seam());assert.ok(b.field.sites.some(s=>s.watts>0.01));
  b.body.setTranslation(new Vector3(15,2,0),true);
  for(let i=0;i<180;i++)sim.step();
  assert.equal(seam(),false);assert.ok(b.field.sites.every(s=>s.watts<.01));
  const t=w.target(sim,{ground:true,point:new Vector3(5,0,2)});w.apply(t,'heat',.2);
  for(let i=0;i<30;i++)sim.step();
  assert.ok(t.t>293.15&&w.air.read(w.air.at(t.position)).temperature>293.15);assert.equal(w.probe,t);
 }finally{sim.dispose();}
});

test('a composite can have two isolated copper traces in one solid part',async()=>{
 const lib=materialBench(),sim=await StudioPhysics.create(lib,'world','cotton',0);
 try{
  const body=sim.world.createRigidBody(sim.R.RigidBodyDesc.fixed());
  const shapes=['copper','porcelain','copper'].map((materialId,i)=>{
   sim.world.createCollider(sim.R.ColliderDesc.cuboid(.5,.5,.2).setTranslation(i,0,0),body);
   return {type:'box',materialId,center:[i,0,0],half:[.5,.5,.2]};
  });
  const r={key:'laminate',scale:new Vector3(1,1,1),body};
  sim.materialWorld.bind(r,shapes);const {sites,mapping,pairs}=r.field;
  assert.notEqual(mapping[0],mapping[2]);assert.equal(sites.length,6);
  mapping[0][0].electrode=48;mapping[2][1].electrode=0;
  const edges=pairs.map(([a,b,area])=>({a,b,area}));for(let i=0;i<16;i++)chargeNetwork(sites,edges,.125);
  assert.ok(mapping[0][1].volts>47&&mapping[2][0].volts<.01);
  assert.ok(sites.every(s=>s.watts<.001));
 }finally{sim.dispose();}
});
test('splitting a hot, wet part conserves skin mass, absorbed water, remaining fuel and enthalpy',async()=>{
 const lib=materialBench(),sim=await StudioPhysics.create(lib,'world','cotton',0);
 try{
  const w=sim.materialWorld,old=sim.get('cotton','sample').field;
  w.apply(old.sites[0],'wet');w.apply(old.sites[0],'heat',.3);old.sites[1].fuel=.3;
  const totals=sites=>sites.reduce((v,s)=>[v[0]+s.mass,v[1]+s.water,v[2]+s.mass*(1-s.lost)*s.fuel,v[3]+s.mass*(1-s.lost)*s.h],[0,0,0,0]);
  const before=totals(old.sites);
  const pieces=[-.36,.36].map((x,i)=>{
   const b=sim.world.createRigidBody(sim.R.RigidBodyDesc.dynamic());
   sim.world.createCollider(sim.R.ColliderDesc.cuboid(.25,.38,.4),b);
   const r={key:'split'+i,scale:new Vector3(1,1,1),body:b};
   w.bind(r,[{type:'box',materialId:'cotton',center:[x,.38,0],half:[.25,.38,.4]}]);return r;
  });
  w.inherit(old,pieces);const after=totals(pieces.flatMap(r=>r.field.sites));
  after.forEach((a,i)=>near(a,before[i],1e-7));assert.ok(before[2]<before[0]);
 }finally{sim.dispose();}
});

test('uniform thermal dilation updates the rendered transform and curved collision shape while preserving mass',async()=>{
 const l=materialBench(),a=l.assets.find(a=>a.id==='porcelain');
 l.world.instances=l.world.instances.filter(i=>i.assetId==='porcelain');
 const p=a.parts[0];p.stamps[0].shape='sphere';p.stamps[0].size=[.3,.3,.3];p.transform.scale=[1,.8,1.2];
 const mat=l.materials.find(m=>m.id==='porcelain');mat.expansion=.001;
 const sim=await StudioPhysics.create(l,'world',a.id,0);
 try{
  const r=sim.get('porcelain','sample'),c=r.body.collider(0);assert.equal(c.shapeType(),9);
  const baseMass=c.mass(),width=Math.max(...c.vertices());sim.materialWorld.apply(r.field.sites[0],'heat',2);
  for(let i=0;i<18;i++)sim.step();
  assert.ok(r.field.scale>1.01);near(Math.max(...c.vertices())/width,r.field.scale,.0001);
  const size=new Vector3().setFromMatrixScale(r.matrix);near(size.x/r.scale.x,r.field.scale,.0001);near(c.mass(),baseMass,.001);
 }finally{sim.dispose();}
});

test('scooping warm damp sand carries its surface energy and water into loose parcels',async()=>{
 const lib=materialBench();lib.world.groundMaterialId='sand';
 const sim=await StudioPhysics.create(lib,'world','cotton',0);
 try{
  const w=sim.materialWorld,point=new Vector3(3,0,4);point.y=sim.matter.groundHeight(sim,point.x,point.z);
  const ground=w.ground(sim,point.x,point.z),initial=ground.h;
  heat(ground,ground.mass*50000);addWater(ground,.013);
  const energy=ground.mass*(ground.h-initial),water=ground.water;
  assert.ok(liftGround(sim,point));
  const chunk=sim.heldChunk,sites=chunk.field.sites;
  near(ground.mass*(ground.h-initial)+sites.reduce((sum,s)=>sum+s.mass*(s.h-initial),0),energy);
  near(ground.water+sites.reduce((sum,s)=>sum+s.water,0),water);
  w.probe=sites[0];releaseChunk(sim);
  const parcel=[...w.loose.values()][0];assert.ok(parcel&&parcel.t>293.15&&parcel.water>0);
  assert.equal(w.probe,parcel);
  near(ground.mass*(ground.h-initial)+parcel.mass*(parcel.h-initial),energy);
  near(ground.water+parcel.water,water);
 }finally{sim.dispose();}
});
