import {waterWindDrag,waterWindPressure} from './wind-response.js';
import {simulationAllowance} from './simulation-clock.js';
import {EmitterProbes} from './emitter-probes.js';
import {predictBeach} from './beach-predict.js';
import {StepReadback} from './gpu-step-readback.js';
import {selectWaterParcels} from './interaction.js';
import {createSandUniforms} from './uniforms.js';
import {playerImmersion,softenPlayerImpulse} from './water-lab-player.js';
import {pollLabReadbacks} from './water-lab-readback.js';
import {pipeInlet} from './water-lab-inlet.js';
import {LabWetting} from './water-lab-wetting.js';
import {LabAirField,labAirVelocity} from './water-lab-air.js';
import {RIVER_BOUNDS,RIVER_BED,riverBedWeights,riverCenter,riverBottom,riverVelocity,exchangeRiverSediment} from './water-lab-river.js';
import {refineWater,resolutionPlan} from './water-lab-resolution.js';
import {LabDetail} from './water-lab-detail.js';
import {LabTransportGPU} from './transport-gpu.js';
import {transportFluid} from './water-lab-transport.js';
import {LabRain} from './water-lab-rain.js';
import * as THREE from 'three';
import {LabFluidGPU} from './water-lab-gpu.js';
import {LAB_PRESETS,LAB_IDS,seedWater,createMotion,stepMotion,fixtureDistance,vesselDistance,wallVelocity,normalAt,clamp,length,hash,densityAt,buoyancyAcceleration,floorHeight,collideBoundary,WATER_CONTACT_SKIN} from './water-lab-model.js';
import {WATER_MATERIAL} from '../water-material.js';
export class WaterLab {
 constructor(renderer){this.renderer=renderer;this.enabled=false;this.paused=false;this.simulationSpeed=1;this.frameHz=15;this.physicsBudgetMs=100;this.asyncSimulation=false;this.tool='orbit';this.radius=.7;this.turbulence=.2;this.flow=1;this.wind=0;this.windTurbulence=1;this.player=null;this.windStrength=60;this.jets=1;this.lights=1;this.riverSlope=.1;this.sourceSpeed=1.5;this.waterfallHeight=4.8;this.tannins=0;this.ambient=1;this.balls=[];this.jet=null;this.windHeld=false;this.steps=0;this.clock=0;this.motion=createMotion();this.accumulator=0;this.bedData=new Float32Array(RIVER_BED.width*RIVER_BED.height*4);this.bedTexture=new THREE.DataTexture(this.bedData,RIVER_BED.width,RIVER_BED.height,THREE.RGBAFormat,THREE.FloatType);this.bedTexture.minFilter=this.bedTexture.magFilter=THREE.LinearFilter;this.bedTexture.needsUpdate=true;this.bodyTexture=new THREE.DataTexture(new Float32Array(256*4),256,1,THREE.RGBAFormat,THREE.FloatType);this.bodyTexture.needsUpdate=true;
 this.u={...createSandUniforms(),uWaterfallHeight:{value:4.8},uPlayer:{value:new THREE.Vector4(0,0,0,0)},uPlayerHeight:{value:0},uRiverSlope:{value:this.riverSlope},uTannins:{value:this.tannins},uStation:{value:0},uContainer:{value:new THREE.Vector3(0,2,0)},uPitch:{value:0},uTilt:{value:0},uSpin:{value:0},uBodies:{value:this.bodyTexture},uBodyCount:{value:0},uLabBed:{value:this.bedTexture}};this.gpu=new LabFluidGPU(renderer,this.u);this.transportGPU=new LabTransportGPU(renderer);this.air=new LabAirField(renderer,this.u);this.verification='Not run';this.rain=new LabRain(this);this.wetting=new LabWetting(this);this.detail=new LabDetail(renderer);this.scaleMultipliers={};this.resolutions={};this.particleBudget=8192;this.configure('pipe');}
 configure(kind,multiplier=this.scaleMultipliers[kind]||1){this.generation=(this.generation||0)+1;this.completedDt=0;this.stepCostEstimate=0;this.rateWall=0;this.rateSim=0;this.droppedTime=0;this.queuedInteractions=[];this.kind=kind;this.scaleMultipliers[kind]=clamp(multiplier,.1,10);this.rain.reset(kind);this.wetting.reset();this.detail.reset();this.emitterSamples=null;this.surfaceMetrics=null;this.aerationActivity=null;this.surfaceBreakup=null;this.ambient=kind==='pool'?.25:1;this.sunlight=kind==='pool'?.25:1;this.quality=this.resolutions[kind]||1;const seed=this.seedConfiguration(kind,this.scaleMultipliers[kind],this.quality);this.resolutionInfo=seed.resolutionInfo;this.resolution=seed.resolution;this.spec=seed.spec;this.motion=createMotion();this.player=null;this.balls=[];this.held=null;this.jet=null;this.time=0;this.simRate=0;this.accumulator=0;this.inletSequence=0;this.pumpCursor=0;this.pumped=0;this.pumpBudget=0;this.bedData.fill(0);this.eroded=0;this.deposited=0;this.bedStock=new Float64Array(RIVER_BED.width*RIVER_BED.height).fill(RIVER_BED.thickness*RIVER_BED.spanX*RIVER_BED.spanZ/(RIVER_BED.width*RIVER_BED.height));this.initialBed=this.bedStock.reduce((a,b)=>a+b,0);this.bedTexture.needsUpdate=true;const items=seed.items;this.neighborCounts=new Uint16Array(items.length);this.positions=new Float32Array(items.length*4);this.velocities=this.positions.slice();this.chem=this.positions.slice();items.forEach((p,i)=>{this.positions.set(p.p,i*4);this.velocities.set(p.v,i*4);});this.initialVolume=items.length*this.spec.spacing**3*this.spec.scale**3;this.wind=kind==='ocean'?24:0;this.turbulence=kind==='ocean'?1:this.turbulence;this.radius=kind==='glass'?.45:.75;this.u.uStation.value=LAB_IDS.indexOf(kind);this.syncUniforms();this.revision=(this.revision||0)+1;}
 seedConfiguration(kind,multiplier,quality){const preset=LAB_PRESETS[kind],base=seedWater(kind,{...preset,waterfallHeight:this.waterfallHeight,riverSlope:this.riverSlope,sourceSpeed:this.sourceSpeed,scale:preset.scale*multiplier}),info=resolutionPlan(preset,base.length,multiplier,quality,this.particleBudget);let resolution=info.factor,items=refineWater(base,preset.spacing,resolution);while(items.length>this.particleBudget&&resolution>1){resolution=Math.max(1,resolution*Math.cbrt(this.particleBudget/items.length)*.98);items=refineWater(base,preset.spacing,resolution);}info.factor=resolution;info.limited=resolution<info.requested-1e-6;return {items,resolution,resolutionInfo:info,spec:{...preset,spacing:preset.spacing/resolution,scale:preset.scale*multiplier}};}

 get fieldBounds(){return this.kind==='river'?RIVER_BOUNDS:undefined;}
 get count(){return this.positions.length/4;}
 get timestep(){const h=this.spacing*this.spec.scale;return Math.min(1/30,Math.sqrt(.4*h/9.81),.2*Math.sqrt(WATER_MATERIAL.density*h*h*h/WATER_MATERIAL.surfaceTension));}
 get spacing(){return this.spec.spacing;}
 get volume(){return this.count*this.spacing**3*this.spec.scale**3;}
 bedCell(p){return riverBedWeights(p).reduce((a,b)=>b[1]>a[1]?b:a)[0];}
 bedDelta(p){return this.kind==='river'?riverBedWeights(p).reduce((sum,[cell,w])=>sum+this.bedData[cell*4]*w,0):0;}
 playerDistance(p){if(!this.player)return 100;const a=this.player.base,q=p.map((v,k)=>v-a[k]);q[1]-=clamp(q[1],0,this.player.height);return length(q)-this.player.radius;}
 setPlayer(eye,velocity,radius=.28,height=1.65){this.player=eye?{base:[eye[0],eye[1]-height+radius,eye[2]],height:height-radius*2,radius,velocity:velocity.slice()}:null;}
 solid(p,includePlayer=true,bounded=true){let d=fixtureDistance(p,this.kind,this.motion,this.bedDelta(p),this.riverSlope,this.waterfallHeight,bounded);for(const b of this.balls)d=Math.min(d,length(p.map((v,k)=>v-b.position[k]))-b.radius);return includePlayer?Math.min(d,this.playerDistance(p)):d;}
 collide(p,r=this.spacing*WATER_CONTACT_SKIN){return collideBoundary(p,r,q=>this.solid(q));}
 syncUniforms(){this.u.uWaterfallHeight.value=this.waterfallHeight;const player=this.player;this.u.uPlayer.value.set(...(player?[...player.base,player.radius]:[0,0,0,0]));this.u.uPlayerHeight.value=player?.height||0;this.u.uRiverSlope.value=this.riverSlope;this.u.uTannins.value=this.tannins;this.u.uContainer.value.fromArray(this.motion.position);this.u.uTilt.value=this.motion.tilt;this.u.uPitch.value=this.motion.pitch;this.u.uSpin.value=this.motion.spin;const height=Math.max(1,Math.ceil(this.balls.length*2/256));if(this.bodyTexture.image.height!==height){this.bodyTexture.dispose();this.bodyTexture=new THREE.DataTexture(new Float32Array(256*height*4),256,height,THREE.RGBAFormat,THREE.FloatType);this.u.uBodies.value=this.bodyTexture;}const a=this.bodyTexture.image.data;this.balls.forEach((b,i)=>{a.set([...b.position,b.radius],i*8);a.set([...b.velocity,b.kind==='glass'?0:b.kind==='mirror'?1:b.kind==='light'?3:2],i*8+4);});this.bodyTexture.needsUpdate=true;this.u.uBodyCount.value=this.balls.length;}
 playerImmersion(eye,radius=.28,height=1.65){return playerImmersion(this.positions,eye,radius,height,this.spacing);}
 sample(p){return densityAt(this.positions,p,this.spacing);}
 spawn(kind,origin,direction){const radius=this.kind==='glass'?.2:.35,b={kind,radius,ratio:kind==='glass'?.22:kind==='mirror'||kind==='light'?1:2.65,position:origin.map((v,k)=>v+direction[k]*(radius+1)),velocity:direction.map(v=>v*4/Math.sqrt(this.spec.scale)),submerged:0};this.balls.push(b);}
 stepBodies(dt){for(const b of this.balls){let surface=-Infinity;for(let i=0;i<this.count;i++){const o=i*4;if(Math.hypot(this.positions[o]-b.position[0],this.positions[o+2]-b.position[2])<b.radius+this.spacing*1.5&&Math.abs(this.positions[o+1]-b.position[1])<b.radius+this.spacing*3)surface=Math.max(surface,this.positions[o+1]+this.spacing*.45);}const cap=clamp(surface-b.position[1]+b.radius,0,2*b.radius),submerged=cap*cap*(b.radius-cap/3)/(4*b.radius**3/3);b.submerged=submerged;if(submerged<1&&(this.wind||this.jet)){const air=labAirVelocity(b.position,this,this.jet,b),drag=.00021/(b.ratio*b.radius)*(1-submerged);for(let k=0;k<3;k++){const relative=air[k]-b.velocity[k];b.velocity[k]+=relative*Math.abs(relative)*drag*dt;}}b.velocity[1]+=buoyancyAcceleration(b.ratio,submerged,this.spec.scale)*dt;let vel=[0,0,0],w=0;for(let i=0;i<this.count;i++){const r=length(b.position.map((v,k)=>v-this.positions[i*4+k]));if(r>b.radius+this.spacing*2)continue;const q=1-r/(b.radius+this.spacing*2);for(let k=0;k<3;k++)vel[k]+=this.velocities[i*4+k]*q;w+=q;}if(w)for(let k=0;k<3;k++){const change=(vel[k]/w-b.velocity[k])*(1-Math.exp(-dt*2*submerged/b.ratio));b.velocity[k]+=change;}
 for(let k=0;k<3;k++)b.position[k]+=b.velocity[k]*dt;const field=p=>fixtureDistance(p,this.kind,this.motion,this.bedDelta(p),this.riverSlope,this.waterfallHeight),d=field(b.position);if(d<b.radius){const n=normalAt(b.position,field),wall=vesselDistance(b.position,this.kind,this.motion)<b.radius+.1?wallVelocity(b.position,this.motion):[0,0,0],vn=b.velocity.reduce((v,x,k)=>v+(x-wall[k])*n[k],0);for(let k=0;k<3;k++){b.position[k]+=n[k]*(b.radius-d);if(vn<0)b.velocity[k]-=1.05*vn*n[k];}}}for(let i=0;i<this.balls.length;i++)for(let j=i+1;j<this.balls.length;j++){const a=this.balls[i],b=this.balls[j],d=b.position.map((v,k)=>v-a.position[k]),l=length(d),overlap=a.radius+b.radius-l;if(overlap>0&&l>1e-6)for(let k=0;k<3;k++){a.position[k]-=d[k]/l*overlap*.5;b.position[k]+=d[k]/l*overlap*.5;}}}
 pump(dt){if(!['pipe','waterfall','river'].includes(this.kind)||this.flow===0)return;this.pumpBudget+=dt*(this.kind==='pipe'?pipeInlet(this.spacing,this.spec.scale,this.flow,this.turbulence,0,this.time).rate:this.flow*(this.kind==='waterfall'?315:110)*this.resolution**3/this.spec.scale);let attempts=0;while(this.pumpBudget>=1&&attempts++<Math.min(this.count,48*this.resolution**3)){const i=this.pumpCursor++%this.count,o=i*4,p=Array.from(this.positions.subarray(o,o+3));if(this.positions[o+3]||this.kind==='river'&&p[2]<44.5||this.kind==='waterfall'&&p[1]>1)continue;this.pumpBudget--;const n=this.pumpCursor,noise=k=>(hash(n+k)-.5)*this.turbulence;let point,velocity;if(this.kind==='pipe'){const inlet=pipeInlet(this.spacing,this.spec.scale,this.flow,this.turbulence,this.inletSequence,this.time);point=inlet.point;velocity=inlet.velocity;}else if(this.kind==='waterfall'){point=[(hash(n)-.5)*4.5,this.waterfallHeight+.45+hash(n+7)*.3,-3.85];velocity=[noise(3)*.8/this.spec.scale,0,(6*this.flow+noise(4))/this.spec.scale];}else{const z=-53.5+hash(n+8)*.7;point=[riverCenter(z)+(hash(n)-.5)*1.3,riverBottom(z,this.riverSlope)+.45+hash(n+7)*.35,z];velocity=riverVelocity(z,this.sourceSpeed,this.spec.scale,this.riverSlope);}let occupied=false;for(let j=0;j<this.count;j++){if(j===i)continue;const k=j*4;if(Math.hypot(this.positions[k]-point[0],this.positions[k+1]-point[1],this.positions[k+2]-point[2])<this.spacing*.8){occupied=true;break;}}if(occupied){this.pumpBudget++;continue;}// Let pond sediment settle before the closed-loop pump returns clean water.
 if(this.kind==='river'&&this.chem[o+2]>.001){this.pumpBudget++;continue;}
 this.inletSequence++;this.positions.set(point,o);this.velocities.set(velocity,o);this.pumped+=this.spacing**3*this.spec.scale**3;}this.pumpBudget=Math.min(this.pumpBudget,200*this.resolution**3);}
 prepareStep(dt){const start=performance.now();this.time+=dt;stepMotion(this.motion,dt);this.pump(dt);const pumpDone=performance.now();this.rain.step(dt);const rainDone=performance.now();this.wetting.step(dt,!this.frameDrivenLens);const wetDone=performance.now();this.stepBodies(dt);this.syncUniforms();this.air.update(this);const old=this.positions.slice(),predicted=this.positions.slice(),s=this.spacing,scale=this.spec.scale;
 if(this.optimizations?.fastPredict&&this.kind==='ocean')predictBeach(this,old,predicted,dt);else for(let i=0;i<this.count;i++){const o=i*4;if(old[o+3])continue;const p=Array.from(old.subarray(o,o+3)),v=Array.from(this.velocities.subarray(o,o+3));v[1]-=9.81/scale*dt;
 const surface=this.chem[o+3]>.01||this.sampleFastSurface(i);if(surface&&(this.wind||this.jet)){const air=this.air.grid?this.air.sampleGrid(p):labAirVelocity(p,this);for(let k=0;k<3;k++){const relative=air[k]-v[k];v[k]+=dt*(this.jet?.025:waterWindDrag(this.wind,this.reactiveWaves))*relative*Math.abs(relative);}v[1]-=dt*waterWindPressure(p[0]*scale,p[2]*scale,this.time,this.wind,this.windTurbulence,this.reactiveWaves)*Math.min(1,(length(air)*scale/Math.max(this.wind,1e-6))**2)/(scale*Math.max(.2,s*scale));}
 if(this.kind==='pool'&&this.jets){for(const side of [-1,1]){const d=length([p[0]-side*3.3,p[1]-.7,p[2]+.8]),w=Math.exp(-d*d/.7)*this.jets;v[0]+=-side*w*dt*12/scale;v[2]+=w*dt*2/scale;}}
 // Contact projection carries normal wall motion; only physical viscosity
 // transfers tangential motion. A fixed drag created sticky, raised edges.
 if(this.player&&this.playerDistance(p)<s){const n=normalAt(p,q=>this.playerDistance(q)),relative=this.player.velocity.reduce((a,x,k)=>a+(x-v[k])*n[k],0),w=clamp(1-this.playerDistance(p)/s,0,1);if(relative>0)for(let k=0;k<3;k++)v[k]+=n[k]*relative*w*.22;}
 const vd=vesselDistance(p,this.kind,this.motion);if(vd<s*.9){const wall=wallVelocity(p,this.motion),weight=(1-clamp(vd/(s*.9),0,1))*(1-Math.exp(-6*WATER_MATERIAL.kinematicViscosity*dt/(scale*Math.max(s*.25,vd))**2));for(let k=0;k<3;k++)v[k]+=(wall[k]-v[k])*weight;}
 // The constraint iterations already project against the solid field on the
 // GPU (or in the CPU reference). Avoid duplicating that work for every parcel.
 const speed=length(v),limit=s*.45/dt;if(speed>limit)for(let k=0;k<3;k++)v[k]*=limit/speed;predicted.set(p.map((x,k)=>x+v[k]*dt),o);}
 this.prepareTimes={pump:pumpDone-start,rain:rainDone-pumpDone,wetting:wetDone-rainDone,predict:performance.now()-wetDone};return {start,predictDone:performance.now(),old,predicted,s,scale,dt,generation:this.generation};}
 step(dt,deferDetail=false){
  const context=this.prepareStep(dt);
  if(this.optimizations?.gpuBatch&&!this.gpu.cpu&&this.count){
   this.gpu.solve(context.predicted,context.s,p=>this.collide(p),3,p=>this.solid(p),false,true);
   this.transportGPU.solve(context.old,context.old,this.velocities,this.chem,this.gpu.neighbors,context.s,context.scale,dt,context.predicted,this.gpu,true);
   const dispatched=performance.now();const probes=this.optimizations?.emitterProbes&&this.detail.enabled&&!this.gpu.cpuContacts?(this.emitterProbes??=new EmitterProbes(this.renderer,this.u)).update(this.gpu,this.transportGPU,this.count,this.spacing):null;
   const result=(this.stepReadback??=new StepReadback(this.renderer)).read(this.gpu,this.transportGPU,this.count,probes);
   this.prepareTimes.dispatch=dispatched-context.predictDone;this.prepareTimes.batch=performance.now()-dispatched;this.emitterSamples=result.emitterSamples;
   context.transport=result.transport;this.finishStep(context,result.positions,deferDetail);
  }else{this.emitterSamples=null;const next=this.gpu.solve(context.predicted,context.s,p=>this.collide(p),3,p=>this.solid(p));this.finishStep(context,next,deferDetail);}
 }

 finishStep(context,next,deferDetail=false){if(context.generation!==this.generation)return;const {start,predictDone,old,predicted,s,scale,dt}=context,solveDone=performance.now();const transport=context.transport??this.transportGPU.solve(old,next,this.velocities,this.chem,this.gpu.neighbors,s,scale,dt,predicted,this.gpu);
 this.velocities=transport.velocities;this.chem=transport.chem;this.surfaceMetrics=transport.metrics;this.neighborCounts=transport.counts;this.aerationActivity=transport.activity;this.surfaceBreakup=transport.breakup;
 if(this.player)for(let i=0;i<this.count;i++){const o=i*4,p=Array.from(next.subarray(o,o+3)),distance=this.playerDistance(p);if(distance>s*1.5)continue;const normal=normalAt(p,q=>this.playerDistance(q)),incoming=[0,1,2].map(k=>(predicted[o+k]-old[o+k])/dt),weight=clamp(1-distance/(s*1.5),0,1);this.velocities.set(softenPlayerImpulse(Array.from(this.velocities.subarray(o,o+3)),incoming,normal,weight),o);}
 this.positions=next;const emissionStart=performance.now();this.exchangeSediment(dt);if(this.detail.cpu!==this.gpu.cpu){this.detail.cpu=this.gpu.cpu;this.detail.reset();}this.detail.emit(this,dt);this.prepareTimes.emission=performance.now()-emissionStart;this.detailJet=this.jet;if(!deferDetail)this.detail.advance(dt,this);this.timings=context.transport?{predict:predictDone-start,constraintsTransportAndReadback:solveDone-predictDone,exchangeAndSpray:performance.now()-solveDone,readback:this.stepReadback.waitMs,readbacks:1}:{predict:predictDone-start,solve:solveDone-predictDone,transport:performance.now()-solveDone,readbacks:this.gpu.cpu?0:5};this.steps++;this.jet=null;this.revision++;}
 sampleFastSurface(i){return !this.neighborCounts||this.neighborCounts[i]<25;}
 exchangeSediment(dt){if(this.kind==='river')exchangeRiverSediment(this,dt);}
 addSolute(kind,point){let added=0;for(let i=0;i<this.count;i++){const o=i*4,d=length(point.map((v,k)=>v-this.positions[o+k]));if(d>this.radius)continue;const q=(kind==='dye'?2.5:.35)*(1-d/this.radius);this.chem[o+(kind==='dye'?0:1)]+=q;added+=q;}if(added)this.revision++;return added;}
 addSoluteNear(kind,point){let nearest=0,best=Infinity;for(let i=0;i<this.count;i++){const o=i*4,d=Math.hypot(point[0]-this.positions[o],point[1]-this.positions[o+1],point[2]-this.positions[o+2]);if(d<best){best=d;nearest=o;}}return this.addSolute(kind,Array.from(this.positions.subarray(nearest,nearest+3)));}
 pick(origin,direction){let closest=Infinity,index=-1;for(let i=0;i<this.count;i++){const p=[0,1,2].map(k=>this.positions[i*4+k]-origin[k]),t=p.reduce((v,x,k)=>v+x*direction[k],0),r=length(p.map((v,k)=>v-direction[k]*t));if(t>0&&r<this.spacing*1.4&&t<closest){closest=t;index=i;}}return index>=0?Array.from(this.positions.subarray(index*4,index*4+3)):null;}
 interact(origin,direction){if(this.asyncPending){this.queuedInteractions.push({origin:origin.slice(),direction:direction.slice(),tool:this.tool});return true;}if(this.tool==='wind'){this.jet={origin,direction};return true;}if(['glass','mirror','rock'].includes(this.tool)){this.spawn(this.tool,origin,direction);return true;}if(this.held){for(const i of this.held.ids){this.positions[i*4+3]=0;this.velocities.fill(0,i*4,i*4+3);}this.held=null;return true;}const point=this.pick(origin,direction);if(!point)return false;if(this.tool==='grab'){const ids=selectWaterParcels(this.positions,point,this.radius,this.spacing),offsets=ids.map(i=>Array.from(this.positions.subarray(i*4,i*4+3)).map((v,k)=>v-point[k]));for(const i of ids)this.positions[i*4+3]=1;this.held=ids.length?{ids,offsets,distance:Math.max(2,this.radius*2.5)}:null;}else if(this.tool==='dye'||this.tool==='tannin')this.addSolute(this.tool,point);else if(this.tool==='nudge'){const ids=selectWaterParcels(this.positions,point,this.radius,this.spacing);for(const i of ids){const o=i*4,r=length(point.map((v,k)=>v-this.positions[o+k])),weight=r<this.radius?1-r/this.radius:1;for(let k=0;k<3;k++)this.velocities[o+k]+=direction[k]*4*weight;}}return true;}
 moveHeld(origin,direction){if(!this.held)return;const h=this.held,center=origin.map((v,k)=>v+direction[k]*h.distance);h.ids.forEach((i,j)=>this.positions.set(center.map((v,k)=>v+h.offsets[j][k]),i*4));this.revision++;}
 advance(elapsed,camera){
  if(!this.enabled)return;pollLabReadbacks(this.renderer);camera.updateMatrixWorld();this.wetting.setCamera(camera,Math.max(.001,elapsed));
  const o=camera.position.toArray(),d=camera.getWorldDirection(new THREE.Vector3()).toArray();
  this.frameDrivenLens=true;
  // Account for *every* foreground frame, including frames awaiting a fence.
  // Drop missed whole steps rather than fast-forwarding after a slow frame.
  const wall=Math.min(.25,Math.max(0,elapsed));
  if(!this.paused){const allowance=simulationAllowance(this.accumulator,wall,this.simulationSpeed,this.timestep);this.droppedTime+=allowance.dropped;this.accumulator=allowance.time;this.wetting.stepLens(allowance.added);}
  this.rateWall+=Math.max(0,elapsed);this.rateSim+=this.completedDt;this.completedDt=0;
  if(this.rateWall>=.4){this.simRate=Math.min(this.simulationSpeed,this.rateSim/this.rateWall);this.rateWall=0;this.rateSim=0;}
  if(this.asyncPending)return;
  const interactions=this.queuedInteractions.splice(0);for(const event of interactions){const tool=this.tool;this.tool=event.tool;this.interact(event.origin,event.direction);this.tool=tool;}
  this.moveHeld(o,d);if(this.paused)return;
  const dt=this.timestep;
  if(this.asyncSimulation&&!this.gpu.cpu&&this.renderer.readRenderTargetPixelsAsync){this.simulationRay={origin:o,direction:d};this.lastAdvance=performance.now();this.startAsyncStep();return;}
  // Estimate the next solve before dispatch, rather than starting another
  // full solve with only a few milliseconds left in the frame budget. The
  // first step always runs so overload cannot starve simulation progress.
  const start=performance.now();let steps=0;
  while(this.accumulator>=dt&&steps<48&&(steps===0||performance.now()-start+(this.optimizations?.predictBudget?this.stepCostEstimate||0:0)<this.physicsBudgetMs)){
   steps++;if(this.windHeld)this.jet={origin:this.windRay?.origin||o,direction:this.windRay?.direction||d};
   const stepStart=performance.now();this.step(dt,true);const cost=performance.now()-stepStart;
   this.stepCostEstimate=this.stepCostEstimate?this.stepCostEstimate*.5+cost*.5:cost;this.accumulator-=dt;
  }
  if(steps)this.detail.advance(steps*dt,this,this.detailJet);this.completedDt+=steps*dt;
 }

 startAsyncStep(){
  const dt=this.timestep;if(!this.enabled||this.paused||this.gpu.cpu||this.asyncPending||this.accumulator<dt)return;
  if(this.windHeld)this.jet=this.windRay||this.simulationRay;

  const context=this.prepareStep(dt);this.accumulator-=dt;
  const result=this.gpu.solve(context.predicted,context.s,p=>this.collide(p),3,p=>this.solid(p),true);
  this.asyncPending=Promise.resolve(result).then(next=>{if(context.generation!==this.generation)return;this.finishStep(context,next);this.completedDt+=dt;}).catch(error=>{this.verification='Asynchronous GPU readback failed: '+error.message;this.gpu.cpu=true;}).finally(()=>{
   this.asyncPending=null;
   // Continue a bounded catch-up between displayed frames, yielding to input
   // between solves. Never wait an additional animation frame for a ready GPU.
   if(context.generation===this.generation&&this.accumulator>=this.timestep&&!this.asyncTimer){this.asyncTimer=setTimeout(()=>{this.asyncTimer=null;if(context.generation===this.generation&&performance.now()-this.lastAdvance<250)this.startAsyncStep();},0);}
  });
 }

 verify(){try{const r=LabFluidGPU.verify(this.renderer,this.u);this.verification=`${r.pass?'PASS':'FAIL'} · ${r.backend} density max error ${r.error.toExponential(2)} / 0.002 · wall ${r.boundaryError.toExponential(2)}`;if(!r.pass)this.gpu.cpu=true;return r;}catch(e){this.verification=e.message;this.gpu.cpu=true;return {pass:false,error:e.message};}}
 get suspendedSediment(){let sum=0;for(let i=2;i<this.chem.length;i+=4)sum+=this.chem[i]*this.spacing**3;return sum;}
}
