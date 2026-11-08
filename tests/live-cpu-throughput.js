import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {configureRTXLab,rendererInfo,applyRTXBackend} from '../src/rtx-sand-lab/profile.js';
import {installRTXGraphicsGuard} from '../src/rtx-sand-lab/graphics.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {liveProgramConstants} from '../src/rtx-sand-lab/shader-dependencies.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {prepareShaderJobs,firstFrameShaderJobs,createShaderExercise} from '../src/rtx-sand-lab/shader-startup.js';
import {installParticleVisibility} from '../src/rtx-sand-lab/particle-visibility.js';
import {MotionDetail} from '../src/lod.js';
import {SeaFoam} from '../src/sand-lab/sea-foam.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';
import {densityKernelReady} from '../src/sand-lab/native-density.js';
import {neighborKernelReady} from '../src/sand-lab/native-neighbors.js';
import {QUAD_VERTEX} from '../src/shaders.js';

import {transferKernelReady} from '../src/rtx-sand-lab/fields/native-transfer.js';
import {transportKernelReady} from '../src/rtx-sand-lab/fields/native-transport.js';
import {pressureKernelReady} from '../src/rtx-sand-lab/fields/native-pressure.js';
const out=document.querySelector('#result');let stop=false;
document.querySelector('#stop').onclick=()=>stop=true;
const yieldFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const summarize=a=>{const b=a.slice().sort((x,y)=>x-y);return {mean:a.reduce((s,x)=>s+x,0)/a.length,median:b[Math.floor(b.length/2)],p95:b[Math.floor((b.length-1)*.95)]};};
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;let r,guard,lab,stage='context';const rows=[];
 try{
 const params=new URLSearchParams(location.search),resolution=Number(params.get('resolution')||2.2),frames=48;
 r=new THREE.WebGLRenderer({canvas:document.querySelector('#view'),antialias:false,preserveDrawingBuffer:true});r.setSize(960,540,false);r.autoClear=false;
 guard=installRTXGraphicsGuard(r,e=>out.textContent=e.stack);const completion=new FrameCompletion(r,{onFailure:e=>guard.stop(e)});installRTXShaderCompatibility(r,{declaredOnly:true,boundedLoops:true,reachableOnly:true});
 lab=new LiveSandLab(r,{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab,rendererInfo(r));const baseline=params.has('baseline');lab.optimizations.cpuSandQueries=!baseline;lab.optimizations.nativeFieldTransfer=!baseline;lab.optimizations.cpuFrameOverlap=!baseline;lab.optimizations.cpuCatchup=!baseline;lab.resolutions.ocean=resolution;lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.wind=24;lab.reactiveWaves=true;lab.tidesEnabled=false;lab.lunarCycle=false;lab.seaFoam=new SeaFoam(r);lab.wetting.cameraEnabled=false;
 const camera=new THREE.PerspectiveCamera(55,960/540,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),field={renderer:r,camera,target,resolution:new THREE.Vector2(960,540),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
 for(const name of ['beach','grass','grains','soft','optics','lightTest'])field[name]={count:0};
 const draw=new LiveWaterRenderer(field,lab);draw.fixedLoadScale=1;installParticleVisibility(draw);
 installProgramSpecialization(r,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});guard.label(lab,'simulation');guard.label(draw,'render');
 const material=new THREE.ShaderMaterial({name:'throughput-display',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:'precision highp float;uniform sampler2D image;in vec2 vUv;out vec4 color;void main(){vec3 c=texture(image,vUv).rgb;color=vec4(pow(max(c,vec3(0))/(1.+max(c,vec3(0))),vec3(1./2.2)),1);}',uniforms:{image:{value:target.texture}},depthTest:false,depthWrite:false}),screen=new THREE.Scene();screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
 const ready=await Promise.all([transferKernelReady,densityKernelReady,neighborKernelReady,transportKernelReady,pressureKernelReady]);if(!baseline&&!ready[0])throw Error('Native transfer kernel did not load; benchmark stopped instead of measuring fallback.');
 const exercise=createShaderExercise(r,completion);try{await prepareShaderJobs(r,[...firstFrameShaderJobs(draw),{name:'throughput-display',scene:screen,camera:draw.quadCamera,target:null}],{exercise,timeoutMs:15000,before:async name=>{stage=name;out.textContent=name;await yieldFrame();}});}finally{exercise.dispose();}
 async function frame(){await completion.run(()=>{draw.render({dt:lab.timestep,adaptive:true});r.setRenderTarget(null);r.render(screen,draw.quadCamera);},{cpuWork:()=>lab.cpuFrameStep?.compute()});lab.cpuFrameStep?.publish();guard.assertHealthy();}
 await frame();lab.paused=false;const prepared=r.info.programs.length;
 const edits=Number(params.get('edits')||0);
 for(let i=0;i<edits;i++){const x=-3.8+(i%12)*.62,z=1.8+(Math.floor(i/12)%4)*.65,y=lab.sand.height(x,z);const chunks=lab.sand.extract([x,y,z],.18,[0,0,0],true);for(const p of chunks){p.held=false;p.position[0]+=.24;p.position[1]=lab.sand.height(p.position[0],p.position[2])+.02;p.anchored=true;p.layer=true;}lab.sand.editPolicy.maintain(lab.sand);lab.sand.update();if(i%20===19)await yieldFrame();}
 for(let i=0;i<12;i++){lab.accumulator=lab.timestep;lab.lastAdvance=performance.now();lab.deferFieldSolve=!baseline;lab.startAsyncStep();if(!lab.cpuFrameStep?.pending)await lab.asyncPending;await frame();await yieldFrame();}
 const started=performance.now(),simStart=lab.time;
 for(let i=0;i<frames;i++){
 if(stop)break;const begin=performance.now();stage='frame '+(i+1);lab.accumulator=lab.timestep; if(params.has('clock'))lab.accumulator=Math.min(.25,(rows.at(-1)?.total||lab.timestep*1000)/1000);lab.lastAdvance=performance.now();lab.deferFieldSolve=!baseline;lab.startAsyncStep();if(!lab.cpuFrameStep?.pending)await lab.asyncPending;guard.assertHealthy();if(lab.pipelineError)throw Error(lab.pipelineError);const preparedCPU=performance.now()-begin;
 await frame();const total=performance.now()-begin,physics=preparedCPU+(lab.cpuFrameStep?lab.overlappedCPUms||0:0);
 rows.push({physics,total,steps:lab.cpuFrameSteps||1,sand:lab.sandStepMs,sandTimes:lab.sand.stepTimes,parcelTimes:lab.sand.parcelTimes,fields:{...lab.bulkFields.stats},render:{...draw.cpuStages},prepare:lab.prepareTimes,parcels:lab.sand.parcels.length,fine:lab.detail.count});
 out.textContent=JSON.stringify({stage,physicsMs:physics,frameMs:total,parcels:lab.sand.parcels.length});if(total>2000)throw Error('Stopped after slow frame');await yieldFrame();
 }
 lab.paused=true;const wall=(performance.now()-started)/1000,sim=lab.time-simStart;
 const pixels=new Float32Array(target.width*target.height*4);await r.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,pixels);let finite=true,light=0;for(let i=0;i<pixels.length;i+=4){finite&&=Number.isFinite(pixels[i]);light+=pixels[i]+pixels[i+1]+pixels[i+2];}
 out.textContent=JSON.stringify({pass:!r.getContext().isContextLost()&&finite&&light>0,stage:'complete',baseline,nativeTransfer:!!lab.bulkFields.grid.nativeTransfer?.scattered,resolution,edits,frames:rows.length,wallSeconds:wall,simulatedSeconds:sim,fps:rows.length/wall,realtime:sim/wall,physics:summarize(rows.map(x=>x.physics)),frame:summarize(rows.map(x=>x.total)),water:lab.count,preparedPrograms:prepared,finalPrograms:r.info.programs.length,contextLost:r.getContext().isContextLost(),rows},null,2);
 }catch(e){lab?.stopGraphicsWork(e);guard?.stop(e);out.textContent=JSON.stringify({pass:false,stage,error:e.stack,contextLost:r?.getContext().isContextLost(),rows:rows.slice(-3)},null,2);}
};
