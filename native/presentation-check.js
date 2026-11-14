import {runNative} from './runtime.js';
import {nativeSurfaceContext} from './surface.js';

// Isolated full-scene presentation regression. A real native-window playback
// run is separate from deterministic offscreen visibility changes; never open
// two GPU workloads at once. No production scene/test implementation changes.
const windowed=Deno.args.includes('--window'),dir='.native/surface-lifecycle';
await Deno.mkdir(dir,{recursive:true});
await runNative({width:640,height:400,resolution:1.4,backend:'safe',headless:!windowed,frames:windowed?96:0,exit:true,report:dir+(windowed?'/full-window.json':'/full-offscreen.json'),screenshot:dir+'/playback.png',onReady:async({app,reports,capture,shutdown})=>{
 const {lab,draw,renderer,field}=app;lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();
 draw.fixedLoadScale=.5;document.getElementById('adaptive').checked=false;
 lab.wind=12;lab.tidesEnabled=false;lab.lunarCycle=false;lab.day=14;lab.rain.enabled=true;lab.rain.rate=120;lab.tannins=.8;
 lab.objectRadius=.2;lab.spawn('glass',[0,2.5,2],[0,0,-1],'sphere');lab.spawn('rock',[1,2.5,2],[0,0,-1],'cup');
 lab.sand.carve([0,lab.sand.height(0,3),3],.3);lab.syncUniforms();draw.drawKey=null;
 reports.fixture={waterSamples:lab.count,objects:lab.balls.length,wind:lab.wind,rain:lab.rain.rate,discardFrames:16};
 if(windowed){
  // This timeout stops cleanly if the window stays hidden. Hidden wall time is
  // not misrepresented as a throughput loss or a graphics-device failure.
  const timer=setTimeout(async()=>{reports.error='Window playback did not finish within 90 seconds';lab.qaRunning=true;await shutdown();Deno.exit(1);},90000);
  timer.unref?.();reports.totalFrames=0;reports.frames=[];lab.qaRunning=false;lab.paused=false;document.getElementById('pause').textContent='Pause';return;
 }
 // Exercise the *production* presentation adapter and full scene shaders on
 // the actual GPU. Stand-in visible targets avoid depending on UI automation;
 // the tiny lifecycle check separately covers real OS window drawables.
 const original=renderer.context;let visible=true;
 const configuration={device:renderer.device,format:renderer.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC};
 const surface={width:640,height:400,getContext:()=>({configure(){},getCurrentTexture(){return renderer.device.createTexture({size:[640,400],format:renderer.format,usage:configuration.usage});}}),present(){}};
 const context=nativeSurfaceContext(surface,()=>{}, {isVisible:()=>visible});context.configure(configuration);renderer.context=context;
 const result={checks:[],backend:'native wgpu / CPU physics',visibility:'injected signal; real GPU textures, not OS hide/restore'};
 async function sample(show,dt=0){
  visible=show;draw.render({dt,adaptive:false});await renderer.flush();
  const t=field.target,pixels=new Float32Array(t.width*t.height*4);await renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,pixels);renderer.assertHealthy();
  const presented=context.present();if(presented!==show)throw Error('Incorrect presentation state');
  if(context.stats.temporaryBytes!==0)throw Error('Temporary image leaked');return pixels;
 }
 try{
  await sample(true);const before=await sample(true),hidden=await sample(false),restored=await sample(true);
  for(const [label,pixels] of [['hidden',hidden],['restored',restored]]){let max=0,sum=0;for(let i=0;i<before.length;i++){if(i%4===3)continue;const e=Math.abs(before[i]-pixels[i]);if(!Number.isFinite(e))throw Error('Nonfinite image');max=Math.max(max,e);sum+=e;}result.checks.push({label,maxAbsoluteRGB:max,meanAbsoluteRGB:sum/(before.length*.75)});if(max>1e-5)throw Error('Frozen scene changed');}
  await capture(dir+'/frozen.png');
  // Fixed steps continue through one hidden in-flight frame in each group;
  // this verifies state preservation, not a performance benchmark.
  for(let i=0;i<24;i++){lab.step(lab.timestep);await sample(i%3!==1,lab.timestep);}
  await capture(dir+'/offscreen-playback.png');result.steps=24;result.simulation=lab.time;result.presentation={...context.stats};result.pass=true;
 }catch(error){result.pass=false;result.error=String(error.stack||error);}
 finally{context.dispose();renderer.context=original;await Deno.writeTextFile(dir+'/scene-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await shutdown();}
 Deno.exit(result.pass?0:1);
}});
