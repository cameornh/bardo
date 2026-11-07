import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {reachableShader} from './shader-reachability.js';
import {replaceShaderFunction,cachedVolumeLighting,OPTIC_UNIFORMS,opticRayGLSL,opticTraceMain,opticShadeMain,OPAQUE_COMPOSE,WATER_COMPOSE,SUBMERGED_TRACE,SUBMERGED_COMPOSE} from './deferred-optics.js';

function replaceOnce(source,from,to){
 if(source.split(from).length!==2)throw Error('Surface stage contract changed: '+from.slice(0,80));
 return source.replace(from,to);
}

// Split at the actual hit record, not at an approximate screen-space edge.
// RGBA32F preserves the original float normal/depth/path/concentration. Both
// Tracing and receiver lighting are separate for secondary rays too. No
// lighting program can recursively expand an SDF scene query.
// The historic renderer remains untouched; only live scenes use these stages.
export function splitSurfaceSources(source,kind){
 const main=source.lastIndexOf('\nvoid main(){');
 if(main<0)throw Error('Missing surface main: '+kind);
 const library=cachedVolumeLighting(source.slice(0,main).replace('out vec4 outColor;',''));
 let trace,shade;
 if(kind==='opaque'){
  const original=source.slice(main);
  const cut='vec3 p=uEye+ray*t,color=t<9999.?floorColor(p,opaqueNormal(p)):sky(ray);outColor=vec4(color,t);';
  trace=replaceOnce(original,cut,'hit=vec4(t<9999.?opaqueNormal(uEye+ray*t):vec3(0),t);');
  shade=`void main(){vec4 h=texelFetch(uSurfaceHit,ivec2(gl_FragCoord.xy),0);vec3 ray=rayAt(vUv),p=uEye+ray*h.w;outColor=vec4(h.w<9999.?floorColor(p,h.xyz):sky(ray),h.w);}`;
 }else if(kind==='water'){
  trace=source.slice(main);
  trace=trace.replaceAll('outColor=vec4(background.rgb,1e4);return;','hit=vec4(0);medium=vec4(0,0,0,1e4);return;');
  trace=replaceOnce(trace,'outColor=vec4(shadeWater(p,n,ray,path,concentration),t);','hit=vec4(n,path);medium=vec4(concentration,t);');
  shade=`void main(){ivec2 pixel=ivec2(gl_FragCoord.xy);vec4 m=texelFetch(uSurfaceMedium,pixel,0);if(m.w<=0.)discard;if(m.w>=9999.){outColor=vec4(texture(uImage,vUv).rgb,1e4);return;}vec4 h=texelFetch(uSurfaceHit,pixel,0);vec3 ray=rayAt(vUv);outColor=vec4(shadeWater(uEye+ray*m.w,h.xyz,ray,h.w,m.xyz),m.w);}`;
 }else if(kind==='submerged'){
  trace=SUBMERGED_TRACE;shade=SUBMERGED_COMPOSE;
 }else if(kind==='glass'){
  const query='float nearest=traceGlass(uEye,ray,min(solid,waterDepth),normal);';
  trace=`void main(){vec3 ray=rayAt(vUv),normal=vec3(0);float solid=texture(uOpaqueRead,vUv).a,waterDepth=texture(uWaterSurface,vUv).a;${query}hit=vec4(normal,nearest);}`;
  shade=replaceOnce(source.slice(main),query,'vec4 h=texelFetch(uSurfaceHit,ivec2(gl_FragCoord.xy),0);normal=h.xyz;float nearest=h.w;');
 }else throw Error('Unknown surface stage: '+kind);
 const attachments=kind==='water'||kind==='submerged'?2:1;
 let shadeLibrary=library;
 if(kind==='opaque')shadeLibrary=replaceShaderFunction(library,'floorColor',OPAQUE_COMPOSE);
 if(kind==='water')shadeLibrary=replaceShaderFunction(library,'shadeWater',WATER_COMPOSE);
 const result={
  trace:reachableShader(`${library}\nlayout(location=0)out vec4 hit;${attachments===2?'layout(location=1)out vec4 medium;':''}\n${trace}`),
  shade:reachableShader(`${OPTIC_UNIFORMS}\n${shadeLibrary}\nout vec4 outColor;\n${shade}`),attachments,
 };
 if(kind!=='glass'){
  const optics=`${OPTIC_UNIFORMS}\n${library}\n${opticRayGLSL(kind)}\n`;
  result.opticTrace=reachableShader(optics+opticTraceMain(kind));
  result.opticShade=reachableShader(optics+opticShadeMain(kind));
 }
 return result;
}

export class SplitSurfacePass {
 constructor(originalScene,kind){
  const original=originalScene.children[0].material,sources=splitSurfaceSources(original.fragmentShader,kind);
  this.originalScene=originalScene;this.kind=kind;
  const target=count=>new THREE.WebGLRenderTarget(1,1,{count,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.target=target(sources.attachments);this.targets=[this.target];this.opticalStages=[];
  this.geometry=new THREE.PlaneGeometry(2,2);this.camera=new THREE.Camera();
  this.trace=new THREE.ShaderMaterial({name:kind+'-hit-record',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:sources.trace,uniforms:original.uniforms,depthTest:false,depthWrite:false});
  const primary={...original.uniforms,uSurfaceHit:{value:this.target.textures[0]},uSurfaceMedium:{value:this.target.textures[1]||this.target.textures[0]}};
  const colors={};
  // Once an optical ray has been lit its hit records are no longer needed.
  // Reuse those two attachments for transmission, keeping only both colors.
  const records=sources.opticTrace?target(2):null;if(records)this.targets.push(records);
  if(sources.opticTrace)for(const reflection of kind==='opaque'?[true]:[true,false]){
   const color=target(1),label=kind+(reflection?'-reflection':'-transmission');this.targets.push(color);
   const uniforms={...primary,uOpticReflection:{value:reflection},uOpticOpaque:{value:records.textures[0]},uOpticGlass:{value:records.textures[1]}};
   for(const [suffix,fragmentShader,output] of [['hit',sources.opticTrace,records],['lighting',sources.opticShade,color]]){
    const material=new THREE.ShaderMaterial({name:label+'-'+suffix,glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader,uniforms,depthTest:false,depthWrite:false});
    const scene=new THREE.Scene();scene.add(new THREE.Mesh(this.geometry,material));this.opticalStages.push({name:material.name,scene,camera:this.camera,target:output});
   }
   colors[reflection?'uReflectedColor':'uTransmittedColor']={value:color.texture};
  }
  this.shade=new THREE.ShaderMaterial({name:kind+'-lighting',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:sources.shade,uniforms:{...primary,...colors},depthTest:false,depthWrite:false});
  this.traceScene=new THREE.Scene();this.traceScene.add(new THREE.Mesh(this.geometry,this.trace));
  this.shadeScene=new THREE.Scene();this.shadeScene.add(new THREE.Mesh(this.geometry,this.shade));
 }
 jobs(output){return [{name:this.trace.name,scene:this.traceScene,camera:this.camera,target:this.target},...this.opticalStages,{name:this.shade.name,scene:this.shadeScene,camera:this.camera,target:output}];}
 render(renderer,submit){
  const output=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();
  for(const t of this.targets)if(t.width!==output.width||t.height!==output.height)t.setSize(output.width,output.height);
  try{
   renderer.setRenderTarget(this.target);renderer.setClearColor(0,0);renderer.clear();
   submit.call(renderer,this.traceScene,this.camera);
   for(const stage of this.opticalStages){renderer.setRenderTarget(stage.target);submit.call(renderer,stage.scene,stage.camera);}
   renderer.setRenderTarget(output);submit.call(renderer,this.shadeScene,this.camera);
  }finally{renderer.setRenderTarget(output);renderer.setClearColor(clear,alpha);}
 }
 dispose(){for(const t of this.targets)t.dispose();this.geometry.dispose();this.trace.dispose();this.shade.dispose();for(const stage of this.opticalStages)stage.scene.children[0].material.dispose();}
}
