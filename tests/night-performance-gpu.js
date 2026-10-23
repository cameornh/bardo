import {neighborKernelReady,nativeNeighborsAvailable} from '../src/sand-lab/native-neighbors.js';
import {pollLabReadbacks} from '../src/sand-lab/water-lab-readback.js';
import * as THREE from 'three';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {MotionDetail} from '../src/lod.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {QUAD_VERTEX,TONEMAP_FRAGMENT} from '../src/shaders.js';
import {ATMOSPHERE_GLSL,atmosphereSky} from '../src/sand-lab/atmosphere-model.js';
import {moonDirection,celestialMatrix} from '../src/sand-lab/night-sky-model.js';
import {LUNAR_MONTH,lunarState} from '../src/sand-lab/tides.js';
import {LabExposure,exposureStatistics,exposureTarget,adaptExposure} from '../src/sand-lab/sky-exposure.js';
const $=id=>document.getElementById(id),result=$('result'),r=new THREE.WebGLRenderer({preserveDrawingBuffer:true});r.autoClear=false;r.setSize(960,600);document.body.insertBefore(r.domElement,result);
r.debug.onShaderError=(gl,p,v,f)=>{throw Error(gl.getShaderInfoLog(f)||gl.getProgramInfoLog(p));};window.addEventListener('error',e=>result.textContent=e.error?.stack||e.message);
const lab=new SandLab(r);lab.paused=true;lab.lunarCycle=false;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;lab.wind=0;installProgramSpecialization(r,()=>true);
const camera=new THREE.PerspectiveCamera(65,960/600,.01,300),target=new THREE.WebGLRenderTarget(960,600,{type:THREE.FloatType}),output=new THREE.Scene();output.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:TONEMAP_FRAGMENT,uniforms:{uImage:{value:target.texture}}})));
const field={renderer:r,camera,target,output,quadCamera:new THREE.Camera(),resolution:new THREE.Vector2(960,600),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.08},uTurbidity:{value:0}}}};for(const key of ['beach','grass','grains','soft','optics','lightTest'])field[key]={count:0};
const draw=new WaterLabRenderer(field,lab);draw.adaptiveResolution=false;draw.mediumShadows.u.uMediumSize.value.set(16,12,16);

const channel=new MessageChannel(),waiting=[];channel.port1.onmessage=()=>waiting.shift()?.();const next=()=>new Promise(r=>{waiting.push(r);channel.port2.postMessage(0);});
const gl=r.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info'),adapter=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
$('run').onclick=async()=>{try{await neighborKernelReady;const results=[];for(const mode of ['day','night','lunar']){lab.day=mode==='day'?14:21.4;lab.lunarDay=9.57;lab.paused=false;const samples=[];for(let i=0;i<16;i++){await next();if(mode==='lunar')lab.lunarDay+=.002;lab.time+=1/15;lab.revision++;lab.syncUniforms();draw.drawKey=null;const t=performance.now();draw.render({dt:1/15,adaptive:false});r.readRenderTargetPixels(target,0,0,1,1,new Float32Array(4));if(i>=4)samples.push({ms:performance.now()-t,rows:draw.mediumShadows.updatedRows,full:draw.mediumShadows.fullRefresh,sky:draw.atmosphere.revision,gpu:{...draw.timers.ms}});result.textContent=JSON.stringify({mode,frame:i,results});}results.push({mode,mean:samples.reduce((s,x)=>s+x.ms,0)/samples.length,samples});}result.textContent=JSON.stringify({complete:true,adapter,resolution:[960,600],bulk:lab.count,results},null,2);}catch(e){result.textContent=e.stack;}};
result.textContent='Ready · '+adapter;

$('live').onclick=async()=>{try{await neighborKernelReady;const results=[];draw.fixedLoadScale=.5;lab.detail.enabled=true;lab.wind=24;lab.paused=false;for(const mode of ['day','night']){lab.configure('ocean');lab.day=mode==='day'?14:21.4;lab.lunarDay=9.57;lab.lunarCycle=true;camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();const frames=[];for(let i=0;i<36;i++){await next();pollLabReadbacks(r);await Promise.resolve();const start=performance.now();lab.step(1/15,true);const physics=performance.now();lab.detail.advance(1/15,lab,lab.detailJet);draw.render({dt:1/15,adaptive:false});r.readRenderTargetPixels(target,0,0,1,1,new Float32Array(4));if(i>=12)frames.push({ms:performance.now()-start,physics:physics-start});result.textContent=JSON.stringify({running:mode,frame:i,results});}const mean=frames.reduce((s,x)=>s+x.ms,0)/frames.length;results.push({mode,mean,neighbors:lab.gpu.neighborBackend,kernelAvailable:nativeNeighborsAvailable(),fps:1000/mean,realtime:1000/(15*mean),bulk:lab.count,fine:lab.detail.count,frames});}result.textContent=JSON.stringify({complete:true,adapter,resolution:[target.width,target.height],results},null,2);}catch(e){result.textContent=e.stack;}};
