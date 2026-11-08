import {installParticleVisibility} from '../rtx-sand-lab/particle-visibility.js';
import {FrameCompletion} from '../rtx-sand-lab/frame-completion.js';
import * as THREE from 'three';
import {SharedSceneWebGPU} from './renderer.js';
import {LiveSandLab} from '../rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../rtx-sand-lab/live-renderer.js';
import {configureRTXLab} from '../rtx-sand-lab/profile.js';
import {installRTXShaderCompatibility} from '../rtx-sand-lab/shader-compatibility.js';
import {installProgramSpecialization} from '../sand-lab/program-specialization.js';
import {liveProgramConstants} from '../rtx-sand-lab/shader-dependencies.js';
import {MotionDetail} from '../lod.js';
import {SeaFoam} from '../sand-lab/sea-foam.js';

export async function createSharedFixture(canvas,{width=320,height=200,resolution=1,backend='webgpu'}={}){
 const renderer=backend==='webgl'?new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'}):await SharedSceneWebGPU.create(canvas);renderer.autoClear=false;renderer.setSize(width,height,false);
 installRTXShaderCompatibility(renderer,{declaredOnly:true,boundedLoops:true,reachableOnly:true});
 const lab=new LiveSandLab(renderer,{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab,{});lab.resolutions.ocean=resolution;lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.wind=24;lab.reactiveWaves=true;lab.seaFoam=new SeaFoam(renderer);
 const camera=new THREE.PerspectiveCamera(55,width/height,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),field={renderer,camera,target,resolution:new THREE.Vector2(width,height),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
 for(const name of ['beach','grass','grains','soft','optics','lightTest'])field[name]={count:0};
 const draw=new LiveWaterRenderer(field,lab);installParticleVisibility(draw);draw.fixedLoadScale=1;draw.mediumShadows.u.uMediumSize.value.set(16,12,16);
 installProgramSpecialization(renderer,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});
 const completion=renderer.isSharedSceneWebGPU?null:new FrameCompletion(renderer);const complete=()=>renderer.isSharedSceneWebGPU?renderer.flush():completion.run(()=>{});return {renderer,lab,draw,field,camera,complete};
}
