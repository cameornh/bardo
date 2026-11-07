// One submitted frame at a time. CPU submission time says nothing about GPU
// completion: small final/display programs can be blamed for an earlier hang.
// Keep bounded per-pass fences so a failure reports unconfirmed work rather
// than assuming the last submitted pass caused it. This cannot preempt a
// single draw already executing in the driver.
export class FrameCompletion {
 constructor(renderer,{timeoutMs=2000,now=()=>performance.now(),wait=()=>new Promise(resolve=>setTimeout(resolve,4)),onFailure=()=>{}}={}){
  this.renderer=renderer;this.gl=renderer.getContext();this.timeoutMs=timeoutMs;this.now=now;this.wait=wait;this.onFailure=onFailure;this.passes=[];this.active=false;this.failed=null;this.pending=null;
  const render=renderer.render.bind(renderer);
  renderer.render=(scene,...args)=>{
   if(this.failed)throw this.failed;
   const names=[];
   if(this.active){scene.traverse?.(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)names.push(m.name||'unnamed');});this.submitting=names.join(', ')||'scene';}
   const result=render(scene,...args);
   if(this.active){this.checkpoint(this.submitting);this.submitting=null;}
   return result;
  };
 }
 snapshot(){
  return this.failureSnapshot||{pending:!!this.pending,lastConfirmedComplete:this.lastCompleted||null,firstUnconfirmed:this.passes[0]?.name||this.submitting||null,submitting:this.submitting||null,unconfirmedPasses:this.passes.map(p=>p.name)};
 }
 checkpoint(name){
  if(this.gl.isContextLost())throw Error('Graphics context lost before completion of '+name);
  this.poll();
  // A corrupt / unexpectedly expanded frame must not allocate unbounded
  // synchronization objects. No additional draw follows this exception.
  if(this.passes.length>=128)throw Error('Frame submission limit reached; last completed: '+(this.lastCompleted||'none'));
  const fence=this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if(!fence)throw Error('Could not track GPU completion of '+name);
  this.passes.push({name,fence});
 }
 poll(){
  const gl=this.gl;if(gl.isContextLost())throw Error('Graphics context lost; first outstanding pass: '+(this.passes[0]?.name||'none'));
  while(this.passes.length){
   const pass=this.passes[0],status=gl.clientWaitSync(pass.fence,0,0);
   if(status===gl.TIMEOUT_EXPIRED)break;
   if(status!==gl.ALREADY_SIGNALED&&status!==gl.CONDITION_SATISFIED)throw Error('GPU completion check failed at '+pass.name);
   this.lastCompleted=pass.name;gl.deleteSync(pass.fence);this.passes.shift();
  }
 }
 async finish(){
  this.gl.flush();const start=this.now();
  while(this.passes.length){
   this.poll();if(!this.passes.length)break;
   if(this.now()-start>this.timeoutMs)throw Error('GPU frame exceeded completion budget. Last completed: '+(this.lastCompleted||'none')+'. First outstanding: '+this.passes[0].name+'. No further frames submitted.');
   await this.wait();
  }
 }
 run(submit){
  if(this.failed)return Promise.reject(this.failed);
  if(this.pending)return Promise.reject(Error('A graphics frame is already pending'));
  // Install the guard before executing user code; all GL submission remains
  // synchronous within one frame, preserving uniform and camera snapshots.
  this.pending=Promise.resolve().then(async()=>{
   this.checkpoint('work queued before frame');await this.finish();
   this.active=true;try{submit();}finally{this.active=false;}
   await this.finish();
  }).catch(error=>{
   // Preserve evidence before cleanup, including synchronous draw failures.
   // The first unconfirmed pass is a lower bound, not proof of the culprit.
   this.failureSnapshot=this.snapshot();
   this.failed=error instanceof Error?error:Error(String(error));
   this.onFailure(this.failed);throw this.failed;
  }).finally(()=>{
   if(!this.gl.isContextLost())for(const pass of this.passes)this.gl.deleteSync(pass.fence);
   this.passes=[];this.pending=null;
  });
  return this.pending;
 }
}
