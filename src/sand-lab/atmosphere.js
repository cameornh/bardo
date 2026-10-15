import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {projectSH} from '../sh.js';
import {ATMOSPHERE_GLSL,atmosphereSky,DEFAULT_SUN} from './atmosphere-model.js';

function directionAt(x,y,w,h){const az=((x+.5)/w-.5)*2*Math.PI,v=(y+.5)/h*2-1,elevation=Math.sign(v)*v*v*Math.PI*.5;return [Math.cos(elevation)*Math.sin(az),Math.sin(elevation),Math.cos(elevation)*Math.cos(az)];}
const fragment=`precision highp float;in vec2 vUv;out vec4 outColor;uniform vec3 uAtmosphereSun;${ATMOSPHERE_GLSL}
void main(){float az=(vUv.x-.5)*6.283185307,v=vUv.y*2.-1.,el=sign(v)*v*v*1.570796327;vec3 d=vec3(cos(el)*sin(az),sin(el),cos(el)*cos(az));outColor=vec4(atmosphereSky(d,uAtmosphereSun),1);}`;
export class BeachAtmosphere{
 constructor(renderer){
  this.renderer=renderer;this.supported=renderer.extensions.has('EXT_color_buffer_float');this.cpu=!this.supported;
  const filter=renderer.extensions.has('OES_texture_float_linear')?THREE.LinearFilter:THREE.NearestFilter;
  this.target=new THREE.WebGLRenderTarget(192,96,{type:THREE.FloatType,depthBuffer:false,minFilter:filter,magFilter:filter,wrapS:THREE.RepeatWrapping});
  this.fallback=new THREE.DataTexture(new Float32Array(48*24*4),48,24,THREE.RGBAFormat,THREE.FloatType);this.fallback.minFilter=this.fallback.magFilter=filter;this.fallback.wrapS=THREE.RepeatWrapping;
  this.u={uAtmosphere:{value:this.target.texture}};this.uniforms={uAtmosphereSun:{value:new THREE.Vector3(...DEFAULT_SUN)}};
  this.geometry=new THREE.PlaneGeometry(2,2);this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.uniforms,depthTest:false,depthWrite:false});this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();this.revision=0;
 }
 update(lab,sh){
  this.cpu=lab.gpu.cpu||!this.supported;const sun=lab.u.uSolarDirection.value.toArray(),key=`${Math.round(lab.day*50)}:${this.cpu}`;if(key===this.key)return false;this.key=key;this.uniforms.uAtmosphereSun.value.fromArray(sun);
  if(this.cpu){const {data,width,height}=this.fallback.image;for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...atmosphereSky(directionAt(x,y,width,height),sun),1],(y*width+x)*4);this.fallback.needsUpdate=true;this.u.uAtmosphere.value=this.fallback;}
  else{const old=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(old);this.u.uAtmosphere.value=this.target.texture;}
  // Only 64 directions on the CPU, when solar angle changes. No GPU readback
  // or atmosphere march in the main water / foam / reflection passes.
  const coeff=projectSH(d=>atmosphereSky(d,sun));sh.forEach((v,i)=>v.fromArray(coeff,i*3));this.revision++;
  const samples=new Map();lab.skyRadiance=d=>{const key=d.join(',');if(!samples.has(key))samples.set(key,atmosphereSky(d,sun));return samples.get(key);};return true;
 }
 verify(){
  if(!this.supported)return {backend:'CPU fallback',pass:null,reason:'Float render targets unavailable'};
  const directions=[[0,1,0],[1,.001,0],[-1,.03,0],[0,.15,1],[.8,.5,.3],[0,-1,0]],suns=[[1,.7,.2],[-1,.03,.1],[1,-.14,0]].map(d=>d.map(v=>v/Math.hypot(...d)));
  const rays=directions.map(d=>new THREE.Vector3(...d).normalize()),stars=suns.map(d=>new THREE.Vector3(...d)),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 outColor;uniform vec3 uRays[6],uStars[3];${ATMOSPHERE_GLSL}void main(){outColor=vec4(atmosphereSky(uRays[int(gl_FragCoord.x)],uStars[int(gl_FragCoord.y)]),1);}`,uniforms:{uRays:{value:rays},uStars:{value:stars}},depthTest:false,depthWrite:false}),scene=new THREE.Scene(),target=new THREE.WebGLRenderTarget(6,3,{type:THREE.FloatType,depthBuffer:false});scene.add(new THREE.Mesh(this.geometry,material));const data=new Float32Array(6*3*4),old=this.renderer.getRenderTarget();
  try{this.renderer.setRenderTarget(target);this.renderer.render(scene,this.camera);this.renderer.readRenderTargetPixels(target,0,0,6,3,data);}finally{this.renderer.setRenderTarget(old);target.dispose();material.dispose();}
  let error=0;for(let y=0;y<3;y++)for(let x=0;x<6;x++){const reference=atmosphereSky(rays[x].toArray(),suns[y]);for(let k=0;k<3;k++)error=Math.max(error,Math.abs(data[(y*6+x)*4+k]-reference[k]));}
  return {backend:'GPU',samples:18,maxRadianceError:error,tolerance:.0001,pass:Number.isFinite(error)&&error<.0001};
 }
 dispose(){for(const resource of [this.target,this.fallback,this.geometry,this.material])resource.dispose();}
}
