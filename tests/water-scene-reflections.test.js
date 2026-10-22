import test from 'node:test';
import assert from 'node:assert/strict';
import {waterSceneReflectionCPU} from '../src/water-lab-reflections.js';
const close=(a,b)=>a.forEach((v,k)=>assert.ok(Math.abs(v-b[k])<1e-10,`${a} != ${b}`));
const empty={spacing:.2,sky:d=>d,traceOpaque:()=>1e4,traceGlass:()=>({distance:1e4}),shadeOpaque:()=>{throw Error('unexpected opaque hit');}};
test('a level water surface reflects the scene to its inverted geometric position',()=>{
 const eye=[0,2,4],target=[0,3,-6],mirror=[0,-3,-6],delta=mirror.map((v,k)=>v-eye[k]),len=Math.hypot(...delta),ray=delta.map(v=>v/len),t=-eye[1]/ray[1],p=eye.map((v,k)=>v+ray[k]*t);
 const result=waterSceneReflectionCPU(p,[0,1,0],ray,{...empty,traceOpaque:(o,d)=>(target[1]-o[1])/d[1],shadeOpaque:(hit,view)=>{close(view,[0,-ray[1],ray[2]].map(v=>-v));return hit;}});
 close(result,[target[0],target[1],target[2]+.004]); // reflected origin's normal offset
});
test('wave normals change the reflection continuously; no wind or velocity threshold',()=>{
 let previous;
 for(let i=0;i<=100;i++){
  const angle=i*.001,n=[Math.sin(angle),Math.cos(angle),0];
  const color=waterSceneReflectionCPU([0,0,0],n,[0,-.6,-.8],empty);
  assert.ok(Math.abs(Math.hypot(...color)-1)<1e-12);
  if(previous)assert.ok(Math.hypot(...color.map((v,k)=>v-previous[k]))<.002);
  previous=color;
 }
 close(waterSceneReflectionCPU([0,0,0],[0,1,0],[0,-.6,-.8],empty),[0,.6,-.8]);
});
test('reflected glass is composed only when closer than the opaque receiver',()=>{
 const common={...empty,traceOpaque:()=>4,shadeOpaque:()=>[.8,.5,.3],shadeGlass:(_p,_n,_ray,b)=>b.map(x=>x*.9)};
 close(waterSceneReflectionCPU([0,0,0],[0,1,0],[0,-1,0],{...common,traceGlass:()=>({distance:2,normal:[0,-1,0]})}),[.72,.45,.27]);
 close(waterSceneReflectionCPU([0,0,0],[0,1,0],[0,-1,0],{...common,traceGlass:()=>({distance:5,normal:[0,-1,0]})}),[.8,.5,.3]);
});
test('the sky-only diagnostic bypasses scene tracing and the bias scales down for small volumes',()=>{
 const ray=[0,-1,0];
 close(waterSceneReflectionCPU([0,0,0],[0,1,0],ray,{...empty,enabled:false,traceOpaque:()=>{throw Error('trace on disabled path');}}),[0,1,0]);
 for(const [spacing,bias] of [[.0001,.00004],[.1,.001],[1,.003]])
  waterSceneReflectionCPU([0,0,0],[0,1,0],ray,{...empty,spacing,traceOpaque:o=>{assert.equal(o[1],bias);return 1e4;}});
});
