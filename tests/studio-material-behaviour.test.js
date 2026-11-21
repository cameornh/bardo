import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {seedLibrary,stamp,transform,validateLibrary} from '../src/asset-studio/model.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {WindSea} from '../src/asset-studio/ocean.js';
import {lipPoint} from '../src/asset-studio/whitewater.js';
import {MaterialBed,BED_CELL} from '../src/asset-studio/material-bed.js';
import {WindSand} from '../src/asset-studio/wind-sand.js';
import {DepositSurface} from '../src/asset-studio/deposit-view.js';

const still={speed:0,heading:0};
const library=seedLibrary(),material=id=>library.materials.find(m=>m.id===id);
function extent(bed){
 const active=[...bed.nodes.values()].filter(c=>c.h>.012);
 return {area:active.length*BED_CELL**2,peak:Math.max(...active.map(c=>c.h))};
}

test('a granular sculpt and a liquid sculpt deform and retain their authored volumes',async()=>{
 const l=seedLibrary(),shape=l.assets[0].parts[0],sand=structuredClone(l.materials.find(m=>m.id==='sand'));
 sand.id='custom-powder';l.materials.push(sand);
 shape.stamps=[stamp('box','add',[-2,1.3,0],[.5,.5,.5],sand.id,0),stamp('box','add',[2,1.3,0],[.5,.5,.5],'water',0)];
 l.world.instances=[{id:'both',assetId:'starter',transform:transform()}];l.world.groundMaterialId='stone';l.world.wind=still;
 const sim=await StudioPhysics.create(l,'world','starter');
 try{
  const mass=new Map([...sim.matter.parts.values()].map(g=>[g.material.id,g.packets.reduce((s,p)=>s+p.volume,0)]));
  for(let i=0;i<420;i++)sim.step();
  const beds=sim.matter.beds;assert.equal(beds.size,2);assert.equal(sim.bodies.size,0);
  for(const g of sim.matter.parts.values()){
   const volume=g.packets.reduce((s,p)=>s+p.volume,0)+beds.get(g.material.id).volume();
   assert.ok(Math.abs(volume-mass.get(g.material.id))<1e-7);
   assert.ok(beds.get(g.material.id).volume()>.92*volume);
  }
  const sand=extent(beds.get('custom-powder')),water=extent(beds.get('water'));
  assert.ok(water.area>1.3*sand.area);assert.ok(sand.peak>1.6*water.peak);
  assert.ok(sim.matter.liquidColumn(sim,2,0).top>0);
  const mesh=new DepositSurface(beds.get('custom-powder'),null);mesh.update(sim);const i=mesh.geometry.index;
  assert.ok(i&&mesh.geometry.drawRange.count>50);assert.equal(mesh.ownerAt(new Vector3(-2,0,0)),'both:'+shape.id);
  assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));mesh.geometry.dispose();
 }finally{sim.dispose();}
});

test('water added to matching ocean joins its volume and triggers a surface response',async()=>{
 const l=seedLibrary();l.assets[0].parts[0].stamps=[stamp('box','add',[0,1.4,0],[.35,.35,.35],'water')];
 l.world.instances=[{id:'drop',assetId:'starter',transform:transform()}];l.world.groundMaterialId='water';
 const sim=await StudioPhysics.create(l,'world','starter');try{
  for(let i=0;i<180;i++)sim.step();assert.equal(sim.matter.count,0);
  assert.ok(Math.abs(sim.sea.mergedVolume-.7**3)<1e-8);assert.ok(sim.sea.ripples.length);
  sim.sea.reset();assert.equal(sim.sea.mergedVolume,0);
 }finally{sim.dispose();}
});

test('submerged loose material feels buoyancy according to density',async()=>{
 const l=seedLibrary(),neutral=structuredClone(l.materials.find(m=>m.id==='water'));
 neutral.id='distinct-water';l.materials.push(neutral);
 l.assets[0].parts[0].stamps=[stamp('box','add',[-2,-1.5,0],[.25,.25,.25],neutral.id),stamp('box','add',[2,-1.5,0],[.25,.25,.25],'sand')];
 l.world.instances=[{id:'drop',assetId:'starter',transform:transform()}];l.world.groundMaterialId='water';l.world.wind=still;
 const sim=await StudioPhysics.create(l,'world','starter');
 try{
  const meanY=g=>g.packets.reduce((sum,p)=>sum+p.body.translation().y,0)/g.packets.length;
  const groups=[...sim.matter.parts.values()],fluid=groups.find(g=>g.kind===2),sand=groups.find(g=>g.kind===1);
  const fluidStart=meanY(fluid),sandStart=meanY(sand);
  for(let i=0;i<120;i++)sim.step();
  assert.ok(Math.abs(meanY(fluid)-fluidStart)<.12);
  const fall=sandStart-meanY(sand);assert.ok(fall>.12&&fall<3);
 }finally{sim.dispose();}
});

test('finite piles lose volume into saltation and recover it at new locations; submerged walls block lateral flow',()=>{
 const bed=new MaterialBed(material('sand'),false);bed.add(0,0,.5,'pile');
 const current=()=>bed.volume()+bed.grains.reduce((n,g)=>n+g.load,0);
 let grains=0;for(let i=0;i<100;i++){bed.advance(1/30,{speed:38,heading:0},()=>0);grains=Math.max(grains,bed.grains.length);}
 assert.ok(grains>0);assert.ok(Math.abs(current()-.5)<1e-8);
 for(let i=0;i<120;i++)bed.advance(1/30,still,()=>0);
 assert.equal(bed.grains.length,0);assert.ok(Math.abs(bed.volume()-.5)<1e-8);
 assert.ok([...bed.nodes.values()].some(c=>c.x*BED_CELL>2&&c.h>0));
 const pool=new MaterialBed(material('water'),true);pool.add(0,0,.6,'puddle');
 for(let i=0;i<100;i++)pool.advance(1/30,still,()=>0,(x,z)=>x===1);
 assert.ok([...pool.nodes.values()].every(c=>c.x<1));assert.ok(Math.abs(pool.volume()-.6)<1e-8);
});

test('dunes develop persistent relief through wind transport',()=>{
 const bed=new WindSand(),m=material('sand'),range=()=>Math.max(...bed.bed)-Math.min(...bed.bed),start=range();
 for(let i=0;i<1800;i++)bed.advance(1/60,{speed:32,heading:10},m);
 assert.ok(range()>start+.10);
 // Isolated single-cell pits/peaks across a checkerboard have large alternating
 // curvature. A resolved dune remains smooth relative to its crest-to-trough height.
 let laplace=0;
 for(let i=0;i<bed.bed.length;i++){const x=i%32,z=i-x;laplace+=Math.abs(bed.bed[z+(x+31)%32]+bed.bed[z+(x+1)%32]-2*bed.bed[i]);}
 assert.ok(laplace/bed.bed.length<.12*range());
 const evolved=range();for(let i=0;i<240;i++)bed.advance(1/60,still,m);assert.ok(range()>evolved*.8);
});

test('curved, attached breakers shed varied spray and organic foam independently within each budget',()=>{
 const sea=new WindSea(0,0);sea.breakCrest(0,0,2,1,0);const c=sea.crests[0],age=c.duration*.5;
 const mid=lipPoint(c,.1,.7,age),edge=lipPoint(c,1,.7,age),beside=lipPoint(c,.101,.7,age);
 assert.ok(mid.y>edge.y+.1);assert.ok(Math.hypot(mid.x-beside.x,mid.y-beside.y,mid.z-beside.z)<.01);
 assert.ok(lipPoint(c,-.4,.7,age).x!==lipPoint(c,.4,.7,age).x);
 for(let i=0;i<30;i++)sea.advance(1/120);
 assert.equal(sea.whitewater.count.foam,0);assert.ok(sea.whitewater.count.spray>0);
 sea.organicLoad=1;
 for(let i=0;i<180;i++){if(i%15===0)sea.breakCrest(i*.005,0,1.8,1,0);sea.advance(1/60);}
 const mix=sea.whitewater.particles;assert.ok(mix.length<=384);assert.ok(mix.some(p=>p.kind==='foam'&&p.life>4));
 assert.ok(new Set(mix.map(p=>p.size)).size>45);
 const counts={foam:0,whitewater:0,spray:0};for(const p of mix)counts[p.kind]++;assert.deepEqual(counts,sea.whitewater.count);
 sea.organicLoad=0;sea.advance(1/60);assert.equal(sea.whitewater.count.foam,0);
});

test('legacy materials acquire editable physical relief from properties',()=>{
 const legacy=seedLibrary();for(const m of legacy.materials)for(const k of ['grainDepth','grainLength','grainScale','organicLoad'])delete m[k];
 validateLibrary(legacy);const wood=legacy.materials.find(m=>m.id==='wood'),sand=legacy.materials.find(m=>m.id==='sand');
 assert.ok(wood.grainLength>sand.grainLength&&sand.grainDepth>0);wood.grainDepth=0;
 validateLibrary(legacy);assert.equal(wood.grainDepth,0);
});
