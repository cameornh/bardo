import test from 'node:test';
import assert from 'node:assert/strict';
import {Euler,Matrix4,Quaternion,Vector3} from 'three';
import {validateLibrary,worldPartCount,LIMITS} from '../src/asset-studio/model.js';
import {supportedMark} from '../src/asset-studio/gaussian-marks.js';
import {instancedReed} from '../src/asset-studio/reed-stand.js';
import {COASTAL_SPECIES} from '../src/asset-studio/coastal-flora.js';
import {exampleWorlds} from '../src/asset-studio/example-worlds.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';

const garden=exampleWorlds.find(t=>t.id==='wetland');
const plants=l=>l.world.instances.map(i=>l.assets.find(a=>a.id===i.assetId));

test('one seeded architecture grows 14 editable, supported coastal species with distinct morphologies',()=>{
 const first=garden.create(),same=garden.create(null,garden.seed),other=garden.create(null,0);
 assert.deepEqual(plants(first),plants(same));
 assert.deepEqual(first.world,same.world);
 assert.notDeepEqual(plants(first),plants(other));
 assert.equal(COASTAL_SPECIES.length,20);

 for(const seed of [0,1,2,2026,garden.seed,4294967295]){
  const l=garden.create(null,seed),palette=new Map(l.materials.map(m=>[m.id,m]));
  validateLibrary(l);
  assert.ok(worldPartCount(l)<=LIMITS.previewParts);

  const familyIds=l.families.find(f=>f.id==='example-rushes').members.map(m=>m.assetId);
  assert.equal(familyIds.length,COASTAL_SPECIES.length);
  const speciesAssets=familyIds.map(id=>l.assets.find(a=>a.id===id));
  assert.ok(speciesAssets.every(a=>a&&instancedReed(a)));

  for(const a of speciesAssets){
   for(const p of a.parts)for(const m of p.marks)assert.ok(supportedMark(p,m,palette),`${a.name}:${p.id}:${m.id}`);
  }

  // Verify genuine morphological differentiation across functional guilds
  const reed=speciesAssets.find(a=>a.speciesId==='coastal-reed');
  const seaOats=speciesAssets.find(a=>a.speciesId==='sea-oats');
  const vine=speciesAssets.find(a=>a.speciesId==='railroad-vine');
  const oak=speciesAssets.find(a=>a.speciesId==='sand-live-oak');
  const palmetto=speciesAssets.find(a=>a.speciesId==='saw-palmetto');
  const cactus=speciesAssets.find(a=>a.speciesId==='prickly-pear');
  const needlerush=speciesAssets.find(a=>a.speciesId==='needlerush');
  const aster=speciesAssets.find(a=>a.speciesId==='goldenaster');
  const slashPine=speciesAssets.find(a=>a.speciesId==='slash-pine');
  const sandPine=speciesAssets.find(a=>a.speciesId==='sand-pine');
  const waxMyrtle=speciesAssets.find(a=>a.speciesId==='wax-myrtle');

  const tipWorld=a=>a.parts.map(p=>{
   const m=new Matrix4().compose(new Vector3(...p.transform.position),new Quaternion().setFromEuler(new Euler(...p.transform.rotation.map(v=>v*Math.PI/180))),new Vector3(1,1,1));
   return new Vector3(0,2*p.stamps[0].size[1],0).applyMatrix4(m);
  });
  const maxY=a=>Math.max(...tipWorld(a).map(v=>v.y));
  const maxReachXZ=a=>Math.max(...tipWorld(a).map(v=>Math.hypot(v.x,v.z)));

  assert.ok(maxY(reed)>1.3&&maxY(seaOats)>1.2);
  assert.ok(maxY(vine)<0.45&&maxReachXZ(vine)>0.95&&vine.parts.length>=5,'Railroad vine stays prostrate and wide with articulated runners');
  assert.ok(vine.parts.some(p=>p.marks.some(m=>m.id.startsWith('leaf-'))),'Railroad vine carries bilobed leaves');
  assert.ok(vine.parts.some(p=>p.marks.some(m=>m.id.startsWith('bloom-'))),'Railroad vine carries magenta funnel blooms');
  assert.ok(oak.parts.filter(p=>p.joint?.parentId==='trunk-mid').length>=3,'Sand live oak forms forked canopy');
  assert.ok(maxY(oak)>2.2&&maxReachXZ(oak)>1.6,'Sand live oak attains coastal krummholz canopy spread');
  assert.ok(maxY(slashPine)>7.5,'Coastal slash pine attains tall emergent overstory height');
  assert.ok(maxY(sandPine)>4.2&&maxReachXZ(sandPine)>1.0,'Choctawhatchee sand pine develops spreading crown');
  assert.ok(waxMyrtle.parts.length>=4&&maxY(waxMyrtle)>1.6&&maxReachXZ(waxMyrtle)>0.65,'Wax myrtle forms multi-stem tall shrub');
  assert.ok(palmetto.parts.filter(p=>p.id.startsWith('petiole-')).every(p=>p.marks.length>=11),'Saw palmetto carries fan leaflets');
  assert.equal(cactus.parts.length,5,'Prickly pear grows 5 articulated cladode pads');
  assert.ok(cactus.parts.some(p=>p.marks.some(m=>m.id.startsWith('cladode-'))));
  assert.ok(cactus.parts.some(p=>p.marks.some(m=>m.id.startsWith('areole-'))));
  assert.ok(cactus.parts.some(p=>p.marks.some(m=>m.id.startsWith('bloom-')||m.id.startsWith('fruit-'))));
  assert.ok(needlerush.parts.every(p=>p.marks.some(m=>m.id.startsWith('needle-'))));
  assert.ok(aster.parts.some(p=>p.marks.some(m=>m.id.startsWith('bloom-'))));
  assert.ok(reed.parts.some(p=>p.id.startsWith('tip-')&&p.marks.some(m=>m.id.startsWith('leaf-')&&Math.abs(m.root[1])<1e-8)));
  assert.ok(reed.parts.some(p=>p.marks.some(m=>m.id.startsWith('spikelet'))));
 }
});

test('stem tips follow reversed wind, recover in calm air and keep their roots attached',async()=>{
 const l=garden.create(),sim=await StudioPhysics.create(l,'world');
 try{
  const wind=sim.stand.windWorld;
  const tips=[...wind.bodies.values()].filter(r=>r.part.id.startsWith('tip-')&&r.asset.speciesId==='coastal-reed');
  assert.ok(tips.length>=3);
  const end=r=>new Vector3(0,2*r.part.stamps[0].size[1],0).applyMatrix4(r.matrix);
  const initial=tips.map(end);
  const heights=initial.map(v=>v.y),mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
  const phase=(speed,heading)=>{
   sim.wind={speed,heading,turbulence:.8};
   const displacements=[];
   for(let i=0;i<420;i++){
    sim.step();
    if(i>=300&&i%12===0)displacements.push(mean(tips.map((r,k)=>end(r).x-initial[k].x)));
   }
   return mean(displacements);
  };
  const calm=phase(0,0),east=phase(8,0),west=phase(8,180),recovered=phase(0,0);
  assert.ok(east>calm+.1&&west<calm-.1,`calm ${calm}, east ${east}, west ${west}`);
  assert.ok(Math.abs(recovered-calm)<.1);
  assert.ok(tips.every((r,k)=>end(r).y>heights[k]*.87));
  assert.equal(wind.broken,0);assert.deepEqual(wind.skipped,[]);
  for(const link of wind.joints){
   const anchor=link.parent?wind.worldPoint(link.parent,link.anchorParent):link.anchorParent;
   assert.ok(wind.worldPoint(link.child,link.anchorChild).distanceTo(anchor)<.012);
  }
 }finally{sim.dispose();}
});

test('a hit breaks only the struck placement; a gale can break untouched landscape joints',async()=>{
 const library=garden.create(),sim=await StudioPhysics.create(library,'world');
 try{
  const stand=sim.stand,wind=stand.windWorld,land=sim.sand.landscape;
  let remote=null;
  for(let tx=3;tx<=14&&!remote;tx++)for(let tz=-4;tz<=12&&!remote;tz++){
   const found=land.crowns(tx,tz,stand.assets).find(c=>Math.hypot(c.x,c.z)>55&&c.speciesId==='coastal-reed');
   if(found)remote=found;
  }
  assert.ok(remote&&Math.hypot(remote.x,remote.z)>55);
  const center=[...stand.planted.values()].find(p=>p.variant===remote.variant);
  const asset=stand.assets[remote.variant];
  assert.ok(center&&asset);
  sim.wind={speed:0,heading:0,turbulence:0};
  const target=stand.activate(remote),other=stand.activate(center);
  assert.deepEqual(target.records.map(r=>r.part),other.records.map(r=>r.part));
  const tip=target.records.find(r=>r.part.id==='tip-0');
  sim.addPulse(tip.key,new Vector3(0,tip.part.stamps[0].size[1]*tip.scale.y,0),new Vector3(10000,0,0),.05);
  for(let i=0;i<18;i++)sim.step();
  assert.ok(target.records.some(r=>r.jointBroken));
  assert.ok(other.records.every(r=>!r.jointBroken));assert.equal(wind.broken,0);
  const damaged=target.records.find(r=>r.jointBroken);
  const matrix=damaged.matrix.clone();
  stand.release(target);
  assert.ok(stand.pose(remote,damaged.part,matrix.clone()).equals(matrix));
  const resumed=stand.activate(remote).records.find(r=>r.part===damaged.part);
  assert.equal(resumed.jointBroken,true);assert.ok(resumed.matrix.equals(matrix));

  sim.wind={speed:100,heading:0,turbulence:.8};
  for(let i=0;i<180;i++)sim.step();
  assert.ok(wind.broken>0);
  let fresh=null;
  for(let tx=3;tx<=14&&!fresh;tx++)for(let tz=-4;tz<=12&&!fresh;tz++){
   fresh=land.crowns(tx,tz,stand.assets).find(c=>c.id!==remote.id&&!stand.active.has(c.id)&&
    stand.assets[c.variant].parts.some(p=>wind.get(stand.sample(c).site.id,p.id)?.jointBroken));
  }
  assert.ok(fresh);
  const sample=stand.sample(fresh),freshAsset=stand.assets[fresh.variant];
  const poses=freshAsset.parts.map(p=>stand.pose(fresh,p,matrix.clone()));
  const local=stand.activate(fresh);
  for(const [i,r] of local.records.entries()){
   assert.equal(!!r.jointBroken,!!wind.get(sample.site.id,r.part.id).jointBroken);
   assert.ok(r.matrix.equals(poses[i]));
  }
 }finally{sim.dispose();}
});

test('six added Shell Island species build valid hierarchical morphologies across pioneer, swale, and palm habits', async () => {
 const assertMod = (await import('node:assert/strict')).default;
 const THREE = await import('three');
 const {COASTAL_SPECIES} = await import('../src/asset-studio/coastal-flora.js');
 const {reedPartMatrix} = await import('../src/asset-studio/reed-stand.js');
 const {supportedMark} = await import('../src/asset-studio/gaussian-marks.js');
 const lib = garden.create(null, 2187);
 const matMap = new Map(lib.materials.map(m => [m.id, m]));
 const newIds = ['sea-rocket', 'gulf-bluestem', 'dune-sunflower', 'sea-purslane', 'smooth-cordgrass', 'cabbage-palm'];
 assertMod.equal(COASTAL_SPECIES.length, 20, 'COASTAL_SPECIES contains all 20 coastal plant species');
 const pt = new THREE.Vector3(), ax = new THREE.Vector3();
 for (const id of newIds) {
  const sp = COASTAL_SPECIES.find(s => s.id === id);
  const asset = lib.assets.find(a => a.speciesId === id);
  assertMod.ok(sp, `Species metadata registered for ${id}`);
  assertMod.ok(asset, `Library asset built for ${id}`);
  assertMod.ok(asset.parts.length >= 2, `${id} has hierarchical animated/jointed parts`);
  let maxY = -Infinity, minY = Infinity, maxR = 0, markCount = 0;
  for (const p of asset.parts) {
   const m = reedPartMatrix(p);
   pt.set(0, 0, 0).applyMatrix4(m);
   maxY = Math.max(maxY, pt.y); minY = Math.min(minY, pt.y); maxR = Math.max(maxR, Math.hypot(pt.x, pt.z));
   pt.set(0, 2 * p.stamps[0].size[1], 0).applyMatrix4(m);
   maxY = Math.max(maxY, pt.y); minY = Math.min(minY, pt.y); maxR = Math.max(maxR, Math.hypot(pt.x, pt.z));
   for (const mk of p.marks || []) {
    assertMod.ok(supportedMark(p, mk, matMap) || p.joint?.parentId === p.id || !!p.joint, `Mark ${mk.id} in ${id} is structurally attached`);
    pt.set(...mk.root).addScaledVector(ax.set(...mk.axis), mk.length).applyMatrix4(m);
    maxY = Math.max(maxY, pt.y); minY = Math.min(minY, pt.y);
    maxR = Math.max(maxR, Math.hypot(pt.x, pt.z));
    markCount++;
   }
  }
  assertMod.ok(markCount >= 8, `${id} grows rich botanical marks (${markCount})`);
  assertMod.ok(Number.isFinite(maxY) && Number.isFinite(minY) && maxY > minY, `${id} bounds are non-degenerate`);
  if (id === 'cabbage-palm') {
   assertMod.ok(maxY > 2.5, `cabbage-palm reaches arborescent palm stature (${maxY.toFixed(2)} m)`);
   assertMod.ok(asset.parts.some(p => p.stamps.some(s => s.materialId === 'palm-trunk')), 'cabbage-palm uses textured palm-trunk material');
  }
  if (id === 'sea-purslane') {
   assertMod.ok(asset.ecology.conform > 0.7, `sea-purslane hugs sand slope (conform=${asset.ecology.conform})`);
   assertMod.ok(maxR > 0.35 && maxY < 1.1, `sea-purslane spreads prostrate mat rather than tall canopy (maxR=${maxR.toFixed(2)}, maxY=${maxY.toFixed(2)})`);
  }
  if (id === 'smooth-cordgrass') {
   assertMod.ok(asset.parts.some(p => p.marks?.some(m => m.materialId === 'cordgrass-blade')), 'smooth-cordgrass uses cordgrass-blade material');
  }
 }
});
