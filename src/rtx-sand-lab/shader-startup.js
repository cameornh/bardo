import * as THREE from 'three';
import {FieldOccupancy} from '../sand-lab/field-occupancy.js';
import {StepReadback} from '../sand-lab/gpu-step-readback.js';
import {AirFieldTexture} from './fields/air-texture.js';

// LINK_STATUS, uniform discovery, and drawing can all wait for compilation.
// Poll only COMPLETION_STATUS through THREE.Program.isReady until ready.
export async function prepareShaderJobs(renderer,jobs,{before=async()=>{},exercise=null,timeoutMs=60000,now=()=>performance.now(),wait=()=>new Promise(r=>setTimeout(r,16))}={}){
 if(!renderer.extensions.has('KHR_parallel_shader_compile'))return {prepared:0,reason:'Parallel shader compilation unavailable'};
 const previous=renderer.getRenderTarget();let prepared=0;
 try{
  for(const job of jobs){
   await before('Compiling '+job.name,{vertexChars:job.vertexChars,fragmentChars:job.fragmentChars});
   if(renderer.getContext().isContextLost())throw Error('Graphics context lost before '+job.name);
   renderer.setRenderTarget(job.target);const started=now(),materials=renderer.compile(job.scene,job.camera);
   const programs=[...new Set([...materials].map(m=>renderer.properties.get(m).currentProgram))];
   while(programs.some(p=>!p.isReady())){
    if(renderer.getContext().isContextLost())throw Error('Graphics context lost while compiling '+job.name);
    if(now()-started>timeoutMs)throw Error('Shader compilation timed out: '+job.name+'. No scene draw was submitted for this shader.');
    await wait();
   }
   // Safe only after completion. This also surfaces compile/link errors with
   // the named pass instead of discovering them inside a full-frame draw.
   for(const p of programs)p.getUniforms();prepared++;
   if(exercise){await before('Preparing first draw: '+job.name);await exercise(job);}
  }
  return {prepared};
 }finally{if(!renderer.getContext().isContextLost())renderer.setRenderTarget(previous);}
}

// A successful link does not guarantee the driver's first-draw pipeline has
// been built. Exercise fullscreen programs sequentially, with one pixel and
// isolated outputs. Never dispatch the actual simulation or instanced scene.
// All dependent textures remain the scene's read-only initial bindings.
export function createShaderExercise(renderer,completion){
 const targets=new Map();
 const exercise=async job=>{
  const meshes=job.scene.children.filter(o=>o.isMesh);
  if(meshes.length!==1||meshes[0].geometry.isInstancedBufferGeometry||meshes[0].isInstancedMesh)return;
  const count=job.target?.textures.length||1;
  if(!targets.has(count))targets.set(count,new THREE.WebGLRenderTarget(1,1,{count,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
  const previous=renderer.getRenderTarget();
  try{renderer.setRenderTarget(targets.get(count));await completion.run(()=>renderer.render(job.scene,job.camera));}
  finally{if(!renderer.getContext().isContextLost())renderer.setRenderTarget(previous);}
 };
 exercise.dispose=()=>{for(const target of targets.values())target.dispose();targets.clear();};
 return exercise;
}

export function firstFrameShaderJobs(draw){
 const {lab,field}=draw,camera=field.camera,jobs=[];
 draw.u.uReuseSurfaceLight.value=!!lab.optimizations.surfaceLightReuse;
 draw.density.emptySpace=lab.optimizations.emptySpace!==false;draw.density.setup(lab.spacing,lab.fieldBounds);
 const add=(name,scene,camera,target)=>{
  if(!scene)return;let vertexChars=0,fragmentChars=0;
  const split=draw.splitSurfaces?.get(scene);if(split){for(const job of split.jobs(target))add(job.name,job.scene,job.camera,job.target);return;}
  scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){m.name||=name;vertexChars+=m.vertexShader?.length||0;fragmentChars+=m.fragmentShader?.length||0;}});
  jobs.push({name,scene,camera,target,vertexChars,fragmentChars});
 };
 add('atmosphere',draw.atmosphere.scene,draw.atmosphere.camera,draw.atmosphere.lookup);
 if(draw.splitSurfaces||lab.detail.count)add('spray shadows',draw.sprayShadows.scene,draw.sprayShadows.camera,draw.sprayShadows.target);
 if(draw.sprayAtlas)add('spray shadow atlas',draw.sprayAtlas.scene,draw.sprayAtlas.camera,draw.sprayAtlas.target);
 add('Gaussian water reconstruction',draw.density.scene,draw.density.camera,draw.density.target);
 if(draw.splitSurfaces&&draw.nestedWaterFields)add('nested water copy',draw.density.copyScene,draw.density.camera,draw.density.target);
 if(draw.density.emptySpace){
  const occupancy=draw.density.occupancy??=new FieldOccupancy(draw.renderer);
  for(const [name,m] of [['water field maxima',occupancy.material],['water field copy',occupancy.copy]]){
   const scene=new THREE.Scene();scene.add(new THREE.Mesh(occupancy.geometry,m));add(name,scene,occupancy.camera,draw.density.target);
  }
 }
 add('medium lighting',draw.mediumShadows.scene,draw.mediumShadows.camera,draw.density.target);
 add('caustic photons',draw.photonScene,draw.quadCamera,draw.photons);
 add('caustic gather',draw.photonGather,draw.quadCamera,draw.caustics);
 add('water front',draw.splatScene,camera,draw.front);
 add('opaque scene',draw.backgroundScene,draw.quadCamera,draw.background);
 add('water surface',draw.waterScene,draw.quadCamera,draw.water);
 if(draw.splitSurfaces)add('underwater surface',draw.submergedScene,draw.quadCamera,draw.water);
 add('detached water tracing',draw.blobRenderer.scene,camera,draw.splitBlobs?.target||draw.blobs);
 if(draw.splitBlobs)add('detached water shading',draw.splitBlobs.scene,draw.splitBlobs.camera,draw.blobs);
 add('water merge',draw.mergeScene,draw.quadCamera,draw.resolvedWater);
 add('image copy',draw.copyScene,draw.quadCamera,draw.composite);
 // These are empty while paused, but wind/rain can activate them immediately
 // after Resume. Prepare the bounded live programs before the first draw.
 if(draw.splitBlobs){
  add('fine water lighting',draw.detailRenderer.opticalScene,draw.detailRenderer.camera,draw.detailRenderer.paths);
  add('fine water Gaussians',draw.detailRenderer.scene,camera,draw.detailRenderer.target);
  add('fine water composite',draw.detailRenderer.composite,draw.detailRenderer.camera,draw.composite);
 }
 if(!draw.splitBlobs||lab.rain.enabled)add('rain',draw.rainScene,camera,draw.composite);
 add('glass surfaces',draw.shellScene,draw.quadCamera,draw.shellTarget);
 if(draw.splitSurfaces&&!lab.gpu.cpu){
  // These programs first execute after Play, when foam / eroded sand exist.
  // Compile them with their real scene bindings, without advancing physics,
  // spawning a marker, or executing a compute dispatch to "warm" the driver.
  const targets=draw.playbackCompileTargets??=new Map();
  const target=count=>{if(!targets.has(count))targets.set(count,new THREE.WebGLRenderTarget(1,1,{count,type:THREE.FloatType,depthBuffer:false}));return targets.get(count);};
  const detail=lab.detail;Object.assign(detail.u,lab.u,lab.air.u);
  detail.flow.field.setup(lab.spacing,lab.fieldBounds);
  add('fine water transport',detail.scene,detail.camera,target(3));
  add('fine water flow field',detail.flow.field.scene,detail.flow.field.camera,target(1));
  add('foam contact field',detail.contact.scene,detail.contact.camera,target(1));
  add('sand grain transport',draw.sandGrains.computeScene,draw.sandGrains.camera,target(2));
  add('sand grain drawing',draw.sandGrains.scene,camera,draw.composite);
  lab.transportGPU.u.uPackedGpuNeighbors.value=!!lab.optimizations.packedGpuNeighbors;
  add('water transport',lab.transportGPU.scene,lab.transportGPU.camera,target(4));
  lab.stepReadback??=new StepReadback(draw.renderer);
  add('physics transfer',lab.stepReadback.scene,lab.stepReadback.camera,target(1));
  if(lab.bulkFields?.enabled){
   lab.bulkFields.airTexture??=new AirFieldTexture(draw.renderer,lab.air);
   const air=lab.bulkFields.airTexture;add('projected air transfer',air.scene,air.camera,target(1));
  }else add('air field',lab.air.scene,lab.air.camera,target(1));
 }
 add('Gaussian stars',draw.stars.scene,camera,field.target);
 add('exposure reduction',draw.exposure.reduce.scene,draw.exposure.camera,draw.exposure.states[0]);
 add('exposure adaptation',draw.exposure.adapt.scene,draw.exposure.camera,draw.exposure.states[0]);
 add('display',draw.exposure.output.scene,draw.exposure.camera,null);
 return jobs;
}
