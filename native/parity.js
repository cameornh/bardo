import {runNative} from './runtime.js';
// One frozen image, before physics; readback is test-only.
await runNative({width:640,height:400,resolution:1,backend:'safe',headless:true,exit:true,report:'.native/frozen-native.json',onReady:async({app,capture,shutdown})=>{
 app.lab.qaRunning=true;app.lab.paused=true;await app.waitForSceneIdle();
 app.lab.configure('ocean');app.lab.day=14;document.getElementById('home').click();
 for(let i=0;i<2;i++){app.draw.render({dt:0,adaptive:false});await app.renderer.flush();}
 const t=app.field.target,a=new Float32Array(t.width*t.height*4);await app.renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,a);
 await Deno.writeFile('.native/frozen-native.f32',new Uint8Array(a.buffer));await capture('.native/frozen-native.png');await shutdown();Deno.exit(0);
}});
