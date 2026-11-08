// A single queue submission may be in flight. GPU completion is observed
// before another frame or physics readback can submit work.
export class WebGPUFrameCompletion {
 constructor(renderer,{onFailure=()=>{}}={}){this.renderer=renderer;this.onFailure=onFailure;this.pending=null;}
 snapshot(){return {pending:!!this.pending,api:'WebGPU',lastComplete:this.lastComplete||null};}
 run(submit,{completionTimeoutMs=2000,cpuWork=null}={}){
  if(this.pending)return Promise.reject(Error('A WebGPU frame is already pending'));
  this.pending=(async()=>{await this.renderer.flush({timeoutMs:completionTimeoutMs});submit();await this.renderer.flush({timeoutMs:completionTimeoutMs,cpuWork});this.lastComplete=performance.now();})().catch(e=>{this.onFailure(e);throw e;}).finally(()=>{this.pending=null;});return this.pending;
 }
}
