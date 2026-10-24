import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {LAB_GEOMETRY_GLSL,NEIGHBORS} from './water-lab-model.js';
// Evaluate the identical air-exposure kernel and solid test for every emitter
// on the GPU, then include them in the existing batched simulation readback.
const fragment=`precision highp float;precision highp int;
uniform bool uPackedGpuNeighbors;uniform sampler2D uEmitterPosition,uEmitterMetric,uEmitterNeighbors;uniform int uEmitterCount;uniform float uEmitterSpacing;out vec4 result;
${LAB_GEOMETRY_GLSL}
float contribution(vec3 p,int i){vec3 delta=p-texelFetch(uEmitterPosition,ivec2(i%64,i/64),0).xyz;float q=max(0.,1.-dot(delta,delta)/(4.*uEmitterSpacing*uEmitterSpacing));return 315./(512.*3.141592653589793)*q*q*q;}
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int i=uv.x+uv.y*64;result=vec4(0);if(i>=uEmitterCount)return;vec4 source=texelFetch(uEmitterPosition,uv,0),metric=texelFetch(uEmitterMetric,uv,0);vec3 p=source.xyz+metric.xyz*uEmitterSpacing*.8;
result.y=labSolid(p);if(source.w>.5||result.y<uEmitterSpacing*.08)return;
float density=contribution(p,i);for(int k=0;k<${NEIGHBORS};k++){int j=uPackedGpuNeighbors?int(texelFetch(uEmitterNeighbors,ivec2(i%64+(k/32)*64,(i/64)*8+(k%32)/4),0)[k%4]):int(texelFetch(uEmitterNeighbors,ivec2(k+(i%4)*128,i/4),0).r);if(j<0)break;density+=contribution(p,j);}float t=clamp((density-.22)/.28,0.,1.);result.x=1.-t*t*(3.-2.*t);
}`;
export class EmitterProbes {
 constructor(renderer,geometry){this.renderer=renderer;this.u={...geometry,uPackedGpuNeighbors:{value:false},uEmitterPosition:{value:null},uEmitterMetric:{value:null},uEmitterNeighbors:{value:null},uEmitterCount:{value:0},uEmitterSpacing:{value:1}};this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.u,depthTest:false,depthWrite:false});this.material.userData.skipObjectWarmup=true;this.geometry=new THREE.PlaneGeometry(2,2);this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();}
 update(gpu,transport,n,s){if(gpu.cpu||gpu.cpuContacts)return null;const h=Math.ceil(n/64);if(!this.target)this.target=new THREE.WebGLRenderTarget(64,h,{type:THREE.FloatType,depthBuffer:false});else if(this.target.height!==h)this.target.setSize(64,h);const u=this.u;u.uPackedGpuNeighbors.value=gpu.uniforms.uPackedGpuNeighbors.value;u.uEmitterPosition.value=gpu.resultTexture;u.uEmitterMetric.value=transport.target.textures[2];u.uEmitterNeighbors.value=gpu.neighborTexture;u.uEmitterCount.value=n;u.uEmitterSpacing.value=s;const old=this.renderer.getRenderTarget();this.renderer.setRenderTarget(this.target);this.renderer.render(this.scene,this.camera);this.renderer.setRenderTarget(old);return this.target.texture;}
 dispose(){for(const r of [this.target,this.material,this.geometry])r?.dispose();}
}
