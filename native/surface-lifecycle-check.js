import {openWindow} from './window.js';
import {nativeSurfaceContext} from './surface.js';
import {nativeWindowVisible} from './window-state.js';
// Tiny bounded clear/readback test; never loads the scene or compiles shaders.
const interactive=Deno.args.includes('--interactive'),dir='.native/surface-lifecycle';await Deno.mkdir(dir,{recursive:true});
const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('No adapter');
const device=await adapter.requestDevice(),win=openWindow({width:640,height:400});let forcedHidden=false,finished=false,deviceLoss=null,validation=null;
const result={checks:[],statuses:[],adapter:Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,adapter.info[k]])),interactive};
device.lost.then(info=>{if(!finished)deviceLoss={reason:info.reason,message:info.message};});device.addEventListener('uncapturederror',e=>validation=e.error.message);
const context=nativeSurfaceContext(win.surface,()=>{}, {isVisible:()=>!forcedHidden&&nativeWindowVisible(win.status(),win.mac)});
async function limit(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('GPU completion exceeded 2 seconds')),2000);})]);}finally{clearTimeout(timer);}}
function assert(v,m){if(!v)throw Error(m);}
async function frame(read=false){
 win.poll(()=>{});const image=context.getCurrentTexture(),hidden=context.temporary;
 const encoder=device.createCommandEncoder();encoder.beginRenderPass({colorAttachments:[{view:image.createView(),clearValue:{r:.25,g:.5,b:.75,a:1},loadOp:'clear',storeOp:'store'}]}).end();
 let buffer;if(read){buffer=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});encoder.copyTextureToBuffer({texture:image},{buffer,bytesPerRow:256},[1,1]);}
 device.queue.submit([encoder.finish()]);await limit(device.queue.onSubmittedWorkDone());
 let pixel;if(buffer){try{await limit(buffer.mapAsync(GPUMapMode.READ));pixel=Array.from(new Uint8Array(buffer.getMappedRange()).slice(0,4));}finally{buffer.unmap();buffer.destroy();}const expected=navigator.gpu.getPreferredCanvasFormat()==='bgra8unorm'?[191,128,64,255]:[64,128,191,255];assert(pixel.every((v,i)=>Math.abs(v-expected[i])<=1),'Pixel mismatch '+pixel);}
 const presented=context.present();assert(presented!==hidden,'Presentation accounting mismatch');assert(!validation&&!deviceLoss,'GPU error');return {hidden,presented,pixel};
}
try{
 context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC,alphaMode:'opaque'});
 for(let i=0;i<5;i++){win.poll(()=>{});await new Promise(r=>setTimeout(r,20));}
 // Both paths use the actual Metal device and exact texture format. Alternating
 // only the visibility signal isolates the in-flight hidden-frame handoff.
 for(let i=0;i<24;i++){forcedHidden=i%2===1;result.checks.push(await frame(true));await new Promise(r=>setTimeout(r,20));}
 forcedHidden=false;
 if(interactive){
  win.title('Surface lifecycle check · minimize then restore');console.log('READY_FOR_WINDOW_CHECK');
  const start=performance.now();let wasHidden=false,resumed=0,previous;
  while(performance.now()-start<60000){
   win.poll(()=>{});const status=win.status(),visible=nativeWindowVisible(status,win.mac);
   if(visible!==previous){result.statuses.push({ms:performance.now()-start,status,visible});previous=visible;console.log('VISIBILITY',visible,status);}
   if(!visible){wasHidden=true;const f=await frame();assert(!f.presented,'Hidden window presented');}
   else {await frame();if(wasHidden&&++resumed>=12)break;}
   await new Promise(r=>setTimeout(r,80));
  }
  result.resumed=resumed;result.incomplete=!(wasHidden&&resumed===12);assert(!result.incomplete,'Window hide/restore was not observed');
 }
 result.pass=true;
}catch(error){result.pass=false;result.error=String(error.stack||error);}
finally{result.presentation={...context.stats};result.deviceLoss=deviceLoss;result.validation=validation;finished=true;context.dispose();device.destroy();win.close();await Deno.writeTextFile(dir+(interactive?'/window.json':'/gpu.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
Deno.exit(result.pass?0:1);
