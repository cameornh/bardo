import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGLSL,std140Layout} from '../src/webgpu-sand-lab/translate.js';
import {packUniforms,cloneUniformValue} from '../src/webgpu-sand-lab/uniforms.js';
test('shared uniform layout preserves scalar / vec3 packing, matrix columns and array stride',()=>{
 const layout=std140Layout([{name:'a',type:'float',length:0},{name:'b',type:'vec3',length:0},{name:'c',type:'int',length:0},{name:'m',type:'mat3',length:0},{name:'array',type:'vec2',length:2}]);
 assert.deepEqual(layout.fields.map(f=>f.offset),[0,16,28,32,80]);assert.equal(layout.size,112);
 const data=packUniforms(layout,{a:2,b:[3,4,5],c:7,m:[1,2,3,4,5,6,7,8,9],array:[10,11,12,13]}),f=new Float32Array(data.buffer),i=new Int32Array(data.buffer);
 assert.equal(i[7],7);assert.deepEqual([...f.slice(8,20)],[1,2,3,0,4,5,6,0,7,8,9,0]);assert.deepEqual([...f.slice(20)],[10,11,0,0,12,13,0,0]);
});
test('draw snapshots cannot observe later shared-uniform mutations',()=>{
 const original=new Float32Array([1,2,3]),copy=cloneUniformValue(original);original[0]=9;assert.equal(copy[0],1);
});
test('translation splits compound varying declarations without overlapping locations',()=>{
 const result=prepareGLSL('in vec3 position;flat out float a,b,c;void main(){a=1.;b=2.;c=3.;gl_Position=vec4(position,1.);}','precision highp float;flat in float a,b,c;out vec4 color;void main(){color=vec4(a,b,c,1.);}');
 assert.equal(new Set(Object.values(result.context.availableVaryings)).size,3);
 assert.match(result.vertex,/gl_Position.z=\(gl_Position.z\+gl_Position.w\)\*0.5/);
});

import * as THREE from 'three';
import {SharedSceneWebGPU,sceneSamplerGroups} from '../src/webgpu-sand-lab/renderer.js';
import {installShaderLoopBounds} from '../src/rtx-sand-lab/shader-loop-bounds.js';
import {WebGPUFrameCompletion} from '../src/webgpu-sand-lab/completion.js';
import {ParticlePipeline} from '../src/rtx-sand-lab/fields/particles/pipeline.js';
test('first draw includes loop uniforms introduced by shader compilation hooks',()=>{
 const r=Object.create(SharedSceneWebGPU.prototype);
 Object.assign(r,{commands:[],autoClear:false,target:null,domElement:{height:1},viewport:new THREE.Vector4(0,0,1,1),scissorTest:false,attribute:()=>({}),texture:()=>({}),sampler:()=>({}),temporary:[],attributes:new WeakMap()});
 r.program=m=>{m.onBeforeCompile({vertexShader:m.vertexShader,fragmentShader:m.fragmentShader,uniforms:m.uniforms},r);return Promise.resolve({});};
 const m=new THREE.ShaderMaterial({vertexShader:'void main(){gl_Position=vec4(position,1.);}',fragmentShader:'void main(){float v=0.;for(int i=0;i<128;i++){v+=1.;}}',uniforms:{}});installShaderLoopBounds(m);
 const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),m));r.render(scene,new THREE.Camera());
 assert.equal(r.commands[0].uniforms.uLiveLoop128,128);
});
test('translated sampler helper stays at the texture call site',()=>{
 const p=prepareGLSL('in vec3 position;void main(){gl_Position=vec4(position,1.);}','precision highp float;uniform sampler2D source;out vec4 color;float val(sampler2D t,int i){return texelFetch(t,ivec2(i,0),0).r;}void main(){color=vec4(val(source,0));}');
 assert.match(p.fragment,/#define val\(t,i\)/);assert.doesNotMatch(p.fragment,/float val\(sampler2D/);
});
test('completion rejects overlapping frames and stops on queue failure',async()=>{
 let release;const gate=new Promise(r=>release=r),calls=[];const r={async flush(options){calls.push(options);if(calls.length===2)await gate;}};
 const completion=new WebGPUFrameCompletion(r),first=completion.run(()=>{});
 await assert.rejects(completion.run(()=>{}),/already pending/);release();await first;assert.equal(completion.pending,null);
 let failure;const failed=new WebGPUFrameCompletion({flush:async()=>{throw Error('lost');}},{onFailure:e=>failure=e});await assert.rejects(failed.run(()=>{}),/lost/);assert.equal(failure.message,'lost');
});
test('disposing compute fallback never destroys a shared rendering device',()=>{
 let destroyed=0;const p=new ParticlePipeline();p.device={destroy:()=>destroyed++};p.ownsDevice=false;p.dispose();assert.equal(destroyed,0);
});
test('completion retires only resources owned by that submission',async()=>{
 let release;const gate=new Promise(r=>release=r),freed=[];
 const old={destroy:()=>freed.push('old')},next={destroy:()=>freed.push('next')};
 const renderer=Object.create(SharedSceneWebGPU.prototype);
 Object.assign(renderer,{commands:[],temporary:[old],allocations:new WeakMap(),allocationBytes:0,info:{render:{}},device:{pushErrorScope(){},popErrorScope:async()=>null,createCommandEncoder:()=>({finish:()=>({})}),queue:{submit(){},onSubmittedWorkDone:()=>gate}}});
 const pending=renderer.flush();renderer.temporary.push(next);release();await pending;
 assert.deepEqual(freed,['old']);assert.deepEqual(renderer.temporary,[next]);await renderer.flush();assert.deepEqual(freed,['old','next']);
});
test('oversized scene allocation is rejected before touching the device',()=>{
 let allocated=0;const renderer=Object.create(SharedSceneWebGPU.prototype);
 Object.assign(renderer,{allocationBytes:8,resourceBudget:16,allocations:new WeakMap(),device:{createBuffer(){allocated++;return {destroy(){}};}}});
 assert.throws(()=>renderer.createBuffer({size:12}),/rendering budget/);assert.equal(allocated,0);
 const buffer=renderer.createBuffer({size:8});assert.equal(renderer.allocationBytes,16);renderer.destroyResource(buffer);assert.equal(renderer.allocationBytes,8);
});

test('replaced geometry releases buffers only after the last shared owner',()=>{
 const r=Object.create(SharedSceneWebGPU.prototype);Object.assign(r,{attributes:new WeakMap(),temporary:[]});
 const a=new THREE.Float32BufferAttribute([0,0,0],3),one=new THREE.BufferGeometry().setAttribute('position',a),two=new THREE.BufferGeometry().setAttribute('position',a),buffer={};r.attributes.set(a,{buffer});r.trackGeometry(one);r.trackGeometry(two);
 one.dispose();assert.equal(r.temporary.length,0);two.dispose();assert.deepEqual(r.temporary,[buffer]);assert.equal(r.attributes.has(a),false);two.dispose();assert.equal(r.temporary.length,1);
});

test('unrelated shared texture bindings do not create shader variants',()=>{
 const m=new THREE.ShaderMaterial({vertexShader:'void main(){}',fragmentShader:'uniform sampler2D image;void main(){}',uniforms:{image:{value:new THREE.DataTexture()},unused:{value:null}}});
 const key=JSON.stringify(sceneSamplerGroups(m));m.uniforms.unused.value=new THREE.DataTexture();m.uniforms.unused.value.minFilter=THREE.LinearFilter;assert.equal(JSON.stringify(sceneSamplerGroups(m)),key);
 m.uniforms.image.value.minFilter=THREE.LinearFilter;assert.notEqual(JSON.stringify(sceneSamplerGroups(m)),key);
});
