import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {footprintOccluded,installParticleVisibility} from '../src/rtx-sand-lab/particle-visibility.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {LiveWaterRenderer} from '../src/rtx-sand-lab/live-renderer.js';
import {DETAIL_VERTEX} from '../src/sand-lab/water-lab-detail-renderer.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';

test('opaque-depth footprints are conservative at silhouettes and odd-sized image borders',()=>{
 const width=119,height=73,depth=new Float32Array(width*height);let seed=45;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(let i=0;i<depth.length;i++)depth[i]=rand()<.08?10000:2+rand()*3;

 let rejected=0;
 for(let i=0;i<10000;i++){
  const low=[rand()*.95,rand()*.95],high=low.map(v=>Math.min(1,v+rand()*.015)),d=3+rand()*10001;
  if(!footprintOccluded(depth,width,height,low,high,d))continue;rejected++;
  for(let y=Math.max(0,Math.floor(low[1]*height)-1);y<=Math.min(height-1,Math.floor(high[1]*height)+1);y++)for(let x=Math.max(0,Math.floor(low[0]*width)-1);x<=Math.min(width-1,Math.floor(high[0]*width)+1);x++)assert.ok(d>depth[y*width+x]);
 }
 assert.ok(rejected>0);
 assert.equal(footprintOccluded(new Float32Array([NaN,Infinity,0,7]),2,2,[0,0],[1,1],1e6),false);
 assert.equal(footprintOccluded(depth,width,height,[0,0],[1,1],1e6),false,'Large kernels fall back to exact per-pixel clipping');
});
test('live particle optimization is explicit, keeps SH/covariance and warms every new pass',()=>{
 const renderer={extensions:{has:()=>false,get:()=>null},getContext:()=>({getExtension:()=>null}),initRenderTarget(){},copyTextureToTexture(){},render(){assert.fail('Unexpected GPU work');}};
 const lab=new LiveSandLab(renderer),field={renderer,camera:new THREE.PerspectiveCamera(),uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}},draw=new LiveWaterRenderer(field,lab);
 assert.equal(draw.detailRenderer.material.vertexShader,DETAIL_VERTEX);
 const v=installParticleVisibility(draw),s=v.grain.drawMaterial.vertexShader;
 assert.match(s,/uParticleGrainSky/);assert.match(s,/parcelSample/);assert.match(s,/xx\*yy-xy\*xy/);
 assert.match(v.foam.draw.vertexShader,/if\(visible.a<0/);assert.doesNotMatch(v.foam.draw.fragmentShader,/exp\(-vViewTau|dot\(vViewTau/);
 assert.ok(s.indexOf('particleHidden(center')<s.indexOf('vec3 ambient=uParticleGrainSky'));
 const jobs=firstFrameShaderJobs(draw);for(const name of ['visible sand grains'])assert.ok(jobs.some(j=>j.name===name));
 v.enabled=false;v.select();assert.equal(draw.detailRenderer.material.vertexShader,DETAIL_VERTEX);
 assert.equal(installParticleVisibility(draw),v);
});

test('cached sky irradiance matches the original directional SH sum at every degree',async()=>{
 const {updateParticleSky}=await import('../src/rtx-sand-lab/particle-visibility.js');
 const {shBasis}=await import('../src/sh.js');
 const basis=shBasis([0,1,0]);
 for(let degree=0;degree<=3;degree++)for(let example=0;example<40;example++){
  const sh=Array.from({length:16},(_,i)=>new THREE.Vector3(Math.sin(i+example),Math.cos(i*.8-example),Math.sin(i*.3+example*.4)));
  const ambient=example*.037,source={uSH:{value:sh},uSHDegree:{value:degree},uAmbient:{value:ambient}},destination={uParticleUpSky:{value:new THREE.Vector3()},uParticleGrainSky:{value:new THREE.Vector3()}};
  updateParticleSky(source,destination);
  const sum=new THREE.Vector3();for(let i=0;i<(degree+1)**2;i++)sum.addScaledVector(sh[i],basis[i]*(i===0?1:i<4?2/3:i<9?.25:0));
  const grain=sum.clone().multiplyScalar(.7).addScaledVector(sh[0],.282095*.3).max(new THREE.Vector3()).multiplyScalar(ambient);
  assert.ok(destination.uParticleGrainSky.value.distanceTo(grain)<1e-12);
  assert.ok(destination.uParticleUpSky.value.distanceTo(sum.max(new THREE.Vector3()).multiplyScalar(ambient))<1e-12);
 }
});
