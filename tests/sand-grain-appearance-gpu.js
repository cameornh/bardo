import * as THREE from 'three';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {verifySandGrains} from '../src/sand-lab/sand-grains.js';
import {createSandWind} from '../src/sand-lab/sand-air.js';
import {erodeSand} from '../src/sand-lab/sand-wind.js';
import {sandParticleMaterial} from '../src/sand-lab/particulate-material.js';
import {MotionDetail} from '../src/lod.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
const result=document.querySelector('#result'),r=new THREE.WebGLRenderer({preserveDrawingBuffer:true});r.autoClear=false;r.setSize(800,500);document.body.insertBefore(r.domElement,result);
r.debug.onShaderError=(gl,p,v,f)=>{throw Error(gl.getShaderInfoLog(f)||gl.getProgramInfoLog(p));};window.addEventListener('error',e=>result.textContent=e.error?.stack||e.message);
const lab=new SandLab(r);lab.paused=true;lab.wind=40;lab.time=2;lab.day=14;lab.lunarCycle=false;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;
const camera=new THREE.PerspectiveCamera(65,1.6,.01,300),target=new THREE.WebGLRenderTarget(800,500,{type:THREE.FloatType}),field={renderer:r,camera,target,resolution:new THREE.Vector2(800,500),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
for(const k of ['beach','grass','grains','soft','optics','lightTest'])field[k]={count:0};installProgramSpecialization(r,()=>true);
const view=new WaterLabRenderer(field,lab);view.adaptiveResolution=false;view.mediumShadows.u.uMediumSize.value.set(16,12,16);
camera.position.set(0,1.8,4.5);camera.lookAt(0,.9,2.7);camera.updateMatrixWorld();
document.querySelector('#run').onclick=()=>{try{
 const numerical=verifySandGrains(r);lab.sandWind=createSandWind(lab);lab.syncUniforms();view.render({dt:1/60,adaptive:false});
 const grains=view.sandGrains;grains.reset();grains.advance(.001);
 const mass=lab.sand.totalMass();erodeSand(lab.sand,.13,lab.sandWind,lab.spec.scale,()=>({density:0,velocity:[0,0,0]}));
 const moved=lab.sand.windMoved||0;
 // A fixed cloud over the dry shoreline makes material changes comparable.
 // Actual release amount is measured separately above.
 lab.sand.windEvents=Array.from({length:10},(_,i)=>({position:[(i%5-2)*.19,lab.sand.height((i%5-2)*.19,2.9)+.07+Math.floor(i/5)*.06,2.9],velocity:[.15,.05,0],normal:[0,1,0],spread:.1,amount:.00003,seed:i+100,material:sandParticleMaterial(),speed:40,duration:.12,submerged:false}));
 for(let i=0;i<8;i++)grains.advance(1/30);
 lab.revision++;lab.syncUniforms();view.render({dt:1/60,adaptive:false});view.exposure.present(target,180,{dirty:true});
 result.textContent=JSON.stringify({backend:grains.cpu?'CPU reference':'GPU',numerical,wind:40,moved,massError:lab.sand.totalMass()-mass,albedo:sandParticleMaterial().albedo,grains:grains.inspect(camera)},null,2);
 }catch(e){result.textContent=e.stack;}};
result.textContent='Ready';
