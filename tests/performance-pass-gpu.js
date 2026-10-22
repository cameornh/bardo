import {PackedNeighbors} from '../src/sand-lab/packed-neighbors.js';
import {pollLabReadbacks} from '../src/sand-lab/water-lab-readback.js';
import * as THREE from 'three';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {MotionDetail} from '../src/lod.js';
import {QUAD_VERTEX,TONEMAP_FRAGMENT} from '../src/shaders.js';
import {verifyBeachGPU} from '../src/sand-lab/verify.js';
import {NativeNeighbors,nativeNeighborsAvailable,neighborKernelReady} from '../src/sand-lab/native-neighbors.js';
const $=id=>document.getElementById(id),result=$('result'),status=$('status');
const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.autoClear=false;renderer.setSize(512,640);document.body.append(renderer.domElement);renderer.domElement.style.cssText='width:256px;height:320px';
const lab=new SandLab(renderer);installProgramSpecialization(renderer,()=>lab.optimizations.sandPrograms);
lab.wetting.cameraEnabled=false;lab.frameDrivenLens=true;lab.enabled=true;
const camera=new THREE.PerspectiveCamera(44,512/640,.01,300),target=new THREE.WebGLRenderTarget(512,640,{type:THREE.FloatType}),output=new THREE.Scene();
output.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:TONEMAP_FRAGMENT,uniforms:{uImage:{value:target.texture}},depthTest:false,depthWrite:false})));
const field={renderer,camera,target,output,quadCamera:new THREE.Camera(),resolution:new THREE.Vector2(512,640),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:.02}}}};for(const k of ['beach','grass','grains','soft','optics','lightTest'])field[k]={count:0};
const draw=new WaterLabRenderer(field,lab);draw.adaptiveResolution=false;draw.fixedLoadScale=.5;
// Browser-host visibility can throttle RAF to 1 Hz even while document.hidden
// is false. Yield through a task for throughput measurements; this measures
// completed engine frames, not compositor presentation rate.
const channel=new MessageChannel(),pending=[];channel.port1.onmessage=()=>pending.shift()?.();
const gl=renderer.getContext(),next=()=>new Promise(resolve=>{pending.push(resolve);channel.port2.postMessage(0);});
window.addEventListener('error',e=>result.textContent=e.error?.stack||e.message);
function setup(){
 const scene=$('work').value;lab.resolutions.ocean=scene==='large'?3:2.2;lab.configure('ocean',scene==='large'?2:1);lab.radius=.45;
 for(const key of ['surfaceLightReuse','nativeNeighbors','packedGpuNeighbors','windBatch'])lab.optimizations[key]=$('new').checked;
 if(scene==='busy'){
  for(let j=0;j<12;j++){const x=(j%6-2.5)*.65,z=3+Math.floor(j/6)*.55,y=lab.sand.height(x,z);const pieces=lab.sand.extract([x,y,z],.26,[0,0,0],false);for(const p of pieces){p.position[1]+=.65+(j%3)*.18;p.wet=j%3===0?.9:0;p.memory=p.wet;}}
  lab.objectRadius=.18;for(let j=0;j<8;j++){const b=lab.spawn(['rock','glass','mirror','light'][j%4],[-2.8+j*.8,2.4,.3],[0,0,-1]);b.velocity.fill(0);}lab.sand.update();lab.syncUniforms();
 }
 camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();draw.drawKey=null;draw.densityRevision=-1;
}
function frame(){const start=performance.now();lab.step(1/15,true);const physics=performance.now();lab.detail.advance(1/15,lab,lab.detailJet);const detail=performance.now();draw.render({dt:1/15,adaptive:false});gl.finish();return {total:performance.now()-start,physics:physics-start,detail:detail-physics,draw:performance.now()-detail,neighbors:lab.gpu.neighborMs,batch:lab.stepReadback?.waitMs,sand:lab.sandStepMs,cpu:{...lab.prepareTimes,...lab.sand.parcelTimes}};}
$('profile').onclick=async()=>{try{await neighborKernelReady;setup();for(let i=0;i<20;i++){pollLabReadbacks(renderer);await Promise.resolve();frame();status.textContent=`Warm-up ${i}`;await next();}const samples=[],render=renderer.render.bind(renderer);renderer.render=(scene,camera)=>{gl.finish();const start=performance.now();render(scene,camera);const t=renderer.getRenderTarget();if(t)renderer.readRenderTargetPixels(t,0,0,1,1,t.texture.type===THREE.HalfFloatType?new Uint16Array(4):new Float32Array(4));else gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));samples.push({name:scene.children[0]?.material?.fragmentShader?.slice(0,180),ms:performance.now()-start});};const totals=frame();renderer.render=render;result.textContent=JSON.stringify({totals,samples},null,2);}catch(e){result.textContent=e.stack;}};
$('run').onclick=async()=>{try{await neighborKernelReady;setup();const frames=[],intervals=[];let start,last;for(let i=0;i<105;i++){await next();pollLabReadbacks(renderer);await Promise.resolve();const now=performance.now();if(i===15)start=last=now;const f=frame();if(i>=15){frames.push(f);intervals.push(performance.now()-last);last=performance.now();}status.textContent=`${$('work').value}: ${i+1}/105`;}const wall=(performance.now()-start)/1000,values=frames.map(f=>f.total),mean=values.reduce((a,b)=>a+b,0)/values.length,sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length),sorted=values.slice().sort((a,b)=>a-b);result.textContent=JSON.stringify({fixture:$('work').value,newOptimizations:$('new').checked,fps:90/wall,realtime:6/wall,wallSeconds:wall,meanWorkMs:mean,sdWorkMs:sd,cv:sd/mean,p95WorkMs:sorted[85],maxWorkMs:sorted.at(-1),resolution:[target.width,target.height],bulk:lab.count,sand:lab.sand.parcels.length,frames,intervals},null,2);}catch(e){result.textContent=e.stack;}};
setup();draw.render({adaptive:false});

$('verify').onclick=async()=>{try{
 await neighborKernelReady;setup();const densityReference=verifyBeachGPU(renderer,lab.u,false),density=verifyBeachGPU(renderer,lab.u,true),cases=[];
 // Identical inputs exercise both texture layouts, including the transport
 // channels that feed foam and bubble generation.
 const old=lab.positions.slice(),velocity=lab.velocities.slice(),chem=lab.chem.slice(),predicted=old.slice();for(let i=0;i<old.length;i+=4){predicted[i]+=.006*Math.sin(i);predicted[i+1]-=.01;}
 const solve=packed=>{lab.gpu.uniforms.uPackedGpuNeighbors.value=packed;const p=lab.gpu.solve(predicted,lab.spacing,q=>lab.collide(q),3,q=>lab.solid(q));const t=lab.transportGPU.solve(old,p,velocity,chem,lab.gpu.neighbors,lab.spacing,lab.spec.scale,1/15,predicted,lab.gpu);return {p,...t};};
 const reference=solve(false),packed=solve(true);let error=0;const errors={};for(const key of Object.keys(reference)){let max=0;for(let i=0;i<reference[key].length;i++)max=Math.max(max,Math.abs(reference[key][i]-packed[key][i]));errors[key]=max;error=Math.max(error,max);}cases.push({errors,name:'Packed GPU density / transport',error,pass:errors.p<.00001&&errors.velocities<.0001&&errors.chem<.00001&&errors.metrics<.01&&errors.activity<.001&&errors.breakup<.0001&&errors.counts===0});
 lab.neighborCounts=new Uint16Array(lab.count).fill(25);for(let i=0;i<30;i++){lab.positions.set([(i%5-2)*.22,2+Math.floor(i/5)*.2,1],i*4);lab.neighborCounts[i]=0;}lab.time=1;lab.revision++;draw.blobRenderer.families.update(lab);lab.time+=.05;for(const i of draw.blobRenderer.families.active.keys())draw.blobRenderer.families.active.set(i,.7);
 for(const eye of [[4.8,4,4.4],[0,.8,1.2]]){camera.position.fromArray(eye);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
 lab.objectRadius=.18;if(!lab.balls.length)for(let i=0;i<3;i++){const b=lab.spawn(['rock','mirror','light'][i],[-.7+i*.7,1.4,.8],[0,0,-1]);b.velocity.fill(0);}
 lab.optimizations.surfaceLightReuse=false;draw.drawKey=null;draw.render({adaptive:false});const a=new Float32Array(target.width*target.height*4);renderer.readRenderTargetPixels(target,0,0,target.width,target.height,a);
 lab.optimizations.surfaceLightReuse=true;draw.drawKey=null;draw.render({adaptive:false});const b=new Float32Array(a.length);renderer.readRenderTargetPixels(target,0,0,target.width,target.height,b);let maximum=0,squared=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);maximum=Math.max(maximum,d);squared+=d*d;}cases.push({name:'Surface illumination reuse with objects',eye,maximum,rms:Math.sqrt(squared/a.length),pass:Number.isFinite(maximum)&&maximum<.0001});}
 result.textContent=JSON.stringify({legacyTerrainTolerance:{limit:1e-5,reference:densityReference.sdfError,optimized:density.sdfError,unchanged:density.sdfError===densityReference.sdfError},densityReference,density,cases,pass:density.sandAndTiltedCupMaxError<.002&&density.transportError<.003&&density.sdfError===densityReference.sdfError&&cases.every(c=>c.pass)},null,2);
 }catch(e){result.textContent=e.stack;}};

$('live').onclick=async()=>{try{
 await neighborKernelReady;setup();lab.paused=false;
 const samples=[],windows=[];let last=performance.now(),warmStart=last,start=null,previousSteps=lab.steps,windowStart=last,windowSteps=lab.steps;
 while(start===null||performance.now()-start<12000){
  await next();pollLabReadbacks(renderer);await Promise.resolve();const now=performance.now(),dt=(now-last)/1000;last=now;
  lab.advance(dt,camera);draw.render({dt,adaptive:false});const end=performance.now();
  if(start===null&&end-warmStart>=6000){start=windowStart=end;previousSteps=windowSteps=lab.steps;samples.length=0;}
  else if(start!==null){samples.push({ms:dt*1000,steps:lab.steps-previousSteps});previousSteps=lab.steps;
   if(end-windowStart>=2000){windows.push({seconds:(end-windowStart)/1000,realtime:(lab.steps-windowSteps)*lab.timestep/((end-windowStart)/1000)});windowStart=end;windowSteps=lab.steps;}}
  status.textContent=start===null?'Live warm-up':`Live ${Math.round((end-start)/1000)} / 12 seconds`;
 }
 lab.paused=true;synchronize();const wall=(performance.now()-start)/1000;
 const stats=v=>{const mean=v.reduce((a,b)=>a+b,0)/v.length,sd=Math.sqrt(v.reduce((a,b)=>a+(b-mean)**2,0)/v.length);return {mean,sd,cv:sd/mean};};
 result.textContent=JSON.stringify({type:'production scheduler at fixed resolution',fixture:$('work').value,newOptimizations:$('new').checked,fps:samples.length/wall,realtime:samples.reduce((n,s)=>n+s.steps,0)*lab.timestep/wall,wallSeconds:wall,frame:stats(samples.map(s=>s.ms)),simulationWindow:stats(windows.map(w=>w.realtime)),windows,samples},null,2);status.textContent='Live benchmark complete';
 }catch(e){result.textContent=e.stack;}};

// Each pair uses identical seeds, fixed image dimensions, physics dt, and
// particle budgets. Reverse the order on the second repeat to expose drift.
function synchronize(){renderer.readRenderTargetPixels(target,0,0,1,1,new Float32Array(4));}
async function benchmark(workload,optimized,repeat){
 $('work').value=workload;$('new').checked=optimized;setup();
 const frames=[],intervals=[];const warm=48,count=72;let start,last,hiddenFrames=0,idleFrames=0;
 for(let i=0;i<warm+count;i++){
  await next();pollLabReadbacks(renderer);await Promise.resolve();
  if(i===warm){synchronize();start=last=performance.now();}
  const f=frame();if(i>=warm){frames.push(f);const end=performance.now();intervals.push(end-last);hiddenFrames+=document.hidden?1:0;idleFrames+=end-last-f.total>500?1:0;last=end;}
  status.textContent=`${workload} · ${optimized?'optimized':'reference'} · repeat ${repeat+1} · ${i+1}/${warm+count}`;
 }
 synchronize();const wall=(performance.now()-start)/1000;
 const stats=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length,sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length),sorted=values.slice().sort((a,b)=>a-b);return {mean,sd,cv:sd/mean,p95:sorted[Math.ceil(.95*sorted.length)-1],max:sorted.at(-1)};};
 return {workload,optimized,repeat,scheduling:{hiddenFrames,idleFrames,valid:hiddenFrames===0&&idleFrames===0},warmupSteps:warm,measuredSteps:count,fps:count/wall,realtime:count/15/wall,wallSeconds:wall,frame:stats(intervals),work:stats(frames.map(f=>f.total)),bulk:lab.count,sand:lab.sand.parcels.length,resolution:[target.width,target.height],massError:Math.abs(lab.sand.totalMass()+lab.sand.removedMass-lab.sand.initialMass),waterVolumeError:Math.abs(lab.volume-lab.initialVolume),neighborBackend:lab.gpu.neighborBackend,frames,intervals};
}
$('suite').onclick=async()=>{try{
 await neighborKernelReady;const results=[];const extension=gl.getExtension('WEBGL_debug_renderer_info'),adapter=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const workload=$('work').value;for(let repeat=0;repeat<2;repeat++)for(const optimized of repeat?[true,false]:[false,true]){results.push(await benchmark(workload,optimized,repeat));result.textContent=JSON.stringify({adapter,scheduler:'MessageChannel engine throughput (not compositor presentation)',complete:false,results},null,2);}
 status.textContent='Paired suite complete';result.textContent=JSON.stringify({adapter,scheduler:'MessageChannel engine throughput (not compositor presentation)',complete:true,results},null,2);
 }catch(e){result.textContent=e.stack;}};

$('isolate').onclick=async()=>{try{
 await neighborKernelReady;setup();const results=[],n=lab.count,stats=v=>{const a=v.slice().sort((a,b)=>a-b),mean=v.reduce((a,b)=>a+b,0)/v.length;return {mean,median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1]};};
 const builders=[new PackedNeighbors(),nativeNeighborsAvailable()?new NativeNeighbors():null];
 for(let repeat=0;repeat<2;repeat++)for(const which of repeat?[1,0]:[0,1]){if(!builders[which])continue;const samples=[];for(let i=0;i<14;i++){await next();const start=performance.now();builders[which].build(lab.positions,lab.spacing,true);if(i>=4)samples.push(performance.now()-start);}results.push({part:'CPU neighbors',repeat,optimized:!!which,...stats(samples)});result.textContent=JSON.stringify({nativeAvailable:nativeNeighborsAvailable(),results},null,2);}
 const predicted=lab.positions.slice();for(let i=1;i<predicted.length;i+=4)predicted[i]-=.01;
 for(let repeat=0;repeat<2;repeat++)for(const packed of repeat?[true,false]:[false,true]){lab.gpu.uniforms.uPackedGpuNeighbors.value=packed;const samples=[];for(let i=0;i<18;i++){await next();const start=performance.now();lab.gpu.solve(predicted,lab.spacing,q=>lab.collide(q),3,q=>lab.solid(q));if(i>=4)samples.push(performance.now()-start);}results.push({part:'GPU constraints and readback',repeat,optimized:packed,...stats(samples)});result.textContent=JSON.stringify({nativeAvailable:nativeNeighborsAvailable(),results},null,2);}
 for(let repeat=0;repeat<2;repeat++)for(const optimized of repeat?[true,false]:[false,true]){lab.optimizations.surfaceLightReuse=optimized;const samples=[];for(let i=0;i<18;i++){await next();draw.drawKey=null;const start=performance.now();draw.render({adaptive:false});synchronize();if(i>=4)samples.push(performance.now()-start);}results.push({part:'Frozen rendering',repeat,optimized,...stats(samples)});result.textContent=JSON.stringify({nativeAvailable:nativeNeighborsAvailable(),results},null,2);}
 status.textContent='Individual cost comparison complete';
 }catch(e){result.textContent=e.stack;}};
