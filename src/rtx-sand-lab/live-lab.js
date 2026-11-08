import {CPUFrameStep} from './cpu-frame-step.js';
import {SandLab} from '../sand-lab/lab.js';
import {WaterLab} from '../sand-lab/water-lab.js';
import {StepReadback} from '../sand-lab/gpu-step-readback.js';
import {EmitterProbes} from '../sand-lab/emitter-probes.js';
import {SandEditPolicy} from './sand-edit-policy.js';
import {resolveCarvedSandContacts} from './carved-sand-contacts.js';
import {BoundsGrid} from '../sand-lab/spatial-bounds.js';
import {LIVE_WIND_BRUSH,windBrushErosion} from './wind-brush.js';
import {IncrementalSand} from './incremental-sand.js';
import {SandDistanceCache} from './sand-distance-cache.js';
import {LiveRigidPhysics} from './rigid-physics.js';
import {createSandWind} from '../sand-lab/sand-air.js';
import {LiveSandAirGeometry,installSandContactQueries} from './sand-cpu-queries.js';
import {BeachFields} from './fields/beach-fields.js';
export {LIVE_WIND_BRUSH} from './wind-brush.js';

// Shared live experience. Historical fixtures still instantiate SandLab.
// Only one physics step may be in flight; fixed dt, mass and forces are unchanged.
export class LiveSandLab extends SandLab{
 constructor(...args){super(...args);this.windStrength=LIVE_WIND_BRUSH.initial;this.rigidContacts=new LiveRigidPhysics();Object.assign(this.optimizations,{collisionMesh:true,rigidReuse:true,rigidSleep:true,rigidBroadphase:true,fineParticleResolution:true,cpuSandQueries:true,cpuFrameOverlap:true,cpuCatchup:true,nativeFieldTransfer:true});if(args[1]?.bulkFields)this.bulkFields=new BeachFields(this);}
 syncSandUniforms(){
  if(!this.sand)return;
  if(this.optimizations?.sandCache===false||this.optimizations?.compactSand===false){this.incrementalSand=null;this.distanceCache?.reset();return super.syncSandUniforms();}
  if(this.sand.dirty)this.sand.update();if(this.sandRevision===this.sand.revision)return;
  if(this.incrementalSand?.bed!==this.sand){this.distanceCache?.reset();this.incrementalSand=new IncrementalSand(this.sand);}
  this.incrementalSand.update(this);
  (this.distanceCache??=new SandDistanceCache()).refresh(this.sandRenderParcels);
 }
 configure(...args){this.cpuFrameStep?.cancel();super.configure(...args);this.bulkFields?.reset();if(this.sand){this.sand.editPolicy=new SandEditPolicy();this.sand.windBrushErosion=windBrushErosion;installSandContactQueries(this.sand,()=>this.optimizations.cpuSandQueries!==false);}}
 createSandWind(){
  if(this.optimizations.cpuSandQueries===false||!this.optimizations.windGeometry)return createSandWind(this);
  if(this.sandAirGeometry?.bed!==this.sand)this.sandAirGeometry=new LiveSandAirGeometry(this.sand,this.balls);
  const geometry=this.sandAirGeometry;geometry.bodies=this.balls;geometry.endMoving();const wind=createSandWind(this,geometry);
  wind.beginMoving=()=>geometry.beginMoving();wind.endMoving=()=>geometry.endMoving();wind.moved=group=>geometry.moved(group);return wind;
 }
 prepareStep(dt){if(this.bulkFields?.enabled)this.bulkFields.ensure();return super.prepareStep(dt);}
 finishCPUFieldStep(context,next){
  // Bulk physics retains its fixed step. Fine visual consumers are published
  // once after the immutable drawing frame completes, as in the synchronous
  // solver's deferred-detail path. No graphics submission inside CPU overlap.
  WaterLab.prototype.finishStep.call(this,context,next,true);this.fluidIndex=null;
 }
 publishCPUFieldSteps(dt){
  this.bulkFields.publishAir();this.detail.advance(dt,this,this.detailJet);
  this.grains?.advance(dt);this.seaFoam?.advance(dt,this);
 }
 step(dt,deferDetail=false){
  if(this.graphicsStopped)return;
  if(!this.bulkFields?.enabled||!this.count)return super.step(dt,deferDetail);
  const context=this.prepareStep(dt),next=this.bulkFields.solve(context);
  this.finishStep(context,next,deferDetail);
 }
 resolveSandObjectContacts(dt){this.sandContactStats=resolveCarvedSandContacts(this.sand.parcels,this.balls,dt,this.optimizations?.broadphase?(this.sandContactGrid??=new BoundsGrid()):null);}
 moveHeld(origin,direction){
  // A stationary held handful used to invalidate the entire terrain and
  // lighting reconstruction on every display frame, even while paused.
  if(this.sandHeld&&!this.held&&!this.heldBody){
   const distance=this.sandHoldDistance;
   if(distance!==undefined&&this.sandHeld.every(p=>p.position.every((v,k)=>Math.abs(v-(origin[k]+direction[k]*distance+p.offset[k]))<1e-10)))return;
  }
  super.moveHeld(origin,direction);
 }
 startAsyncStep(){
  if(this.deferFieldSolve&&(this.cpuFrameStep??=new CPUFrameStep(this)).eligible()){this.cpuFrameStep.begin();return;}
  const dt=this.timestep,generation=this.generation;
  if(this.graphicsStopped||this.renderPending||!this.asyncSimulation||!this.enabled||this.paused||this.qaRunning||this.gpu.cpu||this.asyncPending||this.accumulator+1e-12<dt)return;
  if(this.windHeld)this.jet=this.windRay||this.simulationRay;
  this.accumulator=Math.max(0,this.accumulator-dt);
  // Install the pending guard before preparing a step or invoking a thenable.
  this.asyncPending=Promise.resolve().then(async()=>{
   if(generation!==this.generation)return false;
   const start=performance.now();
   if(!this.optimizations?.gpuBatch||!this.count){this.step(dt);return true;}
   const context=this.prepareStep(dt);
   if(this.bulkFields?.enabled){
    const next=await this.bulkFields.solveAsync(context);if(!next||generation!==this.generation)return false;
    // The field backend supplies matching transport, either on CPU or in
    // its single packed WebGPU result. Do not run legacy transport again.
    this.emitterSamples=null;this.pipelineSubmitMs=performance.now()-start;this.pipelineWaitMs=0;
    this.finishStep(context,next);
    if(context.particleReadback)this.timings={...this.timings,readback:context.particleReadback.waitMs,readbacks:1,readbackBytes:context.particleReadback.readbackBytes};return true;
   }
   else this.gpu.solve(context.predicted,context.s,p=>this.collide(p),3,p=>this.solid(p),false,true);
   this.transportGPU.solve(context.old,context.old,this.velocities,this.chem,this.gpu.neighbors,context.s,context.scale,dt,context.predicted,this.gpu,true);
   const probes=this.optimizations?.emitterProbes&&this.detail.enabled&&!this.gpu.cpuContacts?
    (this.emitterProbes??=new EmitterProbes(this.renderer,this.u)).update(this.gpu,this.transportGPU,this.count,this.spacing):null;
   this.pipelineSubmitMs=performance.now()-start;
   return (this.stepReadback??=new StepReadback(this.renderer)).read(this.gpu,this.transportGPU,this.count,probes,true).then(result=>{
    if(generation!==this.generation)return false;
    this.gpu.finishDeferredPressure?.(result.positions);
    this.emitterSamples=result.emitterSamples;context.transport=result.transport;
    this.finishStep(context,result.positions);
    this.pipelineWaitMs=this.stepReadback.waitMs;
    return true;
   });
  }).then(completed=>{if(completed&&generation===this.generation)this.completedDt+=dt;})
   .catch(error=>{
    if(generation!==this.generation)return;
    // A failed transfer must not silently switch to synchronous physics and
    // immediately submit more transport/render work to the same GPU.
    this.verification='Asynchronous simulation stopped: '+error.message;
    this.asyncSimulation=false;this.gpu.forceCPUConstraints=true;
    this.stopGraphicsWork(error);this.onGraphicsFailure?.(error);
   }).finally(()=>{
    this.asyncPending=null;
    // Consume only time already earned by foreground frames. Yield between
    // solves, and never create a queue of GPU jobs or run hidden-tab catch-up.
    if(generation===this.generation&&this.accumulator>=this.timestep&&!this.asyncTimer){
     this.asyncTimer=setTimeout(()=>{this.asyncTimer=null;
      if(generation===this.generation&&performance.now()-this.lastAdvance<100)this.startAsyncStep();
     },0);
    }
   });
 }
 stopGraphicsWork(error){
  if(this.graphicsStopped)return;
  this.graphicsStopped=true;this.generation++;this.cpuFrameStep?.cancel();
  this.enabled=false;this.paused=true;this.asyncSimulation=false;this.accumulator=0;
  if(this.asyncTimer){clearTimeout(this.asyncTimer);this.asyncTimer=null;}
  // Existing awaited steps check generation before publishing or finishing.
  // Do not switch to another GPU path or retry a damaged graphics context.
  this.pipelineError=error?.message||String(error);
 }
}
