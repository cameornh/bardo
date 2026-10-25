import * as THREE from 'three';
import {FieldOccupancy} from '../sand-lab/field-occupancy.js';

// LINK_STATUS, uniform discovery, and drawing can all wait for compilation.
// Poll only COMPLETION_STATUS through THREE.Program.isReady until ready.
export async function prepareShaderJobs(renderer,jobs,{before=async()=>{},timeoutMs=60000,now=()=>performance.now(),wait=()=>new Promise(r=>setTimeout(r,16))}={}){
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
  }
  return {prepared};
 }finally{if(!renderer.getContext().isContextLost())renderer.setRenderTarget(previous);}
}

export function firstFrameShaderJobs(draw){
 const {lab,field}=draw,camera=field.camera,jobs=[];
 draw.u.uReuseSurfaceLight.value=!!lab.optimizations.surfaceLightReuse;
 draw.density.emptySpace=lab.optimizations.emptySpace!==false;draw.density.setup(lab.spacing,lab.fieldBounds);
 const add=(name,scene,camera,target)=>{
  if(!scene)return;let vertexChars=0,fragmentChars=0;
  scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){m.name||=name;vertexChars+=m.vertexShader?.length||0;fragmentChars+=m.fragmentShader?.length||0;}});
  jobs.push({name,scene,camera,target,vertexChars,fragmentChars});
 };
 add('atmosphere',draw.atmosphere.scene,draw.atmosphere.camera,draw.atmosphere.lookup);
 if(lab.detail.count)add('spray shadows',draw.sprayShadows.scene,draw.sprayShadows.camera,draw.sprayShadows.target);
 add('Gaussian water reconstruction',draw.density.scene,draw.density.camera,draw.density.target);
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
 add('detached water',draw.blobRenderer.scene,camera,draw.blobs);
 add('water merge',draw.mergeScene,draw.quadCamera,draw.resolvedWater);
 add('image copy',draw.copyScene,draw.quadCamera,draw.composite);
 add('rain',draw.rainScene,camera,draw.composite);
 add('glass surfaces',draw.shellScene,draw.quadCamera,draw.shellTarget);
 add('Gaussian stars',draw.stars.scene,camera,field.target);
 add('exposure reduction',draw.exposure.reduce.scene,draw.exposure.camera,draw.exposure.states[0]);
 add('exposure adaptation',draw.exposure.adapt.scene,draw.exposure.camera,draw.exposure.states[0]);
 add('display',draw.exposure.output.scene,draw.exposure.camera,null);
 return jobs;
}
