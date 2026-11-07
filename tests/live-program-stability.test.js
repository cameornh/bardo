import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {liveProgramConstants} from '../src/rtx-sand-lab/shader-dependencies.js';
import {reachableShader} from '../src/rtx-sand-lab/shader-reachability.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {waitForVisible} from '../src/rtx-sand-lab/visible-startup.js';
import {shaderLoopBounds} from '../src/rtx-sand-lab/shader-loop-bounds.js';

function fixture(Renderer=LiveWaterRenderer){
 const programs=new Map();
 const renderer={extensions:{has:()=>false},getContext:()=>({getExtension:()=>null}),initRenderTarget(){},copyTextureToTexture(){},
  compile(scene){scene.traverse(o=>{const m=o.material;if(!m?.isShaderMaterial)return;const s={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader};m.onBeforeCompile(s,renderer);programs.set(m,{key:m.customProgramCacheKey(),...s});});},render(scene){this.compile(scene);}};
 const lab=new LiveSandLab(renderer,{boulders:true,physicalResolution:true,bulkFields:true});lab.hardwarePolicy={nestedWaterFields:false};
 const field={renderer,camera:new THREE.PerspectiveCamera(),uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}},draw=new Renderer(field,lab);
 installRTXShaderCompatibility(renderer,{declaredOnly:true});installProgramSpecialization(renderer,()=>true,{warmObjects:false,prepareCompile:true,filterConstants:liveProgramConstants});
 return {renderer,lab,draw,programs};
}

test('all full-screen beach programs prepared while paused survive first sand and object transitions',()=>{
 const f=fixture(),scenes=['shellScene','waterScene','submergedScene','backgroundScene','photonScene','copyScene','mergeScene'].map(k=>f.draw[k]);
 for(const s of scenes)f.renderer.compile(s);const initial=new Map(f.programs);
 for(let state=0;state<64;state++){
  const u=f.draw.u;u.uSandCount.value=state&1?24:0;u.uSandMax.value.y=state&1?3:0;u.uBodyCount.value=state&2?8:0;
  for(const s of scenes)f.renderer.render(s);
  for(const [material,program] of f.programs)assert.deepEqual(program,initial.get(material),material.name||scenes.findIndex(s=>s.children[0].material===material));
 }
 const shell=f.programs.get(f.draw.shellScene.children[0].material).fragmentShader;
 assert.match(shell,/uniform int uSandCount/);assert.match(shell,/uniform int uBodyCount/);
});

test('live glass compilation omits unreachable water paths and preserves glass function bodies',()=>{
 const live=fixture(),snapshot=fixture(WaterLabRenderer),original=snapshot.draw.shellScene.children[0].material.fragmentShader,compact=live.draw.shellScene.children[0].material.fragmentShader;
 assert.ok(compact.length<original.length*.6,`${compact.length} / ${original.length}`);
 const roots=['parcelSample','fieldEmptyAdvance','fieldDetailDx'];
 assert.equal(compact,reachableShader(original,roots));assert.equal(reachableShader(compact,roots),compact);
 for(const name of ['shadeWater','traceOpaque','floorColor','waterColumn'])assert.doesNotMatch(compact,new RegExp(`(?:float|vec[234]) ${name}\\(`));
 for(const name of ['traceGlass','shadeGlass','rainVeil','bodyDistance','bodyNormal','sunTransmission','sandVisibility'])assert.match(compact,new RegExp(`(?:float|vec[234]) ${name}\\(`));
 // Functions retained by the graph retain their exact source text. The live
 // constructor must not mutate the independently created snapshot material.
 assert.match(original,/vec3 shadeWater\(/);assert.equal(original,snapshot.draw.shellScene.children[0].material.fragmentShader);
});

test('reachability follows overloads, macros and global initializers without rewriting kept math',()=>{
 const source=`float leaf(float x){return x*x;}\nfloat used(float x){return leaf(x);}\nvec2 used(vec2 x){return x+x;}\nfloat globalHelper(){return 2.;}\nfloat macroHelper(float x){return x;}\nfloat unused(){return 8.;}\n#define SAMPLE(x) macroHelper(x)\nfloat initial=globalHelper();\n// unused() is not a call\nvoid main(){float result=SAMPLE(used(3.))+initial;}`;
 const compact=reachableShader(source);
 assert.equal(compact,source.replace('float unused(){return 8.;}',''));
 assert.throws(()=>reachableShader('float broken(){'),/Unbalanced/);
});

test('execution settings remain specialized so the driver need not compile both sampling algorithms',()=>{
 const f=fixture(),s=f.draw.shellScene,m=s.children[0].material;
 m.uniforms.uFieldSkipping.value=true;f.renderer.compile(s);
 assert.match(f.programs.get(m).fragmentShader,/const bool uFieldSkipping=true/);
 const first=f.programs.get(m).key;m.uniforms.uFieldSkipping.value=false;f.renderer.compile(s);
 assert.notEqual(first,f.programs.get(m).key);assert.match(f.programs.get(m).fragmentShader,/const bool uFieldSkipping=false/);
});

test('background live startup waits for visibility and removes its listener when selected',async()=>{
 const listeners=new Set(),document={hidden:true,addEventListener(name,fn){assert.equal(name,'visibilitychange');listeners.add(fn);},removeEventListener(name,fn){listeners.delete(fn);}};
 let started=false;const work=waitForVisible(document).then(()=>{started=true;});await Promise.resolve();assert.equal(started,false);
 for(const fn of listeners)fn();await Promise.resolve();assert.equal(started,false);
 document.hidden=false;for(const fn of [...listeners])fn();await work;assert.equal(started,true);assert.equal(listeners.size,0);
 await waitForVisible(document);assert.equal(listeners.size,0);
});

test('large nested ray loops use unchanged uniform limits, not compile-time expansion',()=>{
 const source='// for(int i=0;i<256;i++)\nvoid main(){for(int ray=0;ray<128;ray++){for(int bin=0;bin<32;bin++){}for(int corner=0;corner<8;corner++){}}}';
 const result=shaderLoopBounds(source);assert.deepEqual(result.limits,{uLiveLoop128:128,uLiveLoop32:32});
 assert.match(result.source,/ray<uLiveLoop128/);assert.match(result.source,/bin<uLiveLoop32/);assert.match(result.source,/corner<8/);assert.match(result.source,/\/\/ for\(int i=0;i<256/);
 const f=fixture();f.renderer.compile(f.draw.shellScene);const m=f.draw.shellScene.children[0].material,compiled=f.programs.get(m).fragmentShader;
 assert.match(compiled,/i<uLiveLoop128/);assert.equal(m.uniforms.uLiveLoop128.value,128);
 assert.match(compiled,/j<uLiveLoop96/);assert.equal(m.uniforms.uLiveLoop96.value,96);
 assert.match(compiled,/uniform int uSandCount/);
});

test('late-created live compute materials receive bounded loops without freezing execution-setting keys',()=>{
 const m=new THREE.ShaderMaterial({uniforms:{uStation:{value:6}},vertexShader:'void main(){}',fragmentShader:'uniform int uStation;void main(){for(int i=0;i<128;i++){if(i==uStation)break;}}'});
 const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),m));
 const programs=[],r={render(){const shader={vertexShader:m.vertexShader,fragmentShader:m.fragmentShader,uniforms:m.uniforms};m.onBeforeCompile(shader,r);programs.push({source:shader.fragmentShader,key:m.customProgramCacheKey(),limit:shader.uniforms.uLiveLoop128?.value});}};
 installRTXShaderCompatibility(r,{declaredOnly:true,boundedLoops:true});installProgramSpecialization(r,()=>true,{warmObjects:false,filterConstants:liveProgramConstants});
 r.render(scene);m.uniforms.uStation.value=3;r.render(scene);r.render(scene);
 assert.equal(programs[0].limit,128);assert.match(programs[0].source,/i<uLiveLoop128/);
 assert.match(programs[1].source,/const int uStation=3/);assert.notEqual(programs[0].key,programs[1].key);
 assert.deepEqual(programs[1],programs[2]);assert.equal(programs[1].source.match(/uniform int uLiveLoop128;/g).length,1);
});

test('graphics failure discards in-flight physics and forbids further steps or queued retries',async()=>{
 let complete;const calls=[],transfer=new Promise(resolve=>{complete=resolve;});
 const lab=Object.assign(Object.create(LiveSandLab.prototype),{
  enabled:true,asyncSimulation:true,paused:false,generation:1,accumulator:1/15,completedDt:0,
  positions:new Float32Array(4),spec:{scale:10,spacing:.2},optimizations:{gpuBatch:true},detail:{enabled:false},
  gpu:{cpu:false,solve(){calls.push('pressure');},finishDeferredPressure(){calls.push('validate');}},
  transportGPU:{solve(){calls.push('transport');}},stepReadback:{read(){return transfer;}},
  prepareStep(){return {old:new Float32Array(4),predicted:new Float32Array(4)};},finishStep(){calls.push('finish');},lastAdvance:performance.now(),
 });
 Object.defineProperty(lab,'timestep',{value:1/15});
 lab.startAsyncStep();const pending=lab.asyncPending;await Promise.resolve();
 assert.deepEqual(calls,['pressure','transport']);
 lab.asyncTimer=setTimeout(()=>assert.fail('cancelled physics timer ran'),1000);
 lab.stopGraphicsWork(Error('shader failed'));complete({positions:new Float32Array(4)});await pending;
 assert.equal(lab.enabled,false);assert.equal(lab.paused,true);assert.equal(lab.asyncTimer,null);assert.equal(lab.completedDt,0);
 assert.equal(lab.generation,2);assert.equal(lab.accumulator,0);assert.deepEqual(calls,['pressure','transport']);
 // Even a later UI action trying to resume must not revive a failed context.
 lab.enabled=true;lab.paused=false;lab.asyncSimulation=true;lab.accumulator=1/15;
 lab.startAsyncStep();lab.step(1/15);lab.stopGraphicsWork(Error('second error'));
 assert.equal(lab.asyncPending,null);assert.equal(lab.generation,2);assert.deepEqual(calls,['pressure','transport']);
});
