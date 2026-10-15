// A PBO copy followed by a fence. Poll on animation frames as well as timers:
// embedded/background views may throttle short setTimeout polls to 100+ ms.
// Neither polling nor retrieving a signalled buffer waits for the GPU.
const queues=new WeakMap();
export function pollLabReadbacks(renderer){for(const poll of [...(queues.get(renderer)||[])])poll();}
export function readLabPixelsAsync(renderer,target,width,height,buffer){
 if(!renderer.getContext)return renderer.readRenderTargetPixelsAsync(target,0,0,width,height,buffer);
 const gl=renderer.getContext(),previous=renderer.getRenderTarget(),pbo=gl.createBuffer();
 renderer.setRenderTarget(target);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pbo);gl.bufferData(gl.PIXEL_PACK_BUFFER,buffer.byteLength,gl.STREAM_READ);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,0);const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);renderer.setRenderTarget(previous);
 let queue=queues.get(renderer);if(!queue)queues.set(renderer,queue=new Set());
 return new Promise((resolve,reject)=>{
  let done=false,frame,timer;
  const cleanup=()=>{done=true;queue.delete(poll);if(frame!==undefined)cancelAnimationFrame(frame);clearTimeout(timer);gl.deleteSync(fence);gl.deleteBuffer(pbo);};
  const poll=()=>{if(done)return;const status=gl.clientWaitSync(fence,0,0);if(status===gl.TIMEOUT_EXPIRED)return;
   if(status===gl.WAIT_FAILED){cleanup();reject(new Error('Water GPU readback fence failed'));return;}
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pbo);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,buffer);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);cleanup();resolve(buffer);
  };
  const tick=()=>{poll();if(!done&&typeof requestAnimationFrame==='function')frame=requestAnimationFrame(tick);};
  const timerTick=()=>{poll();if(!done)timer=setTimeout(timerTick,4);};
  queue.add(poll);tick();if(!done)timer=setTimeout(timerTick,4);
 });
}
