// CPU-only shader validation. Never creates a browser or graphics context.
// Usage: node tools/live-shader-audit.mjs /path/to/glslang [report.json] [--rtx] [--manual-filter]
import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const {LiveSandLab}=await import(root+'/src/rtx-sand-lab/live-lab.js');
const {LiveWaterRenderer}=await import(root+'/src/rtx-sand-lab/live-renderer.js');
const {configureRTXLab}=await import(root+'/src/rtx-sand-lab/profile.js');
const {firstFrameShaderJobs}=await import(root+'/src/rtx-sand-lab/shader-startup.js');
const {installRTXShaderCompatibility}=await import(root+'/src/rtx-sand-lab/shader-compatibility.js');
const {installProgramSpecialization}=await import(root+'/src/sand-lab/program-specialization.js');
const {liveProgramConstants}=await import(root+'/src/rtx-sand-lab/shader-dependencies.js');
const {MotionDetail}=await import(root+'/src/lod.js');
const {SeaFoam}=await import(root+'/src/sand-lab/sea-foam.js');
const discrete=process.argv.includes('--rtx'),textureLimit=discrete?32:16,linear=!process.argv.includes('--manual-filter');
let target=null,clear=new THREE.Color(),alpha=0,viewport=new THREE.Vector4(0,0,96,64),scissor=viewport.clone(),test=false;
const prepared=new Map(),changes=[],draws=[];
const renderer={capabilities:{maxTextures:textureLimit},extensions:{has:n=>n==='EXT_color_buffer_float'||n==='OES_texture_float_linear'&&linear},getContext:()=>({getExtension:()=>null,isContextLost:()=>false}),
 getRenderTarget:()=>target,setRenderTarget:t=>target=t,getClearColor:c=>c.copy(clear),getClearAlpha:()=>alpha,setClearColor(c,a){clear.set(c);alpha=a;},clear(){},initRenderTarget(){},copyTextureToTexture(){},
 getViewport:v=>v.copy(viewport),setViewport:(...v)=>{v[0]?.isVector4?viewport.copy(v[0]):viewport.set(...v);},getScissor:v=>v.copy(scissor),setScissor:(...v)=>{v[0]?.isVector4?scissor.copy(v[0]):scissor.set(...v);},getScissorTest:()=>test,setScissorTest:v=>test=v,
 compile(scene){scene.traverse(o=>{const m=o.material;if(!m?.isShaderMaterial)return;const s={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader,uniforms:m.uniforms};m.onBeforeCompile(s,renderer);prepared.set(m,{key:m.customProgramCacheKey(),source:s.fragmentShader});});},
 render(scene){scene.traverse(o=>{const m=o.material;if(!m?.isShaderMaterial)return;const s={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader,uniforms:m.uniforms};m.onBeforeCompile(s,renderer);const key=m.customProgramCacheKey(),old=prepared.get(m);draws.push({name:m.name,key,target:target?[target.width,target.height]:null});if(!old||old.key!==key||old.source!==s.fragmentShader)changes.push({name:m.name,wasPrepared:!!old,cacheHit:[...prepared.values()].some(p=>p.key===key&&p.source===s.fragmentShader),oldKey:old?.key,key,sourceChanged:old?.source!==s.fragmentShader});});}
};
const lab=new LiveSandLab(renderer,{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab,discrete?{adapter:'NVIDIA GeForce RTX 5070 Ti'}:{});lab.resolutions.ocean=1.4;lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.seaFoam=new SeaFoam(renderer);
const camera=new THREE.PerspectiveCamera(55,96/64,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
const field={renderer,camera,target:new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),resolution:new THREE.Vector2(96,64),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{count:0,uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
for(const n of ['beach','grass','grains','soft','optics','lightTest'])field[n]={count:0};
const draw=new LiveWaterRenderer(field,lab);draw.fixedLoadScale=1;draw.mediumShadows.u.uMediumSize.value.set(16,12,16);
installRTXShaderCompatibility(renderer,{declaredOnly:true,boundedLoops:true,reachableOnly:true});installProgramSpecialization(renderer,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});
for(const job of firstFrameShaderJobs(draw)){job.scene.traverse(o=>{if(o.material)o.material.name||=job.name;});renderer.compile(job.scene);}


const compiler=process.argv[2];if(!compiler)throw Error('Pass the Khronos glslang executable path. This check runs on the CPU only.');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bardo-shaders-'));
const config=spawnSync(compiler,['-c'],{encoding:'utf8',timeout:10000});if(config.status!==0)throw Error(config.stderr||'Compiler unavailable');
const limits=path.join(directory,'limits.conf');fs.writeFileSync(limits,config.stdout.replace(/MaxTextureImageUnits \d+/,'MaxTextureImageUnits '+textureLimit).replace(/MaxDrawBuffers \d+/,'MaxDrawBuffers 4'));
const common='#version 300 es\nprecision highp float;precision highp int;\n#define texture2D texture\n#define textureCube texture\n#define gl_FragDepthEXT gl_FragDepth\nuniform mat4 viewMatrix;uniform vec3 cameraPosition;\n';
const vertex=common+'#define attribute in\n#define varying out\nuniform mat4 modelMatrix,modelViewMatrix,projectionMatrix;uniform mat3 normalMatrix;in vec3 position,normal;in vec2 uv;\n';
const fragment=common+'#define varying in\n';
const rows=[];
for(const [material] of prepared){
 const shader={vertexShader:material.vertexShader,fragmentShader:material.fragmentShader,uniforms:material.uniforms};material.onBeforeCompile(shader,renderer);
 const name=String(rows.length).padStart(2,'0')+'-'+material.name.replace(/[^\w-]/g,'-'),base=path.join(directory,name);
 for(const [key,ext,prefix] of [['vertexShader','vert',vertex],['fragmentShader','frag',fragment]]){
  let source=shader[key];while(source.includes('#include'))source=source.replace(/#include <(.*?)>/g,(_,s)=>{if(!THREE.ShaderChunk[s])throw Error('Unknown chunk: '+s);return THREE.ShaderChunk[s];});
  fs.writeFileSync(base+'.'+ext,prefix+source);
 }
 const result=spawnSync(compiler,[limits,'-l','-q',base+'.vert',base+'.frag'],{encoding:'utf8',timeout:15000});
 const samplers=[...(result.stdout||'').matchAll(/(\w+):[^\n]*type (?:8b5[ef]|8dc[145]|8b60|8dd[12347])[^\n]*stages (\d+)/g)].filter(m=>(Number(m[2])&16)!==0).map(m=>m[1]);
 rows.push({name:material.name,fragmentChars:shader.fragmentShader.length,fragmentSamplers:samplers,pass:result.status===0&&samplers.length<=textureLimit,error:result.status===0?null:(result.stdout+result.stderr)});
}
const report={check:'CPU reference compile, link and WebGL 2 texture budget',gpuWork:false,hardwarePolicy:lab.hardwarePolicy.name,hardwareLinearFiltering:linear,pass:rows.every(r=>r.pass),programs:rows.length,shaders:rows.length*2,textureLimit,maxFragmentSamplers:Math.max(...rows.map(r=>r.fragmentSamplers.length)),directory,rows};
if(process.argv[3]&&!process.argv[3].startsWith('--'))fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({check:report.check,pass:report.pass,programs:report.programs,shaders:report.shaders,maxFragmentSamplers:report.maxFragmentSamplers,failures:rows.filter(r=>!r.pass)},null,2));
if(!report.pass)process.exitCode=1;
