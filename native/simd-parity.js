import {runNative} from './runtime.js';
// Frozen rendering comparison after bounded CPU SIMD playback with edits.
await runNative({width:640,height:400,resolution:1,backend:'safe',headless:true,report:'.native/simd-parity-runtime.json',exit:true,onReady:async({app,dom,capture,shutdown})=>{
 const {lab,draw,renderer,field}=app;lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();
 for(const name of ['simdPressure','simdParticles']){const input=document.getElementById('optimization-'+name);if(!input||input.checked)throw Error('SIMD trial must start off');input.checked=true;dom.emit(input,'change');if(!lab.optimizations[name])throw Error('SIMD checkbox did not apply');}
 lab.wind=12;lab.tidesEnabled=false;lab.lunarCycle=false;lab.day=14;
 const chunks=lab.sand.extract([0,lab.sand.height(0,3),3],.2,[0,0,0],true);for(const p of chunks){p.held=false;p.position[1]+=.2;}
 lab.sand.carve([.4,lab.sand.height(.4,3),3],.16);lab.objectRadius=.25;lab.spawn('glass',[1,2,2],[0,0,-1],'cup');
 for(let i=0;i<12;i++){
  const ctx=lab.prepareStep(lab.timestep),next=lab.bulkFields.solve(ctx,{deferConsumers:true});lab.finishCPUFieldStep(ctx,next);
  lab.publishCPUFieldSteps(lab.timestep);draw.render({dt:lab.timestep,adaptive:false});await renderer.flush();
  if(renderer.failure)throw renderer.failure;if(!lab.positions.every(Number.isFinite))throw Error('Non-finite physics state');
 }
 const backend={pressure:lab.bulkFields.stats.backend,surface:lab.bulkFields.stats.surfaceBackend};
 if(!backend.pressure.includes('SIMD')||!backend.surface.includes('SIMD'))throw Error('SIMD was not active');
 const t=field.target,sample=async simd=>{lab.optimizations.simdPressure=lab.optimizations.simdParticles=simd;draw.render({dt:0,adaptive:false});await renderer.flush();const a=new Float32Array(t.width*t.height*4);await renderer.readRenderTargetPixelsAsync(t,0,0,t.width,t.height,a);return a;};
 await sample(false);const a=await sample(false),b=await sample(true);let max=0,sum=0,nonfinite=0,n=0;
 for(let i=0;i<a.length;i++){if(i%4===3)continue;const e=Math.abs(a[i]-b[i]);if(!Number.isFinite(e))nonfinite++;else{max=Math.max(max,e);sum+=e;n++;}}
 const result={pass:!nonfinite&&max<1e-5&&!renderer.failure,backend,width:t.width,height:t.height,meanAbsoluteRGB:sum/n,maxAbsoluteRGB:max,nonfinite,steps:12,simulatedSeconds:lab.time,objects:lab.balls.length,sandParcels:lab.sand.parcels.length};
 await capture('.native/simd-parity.png');await Deno.writeTextFile('.native/simd-parity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await shutdown();Deno.exit(result.pass?0:1);
}});
