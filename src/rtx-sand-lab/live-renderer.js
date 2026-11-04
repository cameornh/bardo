import {WaterLabRenderer} from '../sand-lab/water-lab-renderer.js';
import {LAB_FIELD_GLSL} from '../sand-lab/water-lab-field.js';
import {ClipmapWaterField,CLIPMAP_FIELD_GLSL} from './clipmap-water.js';

export class LiveWaterRenderer extends WaterLabRenderer {
 constructor(field,lab){
  super(field,lab);const old=this.density;this.density=new ClipmapWaterField(this.renderer,old.u);old.dispose();Object.assign(this.u,this.density.u);
  const seen=new Set(),materials=new Set(),worldMaterials=new Set();
  for(const scene of [this.mediumShadows.scene,this.photonScene,this.photonGather])scene.traverse(o=>{if(o.material)worldMaterials.add(o.material);});
  const visit=(o,depth=0)=>{if(!o||typeof o!=='object'||seen.has(o)||depth>4||o.isTexture||o.isBufferGeometry||o.isWebGLRenderer)return;seen.add(o);if(o.isMaterial){materials.add(o);return;}if(o.isScene){o.traverse(node=>{for(const m of Array.isArray(node.material)?node.material:[node.material])if(m)materials.add(m);});return;}for(const [k,v] of Object.entries(o))if(!['lab','field','renderer','u','uniforms','density','mediumShadows','photonScene','photonGather'].includes(k))visit(v,depth+1);};visit(this);
  for(const m of materials)if(!worldMaterials.has(m))for(const stage of ['vertexShader','fragmentShader'])if(m[stage]?.includes(LAB_FIELD_GLSL)){
   m[stage]=m[stage].replace(LAB_FIELD_GLSL,CLIPMAP_FIELD_GLSL)
    .replace('fluidGradient(vec3 p){float e=max(uFieldDx*.9','fluidGradient(vec3 p){float e=max(fieldDetailDx(p)*.9')
    .replace('float e=max(uFieldDx*.9,uSpacing*.12);vec3 q=source.xyz','float e=max(fieldDetailDx(source.xyz)*.9,uSpacing*.12);vec3 q=source.xyz');
   Object.assign(m.uniforms,this.density.u);m.needsUpdate=true;
  }
  // Lighting remains in world space; looking around cannot move its cache.
  for(const scene of [this.photonScene,this.photonGather])scene.traverse(o=>{if(o.material)o.material.uniforms={...o.material.uniforms,...this.density.coarse.u};});
  this.mediumShadows.density=this.density.coarse;Object.assign(this.mediumShadows.uniforms,this.density.coarse.u);
 }
 syncFieldConsumers(){if([this.density,this.density.coarse,this.density.reference].includes(this.mediumShadows.density))this.mediumShadows.density=this.density.lightingField;Object.assign(this.mediumShadows.uniforms,this.mediumShadows.density.u);for(const scene of [this.photonScene,this.photonGather])scene.traverse(o=>{if(o.material)Object.assign(o.material.uniforms,this.density.lightingField.u);});}
 updateParticles(){super.updateParticles();this.syncFieldConsumers();}
 render(options){this.density.setView(this.field.camera.position.toArray(),options?.adaptive!==false&&this.lab.optimizations?.distanceDetail!==false,this.densityRevision!==this.lab.revision);this.syncFieldConsumers();return super.render(options);}
}
