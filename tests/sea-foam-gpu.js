import {verifyFoamCamera} from './sea-foam-camera-check.js';
import * as THREE from 'three';
import {createLabRenderer,installGraphicsGuard} from '../src/sand-lab/graphics-health.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {SeaFoam,verifySeaFoamGPU} from '../src/sand-lab/sea-foam.js';
import {focusSeaFoamSources} from '../src/sand-lab/sea-foam-model.js';
import {MotionDetail} from '../src/lod.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
const result=document.querySelector('#result'),canvas=document.createElement('canvas');document.body.insertBefore(canvas,result);
const report=e=>result.textContent=e.stack;const r=createLabRenderer(THREE.WebGLRenderer,{canvas},report);r.autoClear=false;r.setSize(900,540);const guard=installGraphicsGuard(r,report);
let lab,view,camera,target,seed;
function setup(){if(lab)return;lab=new SandLab(r,{physicalResolution:true});lab.seaFoam=new SeaFoam(r);lab.reactiveWaves=true;lab.paused=true;lab.wind=8;lab.day=14;lab.lunarCycle=false;lab.tidesEnabled=false;lab.detail.enabled=false;lab.wetting.cameraEnabled=false;lab.tannins=.65;
 camera=new THREE.PerspectiveCamera(65,900/540,.01,300);target=new THREE.WebGLRenderTarget(900,540,{type:THREE.FloatType});const field={renderer:r,camera,target,resolution:new THREE.Vector2(900,540),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};for(const k of ['beach','grass','grains','soft','optics','lightTest'])field[k]={count:0};installProgramSpecialization(r,()=>true);
 view=new WaterLabRenderer(field,lab);view.adaptiveResolution=false;view.mediumShadows.u.uMediumSize.value.set(16,12,16);seed=lab.positions.slice();camera.position.set(3.4,3.9,5);camera.lookAt(0,1.1,1);camera.updateMatrixWorld();
}
document.querySelector('#organic').oninput=e=>{setup();lab.tannins=Number(e.target.value);document.querySelector('#organic-value').textContent=lab.tannins.toFixed(2);lab.seaFoam.clearCleanWater(lab);draw();};
function draw(){lab.revision++;lab.syncUniforms();view.render({dt:1/60,adaptive:false});view.exposure.present(target,60,{dirty:true});}
function stats(){const data=lab.seaFoam.read();let water=0,sand=0,maximum=0;for(let o=0;o<data.length;o+=4){water+=data[o];sand+=data[o+1];maximum=Math.max(maximum,data[o]+data[o+1]);}return {backend:lab.seaFoam.backend,cells:lab.seaFoam.size**2,waterCoverage:water,sandCoverage:sand,maxCoverage:maximum,surfaceSamplingMs:lab.seaFoam.inputMs,bulkCount:lab.count,steps:lab.steps};}
function fixture(retreat=false){setup();if(!retreat){lab.positions.set(seed);lab.tannins=.65;lab.seaFoam.reset();lab.seaFoam.generation(lab);}
 else for(let i=0;i<lab.count;i++)lab.positions[i*4+1]-=.22;
 const f=lab.seaFoam;f.advance(0,lab);const n=f.size;
 // Deterministic wave-breaking ribbons; transport is the production solver.
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const o=(z*n+x)*4,px=(x+.5)*11/n-5.5,pz=(z+.5)*9.8/n-4.9;f.surface.surface[o+3]=retreat?0:Math.pow(Math.max(0,Math.sin(pz*4+Math.sin(px*2)*1.3)),8)*(.3+.7*Math.sin(px*3+.5)**2);f.surface.flow[o]=.035*Math.sin(pz*2);f.surface.flow[o+1]=.085+.07*Math.sin(pz*4+Math.sin(px*2)*1.3);}
 if(!retreat)focusSeaFoamSources(f.surface.surface,f.surface.flow,n,lab.spec.scale,lab.spacing);f.surfaceTexture.needsUpdate=f.flowTexture.needsUpdate=true;for(let i=0;i<(retreat?15:900);i++)f.dispatch(1/15);f.active=true;f.revision++;draw();return stats();}
for(const [id,run] of Object.entries({near:()=>verifyFoamCamera(r),numerical:()=>verifySeaFoamGPU(r),surface:()=>fixture(),retreat:()=>fixture(true),rewet:()=>{setup();lab.positions.set(seed);lab.seaFoam.advance(.4,lab);draw();return stats();},off:()=>{setup();lab.tannins=0;lab.chem.fill(0);lab.seaFoam.advance(.1,lab);draw();return stats();}}))document.querySelector('#'+id).onclick=()=>{try{result.textContent=JSON.stringify(run(),null,2);}catch(e){guard.stop(e);result.textContent=e.stack;}};
document.querySelector('#live').onclick=async()=>{try{setup();lab.positions.set(seed);lab.velocities.fill(0);lab.tannins=.65;lab.seaFoam.reset();lab.wind=8;lab.reactiveWaves=true;let total=0;const start=performance.now();for(let i=0;i<75&&!guard.failed;i++){lab.step(1/15);total+=lab.seaFoam.inputMs||0;if(i%5===0){draw();result.textContent=`Live wind: ${((i+1)/15).toFixed(1)} / 5 simulation seconds`;await new Promise(resolve=>setTimeout(resolve,0));}}draw();result.textContent=JSON.stringify({...stats(),wallMs:performance.now()-start,meanSurfaceSamplingMs:total/75,timing:lab.timings,gpu: view.timers.ms},null,2);}catch(e){guard.stop(e);result.textContent=e.stack;}};
