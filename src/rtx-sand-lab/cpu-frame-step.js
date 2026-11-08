// The GPU has one immutable submitted frame. Use its completion wait for CPU
// field work, then publish/submit fine particles only after that frame finishes.
// No worker race, extra GPU queue, enlarged timestep, or camera-dependent physics.
export class CPUFrameStep {
 constructor(lab,{now=()=>performance.now()}={}){this.lab=lab;this.pending=null;this.now=now;}
 eligible(){const l=this.lab;return l.optimizations?.cpuFrameOverlap!==false&&l.bulkFields?.enabled&&l.bulkFields.backend==='cpu'&&l.bulkFields.particleBackend==='cpu'&&!l.gpu.cpu&&l.optimizations.gpuBatch&&l.count>0;}
 begin(){
  const l=this.lab;if(this.pending||l.asyncPending||l.renderPending||l.qaRunning||l.asyncSimulation===false||!this.eligible()||l.graphicsStopped||l.paused||!l.enabled||l.accumulator+1e-12<l.timestep)return false;
  const generation=l.generation;let resolve;
  const completion=new Promise(r=>resolve=r);this.pending={generation,resolve,completion};l.asyncPending=completion;
  l.accumulator=Math.max(0,l.accumulator-l.timestep);
  if(l.windHeld)l.jet=l.windRay||l.simulationRay;
  this.pending.dt=l.timestep;this.pending.steps=0;this.pending.simulated=0;
  return true;
 }
 compute(){
  const p=this.pending,l=this.lab;if(!p||p.computed||p.generation!==l.generation||l.graphicsStopped)return;
  const start=this.now(),batch=!!l.finishCPUFieldStep;
  do{
   if(l.windHeld)l.jet=l.windRay||l.simulationRay;
   p.context=l.prepareStep(p.dt);p.next=l.bulkFields.solve(p.context,{deferConsumers:true});
   if(batch){l.emitterSamples=null;l.finishCPUFieldStep(p.context,p.next);}
   p.steps++;p.simulated+=p.dt;
   // Only consume earned time, never replay missed wall time or exceed two
   // fixed steps. A costly first step disables catch-up for this frame.
   if(!batch||l.optimizations?.cpuCatchup!==true||p.steps>=2||l.accumulator+1e-12<p.dt||
      this.now()-start>125||l.paused||l.graphicsStopped||p.generation!==l.generation)break;
   l.accumulator=Math.max(0,l.accumulator-p.dt);
  }while(true);
  p.cpuMs=this.now()-start;p.computed=true;
 }
 publish(){
  const p=this.pending,l=this.lab;if(!p)return;
  try{
   if(p.computed&&p.generation===l.generation&&!l.graphicsStopped){
    const finishStart=this.now();
    if(l.finishCPUFieldStep)l.publishCPUFieldSteps(p.simulated);
    else{l.bulkFields.publishAir();l.emitterSamples=null;l.finishStep(p.context,p.next);}
    l.completedDt+=p.simulated;l.cpuFrameSteps=p.steps;l.overlappedCPUms=p.cpuMs+this.now()-finishStart;l.pipelineSubmitMs=l.overlappedCPUms;l.pipelineWaitMs=0;
   }
  }finally{this.cancel();}
 }
 cancel(){const p=this.pending;if(!p)return;this.pending=null;if(this.lab.asyncPending===p.completion)this.lab.asyncPending=null;p.resolve(false);}
}
