import * as THREE from 'three';
import {ActiveList} from './scan.js';
export {ActiveList,compactReference} from './scan.js';

export function compactVertex(source){
 if(source.includes('in float aDetailId;'))return source.replace('in float aDetailId;','in float compactParticleId;').replaceAll('int(aDetailId)','int(compactParticleId)');
 if(!source.includes('gl_InstanceID'))throw Error('Expected instanced particle shader');
 return 'in float compactParticleId;\n'+source.replaceAll('gl_InstanceID','int(compactParticleId)');
}
function materialCopy(source){
 const uniforms=source.uniforms;let material;try{source.uniforms={};material=source.clone();}finally{source.uniforms=uniforms;}
 material.uniforms=uniforms;delete material.userData.liveLoopBounds;delete material.userData.liveReachability;
 material.vertexShader=compactVertex(source.vertexShader);material.name='compact-'+source.name;return material;
}
// Deliberately outside the live entry point until full-scene wins are measured.
// WebGL retains its original shader/reference draw, with no GPU compaction.
export async function installActiveLists(draw,{kinds=['sea','grain','fine']}={}){
 const renderer=draw.renderer||draw.field.renderer;
 const result={enabled:true,backend:renderer?.isSharedSceneWebGPU?'GPU stable scan + indirect draw':'reference direct draw',lists:[],jobs:()=>[]};
 if(!renderer?.isSharedSceneWebGPU)return result;
 const entries=[
  {kind:'sea',owner:draw.seaFoamRenderer,input:'uSeaState',capacity:draw.seaFoamRenderer.geometry.instanceCount},
  {kind:'grain',owner:draw.sandGrains,input:'uGrainP',second:'uGrainV',capacity:draw.sandGrains.capacity},
  {kind:'fine',owner:draw.detailRenderer,input:'uDetailPaths',capacity:65536},
 ].filter(e=>kinds.includes(e.kind));
 for(const entry of entries){entry.list=new ActiveList(renderer,entry.kind,entry.capacity);await entry.list.prepare();entry.materials=new Map();result.lists.push(entry);}
 function select(entry,source){let m=entry.materials.get(source);if(!m){m=materialCopy(source);entry.materials.set(source,m);}return m;}
 const visibility=draw.particleVisibility;
 for(const e of entries){const refs=e.kind==='sea'?[visibility.seaMaterial,visibility.seaOriginal,visibility.seaOccluded]:e.kind==='grain'?[visibility.grain.drawMaterial,visibility.grain.original,visibility.grain.occluded]:[visibility.foam.draw,visibility.reference.draw];for(const m of refs)select(e,m);}
 result.jobs=()=>entries.flatMap(e=>[...e.materials.values()].map(material=>{const scene=new THREE.Scene(),mesh=new THREE.Mesh(e.owner.geometry,material);mesh.frustumCulled=false;scene.add(mesh);return {name:material.name,scene,camera:draw.field.camera,target:e.kind==='fine'?e.owner.target:draw.composite};}));
 const render=renderer.render.bind(renderer);
 renderer.render=(scene,camera)=>{
  const e=result.enabled&&entries.find(e=>e.owner.scene===scene);
  if(!e)return render(scene,camera);
  const mesh=scene.children[0],source=mesh.material,count=e.owner.geometry.instanceCount;
  // Fine-water optical records are the already-computed visibility result.
  const input=source.uniforms[e.input]?.value;if(!input)return render(scene,camera);
  if(count>e.capacity)throw Error('Active list needs a larger validated capacity');
  e.list.enqueue(renderer.texture(input),e.second?renderer.texture(source.uniforms[e.second].value):null,count);
  mesh.material=select(e,source);const start=renderer.commands.length;
  try{render(scene,camera);}finally{mesh.material=source;}
  for(let i=start;i<renderer.commands.length;i++){const c=renderer.commands[i];if(c.type!=='draw')continue;
   c.attributes.compactParticleId={buffer:e.list.ids,itemSize:1,stepMode:'instance',stride:1,offset:0};c.indirect=e.list.indirect;
  }
 };
 result.dispose=()=>{renderer.render=render;for(const e of entries){e.list.dispose();for(const m of e.materials.values())m.dispose();}};
 return result;
}
