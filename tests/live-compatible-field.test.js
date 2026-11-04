import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {hardwarePolicy} from '../src/rtx-sand-lab/profile.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {LAB_FIELD_GLSL} from '../src/sand-lab/water-lab-field.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';

test('compatible hardware keeps the original single-field sampler across all live render passes',()=>{
 const renderer={extensions:{has:()=>false,get:()=>null},getContext:()=>({getExtension:()=>null}),initRenderTarget(){},copyTextureToTexture(){},render(){assert.fail('Unexpected GPU work');}};
 const lab=new LiveSandLab(renderer);lab.hardwarePolicy=hardwarePolicy({adapter:'ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 560X)'});
 const field={renderer,camera:new THREE.PerspectiveCamera(),uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}},draw=new LiveWaterRenderer(field,lab);
 assert.equal(draw.nestedWaterFields,false);assert.equal(draw.density.enabled,false);
 for(const scene of [draw.backgroundScene,draw.waterScene,draw.submergedScene,draw.shellScene,draw.blobRenderer.scene,draw.rainScene,draw.detailRenderer.opticalScene])scene.traverse(o=>{
  if(!o.material)return;const source=o.material.vertexShader+'\n'+o.material.fragmentShader;
  assert.doesNotMatch(source,/uNearOrigin|nearSlice|coarseSample/);
  assert.ok(source.includes(LAB_FIELD_GLSL));
  assert.equal(o.material.uniforms.uLabField,draw.density.u.uLabField);
 });
 const jobs=firstFrameShaderJobs(draw);assert.equal(draw.u.uFieldSkipping.value,true);
 assert.equal(jobs.some(j=>j.scene===draw.rainScene),false,'Disabled rain submits no speculative shader');
 assert.ok(jobs.some(j=>j.name==='detached water shading'));assert.ok(jobs.some(j=>j.name==='fine water lighting'));
 // Changing this sampling policy does not change any positions or forces.
 assert.equal(lab.hardwarePolicy.frameHz,60);
 assert.equal(hardwarePolicy({adapter:'ANGLE (NVIDIA GeForce RTX 5070 Ti, OpenGL 4.5)'}).nestedWaterFields,true);
});
