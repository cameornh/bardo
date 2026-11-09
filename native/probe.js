import {openWindow} from './window.js';
import {nativeSurfaceContext} from './surface.js';
const frames=Math.max(1,Math.min(300,Number(Deno.args.find(s=>s.startsWith('--frames='))?.split('=')[1])||1));
const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('No native GPU adapter');
const device=await adapter.requestDevice(),win=openWindow({width:320,height:200}),context=nativeSurfaceContext(win.surface);
try{
 context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
 for(let i=0;i<5;i++){win.poll(()=>{});await new Promise(r=>setTimeout(r,20));}
 for(let i=0;i<frames;i++){
  win.poll(()=>{});const encoder=device.createCommandEncoder();encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:.1,g:.3,b:.4,a:1},loadOp:'clear',storeOp:'store'}]}).end();device.queue.submit([encoder.finish()]);context.present();await device.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,40));
 }
 console.log(JSON.stringify({pass:true,frames,adapter:adapter.info}));
}finally{device.destroy();win.close();}
