import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {SeaFoamSurface,SEA_FOAM_SIZE,SEA_FOAM_STEP_GLSL,stepSeaFoam} from './sea-foam-model.js';
const texture=(data,n)=>{const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat,THREE.FloatType);t.needsUpdate=true;return t;};
export class SeaFoam {
 constructor(renderer,size=SEA_FOAM_SIZE){
  this.renderer=renderer;this.size=size;this.enabled=true;this.surface=new SeaFoamSurface(size);this.reference=new Float32Array(size*size*4);this.scratch=this.reference.slice();
  this.zero=texture(this.reference,size);this.surfaceTexture=texture(this.surface.surface,size);this.flowTexture=texture(this.surface.flow,size);
  this.u={uSeaState:{value:this.zero},uSeaSurface:{value:this.surfaceTexture},uSeaFlow:{value:this.flowTexture},uSeaSize:{value:size},uSeaDt:{value:0}};
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:this.u,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;precision highp int;out vec4 outColor;${SEA_FOAM_STEP_GLSL}`,depthTest:false,depthWrite:false});
  this.geometry=new THREE.PlaneGeometry(2,2);this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();this.reset();
 }
 reset(){this.reference.fill(0);this.scratch.fill(0);this.zero.needsUpdate=true;this.u.uSeaState.value=this.zero;this.current=0;this.active=false;this.elapsed=0;this.surfaceElapsed=Infinity;this.revision=(this.revision||0)+1;}
 generation(lab){if(this.lastGeneration!==lab.generation){this.lastGeneration=lab.generation;this.reset();}}
 hasOrganics(lab){if(lab.tannins>0)return true;for(let i=1;i<lab.chem.length;i+=4)if(lab.chem[i]>0)return true;return false;}
 clearCleanWater(lab){if(!this.hasOrganics(lab)&&this.active)this.reset();}
 advance(dt,lab){
  this.generation(lab);const cpu=!!lab.gpu.cpu;if(this.cpu!==cpu){this.cpu=cpu;this.reset();}this.backend=cpu?'CPU reference':'GPU surface transport';
  if(!this.enabled)return;
  // No organic material means no organic foam and no surface-map work.
  if(!this.hasOrganics(lab)){if(this.active)this.reset();return;}
  // Surface inputs are sampled on simulation time, at 8 Hz. Foam transport
  // still runs every step and drawing projects to the current water surface.
  // This avoids rescanning all bulk samples for every small liquid substep.
  this.surfaceElapsed+=dt;this.inputMs=0;
  if(this.surfaceElapsed>=1/8||dt===0||this.lastTannins!==lab.tannins){const start=performance.now();this.surface.update(lab);this.surfaceTexture.needsUpdate=this.flowTexture.needsUpdate=true;this.inputMs=performance.now()-start;this.surfaceElapsed=0;this.lastTannins=lab.tannins;}
  this.dispatch(dt);this.active=true;this.elapsed+=dt;this.revision++;
 }
 dispatch(dt){
  this.u.uSeaDt.value=dt;
  if(this.cpu){stepSeaFoam(this.reference,this.surface.surface,this.surface.flow,this.size,dt,this.scratch);[this.reference,this.scratch]=[this.scratch,this.reference];this.zero.image.data=this.reference;this.zero.needsUpdate=true;this.u.uSeaState.value=this.zero;return;}
  if(!this.targets)this.targets=[0,1].map(()=>new THREE.WebGLRenderTarget(this.size,this.size,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
  const r=this.renderer,old=r.getRenderTarget(),target=this.targets[this.current];r.setRenderTarget(target);r.render(this.scene,this.camera);r.setRenderTarget(old);this.u.uSeaState.value=target.texture;this.current=1-this.current;
 }
 read(){if(!this.active)return new Float32Array(this.reference.length);if(this.cpu)return this.reference.slice();const data=new Float32Array(this.reference.length);if(this.active||this.targets)this.renderer.readRenderTargetPixels(this.targets[1-this.current],0,0,this.size,this.size,data);return data;}
 dispose(){for(const t of [this.zero,this.surfaceTexture,this.flowTexture,...(this.targets||[]),this.material,this.geometry])t.dispose();}
}

// Tiny, isolated numerical check; never loads the water/object GPU solver.
export function verifySeaFoamGPU(renderer){
 const foam=new SeaFoam(renderer,16),n=foam.size;let reference=new Float32Array(n*n*4);foam.cpu=false;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const o=(z*n+x)*4;foam.surface.surface.set([.5,.1,.7,(x+z)%3*.25],o);foam.surface.flow.set([.32,-.18,0,z<12?1:0],o);reference[o]=x===5&&z<12?.5:0;reference[o+1]=z===12?.2:0;}
 foam.zero.image.data=reference.slice();foam.zero.needsUpdate=true;foam.surfaceTexture.needsUpdate=foam.flowTexture.needsUpdate=true;
 try{for(let i=0;i<24;i++){reference=stepSeaFoam(reference,foam.surface.surface,foam.surface.flow,n,1/15);foam.dispatch(1/15);}foam.active=true;const actual=foam.read();let error=0;for(let i=0;i<actual.length;i++)error=Math.max(error,Math.abs(actual[i]-reference[i]));return {backend:'GPU surface transport / JavaScript reference',cells:n*n,steps:24,maxError:error,pass:Number.isFinite(error)&&error<2e-5};}finally{foam.dispose();}
}
