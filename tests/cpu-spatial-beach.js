import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {configureRTXLab,rendererInfo} from '../src/rtx-sand-lab/profile.js';
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
import {QUAD_VERTEX,TONEMAP_FRAGMENT} from '../src/shaders.js';
import {transferKernelReady} from '../src/rtx-sand-lab/fields/native-transfer.js';
import {transportKernelReady} from '../src/rtx-sand-lab/fields/native-transport.js';
import {pressureKernelReady} from '../src/rtx-sand-lab/fields/native-pressure.js';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
import {installFieldBatch,batchKernelReady} from '../src/rtx-sand-lab/fields/batch/grid.js';
import {installSpatialCPU,tightNeighborKernelReady} from '../src/rtx-sand-lab/fields/spatial-cpu/install.js';
import {makeBody} from '../src/sand-lab/objects.js';
export async function beachScene(canvas,status){
 const r=new THREE.WebGLRenderer({canvas,antialias:false,preserveDrawingBuffer:true});r.setSize(960,540,false);r.autoClear=false;
 const guard=installRTXGraphicsGuard(r,e=>status(e.message)),completion=new FrameCompletion(r,{onFailure:e=>guard.stop(e)});
 installRTXShaderCompatibility(r,{declaredOnly:true,boundedLoops:true,reachableOnly:true});
 const lab=new LiveSandLab(r,{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab,rendererInfo(r));Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true,simdParticles:false,simdPressure:false});installFieldLocality(lab);installFieldBatch(lab);installSpatialCPU(lab);
 lab.resolutions.ocean=1.4;lab.seaFoam=new SeaFoam(r);
 const camera=new THREE.PerspectiveCamera(55,960/540,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),field={renderer:r,camera,target,resolution:new THREE.Vector2(640,400),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
 for(const name of ['beach','grass','grains','soft','optics','lightTest'])field[name]={count:0};
 function reset(optimized){lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.wind=18;lab.reactiveWaves=true;lab.tidesEnabled=false;lab.lunarCycle=false;lab.wetting.cameraEnabled=false;lab.rain.enabled=true;lab.rain.rate=100;lab.tannins=.3;const trial=new URLSearchParams(location.search).get('trial')||'combined';lab.optimizations.snapshotHeights=optimized&&trial!=='neighbors';lab.optimizations.tightNeighbors=optimized&&trial!=='heights';
  for(let i=0;i<48;i++){const x=-3.8+(i%12)*.62,z=1.8+Math.floor(i/12)*.65,y=lab.sand.height(x,z);const chunks=lab.sand.extract([x,y,z],.18,[0,0,0],true);for(const p of chunks){p.held=false;p.position[0]+=.24;p.position[1]=lab.sand.height(p.position[0],p.position[2])+.02;p.anchored=true;p.layer=true;}lab.sand.editPolicy.maintain(lab.sand);lab.sand.update();}
  lab.balls.push(makeBody('glass','cup',.24,[1,1.8,1]),makeBody('rock','sphere',.22,[-1,2,1]));lab.syncSandUniforms();lab.deferFieldSolve=true;lab.renderPending=false;lab.accumulator=0;lab.lastAdvance=performance.now();lab.paused=false;
 }
 reset(false);lab.paused=true;
 const draw=new LiveWaterRenderer(field,lab);draw.fixedLoadScale=.5;draw.mediumShadows.u.uMediumSize.value.set(16,12,16);installParticleVisibility(draw);
 installProgramSpecialization(r,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});guard.label(lab,'simulation');guard.label(draw,'render');
 const screen=new THREE.Scene(),material=new THREE.ShaderMaterial({name:'dual-scene-display',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:TONEMAP_FRAGMENT,uniforms:{uImage:{value:target.texture}},depthTest:false,depthWrite:false});screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
 const ready=await Promise.all([densityKernelReady,neighborKernelReady,transferKernelReady,transportKernelReady,pressureKernelReady,batchKernelReady,tightNeighborKernelReady]);if(ready.some(x=>!x))throw Error('A required CPU kernel was unavailable; comparison stopped.');
 const exercise=createShaderExercise(r,completion);try{await prepareShaderJobs(r,[...firstFrameShaderJobs(draw),{name:'dual-scene-display',scene:screen,camera:draw.quadCamera,target:null}],{exercise,timeoutMs:15000,before:async name=>{status(name);await new Promise(requestAnimationFrame);}});}finally{exercise.dispose();}
 return {name:'beach',renderer:r,frames:32,metadata:{trial:new URLSearchParams(location.search).get('trial')||'combined',markers:lab.count,edits:48,output:[960,540],scene:[320,200],backend:'WebGL render / compiled CPU fields and contacts / GPU fine particles'},reset,
  get time(){return lab.time;},
  async frame(dt){lab.deferFieldSolve=true;lab.advance(dt,camera);lab.renderPending=true;if(!lab.cpuFrameStep?.pending)await lab.asyncPending;const start=performance.now();await completion.run(()=>{draw.render({dt:Math.min(.25,dt),adaptive:false});r.setRenderTarget(null);r.render(screen,draw.quadCamera);},{cpuWork:()=>lab.cpuFrameStep?.compute()});lab.cpuFrameStep?.publish();lab.renderPending=false;guard.assertHealthy();if(lab.pipelineError)throw Error(lab.pipelineError);return {workMs:performance.now()-start,surfaceMs:lab.bulkFields.stats.surfaceMs,neighborMs:lab.gpu.neighborMs,fields:{...lab.bulkFields.stats},heightCache:{hits:lab.snapshotHeights.hits,misses:lab.snapshotHeights.misses,size:lab.snapshotHeights.size},parcels:lab.sand.parcels.length};},
  pause(){lab.paused=true;},async pixels(){const a=new Float32Array(target.width*target.height*4);await r.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,a);return a;},
  dispose(){lab.paused=true;lab.stopGraphicsWork(Error('Benchmark complete'));draw.dispose?.();lab.gpu.dispose();target.dispose();material.dispose();r.dispose();}
 };
}
