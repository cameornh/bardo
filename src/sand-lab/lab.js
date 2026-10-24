import {bodyMass,bodyImpulse,integrateOrientation,resolveBodyTerrain,resolveBodyPairs} from './rigid-contacts.js';
import {TideBoundary,lunarState,moonPhaseState,advanceSkyClocks,LUNAR_MONTH} from './tides.js';
import {FluidSampler} from './fluid-sampling.js';
import {SandShapeStamp} from './sand-cache.js';
import {buildSandBins,sandCell} from './sand-bins.js';
import {BoundsGrid} from './spatial-bounds.js';
import {sandIsTracer,shapeRadius,shapeDistance,shapeBlend,packSandShapes} from './sand-shape.js';
import {sandResolutionForWater} from './resolution.js';
import {carryDistance,solidRayHit,waterRayHit,selectWaterParcels} from './interaction.js';
import {cupWaterState} from './cup-water.js';
import {lunarDirection,moonIrradiance,MOON_COLOR} from './night-sky-model.js';
import {atmosphereTransmission} from './atmosphere-model.js';
import * as THREE from 'three';
import {WaterLab} from './water-lab.js';
import {SandBed} from './sand.js';
import {makeBody,bodyDistance,bodyNormal,playerBodyContact,bodyVolume,bodySupport,cupHydrostatics,resolveSandContacts,recolorLatest} from './objects.js';
import {floatTexture} from './uniforms.js';
import {normalAt,length,clamp} from './water-lab-model.js';
import {WATER_MATERIAL} from '../water-material.js';
import {createSandWind} from './sand-air.js';
export class SandLab extends WaterLab{
 constructor(renderer){super(renderer);this.optimizations={surfaceLightReuse:true,packedGpuNeighbors:true,windBatch:true,nativeNeighbors:true,mergeWindDeposits:true,settlingIndex:true,patchFloor:true,predictBudget:true,fastHeight:true,windGeometry:true,fastEmission:true,terrainCache:true,sandPrograms:true,stressPruning:true,fastPredict:true,emitterProbes:true,packedFlow:true,packedFields:true,neighborBounds:true,boundaryReuse:true,fastSampling:true,sandQueryBounds:true,compactSand:true,blobDepth:true,gpuBatch:true,packedNeighbors:true,broadphase:true,sandCache:true,emptySpace:true,splatBounds:true,lightingTiles:true};this.day=14;this.moonPhase=1;this.moonPhaseOffset=0;this.lunarDay=LUNAR_MONTH/2;this.lunarCycle=true;this.lunarSeconds=180*LUNAR_MONTH;this.tidesEnabled=true;this.tideAmplitude=1.5;this.cycle=false;this.daySeconds=180;this.sunIntensity=1;this.skyIntensity=1;this.objectRadius=.5;this.objectShape='sphere';this.objectMaterial='glass';this.physicsBudgetMs=95;this.detail.density=.6;this.particleBudget=32768;this.resolutions.ocean=2.2;this.configure('ocean');this.enabled=true;}
 configure(kind='ocean',scale=this.scaleMultipliers?.[kind]||1){super.configure(kind,scale);if(kind!=='ocean')return;this.tide=new TideBoundary();this.windAudit=null;this.sandWind=null;this.sand=new SandBed(sandResolutionForWater(this.spacing));this.grains?.reset();this.sandRevision=-1;this.renderSandStamp=null;this.fluidIndex=null;this.sandHeld=null;this.heldBody=null;this.carvedWater=0;this.objectRadius??=.5;this.u.uSand.value.dispose();this.u.uSand.value=floatTexture(this.sand.data,this.sand.n,this.sand.n);this.u.uSand.value.minFilter=this.u.uSand.value.magFilter=THREE.LinearFilter;this.syncUniforms();}
 // Metre-scale parcels allow a 15 Hz step. The same predictor as the
 // reference bounds parcel travel to .45 spacing; capillary/gravity bounds
 // still shorten the step when the user selects a miniature physical scale.
 get timestep(){const h=this.spacing*this.spec.scale;return Math.min(1/15,Math.sqrt(.4*h/9.81),.2*Math.sqrt(WATER_MATERIAL.density*h*h*h/WATER_MATERIAL.surfaceTension));}
 // Fast local water sampling is independent of the camera, used by sand and bodies.
 indexFluid(){const reach=this.spacing*2;if(this.optimizations?.fastSampling!==false){(this.fluidSampler??=new FluidSampler()).build(this.positions,this.velocities,reach);if(!this.balls.some(b=>b.shape==='cup')){this.fluidIndex={reach,fast:true};return;}}const bins=new Map();for(let i=0;i<this.count;i++){const o=i*4,key=(Math.floor(this.positions[o]/reach)+512)+(Math.floor(this.positions[o+1]/reach)+512)*1024+(Math.floor(this.positions[o+2]/reach)+512)*1048576;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(i);}this.fluidIndex={bins,reach};}
 waterAt(p){if(!this.fluidIndex)this.indexFluid();if(this.optimizations?.fastSampling!==false){this.fluidSampler.positions=this.positions;this.fluidSampler.velocities=this.velocities;return this.fluidSampler.sample(p);}const {bins,reach}=this.fluidIndex,c=p.map(v=>Math.floor(v/reach)),velocity=[0,0,0];let density=0;for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const i of bins.get((c[0]+x+512)+(c[1]+y+512)*1024+(c[2]+z+512)*1048576)||[]){const o=i*4,q=1-((p[0]-this.positions[o])**2+(p[1]-this.positions[o+1])**2+(p[2]-this.positions[o+2])**2)/(reach*reach);if(q<=0)continue;const w=315/(512*Math.PI)*q*q*q;density+=w;for(let k=0;k<3;k++)velocity[k]+=this.velocities[o+k]*w;}return {density,velocity:velocity.map(v=>v/Math.max(.00001,density))};}
 sample(p){return this.waterAt(p).density;}
 occupancyOutsideCapsule(p,radius){const reach=radius+this.spacing*.65;let wet=0;for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]])wet+=clamp((this.sample([p[0]+x*reach,p[1],p[2]+z*reach])-.12)/.55,0,1);return wet*.25;}
 playerWater(p,radius){
  const reach=radius+this.spacing*.65,velocity=[0,0,0];let density=0;
  for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]]){const sample=this.waterAt([p[0]+x*reach,p[1],p[2]+z*reach]),w=clamp((sample.density-.12)/.55,0,1);density+=w/4;for(let k=0;k<3;k++)velocity[k]+=sample.velocity[k]*this.spec.scale*w/4;}
  return {density,velocity:velocity.map(v=>v/Math.max(.00001,density))};
 }
 playerEnvironment(eye,eyeHeight){
  const scale=this.spec.scale,p=eye.map((v,k)=>(v-(k===1?eyeHeight*.45:0))/scale);
  return {air:createSandWind(this)(p).map(v=>v*scale)};
 }
 bedDelta(p){return this.sand?this.sand.height(p[0],p[2])-Math.max(-.3,(p[2]-1)*.48):0;}
 solid(p,includePlayer=true,bounded=true,exclude=null){if(!this.sand)return super.solid(p,includePlayer,bounded);this.syncSandUniforms();let d=(p[1]-this.terrainHeight(p[0],p[2]))*.65;const headers=this.u.uSandBins.value.image.data,indices=headers,cell=sandCell(p)*4,start=headers[cell],count=headers[cell+1];for(let j=0,inside=p[0]>=this.u.uSandMin.value.x&&p[0]<=this.u.uSandMax.value.x&&p[1]>=this.u.uSandMin.value.y&&p[1]<=this.u.uSandMax.value.y&&p[2]>=this.u.uSandMin.value.z&&p[2]<=this.u.uSandMax.value.z;inside&&j<count;j++){const a=this.sandRenderParcels[indices[4096+start+j]],q=shapeDistance(a,p),k=shapeBlend(a),h=Math.max(k-Math.abs(d-q),0)/Math.max(k,.00001);d=Math.min(d,q)-h*h*k*.25;}for(const b of this.balls)if(b!==exclude&&Math.hypot(...p.map((v,k)=>v-b.position[k]))-b.radius*1.5<d)d=Math.min(d,bodyDistance(p,b));if(includePlayer)d=Math.min(d,this.playerDistance(p));return bounded?Math.min(d,5.5-Math.abs(p[0]),4.9-Math.abs(p[2]),9-p[1]):d;}
 terrainHeight(x,z){this.syncSandUniforms();return this.optimizations?.terrainCache===false?this.sand.height(x,z):this.sand.heightCached(x,z,this.terrainHeights);}
 walkerContact(p){const scale=this.spec.scale,q=p.map(v=>v/scale),distance=this.solid(q,false)*scale;for(const b of this.balls){if(b.held)continue;if(bodyDistance(q,b)*scale<=distance+.00001)return {distance,normal:bodyNormal(q,b),resolve:(walker,probe)=>{playerBodyContact(walker,b,probe,scale);this.revision++;}};}return {distance,normal:normalAt(q,x=>this.solid(x,false))};}
 spawn(kind=this.objectMaterial,origin,direction,shape=this.objectShape){this.lightEditRevision=(this.lightEditRevision||0)+1;const radius=this.objectRadius;let distance=radius+Math.max(1/this.spec.scale,radius*.6);for(let i=0;i<120;i++){const p=origin.map((v,k)=>v+direction[k]*distance);if(Math.abs(p[0])<5.5-radius&&Math.abs(p[2])<4.9-radius)break;distance+=.15;}const b=makeBody(kind,shape,radius,origin.map((v,k)=>v+direction[k]*distance),direction.map(v=>v*1.1));this.balls.push(b);this.fluidIndex=null;this.revision++;return b;}
 recolor(color){this.lightEditRevision=(this.lightEditRevision||0)+1;recolorLatest(this.balls,color);this.revision++;}
 // Collision queries also run between sand stepping and the render sync
 // (rain, spray and walker probes). Keep bins, bounds and packed shapes on
 // the same revision as the live parcels before using their array indices.
 syncSandUniforms(){
  if(!this.sand)return;if(this.sand.dirty)this.sand.update();
  if(this.sandRevision===this.sand.revision)return;
  if(!this.terrainHeights||this.terrainHeights.length!==this.sand.mass.length)this.terrainHeights=new Float64Array(this.sand.mass.length);for(let k=0;k<this.terrainHeights.length;k++)this.terrainHeights[k]=this.sand.heightAt(k);
  const u=this.u,parcels=this.optimizations?.compactSand!==false?this.sand.parcels.filter(p=>p.mass>0&&!sandIsTracer(p)):this.sand.parcels;this.sandRenderParcels=parcels;u.uSand.value.needsUpdate=true;
  const geometryChanged=this.optimizations?.sandCache===false||this.sandGeometryBed!==this.sand||this.sandCompactMode!==this.optimizations?.compactSand||(this.optimizations?.compactSand!==false?(this.renderSandStamp??=new SandShapeStamp()).changed(parcels):this.sandShapeRevision!==this.sand.shapeRevision);
  if(geometryChanged){
   const packed=packSandShapes(parcels),rows=Math.max(1,Math.ceil(packed.data.length/1024));
   if(u.uSandParcels.value.image.height!==rows){u.uSandParcels.value.dispose();u.uSandParcels.value=floatTexture(new Float32Array(rows*256*4),256,rows);}
   u.uSandParcels.value.image.data.set(packed.data);
   const bins=buildSandBins(parcels),height=bins.data.length/1024;
   if(u.uSandBins.value.image.height!==height){u.uSandBins.value.dispose();u.uSandBins.value=floatTexture(bins.data,256,height);}
   else u.uSandBins.value.image.data.set(bins.data);
   u.uSandBins.value.needsUpdate=true;u.uSandCount.value=parcels.length;
   u.uSandMin.value.fromArray(bins.min);u.uSandMax.value.fromArray(bins.max);this.sandBinMaxCount=bins.maxCount;
   this.sandGeometryBed=this.sand;this.sandCompactMode=this.optimizations?.compactSand;this.sandShapeRevision=this.sand.shapeRevision;this.sandBinRebuilds=(this.sandBinRebuilds||0)+1;
  }else for(let i=0;i<parcels.length;i++)u.uSandParcels.value.image.data[i*12+4]=parcels[i].wet;
  u.uSandParcels.value.needsUpdate=true;this.sandRevision=this.sand.revision;
 }

 syncUniforms(){super.syncUniforms();if(!this.sand)return;this.syncSandUniforms();const n=Math.max(1,Math.ceil(this.balls.length*3/256)),u=this.u;if(u.uBodyExtra.value.image.height!==n){u.uBodyExtra.value.dispose();u.uBodyExtra.value=floatTexture(new Float32Array(n*256*4),256,n);}const a=u.uBodyExtra.value.image.data;this.balls.forEach((b,i)=>{a.set([...b.color,b.shape==='cup'?1:0],i*12);a.set([b.tilt||0,b.spin||0,b.pitch||0,0],i*12+4);});u.uBodyExtra.value.needsUpdate=true;

 const day=this.day??14,angle=(day-6)/24*Math.PI*2,alt=Math.sin(angle),daylight=clamp((alt+.08)/.3,0,1);u.uSolarDirection.value.set(Math.cos(angle)*.55,alt,.35).normalize();
 const lunar=lunarState(this.lunarDay??LUNAR_MONTH/2);this.moonPhase=moonPhaseState(this).illuminated;const key=`${day}:${lunar.age}:${this.moonPhaseOffset}`;
 if(this.lightDay!==key){this.lightDay=key;const sun=u.uSolarDirection.value.toArray(),moon=lunarDirection(lunar.elongation),solar=atmosphereTransmission([0,.02,0],sun),lunarTrans=atmosphereTransmission([0,.02,0],moon),ratio=moonIrradiance(this.moonPhase??1),useSun=Math.max(...solar)>Math.max(...lunarTrans)*ratio;
  this.dayTransmission=useSun?solar:lunarTrans.map((v,k)=>v*MOON_COLOR[k]);this.dayLightRatio=useSun?1:ratio;this.dayLightDirection=useSun?sun:moon;
 }
 u.uDaySun.value.fromArray(this.dayLightDirection);u.uDayTint.value.fromArray(this.dayTransmission);u.uDaySky.value=daylight;this.sunlight=(this.sunIntensity??1)*this.dayLightRatio;this.ambient=this.skyIntensity??1;}

 stepBodies(dt){
  if(!this.sand)return super.stepBodies(dt);
  const scale=this.spec.scale,gravity=9.81/scale;
  // Substep the rigid contacts only; no extra fluid solves or camera dependency.
  let substeps=1;for(const b of this.balls)if(!b.held)substeps=Math.max(substeps,Math.min(12,Math.ceil((Math.hypot(...b.velocity)+Math.hypot(...b.omega)*b.radius)*dt/Math.max(.001,b.radius*.2))));
  const h=dt/substeps;
  for(let step=0;step<substeps;step++){
   for(const b of this.balls){if(b.held)continue;
    const samples=[];let wet=0;
    for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
     const p=b.position.map((v,k)=>v+axis[k]*(bodySupport(b,axis)+this.spacing*.35)),sample=this.waterAt(p),w=clamp(sample.density*1.6,0,1);wet+=w/6;samples.push({p,sample,w});
    }
    let buoyancy=wet/b.ratio;
    if(b.shape==='cup'){
     if(!this.fluidIndex?.bins)this.indexFluid();const state=cupWaterState(b,this.positions,this.spacing,this.fluidIndex,this.surfaceMetrics?this.neighborCounts:null);
     b.waterVolume=(b.waterVolume??state.waterVolume)+(state.waterVolume-(b.waterVolume??state.waterVolume))*(1-Math.exp(-h/.12));
     const hydro=cupHydrostatics(b,state.surface,b.waterVolume);wet=hydro.submerged;buoyancy=hydro.buoyancy;b.airVolume=hydro.airVolume;b.displacedVolume=hydro.displaced;
     bodyImpulse(b,hydro.center,[0,gravity*buoyancy*bodyMass(b)*h,0]);b.velocity[1]-=gravity*h;
    }else b.velocity[1]+=gravity*(buoyancy-1)*h;
    b.submerged=wet;b.buoyancy=buoyancy;
    for(const {p,sample,w} of samples){const gain=(1-Math.exp(-h*w*2/b.ratio))/6;bodyImpulse(b,p,sample.velocity.map((v,k)=>(v-b.velocity[k])*gain*bodyMass(b)));}
    const air=this.air.grid?this.air.sampleGrid(b.position):[this.wind/scale,0,0];
    for(let k=0;k<3;k++){b.velocity[k]+=(air[k]-b.velocity[k])*h*.008*(1-wet)/b.ratio;b.position[k]+=b.velocity[k]*h;b.omega[k]*=Math.exp(-h*(.12+wet));}
    integrateOrientation(b,h);
    const terrain=p=>this.sand.distance(p),impact=Math.max(0,-b.velocity[1]),depth=resolveBodyTerrain(b,terrain,h);
    if(depth>0)this.sand.compact(b.position[0],b.position[2],b.radius,bodyMass(b)*(impact+.1)*h*4);
    // The actual cup support, including tilt, also respects the world walls.
    for(const k of [0,2])for(const sign of [-1,1]){const axis=[0,0,0];axis[k]=sign;const edge=(k===0?5.5:4.9)-bodySupport(b,axis);if(b.position[k]*sign>edge){b.position[k]=sign*edge;if(b.velocity[k]*sign>0)b.velocity[k]*=-.15;}}
   }
   this.bodyContactStats=resolveBodyPairs(this.balls,h);
   for(const b of this.balls)if(!b.held)resolveBodyTerrain(b,p=>this.sand.distance(p),h);
  }
 }
 prepareStep(dt){const sandStart=performance.now();this.gpu.nativeNeighbors=this.optimizations.nativeNeighbors;this.gpu.uniforms.uPackedGpuNeighbors.value=!!this.optimizations.packedGpuNeighbors;this.gpu.packedNeighbors=this.optimizations?.packedNeighbors;this.gpu.neighborBounds=this.optimizations?.neighborBounds!==false;this.gpu.uniforms.uReuseBoundary.value=this.optimizations?.boundaryReuse!==false;this.sand.optimizations=this.optimizations;advanceSkyClocks(this,dt);this.tide.step(this,dt);this.indexFluid();this.sandWind=createSandWind(this);this.sand?.step(dt,p=>this.waterAt(p),this.sandWind,this.spec.scale,this.rain.enabled?this.rain.rate/60000*.3:0,this.spacing);if(this.sand)resolveSandContacts(this.sand.parcels,this.balls,dt,this.optimizations?.broadphase?(this.sandContactGrid??=new BoundsGrid()):null);this.sand?.touchShapes();this.sandStepMs=performance.now()-sandStart;return super.prepareStep(dt);}
 finishStep(context,next,defer=false){super.finishStep(context,next,defer);if(context.generation===this.generation)this.grains?.advance(context.dt);this.fluidIndex=null;}
 sandPick(origin,direction){const hit=solidRayHit(this.sand,this.balls,origin,direction);return hit?.kind==='sand'?hit.point:null;}
 objectPick(origin,direction){const hit=solidRayHit(this.sand,this.balls,origin,direction);return hit?.kind==='object'?hit.body:null;}
 pick(origin,direction){const solid=solidRayHit(this.sand,this.balls,origin,direction);return waterRayHit(this.positions,this.spacing,origin,direction,solid?.distance)?.point??null;}
 interact(origin,direction){this.lightEditRevision=(this.lightEditRevision||0)+1;if(this.asyncPending){this.queuedInteractions.push({origin:origin.slice(),direction:direction.slice(),tool:this.tool});return true;}if(this.tool==='carve-sand'){const p=this.sandPick(origin,direction);if(!p)return false;this.sand.carve(p,this.radius);this.syncUniforms();this.revision++;return true;}
 if(this.tool==='carve-water'){const p=this.pick(origin,direction);if(!p)return false;this.carveWater(p,this.radius);return true;}
 if(this.tool==='object'){this.spawn(this.objectMaterial,origin,direction);return true;}if(this.tool==='grab-object'){if(this.heldBody){this.heldBody.held=false;this.heldBody=null;}else{const b=this.objectPick(origin,direction);if(b){b.held=true;this.heldBody=b;this.objectDistance=carryDistance(b.radius*(b.shape==='cup'?1.55:1),this.spec.scale);}}return true;}if(this.tool==='grab-sand'){if(this.sandHeld){this.sandHeld.forEach(p=>p.held=false);this.sandHeld=null;}else{const p=this.sandPick(origin,direction);if(p){this.sandHeld=this.sand.extract(p,this.radius,[0,0,0],true);for(const q of this.sandHeld)q.offset=q.position.map((v,k)=>v-p[k]);const extent=Math.max(0,...this.sandHeld.map(q=>Math.hypot(...q.offset)+shapeRadius(q)));this.sandHoldDistance=carryDistance(extent,this.spec.scale);if(!this.sandHeld.length)this.sandHeld=null;}}this.revision++;return true;}if(this.tool==='push-sand'){const p=this.sandPick(origin,direction);if(p)this.sand.push(p,this.radius,direction,.09);this.revision++;return !!p;}const previousHeld=this.held,result=super.interact(origin,direction);if(this.held&&this.held!==previousHeld){const extent=Math.max(0,...this.held.offsets.map(p=>Math.hypot(...p)))+this.spacing*.8;this.held.distance=carryDistance(extent,this.spec.scale);}return result;}
 carveWater(point,radius){
  const selected=new Set(selectWaterParcels(this.positions,point,radius,this.spacing)),keep=[];for(let i=0;i<this.count;i++)if(!selected.has(i))keep.push(i);
  const removed=this.count-keep.length;if(!removed)return 0;for(const key of ['positions','velocities','chem']){const old=this[key],next=new Float32Array(keep.length*4);keep.forEach((i,j)=>next.set(old.subarray(i*4,i*4+4),j*4));this[key]=next;}
  // Indices changed: discard emitter/neighbor histories instead of attaching
  // old velocities, held selections or spray trails to unrelated parcels.
  this.held=null;for(let i=3;i<this.positions.length;i+=4)this.positions[i]=0;this.surfaceMetrics=null;this.surfaceBreakup=null;this.aerationActivity=null;this.neighborCounts=null;this.gpu.neighborOrigin=null;this.detail.remapEmitters(keep);this.fluidIndex=null;this.carvedWater+=removed*this.spacing**3;this.revision++;return removed;
 }
 moveHeld(origin,direction){if(this.sandHeld||this.heldBody||this.held)this.lightEditRevision=(this.lightEditRevision||0)+1;super.moveHeld(origin,direction);if(this.sandHeld){const center=origin.map((v,k)=>v+direction[k]*(this.sandHoldDistance??carryDistance(this.radius,this.spec.scale)));for(const p of this.sandHeld)p.position=center.map((v,k)=>v+p.offset[k]);this.sand.update();this.revision++;}if(this.heldBody){const b=this.heldBody,target=origin.map((v,k)=>v+direction[k]*this.objectDistance);b.position=target;b.velocity=[0,0,0];this.revision++;}}
}
