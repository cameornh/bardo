import * as THREE from 'three';
import { projectSH } from './sh.js';
import { allocateBudget, projectedMotion } from './lod.js';
import { QUAD_VERTEX } from './shaders.js';
import { createOpticalSamples, sampleRadii, opticalCoefficients, opticalHierarchy } from './optics.js';
import { OPTICS_MOMENTS_VERTEX, OPTICS_MOMENTS_FRAGMENT, OPTICS_BACKGROUND_FRAGMENT, OPTICS_SURFACE_FRAGMENT } from './optics-shaders.js';

export class OpticsRenderer {
 constructor(shared){
  this.enabled=false;this.samples=createOpticalSamples();this.selected=0;this.isolate=false;this.lineup=false;this.split=false;this.transport=true;this.view=0;this.count=0;this.cacheMs=0;this.error=null;this.revision=0;this.busy=false;this.pending=null;this.lastKey='';this.cacheCount=0;
  this.light=new THREE.Vector3(0,.22,1).normalize();
  const sh=projectSH(d=>{const sky=.5+.5*d[1],panel=Math.max(0,(d[0]*.5+d[1]*.3+d[2]*.8)/Math.sqrt(.98))**30;return [.22+.28*sky+panel*3.5,.25+.3*sky+panel*3.3,.29+.33*sky+panel*2.9];});
  const empty=new THREE.Data3DTexture(new Float32Array([0,0,0,1]),1,1,1);empty.type=THREE.FloatType;empty.format=THREE.RGBAFormat;empty.needsUpdate=true;this.empty=empty;
  this.moments=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  this.uniforms={...shared,uOpticsLight:{value:this.light},uSampleCenter:{value:new THREE.Vector3()},uRadii:{value:new THREE.Vector3(1,1,1)},uSigmaA:{value:new THREE.Vector3()},uSigmaS:{value:new THREE.Vector3()},uDiffusion:{value:new THREE.Vector3()},uBoundary:{value:new THREE.Vector3()},uGridStep:{value:new THREE.Vector3()},uRoughness:{value:.2},uIOR:{value:1.5},uPhaseG:{value:0},uOpaque:{value:true},uSplit:{value:false},uTransport:{value:true},uOpticsView:{value:0},uFluence:{value:empty},uMoments:{value:this.moments.texture},uCardCenters:{value:this.samples.slice(3).map(s=>new THREE.Vector3(...s.center))},uOpticsSH:{value:Array.from({length:16},(_,i)=>new THREE.Vector3(...sh.subarray(i*3,i*3+3)))}};
  Object.assign(this.uniforms,{uSampleID:{value:0},uSceneCenters:{value:this.samples.map(s=>new THREE.Vector3(...s.center))},uSceneRadii:{value:this.samples.map(s=>new THREE.Vector3(...sampleRadii(s)))},uSceneA:{value:this.samples.map(()=>new THREE.Vector3())},uSceneS:{value:this.samples.map(()=>new THREE.Vector3())},uSceneOptics:{value:this.samples.map(()=>new THREE.Vector4())},uSceneD:{value:Array.from({length:3},()=>new THREE.Vector3())},uSceneBoundary:{value:Array.from({length:3},()=>new THREE.Vector3(1,1,1))},uSceneStep:{value:Array.from({length:3},()=>new THREE.Vector3())},uSceneReady:{value:new THREE.Vector3()},uField0:{value:empty},uField1:{value:empty},uField2:{value:empty}});
  this.quadCamera=new THREE.Camera();
  const quad=(fragment,options={})=>{const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.uniforms,depthTest:false,depthWrite:false,...options})));return scene;};
  this.background=quad(OPTICS_BACKGROUND_FRAGMENT);
  this.surface=quad(OPTICS_SURFACE_FRAGMENT,{depthTest:true,depthWrite:true,transparent:true,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
  this.gaussianMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:OPTICS_MOMENTS_VERTEX,fragmentShader:OPTICS_MOMENTS_FRAGMENT,uniforms:this.uniforms,depthTest:false,depthWrite:false,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
  this.splatScene=new THREE.Scene();this.mesh=new THREE.Mesh(new THREE.BufferGeometry(),this.gaussianMaterial);this.mesh.frustumCulled=false;this.splatScene.add(this.mesh);
  this.samples.forEach(s=>this.rebuild(s));
  this.worker=new Worker(new URL('./subsurface-worker.js',import.meta.url),{type:'module'});
  this.worker.onerror=e=>{this.error=e.message;this.busy=false;};
  this.worker.onmessage=({data})=>{
   this.busy=false;if(data.error){this.error=data.error;return;}
   this.cacheMs=data.ms;
   for(const result of data.results){
    const sample=this.samples[result.id];if(this.inflight.keys[result.id]!==this.transportKey(sample))continue;
    const texture=new THREE.Data3DTexture(result.data,...result.size);texture.type=THREE.FloatType;texture.format=THREE.RGBAFormat;texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.unpackAlignment=1;texture.needsUpdate=true;
    sample.texture?.dispose();sample.texture=texture;sample.field=result;sample.cacheRevision=data.id;
   }
   this.cacheCount++;if(this.pending){const request=this.pending;this.pending=null;this.dispatch(request);}
  };
 }
 transportKey(s){return JSON.stringify([s.thickness,s.scatterScale,s.absorptionScale,s.turbidity]);}
 rebuild(s){
  s.geometry?.dispose();s.levels=opticalHierarchy(sampleRadii(s));
  const count=s.levels.reduce((sum,l)=>sum+l.count,0),arrays=Array.from({length:4},()=>new Float32Array(count*4));let index=0;
  for(const level of s.levels){level.offset=index;for(const g of level.nodes){const o=index++*4,c=g.cov;arrays[0].set([...g.center,g.tau],o);arrays[1].set(c.slice(0,3),o);arrays[2].set(c.slice(3),o);arrays[3].set(g.normal,o);}}
  s.arrays=arrays;s.geometry=new THREE.InstancedBufferGeometry();s.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));s.geometry.setIndex([0,1,2,0,2,3]);
  // Each level is a separate static attribute window; only optical weights change.
  s.drawGeometry=new THREE.InstancedBufferGeometry();s.drawGeometry.setAttribute('position',s.geometry.getAttribute('position'));s.drawGeometry.setIndex(s.geometry.index);
  s.drawArrays=Array.from({length:4},()=>new Float32Array((s.levels[0].count+(s.levels[1]?.count||0))*4));
  ['aCenter','aCov0','aCov1','aNormal'].forEach((name,i)=>s.drawGeometry.setAttribute(name,new THREE.InstancedBufferAttribute(s.drawArrays[i],4).setUsage(THREE.DynamicDrawUsage)));
 }
 configure(id,changes){const s=this.samples[id],before=this.transportKey(s);Object.assign(s,changes);if('thickness' in changes){s.drawGeometry.dispose();this.rebuild(s);}if(before!==this.transportKey(s))this.lastKey='';}
 reset(id){const fresh=createOpticalSamples()[id],s=this.samples[id];s.texture?.dispose();s.texture=null;s.field=null;this.configure(id,fresh);this.layout();this.lastKey='';}
 layout(){const defaults=createOpticalSamples();for(const s of this.samples){s.center=[...defaults[s.id].center];if(this.lineup&&s.id<6)s.center=[(s.id%3-1)*2.35,3.8,s.id<3?-.7:1.15];}}
 dispatch(request){this.busy=true;this.inflight=request;this.worker.postMessage(request);}
 requestTransport(){
  const samples=this.samples.filter(s=>s.diffusion).map(({id,radii,thickness,absorption,scattering,g,ior,absorptionScale,scatterScale,turbidity})=>({id,radii,thickness,absorption,scattering,g,ior,absorptionScale,scatterScale,turbidity}));
  const light=this.light.toArray(),key=JSON.stringify([samples,light.map(v=>Math.round(v*1000)),this.split]);if(key===this.lastKey)return;this.lastKey=key;
  const request={id:++this.revision,samples,light,split:this.split,keys:Object.fromEntries(this.samples.map(s=>[s.id,this.transportKey(s)]))};
  if(this.busy)this.pending=request;else this.dispatch(request);
 }
 render(field,{lightAngle,dt,adaptive,focusDistance}){
  if(this.error)throw new Error(this.error);
  const renderer=field.renderer,camera=field.camera,u=this.uniforms;
  this.light.set(Math.cos(lightAngle),.22,Math.sin(lightAngle)).normalize();this.requestTransport();
  const current={position:camera.position.toArray(),quaternion:camera.quaternion.toArray()},focal=field.resolution.y*camera.projectionMatrix.elements[5]*.5;
  field.motion.update(projectedMotion(field.previousCamera,current,dt,focal,focusDistance),dt,adaptive);field.previousCamera=current;
  for(const s of this.samples){const i=s.id,c=opticalCoefficients(s);u.uSceneCenters.value[i].fromArray(s.center);u.uSceneRadii.value[i].fromArray(sampleRadii(s));u.uSceneA.value[i].fromArray(c.absorption);u.uSceneS.value[i].fromArray(c.scattering);u.uSceneOptics.value[i].set(s.ior,s.roughness,s.g,!this.isolate||this.selected===i?1:0);
   if(i<3){u.uSceneD.value[i].fromArray(s.field?.diffusion||[0,0,0]);u.uSceneBoundary.value[i].fromArray(s.field?.boundary||[1,1,1]);u.uSceneStep.value[i].fromArray(s.field?.step||[.01,.01,.01]);u.uSceneReady.value.setComponent(i,s.field?1:0);u[`uField${i}`].value=s.texture||this.empty;}
  }
  const subjects=this.samples.filter(s=>!this.isolate||s.id===this.selected),v=camera.matrixWorldInverse.elements;
  const items=subjects.map(s=>({sample:s,levels:s.levels,scale:focal/Math.max(.5,-(v[2]*s.center[0]+v[6]*s.center[1]+v[10]*s.center[2]+v[14]))}));
  const allocation=allocateBudget(items,field.minPixelSigma*field.motion.factor,field.budget);field.effectivePixelTarget=allocation.target;
  this.count=0;field.visibleSplats=0;field.sortMs=0;field.byMaterial.fill(0);field.grass.count=field.water.count=field.grains.count=field.soft.count=0;
  u.uSplit.value=this.split;u.uTransport.value=this.transport;u.uOpticsView.value=this.view;
  if(this.moments.width!==field.resolution.x||this.moments.height!==field.resolution.y)this.moments.setSize(field.resolution.x,field.resolution.y);
  // Move unused cards out of the scene when inspecting an isolated sample.
  u.uCardCenters.value.forEach((center,i)=>center.set(...(this.isolate&&this.selected!==i+3?[1e4,1e4,0]:this.samples[i+3].center)));
  renderer.setClearColor(0,0);renderer.setRenderTarget(field.target);renderer.clear();renderer.render(this.background,this.quadCamera);
  const ordered=items.map((item,i)=>({...item,choice:allocation.choices[i]})).sort((a,b)=>a.scale-b.scale);
  for(const {sample:s,choice} of ordered){
   u.uSampleID.value=s.id;u.uSampleCenter.value.fromArray(s.center);u.uRadii.value.fromArray(sampleRadii(s));const c=opticalCoefficients(s);u.uSigmaA.value.fromArray(c.absorption);u.uSigmaS.value.fromArray(c.scattering);u.uRoughness.value=s.roughness;u.uIOR.value=s.ior;u.uPhaseG.value=s.g;u.uOpaque.value=s.diffusion;
   u.uFluence.value=s.texture||this.empty;u.uDiffusion.value.fromArray(s.field?.diffusion||[0,0,0]);u.uBoundary.value.fromArray(s.field?.boundary||[1,1,1]);u.uGridStep.value.fromArray(s.field?.step||[.01,.01,.01]);
   // A local diffuse baseline is visible during the first asynchronous cache build.
   u.uTransport.value=this.transport&&(!s.diffusion||!!s.field);
   const parts=choice.a===choice.b?[[choice.a,1]]:[[choice.a,1-choice.t],[choice.b,choice.t]];let drawn=0;
   for(const [levelIndex,weight] of parts){if(weight<.0001)continue;const level=s.levels[levelIndex];
    for(let i=0;i<4;i++)s.drawArrays[i].set(s.arrays[i].subarray(level.offset*4,(level.offset+level.count)*4),drawn*4);
    for(let i=0;i<level.count;i++)s.drawArrays[0][(drawn+i)*4+3]*=weight;drawn+=level.count;
   }
   s.drawGeometry.instanceCount=drawn;for(const attribute of Object.values(s.drawGeometry.attributes))if(attribute.isInstancedBufferAttribute){attribute.clearUpdateRanges();attribute.addUpdateRange(0,drawn*4);attribute.needsUpdate=true;}
   this.count+=drawn;this.mesh.geometry=s.drawGeometry;this.gaussianMaterial.uniformsNeedUpdate=true;
   renderer.setRenderTarget(this.moments);renderer.clear();renderer.render(this.splatScene,camera);
   this.surface.children[0].material.uniformsNeedUpdate=true;renderer.setRenderTarget(field.target);renderer.render(this.surface,this.quadCamera);
  }
  renderer.setRenderTarget(null);renderer.clear();renderer.render(field.output,field.quadCamera);
  return !field.error;
 }
 dispose(){this.worker.terminate();this.empty.dispose();this.moments.dispose();this.gaussianMaterial.dispose();for(const s of this.samples){s.geometry.dispose();s.drawGeometry.dispose();s.texture?.dispose();}for(const scene of [this.background,this.surface])for(const mesh of scene.children){mesh.geometry.dispose();mesh.material.dispose();}}
}
