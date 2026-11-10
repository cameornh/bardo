import {runNative} from './runtime.js';
import {deferredQueueCompletion} from './completion.js';
// Frozen full renderer: only the host completion policy changes. No physics,
// camera, material, resolution, shader or pass-count changes between images.
await runNative({width:640,height:400,resolution:1,backend:'safe',headless:true,report:'.native/waits-parity-runtime.json',exit:true,onReady:async({app,capture,shutdown})=>{
 const {lab,draw,renderer,field}=app;lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();lab.configure('ocean');lab.day=14;document.getElementById('home').click();
 const t=field.target,sample=async(policy)=>{renderer.options.queueCompletion=policy;draw.render({dt:0,adaptive:false});await renderer.flush();const a=new Float32Array(t.width*t.height*4);await renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,a);return a;};
 await sample(undefined);const before=await sample(undefined),after=await sample(deferredQueueCompletion);let max=0,sum=0,nonfinite=0,n=0;
 for(let i=0;i<before.length;i++){if(i%4===3)continue;const error=Math.abs(before[i]-after[i]);if(!Number.isFinite(error))nonfinite++;else{max=Math.max(max,error);sum+=error;n++;}}
 const result={pass:!nonfinite&&max<1e-5,width:t.width,height:t.height,meanAbsoluteRGB:sum/n,maxAbsoluteRGB:max,nonfinite,simulationTime:lab.time};
 await capture('.native/waits-parity.png');await Deno.writeTextFile('.native/waits-parity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await shutdown();Deno.exit(result.pass?0:1);
}});
