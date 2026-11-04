import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';

const renderer={extensions:{has:()=>false,get:()=>null},getContext:()=>({getExtension:()=>null}),initRenderTarget(){},copyTextureToTexture(){},render(){assert.fail('Unexpected GPU work');}};
function fixture(){const lab=new LiveSandLab(renderer),field={renderer,camera:new THREE.PerspectiveCamera(),uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};return new LiveWaterRenderer(field,lab);}

test('live blob tracing is independent of the large scene-lighting program',()=>{
 const draw=fixture(),trace=draw.blobRenderer.material.fragmentShader,shade=draw.splitBlobs.material.fragmentShader;
 assert.ok(trace.length<12000);assert.doesNotMatch(trace,/shadeWater|traceOpaque|bodyDistance|labSolid/);
 assert.doesNotMatch(shade,/joinedDensity|blobSample|flat in vec4 vK/);
 assert.ok(shade.length<16000);assert.doesNotMatch(shade,/traceOpaque|bodyDistance|labSolid|labOpaque|bodyTransmission/);
 assert.match(trace,/normalPath=vec4\(n,path\)/);assert.match(trace,/chemistryDepth=vec4\(chemicals.xyz\/max\(.00001,chemicals.w\),t\)/);
 assert.match(shade,/shadeWater\(uEye\+ray\*medium.w,surface.xyz,ray,surface.w,medium.xyz\)/);
 assert.equal(draw.blobRenderer.u.uBlobMarchLimit.value,192);assert.equal(draw.blobRenderer.u.uBlobColumnLimit.value,256);
 const jobs=firstFrameShaderJobs(draw),traceJob=jobs.find(j=>j.name==='detached water tracing'),shadeJob=jobs.find(j=>j.name==='detached water shading');
 assert.equal(traceJob.target,draw.splitBlobs.target);assert.equal(shadeJob.target,draw.blobs);
 assert.equal(traceJob.scene,draw.blobRenderer.scene);assert.equal(shadeJob.scene,draw.splitBlobs.scene);
});

test('split blob draw skips empty paused frames, retains depth and restores target on failure',()=>{
 const draw=fixture(),pass=draw.splitBlobs,output={width:96,height:64};let target=output,clears=0;const scenes=[];
 const r={getRenderTarget:()=>target,setRenderTarget:t=>target=t,clear(){clears++;}};
 pass.render(r,draw.field.camera,()=>assert.fail('Empty blob draw'));assert.equal(clears,0);
 draw.blobRenderer.geometry.instanceCount=1;
 pass.render(r,draw.field.camera,function(scene){scenes.push([scene,target]);});
 assert.equal(pass.target.width,96);assert.equal(pass.target.height,64);assert.equal(pass.target.depthBuffer,true);assert.equal(pass.target.textures.length,2);
 assert.deepEqual(scenes,[[pass.traceScene,pass.target],[pass.scene,output]]);assert.equal(target,output);
 assert.throws(()=>pass.render(r,draw.field.camera,()=>{throw Error('draw failure');}),/draw failure/);assert.equal(target,output);
});
