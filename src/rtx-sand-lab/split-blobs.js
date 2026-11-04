import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';
import {CLIPMAP_FIELD_GLSL} from './clipmap-water.js';
import {BLOB_DENSITY_GLSL} from '../sand-lab/water-lab-blob-renderer.js';
import {BLOB_LIGHTING_GLSL} from './blob-lighting.js';

function functionSource(source,name){
 const start=source.search(new RegExp('\\b(?:float|vec[234]) '+name+'\\('));
 if(start<0)throw Error('Missing blob helper: '+name);
 const brace=source.indexOf('{',start);let end=brace+1,depth=1;
 for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
 return source.slice(start,end);
}

// Keep Gaussian tracing separate from lighting. The combined program failed
// driver compilation during playback; this keeps the nested-field sampler
// out of secondary reflection, contact and lighting paths altogether.
// The two float attachments retain the original normal, path, chemistry and
// depth. Small droplets reuse rendered scene colors for secondary rays.
export function splitBlobSources(source,fieldSource=CLIPMAP_FIELD_GLSL){
 const start=source.indexOf('out vec4 outColor;')+'out vec4 outColor;'.length;
 const end=source.indexOf('uniform sampler2D uBulkWater;');
 if(start<18||end<start)throw Error('Unexpected detached-water shader layout');
 const common=source.slice(start,end),main=source.slice(source.lastIndexOf('\nvoid main(){'));
 const output='outColor=vec4(shadeWater(p,n,ray,path,chemicals.xyz/max(.00001,chemicals.w)),t);';
 if(!main.includes(output))throw Error('Missing detached-water output');
 const ior=common.match(/const float WATER_IOR\s*=\s*[^;]+;/)?.[0];
 if(!ior)throw Error('Missing water refractive index');
 const trace=`precision highp float;precision highp int;
flat in vec4 vK[5],vA[2],vBound;flat in vec3 vChem;
layout(location=0)out vec4 normalPath;layout(location=1)out vec4 chemistryDepth;
${fieldSource}
uniform highp sampler2D uImage,uBulkWater;uniform bool uBlobDepth;
uniform vec3 uEye;uniform vec2 uResolution;uniform float uSpacing;
uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;
uniform int uBlobMarchLimit,uBlobColumnLimit;
${ior}
${['rayAt','rho','fluidGradient'].map(n=>functionSource(common,n)).join('\n')}
${BLOB_DENSITY_GLSL}
float joinedDensity(vec3 p){return blobSample(p).x+rho(p);}
${main.replace('i<192','i<uBlobMarchLimit').replace('i<256','i<uBlobColumnLimit').replace(output,'normalPath=vec4(n,path);chemistryDepth=vec4(chemicals.xyz/max(.00001,chemicals.w),t);')}`;
 const shade=`precision highp float;precision highp int;out vec4 outColor;
${BLOB_LIGHTING_GLSL}
uniform highp sampler2D uBlobNormalPath,uBlobChemistryDepth;
void main(){
 ivec2 pixel=ivec2(gl_FragCoord.xy);vec4 medium=texelFetch(uBlobChemistryDepth,pixel,0);
 if(medium.w<=0.)discard;
 vec4 surface=texelFetch(uBlobNormalPath,pixel,0);vec3 ray=rayAt(gl_FragCoord.xy/uResolution);
 outColor=vec4(shadeWater(uEye+ray*medium.w,surface.xyz,ray,surface.w,medium.xyz),medium.w);
}`;
 return {trace,shade};
}

export class SplitBlobPass {
 constructor(blob,fieldSource){
  this.blob=blob;const source=splitBlobSources(blob.material.fragmentShader,fieldSource);
  this.target=new THREE.WebGLRenderTarget(1,1,{count:2,type:THREE.FloatType,depthBuffer:true,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  Object.assign(blob.u,{uBlobMarchLimit:{value:192},uBlobColumnLimit:{value:256}});
  blob.material.fragmentShader=source.trace;blob.material.name='detached-water-trace';blob.material.needsUpdate=true;
  this.traceScene=blob.scene;
  this.material=new THREE.ShaderMaterial({name:'detached-water-shading',glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:source.shade,uniforms:{...blob.u,uBlobNormalPath:{value:this.target.textures[0]},uBlobChemistryDepth:{value:this.target.textures[1]}},depthTest:false,depthWrite:false});
  this.geometry=new THREE.PlaneGeometry(2,2);this.scene=new THREE.Scene();this.scene.add(new THREE.Mesh(this.geometry,this.material));this.camera=new THREE.Camera();
 }
 render(renderer,camera,submit){
  if(!this.blob.geometry.instanceCount)return;
  const output=renderer.getRenderTarget();
  if(this.target.width!==output.width||this.target.height!==output.height)this.target.setSize(output.width,output.height);
  try{renderer.setRenderTarget(this.target);renderer.clear();submit.call(renderer,this.traceScene,camera);renderer.setRenderTarget(output);submit.call(renderer,this.scene,this.camera);}
  finally{renderer.setRenderTarget(output);}
 }
 dispose(){this.target.dispose();this.geometry.dispose();this.material.dispose();}
}
