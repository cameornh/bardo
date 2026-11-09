// Explicit lifetime for native swapchain images: Deno drops its current-image
// reference on present, but JS GC may retain earlier texture wrappers. Browser
// canvases expire those resources automatically; our host releases them here.
export function nativeSurfaceContext(surface,onReconfigure=()=>{}){
 const context=surface.getContext('webgpu');let current,configuration;
 return {configure(config){configuration=config;context.configure(config);},getCurrentTexture(){
  if(current)return current;
  try{return current=context.getCurrentTexture();}catch(error){
   // wgpu surfaces can become outdated on resize, display/GPU switching or
   // occlusion. Deno currently folds those statuses into this one message.
   // Retry once after reconfiguration; device/shader errors still stop work.
   if(error.message!=='Invalid Surface Status')throw error;
   context.configure(configuration);onReconfigure();return current=context.getCurrentTexture();
  }
 },present(){if(!current)return;surface.present();current.destroy();current=null;}};
}
