import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {configureRTXLab,rendererInfo,applyRTXBackend} from '../src/rtx-sand-lab/profile.js';
import {installRTXGraphicsGuard} from '../src/rtx-sand-lab/graphics.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {liveProgramConstants} from '../src/rtx-sand-lab/shader-dependencies.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {prepareShaderJobs,firstFrameShaderJobs,createShaderExercise} from '../src/rtx-sand-lab/shader-startup.js';
import {MotionDetail} from '../src/lod.js';
import {SeaFoam} from '../src/sand-lab/sea-foam.js';
import {densityKernelReady} from '../src/sand-lab/native-density.js';
import {neighborKernelReady} from '../src/sand-lab/native-neighbors.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const out=document.querySelector('#result'),button=document.querySelector('#run'),compileButton=document.querySelector('#compile');
// Explicit one-shot checks only; opening this page creates no graphics context.
button.onclick=()=>run(false);
compileButton.onclick=()=>run(true);
async function run(compileOnly){
 const requestedSteps=Number(new URLSearchParams(location.search).get('steps')||120),steps=Number.isInteger(requestedSteps)?Math.max(2,Math.min(120,requestedSteps)):120;
 button.disabled=compileButton.disabled=true;let r,lab,guard,completion,phase='context',firstError,lastPass;const rows=[],mergeKeys=new Set(),copyKeys=new Set(),stageKeys=new Map(),compiled=[],start=performance.now();let stop=false;document.querySelector('#stop').onclick=()=>{stop=true;};
 const stageReport=()=>Object.fromEntries([...stageKeys].map(([name,keys])=>[name,keys.size]));
 const report=()=>({phase,frames:rows.length,elapsedSeconds:(performance.now()-start)/1000,simulatedSeconds:lab?.time,waterSamples:lab?.count,mergePrograms:mergeKeys.size,copyPrograms:copyKeys.size,surfacePrograms:stageReport(),lastPass,gpuCompletion:completion?.snapshot(),fieldStats:lab?.bulkFields?.stats,contextLost:r?.getContext().isContextLost(),rows:rows.slice(-6)});
 try{
  r=new THREE.WebGLRenderer({canvas:document.querySelector('#view'),antialias:false,preserveDrawingBuffer:true});r.setSize(96,64,false);r.autoClear=false;
  guard=installRTXGraphicsGuard(r,e=>{firstError??=e;lab?.stopGraphicsWork(e);out.textContent=e.message;},pass=>{lastPass=pass;});
  completion=new FrameCompletion(r,{onFailure:error=>guard.stop(error)});
  installRTXShaderCompatibility(r,{declaredOnly:true,boundedLoops:true,reachableOnly:true});
  lab=new LiveSandLab(r,{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab,rendererInfo(r));lab.resolutions.ocean=Number(new URLSearchParams(location.search).get('resolution')||1.4);lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.wind=24;lab.reactiveWaves=true;lab.seaFoam=new SeaFoam(r);
  const camera=new THREE.PerspectiveCamera(55,96/64,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),field={renderer:r,camera,target,resolution:new THREE.Vector2(96,64),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
  for(const name of ['beach','grass','grains','soft','optics','lightTest'])field[name]={count:0};
  const draw=new LiveWaterRenderer(field,lab);draw.fixedLoadScale=1;draw.mediumShadows.u.uMediumSize.value.set(16,12,16);
  installProgramSpecialization(r,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});guard.label(lab,'simulation');guard.label(draw,'render');
  if(compileOnly){
   // No rendering, stepping, or compute dispatch. Only the refactored
   // surface programs, with 1 × 1 targets. Fail closed without async compile.
   if(!r.extensions.has('KHR_parallel_shader_compile'))throw Error('Parallel shader compilation is unavailable. No shader check or playback was submitted.');
   const jobs=[...draw.splitSurfaces.values()].flatMap(split=>split.jobs(target));
   draw.u.uReuseSurfaceLight.value=!!lab.optimizations.surfaceLightReuse;
   for(const job of jobs){
    if(stop)throw Error('Stopped by user.');
    const began=performance.now();phase='Compiling '+job.name;guard.stage(phase);
    out.textContent=JSON.stringify({phase,compileOnly:true,draws:0,physicsSteps:0,compiled},null,2);
    await prepareShaderJobs(r,[job],{timeoutMs:15000,before:async()=>{await new Promise(resolve=>setTimeout(resolve,16));},wait:async()=>{if(stop)throw Error('Stopped by user.');await new Promise(resolve=>setTimeout(resolve,16));}});
    guard.assertHealthy();compiled.push({name:job.name,milliseconds:Math.round(performance.now()-began)});
   }
   phase='surface compilation complete';out.textContent=JSON.stringify({pass:true,compileOnly:true,draws:0,physicsSteps:0,compiled,contextLost:r.getContext().isContextLost(),note:'Compilation passed. Playback and visual correctness have not been tested.'},null,2);
   // This diagnostic is one-shot: do not queue another graphics test on top.
   r.dispose();return;
  }
  await Promise.all([densityKernelReady,neighborKernelReady]);
  const exercise=createShaderExercise(r,completion);phase='prepare';
  try{await prepareShaderJobs(r,firstFrameShaderJobs(draw),{exercise,timeoutMs:15000,before:async name=>{if(stop)throw Error('Stopped by user.');phase=name;guard.stage(name);out.textContent=name;await new Promise(resolve=>setTimeout(resolve,16));}});}finally{exercise.dispose();}
  async function drawFrame(){
   const begin=performance.now();
   guard.stage(phase);await completion.run(()=>draw.render({dt:lab.timestep,adaptive:true}));
   const submitted=performance.now();let timer;
   const pixels=await Promise.race([r.readRenderTargetPixelsAsync(target,Math.floor(target.width*.5),Math.floor(target.height*.5),1,1,new Float32Array(4)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Frame completion exceeded two seconds; stopped.')),2000);})]).finally(()=>clearTimeout(timer));
   if(!pixels.every(Number.isFinite)||pixels[0]+pixels[1]+pixels[2]<=0)throw Error('Non-finite or blank scene output');guard.assertHealthy();
   mergeKeys.add(draw.mergeScene.children[0].material.customProgramCacheKey());copyKeys.add(draw.copyScene.children[0].material.customProgramCacheKey());
   for(const split of draw.splitSurfaces.values())for(const material of [split.trace,split.shade]){
    if(!stageKeys.has(material.name))stageKeys.set(material.name,new Set());stageKeys.get(material.name).add(material.customProgramCacheKey());
   }
   return {submitMs:submitted-begin,completionMs:performance.now()-submitted};
  }
  phase='paused';await drawFrame();applyRTXBackend(lab,'safe',draw);await drawFrame();const preparedPrograms=r.info.programs.length;
  lab.paused=false;
  for(let frame=0;frame<steps;frame++){
   if(performance.now()-start>180000)throw Error('Stopped at total test time budget.');
   if(stop)throw Error('Stopped by user.');
   if(frame===Math.floor(steps/2)){lab.objectRadius=.3;lab.spawn('glass',[1,3,2],[0,-1,0],'sphere');}
   phase='playback '+(frame+1);out.textContent=JSON.stringify(report(),null,2);
   const began=performance.now();lab.accumulator=lab.timestep;lab.lastAdvance=performance.now();lab.startAsyncStep();await lab.asyncPending;
   if(lab.pipelineError)throw Error(lab.pipelineError);guard.assertHealthy();
   const physicsMs=performance.now()-began,render=await drawFrame(),ms=performance.now()-began;
   rows.push({frame:frame+1,time:lab.time,ms,physicsMs,...render,programs:r.info.programs.length,blobs:draw.blobRenderer.geometry.instanceCount,fine:lab.detail.count,sandParcels:lab.sand.parcels.length});
   // Shader/CPU first-use setup is distinct from outstanding GPU work. Keep
   // the two-second GPU completion timeout above for every frame, including
   // the first. One initial CPU setup interval may take up to ten seconds.
   if(ms>(frame===0?10000:2000))throw Error('Stopped after a slow frame; no further jobs submitted.');
   await new Promise(resolve=>setTimeout(resolve,16));
  }
  lab.paused=true;phase='complete';out.textContent=JSON.stringify({...report(),pass:mergeKeys.size===1&&copyKeys.size===1&&stageKeys.size>=6&&[...stageKeys.values()].every(keys=>keys.size===1)&&lab.u.uSandCount.value>0&&lab.bulkFields.stats.relativeResidual<1e-3,fields:lab.bulkFields.stats,preparedPrograms,backend:lab.gpu.constraintBackend,contextLost:r.getContext().isContextLost()},null,2);
 }catch(e){if(lab)lab.paused=true;guard?.stop(e);out.textContent=JSON.stringify({...report(),pass:false,compileOnly,compiled,error:firstError?.stack||e?.stack||String(e)},null,2);}
}
