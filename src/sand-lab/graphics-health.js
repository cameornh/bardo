// One context request, before loading any simulation resources. Keep the
// browser's creation-error message: THREE's generic exception discards it.
export function requestLabContext(canvas,options={}){
 let reason='';
 const failed=e=>{reason=e.statusMessage||reason;};
 canvas.addEventListener('webglcontextcreationerror',failed);
 try{
  const context=canvas.getContext('webgl2',{
   alpha:true,depth:true,stencil:false,antialias:false,premultipliedAlpha:true,
   preserveDrawingBuffer:false,powerPreference:'default',failIfMajorPerformanceCaveat:false,
   ...options,
  });
  if(!context)throw new Error('WebGL 2 is unavailable. The scene has not started.\n'+
   (reason?'Browser report: '+reason:'The browser did not provide a reason.')+
   '\nGraphics-only check: /tests/sand-graphics-health.html');
  return context;
 }finally{canvas.removeEventListener('webglcontextcreationerror',failed);}
}

export function createLabRenderer(Renderer,options,report){
 try{
  const {canvas,...attributes}=options,context=requestLabContext(canvas,attributes);
  return new Renderer({...options,context});
 }catch(error){report(error);throw error;}
}

// A failed draw must not resubmit the same driver work on every animation
// frame. Latch the first failure, including async shader warmup failures.
export function installGraphicsGuard(renderer,report){
 let failure=null;
 const stop=error=>{
  if(!failure){failure=error instanceof Error?error:new Error(String(error));report(failure);}
  return failure;
 };
 const assertHealthy=()=>{
  if(failure)throw failure;
  if(renderer.getContext().isContextLost())throw stop(new Error('Graphics context lost. The scene is stopped; reload to retry.'));
 };
 const render=renderer.render.bind(renderer);
 renderer.render=(...args)=>{assertHealthy();try{return render(...args);}catch(error){throw stop(error);}};
 if(renderer.compileAsync){
  const compile=renderer.compileAsync.bind(renderer);
  renderer.compileAsync=(...args)=>{
   assertHealthy();
   try{return Promise.resolve(compile(...args)).catch(error=>{throw stop(error);});}
   catch(error){throw stop(error);}
  };
 }
 renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
  const details=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n');
  const name=gl.getShaderSource(fragment)?.match(/#define SHADER_NAME (.*)/)?.[1]||'unnamed shader';
  throw stop(new Error('Graphics shader failed: '+name+'\n'+(details||'The graphics driver returned no error log.')+'\n'+JSON.stringify({vertexCompiled:gl.getShaderParameter?.(vertex,gl.COMPILE_STATUS),fragmentCompiled:gl.getShaderParameter?.(fragment,gl.COMPILE_STATUS),linked:gl.getProgramParameter?.(program,gl.LINK_STATUS),contextLost:gl.isContextLost?.(),glError:gl.getError?.()})+'\nThe scene is stopped to prevent repeated failures.'));
 };
 renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();stop(new Error('Graphics context lost. The scene is stopped; reload to retry.'));});
 return {get failed(){return !!failure;},stop,assertHealthy};
}
