import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {configureRTXLab,rendererInfo} from '../src/rtx-sand-lab/profile.js';
import {installRTXGraphicsGuard} from '../src/rtx-sand-lab/graphics.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {liveProgramConstants} from '../src/rtx-sand-lab/shader-dependencies.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {prepareShaderJobs,firstFrameShaderJobs,createShaderExercise} from '../src/rtx-sand-lab/shader-startup.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';
import {MotionDetail} from '../src/lod.js';
import {SeaFoam} from '../src/sand-lab/sea-foam.js';

const out=document.querySelector('#result');
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;
 const name=new URLSearchParams(location.search).get('program')||'opaque-reflection-lighting';
 let renderer,completion,stage='context',compileMs;const draws=[];
 const report=extra=>{out.textContent=JSON.stringify({name,stage,compileMs,draws,physicsSteps:0,sceneFrames:0,visibility:document.visibilityState,contextLost:renderer?.getContext().isContextLost(),completion:completion?.snapshot(),...extra},null,2);};
 try{
  renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#view'),antialias:false});renderer.setSize(1,1,false);renderer.autoClear=false;
  const guard=installRTXGraphicsGuard(renderer,e=>report({pass:false,error:e.message}));
  // This longer window only observes one already-submitted pixel. It does
  // not change the production frame budget or queue any additional work.
  completion=new FrameCompletion(renderer,{timeoutMs:10000,onFailure:e=>guard.stop(e)});
  installRTXShaderCompatibility(renderer,{declaredOnly:true,boundedLoops:true,reachableOnly:true});
  const lab=new LiveSandLab(renderer,{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab,rendererInfo(renderer));lab.resolutions.ocean=1.4;lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.seaFoam=new SeaFoam(renderer);
  const camera=new THREE.PerspectiveCamera(55,1,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
  const field={renderer,camera,target:new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),resolution:new THREE.Vector2(1,1),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{count:0,uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
  for(const key of ['beach','grass','grains','soft','optics','lightTest'])field[key]={count:0};
  const draw=new LiveWaterRenderer(field,lab);
  installProgramSpecialization(renderer,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});
  const job=firstFrameShaderJobs(draw).find(j=>j.name===name);
  if(!job)throw Error('Unknown program');
  const meshes=job.scene.children.filter(o=>o.isMesh);
  if(meshes.length!==1||meshes[0].geometry.isInstancedBufferGeometry||meshes[0].isInstancedMesh)throw Error('This probe only exercises single, non-instanced fullscreen programs');
  if(!renderer.extensions.has('KHR_parallel_shader_compile'))throw Error('Asynchronous compilation unavailable; no draw submitted');
  stage='compiling';report();const begin=performance.now();
  await prepareShaderJobs(renderer,[job],{timeoutMs:15000});compileMs=performance.now()-begin;
  const exercise=createShaderExercise(renderer,completion);
  for(let i=0;i<2;i++){
   stage=i?'second one-pixel draw':'first one-pixel draw';guard.stage(stage);report();
   const began=performance.now();await exercise(job);draws.push({milliseconds:performance.now()-began});
  }
  exercise.dispose();stage='complete';report({pass:true});renderer.dispose();
 }catch(error){report({pass:false,error:error.stack||String(error)});}
};
