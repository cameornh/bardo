// Translate the shared scene's GLSL, rather than maintaining a second set of
// water / glass / sand optics. Babylon's maintained processor assigns matching
// varyings and splits combined image samplers for Vulkan / WebGPU.
import {WebGPUShaderProcessorGLSL} from '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL.js';
import {WebGPUShaderProcessingContext} from '@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext.js';
import {Initialize,Process,Finalize} from '@babylonjs/core/Engines/Processors/shaderProcessor.js';

export function prepareGLSL(vertex,fragment,defines={},samplerGroups={}){
 const context=new WebGPUShaderProcessingContext(0),processor=new WebGPUShaderProcessorGLSL();
 const options={processor,processingContext:context,defines:Object.entries(defines).map(([k,v])=>`#define ${k} ${v}`),isFragment:false,version:'450',platformName:'WEBGPU',shouldUseHighPrecisionShader:true,supportsUniformBuffers:true,includesShadersStore:{},indexParameters:{}};
 // Dense source declarations must be individual statements for the upstream
 // shader processor. Comments are removed before splitting declarations.
 const normalize=source=>source.replace(/\b(meta|typedef|template|namespace|interface|resource|partition|active|target|self|super|move|mut|pub|type|var|let|fn|ref|asm|attribute|binding|cast|catch|class|common|enum|extern|filter|friend|goto|impl|import|inout_unused|macro|match|mutable|new|null|nullptr|package|pass|patch|premerge|priv|protected|public|restrict|set|shared|sizeof|static|subroutine|this|trait|try|typeof|union|unless|unsafe|use|using|virtual|volatile|wgsl)\b/g,'bardo_$1').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'').replace(/#version[^\n]*/g,'').replace(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;{]+);/g,(_,type,names)=>names.split(',').map(n=>`\nuniform ${type} ${n.trim()};\n`).join('')).replace(/;\s*(?=(?:flat\s+)?(?:in|out)\s)/g,';\n');
 const splitIO=source=>source.replace(/\b(flat\s+)?(in|out)\s+(\w+)\s+([A-Za-z_][\w\[\], ]*);/g,(_,flat,kind,type,names)=>names.split(',').map(n=>`${flat||''}${kind} ${type} ${n.trim()};\n`).join(''));
 // Vulkan requires a combined image/sampler constructor at its texture use,
 // not as a function argument. Inline single-expression sampler helpers.
 const samplerHelpers=source=>source.replace(/\b(\w+)\s+(\w+)\s*\(([^)]*\bsampler2D\b[^)]*)\)\s*\{\s*return\s+([^;]+);\s*\}/g,(_,type,name,args,expression)=>'\n#define '+name+'('+args.split(',').map(a=>a.trim().split(/\s+/).at(-1)).join(',')+') ('+expression+')\n');
 vertex=samplerHelpers(splitIO(normalize(vertex)));fragment=samplerHelpers(splitIO(normalize(fragment)));
 const finiteChecks=source=>{if(!/\b(isnan|isinf)\s*\(/.test(source))return source;let helpers='';for(const n of [1,2,3,4]){const t=n===1?'float':'vec'+n,b=n===1?'bool':'bvec'+n,u=n===1?'uint':'uvec'+n;helpers+=`${b} bardoIsNan(${t} v){return ${n===1?'(floatBitsToUint(v)&0x7fffffffu)>0x7f800000u':`greaterThan(floatBitsToUint(v)&${u}(0x7fffffffu),${u}(0x7f800000u))`};}\n`;helpers+=`${b} bardoIsInf(${t} v){return ${n===1?'(floatBitsToUint(v)&0x7fffffffu)==0x7f800000u':`equal(floatBitsToUint(v)&${u}(0x7fffffffu),${u}(0x7f800000u))`};}\n`;}return helpers+source.replace(/\bisnan\s*\(/g,'bardoIsNan(').replace(/\bisinf\s*\(/g,'bardoIsInf(');};
 vertex=finiteChecks(vertex);fragment=finiteChecks(fragment);
 // The shared camera still uses OpenGL clip depth. All offscreen attachments
 // preserve the existing bottom-up logical texture convention.
 vertex=vertex.replace(/void\s+main\s*\(\s*\)/,'void bardoMain()')+'\nvoid main(){bardoMain();gl_Position.z=(gl_Position.z+gl_Position.w)*0.5;}';
 Initialize(options);let v,f;
 Process('#version 300 es\n'+vertex,options,s=>v=s);
 options.isFragment=true;Process('#version 300 es\n'+fragment,options,s=>f=s);
 const result=Finalize(v,f,options);
 const groups=new Map(),samplers={};
 for(const [name,info] of Object.entries(context.availableSamplers)){const texture=name.replace(/Sampler$/,''),key=samplerGroups[texture]||'nearest';if(!groups.has(key)){const canonical='bardoSampler'+groups.size;groups.set(key,{canonical,info,sourceTexture:texture});samplers[canonical]={...info,sourceTexture:texture};}const group=groups.get(key);for(const stage of ['vertexCode','fragmentCode']){result[stage]=result[stage].replace(new RegExp('layout\\(set\\s*=\\s*'+info.binding.groupIndex+',\\s*binding\\s*=\\s*'+info.binding.bindingIndex+'\\)\\s*uniform sampler '+name+';','g'),'');result[stage]=result[stage].replace(new RegExp('\\b'+name+'\\b','g'),group.canonical);}}
 for(const {canonical,info} of groups.values())for(const stage of ['vertexCode','fragmentCode'])result[stage]=`layout(set=${info.binding.groupIndex},binding=${info.binding.bindingIndex}) uniform sampler ${canonical};\n`+result[stage];
 context.availableSamplers=samplers;
 const prefix='#version 450\n'+options.defines.join('\n')+'\n';
 return {vertex:prefix+result.vertexCode,fragment:prefix+result.fragmentCode,context};
}

export function std140Layout(uniforms){
 let offset=0;
 const align=(v,n)=>Math.ceil(v/n)*n;
 const fields=uniforms.map(u=>{
  const vector=u.type.match(/^(?:[biu]?vec)([234])$/),matrix=u.type.match(/^mat([234])$/);
  const count=vector?+vector[1]:matrix?Number(matrix[1])**2:1;
  const alignment=u.length||matrix?16:vector?(count===2?8:16):4;
  const stride=u.length?align(matrix?+matrix[1]*16:count*4,16):matrix?+matrix[1]*16:count*4;
  offset=align(offset,alignment);const field={...u,offset,count,stride,integer:/^(bool|int|uint|[biu]vec)/.test(u.type),matrix:matrix?+matrix[1]:0};offset+=stride*(u.length||1);return field;
 });
 return {fields,size:Math.max(16,align(offset,16))};
}
