import * as THREE from 'three';
import {floatTexture} from './uniforms.js';
import {QUAD_VERTEX} from '../shaders.js';
import {SAND_AIR_GLSL,sandAirVelocity} from './sand-air.js';
export function verifySandAir(renderer){
 const lab={spec:{scale:10},time:2,wind:40,windTurbulence:1,windStrength:180,radius:.15,jet:{origin:[0,2,0],direction:[0,-1,0]}},normal=new THREE.Vector3(0,1,-.48).normalize().toArray(),brush={point:[0,0,0],normal,distance:2,radius:.15},solid=p=>(p[1]-.48*p[2])*.65;
 const data=new Float32Array(128*4);for(let i=0;i<128;i++){const x=(i%16-7.5)*.028,z=(Math.floor(i/16)-3.5)*.041;data.set([x,.48*z+.04+(i%3)*.025,z,1],i*4);}
 const texture=floatTexture(data,128,1),target=new THREE.WebGLRenderTarget(128,1,{type:THREE.FloatType,depthBuffer:false}),uniforms={probe:{value:texture},uAirTime:{value:lab.time},uAirScale:{value:10},uAirSpeed:{value:40},uAirTurbulence:{value:1},uAirJetStrength:{value:180},uAirRadius:{value:.15},uAirJetOrigin:{value:new THREE.Vector3(0,2,0)},uAirJetDirection:{value:new THREE.Vector3(0,-1,0)},uSandBrushPoint:{value:new THREE.Vector3()},uSandBrushNormal:{value:new THREE.Vector3(...normal)},uSandBrushDistance:{value:2}};
 const geometry=new THREE.PlaneGeometry(2,2),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;precision highp int;uniform sampler2D probe;out vec4 color;float labPhysicalSolid(vec3 p){return (p.y-.48*p.z)*.65;}${SAND_AIR_GLSL}void main(){color=vec4(sandAir(texelFetch(probe,ivec2(gl_FragCoord.xy),0).xyz),1);}`,uniforms,depthTest:false,depthWrite:false}),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));const previous=renderer.getRenderTarget(),result=data.slice();
 try{renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());renderer.readRenderTargetPixels(target,0,0,128,1,result);let maxError=0;for(let i=0;i<128;i++){const expected=sandAirVelocity(Array.from(data.subarray(i*4,i*4+3)),lab,solid,brush);for(let k=0;k<3;k++)maxError=Math.max(maxError,Math.abs(expected[k]-result[i*4+k]));}return {samples:128,maxError,pass:maxError<.002};}
 finally{renderer.setRenderTarget(previous);for(const x of [texture,target,geometry,material])x.dispose();}
}
