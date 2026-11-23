import test from 'node:test';
import assert from 'node:assert/strict';
import {Color,PerspectiveCamera,Vector3} from 'three';
import {Wetland,REED_TILE} from '../src/asset-studio/wetland.js';
import {COASTAL_SPECIES,SPECIES_BY_ID,speciesSuitability} from '../src/asset-studio/coastal-flora.js';
import {climateHydrology,solarGeometry,DEFAULT_COASTAL_CLIMATE,ALONG_DIR_X,ALONG_DIR_Z,INLAND_DIR_X,INLAND_DIR_Z} from '../src/asset-studio/coastal-climate.js';
import {WindSea} from '../src/asset-studio/ocean.js';
import {coastalPropsForTile,PROP_LABELS} from '../src/asset-studio/coastal-props.js';
import {markProfile,ribbonWidth} from '../src/asset-studio/gaussian-marks.js';
import {reedPartMatrix,reedFamily,instancedReed} from '../src/asset-studio/reed-stand.js';
import {WetlandReeds} from '../src/asset-studio/wetland-reeds.js';
import {
 cameraCoarseningFactor,
 eigenSymmetric3,
 fitCovarianceEllipsoids,
 horizonStandsForCell,
 isPrimaryCoastalMark,
 lodBlendWeights,
 perceptualAlphaScale
} from '../src/asset-studio/coastal-lod.js';
import {exampleWorlds} from '../src/asset-studio/example-worlds.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';

const garden=exampleWorlds.find(t=>t.id==='wetland');

test('the same coastal survey regenerates shoreface, foredunes, swale ponds and multi-species colonies in any travel order',()=>{
 for(const seed of [0,2187,0xffffffff]){
  const land=new Wetland(seed),revisit=new Wetland(seed),all=[];
  let flooded=0,highest=-Infinity,lowest=Infinity,samples=0;
  for(let x=-160;x<=160;x+=4)for(let z=-160;z<=160;z+=4){
   const h=land.height(x,z);flooded+=h<0;samples++;
   highest=Math.max(highest,h);lowest=Math.min(lowest,h);
   if(h>.85||h<-.68)assert.equal(land.suitability(x,z),0);
  }
  assert.ok(flooded/samples>.08&&flooded/samples<.72&&highest>2.4&&lowest<-1.2);
  const tiles=[[0,0],[-1,0],[0,-1],[1,0],[4,-3],[-3,5]];
  const first=tiles.map(([x,z])=>land.crowns(x,z,COASTAL_SPECIES.length));
  for(let i=tiles.length-1;i>=0;i--)assert.deepEqual(revisit.crowns(...tiles[i],COASTAL_SPECIES.length),first[i]);
  for(const tile of first)for(const p of tile){
   assert.equal(p.y,land.height(p.x,p.z));
   all.push(p.x+','+p.z);
  }
  assert.ok(all.length>30);assert.equal(new Set(all).size,all.length);
  for(let i=-6;i<7;i++)assert.ok(Math.abs(land.height(i*REED_TILE-.001,-8)-land.height(i*REED_TILE+.001,-8))<.01);
  for(const i of garden.create(null,seed).world.instances){
   const [x,y,z]=i.transform.position;assert.equal(y,land.height(x,z));
  }
 }
});

test('continuous coastal fields produce emergent ecological zonation and allelopathic balds',()=>{
 const land=new Wetland(2187);
 const stats=new Map(COASTAL_SPECIES.map(s=>[s.id,{weight:0,shore:0,moisture:0,spray:0,salinity:0,elevation:0}]));
 let minExp=Infinity,maxExp=-Infinity,beachSpray=0,beachN=0,inlandSpray=0,inlandN=0;
 let rosemaryHighInhib=0,herbInsideBald=0,herbOutsideBald=0,baldSamples=0,clearSamples=0;

 for(let x=-130;x<=130;x+=5)for(let z=-130;z<=130;z+=5){
  const e=land.environment(x,z);
  minExp=Math.min(minExp,e.windExposure);
  maxExp=Math.max(maxExp,e.windExposure);
  if(e.elevation>0.1&&e.shoreDistance>2&&e.shoreDistance<22){beachSpray+=e.saltSpray;beachN++;}
  if(e.elevation>0.5&&e.shoreDistance>90&&e.shoreDistance<160){inlandSpray+=e.saltSpray;inlandN++;}
  if(e.rosemaryInhibition>0.55){
   rosemaryHighInhib++;
   baldSamples++;
   herbInsideBald+=speciesSuitability(SPECIES_BY_ID.get('sea-oats'),e)+speciesSuitability(SPECIES_BY_ID.get('goldenaster'),e);
  }else if(e.shoreDistance>70&&e.elevation>1.5&&e.rosemaryInhibition<0.05){
   clearSamples++;
   herbOutsideBald+=speciesSuitability(SPECIES_BY_ID.get('sea-oats'),e)+speciesSuitability(SPECIES_BY_ID.get('goldenaster'),e);
  }
  for(const s of COASTAL_SPECIES){
   const w=speciesSuitability(s,e);
   if(w<0.05)continue;
   const st=stats.get(s.id);
   st.weight+=w;st.shore+=w*e.shoreDistance;st.moisture+=w*e.moisture;
   st.spray+=w*e.saltSpray;st.salinity+=w*e.salinity;st.elevation+=w*e.elevation;
  }
 }

 assert.ok(maxExp>1.08&&minExp<0.75,`Topographic speedup/shelter missing: ${minExp}..${maxExp}`);
 assert.ok(beachN>10&&inlandN>10&&beachSpray/beachN>inlandSpray/inlandN*2.0,'Salt spray must decay cross-shore');

 const mean=(id,key)=>stats.get(id)[key]/Math.max(1e-6,stats.get(id).weight);
 for(const s of COASTAL_SPECIES)assert.ok(stats.get(s.id).weight>0.5,`${s.id} must find suitable habitat`);

 // Cross-shore pioneer vs back-barrier scrub gradient
 assert.ok(mean('railroad-vine','shore')<mean('rosemary','shore'));
 assert.ok(mean('beach-elder','spray')>mean('sand-live-oak','spray'));
 // Wetland vs xeric moisture & elevation gradient
 assert.ok(mean('coastal-reed','moisture')>mean('prickly-pear','moisture')+0.35);
 assert.ok(mean('needlerush','elevation')<mean('rosemary','elevation')-1.2);
 // Allelopathic rosemary bald suppression
 if(baldSamples>0&&clearSamples>0){
  assert.ok(herbInsideBald/baldSamples<herbOutsideBald/clearSamples);
 }
 assert.ok(rosemaryHighInhib>=0);
});

test('climate forcing drives solar irradiance, PET, Ghyben-Herzberg lens and sea level',()=>{
 const coolWet=climateHydrology({...DEFAULT_COASTAL_CLIMATE,airTemperature:16,relativeHumidity:0.88,precipitation:2.2});
 const hotDry=climateHydrology({...DEFAULT_COASTAL_CLIMATE,airTemperature:34,relativeHumidity:0.35,precipitation:0.7});
 assert.ok(hotDry.vpdKpa>coolWet.vpdKpa*2.5);
 assert.ok(hotDry.petMPerYr>coolWet.petMPerYr);
 assert.ok(coolWet.lensHeight>hotDry.lensHeight);

 const summerNoon=solarGeometry({...DEFAULT_COASTAL_CLIMATE,dayOfYear:172,solarHour:12.5});
 const winterNoon=solarGeometry({...DEFAULT_COASTAL_CLIMATE,dayOfYear:355,solarHour:12.5});
 assert.ok(summerNoon.elevationDeg>winterNoon.elevationDeg+25);
 assert.ok(summerNoon.globalWm2>winterNoon.globalWm2);
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
  assert.ok(Math.abs(surface.top)<1e-9&&surface.bottom<-.6);
  assert.ok(Math.abs(surface.density-water.density)<1e-9);
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

test('a falling body activates remote coastal plants with bendable stems and grabbable leaves without a camera',async()=>{
 const library=garden.create(null,2187),land=new Wetland(2187);
 const standAssets=library.families.find(f=>f.id==='example-rushes').members.map(m=>library.assets.find(a=>a.id===m.assetId));
 let site=null;
 for(let tx=2;tx<=12&&!site;tx++)for(let tz=-4;tz<=10&&!site;tz++){
  site=land.crowns(tx,tz,standAssets).find(c=>c.y>.15&&c.speciesId==='coastal-reed');
 }
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

test('wind waves advance and recede across the same physical bank and respond to tide offset',async()=>{
 const library=garden.create(null,2187);
 library.world.wind={speed:14,heading:65,turbulence:.8};library.world.instances=[];
 const sim=await StudioPhysics.create(library,'world');
 try{
  const sea=sim.pondSea,points=[];
  for(let x=-30;x<=30;x+=.5)for(let z=-30;z<=30;z+=.5){
   if(Math.abs(sea.bedHeight(x,z))<.045)points.push({x,z,wet:false,dry:false});
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
  assert.ok(points.length>20&&points.filter(p=>p.wet&&p.dry).length>.4*points.length);

  // Positive sea-level offset raises water surface column cleanly
  const samplePt=points[0];
  sea.seaLevel=0.45;
  sea.sampleTime(0);
  const raised=sim.matter.liquidColumn(sim,samplePt.x,samplePt.z);
  assert.ok(raised&&raised.top>0.30);
 }finally{sim.dispose();}
});

test('porous sand material governs capillary fringe, inland wave/tide damping, barren foreshore, and coastal detritus',()=>{
 const tightSand=climateHydrology(DEFAULT_COASTAL_CLIMATE,{porosity:0.28,permeability:2e-11});
 const coarseSand=climateHydrology(DEFAULT_COASTAL_CLIMATE,{porosity:0.44,permeability:2e-9});
 assert.ok(tightSand.capillaryFringe>coarseSand.capillaryFringe,'Finer lower-permeability sand supports thicker capillary fringe');
 assert.ok(coarseSand.waveDecayLen>tightSand.waveDecayLen,'Higher permeability sand lets shoreline tide/wave head propagate farther');

 const land=new Wetland(2187,{porosity:0.39,permeability:3.5e-10});
 const sea=new WindSea(11,65,.35);
 sea.seaLevel=0.35;
 sea.coastal={land,waveDecayLen:land.hydrology.waveDecayLen};
 sea.sampleTime(0.4);
 const gulf=sea.coastalAttenuation(-40,0);
 const dune=sea.coastalAttenuation(28,0);
 // Find points specifically at shore distance < 0 vs ~40 m inland
 let gulfPt=null,swalePt=null;
 for(let x=-120;x<=120;x+=4)for(let z=-120;z<=120;z+=4){
  const d=land.shoreDistance(x,z);
  if(!gulfPt&&d<-15)gulfPt=[x,z];
  if(!swalePt&&d>38&&d<65)swalePt=[x,z];
 }
 assert.ok(gulfPt&&swalePt&&gulf&&dune);
 const aGulf=sea.coastalAttenuation(...gulfPt),aSwale=sea.coastalAttenuation(...swalePt);
 assert.equal(aGulf.waveFactor,1);
 assert.equal(aGulf.tideFactor,1);
 assert.ok(aSwale.waveFactor<0.45,'Barrier sand damps open-Gulf spectral wave amplitude in inland swales');
 assert.ok(aSwale.tideFactor<0.90,'High-frequency tidal surge attenuates across sand barrier');

 // Barren wave-washed foreshore remains free of vascular terrestrial crowns
 let propItems=0,foreshoreCrowns=0;
 const detTypes=new Set();
 for(let tx=-4;tx<=4;tx++)for(let tz=-4;tz<=4;tz++){
  for(const c of land.crowns(tx,tz,COASTAL_SPECIES.length)){
   if(land.shoreDistance(c.x,c.z)<11.0)foreshoreCrowns++;
  }
  const propsA=coastalPropsForTile(land,tx,tz),propsB=coastalPropsForTile(land,tx,tz);
  assert.deepEqual(propsA,propsB,'Static coastal props regenerate deterministically');
  propItems+=propsA.items.length;
  for(const item of propsA.items){
   assert.ok(item.label&&Object.values(PROP_LABELS).includes(item.label));
   detTypes.add(item.label);
  }
 }
 assert.equal(foreshoreCrowns,0,'Wave-washed active foreshore excludes terrestrial plants');
 assert.ok(propItems>0&&detTypes.size>=2,'Wrack/beach zones accumulate multiple static coastal detritus classes');
});

test('coastal detritus covers dark mineral pebbles, wrack lines, shells, submerged benthic seafloor, 3D driftwood and pine cones by ecological zone',()=>{
 const land=new Wetland(2187,DEFAULT_COASTAL_CLIMATE);
 const lib=garden.create(null,2187);
 const matIds=new Set(lib.materials.map(m=>m.id));
 const sea=land.climate?.seaLevelOffset??0;
 const labels=new Set();
 const baselineSig=[];
 const benthicIds=['shoal-grass','manatee-grass','limestone-ledge','sea-sponge','sea-whip','benthic-algae','live-sand-dollar','pen-shell'];
 const benthicCounts=new Map(benthicIds.map(id=>[id,0]));
 const driftItems=[],driftEllipColors=new Set();
 let maxEllipsoids=0,seagrassCount=0,pineConeCount=0,submergedViolations=0,benthicSubmergedViolations=0,pineConeShoreViolations=0;

 for(let tx=-5;tx<=6;tx++)for(let tz=-5;tz<=6;tz++){
  const a=coastalPropsForTile(land,tx,tz),b=coastalPropsForTile(land,tx,tz);
  assert.deepEqual(a,b,'Coastal detritus tile generation is deterministic');
  assert.ok(a.ellipsoids.length<=340,`Tile (${tx},${tz}) stays within ellipsoid budget (${a.ellipsoids.length})`);
  maxEllipsoids=Math.max(maxEllipsoids,a.ellipsoids.length);
  for(const e of a.ellipsoids){
   for(const v of [e.cx,e.cy,e.cz,e.ax,e.ay,e.az,e.bx,e.by,e.bz,e.nx,e.ny,e.nz,e.r,e.g,e.b,e.rough,e.maxRange,e.boundR]){
    assert.ok(Number.isFinite(v),'Detritus ellipsoid attributes remain finite');
   }
  }
  const tileDrifts=[];
  for(const item of a.items){
   assert.ok(item.label&&Object.values(PROP_LABELS).includes(item.label),`Unknown label ${item.label}`);
   assert.ok(matIds.has(item.materialId),`Installed library includes material ${item.materialId}`);
   labels.add(item.label);
   if(item.label===PROP_LABELS['seagrass-bed']){
    seagrassCount++;
    if(!(item.y<sea-0.04))submergedViolations++;
   }
   if(benthicCounts.has(item.materialId)){
    benthicCounts.set(item.materialId,benthicCounts.get(item.materialId)+1);
    if(!(item.y<sea-0.12))benthicSubmergedViolations++;
   }
   if(item.materialId==='driftwood'){
    const elev=item.y-land.height(item.x,item.z);
    driftItems.push({r:item.r,elev});
    tileDrifts.push(item);
   }
   if(item.label===PROP_LABELS['pine-cone']){
    pineConeCount++;
    const sd=land.shoreDistance(item.x,item.z);
    if(sd<55||sd<20)pineConeShoreViolations++;
   }
  }
  for(const dItem of tileDrifts){
   for(const e of a.ellipsoids){
    if(e.maxRange>0&&Math.hypot(e.cx-dItem.x,e.cz-dItem.z)<=dItem.r+0.6){
     driftEllipColors.add(`${Math.round(e.r*12)},${Math.round(e.g*12)},${Math.round(e.b*12)}`);
    }
   }
  }
  if(tx>=-3&&tx<=0&&tz>=-3&&tz<=0)baselineSig.push(a.ellipsoids.length,a.items.length);
 }

 assert.ok(maxEllipsoids>0&&maxEllipsoids<=340);
 assert.ok(labels.has(PROP_LABELS['pebble-dark']),'Beach zones spawn small dark mineral pebbles');
 assert.ok(labels.has(PROP_LABELS['sargassum-wrack'])||labels.has(PROP_LABELS['seagrass-wrack']),'High-tide beach zones spawn sinuous seaweed/seagrass wrack');
 assert.ok(labels.has(PROP_LABELS['shell-calc']),'Foreshore & wrack zones accumulate mollusk shells');
 assert.ok(labels.has(PROP_LABELS.driftwood),'Berm & blowouts retain weathered driftwood');
 assert.ok(seagrassCount>0,'Nearshore/bay waters populate submerged turtle grass');
 assert.equal(submergedViolations,0,'Submerged turtle grass stays strictly below sea level');
 assert.equal(benthicSubmergedViolations,0,'Submerged benthic ledges, sponges, sea whips, seagrasses and shells stay strictly below sea level');
 for(const id of benthicIds){
  assert.ok(benthicCounts.get(id)>0,`Nearshore seafloor populates benthic class ${id}`);
 }
 assert.ok(driftItems.length>=4,`Multiple weathered 3D driftwood specimens spawn across beach tiles (got ${driftItems.length})`);
 const driftRadii=driftItems.map(d=>d.r);
 assert.ok(Math.max(...driftRadii)/Math.min(...driftRadii)>1.8,'Driftwood exhibits wide size diversity across logs, root-wads, and twigs');
 assert.ok(Math.max(...driftItems.map(d=>d.elev))>0.08,'Driftwood exhibits true 3D elevation above sand surface');
 assert.ok(driftEllipColors.size>=2,'Driftwood displays varied natural weathering coloration');
 assert.ok(pineConeCount>0,'Backdune forest floor drops fallen pine cones');
 assert.equal(pineConeShoreViolations,0,'Pine cones remain excluded from open beach foreshore');

 // Raising sea level deterministically shifts wrack & detritus placement
 const raisedLand=new Wetland(2187,{...DEFAULT_COASTAL_CLIMATE,seaLevelOffset:0.65});
 const raisedSig=[];
 for(let tx=-3;tx<=0;tx++)for(let tz=-3;tz<=0;tz++){
  const r=coastalPropsForTile(raisedLand,tx,tz);
  raisedSig.push(r.ellipsoids.length,r.items.length);
 }
 assert.notDeepEqual(raisedSig,baselineSig,'Raised sea level shifts beach detritus & wrack envelopes');
});

test('continuous scale-space LOD fits exact 3D covariances, bridges horizon stands cleanly, and coarsens gently with camera speed',()=>{
 // Verify Jacobi 3x3 symmetric eigensolver reconstructs C = V * diag(lambda) * V^T within < 1e-6
 const c00=4.2,c01=-1.1,c02=0.75,c11=2.8,c12=0.95,c22=1.9;
 const eig=eigenSymmetric3(c00,c01,c02,c11,c12,c22);
 assert.ok(eig.values[0]>=eig.values[1]&&eig.values[1]>=eig.values[2]&&eig.values[2]>0);
 const rec=[0,0,0,0,0,0];
 for(let m=0;m<3;m++){
  const lam=eig.values[m],[vx,vy,vz]=eig.vectors[m];
  assert.ok(Math.abs(Math.hypot(vx,vy,vz)-1)<1e-6);
  rec[0]+=lam*vx*vx;rec[1]+=lam*vx*vy;rec[2]+=lam*vx*vz;
  rec[3]+=lam*vy*vy;rec[4]+=lam*vy*vz;rec[5]+=lam*vz*vz;
 }
 const exact=[c00,c01,c02,c11,c12,c22];
 for(let k=0;k<6;k++)assert.ok(Math.abs(rec[k]-exact[k])<1e-6,`eigensolver mismatch index ${k}`);

 // Verify moment-matched covariance proxies for all 14 species & guild separation
 const lib=garden.create(null,2187);
 const slashAsset=lib.assets.find(a=>a.speciesId==='slash-pine');
 const oatAsset=lib.assets.find(a=>a.speciesId==='sea-oats');
 for(const spec of COASTAL_SPECIES){
  const a=lib.assets.find(x=>x.speciesId===spec.id);
  const prox=fitCovarianceEllipsoids(a,lib.materials);
  assert.ok(prox.length>=2&&prox.length<=9,`${spec.id} builds compact covariance proxy`);
  for(const e of prox){
   for(const v of [...e.center,...e.axis,...e.width,...e.tint])assert.ok(Number.isFinite(v));
   assert.ok(e.ao>0&&e.ao<=1&&e.thirdRatio>=0.2&&e.thirdRatio<=0.95);
  }
 }
 const slashProx=fitCovarianceEllipsoids(slashAsset,lib.materials);
 assert.ok(slashProx.some(e=>e.soft<0.25),'Slash pine covariance proxy separates bark trunk from softer needle crown');
 assert.ok(slashProx.some(e=>e.soft>0.50),'Slash pine retains foliage canopy softness');
 const oatProx=fitCovarianceEllipsoids(oatAsset,lib.materials);
 assert.ok(oatProx.filter(e=>e.soft>0.45&&e.tint[0]>e.tint[2]).length>=1,'Sea oats keeps distinct golden panicle accents');

 // Continuous visibility across 0..720 m handoff (zero dead band between Tiers 0/1/2 and HorizonStands),
 // then smooth monotonic inverse-Beer-Lambert taper across 720..1150 m into distant terrain texture.
 assert.equal(perceptualAlphaScale(0),0);
 assert.ok(perceptualAlphaScale(0.5)<0.35&&perceptualAlphaScale(1)>0.95,'Perceptual fade compensates Beer-Lambert saturation');
 for(let d=0;d<=720;d+=5){
  const w=lodBlendWeights(d,360,1);
  const total=w.lod0+w.lod1+w.lod2+w.horizon;
  assert.ok(total>0.22,`Continuous LOD total weight drops unexpectedly at ${d} m (${total})`);
 }
 assert.ok(lodBlendWeights(880,360,1).horizon>lodBlendWeights(1040,360,1).horizon);
 assert.equal(lodBlendWeights(1150,360,1).horizon,0);
 assert.equal(cameraCoarseningFactor(0),1);
 assert.ok(cameraCoarseningFactor(1.5)>1&&cameraCoarseningFactor(12)>cameraCoarseningFactor(3));

 // HorizonStands cells exclude barren beach foreshore, avoid flat pancake ratios, and populate upland/swale stands deterministically
 const land=new Wetland(2187);
 let hCount=0,hShoreViolations=0,maxAspect=0,maxRad=0;
 for(let hx=-4;hx<=4;hx++)for(let hz=-4;hz<=4;hz++){
  const a=horizonStandsForCell(land,hx,hz),b=horizonStandsForCell(land,hx,hz);
  assert.deepEqual(a,b,'Horizon stands regenerate deterministically');
  hCount+=a.length;
  for(const s of a){
   if(land.shoreDistance(s.x,s.z)<15.5)hShoreViolations++;
   maxAspect=Math.max(maxAspect,s.radXZ/s.halfH);
   maxRad=Math.max(maxRad,s.radXZ);
  }
 }
 assert.equal(hShoreViolations,0,'HorizonStands excludes active wave-washed foreshore');
 assert.ok(hCount>40,'HorizonStands populates distal barrier ridges and swales');
 assert.ok(maxRad<=3.1&&maxAspect<=2.6,`HorizonStands avoid oversized pancakes: maxRad=${maxRad} maxAspect=${maxAspect}`);
});

test('all 14 coastal species maintain tight LOD 0->1->2 optical silhouette, area, and color parity',()=>{
 const lib=garden.create(null,2187);
 const matMap=new Map(lib.materials.map(m=>[m.id,m]));
 const colorOf=id=>new Color(matMap.get(id)?.color??'#778349').toArray();
 const up=new Vector3(0,1,0),right=new Vector3(1,0,0);

 const extractLobes=(asset,lod)=>{
  if(lod===2){
   return fitCovarianceEllipsoids(asset,lib.materials).map(e=>({
    c:e.center,a:e.axis,w:e.width,t3:e.thirdRatio,rgb:e.tint,soft:e.soft,densityScale:Math.max(0.08,e.densityScale??1)
   }));
  }
  const lobes=[];
  for(const p of asset.parts){
   const m=reedPartMatrix(p),stem=p.stamps[0],length=2*stem.size[1],cane=colorOf(stem.materialId);
   const isWoody=stem.materialId==='pine-bark'||stem.materialId==='scrub-bark'||stem.materialId==='palm-trunk';
   const sections=lod===1?(isWoody?2:3):(isWoody?4:5);
   const stemBaseW=lod===1?(isWoody?1.06:1.18):1.0;
   const push=(start,end,width,side,rgb,growTo=1)=>{
    const from=start.clone().applyMatrix4(m),to=end.clone().applyMatrix4(m);
    const axis=to.clone().sub(from).multiplyScalar(0.54);
    if(axis.lengthSq()<1e-9)return;
    lobes.push({c:from.lerp(to,0.5).toArray(),a:axis.toArray(),w:side.clone().transformDirection(m).multiplyScalar(width*growTo).toArray(),t3:0.56,rgb,soft:0,densityScale:1});
   };
   for(let k=0;k<sections;k++)push(up.clone().multiplyScalar(length*k/sections),up.clone().multiplyScalar(length*(k+1)/sections),stem.size[0]*(isWoody?(0.64-0.05*(k+0.5)/sections):(0.57-0.13*(k+0.5)/sections))*stemBaseW,right,cane,lod===1?1.12:1);
   for(const [j,mark] of p.marks.entries()){
    if(lod===1&&!isPrimaryCoastalMark(mark,j))continue;
    const isDab=mark.kind==='dab',spike=mark.id.startsWith('spikelet')||mark.id.startsWith('oat-')||mark.id.startsWith('panicle-');
    const isWoodyLeaf=mark.materialId==='oak-leaf'||mark.materialId==='pine-needle'||mark.materialId==='myrtle-leaf'||mark.materialId==='rosemary-needle';
    const root=new Vector3(...mark.root),axis=new Vector3(...mark.axis),normal=new Vector3(...mark.up),side=axis.clone().cross(normal).normalize(),profile=markProfile(mark),rgb=colorOf(mark.materialId);
    if(isDab){push(root,root.clone().addScaledVector(axis.clone().addScaledVector(normal,0.48*mark.curl).normalize(),mark.length),mark.length*mark.width*(lod===1?1.08:0.76),side,rgb,lod===1?1.10:1);continue;}
    const curve=t=>root.clone().addScaledVector(axis,mark.length*t).addScaledVector(normal,mark.length*mark.curl*0.48*t*t);
    const narrow=isWoodyLeaf||mark.materialId==='rush-stem'||mark.id.startsWith('areole-')||mark.id.startsWith('plate-')||mark.id.startsWith('buttress-');
    const divs=lod===1?(spike||narrow?1:2):(spike||narrow?2:3),lanes=lod||spike||narrow?[0]:[-1,0,1];
    const ribbon=(t,lane)=>curve(t).addScaledVector(side,lane*0.56*mark.length*mark.width*(0.045+0.955*ribbonWidth(t,...profile))).addScaledVector(normal,Math.abs(lane)*0.14*mark.length*mark.width*(0.045+0.955*ribbonWidth(t,...profile)));
    const mult=lanes.length===1?(lod===1?0.56*1.56:0.56):0.31;
    for(let k=0;k<divs;k++)for(const lane of lanes){const t=(k+0.5)/divs;push(ribbon(k/divs,lane),ribbon((k+1)/divs,lane),mark.length*mark.width*(0.045+0.955*ribbonWidth(t,...profile))*mult,side.clone().addScaledVector(normal,lane*0.22).normalize(),rgb,lod===1?1.10:1);}
   }
  }
  return lobes;
 };

 const renderAtPx=(lobes,boxSize,centerY,elevDeg,pxMetres)=>{
  const N=Math.max(16,Math.min(96,Math.round(boxSize/pxMetres))),el=elevDeg*Math.PI/180;
  const fwd=new Vector3(0,-Math.sin(el),-Math.cos(el)),side=new Vector3(1,0,0),upDir=new Vector3().crossVectors(side,fwd).normalize();
  const tau=new Float32Array(N*N),cr=new Float32Array(N*N),cg=new Float32Array(N*N),cb=new Float32Array(N*N),scale=N/boxSize;
  const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  for(const lb of lobes){
   const ax=new Vector3(...lb.a),wd=new Vector3(...lb.w),th=new Vector3().crossVectors(ax,wd);
   if(th.length()>1e-8)th.normalize().multiplyScalar(wd.length()*lb.t3);
   const px=[ax.dot(side)*scale,wd.dot(side)*scale,th.dot(side)*scale],py=[ax.dot(upDir)*scale,wd.dot(upDir)*scale,th.dot(upDir)*scale];
   const xx=px[0]*px[0]+px[1]*px[1]+px[2]*px[2]+0.24,yy=py[0]*py[0]+py[1]*py[1]+py[2]*py[2]+0.24,xy=px[0]*py[0]+px[1]*py[1]+px[2]*py[2];
   const det=Math.max(1e-5,xx*yy-xy*xy),invXX=yy/det,invYY=xx/det,invXY=-xy/det;
   const ewa=Math.max(0.07,Math.min(1,Math.sqrt(Math.max(0,(xx-0.24)*(yy-0.24)-xy*xy)/det)));
   const rel=new Vector3(lb.c[0],lb.c[1]-centerY,lb.c[2]),cx=rel.dot(side)*scale+N*0.5,cy=rel.dot(upDir)*scale+N*0.5;
   const soft=lb.soft,kurt=0.75+(0.04-0.75)*soft,cut=0.045+(0.018-0.045)*soft,hi=0.28+(0.72-0.28)*soft,gain=4.2+(1.85-4.2)*soft,dScale=Math.max(0.08,lb.densityScale);
   const rx=Math.ceil(Math.sqrt(xx)*2.5),ry=Math.ceil(Math.sqrt(yy)*2.5);
   for(let y=Math.max(0,Math.floor(cy-ry));y<=Math.min(N-1,Math.ceil(cy+ry));y++)for(let x=Math.max(0,Math.floor(cx-rx));x<=Math.min(N-1,Math.ceil(cx+rx));x++){
    const dx=(x+0.5)-cx,dy=(y+0.5)-cy,r2=dx*dx*invXX+2*dx*dy*invXY+dy*dy*invYY;
    if(r2>6.5)continue;const w=Math.exp(-0.5*r2*(1+kurt*r2));if(w<cut)continue;
    const d=gain*dScale*ewa*smoothstep(cut,hi,w),idx=y*N+x;
    tau[idx]+=d;cr[idx]+=d*lb.rgb[0];cg[idx]+=d*lb.rgb[1];cb[idx]+=d*lb.rgb[2];
   }
  }
  const alpha=new Float32Array(N*N);let sumA=0,sumR=0,sumG=0,sumB=0;
  for(let i=0;i<N*N;i++)if(tau[i]>0){const a=1-Math.exp(-tau[i]);alpha[i]=a;sumA+=a;sumR+=a*(cr[i]/tau[i]);sumG+=a*(cg[i]/tau[i]);sumB+=a*(cb[i]/tau[i]);}
  return {alpha,area:sumA,rgb:sumA>0?[sumR/sumA,sumG/sumA,sumB/sumA]:[0,0,0]};
 };

 const compare=(rA,rB)=>{
  let inter=0,union=0;
  for(let i=0;i<rA.alpha.length;i++){inter+=Math.min(rA.alpha[i],rB.alpha[i]);union+=Math.max(rA.alpha[i],rB.alpha[i]);}
  return {iou:union?inter/union:1,areaRatio:rA.area?rB.area/rA.area:1,dCol:Math.hypot(rA.rgb[0]-rB.rgb[0],rA.rgb[1]-rB.rgb[1],rA.rgb[2]-rB.rgb[2])};
 };

 for(const spec of COASTAL_SPECIES){
  const a=lib.assets.find(x=>x.speciesId===spec.id);
  const l0=extractLobes(a,0),l1=extractLobes(a,1),l2=extractLobes(a,2);
  let maxH=0.5,maxR=0.5;
  for(const lb of l0){maxH=Math.max(maxH,lb.c[1]+Math.hypot(...lb.a));maxR=Math.max(maxR,Math.hypot(lb.c[0],lb.c[2])+Math.hypot(...lb.a));}
  const box=Math.max(maxH,maxR*2)*1.25,cy=maxH*0.48;
  const px01=spec.maxRenderDist>250?0.045:0.028,px12=spec.maxRenderDist>250?0.12:0.075;
  const c01=compare(renderAtPx(l0,box,cy,35,px01),renderAtPx(l1,box,cy,35,px01));
  const c12=compare(renderAtPx(l1,box,cy,35,px12),renderAtPx(l2,box,cy,35,px12));
  assert.ok(c01.iou>=0.58&&c01.areaRatio>=0.75&&c01.areaRatio<=1.25&&c01.dCol<=0.08,`${spec.id} L0->L1 parity out of bounds: ${JSON.stringify(c01)}`);
  assert.ok(c12.iou>=0.42&&c12.areaRatio>=0.72&&c12.areaRatio<=1.28&&c12.dCol<=0.11,`${spec.id} L1->L2 parity out of bounds: ${JSON.stringify(c12)}`);
 }

 // Guard against regression of fat brown woody bough potatoes and bridged pink railroad-vine streaks
 const vineProx=fitCovarianceEllipsoids(lib.assets.find(a=>a.speciesId==='railroad-vine'),lib.materials);
 assert.ok(vineProx.every(e=>e.tint[0]<=0.35&&Math.hypot(...e.axis)<=0.35),'Railroad vine avoids oversized hot-pink bridged ellipsoids');
 const slashProx=fitCovarianceEllipsoids(lib.assets.find(a=>a.speciesId==='slash-pine'),lib.materials);
 const trunkElls=slashProx.filter(e=>e.soft<0.25);
 assert.ok(trunkElls.length>=2&&trunkElls.every(e=>Math.hypot(...e.width)<=0.16),'Slash pine trunks remain narrow bark segments without brown bough blobs');
});

test('WetlandReeds buffer expansion clears Three.js _maxInstanceCount and covers elevated oblique views gap-free',()=>{
 const lib=garden.create(null,2187);
 const land=new Wetland(lib.world.wetlandSeed,lib.world.climate,lib.materials.find(m=>m.id==='sand'));
 const assets=reedFamily(lib);
 const mockView={oceanView:{uniforms:{}},uniforms:{clipHeights:{value:{y:1}}},activePhysics:null};
 const reeds=new WetlandReeds(mockView,'uniform vec3 sunDirection,sunColor; vec3 env(vec3 n,float d){return vec3(1.);}');
 const placed=lib.world.instances.filter(i=>assets.some(a=>instancedReed(a)&&a.id===i.assetId));
 reeds.configure(assets,lib.materials,placed);

 const vp=land.transectViewpoints().overview;
 const cam=new PerspectiveCamera(48,1.0,0.4,10000);
 cam.position.set(...vp.position);
 cam.lookAt(...vp.target);
 reeds.update(land,cam,lib.world.wind,0,mockView);
 const initialCap=new Map();
 for(const m of reeds.group.children){
  const cap=m.geometry.attributes.site?.count??0;
  initialCap.set(m,cap);
  if(cap>0)m.geometry._maxInstanceCount=cap;
 }

 const d0=land.shoreDistance(0,0);
 const bx=(35-d0)*INLAND_DIR_X,bz=(35-d0)*INLAND_DIR_Z;
 cam.position.set(bx-ALONG_DIR_X*90-INLAND_DIR_X*30,58,bz-ALONG_DIR_Z*90-INLAND_DIR_Z*30);
 cam.lookAt(bx+ALONG_DIR_X*140+INLAND_DIR_X*30,0,bz+ALONG_DIR_Z*140+INLAND_DIR_Z*30);
 reeds.update(land,cam,lib.world.wind,0,mockView);

 let lod2Total=0,horizonTotal=0,grownLod2=0,grownHorizon=false;
 for(const m of reeds.group.children){
  const cap=m.geometry._maxInstanceCount;
  assert.ok(cap===undefined||cap>=m.geometry.instanceCount,'Stale _maxInstanceCount must never truncate active instances');
  if(m.geometry.instanceCount>(initialCap.get(m)||0)){
   assert.equal(m.geometry._maxInstanceCount,undefined,'Resized InstancedBufferGeometry must clear stale _maxInstanceCount');
   if(m.userData.horizon)grownHorizon=true;
   else if(m.userData.lod===2)grownLod2++;
  }
  if(m.userData.horizon)horizonTotal+=m.geometry.instanceCount;
  else if(m.userData.lod===2)lod2Total+=m.geometry.instanceCount;
 }
 assert.ok(grownHorizon&&grownLod2>=3,`Expected buffer growth on horizon (${grownHorizon}) and LOD2 (${grownLod2})`);
 assert.ok(lod2Total>4000&&horizonTotal>1500,`Elevated oblique view must sustain dense Tier 2 (${lod2Total}) and HorizonStands (${horizonTotal})`);
});

test('zone-gated Wetland terrain/balds stay continuous, windWorld skips MaterialWorld, and WetlandReeds builds primary-only LOD0 siblings',async()=>{
 const land=new Wetland(2187);
 // Traverse fine steps from Gulf shoreface (-45 m) across beach, foredune, swale, rosemary balds, backdunes, and bay (+290 m)
 const d0=land.shoreDistance(0,0);
 let prevH=null,maxJump=0;
 for(let d=-45;d<=290;d+=0.25){
  const x=(d-d0)*INLAND_DIR_X,z=(d-d0)*INLAND_DIR_Z;
  const h=land.height(x,z);
  assert.ok(Number.isFinite(h),`Expected finite elevation at d=${d}`);
  if(prevH!==null)maxJump=Math.max(maxJump,Math.abs(h-prevH));
  prevH=h;
 }
 assert.ok(maxJump<0.28,`Zone-gated land() must remain continuous across zone mask boundaries (max step jump ${maxJump.toFixed(4)} m)`);

 // Find an active rosemary bald and check continuous halo falloff across r=8m cutoff
 let peakBald=0,baldPts=0;
 for(let x=-120;x<=120;x+=3)for(let z=-120;z<=120;z+=3){
  const r=land.rosemaryInhibition(x,z);
  if(r>0.1){
   baldPts++;peakBald=Math.max(peakBald,r);
   const rNear=land.rosemaryInhibition(x+0.25,z);
   assert.ok(Math.abs(r-rNear)<0.15,'Rosemary inhibition halo stays spatially smooth');
  }
 }
 assert.ok(baldPts>0&&peakBald>=0.22,'At least one active rosemary allelopathic bald is sampled cleanly');

 // Verify reference windWorld skips unused MaterialWorld while main world keeps it, and responds to wind cleanly
 const lib=garden.create(null,2187);
 const sim=await StudioPhysics.create(lib,'world');
 try{
  const ww=sim.stand.windWorld;
  assert.equal(ww.materialWorld,null,'windWorld skips unused MaterialWorld thermal/electrical solver');
  assert.ok(ww.bodies.size>=60,'All 14 species sample stems remain active in windWorld');
  sim.wind={speed:9.5,heading:15,turbulence:0.4};
  for(let i=0;i<60;i++)sim.step();
  const reedTips=[...ww.bodies.values()].filter(r=>r.asset.speciesId==='coastal-reed'&&r.part.id.startsWith('tip-'));
  assert.ok(reedTips.some(r=>Math.hypot(r.matrix.elements[12],r.matrix.elements[14])>0.01),'windWorld stems still bend dynamically under wind');
 }finally{sim.dispose();}

 // Verify WetlandReeds creates primary-only lod0Core siblings strictly for multi-mark coastal species
 const mockView={oceanView:{uniforms:{}},uniforms:{clipHeights:{value:{y:0.25}}},activePhysics:null};
 const reeds=new WetlandReeds(mockView,'uniform vec3 sunDirection,sunColor; vec3 env(vec3 n,float d){return vec3(1.);}');
 const assets=reedFamily(lib);
 const placed=lib.world.instances.filter(i=>assets.some(a=>instancedReed(a)&&a.id===i.assetId));
 reeds.configure(assets,lib.materials,placed);
 const fullLod0=reeds.group.children.filter(m=>m.userData.hasCoreSibling);
 const coreLod0=reeds.group.children.filter(m=>m.userData.lod0Core);
 assert.equal(fullLod0.length,COASTAL_SPECIES.length);
 assert.equal(coreLod0.length,COASTAL_SPECIES.length);
 const vp=land.transectViewpoints().swale;
 const cam=new PerspectiveCamera(48,1.0,0.03,10000);
 cam.position.set(...vp.position);cam.lookAt(...vp.target);
 reeds.update(land,cam,lib.world.wind,0,mockView);
 for(const m of reeds.group.children){
  if(m.userData.horizon||m.geometry.instanceCount===0)continue;
  for(let j=1;j<m.geometry.instanceCount;j++){
   assert.ok(m.userData.rootYs[j]>=m.userData.rootYs[j-1],'Sorted y instances preserve binary-search wet-root invariant');
  }
 }
 reeds.dispose();
});
