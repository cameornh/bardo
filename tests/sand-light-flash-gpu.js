import * as THREE from 'three';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {gaussianIntersectsView,GAUSSIAN_BOUNDS_GLSL} from '../src/sand-lab/gaussian-bounds.js';
import {QUAD_VERTEX} from '../src/shaders.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {MotionDetail} from '../src/lod.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
const result=document.querySelector('#result'),r=new THREE.WebGLRenderer({preserveDrawingBuffer:true});r.autoClear=false;r.setSize(640,400);document.body.insertBefore(r.domElement,result);
r.debug.onShaderError=(gl,p,v,f)=>{throw Error(gl.getShaderInfoLog(f)||gl.getProgramInfoLog(p));};window.addEventListener('error',e=>result.textContent=e.error?.stack||e.message);
const lab=new SandLab(r);lab.paused=true;lab.wind=0;lab.lunarCycle=false;lab.day=0;lab.lunarDay=0;lab.wetting.cameraEnabled=false;
const camera=new THREE.PerspectiveCamera(65,1.6,.01,300),target=new THREE.WebGLRenderTarget(640,400,{type:THREE.FloatType}),field={renderer:r,camera,target,resolution:new THREE.Vector2(640,400),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
for(const k of ['beach','grass','grains','soft','optics','lightTest'])field[k]={count:0};installProgramSpecialization(r,()=>true);
const view=new WaterLabRenderer(field,lab);view.adaptiveResolution=false;view.mediumShadows.u.uMediumSize.value.set(16,12,16);
function pixels(t){const half=t.texture.type===THREE.HalfFloatType,p=half?new Uint16Array(t.width*t.height*4):new Float32Array(t.width*t.height*4);r.readRenderTargetPixels(t,0,0,t.width,t.height,p);return half?Float32Array.from(p,x=>THREE.DataUtils.fromHalfFloat(x)):p;}
function seed(position,kind=3,radius=.018){
 const d=lab.detail;d.reset();d.enabled=true;d.activeSpan=d.count=d.emitted=1;
 d.fallback[0].image.data.set([...position,.4]);d.fallback[1].image.data.set([0,0,0,10]);d.fallback[2].image.data.set([radius,kind,.8,100]);for(const t of d.fallback)t.needsUpdate=true;
 lab.balls=[makeBody('light','sphere',.15,position.map((v,k)=>v+(k===1?-.3:0)))];lab.balls[0].color=[.02,1,.24];lab.revision++;lab.syncUniforms();
}
function draw(){camera.updateMatrixWorld();view.render({dt:1/60,adaptive:false});}
function measure(){const p=pixels(view.detailRenderer.target);let count=0,alpha=0,peak=0;for(let i=0;i<p.length;i+=4){if(p[i+3]>.00001)count++;alpha+=p[i+3];peak=Math.max(peak,p[i+1]);}return {coveredPixels:count,alphaSum:alpha,peakGreen:peak};}
async function run(){try{
 const results=[];camera.position.set(0,8,0);camera.up.set(0,1,0);
 const numeric=verifyViewBounds();
 for(const kind of [0,1,2,3]){seed([0,4,0],kind);for(const forward of [-.04,0,.028,.035,.04,.05,.08,.12,.3,1]){
  camera.lookAt(0,8-forward/4,-1);draw();results.push({kind,forward,...measure()});result.textContent=`Checking ${results.length}/40 camera angles…`;await new Promise(requestAnimationFrame);
 }
 }
 // Distant lateral sources must never project onto these sky-facing rays.
 const worst=results.reduce((a,b)=>b.alphaSum>a.alphaSum?b:a,results[0]);seed([0,4,0],worst.kind);camera.lookAt(0,8-worst.forward/4,-1);draw();view.exposure.present(target,180,{dirty:true});
 result.textContent=JSON.stringify({backend:'GPU',numeric,results,worst,pass:numeric.pass&&results.every(x=>x.coveredPixels===0)},null,2);
 }catch(e){result.textContent=e.stack;}}
document.querySelector('#run').onclick=run;
document.querySelector('#visible').onclick=()=>{camera.position.set(0,8,0);camera.up.set(0,1,0);camera.lookAt(0,8,-1);seed([0,8,-1],0,.1);draw();view.exposure.present(target,180,{dirty:true});result.textContent=JSON.stringify({fixture:'visible lit spray',...measure()},null,2);};
result.textContent='Ready to test distant lit particles near the camera plane.';

function verifyViewBounds(){
 const probes=[];for(const z of [-.035,-.3,-1,-4,.1])for(const x of [-4,-1,0,1,4])for(const y of [0,4])probes.push(new THREE.Vector4(x,y,z,.08));
 const t=new THREE.WebGLRenderTarget(probes.length,1,{type:THREE.FloatType,depthBuffer:false}),material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:`precision highp float;out vec4 color;uniform vec4 uProbes[50];${GAUSSIAN_BOUNDS_GLSL}void main(){vec4 p=uProbes[int(gl_FragCoord.x)];color=vec4(gaussianIntersectsView(p.xyz,p.w,vec2(1.,1.6),vec2(640.,400.))?1.:0.);}`,uniforms:{uProbes:{value:probes}},depthTest:false,depthWrite:false}),geometry=new THREE.PlaneGeometry(2,2),scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));const old=r.getRenderTarget();
 try{r.setRenderTarget(t);r.render(scene,new THREE.Camera());const gpu=pixels(t);let mismatches=0;probes.forEach((p,i)=>{if(Boolean(gpu[i*4])!==gaussianIntersectsView([p.x,p.y,p.z],p.w,[1,1.6],[640,400]))mismatches++;});return {samples:probes.length,mismatches,pass:mismatches===0};}
 finally{r.setRenderTarget(old);geometry.dispose();material.dispose();t.dispose();}
}
