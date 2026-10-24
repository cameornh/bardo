import * as THREE from 'three';
import {QUAD_VERTEX} from '../src/shaders.js';
import {DISTANCE_DETAIL_GLSL,WATER_SURFACE_SEARCH_GLSL,WATER_COLUMN_GLSL,traceDensityInterval,smooth} from '../src/sand-lab/adaptive-water-detail.js';
// Compile only the new distance/entry/exit routines against a simple slab,
// never the full scene's lighting shaders. Sixty-four one-pixel camera views.
export async function checkAdaptiveSearch(renderer){
 const fragment=`precision highp float;out vec4 outColor;
 uniform float uSpacing;uniform vec2 uResolution;uniform mat4 uProjection;
 const float PARCEL_ISO=.18;
 float rho(vec3 p){return smoothstep(-.1,.1,p.y)*(1.-smoothstep(.9,1.1,p.y));}
 vec4 parcelSample(vec3 p){return rho(p)*vec4(1.,.2,.1,.03);}
 float fieldEmptyAdvance(vec3 p,vec3 d,float iso){return 0.;}
 ${DISTANCE_DETAIL_GLSL}${WATER_SURFACE_SEARCH_GLSL}${WATER_COLUMN_GLSL}
 void main(){vec3 eye=vec3(0,3.+(gl_FragCoord.x-.5)*.15,0),ray=vec3(0,-1,0);float t=traceWater(eye,ray,0.,20.,true);vec4 column=waterColumn(eye+ray*t,ray,t);outColor=vec4(t,column.w,column.x,1.);}`;
 const target=new THREE.WebGLRenderTarget(64,1,{type:THREE.FloatType,depthBuffer:false}),geometry=new THREE.PlaneGeometry(2,2),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:{uSpacing:{value:.2},uResolution:{value:new THREE.Vector2(960,640)},uProjection:{value:new THREE.Matrix4()},uDetailMotion:{value:3},uDistanceDetail:{value:true}},depthTest:false,depthWrite:false}),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));
 try{
  renderer.setRenderTarget(target);renderer.render(scene,new THREE.Camera());const data=new Float32Array(64*4);await renderer.readRenderTargetPixelsAsync(target,0,0,64,1,data);
  let maximumEntryError=0,maximumThicknessError=0,maximumSoluteError=0,nonFinite=0;
  for(let i=0;i<64;i++){const ref=traceDensityInterval(p=>smooth(-.1,.1,p[1])*(1-smooth(.9,1.1,p[1])),[0,3+i*.15,0],[0,-1,0],{spacing:.2,motion:3,limit:20});
   maximumEntryError=Math.max(maximumEntryError,Math.abs(data[i*4]-ref.entry));maximumThicknessError=Math.max(maximumThicknessError,Math.abs(data[i*4+1]-(ref.exit-ref.entry)));maximumSoluteError=Math.max(maximumSoluteError,Math.abs(data[i*4+2]-.2));
   for(let k=0;k<4;k++)if(!Number.isFinite(data[i*4+k]))nonFinite++;
  }
  return {maximumEntryError,maximumThicknessError,maximumSoluteError,nonFinite,pass:maximumEntryError<.0005&&maximumThicknessError<.001&&maximumSoluteError<1e-5&&!nonFinite};
 }finally{target.dispose();geometry.dispose();material.dispose();}
}
