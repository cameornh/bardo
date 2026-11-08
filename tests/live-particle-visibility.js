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
const out=document.querySelector('#result'),run=document.querySelector('#run'),save=document.querySelector('#save');let stop=false,result;
document.querySelector('#stop').onclick=()=>stop=true;
save.onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));a.download='particle-visibility.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
function preview(pixels,label){
 const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d'),data=ctx.createImageData(640,360);
 for(let y=0;y<360;y++)for(let x=0;x<640;x++)for(let k=0;k<4;k++){const a=((359-y)*640+x)*4+k,b=(y*640+x)*4+k,v=Math.max(0,pixels[a]);data.data[b]=k===3?255:Math.round(255*Math.pow(v/(1+v),1/2.2));}
 ctx.putImageData(data,0,0);const img=document.createElement('img');img.alt=label;img.src=c.toDataURL();img.style.width='320px';const figure=document.createElement('figure');figure.style.display='inline-block';figure.style.margin='8px';const caption=document.createElement('figcaption');caption.textContent=label;figure.append(img,caption);document.querySelector('#comparisons').append(figure);
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,16));
function stats(a){const v=a.slice().sort((a,b)=>a-b);return {median:v[Math.floor(v.length/2)],mean:v.reduce((a,b)=>a+b,0)/v.length,p95:v[Math.floor((v.length-1)*.95)],samples:v.length};}
run.onclick=async()=>{
 run.disabled=true;stop=false;let r,guard,completion,stage='starting';const rows=[];try{
 r=new THREE.WebGLRenderer({canvas:document.querySelector('#view'),antialias:false,preserveDrawingBuffer:true});r.setSize(640,360,false);r.autoClear=false;
 guard=installRTXGraphicsGuard(r,error=>{out.textContent=error.stack;});completion=new FrameCompletion(r,{onFailure:e=>guard.stop(e)});installRTXShaderCompatibility(r,{declaredOnly:true,boundedLoops:true,reachableOnly:true});
 const lab=new LiveSandLab(r,{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab,rendererInfo(r));lab.resolutions.ocean=1.4;lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.seaFoam=new SeaFoam(r);lab.wetting.cameraEnabled=false;lab.rain.enabled=false;
 const camera=new THREE.PerspectiveCamera(55,640/360,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),field={renderer:r,camera,target,resolution:new THREE.Vector2(640,360),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
 for(const name of ['beach','grass','grains','soft','optics','lightTest'])field[name]={count:0};
 const draw=new LiveWaterRenderer(field,lab);draw.fixedLoadScale=1;draw.mediumShadows.u.uMediumSize.value.set(16,12,16);const visibility=installParticleVisibility(draw);
 installProgramSpecialization(r,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});guard.label(lab,'simulation');guard.label(draw,'render');
 const screenMaterial=new THREE.ShaderMaterial({name:'particle-comparison-display',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:'precision highp float;uniform sampler2D image;in vec2 vUv;out vec4 color;void main(){vec3 c=texture(image,vUv).rgb;color=vec4(pow(max(c,vec3(0))/(1.+max(c,vec3(0))),vec3(1./2.2)),1);}',uniforms:{image:{value:draw.composite.texture}},depthTest:false,depthWrite:false}),screen=new THREE.Scene();screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),screenMaterial));
 const sceneFor=m=>{const s=new THREE.Scene();s.add(new THREE.Mesh(draw.detailRenderer.geometry,m));return s;};
 const jobs=firstFrameShaderJobs(draw);jobs.push({name:'reference fine lighting',scene:sceneFor(visibility.reference.light),camera:draw.quadCamera,target:draw.detailRenderer.paths},{name:'reference fine splats',scene:sceneFor(visibility.reference.draw),camera,target:draw.detailRenderer.target},{name:'comparison display',scene:screen,camera:draw.quadCamera,target:null});
 const exercise=createShaderExercise(r,completion);try{await prepareShaderJobs(r,jobs,{exercise,timeoutMs:15000,before:async name=>{stage=name;out.textContent=name;guard.stage(name);if(stop)throw Error('Stopped');await pause();}});}finally{exercise.dispose();}
 await Promise.all([densityKernelReady,neighborKernelReady]);applyRTXBackend(lab,'safe',draw);await completion.run(()=>draw.render({dt:1/60,adaptive:false}));
 // Known deterministic distribution includes visible, offscreen and buried
 // markers. All positions, radii and lighting are identical between paths.
 let seed=131;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32),g=draw.sandGrains,d=lab.detail;
 for(let i=0;i<g.capacity;i++){const x=(random()-.5)*16,z=(random()-.5)*13,y=lab.sand.height(x,z)+(random()-.25)*1.1,o=i*4;g.p.set([x,y,z,2],o);g.v.set([2+random()*4,random(),1,4],o);g.info.set([.018+random()*.025,.15,random()*.3,1600],o);}
 g.emitted=g.capacity;g.until=10;g.inputP.needsUpdate=g.inputV.needsUpdate=g.infoTexture.needsUpdate=true;
 const [p,v,info]=d.fallback.map(t=>t.image.data);
 for(let i=0;i<d.capacity;i++){const o=i*4,x=(random()-.5)*15,z=(random()-.5)*12,kind=i%4,y=kind===3?2+random()*1.8:1.6+(random()-.4)*.8;p.set([x,y,z,.5+random()],o);v.set([random(),random(),random(),5],o);info.set([kind===3?.08+random()*.1:.006+random()*.018,kind,kind===3?.08:.55,100],o);}
 d.fallback.forEach(t=>t.needsUpdate=true);d.bind(d.fallback);d.count=d.activeSpan=d.capacity;d.emitted=d.capacity;lab.syncUniforms();
 const sea=lab.seaFoam;sea.generation(lab);sea.surface.update(lab);sea.surfaceTexture.needsUpdate=true;
 for(let i=0;i<sea.size*sea.size;i++){const o=i*4,wet=sea.surface.surface[o]>sea.surface.surface[o+1];sea.reference[o+(wet?0:1)]=random()<.35?.15+random()*.6:0;}
 sea.zero.image.data=sea.reference;sea.zero.needsUpdate=true;sea.u.uSeaState.value=sea.zero;sea.active=true;sea.revision++;
 const gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 async function particles(mode,kind='both'){
  if(stop)throw Error('Stopped');visibility.enabled=mode!=='reference';lab.optimizations.particleSparse=mode==='sparse';lab.optimizations.particleOcclusion=mode==='occlusion';visibility.select();visibility.updated=false;draw.detailRenderer.pathsKey=null;d.enabled=kind==='foam'||kind==='both';g.enabled=kind==='sand'||kind==='both';sea.enabled=kind==='sea';
  const q=ext?gl.createQuery():null,start=performance.now();await completion.run(()=>{
   r.setRenderTarget(draw.composite);draw.u.uImage.value=draw.resolvedWater.texture;r.render(draw.copyScene,draw.quadCamera);
   if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);
   draw.detailRenderer.render(r,camera);g.render(r,camera);draw.seaFoamRenderer.render(r,camera,lab);
   if(q)gl.endQuery(ext.TIME_ELAPSED_EXT);
  });const wallMs=performance.now()-start;let gpuMs=null;
  if(q){while(!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(performance.now()-start>2000)throw Error('Timer timeout');await pause();}if(!gl.getParameter(ext.GPU_DISJOINT_EXT))gpuMs=gl.getQueryParameter(q,gl.QUERY_RESULT)*1e-6;gl.deleteQuery(q);}
  return {gpuMs,wallMs};
 }
 async function image(){return r.readRenderTargetPixelsAsync(draw.composite,0,0,640,360,new Float32Array(640*360*4));}
 const comparisons=[],wholeFrames=[];
 for(const [view,position,look] of [['beach',[4.8,4,4.4],[0,.65,0]],['shore',[0,2.1,4.5],[0,1.4,0]],['underwater',[0,.85,0],[1,1.2,-3]]]){
  stage=view;out.textContent='Comparing '+view;camera.position.fromArray(position);camera.lookAt(...look);camera.updateMatrixWorld();d.enabled=false;g.enabled=false;sea.enabled=false;draw.drawKey=null;await completion.run(()=>draw.render({dt:1/60,adaptive:false}));d.enabled=g.enabled=true;
  await particles('reference');const a=await image();await particles('optimized');const b=await image();let sum=0,max=0,nonFinite=0,changed=0;
  for(let i=0;i<a.length;i++){const e=Math.abs(a[i]-b[i]);if(!Number.isFinite(e))nonFinite++;sum+=e;max=Math.max(max,e);if(e>.002)changed++;}
  await particles('occlusion');const occ=await image();let occError=0;for(let i=0;i<occ.length;i++)occError+=Math.abs(occ[i]-b[i]);await particles('sparse');const sparse=await image();let sparseError=0,sparseMax=0,energyA=0,energyB=0;for(let j=0;j<a.length;j++){sparseError+=Math.abs(a[j]-sparse[j]);sparseMax=Math.max(sparseMax,Math.abs(a[j]-sparse[j]));energyA+=a[j];energyB+=sparse[j];}comparisons.push({view,occlusionMeanError:occError/b.length,sparse:{meanAbsoluteLinearError:sparseError/a.length,maxAbsoluteLinearError:sparseMax,relativeMeanDifference:energyB/energyA-1},meanAbsoluteLinearError:sum/a.length,maxAbsoluteLinearError:max,componentsOver002:changed,nonFinite});
  preview(a,view+' reference');preview(sparse,view+' sparse');
  await particles('sparse');const stableA=await image();await particles('sparse');const stableB=await image();comparisons.at(-1).repeatMaxError=stableA.reduce((v,x,i)=>Math.max(v,Math.abs(x-stableB[i])),0);
  await particles('reference','sea');const seaA=await image();await particles('optimized','sea');const seaB=await image();comparisons.at(-1).seaMeanError=seaA.reduce((v,x,i)=>v+Math.abs(x-seaB[i]),0)/seaA.length;
  for(const kind of ['sand','foam','sea','both']){for(let i=0;i<40;i++){const mode=['reference','optimized','sparse','occlusion'][i%4];const timing=await particles(mode,kind);if(i>=4)rows.push({view,kind,mode,...timing});await pause();}out.textContent=JSON.stringify({stage:view,kind,comparisons,frames:rows.length},null,2);}
  for(let i=0;i<34;i++){
   const mode=['reference','sparse','sparse','reference'][i%4];visibility.enabled=mode!=='reference';lab.optimizations.particleSparse=true;lab.optimizations.particleOcclusion=false;d.enabled=g.enabled=sea.enabled=true;draw.detailRenderer.pathsKey=null;draw.drawKey=null;
   const began=performance.now();await completion.run(()=>draw.render({dt:1/60,adaptive:false}));if(i>=2)wholeFrames.push({view,mode,ms:performance.now()-began});await pause();
  }
 }
 camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();d.enabled=g.enabled=false;sea.enabled=false;draw.drawKey=null;await completion.run(()=>draw.render({dt:1/60,adaptive:false}));await particles('sparse');await completion.run(()=>{r.setRenderTarget(null);r.render(screen,draw.quadCamera);});
 // Separate bounded playback: no synthetic particles enter the physics.
 g.enabled=d.enabled=sea.enabled=true;g.reset();d.reset();sea.reset();visibility.enabled=true;lab.optimizations.particleOcclusion=false;lab.optimizations.particleSparse=true;lab.paused=false;
 const playback=[],preparedPrograms=r.info.programs.length;
 for(let frame=0;frame<12;frame++){
  if(stop)throw Error('Stopped');stage='playback '+(frame+1);out.textContent=stage;
  if(frame===6){lab.objectRadius=.3;lab.spawn('glass',[1,3,2],[0,-1,0],'sphere');}
  const began=performance.now();lab.accumulator=lab.timestep;lab.lastAdvance=performance.now();lab.startAsyncStep();await lab.asyncPending;if(lab.pipelineError)throw Error(lab.pipelineError);guard.assertHealthy();
  const physicsMs=performance.now()-began;draw.drawKey=null;await completion.run(()=>draw.render({dt:lab.timestep,adaptive:false}));playback.push({frame:frame+1,physicsMs,frameMs:performance.now()-began,time:lab.time,programs:r.info.programs.length});
  if(playback.at(-1).frameMs>(frame===0?10000:2000))throw Error('Slow playback frame; stopped');await pause();
 }
 lab.paused=true;await completion.run(()=>{r.setRenderTarget(null);r.render(screen,draw.quadCamera);});
 const groups={};for(const row of rows){const key=[row.view,row.kind,row.mode].join('/');(groups[key]??=[]).push(row);}
 result={pass:playback.every(frame=>frame.programs===preparedPrograms)&&comparisons.every(c=>c.nonFinite===0&&c.meanAbsoluteLinearError<.0001&&c.occlusionMeanError<.0001&&c.seaMeanError<.0001&&c.repeatMaxError<1e-6),contextLost:gl.isContextLost(),backend:{rendering:'WebGL 2',physics:lab.gpu.constraintBackend,fields:lab.bulkFields.stats.backend},resolution:[640,360],sand:g.capacity,foam:d.capacity,physicsSteps:playback.length,playback,preparedPrograms,wholeFrames,comparisons,measurements:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,{gpuMs:ext?stats(v.map(x=>x.gpuMs)):null,wallMs:stats(v.map(x=>x.wallMs))}])),rows};out.textContent=JSON.stringify(result,null,2);save.disabled=false;
 }catch(error){result={pass:false,stage,error:error.stack,contextLost:r?.getContext().isContextLost(),gpuCompletion:completion?.snapshot(),rows};out.textContent=JSON.stringify(result,null,2);save.disabled=false;guard?.stop(error);}
};
