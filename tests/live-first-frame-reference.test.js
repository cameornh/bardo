import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {configureRTXLab} from '../src/rtx-sand-lab/profile.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {liveProgramConstants} from '../src/rtx-sand-lab/shader-dependencies.js';
import {MotionDetail} from '../src/lod.js';
import {SeaFoam} from '../src/sand-lab/sea-foam.js';

// Execute the real first-frame orchestration without a WebGL context. This
// checks lazy field allocation and actual draw-time flags, not just manually
// toggled uniforms. It does not validate GPU execution or visual output.
for(const discrete of [false,true])test(`the real ${discrete?'discrete':'compatible'} render path reuses prepared shader sources and keys`,()=>{
let target=null,clear=new THREE.Color(),alpha=0,viewport=new THREE.Vector4(0,0,96,64),scissor=viewport.clone(),test=false;
const prepared=new Map(),changes=[],draws=[];
const renderer={extensions:{has:n=>['EXT_color_buffer_float','OES_texture_float_linear'].includes(n)},getContext:()=>({getExtension:()=>null,isContextLost:()=>false}),
 getRenderTarget:()=>target,setRenderTarget:t=>target=t,getClearColor:c=>c.copy(clear),getClearAlpha:()=>alpha,setClearColor(c,a){clear.set(c);alpha=a;},clear(){},initRenderTarget(){},copyTextureToTexture(){},
 getViewport:v=>v.copy(viewport),setViewport:(...v)=>{v[0]?.isVector4?viewport.copy(v[0]):viewport.set(...v);},getScissor:v=>v.copy(scissor),setScissor:(...v)=>{v[0]?.isVector4?scissor.copy(v[0]):scissor.set(...v);},getScissorTest:()=>test,setScissorTest:v=>test=v,
 compile(scene){scene.traverse(o=>{const m=o.material;if(!m?.isShaderMaterial)return;const s={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader,uniforms:m.uniforms};m.onBeforeCompile(s,renderer);prepared.set(m,{key:m.customProgramCacheKey(),source:s.fragmentShader});});},
 render(scene){scene.traverse(o=>{const m=o.material;if(!m?.isShaderMaterial)return;const s={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader,uniforms:m.uniforms};m.onBeforeCompile(s,renderer);const key=m.customProgramCacheKey(),old=prepared.get(m);for(const [name,u] of Object.entries(s.uniforms||{})){if(!u.value?.isTexture||!target?.textures.includes(u.value))continue;const uses=s.fragmentShader.match(new RegExp('\\b'+name+'\\b','g'))||[];assert.ok(uses.length<=1,m.name+' reads from its own output: '+name); }draws.push({name:m.name,key,target:target?[target.width,target.height]:null});if(!old||old.key!==key||old.source!==s.fragmentShader)changes.push({name:m.name,wasPrepared:!!old,cacheHit:[...prepared.values()].some(p=>p.key===key&&p.source===s.fragmentShader),oldKey:old?.key,key,sourceChanged:old?.source!==s.fragmentShader});});}
};
const lab=new LiveSandLab(renderer,{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab,discrete?{adapter:'NVIDIA GeForce RTX 5070 Ti'}:{});lab.resolutions.ocean=discrete?2.2:1.4;lab.configure('ocean');lab.enabled=true;lab.paused=true;lab.seaFoam=new SeaFoam(renderer);
const camera=new THREE.PerspectiveCamera(55,96/64,.025,150);camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
const field={renderer,camera,target:new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false}),resolution:new THREE.Vector2(96,64),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{count:0,uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
for(const n of ['beach','grass','grains','soft','optics','lightTest'])field[n]={count:0};
const draw=new LiveWaterRenderer(field,lab);draw.fixedLoadScale=1;draw.mediumShadows.u.uMediumSize.value.set(16,12,16);
installRTXShaderCompatibility(renderer,{declaredOnly:true,boundedLoops:true,reachableOnly:true});installProgramSpecialization(renderer,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});
for(const job of firstFrameShaderJobs(draw)){job.scene.traverse(o=>{if(o.material)o.material.name||=job.name;});renderer.compile(job.scene);}

draw.render({dt:lab.timestep,adaptive:true});
assert.ok(draws.length>=20);
assert.ok(draws.some(d=>d.name==='water-lighting'));
assert.equal(draws.at(-1).name,'display');
assert.deepEqual(changes.filter(c=>!c.cacheHit),[], 'Unexpected program on the first real draw');
assert.equal(lab.time,0);
// Exercise the actual populated render path, including the first spray
// shadow draw. No GPU results or numerical physics are inferred by this mock.
for(const kind of ['glass','rock','mirror','light']){
 lab.objectRadius=.3;lab.spawn(kind,[1,3,2],[0,-1,0],'sphere');
 lab.detail.count=1;lab.detail.activeSpan=1;lab.detail.time+=lab.timestep;
 lab.detail.fallback[0].image.data.set([0,2,0,0]);
 lab.detail.fallback[1].image.data.set([0,0,0,10]);
 lab.detail.fallback[2].image.data.set([.01,1,.4,100]);
 draw.render({dt:lab.timestep,adaptive:true});
}
assert.ok(draws.some(d=>d.name==='spray shadows'));
assert.deepEqual(changes.filter(c=>!c.cacheHit),[], 'Object or spray activation introduced a new program');
});
