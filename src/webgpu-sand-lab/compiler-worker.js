
let compiler;
let messages=[];console.error=(...args)=>messages.push(args.join(' '));console.warn=console.error;console.log=console.error;
async function load(){
 const {default:glslangModule}=await import('@webgpu/glslang/dist/web-devel-onefile/glslang.js');
 const script=await (await fetch('/vendor/twgsl/twgsl.js')).text();
 // The upstream distribution is a classic Emscripten factory, not ESM.
 const twgslFactory=new Function(script+';return twgsl;')();
 const tint=await twgslFactory('/vendor/twgsl/twgsl.wasm');
 const glslang=await new Promise(resolve=>glslangModule().then(m=>resolve({module:m})));
 return {tint,glslang:glslang.module};
}
self.onmessage=async({data})=>{
 try{
  messages=[];
  const {tint,glslang}=await(compiler??=load());
  const {prepareGLSL,std140Layout}=await import('./translate.js');
  const source=prepareGLSL(data.vertex,data.fragment,data.defines,data.samplerGroups),c=source.context;
  const vertex=tint.convertSpirV2WGSL(glslang.compileGLSL(source.vertex,'vertex'),true);
  const fragment=tint.convertSpirV2WGSL(glslang.compileGLSL(source.fragment,'fragment'),true);
  self.postMessage({id:data.id,vertex:'diagnostic(off, derivative_uniformity);\n'+vertex,fragment:'diagnostic(off, derivative_uniformity);\n'+fragment,attributes:c.availableAttributes,uniforms:std140Layout(c.leftOverUniforms),buffers:c.availableBuffers,textures:c.availableTextures,samplers:c.availableSamplers});
 }catch(e){self.postMessage({id:data.id,error:messages.join('\n')+'\n'+String(e?.stack||e)});}
};
