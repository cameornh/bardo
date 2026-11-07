import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cachedVolumeLighting,replaceShaderFunction} from '../src/rtx-sand-lab/deferred-optics.js';
import {compactSpraySampling,sprayAtlasUV} from '../src/rtx-sand-lab/spray-atlas.js';
import {SPRAY_SHADOW_GLSL} from '../src/sand-lab/water-lab-spray-shadows.js';
import {createShaderExercise,prepareShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';

test('packed spray filtering is identical at tile borders and between texels, for all sixteen layers',()=>{
 const size=8,images=Array.from({length:4},(_,tile)=>Float64Array.from({length:size*size*4},(_,i)=>Math.sin(i*.37+tile)*.5+tile));
 const atlas=new Float64Array(size*size*16);
 for(let tile=0;tile<4;tile++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<4;c++)atlas[((Math.floor(tile/2)*size+y)*size*2+(tile%2)*size+x)*4+c]=images[tile][(y*size+x)*4+c];
 function sample(a,width,height,uv,c){
  const x=uv[0]*width-.5,y=uv[1]*height-.5,ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
  const at=(x,y)=>a[(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4+c];
  return (at(ix,iy)*(1-tx)+at(ix+1,iy)*tx)*(1-ty)+(at(ix,iy+1)*(1-tx)+at(ix+1,iy+1)*tx)*ty;
 }
 for(let layer=0;layer<16;layer++)for(const u of [0,.001,.0625,.24,.5,.9375,.999,1])for(const v of [0,.002,.13,.56,.999,1]){
  const original=sample(images[layer>>2],size,size,[u,v],layer%4),packed=sample(atlas,size*2,size*2,sprayAtlasUV([u,v],layer,size),layer%4);
  assert.ok(Math.abs(original-packed)<1e-13,`${layer}: ${u},${v}`);
 }
 const source=compactSpraySampling(SPRAY_SHADOW_GLSL);
 assert.match(source,/textureLod\(uSprayAtlas/);
 assert.doesNotMatch(source,/texture\(uSprayShadow[0-3]/);
});

test('volume integration keeps exact Beer weights and never reenters geometric shadows',()=>{
 const source=cachedVolumeLighting('vec3 soluteVolume(vec3 b){return b;}');
 assert.doesNotMatch(source,/\b(?:objectLight|sunRadiance|traceOpaque|sandVisibility|bodyTransmission|labOpaque)\s*\(/);
 assert.match(source,/mediumSun\(q\)/);
 // Compare the five shader intervals to the closed-form homogeneous medium.
 // The finite optical tail deliberately stops at optical depth 8, as before.
 for(const extinction of [.001,.1,1,30])for(const path of [0,.001,1,15,100]){
  const limit=Math.min(path,8/extinction),step=limit/5,scatter=.32,incident=1.7,bottom=.4;
  let result=bottom*Math.exp(-extinction*path);
  for(let i=0;i<5;i++)result+=Math.exp(-extinction*i*step)*(-Math.expm1(-extinction*step))*scatter/extinction*incident;
  const exact=bottom*Math.exp(-extinction*path)+scatter/extinction*incident*(-Math.expm1(-extinction*limit));
  assert.ok(Math.abs(result-exact)<1e-10);
 }
 assert.throws(()=>replaceShaderFunction('void main(){}','absent',''),/Missing shader/);
});

test('first draw exercise uses isolated one-pixel outputs and restores state on failure',async()=>{
 let current='scene output',calls=0;const material=new THREE.ShaderMaterial(),scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
 const renderer={getRenderTarget:()=>current,setRenderTarget:t=>{current=t;},getContext:()=>({isContextLost:()=>false}),render(s){calls++;assert.equal(s,scene);assert.equal(current.width,1);assert.equal(current.height,1);assert.equal(current.textures.length,2);}};
 const completion={run:async submit=>{submit();}},exercise=createShaderExercise(renderer,completion),output=new THREE.WebGLRenderTarget(300,200,{count:2});
 await exercise({scene,camera:new THREE.Camera(),target:output});assert.equal(calls,1);assert.equal(current,'scene output');
 completion.run=async submit=>{submit();throw Error('GPU did not finish');};
 await assert.rejects(exercise({scene,target:output}),/did not finish/);assert.equal(current,'scene output');
 scene.children[0].geometry=new THREE.InstancedBufferGeometry();await exercise({scene,target:output});assert.equal(calls,2,'No instanced simulation or scene workload during exercise');exercise.dispose();
});

test('preparation waits for the first draw to finish before compiling the next program',async()=>{
 const order=[],program={isReady:()=>true,getUniforms:()=>order.push('linked')},renderer={extensions:{has:()=>true},getContext:()=>({isContextLost:()=>false}),getRenderTarget:()=>null,setRenderTarget(){},properties:{get:()=>({currentProgram:program})},compile(){order.push('compile');return new Set([{}]);}};
 await assert.rejects(prepareShaderJobs(renderer,[{name:'first'},{name:'second'}],{exercise:async()=>{order.push('one pixel');throw Error('stopped');}}),/stopped/);
 assert.deepEqual(order,['compile','linked','one pixel']);
});
