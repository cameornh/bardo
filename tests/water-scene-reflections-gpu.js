import * as THREE from 'three';
import {WaterLab} from '../src/water-lab.js';
import {WaterLabRenderer} from '../src/water-lab-renderer.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer as SandRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {MotionDetail} from '../src/lod.js';
import {QUAD_VERTEX,TONEMAP_FRAGMENT} from '../src/shaders.js';
import {WATER_SCENE_REFLECTION_GLSL,waterSceneReflectionCPU} from '../src/water-lab-reflections.js';
const $=id=>document.getElementById(id),result=$('result'),kind=new URLSearchParams(location.search).get('lab')||'pool',sand=kind==='sand';
window.addEventListener('error',e=>result.textContent=e.error?.stack||e.message);
const r=new THREE.WebGLRenderer({preserveDrawingBuffer:true});r.autoClear=false;r.setSize(800,550);document.body.append(r.domElement);r.domElement.style.cssText="width:100%;max-width:800px;height:auto";
r.debug.onShaderError=(gl,p,v,f)=>{throw Error(JSON.stringify({fragment:gl.getShaderInfoLog(f),vertex:gl.getShaderInfoLog(v),program:gl.getProgramInfoLog(p),compiled:gl.getShaderParameter(f,gl.COMPILE_STATUS),linked:gl.getProgramParameter(p,gl.LINK_STATUS),lost:gl.isContextLost()}));};
const lab=sand?new SandLab(r):new WaterLab(r);if(!sand)lab.configure(kind);else installProgramSpecialization(r,()=>true);
lab.wind=0;lab.ambient=1;lab.sunlight=1;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;lab.paused=true;lab.enabled=true;
const camera=new THREE.PerspectiveCamera(44,800/550,.01,300),target=new THREE.WebGLRenderTarget(800,550,{type:THREE.FloatType}),output=new THREE.Scene();
output.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:TONEMAP_FRAGMENT,uniforms:{uImage:{value:target.texture}},depthTest:false,depthWrite:false})));
const field={renderer:r,camera,target,output,quadCamera:new THREE.Camera(),resolution:new THREE.Vector2(800,550),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:.02}}}};
for(const k of ['beach','grass','grains','soft','optics','lightTest'])field[k]={count:0};
const view=sand?new SandRenderer(field,lab):new WaterLabRenderer(field,lab);view.adaptiveResolution=false;
if(kind!=='fountain'){
 for(const [i,material] of ['rock','mirror','glass'].entries()){
  const position=[(i-1)*1.4,2.15,-2.1];
  if(sand){const b=makeBody(material,'sphere',.5,position);if(i===0)b.color=[.7,.12,.04];lab.balls.push(b);}
  else lab.balls.push({kind:material,position,radius:.5,velocity:[0,0,0],ratio:1,submerged:0});
 }
 if(sand){const b=makeBody('light','sphere',.18,[1,3.2,-1]);b.color=[1,.22,.03];lab.balls.push(b);}
 camera.position.set(sand?4.6:0,sand?2.5:1.55,sand?7:2.35);camera.lookAt(0,sand?1.7:1.55,-.8);
}else{camera.position.set(8,3.1,10);camera.lookAt(0,2,0);}
lab.syncUniforms();lab.revision++;
const rest=lab.positions.slice();
function draw(){camera.updateMatrixWorld();lab.revision++;view.render({dt:1/30,adaptive:false});r.getContext().finish();}
function waves(amount){for(let i=0;i<lab.count;i++){const o=i*4;lab.positions[o+1]=rest[o+1]+amount*Math.sin(rest[o]*3.1+rest[o+2]*2)*Math.cos(rest[o+2]*1.7);}draw();result.textContent=`${kind}: ${amount?'disturbed':'calm'} surface · scene reflections ${view.u.uWaterSceneReflections.value?'on':'off'}`;}
$('calm').onclick=()=>waves(0);$('waves').onclick=()=>waves(.17);$('reflection').onchange=()=>{view.u.uWaterSceneReflections.value=$('reflection').checked;draw();};
function pixels(t){const a=new Float32Array(t.width*t.height*4);r.readRenderTargetPixels(t,0,0,t.width,t.height,a);return a;}
$('audit').onclick=async()=>{try{
 const captures=[],times=[[],[]];
 for(let repetition=0;repetition<3;repetition++)for(const enabled of [false,true]){view.u.uWaterSceneReflections.value=enabled;const start=performance.now();draw();times[Number(enabled)].push(performance.now()-start);if(!repetition)captures.push(pixels(view.resolvedWater));await new Promise(requestAnimationFrame);}
 let changed=0,nonFinite=0,maxDepthError=0,meanDifference=0;for(let i=0;i<captures[0].length;i+=4){let d=0;for(let k=0;k<3;k++){d+=Math.abs(captures[1][i+k]-captures[0][i+k]);if(!Number.isFinite(captures[1][i+k]))nonFinite++;}if(d>.01)changed++;meanDifference+=d/3;maxDepthError=Math.max(maxDepthError,Math.abs(captures[1][i+3]-captures[0][i+3]));}
 $('reflection').checked=true;view.u.uWaterSceneReflections.value=true;draw();
 result.textContent=JSON.stringify({station:kind,changedWaterPixels:changed,maxWaterDepthError:maxDepthError,nonFinite,meanLinearDifference:meanDifference/(captures[0].length/4),fixedResolution:[target.width,target.height],warmRenderMs:times.map(a=>(a[1]+a[2])/2),pass:changed>100&&maxDepthError===0&&nonFinite===0},null,2);
}catch(e){result.textContent=e.stack;}};
// The exact production reflection helper against analytic receivers. This
// checks miss/opaque/glass ordering and the view vector, not shader source text.
$('numeric').onclick=()=>{try{
 const count=256,rt=new THREE.WebGLRenderTarget(count,1,{type:THREE.FloatType,depthBuffer:false}),scene=new THREE.Scene();
 const helpers=`float traceOpaque(vec3 o,vec3 d){return d.y>.1?(2.-o.y)/d.y:1e4;}
 vec3 opaqueNormal(vec3 p){return vec3(0,-1,0);}
 vec3 reflectedSurfaceColor(vec3 p,vec3 n,vec3 v){return vec3(.4)+p*.03+v*.1;}
 vec3 sky(vec3 d){return vec3(.2,.3,.4)+d*.1;}
 float traceGlass(vec3 o,vec3 d,float limit,out vec3 n){n=vec3(0,-1,0);return o.x>0.&&d.y>.1?(1.-o.y)/d.y:1e4;}
 vec3 shadeGlass(vec3 p,vec3 n,vec3 ray,vec3 color){return color*vec3(.7,.8,.9)+vec3(.02);}`;
 const m=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 color;uniform float uSpacing;${helpers}${WATER_SCENE_REFLECTION_GLSL}void main(){float x=(gl_FragCoord.x-.5)/255.,angle=x*.8;vec3 n=vec3(sin(angle),cos(angle),0),ray=normalize(vec3(.2,-.3-x,-.8));color=vec4(waterSceneReflection(vec3(x-.5,0,0),n,ray),1);}`,uniforms:{uSpacing:{value:.2},uWaterSceneReflections:{value:true}},depthTest:false,depthWrite:false});
 scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),m));r.setRenderTarget(rt);r.render(scene,new THREE.Camera());const gpu=pixels(rt);let error=0,worst=null;
 for(let i=0;i<count;i++){const x=i/255,n=[Math.sin(x*.8),Math.cos(x*.8),0],unscaled=[.2,-.3-x,-.8],ray=unscaled.map(v=>v/Math.hypot(...unscaled));const cpu=waterSceneReflectionCPU([x-.5,0,0],n,ray,{spacing:.2,sky:d=>[.2,.3,.4].map((v,k)=>v+d[k]*.1),traceOpaque:(o,d)=>d[1]>.1?(2-o[1])/d[1]:1e4,shadeOpaque:(p,v)=>p.map((x,k)=>.4+x*.03+v[k]*.1),traceGlass:(o,d)=>({distance:o[0]>0&&d[1]>.1?(1-o[1])/d[1]:1e4,normal:[0,-1,0]}),shadeGlass:(_p,_n,_r,c)=>c.map((v,k)=>v*[.7,.8,.9][k]+.02)});for(let k=0;k<3;k++){const delta=Math.abs(cpu[k]-gpu[i*4+k]);if(delta>error){error=delta;worst={sample:i,channel:k,cpu:cpu[k],gpu:gpu[i*4+k]};}}}
 rt.dispose();m.dispose();scene.children[0].geometry.dispose();draw();result.textContent=JSON.stringify({backend:'GPU',samples:count,maxRadianceError:error,worst,pass:error<5e-4},null,2);
}catch(e){result.textContent=e.stack;}};
waves(0);
