import {WaterLabRenderer} from '../sand-lab/water-lab-renderer.js';
import {LAB_FIELD_GLSL} from '../sand-lab/water-lab-field.js';
import {ClipmapWaterField,CLIPMAP_FIELD_GLSL} from './clipmap-water.js';
import {SplitBlobPass} from './split-blobs.js';
import {installLiveDetailLighting} from './detail-lighting.js';
import {WaterSurfaceState,StableBlobFamilies} from './water-surface-state.js';
import {installEdgeMirage} from './edge-mirage.js';

export class LiveWaterRenderer extends WaterLabRenderer {
 constructor(field,lab){
  super(field,lab);const old=this.density;this.density=new ClipmapWaterField(this.renderer,old.u);old.dispose();Object.assign(this.u,this.density.u);
  // The nested sampler multiplies the compiler's expanded ray/shadow code
  // on the affected Metal driver. Retain the original single-field GPU path
  // there; this changes reconstruction policy, never physics or features.
  this.nestedWaterFields=lab.hardwarePolicy?.nestedWaterFields!==false;
  this.density.enabled=this.nestedWaterFields;
  const seen=new Set(),materials=new Set(),worldMaterials=new Set();
  for(const scene of [this.mediumShadows.scene,this.photonScene,this.photonGather])scene.traverse(o=>{if(o.material)worldMaterials.add(o.material);});
  const visit=(o,depth=0)=>{if(!o||typeof o!=='object'||seen.has(o)||depth>4||o.isTexture||o.isBufferGeometry||o.isWebGLRenderer)return;seen.add(o);if(o.isMaterial){materials.add(o);return;}if(o.isScene){o.traverse(node=>{for(const m of Array.isArray(node.material)?node.material:[node.material])if(m)materials.add(m);});return;}for(const [k,v] of Object.entries(o))if(!['lab','field','renderer','u','uniforms','density','mediumShadows','photonScene','photonGather'].includes(k))visit(v,depth+1);};visit(this);
  for(const m of materials)if(this.nestedWaterFields&&!worldMaterials.has(m))for(const stage of ['vertexShader','fragmentShader'])if(m[stage]?.includes(LAB_FIELD_GLSL)){
   m[stage]=m[stage].replace(LAB_FIELD_GLSL,CLIPMAP_FIELD_GLSL)
    .replace('fluidGradient(vec3 p){float e=max(uFieldDx*.9','fluidGradient(vec3 p){float e=max(fieldDetailDx(p)*.9')
    .replace('float e=max(uFieldDx*.9,uSpacing*.12);vec3 q=source.xyz','float e=max(fieldDetailDx(source.xyz)*.9,uSpacing*.12);vec3 q=source.xyz');
   Object.assign(m.uniforms,this.density.u);m.needsUpdate=true;
  }
  // Lighting remains in world space; looking around cannot move its cache.
  for(const scene of [this.photonScene,this.photonGather])scene.traverse(o=>{if(o.material)o.material.uniforms={...o.material.uniforms,...this.density.coarse.u};});
  this.mediumShadows.density=this.density.coarse;Object.assign(this.mediumShadows.uniforms,this.density.coarse.u);
  const fieldSource=this.nestedWaterFields?CLIPMAP_FIELD_GLSL:LAB_FIELD_GLSL+'\nfloat fieldDetailDx(vec3 p){return uFieldDx;}\n';
  this.splitBlobs=new SplitBlobPass(this.blobRenderer,fieldSource);
  installLiveDetailLighting(this.detailRenderer,fieldSource);
  this.surfaceState=new WaterSurfaceState();this.blobRenderer.families=new StableBlobFamilies();
  this.edgeMirage=installEdgeMirage(this);
 }
 syncFieldConsumers(){if([this.density,this.density.coarse,this.density.reference].includes(this.mediumShadows.density))this.mediumShadows.density=this.density.lightingField;Object.assign(this.mediumShadows.uniforms,this.mediumShadows.density.u);for(const scene of [this.photonScene,this.photonGather])scene.traverse(o=>{if(o.material)Object.assign(o.material.uniforms,this.density.lightingField.u);});}
 updateParticles(){
  const lab=this.lab,counts=lab.neighborCounts;
  try{lab.neighborCounts=this.surfaceState.update(lab);super.updateParticles();}
  finally{lab.neighborCounts=counts;}
  this.syncFieldConsumers();
 }
 render(options){
  this.density.setView(this.field.camera.position.toArray(),this.nestedWaterFields&&options?.adaptive!==false&&this.lab.optimizations?.distanceDetail!==false,this.densityRevision!==this.lab.revision);this.syncFieldConsumers();
  // Intercept only this live pass, inside this render call. Historical render
  // implementations and other scenes keep their original submission path.
  const r=this.renderer,submit=r.render;
  r.render=(scene,camera,...args)=>{
   if(scene===this.rainScene&&!this.rainGeometry.instanceCount)return;
   return scene===this.blobRenderer.scene?this.splitBlobs.render(r,camera,submit):submit.call(r,scene,camera,...args);
  };
  try{return super.render(options);}finally{r.render=submit;}
 }
}
