import glslangModule from '@webgpu/glslang/dist/web-devel-onefile/glslang.js';
import {prepareGLSL,std140Layout} from '../src/webgpu-sand-lab/translate.js';
const root=new URL('../../',import.meta.url);let compiler;
// Emscripten's Node sniffing sees Deno's compatibility global; use its embedded
// web/WASM path, never Node's __dirname/require loader.
globalThis.process=undefined;
async function load(){
 const script=await Deno.readTextFile(new URL('public/vendor/twgsl/twgsl.js',root));
 const bytes=await Deno.readFile(new URL('public/vendor/twgsl/twgsl.wasm',root));
 // Inject local bytes into the unchanged upstream Emscripten module. No network.
 const factory=new Function('bytes',script.replace('Module({','Module({wasmBinary:bytes,')+';return twgsl;')(bytes);
 const tint=await factory('twgsl.wasm');
 const glslang=await new Promise(resolve=>glslangModule().then(module=>resolve({module})));
 return {tint,glslang:glslang.module};
}
self.onmessage=async({data})=>{try{const {tint,glslang}=await(compiler??=load());const source=prepareGLSL(data.vertex,data.fragment,data.defines,data.samplerGroups),c=source.context;
 const vertex=tint.convertSpirV2WGSL(glslang.compileGLSL(source.vertex,'vertex'),true),fragment=tint.convertSpirV2WGSL(glslang.compileGLSL(source.fragment,'fragment'),true);
 self.postMessage({id:data.id,vertex:'diagnostic(off, derivative_uniformity);\n'+vertex,fragment:'diagnostic(off, derivative_uniformity);\n'+fragment,attributes:c.availableAttributes,uniforms:std140Layout(c.leftOverUniforms),buffers:c.availableBuffers,textures:c.availableTextures,samplers:c.availableSamplers});
}catch(e){self.postMessage({id:data.id,error:String(e.stack||e)});}};
