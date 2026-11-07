import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {splitSurfaceSources} from '../src/rtx-sand-lab/split-surfaces.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {liveProgramConstants} from '../src/rtx-sand-lab/shader-dependencies.js';

function fixture(){
 const programs=new Map(),renderer={extensions:{has:()=>false},getContext:()=>({getExtension:()=>null}),initRenderTarget(){},copyTextureToTexture(){},
  compile(scene){scene.traverse(o=>{const m=o.material;if(!m)return;const shader={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader,uniforms:m.uniforms};m.onBeforeCompile(shader,renderer);programs.set(m,{source:shader.fragmentShader,key:m.customProgramCacheKey()});});},render(){assert.fail('No GPU work in structural checks');}};
 const lab=new LiveSandLab(renderer,{boulders:true,bulkFields:true});lab.hardwarePolicy={nestedWaterFields:false};
 const field={renderer,camera:new THREE.PerspectiveCamera(),uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
 const draw=new LiveWaterRenderer(field,lab);
 installRTXShaderCompatibility(renderer,{declaredOnly:true,boundedLoops:true,reachableOnly:true});
 installProgramSpecialization(renderer,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});
 return {draw,lab,renderer,programs};
}

test('live primary tracing is isolated from shading and scheduled before its consumer',()=>{
 const {draw}=fixture(),jobs=firstFrameShaderJobs(draw);
 for(const [original,split] of draw.splitSurfaces){
  assert.equal(jobs.some(j=>j.scene===original),false);
  const a=jobs.findIndex(j=>j.scene===split.traceScene),b=jobs.findIndex(j=>j.scene===split.shadeScene);
  assert.ok(a>=0&&b===a+1+split.opticalStages.length);
  assert.equal(split.target.texture.type,THREE.FloatType);
  assert.equal(split.target.texture.minFilter,THREE.NearestFilter);
  for(const job of split.jobs(null)){const source=job.scene.children[0].material.fragmentShader;
   if(job.name.endsWith('lighting'))assert.doesNotMatch(source,/float trace(?:Opaque|Body|Glass|Water)\(/,job.name+' must only light recorded hits');
   if(job.name.endsWith('-hit'))assert.doesNotMatch(source,/vec3 (?:surfaceColor|shadeGlass|soluteVolume)\(/,job.name+' must not shade its rays');
  }
  assert.doesNotMatch(split.trace.fragmentShader,/vec3 (shadeWater|shadeGlass|floorColor|soluteVolume)\(/);
  assert.match(split.shade.fragmentShader,/texelFetch\(uSurfaceHit/);
  if(split.kind==='opaque')assert.match(split.trace.fragmentShader,/traceEdgeOpaque/,'Real finite-budget mirage remains in tracing');
  if(split.kind==='water'){
   const optics=split.opticalStages;
   assert.equal(optics[0].target,optics[2].target,'Recycle hit records after reflection lighting');
   assert.notEqual(optics[1].target,optics[3].target,'Keep reflection color alive through transmission');
   assert.equal(new Set(split.targets).size,split.targets.length,'Dispose each temporary allocation once');
   assert.equal(split.target.textures.length,2);
   assert.match(split.trace.fragmentShader,/hit=vec4\(n,path\);medium=vec4\(concentration,t\)/);
   assert.match(split.shade.fragmentShader,/if\(m.w<=0.\)discard/);
   assert.match(split.shade.fragmentShader,/if\(m.w>=9999.\)/);
  }
 }
 assert.ok(draw.splitSurfaces.has(draw.submergedScene),'Underwater tracing is split too');
});

test('split surface shaders and program keys remain stable across first erosion, objects and their removal',()=>{
 const {draw,renderer,programs}=fixture(),scenes=[...draw.splitSurfaces.values()].flatMap(p=>p.jobs(null).map(j=>j.scene));
 for(const scene of scenes)renderer.compile(scene);const first=new Map(programs);
 for(const count of [1,24,96,0]){
  draw.u.uSandCount.value=count;draw.u.uBodyCount.value=count%9;draw.u.uSandMax.value.y=count?3:0;
  for(const scene of scenes)renderer.compile(scene);
  for(const [m,result] of programs)assert.deepEqual(result,first.get(m),m.name);
 }
 for(const [m,{source}] of programs){
  assert.doesNotMatch(source,/for\(int [a-zA-Z]+=0;[a-zA-Z]+<(96|128|256);/);
  assert.ok(source.length<47000,`${m.name}: ${source.length}`);
 }
});

test('split draw restores target and clear state even after a rejected shader',()=>{
 const {draw}=fixture(),split=draw.splitSurfaces.get(draw.waterScene),output={width:24,height:16},color=new THREE.Color(.1,.2,.3);
 let current=output,alpha=.7,clears=0;const submissions=[];
 const renderer={getRenderTarget:()=>current,setRenderTarget:t=>{current=t;},getClearColor:c=>c.copy(color),getClearAlpha:()=>alpha,
  setClearColor(c,a){color.set(c);alpha=a;},clear(){clears++;assert.equal(current,split.target);assert.equal(alpha,0);}};
 const initial=color.clone();
 split.render(renderer,function(scene){submissions.push([scene,current]);});
 assert.equal(submissions.length,split.jobs(output).length);split.jobs(output).forEach((job,i)=>{assert.equal(submissions[i][0],job.scene);assert.equal(submissions[i][1],job.target);});
 assert.equal(current,output);assert.equal(alpha,.7);assert.deepEqual(color,initial);assert.equal(clears,1);
 assert.equal(split.target.width,24);assert.equal(split.target.height,16);
 assert.throws(()=>split.render(renderer,()=>{throw Error('rejected');}),/rejected/);
 assert.equal(current,output);assert.equal(alpha,.7);assert.deepEqual(color,initial);
});

test('stage extraction fails explicitly if the source contract changes',()=>{
 assert.throws(()=>splitSurfaceSources('void main(){}','water'),/Missing surface main/);
 assert.throws(()=>splitSurfaceSources('\nvoid main(){}','opaque'),/Missing shader function/);
 assert.throws(()=>splitSurfaceSources('\nvoid main(){}','other'),/Missing shader function/);
});

test('playback preparation binds real beach geometry without advancing or dispatching physics',()=>{
 const {draw,lab,renderer,programs}=fixture();lab.gpu.cpu=false;
 const before=lab.positions.slice(),time=lab.time,count=lab.count;
 const jobs=firstFrameShaderJobs(draw),detail=jobs.find(j=>j.name==='fine water transport');
 assert.ok(detail);assert.equal(detail.target.width,1);assert.equal(detail.target.textures.length,3);
 for(const name of ['water transport','physics transfer','projected air transfer','sand grain transport'])assert.ok(jobs.some(j=>j.name===name),name);
 renderer.compile(detail.scene);const first=programs.get(lab.detail.material);
 assert.match(first.source,/const int uStation=6/);
 assert.equal(lab.detail.u.uSandCount,lab.u.uSandCount);
 assert.deepEqual(lab.positions,before);assert.equal(lab.time,time);assert.equal(lab.count,count);assert.equal(lab.detail.count,0);
 Object.assign(lab.detail.u,lab.u,lab.air.u);lab.u.uSandCount.value=12;renderer.compile(detail.scene);
 assert.deepEqual(programs.get(lab.detail.material),first,'First real particle update cannot swap scene definitions');
});
