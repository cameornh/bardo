import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {replaceShaderFunction} from './deferred-optics.js';

export function sprayAtlasUV(uv,layer,size){
 const tile=Math.floor(layer/4),clamp=x=>Math.max(.5/size,Math.min(1-.5/size,x));
 return [(tile%2+clamp(uv[0]))*.5,(Math.floor(tile/2)+clamp(uv[1]))*.5];
}

// Same sixteen deep-opacity layers, one sampler instead of four. Clamp to
// texel centers before moving into the atlas, so bilinear filtering cannot
// bleed across tiles. No mipmaps or quantization beyond the original RGBA16F.
export function compactSpraySampling(source){
 if(!source.includes('float sprayDepthAt(')||source.includes('uniform highp sampler2D uSprayAtlas;'))return source;
 return replaceShaderFunction(source,'sprayDepthAt',`uniform highp sampler2D uSprayAtlas;
 float sprayDepthAt(vec2 uv,int layer){
  vec2 size=vec2(textureSize(uSprayAtlas,0))*.5;
  vec2 tile=vec2(float((layer/4)%2),float(layer/8));
  vec4 a=textureLod(uSprayAtlas,(tile+clamp(uv,.5/size,1.-.5/size))*.5,0.);
  return a[layer%4];
 }`);
}

export class SprayShadowAtlas {
 constructor(renderer,shadows){
  this.renderer=renderer;this.shadows=shadows;
  this.target=new THREE.WebGLRenderTarget(shadows.size*2,shadows.size*2,{type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  this.u={uSprayAtlas:{value:this.target.texture}};
  this.geometry=new THREE.PlaneGeometry(2,2);this.camera=new THREE.Camera();
  this.material=new THREE.ShaderMaterial({name:'spray-shadow-atlas',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,depthTest:false,depthWrite:false,uniforms:shadows.u,
   fragmentShader:`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;
    uniform highp sampler2D uSprayShadow0,uSprayShadow1,uSprayShadow2,uSprayShadow3;
    void main(){ivec2 size=textureSize(uSprayShadow0,0),p=ivec2(gl_FragCoord.xy),tile=p/size,q=p%size;
     if(tile.y==0)outColor=tile.x==0?texelFetch(uSprayShadow0,q,0):texelFetch(uSprayShadow1,q,0);
     else outColor=tile.x==0?texelFetch(uSprayShadow2,q,0):texelFetch(uSprayShadow3,q,0);
    }`});
  this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));
 }
 update(){
  const r=this.renderer,previous=r.getRenderTarget();
  try{r.setRenderTarget(this.target);r.render(this.scene,this.camera);}finally{r.setRenderTarget(previous);}
 }
 install(material){
  for(const stage of ['vertexShader','fragmentShader'])if(material[stage]?.includes('float sprayDepthAt(')){
   material[stage]=compactSpraySampling(material[stage]);Object.assign(material.uniforms,this.u);material.needsUpdate=true;
  }
 }
 dispose(){this.target.dispose();this.material.dispose();this.geometry.dispose();}
}
