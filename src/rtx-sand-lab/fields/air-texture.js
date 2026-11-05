import * as THREE from 'three';
import {QUAD_VERTEX} from '../../shaders.js';
// Reuse the established air atlas layout for GPU spray/grains/rain. This is a
// resampling pass only; the projected field also drives CPU physics sampling.
export class AirFieldTexture {
 constructor(renderer,air){this.renderer=renderer;this.air=air;this.u={...air.u,uSource:{value:null},uDims:{value:new THREE.Vector3()},uOrigin:{value:new THREE.Vector3()},uH:{value:1},uScale:{value:1}};
  this.material=new THREE.ShaderMaterial({name:'live-projected-air-resample',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;precision highp int;uniform sampler2D uSource;uniform vec3 uDims,uOrigin,uAirMin,uAirExtent;uniform float uH,uScale;out vec4 result;
 vec3 node(ivec3 c){c=clamp(c,ivec3(0),ivec3(uDims)-1);int i=c.x+int(uDims.x)*(c.y+int(uDims.y)*c.z);return texelFetch(uSource,ivec2(i%128,i/128),0).xyz;}
 void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec3 p=uAirMin+vec3(float(uv.x%32)/31.,float(uv.y)/23.,float(uv.x/32)/31.)*uAirExtent,q=(p*uScale-uOrigin)/uH-.5;ivec3 b=ivec3(floor(q));vec3 f=fract(q),v=vec3(0);for(int n=0;n<8;n++){ivec3 d=ivec3(n&1,(n>>1)&1,(n>>2)&1);vec3 w=mix(1.-f,f,vec3(d));v+=node(b+d)*w.x*w.y*w.z;}result=vec4(v/uScale,1);}`,uniforms:this.u,depthTest:false,depthWrite:false});this.geometry=new THREE.PlaneGeometry(2,2);this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();
 }
 update(grid,scale){
  const height=Math.ceil(grid.count/128);if(this.texture?.image.height!==height){this.texture?.dispose();this.texture=new THREE.DataTexture(new Float32Array(128*height*4),128,height,THREE.RGBAFormat,THREE.FloatType);}
  const data=this.texture.image.data;for(let i=0;i<grid.count;i++){const v=grid.phase[i]===2?grid.centerVelocity(i):[0,0,0];data.set([...v,0],i*4);}this.texture.needsUpdate=true;
  this.u.uSource.value=this.texture;this.u.uDims.value.fromArray(grid.dims);this.u.uOrigin.value.fromArray(grid.origin);this.u.uH.value=grid.h;this.u.uScale.value=scale;
  this.air.u.uAirMin.value.fromArray(grid.origin.map(v=>v/scale));this.air.u.uAirExtent.value.fromArray(grid.dims.map(n=>n*grid.h/scale));this.air.u.uAirEnabled.value=true;
  const old=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.air.target);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(old);
 }
 dispose(){this.texture?.dispose();this.geometry.dispose();this.material.dispose();}
}
