import {createLabRenderer,installGraphicsGuard} from '../src/sand-lab/graphics-health.js';
import * as THREE from 'three';
import {SandLab} from '../src/sand-lab/lab.js';
import {WaterLabRenderer} from '../src/sand-lab/water-lab-renderer.js';
import {LabFluidGPU} from '../src/sand-lab/water-lab-gpu.js';
import {solveDensity,collideBoundary,WATER_CONTACT_SKIN} from '../src/sand-lab/water-lab-model.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {MotionDetail} from '../src/lod.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {RAIN_SAMPLE_GLSL,rainVisualPoint,rainVisualCount} from '../src/sand-lab/rain-appearance.js';
import {QUAD_VERTEX} from '../src/shaders.js';
const result=document.querySelector('#result'),report=error=>result.textContent=error.message;
window.addEventListener('error',e=>report(e.error||new Error(e.message)));
const canvas=document.createElement('canvas');document.body.insertBefore(canvas,result);
const r=createLabRenderer(THREE.WebGLRenderer,{canvas,preserveDrawingBuffer:true},report),graphics=installGraphicsGuard(r,report);
r.autoClear=false;r.setSize(800,500);
const lab=new SandLab(r);lab.paused=true;lab.wind=0;lab.lunarCycle=false;lab.wetting.cameraEnabled=false;lab.neighborCounts=new Float32Array(lab.count).fill(26);
const camera=new THREE.PerspectiveCamera(55,1.6,.01,300),target=new THREE.WebGLRenderTarget(800,500,{type:THREE.FloatType}),field={renderer:r,camera,target,resolution:new THREE.Vector2(800,500),motion:new MotionDetail(),minPixelSigma:2,uniforms:{uView:{value:0},uSHDegree:{value:3}},water:{uniforms:{uWaterRoughness:{value:.14},uTurbidity:{value:0}}}};
for(const k of ['beach','grass','grains','soft','optics','lightTest'])field[k]={count:0};installProgramSpecialization(r,()=>true);
const view=new WaterLabRenderer(field,lab);view.adaptiveResolution=false;view.mediumShadows.u.uMediumSize.value.set(16,12,16);
function pixels(t){const p=new Float32Array(t.width*t.height*4);r.readRenderTargetPixels(t,0,0,t.width,t.height,p);return p;}
function draw(){camera.updateMatrixWorld();view.render({dt:1/30,adaptive:false});}
function stats(){const data=pixels(target);let max=0,invalid=0;for(let i=0;i<data.length;i+=4){max=Math.max(max,data[i],data[i+1],data[i+2]);if(!Number.isFinite(data[i]+data[i+1]+data[i+2]))invalid++;}return {max,invalid,programs:r.info.programs.length};}

function fixture(){
 animate=false;lab.positions=new Float32Array();lab.velocities=new Float32Array();lab.chem=new Float32Array();lab.neighborCounts=new Uint16Array();lab.fluidIndex=null;lab.sand.parcels=[];lab.sand.wet.fill(.85);lab.sand.update();lab.rain.reset('ocean');lab.detail.reset();lab.balls=[];
 for(const [x,shape,kind] of [[-.9,'sphere','glass'],[0,'cup','glass'],[.8,'cup','mirror']]){const b=makeBody(kind,shape,.3,[x,1.7,2.8]);lab.balls.push(b);}
 for(let i=0;i<360;i++)lab.stepBodies(1/120);
 lab.time=0;lab.revision++;lab.syncUniforms();camera.position.set(1.05,1.9,3.6);camera.lookAt(0,.9,1.9);draw();view.exposure.present(target,30,{dirty:true});result.textContent=JSON.stringify({fixture:'rigid contacts on sloped sand',bodies:lab.balls.map(b=>({kind:b.kind,position:b.position,tilt:b.tilt,pitch:b.pitch})),...stats()},null,2);
}
function seedObjectRain(){lab.rain.impactAllowance=0;for(const b of lab.balls)for(let i=0;i<96;i++){
 const radius=b.radius*Math.sqrt((i+.5)/96)*.98,a=i*2.39996323,x=b.position[0]+Math.cos(a)*radius,z=b.position[2]+Math.sin(a)*radius;
 const hit=lab.rain.solidHit([x,4,z],[x,-1,z],p=>lab.solid(p,false,false));if(hit){const volume=lab.spacing**3*.045;lab.rain.impact({volume,velocity:[0,-.9,0]},hit);lab.rain.emitted+=volume;}
 }lab.rain.surfaceDrops.step(.2);lab.rain.impactAllowance=Infinity;lab.revision++;}
let animate=false,last=0;
function tick(t){if(graphics.failed)return;requestAnimationFrame(tick);if(!animate||t-last<1000/15)return;const dt=Math.min(.08,(t-last)/1000);last=t;lab.time+=dt;lab.rain.step(dt);lab.detail.advance(dt,lab);lab.revision++;lab.syncUniforms();draw();}requestAnimationFrame(tick);
document.querySelector('#fixture').onclick=fixture;
document.querySelector('#beads').onclick=()=>{fixture();seedObjectRain();draw();result.textContent='Rain-derived surface beads. Each falling packet was traced to its first solid hit.';};
document.querySelector('#shadows').onclick=()=>{view.u.uBodyShadows.value=!view.u.uBodyShadows.value;lab.revision++;draw();result.textContent='Body shadows: '+view.u.uBodyShadows.value;};
document.querySelector('#rain').onclick=()=>{fixture();seedObjectRain();lab.rain.enabled=true;lab.rain.rate=300;lab.wind=0;animate=true;last=performance.now();result.textContent='Rain: GPU object collision field; CPU conservative surface beads / rigid bodies.';};

function verifyBodySolver(){
 const gpu=new LabFluidGPU(r,lab.u),points=[];
 // Offset the lattice from the exact sphere center: its contact normal is
 // undefined there, so CPU/GPU roundoff legitimately selects different exits.
 for(const body of lab.balls)for(let z=-2;z<=2;z++)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)points.push(body.position[0]+(x+.23)*.115,body.position[1]+(y+.31)*.115,body.position[2]+(z+.17)*.115,points.length%76===0?1:0);
 const predicted=new Float32Array(points),spacing=.12,solid=p=>lab.solid(p),collide=p=>collideBoundary(p,spacing*WATER_CONTACT_SKIN,solid),rows=[];
 for(const packed of [false,true])for(const reuse of [false,true]){
  gpu.uniforms.uPackedGpuNeighbors.value=packed;gpu.uniforms.uReuseBoundary.value=reuse;
  const actual=gpu.solve(predicted,spacing,collide,3,solid),expected=solveDensity(predicted,gpu.neighbors,spacing,3,collide,solid).positions;let error=0,heldError=0,invalid=0,worstIndex=0;
  for(let i=0;i<actual.length;i++){if(!Number.isFinite(actual[i]))invalid++;if(Math.abs(actual[i]-expected[i])>error){error=Math.abs(actual[i]-expected[i]);worstIndex=i;}if(predicted[i-i%4+3]>.5)heldError=Math.max(heldError,Math.abs(actual[i]-predicted[i]));}
  const offset=worstIndex-worstIndex%4;rows.push({packed,reuse,error,heldError,invalid,worst:{index:offset/4,input:[...predicted.slice(offset,offset+4)],actual:[...actual.slice(offset,offset+4)],expected:[...expected.slice(offset,offset+4)]}});
 }
 gpu.dispose();return {backend:gpu.constraintBackend+' / CPU reference',rows,pass:rows.every(v=>v.error<.002&&v.heldError===0&&v.invalid===0)};
}
document.querySelector('#shape-checks').onclick=()=>{animate=false;try{fixture();lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);lab.sand.update();lab.syncUniforms();result.textContent=JSON.stringify({sand:lab.sand.parcels.length,...verifyBodySolver()},null,2);}catch(e){result.textContent=e.stack;}};
document.querySelector('#checks').onclick=async()=>{animate=false;try{
 await view.objectProgramsReady;const {rainBodyHeight}=await import('../src/sand-lab/rain-object-contacts.js');fixture();const solver=verifyBodySolver();lab.rain.enabled=true;draw();const map=view.rainObjectContacts.target,data=pixels(map);lab.gpu.cpu=true;view.rainObjectContacts.update(lab);const fallback=view.rainObjectContacts.data.slice();lab.gpu.cpu=false;view.rainObjectContacts.update(lab);let maxError=0,mismatches=0,hits=0,fallbackError=0;
 for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){const point=[((x+.5)/map.width-.5)*11,((y+.5)/map.height-.5)*9.8],cpu=rainBodyHeight(...point,lab.balls),o=(y*map.width+x)*4;fallbackError=Math.max(fallbackError,Math.abs(cpu[0]-fallback[o]),Math.abs(cpu[1]-fallback[o+1]));if(cpu[1]>=0)hits++;if(Math.round(data[o+1])!==cpu[1])mismatches++;if(cpu[1]>=0&&data[o+1]>=0)maxError=Math.max(maxError,Math.abs(cpu[0]-data[o]));}
 const {bodyDistance}=await import('../src/sand-lab/objects.js');let physicalHits=0,surfaceError=0;const impact=lab.rain.impact.bind(lab.rain);lab.rain.impact=(drop,hit)=>{for(const b of lab.balls)if(Math.abs(bodyDistance(hit.point,b))<.01){physicalHits++;surfaceError=Math.max(surfaceError,Math.abs(bodyDistance(hit.point,b)));}impact(drop,hit);};
 lab.rain.rate=300;for(let i=0;i<90;i++){lab.time+=1/15;lab.rain.step(1/15);lab.detail.advance(1/15,lab);}lab.rain.impact=impact;lab.revision++;draw();view.exposure.present(target,30,{dirty:true});
 result.textContent=JSON.stringify({backend:'GPU first-contact map / CPU mass, beads and rigid contacts',solver,hits,maxError,fallbackError,mismatches,physicalHits,surfaceError,beads:lab.rain.surfaceDrops.beads().length,conservation:Math.abs(lab.rain.emitted-lab.rain.transferred-lab.rain.unresolvedVolume),...stats(),pass:solver.pass&&hits>0&&maxError<.001&&mismatches===0&&fallbackError<1e-6&&physicalHits>0&&surfaceError<.004},null,2);
 }catch(e){result.textContent=e.stack;}};
document.querySelector('#spawn-checks').onclick=async()=>{animate=false;const rows=[];try{
 lab.configure('ocean');lab.wind=0;lab.lunarCycle=false;lab.rain.enabled=false;lab.wetting.cameraEnabled=false;lab.paused=true;lab.objectRadius=.3;
 // Exercise the expensive combination: the full water volume, actual sand
 // parcels and every object material, including the first zero-to-one spawn.
 lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);lab.sand.update();lab.syncUniforms();lab.revision++;
 camera.position.set(4.8,4,4.4);camera.lookAt(0,.65,0);draw();await r.warmObjectPrograms([],camera);
 for(const kind of ['glass','mirror','rock','light'])for(const shape of ['sphere','cup']){
  result.textContent='Checking '+kind+' '+shape;await new Promise(requestAnimationFrame);
  const start=performance.now(),b=lab.spawn(kind,[-2.8+rows.length*.75,2.5,3],[0,-1,0],shape);draw();let image=stats(),renderMs=performance.now()-start;
  const physicsStart=performance.now();for(let i=0;i<3;i++)lab.step(1/60);const stepMs=(performance.now()-physicsStart)/3;draw();image=stats();
  rows.push({kind,shape,renderMs,stepMs,finite:[...b.position,...b.velocity,...b.omega].every(Number.isFinite),invalid:image.invalid});
 }
 result.textContent=JSON.stringify({fixture:'full beach spawn regression',bulk:lab.count,sand:lab.sand.parcels.length,objects:lab.balls.length,rows,pass:rows.length===8&&rows.every(v=>v.finite&&v.invalid===0&&v.renderMs<5000&&v.stepMs<5000)},null,2);
 }catch(e){result.textContent=JSON.stringify({rows,error:e.stack,pass:false},null,2);}};
fixture();
