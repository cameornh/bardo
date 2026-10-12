import * as THREE from 'three';
import { makeLightScene, DEFAULT_LIGHT_TEST } from './light-transport.js';
import { lightSurfaceGaussians, pathGaussians } from './light-gaussians.js';
import { projectSH } from './sh.js';
import { allocateBudget, projectedMotion, sameViewMatrix } from './lod.js';
import { QUAD_VERTEX } from './shaders.js';
import { LIGHT_CACHE_FRAGMENT, LIGHT_SPLAT_VERTEX, LIGHT_SPLAT_FRAGMENT, LIGHT_BACKDROP_FRAGMENT, LIGHT_PATH_VERTEX, LIGHT_PATH_FRAGMENT } from './light-transport-shaders.js';

const CAPACITY=64000;
function geometry(capacity){const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);for(const name of ['aCenter','aCov0','aCov1','aNormal','aObject'])g.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(capacity*(name==='aObject'?1:4)),name==='aObject'?1:4).setUsage(THREE.DynamicDrawUsage));g.instanceCount=0;return g;}
function put(g,i,node,id,weight=1){const o=i*4;g.attributes.aCenter.array.set([...node.center,node.tau*weight],o);g.attributes.aCov0.array.set(node.cov.slice(0,3),o);g.attributes.aCov1.array.set(node.cov.slice(3),o);g.attributes.aNormal.array.set(node.normal,o);g.attributes.aObject.array[i]=id;}
function upload(g,count){g.instanceCount=count;for(const a of Object.values(g.attributes))if(a.isInstancedBufferAttribute){a.clearUpdateRanges();a.addUpdateRange(0,count*a.itemSize);a.needsUpdate=true;}}
export class LightTransportRenderer{
 constructor(shared){
  this.enabled=false;this.config={...DEFAULT_LIGHT_TEST,photons:16384};this.count=0;this.view=0;this.showPaths=false;this.busy=false;this.error=null;this.result=null;this.revision=0;this.requested=false;this.cacheValid=false;this.lastView=new THREE.Matrix4();this.lastProjection=new THREE.Matrix4();this.geometryView=new THREE.Matrix4();this.geometryProjection=new THREE.Matrix4();this.geometryTarget=-1;
  const sh=projectSH(d=>{const sky=.5+.5*d[1],panel=Math.max(0,(d[0]*.5+d[1]*.5+d[2]*.7)/Math.sqrt(.99))**16;return [.04+.08*sky+panel*.7,.055+.09*sky+panel*.65,.07+.12*sky+panel*.6];});
  this.empty=new THREE.DataTexture(new Float32Array(8),1,2,THREE.RGBAFormat,THREE.FloatType);this.empty.needsUpdate=true;
  this.cache=new THREE.WebGLRenderTarget(1,1,{count:2,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.cache.textures[0].minFilter=this.cache.textures[0].magFilter=THREE.LinearFilter;
  this.uniforms={...shared,uSampleCenter:{value:new THREE.Vector3()},uVolumeCount:{value:0},uCentersLT:{value:Array.from({length:12},()=>new THREE.Vector3())},uSizesLT:{value:Array.from({length:12},()=>new THREE.Vector3())},uShapesLT:{value:Array.from({length:12},()=>new THREE.Vector4())},uParamsLT:{value:Array.from({length:12},()=>new THREE.Vector4())},uEnvironmentLT:{value:Array.from({length:16},(_,i)=>new THREE.Vector3(...sh.subarray(i*3,i*3+3)))},uDirectLT:{value:this.empty},uCausticLT:{value:this.empty},uRadianceLT:{value:this.cache.textures[0]},uHitLT:{value:this.cache.textures[1]},uLightView:{value:0},uDispersion:{value:false}};
  const quad=fragment=>{const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.uniforms,depthTest:false,depthWrite:false})));return scene;};
  this.transport=quad(LIGHT_CACHE_FRAGMENT);this.backdrop=quad(LIGHT_BACKDROP_FRAGMENT);
  const splat=(vertex,fragment)=>new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:this.uniforms,depthTest:false,depthWrite:false,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
  this.geometry=geometry(CAPACITY);this.scene=new THREE.Scene();const mesh=new THREE.Mesh(this.geometry,splat(LIGHT_SPLAT_VERTEX,LIGHT_SPLAT_FRAGMENT));mesh.frustumCulled=false;this.scene.add(mesh);
  this.pathGeometry=geometry(2000);this.paths=new THREE.Scene();const pathMesh=new THREE.Mesh(this.pathGeometry,splat(LIGHT_PATH_VERTEX,LIGHT_PATH_FRAGMENT));pathMesh.frustumCulled=false;this.paths.add(pathMesh);
  this.applyScene(makeLightScene(this.config));
 }
 applyScene(scene){
  this.sceneData=scene;this.groups=lightSurfaceGaussians(scene);const u=this.uniforms;u.uVolumeCount.value=scene.volumes.length;
  scene.volumes.forEach((v,i)=>{u.uCentersLT.value[i].fromArray(v.center);u.uSizesLT.value[i].fromArray(v.size);u.uShapesLT.value[i].set(v.type,v.medium,Math.cos(v.rotation),Math.sin(v.rotation));u.uParamsLT.value[i].fromArray(v.params);});u.uDispersion.value=scene.config.dispersion;this.cacheValid=false;this.geometryTarget=-1;
 }
 configure(changes){Object.assign(this.config,changes);if(this.config.source==='rgb')this.config.color='white';this.requested=true;this.busy=true;this.error=null;this.revision++;this.worker?.terminate();this.worker=null;clearTimeout(this.timer);this.timer=setTimeout(()=>this.rebuild(),160);}
 rebuild(){
  this.worker?.terminate();const id=++this.revision;this.busy=true;this.requested=true;
  this.worker=new Worker(new URL('./photon-worker.js',import.meta.url),{type:'module'});
  this.worker.onerror=e=>{if(id===this.revision){this.error=e.message;this.busy=false;}};
  this.worker.onmessage=({data})=>{
   if(data.id!==this.revision)return;if(data.error){this.error=data.error;this.busy=false;return;}
   // Atomically replace geometry and light maps. A previous, internally coherent
   // scene stays visible while a new configuration is being baked.
   if(!this.result||JSON.stringify(data.scene.config)!==JSON.stringify(this.sceneData.config))this.applyScene(data.scene);
   for(const key of ['direct','caustic']){const u=this.uniforms[key==='direct'?'uDirectLT':'uCausticLT'];if(u.value!==this.empty)u.value.dispose();const t=new THREE.DataTexture(data[key],data.size,data.size*2,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;t.needsUpdate=true;u.value=t;}
   const paths=pathGaussians(data.segments).slice(0,2000);paths.forEach((n,i)=>put(this.pathGeometry,i,n,n.id));upload(this.pathGeometry,paths.length);
   this.result=data;this.busy=data.preview;this.cacheValid=false;
  };
  this.worker.postMessage({id,config:{...this.config}});
 }
 render(field,{dt,adaptive,focusDistance}){
  if(!this.requested)this.rebuild();const camera=field.camera,renderer=field.renderer,u=this.uniforms;
  const current={position:camera.position.toArray(),quaternion:camera.quaternion.toArray()},focal=field.resolution.y*camera.projectionMatrix.elements[5]*.5;
  field.motion.update(projectedMotion(field.previousCamera,current,dt,focal,focusDistance),dt,adaptive);field.previousCamera=current;
  const items=this.groups.map(group=>{const p=new THREE.Vector3(...group.center).applyMatrix4(camera.matrixWorldInverse);return {...group,scale:focal/Math.max(1,-p.z)};});
  const allocation=allocateBudget(items,field.minPixelSigma*field.motion.factor,Math.min(field.budget,CAPACITY-2000));field.effectivePixelTarget=allocation.target;
  if(this.geometryTarget<0||Math.abs(allocation.target-this.geometryTarget)>.0005||!sameViewMatrix(this.geometryView,camera.matrixWorldInverse)||!sameViewMatrix(this.geometryProjection,camera.projectionMatrix)){
   let count=0;items.forEach((group,i)=>{const c=allocation.choices[i],parts=c.a===c.b?[[c.a,1]]:[[c.a,1-c.t],[c.b,c.t]];for(const [level,weight] of parts){if(weight<.0001)continue;for(const node of group.levels[level].nodes)put(this.geometry,count++,node,group.id,weight);}});upload(this.geometry,count);
   this.geometryView.copy(camera.matrixWorldInverse);this.geometryProjection.copy(camera.projectionMatrix);this.geometryTarget=allocation.target;
  }
  this.count=this.geometry.instanceCount+(this.showPaths?this.pathGeometry.instanceCount:0);field.visibleSplats=0;field.optics.count=0;field.grass.count=field.water.count=field.grains.count=field.soft.count=0;field.byMaterial.fill(0);field.sortMs=0;
  // Camera transport is evaluated at a bounded resolution and cached while the
  // view is stationary. Gaussian LOD never changes the photon solution.
  const scale=Math.min(1,Math.sqrt(Math.max(45000,180000/field.motion.factor)/(field.resolution.x*field.resolution.y))),w=Math.max(1,Math.round(field.resolution.x*scale)),h=Math.max(1,Math.round(field.resolution.y*scale));
  if(this.cache.width!==w||this.cache.height!==h){this.cache.setSize(w,h);this.cacheValid=false;}
  const key=[this.view,u.uSHDegree.value,u.uReflections.value].join(':');
  if(!this.cacheValid||key!==this.cacheKey||!sameViewMatrix(this.lastView,camera.matrixWorldInverse)||!sameViewMatrix(this.lastProjection,camera.projectionMatrix)){
   u.uLightView.value=this.view;renderer.setRenderTarget(this.cache);renderer.clear();renderer.render(this.transport,field.quadCamera);this.cacheValid=true;this.cacheKey=key;this.lastView.copy(camera.matrixWorldInverse);this.lastProjection.copy(camera.projectionMatrix);
  }
  renderer.setRenderTarget(field.target);renderer.setClearColor(0,1);renderer.clear();renderer.render(this.backdrop,field.quadCamera);renderer.render(this.scene,camera);if(this.showPaths)renderer.render(this.paths,camera);
  renderer.setRenderTarget(null);renderer.clear();renderer.render(field.output,field.quadCamera);return !field.error;
 }
 dispose(){clearTimeout(this.timer);this.worker?.terminate();this.empty.dispose();for(const key of ['uDirectLT','uCausticLT'])if(this.uniforms[key].value!==this.empty)this.uniforms[key].value.dispose();this.cache.dispose();for(const scene of [this.transport,this.backdrop,this.scene,this.paths])for(const mesh of scene.children){mesh.geometry.dispose();mesh.material.dispose();}}
}
