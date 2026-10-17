import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';

const fragment=`precision highp float;precision highp int;
uniform sampler2D uPosition,uVelocity,uChemistry,uMetric,uActivity;uniform int uHeight;out vec4 result;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);int layer=p.y/uHeight;p.y%=uHeight;
 if(layer==0)result=texelFetch(uPosition,p,0);else if(layer==1)result=texelFetch(uVelocity,p,0);
 else if(layer==2)result=texelFetch(uChemistry,p,0);else if(layer==3)result=texelFetch(uMetric,p,0);else result=texelFetch(uActivity,p,0);
}`;
// Dispatch both solvers before the CPU waits. One packed transfer replaces
// five separate readPixels calls; two reusable buffers keep prior views valid
// through the following step. Physics still advances synchronously in order.
export class StepReadback {
 constructor(renderer){
  this.renderer=renderer;this.u={uHeight:{value:0}};
  for(const key of ['uPosition','uVelocity','uChemistry','uMetric','uActivity'])this.u[key]={value:null};
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.u,depthTest:false,depthWrite:false});
  this.geometry=new THREE.PlaneGeometry(2,2);this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();this.cursor=0;
 }
 read(gpu,transport,n){
  const height=gpu.height,stride=64*height*4;
  if(this.height!==height){this.height=height;this.target?.dispose();this.target=new THREE.WebGLRenderTarget(64,height*5,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});this.buffers=[new Float32Array(stride*5),new Float32Array(stride*5)];}
  const r=this.renderer,prior=r.getRenderTarget(),data=this.buffers[this.cursor++%2];
  this.u.uHeight.value=height;this.u.uPosition.value=gpu.resultTexture;
  ['uVelocity','uChemistry','uMetric','uActivity'].forEach((key,i)=>this.u[key].value=transport.target.textures[i]);
  r.setRenderTarget(this.target);r.render(this.scene,this.camera);
  const start=performance.now();r.readRenderTargetPixels(this.target,0,0,64,height*5,data);this.waitMs=performance.now()-start;
  r.setRenderTarget(prior);this.bytes=data.byteLength;this.calls=1;
  return {positions:data.subarray(0,n*4),transport:transport.unpack(n,[1,2,3,4].map(i=>data.subarray(i*stride,i*stride+n*4)),true)};
 }
 dispose(){this.target?.dispose();this.material.dispose();this.geometry.dispose();}
}
