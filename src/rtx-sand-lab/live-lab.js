import {SandLab} from '../sand-lab/lab.js';
import {StepReadback} from '../sand-lab/gpu-step-readback.js';
import {EmitterProbes} from '../sand-lab/emitter-probes.js';

// Shared live experience. Historical fixtures still instantiate SandLab.
// Only one physics step may be in flight; fixed dt, mass and forces are unchanged.
export class LiveSandLab extends SandLab{
 startAsyncStep(){
  const dt=this.timestep,generation=this.generation;
  if(!this.asyncSimulation||!this.enabled||this.paused||this.qaRunning||this.gpu.cpu||this.asyncPending||this.accumulator+1e-12<dt)return;
  if(this.windHeld)this.jet=this.windRay||this.simulationRay;
  this.accumulator=Math.max(0,this.accumulator-dt);
  // Install the pending guard before preparing a step or invoking a thenable.
  this.asyncPending=Promise.resolve().then(()=>{
   if(generation!==this.generation)return false;
   const start=performance.now();
   if(!this.optimizations?.gpuBatch||!this.count){this.step(dt);return true;}
   const context=this.prepareStep(dt);
   this.gpu.solve(context.predicted,context.s,p=>this.collide(p),3,p=>this.solid(p),false,true);
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
    // A failed optional transfer is not retried on the next frame.
    this.verification='Asynchronous simulation stopped: '+error.message;
    this.asyncSimulation=false;this.gpu.forceCPUConstraints=true;
    this.pipelineError=error.message;
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
}
