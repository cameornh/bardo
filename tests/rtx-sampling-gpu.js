import * as THREE from 'three';
import {createLabRenderer} from '../src/sand-lab/graphics-health.js';
import {installRTXGraphicsGuard} from '../src/rtx-sand-lab/graphics.js';
import {explicitTextureLevel} from '../src/rtx-sand-lab/shader-compatibility.js';

const vertex='in vec3 position;void main(){gl_Position=vec4(position,1.0);}';
const fragment=`precision highp float;uniform sampler2D uImage;out vec4 color;
void main(){vec2 uv=gl_FragCoord.xy/vec2(32.,16.);vec4 sum=vec4(0.);
 for(int i=0;i<4;i++){vec2 p=uv+vec2(float(i)*.017);if(uv.x>.3) p.y+=texture(uImage,p*.73).x*.1;sum+=texture(uImage,p);}
 color=sum*.25;}`;
const result=document.querySelector('#result');
document.querySelector('#run').onclick=()=>{
 document.querySelector('#run').disabled=true;let renderer,texture,target,geometry,material;
 try{
  renderer=createLabRenderer(THREE.WebGLRenderer,{canvas:document.querySelector('#view'),antialias:false},e=>{result.textContent=e.message;});
  installRTXGraphicsGuard(renderer,e=>{result.textContent=e.message;});
  if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('Floating-point comparison targets unavailable.');
  const data=Uint8Array.from({length:8*8*4},(_,i)=>i%4===3?255:(i*43)%256);
  texture=new THREE.DataTexture(data,8,8);texture.needsUpdate=true;
  geometry=new THREE.PlaneGeometry(2,2);
  material=new THREE.RawShaderMaterial({name:'texture-sampling-comparison',glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:{uImage:{value:texture}},depthTest:false,depthWrite:false});
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));const camera=new THREE.Camera();
  target=new THREE.WebGLRenderTarget(32,16,{type:THREE.FloatType,depthBuffer:false});
  const rows=[];
  for(const [filter,name] of [[THREE.NearestFilter,'nearest'],[THREE.LinearFilter,'linear']]){
   texture.minFilter=texture.magFilter=filter;texture.needsUpdate=true;
   const before=new Float32Array(32*16*4),after=before.slice();
   material.fragmentShader=fragment;material.needsUpdate=true;renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,32,16,before);
   material.fragmentShader=explicitTextureLevel(fragment,['uImage']);material.needsUpdate=true;renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,32,16,after);
   const finite=[...before,...after].every(Number.isFinite),error=Math.max(...before.map((v,i)=>Math.abs(v-after[i]))),signal=Math.max(...after)-Math.min(...after);
   rows.push({filter:name,pass:finite&&error<=1e-6&&signal>.1,error,finite,signal});
  }
  renderer.setRenderTarget(null);renderer.render(scene,camera);
  result.textContent=JSON.stringify({pass:rows.every(r=>r.pass),rows},null,2);
 }catch(error){result.textContent=error.stack||String(error);}
 finally{material?.dispose();geometry?.dispose();target?.dispose();texture?.dispose();renderer?.dispose();}
};
