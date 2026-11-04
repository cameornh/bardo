import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {configureRTXLab,rendererInfo,applyRTXBackend} from '../src/rtx-sand-lab/profile.js';
import {installRTXGraphicsGuard} from '../src/rtx-sand-lab/graphics.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {liveProgramConstants} from '../src/rtx-sand-lab/shader-dependencies.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {prepareShaderJobs,firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
import {MotionDetail} from '../src/lod.js';
import {SeaFoam} from '../src/sand-lab/sea-foam.js';
import {densityKernelReady} from '../src/sand-lab/native-density.js';
import {neighborKernelReady} from '../src/sand-lab/native-neighbors.js';

const out=document.querySelector('#result'),button=document.querySelector('#run');
button.onclick=async()=>{
 button.disabled=true;let r,lab,guard,phase='context';const rows=[],mergeKeys=new Set(),copyKeys=new Set(),start=performance.now();
 const report=()=>({phase,frames:rows.length,elapsedSeconds:(performance.now()-start)/1000,simulatedSeconds:lab?.time,waterSamples:lab?.count,mergePrograms:mergeKeys.size,copyPrograms:copyKeys.size,contextLost:r?.getContext().isContextLost(),rows});
 try{
  r=new THREE.WebGLRenderer({canvas:document.querySelector('#view'),antialias:false});r.setSize(96,64);r.autoClear=false;
  guard=installRTXGraphicsGuard(r,e=>{out.textContent=e.message;});installRTXShaderCompatibility(r,{declaredOnly:true});
  lab=new LiveSandLab(r,{boulders:true,physicalResolution:true});configureRTXLab(lab,rendererInfo(r));lab.resolutions.ocean=2.2;lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.wind=24;lab.reactiveWaves=true;lab.seaFoam=new SeaFoam(r);
  const camera=new THREE.PerspectiveCamera(55,96/64,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),field={renderer:r,camera,target,resolution:new THREE.Vector2(96,64),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
  for(const name of ['beach','grass','grains','soft','optics','lightTest'])field[name]={count:0};
  const draw=new LiveWaterRenderer(field,lab);draw.fixedLoadScale=1;draw.mediumShadows.u.uMediumSize.value.set(16,12,16);
  installProgramSpecialization(r,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});guard.label(lab,'simulation');guard.label(draw,'render');
  await Promise.all([densityKernelReady,neighborKernelReady]);
  phase='prepare';await prepareShaderJobs(r,firstFrameShaderJobs(draw),{before:async name=>{phase=name;out.textContent=name;await new Promise(resolve=>setTimeout(resolve,16));}});
  async function drawFrame(){
   const begin=performance.now();
   draw.render({dt:lab.timestep,adaptive:true});
   const submitted=performance.now();let timer;
   const pixels=await Promise.race([r.readRenderTargetPixelsAsync(target,0,0,1,1,new Float32Array(4)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Frame completion exceeded two seconds; stopped.')),2000);})]).finally(()=>clearTimeout(timer));
   if(!pixels.every(Number.isFinite))throw Error('Non-finite output');guard.assertHealthy();
   mergeKeys.add(draw.mergeScene.children[0].material.customProgramCacheKey());copyKeys.add(draw.copyScene.children[0].material.customProgramCacheKey());
   return {submitMs:submitted-begin,completionMs:performance.now()-submitted};
  }
  phase='paused';await drawFrame();applyRTXBackend(lab,'safe',draw);await drawFrame();const preparedPrograms=r.info.programs.length;
  lab.paused=false;
  for(let frame=0;frame<60;frame++){
   if(performance.now()-start>90000)throw Error('Stopped at total test time budget.');
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
  lab.paused=true;phase='complete';out.textContent=JSON.stringify({...report(),pass:mergeKeys.size===1&&copyKeys.size===1,preparedPrograms,mergePrograms:mergeKeys.size,copyPrograms:copyKeys.size,backend:lab.gpu.constraintBackend,contextLost:r.getContext().isContextLost()},null,2);
 }catch(e){if(lab)lab.paused=true;guard?.stop(e);out.textContent=JSON.stringify({...report(),pass:false,error:e?.stack||String(e)},null,2);}
};
