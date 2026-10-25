import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
import {compactMacroReduction,MACRO_REDUCTION_SAMPLES} from '../src/rtx-sand-lab/macro-reduction.js';
import {FieldOccupancy} from '../src/sand-lab/field-occupancy.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {requiresOpenGLWindow} from '../src/rtx-sand-lab/profile.js';

test('the reported RTX D3D11 path is guarded while the working NVIDIA OpenGL and Mac Metal paths are allowed',()=>{
 assert.equal(requiresOpenGLWindow({adapter:'ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)'}),true);
 assert.equal(requiresOpenGLWindow({adapter:'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5070 Ti/PCIe/SSE2, OpenGL 4.5.0)'}),false);
 assert.equal(requiresOpenGLWindow({adapter:'ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X, Unspecified Version)'}),false);
});

function compileFixture({supported=true,readyAfter=2}={}){
 let target='previous',polls=0,uniforms=0,compiles=0,lost=false;
 const material={},program={isReady(){polls++;return polls>=readyAfter;},getUniforms(){assert.ok(polls>=readyAfter,'blocking query before compilation completed');uniforms++;}};
 const renderer={extensions:{has:()=>supported},getContext:()=>({isContextLost:()=>lost}),getRenderTarget:()=>target,setRenderTarget:t=>target=t,properties:{get:()=>({currentProgram:program})},compile(){compiles++;return new Set([material]);}};
 return {renderer,lose(){lost=true;},get target(){return target;},get polls(){return polls;},get uniforms(){return uniforms;},get compiles(){return compiles;}};
}
test('shader preparation yields and polls completion before asking for uniforms or drawing',async()=>{
 const f=compileFixture(),stages=[];let waits=0;
 const result=await prepareShaderJobs(f.renderer,[{name:'surface',target:'surface'}],{before:async name=>stages.push(name),wait:async()=>{waits++;}});
 assert.equal(result.prepared,1);assert.deepEqual(stages,['Compiling surface']);assert.equal(waits,1);assert.equal(f.uniforms,1);assert.equal(f.target,'previous');
});
test('a timed-out shader stops the remaining compilation jobs without querying link status',async()=>{
 const f=compileFixture({readyAfter:Infinity});let time=0;
 await assert.rejects(prepareShaderJobs(f.renderer,[{name:'first',target:1},{name:'second',target:2}],{timeoutMs:10,now:()=>time,wait:async()=>{time+=11;}}),/timed out: first/);
 assert.equal(f.compiles,1);assert.equal(f.uniforms,0);assert.equal(f.target,'previous');
});
test('lost context and unavailable parallel compilation submit no program',async()=>{
 const f=compileFixture();f.lose();await assert.rejects(prepareShaderJobs(f.renderer,[{name:'surface'}]),/context lost/);assert.equal(f.compiles,0);
 const unsupported=compileFixture({supported:false});assert.equal((await prepareShaderJobs(unsupported.renderer,[{}])).prepared,0);assert.equal(unsupported.compiles,0);
});
test('flat macro reduction visits every original sample in exactly the same order',()=>{
 const original=[];for(let y=0;y<=8;y++)for(let z=0;z<=8;z++)for(let x=0;x<=8;x++)original.push([x,y,z]);
 assert.equal(MACRO_REDUCTION_SAMPLES,original.length);
 assert.deepEqual(Array.from({length:MACRO_REDUCTION_SAMPLES},(_,i)=>[i%9,Math.floor(i/81),Math.floor(i/9)%9]),original);
 const field=new FieldOccupancy({}),source=field.material.fragmentShader,compact=compactMacroReduction(source);
 assert.notEqual(compact,source);assert.doesNotMatch(compact,/for\(int y=0/);assert.match(compact,/sampleIndex<uReductionSamples/);assert.equal(compactMacroReduction(compact),compact);field.dispose();
});
test('parallel preparation applies the same specialization as drawing and stable null samplers',()=>{
 const material=new THREE.ShaderMaterial({uniforms:{uImage:{value:null},uStation:{value:6}},vertexShader:'void main(){}',fragmentShader:'uniform int uStation;uniform sampler2D uImage;void main(){vec4 a=texture(uImage,vec2(0));}'});
 const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));const keys=[],sources=[];
 const r={compile(){const shader={vertexShader:material.vertexShader,fragmentShader:material.fragmentShader};material.onBeforeCompile(shader,r);keys.push(material.customProgramCacheKey());sources.push(shader.fragmentShader);return new Set([material]);},render(s){this.compile(s);}};
 installRTXShaderCompatibility(r);installProgramSpecialization(r,()=>true,{warmObjects:false,prepareCompile:true});r.compile(scene);
 const image=new THREE.DataTexture(new Float32Array(4),1,1);material.uniforms.uImage.value=image;r.render(scene);
 assert.equal(keys[0],keys[1]);assert.equal(sources[0],sources[1]);assert.match(sources[0],/const int uStation=6/);assert.match(sources[0],/textureLod/);
 material.dispose();scene.children[0].geometry.dispose();image.dispose();
});
