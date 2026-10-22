import * as THREE from 'three';
import {WaterLab} from '../src/water-lab.js';
import {WaterLabRenderer} from '../src/water-lab-renderer.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer as SandRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {MotionDetail} from '../src/lod.js';
import {QUAD_VERTEX,TONEMAP_FRAGMENT} from '../src/shaders.js';
import {LabExposure,exposureStatistics,exposureTarget,adaptExposure} from '../src/water-lab-exposure.js';
import {WATER_EXIT_GLSL,waterExit} from '../src/water-lab-interface.js';
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

function pixels(t){const a=new Float32Array(t.width*t.height*4);r.readRenderTargetPixels(t,0,0,t.width,t.height,a);return a;}
function draw(dt=1/30){camera.updateMatrixWorld();view.render({dt,adaptive:false});r.getContext().finish();}
function light(ambient,sun){lab.ambient=ambient;lab.sunlight=sun;if(sand){lab.skyIntensity=ambient;lab.sunIntensity=sun;}lab.syncUniforms();lab.revision++;}
function addBody(kind,position,radius){const b=sand?makeBody(kind,'sphere',radius,position):{kind,position,radius,velocity:[0,0,0],ratio:1,submerged:0};lab.balls.push(b);return b;}
function report(name){const hdr=pixels(target),s=exposureStatistics(hdr);result.textContent=JSON.stringify({fixture:name,backend:view.exposure.backend,exposure:view.exposure.read(),hdrStats:s,nonFinite:hdr.filter(v=>!Number.isFinite(v)).length},null,2);}
async function settle(name){for(let i=0;i<240;i++){view.present(false);await new Promise(requestAnimationFrame);}report(name);}
function sun(blocked){light(1,1);lab.balls=[];camera.up.set(0,1,0);camera.position.set(0,4,4);const sun=sand?lab.u.uSolarDirection.value.clone():new THREE.Vector3(-.4,1,.3).normalize();camera.lookAt(camera.position.clone().add(sun));if(blocked)addBody('rock',camera.position.clone().addScaledVector(sun,4).toArray(),.65);lab.syncUniforms();lab.revision++;draw();return settle(blocked?'sun blocked by rock':'visible sun');}
function underwater(bodies=true){light(1,1);lab.balls=[];camera.up.set(0,0,-1);camera.position.set(0,.95,0);camera.lookAt(0,3,0);if(bodies){addBody('rock',[0,3,0],.55);addBody('glass',[1.3,3,-.4],.48);addBody('mirror',[-1.3,3,-.4],.48);}lab.syncUniforms();lab.revision++;draw();report('underwater objects');}
$('sun').onclick=()=>sun(false);$('block').onclick=()=>sun(true);$('underwater').onclick=()=>underwater();
$('dark').onclick=()=>{light(.001,0);lab.lights=0;lab.balls=[];camera.up.set(0,1,0);camera.position.set(0,3,5);camera.lookAt(0,1,0);draw();settle('very dark scene');};
$('normal').onclick=()=>{light(1,1);lab.lights=1;lab.balls=[];camera.up.set(0,1,0);camera.position.set(4.5,3,6);camera.lookAt(0,1,0);lab.revision++;draw();settle('normal daylight');};
$('audit').onclick=async()=>{try{
 await sun(false);const sunExposure=view.exposure.read()[0];await sun(true);const blockedExposure=view.exposure.read()[0];
 underwater(false);const empty=pixels(view.resolvedWater);underwater(true);const objects=pixels(view.resolvedWater);let changed=0;for(let i=0;i<empty.length;i+=4)if(Math.abs(empty[i]-objects[i])+Math.abs(empty[i+1]-objects[i+1])+Math.abs(empty[i+2]-objects[i+2])>.03)changed++;
 const center=(Math.floor(target.height/2)*target.width+Math.floor(target.width/2))*4;const report={lab:kind,sunExposure,blockedExposure,underwaterObjectPixels:changed,centerEmpty:Array.from(empty.slice(center,center+4)),centerObject:Array.from(objects.slice(center,center+4)),nonFinite:objects.filter(v=>!Number.isFinite(v)).length,pass:sunExposure<.2&&blockedExposure>.7&&changed>100};result.textContent=JSON.stringify(report,null,2);
}catch(e){result.textContent=e.stack;}};
$('numeric').onclick=()=>{try{
 const meter=new LabExposure(r),w=67,h=39,input=new THREE.WebGLRenderTarget(w,h,{type:THREE.FloatType,depthBuffer:false}),scene=new THREE.Scene();
 const m=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 color;uniform int uCase;void main(){float y=uCase==0?.3:uCase==1?.0008:.3;if(uCase==2&&gl_FragCoord.x>31.&&gl_FragCoord.x<33.&&gl_FragCoord.y>17.&&gl_FragCoord.y<19.)y=7000.;color=vec4(y,y*.95,y*.9,1.);}`,uniforms:{uCase:{value:0}},depthTest:false,depthWrite:false});scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),m));
 let worst=0,reductionError=0;const checks=[];for(let c=0;c<3;c++){m.uniforms.uCase.value=c;r.setRenderTarget(input);r.render(scene,new THREE.Camera());const data=pixels(input),s=exposureStatistics(data),desired=exposureTarget(s),previous=meter.state<0?1:meter.read()[0];meter.update(input,.2);const gpu=meter.read(),cpu=adaptExposure(previous,desired,.2),error=Math.abs(gpu[0]-cpu);worst=Math.max(worst,error);const reduced=pixels(meter.levels.at(-1));for(const k of [0,1,2,3])reductionError=Math.max(reductionError,Math.abs(reduced[k]-s[k])/Math.max(1,Math.abs(s[k])));checks.push({case:c,gpu:gpu[0],cpu,target:desired,error});}
 // Exact production Snell/Fresnel helper: both sides of the critical angle.
 const rt=new THREE.WebGLRenderTarget(256,1,{type:THREE.FloatType,depthBuffer:false});m.fragmentShader=`precision highp float;out vec4 color;const float WATER_IOR=1.333;${WATER_EXIT_GLSL}void main(){float a=(gl_FragCoord.x-.5)/255.*1.56;vec3 transmitted;float f=waterExitFresnel(vec3(sin(a),cos(a),0),vec3(0,1,0),transmitted);color=vec4(transmitted,f);}`;m.needsUpdate=true;r.setRenderTarget(rt);r.render(scene,new THREE.Camera());const gpu=pixels(rt);let snellError=0;for(let i=0;i<256;i++){const a=i/255*1.56,reference=waterExit([Math.sin(a),Math.cos(a),0],[0,1,0]),v=[...(reference.transmitted||[0,0,0]),reference.fresnel];for(let k=0;k<4;k++)snellError=Math.max(snellError,Math.abs(gpu[i*4+k]-v[k]));}
 const beforeCPU=meter.read()[0];meter.update(input,0,{cpu:true});const fallbackError=Math.abs(beforeCPU-meter.read()[0]);
 meter.update(target,1/30,{cpu:false});r.getContext().finish();const start=performance.now();for(let i=0;i<15;i++){meter.update(target,1/30);r.getContext().finish();}const exposureMilliseconds=(performance.now()-start)/15;
 meter.dispose();input.dispose();rt.dispose();m.dispose();scene.children[0].geometry.dispose();draw();result.textContent=JSON.stringify({backend:'GPU',meterCases:checks,exposureError:worst,reductionRelativeError:reductionError,fallbackError,exposureMilliseconds,snellSamples:256,snellError,pass:worst<.001&&snellError<.001&&reductionError<1e-4&&fallbackError<.001},null,2);
}catch(e){result.textContent=e.stack;}};
underwater();
