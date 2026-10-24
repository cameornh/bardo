import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SandLab} from '../src/sand-lab/lab.js';
import {LabFluidGPU} from '../src/sand-lab/water-lab-gpu.js';
import {solveDensityCPU} from '../src/sand-lab/density-cpu.js';
import {setDensityKernel} from '../src/sand-lab/native-density.js';
import {pressureFixtures} from '../src/sand-lab/bounded-pressure-fixtures.js';
import {optimizationPreset,applyOptimizationFlags} from '../src/sand-lab/optimization-controls.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';

await setDensityKernel(await readFile(new URL('../src/sand-lab/kernels/density.wasm',import.meta.url)));
const forbidden=()=>assert.fail('Live pressure submitted GPU work');
const renderer={extensions:{has:()=>true},render:forbidden,compileAsync:forbidden,getContext:forbidden,getRenderTarget:forbidden,setRenderTarget:forbidden};

test('the live entry point cannot import or auto-validate experimental pressure',async()=>{
 const entry=new URL('../src/sand-lab/main.js',import.meta.url),visited=new Set();
 async function visit(url){
  if(visited.has(url.href))return;visited.add(url.href);
  assert.doesNotMatch(url.pathname,/\/(bounded-pressure[^/]*|pressure-geometry-gpu)\.js$/);
  const source=await readFile(url,'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+\.js)['"]/g))await visit(new URL(match[1],url));
 }
 await visit(entry);
 const source=await readFile(entry,'utf8');
 assert.match(source,/lab\.gpu\.forceCPUConstraints\s*=\s*true/);
 assert.match(source,/installProgramSpecialization\(renderer,[^;]*warmObjects:false/);
 assert.doesNotMatch(source,/gpuPressure|verifyBoundedPressure/);
});

test('forced CPU pressure wins over an attached experiment, even with no objects',()=>{
 const gpu=new LabFluidGPU(renderer,{uStation:{value:6},uBodyCount:{value:0}});
 gpu.forceCPUConstraints=true;
 gpu.contactGeometry={optimizations:{gpuPressure:true}};
 gpu.boundedPressure={solve:forbidden,dispose(){}};
 for(const native of [false,true])for(const count of [0,1,4])for(const f of pressureFixtures()){
  gpu.nativeDensity=native;gpu.uniforms.uBodyCount.value=count;
  const actual=gpu.solve(f.positions,f.spacing,f.collide,3,f.boundary,false,true);
  const expected=solveDensityCPU(f.positions,gpu.neighbors,f.spacing,3,f.collide,f.boundary);
  let error=0;for(let i=0;i<actual.length;i++)error=Math.max(error,Math.abs(actual[i]-expected[i]));
  assert.ok(error<1e-6,`CPU pressure mismatch: ${error}`);
  assert.equal(gpu.cpuContacts,true);assert.match(gpu.constraintBackend,/CPU/);
  assert.deepEqual(gpu.resultTexture.image.data.slice(0,actual.length),actual);
  assert.deepEqual(gpu.texture.image.data.slice(0,f.positions.length),f.positions);
 }
 gpu.dispose();
});

test('live CPU restriction survives resolution, beach-size, object and optimization resets',()=>{
 const lab=new SandLab(renderer,{boulders:true,physicalResolution:true});lab.gpu.forceCPUConstraints=true;
 const defaults={...lab.optimizations},draw={detailRenderer:{},mediumShadows:{tiles:{}}};
 const f=pressureFixtures()[0];
 for(const [resolution,width] of [[1,44],[2.2,110],[3,220]]){
  lab.resolutions.ocean=resolution;lab.configure('ocean',width/110);
  lab.balls.length=0;lab.syncUniforms();assert.equal(lab.gpu.uniforms.uBodyCount.value,0);
  for(const mode of ['all','baseline','reference']){
   applyOptimizationFlags(lab,draw,optimizationPreset(defaults,mode));
   lab.gpu.nativeDensity=lab.optimizations.nativeContacts!==false;
   assert.equal(lab.gpu.cpuContacts,true);
   const actual=lab.gpu.solve(f.positions,f.spacing,f.collide,3,f.boundary,false,true);
   assert.ok(actual.every(Number.isFinite));assert.match(lab.gpu.constraintBackend,/CPU/);
  }
 }
 lab.gpu.dispose();
});

test('live specialization draws only requested programs and never warms unused variants',async()=>{
 const material={isShaderMaterial:true,uniforms:{uBodyCount:{value:0},uPass:{value:0}},onBeforeCompile(){},customProgramCacheKey(){return 'test';}};
 const scene={traverse(fn){fn({material});}},draws=[];
 const r={render(){const s={vertexShader:'',fragmentShader:'uniform int uBodyCount; uniform int uPass;'};material.onBeforeCompile(s);draws.push(s.fragmentShader);},compileAsync:forbidden};
 installProgramSpecialization(r,()=>true,{warmObjects:false});
 r.render(scene,{});await r.warmObjectPrograms([scene],{});
 material.uniforms.uBodyCount.value=3;r.render(scene,{});await r.warmObjectPrograms([scene],{});
 assert.equal(draws.length,2);assert.match(draws[0],/const int uBodyCount=0/);assert.match(draws[1],/uniform int uBodyCount/);
});
