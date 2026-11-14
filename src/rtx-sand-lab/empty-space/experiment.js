import * as THREE from 'three';
import {wait} from '../fields/particles/pipeline.js';
import {terrainCeilings,BOUNDS_WGSL,EMPTY_SPACE_GLSL,MAX_TERRAIN_SIZE} from './bounds.js';
export * from './bounds.js';

export function boundTraceShader(source,{primary=true,quick=false}={}){
 if(!source.includes('float traceOpaque('))return source;
 // Insert after the shared slab helper, before traceOpaque. Its callers use
 // the original height, SDF, normals, epsilon and near-hit refinement.
 const glsl=quick?EMPTY_SPACE_GLSL.replace('float t=firstTerrainEntry(o,d,limit);','if(min(o.y,o.y+d.y*limit)>uSandSkyCeiling)return limit;\n float t=firstTerrainEntry(o,d,limit);'):EMPTY_SPACE_GLSL;
 const at=source.indexOf('float traceOpaque(');source=source.slice(0,at)+glsl+source.slice(at);
 const needle='float t=.00001,last=t;';
 const first=source.indexOf(needle,source.indexOf('float traceOpaque('));if(first<0)throw Error('Opaque trace contract changed');
 source=source.slice(0,first)+source.slice(first).replace(needle,`float start=0.;if(uEmptySpaceBounds&&uStation==6){start=firstSandEntry(o,d,min(hit,75.));if(start>=min(hit,75.))return hit;}
 float t=uEmptySpaceAdvance?max(.00001,start-.01):.00001,last=t;`);
 const edge=source.indexOf('float traceEdgeOpaque(');
 if(primary&&edge>=0){const point=source.indexOf(needle,edge);if(point<0)throw Error('Mirage trace contract changed');
  source=source.slice(0,point)+source.slice(point).replace(needle,`if(uEmptySpaceBounds&&uStation==6&&firstSandEntry(o,d,75.)>=75.&&!rayMayHitBody(o,d,75.))return 1e4;
 ${needle}`);
 }
 return source;
}
export async function installEmptySpace(draw,{advance=false,cpu=false,primary=true,quick=false}={}){
 const r=draw.renderer,texture=new THREE.DataTexture(new Float32Array(64),8,8,THREE.RedFormat,THREE.FloatType);texture.needsUpdate=true;
 const result={enabled:true,advance,updates:0,backend:r.isSharedSceneWebGPU&&!cpu?'GPU terrain ceiling reduction':'CPU terrain ceiling reference',texture};
 const u={uEmptySpaceBounds:{value:false},uEmptySpaceAdvance:{value:advance},uEmptyBounds:{value:texture}};
 let pipeline,output;
 if(r.isSharedSceneWebGPU&&!cpu){
  const d=r.device;d.pushErrorScope('validation');
  try{pipeline=await wait(d.createComputePipelineAsync({label:'terrain conservative ceilings',layout:'auto',compute:{module:d.createShaderModule({code:BOUNDS_WGSL}),entryPoint:'main'}}),30000,'Terrain bounds compile');}finally{const error=await d.popErrorScope();if(error)throw Error(error.message);}
  const native=r.createTexture({label:'terrain ceilings',size:[8,8],format:'r32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  output={texture:native,view:native.createView(),format:'r32float',width:8,height:8,target:true,version:texture.version};r.textures.set(texture,output);
 }
 const patched=[];
 for(const split of draw.splitSurfaces.values())for(const job of split.jobs(null))job.scene.traverse(node=>{
  const original=node.material;if(!original||patched.some(x=>x.node===node))return;
  const next=boundTraceShader(original.fragmentShader,{primary,quick});if(next===original.fragmentShader)return;
  const uniforms=original.uniforms;let material;try{original.uniforms={};material=original.clone();}finally{original.uniforms=uniforms;}
  material.uniforms={...uniforms,...u};material.fragmentShader=next;material.name='bounded-'+original.name;
  patched.push({node,original,material});node.material=material;
 });
 const original=draw.render.bind(draw);let bed,revision;
 result.update=()=>{
  const b=draw.lab.sand;u.uEmptySpaceBounds.value=!!(result.enabled&&b&&Number.isInteger(b.n)&&b.n>=2&&b.n<=MAX_TERRAIN_SIZE);u.uEmptySpaceAdvance.value=result.advance;
  if(!u.uEmptySpaceBounds.value||b===bed&&revision===b.bedGeometryRevision)return;
  draw.lab.syncSandUniforms();
  if(output){const input=r.texture(draw.lab.u.uSand.value),bind=r.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:input.view},{binding:1,resource:output.view}]});
   r.commands.push({type:'compute',encode:(encoder,timestamps=()=>undefined)=>{const label='terrain conservative ceilings',p=encoder.beginComputePass({label,timestampWrites:timestamps(label)});p.setPipeline(pipeline);p.setBindGroup(0,bind);p.dispatchWorkgroups(8,8);p.end();}});
  }else{texture.image.data=terrainCeilings(b.data,b.n);texture.needsUpdate=true;}
  result.updates++;bed=b;revision=b.bedGeometryRevision;
 };
 draw.render=options=>{result.update();for(const p of patched)p.node.material=result.enabled?p.material:p.original;return original(options);};
 result.jobs=()=>[...draw.splitSurfaces.values()].flatMap(s=>s.jobs(draw.background)).filter(j=>patched.some(p=>j.scene.children[0]?.material===p.material));
 result.dispose=()=>{if(r.commands?.length||r.flushing)throw Error('Flush bounds work before disposal');draw.render=original;for(const {node,original,material} of patched){node.material=original;material.dispose();}if(output){r.textures.delete(texture);r.destroyResource(output.texture);}texture.dispose();};
 return result;
}
