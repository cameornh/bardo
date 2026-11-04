import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {ClipmapWaterField} from '../src/rtx-sand-lab/clipmap-water.js';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {buildNeighbors,boundaryMetric} from '../src/sand-lab/water-lab-model.js';
const renderer={extensions:{has:()=>false,get:()=>null},getContext:()=>({getExtension:()=>null}),initRenderTarget(){},copyTextureToTexture(){},render(){assert.fail('Unexpected GPU work');}};
await setDensityKernel(await readFile(new URL('../src/sand-lab/kernels/density.wasm',import.meta.url)));
test('compiled contacts consume incremental bins after insertions, motion and deletion',()=>{
 const lab=new LiveSandLab(renderer),solver=new NativeDensity();
 for(let i=0;i<60;i++)lab.sand.parcels.push({id:i,position:[Math.sin(i)*3,.5,Math.cos(i*1.4)*3],mass:.02,packing:.6,wet:.7,aspect:i%2?.2:1,cuts:[{offset:[0,.1,0],radius:.18},{offset:[0,0,0],radius:-.4}]});
 for(let step=0;step<4;step++){
  if(step){lab.sand.parcels.splice(2,1);lab.sand.parcels[7].position[0]+=.5;lab.sand.parcels[8].cuts.push({offset:[.1,0,0],radius:.2});}
  lab.sand.update();lab.syncUniforms();const points=new Float32Array(lab.sand.parcels.flatMap(p=>[...p.position,0]));Object.assign(lab.optimizations,{nativeSandContacts:true,batchedContacts:true});
  solver.solve(points,buildNeighbors(points,.2).data,.2,1,p=>lab.collide(p),p=>lab.solid(p),lab);
  for(let i=0;i<points.length;i+=4){const p=Array.from(points.slice(i,i+3)),metric=boundaryMetric(p,q=>lab.solid(q),.4);assert.equal(solver.instance.exports.metric(...p,.4,solver.offsets.geometry,solver.offsets.metric),0);for(let k=0;k<3;k++)assert.ok(Math.abs(metric.normal[k]-solver.metric[k])<1e-6);assert.ok(Math.abs(metric.distance-solver.metric[3])<1e-7);}
 }
});
test('live optical passes use nested fields while lighting and snapshots stay camera independent',()=>{
 const lab=new LiveSandLab(renderer),field={renderer,camera:new THREE.PerspectiveCamera(),uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}},draw=new LiveWaterRenderer(field,lab),snapshot=new WaterLabRenderer(field,lab);
 for(const scene of [draw.backgroundScene,draw.waterScene,draw.submergedScene,draw.shellScene,draw.blobRenderer.scene])scene.traverse(o=>{if(o.material){assert.match(o.material.fragmentShader,/uNearOrigin/);assert.equal(o.material.uniforms.uLabField,draw.density.u.uLabField);assert.equal(o.material.uniforms.uNearOrigin,draw.density.u.uNearOrigin);}});
 for(const scene of [draw.rainScene,draw.blobRenderer.scene])scene.traverse(o=>{if(o.material){assert.match(o.material.vertexShader,/uNearOrigin/);assert.equal(o.material.uniforms.uNearOrigin,draw.density.u.uNearOrigin);}});
 for(const scene of [draw.mediumShadows.scene,draw.photonScene,draw.photonGather])scene.traverse(o=>{if(o.material){assert.doesNotMatch(o.material.fragmentShader,/uNearOrigin/);assert.equal(o.material.uniforms.uLabField,draw.density.coarse.u.uLabField);}});
 assert.doesNotMatch(snapshot.waterScene.children[0].material.fragmentShader,/uNearOrigin/);
});
test('switching live cache controls retains matching geometry and stock',()=>{
 const lab=new LiveSandLab(renderer);lab.sand.parcels.push({id:1,position:[0,2,0],mass:.3,packing:.6,wet:.7});lab.sand.update();lab.syncUniforms();const mass=lab.sand.totalMass(),samples=Array.from({length:30},(_,i)=>[i*.02,2.1,0]);const a=samples.map(p=>lab.solid(p));
 lab.optimizations.sandCache=false;lab.sand.revision++;const b=samples.map(p=>lab.solid(p));lab.optimizations.sandCache=true;lab.sand.revision++;const c=samples.map(p=>lab.solid(p));assert.deepEqual(a,b);assert.deepEqual(a,c);assert.equal(lab.sand.totalMass(),mass);
});
test('water level switches release inactive targets and tiny fields retain the reference',()=>{
 const r={extensions:{has:()=>true},getRenderTarget:()=>null,setRenderTarget(){},getClearColor:c=>c.set(0),getClearAlpha:()=>0,setClearColor(){},clear(){},render(){},getViewport:v=>v.set(0,0,640,360),getScissor:v=>v.set(0,0,640,360),getScissorTest:()=>false,setScissorTest(){},setViewport(){},setScissor(){}};
 const f=new ClipmapWaterField(r,undefined,{nearCells:8}),items=[{position:[0,0,0],radius:.2,volume:.01}],bounds={min:[-3,-1,-3],max:[3,2,3]};f.emptySpace=false;f.update(items,.3,bounds);assert.ok(f.useClipmap);assert.ok(f.stats.allocatedTexels<f.stats.referenceTexels);assert.equal(f.reference.target,null);
 f.update(items,.3,bounds);assert.equal(f.atlas.texture.image.width,f.atlas.width);assert.equal(f.atlas.texture.image.height,f.atlas.height);assert.notEqual(f.atlas.texture.source,f.coarse.target.texture.source);
 const nearTarget=f.near.target,atlas=f.atlas;for(let i=0;i<30;i++){f.setView([i*.31,.11,-i*.13]);assert.equal(f.near.target,nearTarget);assert.equal(f.atlas,atlas);}
 f.setView([0,0,0],false);assert.equal(f.useClipmap,false);assert.equal(f.coarse.target,null);assert.equal(f.near.target,null);assert.equal(f.atlas,null);assert.ok(f.reference.target);
 f.setView([0,0,0],true);assert.ok(f.useClipmap);assert.equal(f.reference.target,null);f.update(items,.3,{min:[-.4,-.4,-.4],max:[.4,.4,.4]});assert.equal(f.useClipmap,false);assert.equal(f.coarse.target,null);f.dispose();
});
