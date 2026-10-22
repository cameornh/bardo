import * as THREE from 'three';
import {QUAD_VERTEX} from '../src/shaders.js';
import {SAND_SHADOW_GLSL,sandVisibility} from '../src/sand-lab/surface-shadow.js';

export function verifySandShadows(renderer){
 const cases=[];
 for(let i=0;i<64;i++){
  const center=[-.4+i*.012,1.5+i*.004,.1],direction=[0,1,0];
  for(const offset of [[0,.31,0],[0,-.6,0],[.6,-.6,0],[.295+i*.0003,-.6,0]])cases.push({center,direction,origin:center.map((v,k)=>v+offset[k])});
 }
 const min=[-1,-1,-1],max=[2,4,2],data=new Float32Array(cases.length*12);
 cases.forEach((c,i)=>{data.set(c.origin,i*12);data.set(c.direction,i*12+4);data.set(c.center,i*12+8);});
 const texture=new THREE.DataTexture(data,3,cases.length,THREE.RGBAFormat,THREE.FloatType);texture.needsUpdate=true;
 const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,depthTest:false,depthWrite:false,uniforms:{uProbes:{value:texture},uSandMin:{value:new THREE.Vector3(...min)},uSandMax:{value:new THREE.Vector3(...max)}},fragmentShader:`precision highp float;precision highp int;
 uniform sampler2D uProbes;uniform vec3 uSandMin,uSandMax;const int uSandCount=1;const bool uMediumShadows=true;vec3 center;
 float sandDistance(vec3 p){return length(p-center)-.3;}
 ${SAND_SHADOW_GLSL}
 out vec4 color;void main(){int i=int(gl_FragCoord.x);center=texelFetch(uProbes,ivec2(2,i),0).xyz;float visibility=sandVisibility(texelFetch(uProbes,ivec2(0,i),0).xyz,texelFetch(uProbes,ivec2(1,i),0).xyz);color=vec4(visibility,0,0,1);}`});
 const geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));
 const target=new THREE.WebGLRenderTarget(cases.length,1,{type:THREE.FloatType,depthBuffer:false}),old=renderer.getRenderTarget();
 try{
  renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());const pixels=new Float32Array(cases.length*4);renderer.readRenderTargetPixels(target,0,0,cases.length,1,pixels);
  let maxError=0,blocked=0,clear=0;
  cases.forEach((c,i)=>{const reference=sandVisibility(c.origin,c.direction,{min,max,distance:p=>Math.hypot(...p.map((v,k)=>v-c.center[k]))-.3});maxError=Math.max(maxError,Math.abs(reference-pixels[i*4]));if(pixels[i*4]===0)blocked++;if(pixels[i*4]===1)clear++;});
  return {pass:maxError<.0001&&blocked>=64&&clear>=128,cases:cases.length,maxError,blocked,clear};
 }finally{renderer.setRenderTarget(old);for(const x of [texture,material,geometry,target])x.dispose();}
}
