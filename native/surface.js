// Explicit lifetime for native swapchain images: Deno drops its current-image
// reference on present, but JS GC may retain earlier texture wrappers. Browser
// canvases expire those resources automatically; our host releases them here.
export function nativeSurfaceContext(surface,onReconfigure=()=>{},{isVisible=()=>true}={}){
 const context=surface.getContext('webgpu');let current,configuration,temporary=false,disposed=false;
 const stats={acquired:0,presented:0,skipped:0,reconfigures:0,temporaryBytes:0,peakTemporaryBytes:0};
 const retire=()=>{const image=current;current=null;temporary=false;stats.temporaryBytes=0;image?.destroy();};
 const hiddenFrame=()=>{
  // Visibility may change while a frame awaits shader preparation/completion.
  // Finish that ONE in-flight frame without asking an occluded native surface
  // for a drawable. The host suspends subsequent frames. No extra visible blit.
  const width=surface.width,height=surface.height;
  if(!configuration||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1920||height>1080)throw Error('Invalid hidden native frame size');
  current=configuration.device.createTexture({label:'hidden native frame',size:[width,height],format:configuration.format,usage:configuration.usage??0x10,viewFormats:configuration.viewFormats??[]});
  temporary=true;stats.temporaryBytes=width*height*(configuration.format==='rgba16float'?8:4);stats.peakTemporaryBytes=Math.max(stats.peakTemporaryBytes,stats.temporaryBytes);return current;
 };
 const acquire=()=>{current=context.getCurrentTexture();stats.acquired++;return current;};
 return {stats,get temporary(){return temporary;},configure(config){
  if(disposed)throw Error('Native surface is disposed');if(current)throw Error('Cannot reconfigure an outstanding native image');
  context.configure(config);configuration=config;
 },getCurrentTexture(){
  if(disposed)throw Error('Native surface is disposed');if(current)return current;
  if(!isVisible())return hiddenFrame();
  try{return acquire();}catch(error){
   // Deno 2.9.8 collapses timeout/outdated/lost surface statuses into this
   // message. Never swallow unrelated errors or retry indefinitely.
   if(error.message!=='Invalid Surface Status')throw error;
   if(!isVisible())return hiddenFrame();
   context.configure(configuration);stats.reconfigures++;onReconfigure();
   if(!isVisible())return hiddenFrame();
   try{return acquire();}catch(retry){if(retry.message==='Invalid Surface Status'&&!isVisible())return hiddenFrame();throw retry;}
  }
 },present(){
  if(!current)return false;
  try{if(temporary){stats.skipped++;return false;}surface.present();stats.presented++;return true;}
  finally{retire();}
 },dispose(){if(disposed)return;disposed=true;retire();context.unconfigure?.();}};
}
