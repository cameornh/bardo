import * as THREE from 'three';
import * as before from './fixtures/water-detail-2026-10-24-before.js';
import * as after from '../src/sand-lab/adaptive-water-detail.js';
import {LabWaterField,LAB_FIELD_GLSL} from '../src/sand-lab/water-lab-field.js';
import {waterFixture} from './sand-adaptive-fixture.js';
import {QUAD_VERTEX} from '../src/shaders.js';
import {requestLabContext,installGraphicsGuard} from '../src/sand-lab/graphics-health.js';
const result=document.querySelector('#result'),W=128,H=80;
function material(api,field){return new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,depthTest:false,depthWrite:false,uniforms:{...field.u,uSpacing:{value:.2},uProjection:{value:new THREE.Matrix4()},uResolution:{value:new THREE.Vector2(960,640)},uDetailMotion:{value:1},uDistanceDetail:{value:true}},fragmentShader:`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;
 uniform float uSpacing;uniform mat4 uProjection;uniform vec2 uResolution;int reads=0;
 ${LAB_FIELD_GLSL.replace('vec4 parcelSample(vec3 p){','vec4 parcelSample(vec3 p){reads++;')}
 float rho(vec3 p){return parcelSample(p).x;}
 ${api.DISTANCE_DETAIL_GLSL}${api.WATER_SURFACE_SEARCH_GLSL}${api.WATER_COLUMN_GLSL}
 void main(){vec3 eye=vec3(1.2,6.2,4.8),forward=normalize(vec3(0,-5,-3.6)),right=vec3(1,0,0),up=cross(right,forward),ray=normalize(forward+right*(vUv.x-.5)*.76+up*(vUv.y-.5)*.475);
 // Conservative front bounds approximate the production Gaussian front pass.
 vec3 a=(vec3(-.4)-eye)/ray,b=(vec3(2.8)-eye)/ray,lo=min(a,b),hi=max(a,b);float begin=max(0.,max(lo.x,max(lo.y,lo.z))-.2),end=min(16.,min(hi.x,min(hi.y,hi.z)));
 float t=traceWater(eye,ray,begin,end,true);vec3 color=vec3(.14,.17,.19);
 if(t<9999.){vec3 p=eye+ray*t;float e=.09;vec3 n=-normalize(vec3(rho(p+vec3(e,0,0))-rho(p-vec3(e,0,0)),rho(p+vec3(0,e,0))-rho(p-vec3(0,e,0)),rho(p+vec3(0,0,e))-rho(p-vec3(0,0,e))));
  vec4 column=waterColumn(p,ray,t);vec3 tr=exp(-vec3(.8,.35,.15)*column.w);color=mix(vec3(.025,.20,.32),vec3(.35,.65,.8),max(0.,n.y))*(1.-tr*.3);color+=pow(max(0.,dot(n,normalize(vec3(.3,1,.4)))),24.)*.15;
 }outColor=vec4(color,float(reads)*(t<9999.?1.:-1.));}`});}
function display(a,b){const canvas=document.querySelector('#comparison'),ctx=canvas.getContext('2d'),image=ctx.createImageData(512,160);for(let y=0;y<160;y++)for(let x=0;x<512;x++){const source=x<256?a:b,o=((H-1-Math.floor(y/2))*W+Math.floor((x%256)/2))*4,d=(y*512+x)*4;for(let k=0;k<3;k++)image.data[d+k]=Math.round(255*Math.pow(Math.max(0,source[o+k]),1/2.2));image.data[d+3]=255;}ctx.putImageData(image,0,0);}
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;let renderer,field,gl,disposing=false;const resources=[];
 try{
  gl=requestLabContext(document.querySelector('#gpu'));renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#gpu'),context:gl,antialias:false});installGraphicsGuard(renderer,error=>{if(!disposing)result.textContent=error.message;});
  field=new LabWaterField(renderer);if(field.cpu)throw Error('Floating-point targets unavailable; not starting a fallback scene.');
  const fixture=waterFixture(),bounds={min:[-.4,-.4,-.4],max:[2.8,2.8,2.8]};field.emptySpace=true;field.update(fixture.items,.2,bounds);
  const l=field.layout,initial=new Float32Array(l.width*l.height*4),restored=new Float32Array(initial.length);await renderer.readRenderTargetPixelsAsync(field.target,0,0,l.width,l.height,initial);
  const compressor=new after.InteriorWaterCompression();let compact;for(let i=0;i<12;i++)compact=compressor.update(fixture.items,fixture.lab,.1);
  const originalTexture=field.centers;field.update(compact,.2,bounds);field.update(fixture.items,.2,bounds);await renderer.readRenderTargetPixelsAsync(field.target,0,0,l.width,l.height,restored);
  let fieldRestoreError=0;for(let i=0;i<initial.length;i++)fieldRestoreError=Math.max(fieldRestoreError,Math.abs(initial[i]-restored[i]));const textureReused=originalTexture===field.centers;
  const geometry=new THREE.PlaneGeometry(2,2),camera=new THREE.Camera(),target=new THREE.WebGLRenderTarget(W,H,{type:THREE.FloatType,depthBuffer:false}),half=new THREE.WebGLRenderTarget(W,H,{type:THREE.HalfFloatType,depthBuffer:false});resources.push(geometry,target,half);
  const scenes=[before,after].map(api=>{const m=material(api,field),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,m));resources.push(m);return scene;});
  const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),rows=[[],[]],outputs=[];
  // Interleave six tiny draws each after one warm-up. Never queue an unbounded
  // animation or start the expensive object-lighting programs.
  for(let round=0;round<7;round++)for(const k of round%2?[1,0]:[0,1]){
   const query=ext?gl.createQuery():null;if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
   const start=performance.now();renderer.setRenderTarget(target);renderer.render(scenes[k],camera);if(query)gl.endQuery(ext.TIME_ELAPSED_EXT);
   const data=new Float32Array(W*H*4);await renderer.readRenderTargetPixelsAsync(target,0,0,W,H,data);outputs[k]=data;
   let gpuMs=null;if(query){if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(ext.GPU_DISJOINT_EXT))gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)*1e-6;gl.deleteQuery(query);}
   if(round)rows[k].push({completedMs:performance.now()-start,gpuMs});
  }
  renderer.setRenderTarget(half);renderer.render(scenes[1],camera);const halfData=new Uint16Array(W*H*4);await renderer.readRenderTargetPixelsAsync(half,0,0,W,H,halfData);
  let meanColorError=0,maxColorError=0,halfColorError=0,reads=[0,0],nonFinite=0,edgeMaskChanges=0;
  for(let i=0;i<W*H;i++){
   for(let k=0;k<3;k++){const o=i*4+k,delta=Math.abs(outputs[0][o]-outputs[1][o]);meanColorError+=delta;maxColorError=Math.max(maxColorError,delta);halfColorError=Math.max(halfColorError,Math.abs(THREE.DataUtils.fromHalfFloat(halfData[o])-outputs[1][o]));if(!Number.isFinite(outputs[1][o]))nonFinite++;}
   if((outputs[0][i*4+3]>0)!==(outputs[1][i*4+3]>0))edgeMaskChanges++;
   for(let k=0;k<2;k++)reads[k]+=Math.abs(outputs[k][i*4+3]);
  }
  meanColorError/=W*H*3;display(...outputs);
  const median=values=>{const v=values.filter(x=>x!==null).sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;};
  result.textContent=JSON.stringify({scope:'Same bounded field and pixel count; query counts and optional GPU time, not full-scene FPS',pixels:W*H,meanFieldReads:{before:reads[0]/(W*H),after:reads[1]/(W*H)},fieldReadReduction:1-reads[1]/reads[0],medianGpuMs:rows.map(r=>median(r.map(x=>x.gpuMs))),medianDrawAndReadbackMs:rows.map(r=>median(r.map(x=>x.completedMs))),meanColorError,maxColorError,halfColorError,edgeMaskChanges,fieldRestoreError,textureReused,nonFinite,pass:fieldRestoreError<.0001&&textureReused&&meanColorError<.005&&halfColorError<.001&&!nonFinite&&edgeMaskChanges/(W*H)<.002&&reads[1]<reads[0]*.8},null,2);
 }catch(error){result.textContent=error.stack;}
 finally{disposing=true;for(const r of resources)r.dispose();field?.dispose();renderer?.dispose();gl?.getExtension('WEBGL_lose_context')?.loseContext();}
};
