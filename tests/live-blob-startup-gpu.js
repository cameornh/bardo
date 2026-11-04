import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {installRTXGraphicsGuard} from '../src/rtx-sand-lab/graphics.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {prepareShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
import {sampleBlob} from '../src/sand-lab/water-lab-blobs.js';
import {QUAD_VERTEX} from '../src/shaders.js';

const out=document.querySelector('#result'),button=document.querySelector('#run');
button.onclick=async()=>{
 button.disabled=true;let renderer;
 try{
  renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#view'),antialias:false});renderer.setSize(96,64);renderer.autoClear=false;
  const guard=installRTXGraphicsGuard(renderer,e=>{out.textContent=e.stack;});installRTXShaderCompatibility(renderer);
  const lab=new LiveSandLab(renderer),camera=new THREE.PerspectiveCamera(43,96/64,.01,50),field={renderer,camera,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}},draw=new LiveWaterRenderer(field,lab),blob=draw.blobRenderer,split=draw.splitBlobs;
  installProgramSpecialization(renderer,()=>true,{warmObjects:false,prepareCompile:true});
  lab.sand.parcels.push({id:999,position:[-.7,2,0],mass:.02,packing:.6,wet:.8,aspect:1,cuts:[{offset:[.05,.04,0],radius:.08}]});lab.sand.update();
  lab.spawn('rock',[-1.5,2,0],[0,0,-1],'sphere');lab.spawn('glass',[1.5,2,0],[0,0,-1],'cup');lab.syncUniforms();
  // Use the actual live shaders, object uniforms and sand geometry. Only the
  // water fixture is reduced; no pressure solver or full-scene draw runs here.
  lab.positions=new Float32Array([0,3,0,0]);lab.chem=new Float32Array([0,.12,0,0]);lab.neighborCounts=new Uint16Array(1);lab.velocities=new Float32Array(4);lab.spec={...lab.spec,spacing:.3};
  camera.position.set(0,3,1.7);camera.lookAt(0,3,0);camera.updateMatrixWorld();
  const u=draw.u;u.uEye.value.copy(camera.position);u.uCameraMatrix.value.copy(camera.matrixWorld);u.uInverseProjection.value.copy(camera.projectionMatrixInverse);u.uProjection.value.copy(camera.projectionMatrix);u.uViewMatrix.value.copy(camera.matrixWorldInverse);u.uResolution.value.set(96,64);u.uSpacing.value=.3;u.uScale.value=lab.spec.scale;u.uSH.value[0].set(1,1,1);u.uAmbient.value=1;u.uSunlight.value=1;u.uReuseSurfaceLight.value=true;
  draw.density.emptySpace=false;draw.density.nearCells=8;draw.density.setView([0,3,0]);draw.density.update([],.3,{min:[-3,1,-3],max:[3,5,3]});
  const empty=new THREE.DataTexture(new Float32Array([.15,.22,.3,1e4]),1,1,THREE.RGBAFormat,THREE.FloatType);empty.needsUpdate=true;u.uImage.value=empty;u.uBulkWater.value=empty;
  // Define an empty paused frame, then compile both exact variants before any
  // detached family appears. No giant combined blob program is submitted.
  const target=new THREE.WebGLRenderTarget(96,64,{type:THREE.FloatType,depthBuffer:true});
  const programs=await prepareShaderJobs(renderer,[{name:'live detached-water tracing',scene:split.traceScene,camera,target:split.target},{name:'live detached-water shading',scene:split.scene,camera:split.camera,target}],{before:async name=>{out.textContent=name;}});
  const programCount=renderer.info.programs.length;let maxSurfaceError=0,coverage=0,finite=true;
  for(let frame=0;frame<12;frame++){
   lab.time=frame/30;lab.positions[0]=Math.sin(frame*.2)*.08;blob.update(lab);
   renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();split.render(renderer,camera,renderer.render);
   const pixels=await renderer.readRenderTargetPixelsAsync(target,0,0,96,64,new Float32Array(96*64*4));
   finite&&=pixels.every(Number.isFinite);coverage=0;
   for(let y=0;y<64;y++)for(let x=0;x<96;x++){const depth=pixels[(y*96+x)*4+3];if(depth<=0)continue;coverage++;
    const ray=new THREE.Vector3((x+.5)/96*2-1,(y+.5)/64*2-1,1).applyMatrix4(camera.projectionMatrixInverse).transformDirection(camera.matrixWorld),p=camera.position.clone().addScaledVector(ray,depth).toArray();
    maxSurfaceError=Math.max(maxSurfaceError,Math.abs(sampleBlob(blob.families.families[0],p).density-.18));
   }
   guard.assertHealthy();await new Promise(resolve=>setTimeout(resolve,16));
  }
  const noLateCompile=renderer.info.programs.length===programCount;
  const present=new THREE.Scene();present.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:'precision highp float;uniform sampler2D uImage;in vec2 vUv;out vec4 color;void main(){vec4 p=texture(uImage,vUv);color=vec4(p.a>0.?pow(p.rgb/(1.+p.rgb),vec3(1./2.2)):vec3(.16,.20,.23),1);}',uniforms:{uImage:{value:target.texture}},depthTest:false,depthWrite:false})));
  renderer.setRenderTarget(null);renderer.render(present,new THREE.Camera());
  out.textContent=JSON.stringify({pass:finite&&coverage>50&&maxSurfaceError<.004&&noLateCompile,frames:12,detachedFamilies:blob.geometry.instanceCount,carvedSandShapes:lab.u.uSandCount.value,objects:lab.u.uBodyCount.value,coverage,maxSurfaceError,noLateCompile,programs,traceChars:blob.material.fragmentShader.length,shadeChars:split.material.fragmentShader.length,contextLost:renderer.getContext().isContextLost()},null,2);
 }catch(e){out.textContent=e?.stack||String(e);}
};
