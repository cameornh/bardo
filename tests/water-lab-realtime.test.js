import {foamDiffuseTransmission} from '../src/water-lab-foam-diffusion.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from 'three';
import {WaterLab} from '../src/water-lab.js';
import {Walker} from '../src/first-person.js';
import {detailOpacity} from '../src/water-lab-detail-opacity.js';
import {playerImmersion,softenPlayerImpulse} from '../src/water-lab-player.js';
import {createMotion,stepMotion,densityAt} from '../src/water-lab-model.js';
const mock={extensions:{has:()=>false}};

test('15 Hz display intervals advance fixed physics through full elapsed time',()=>{
 const lab=new WaterLab(mock),camera=new PerspectiveCamera();lab.enabled=true;let integrated=0;lab.step=dt=>integrated+=dt;lab.detail.advance=()=>{};
 for(let i=0;i<90;i++)lab.advance(1/15,camera);
 assert.ok(Math.abs(integrated-6)<lab.timestep);assert.ok(lab.accumulator<lab.timestep);assert.equal(lab.droppedTime,0);
 lab.simulationSpeed=.25;const before=integrated;for(let i=0;i<60;i++)lab.advance(1/15,camera);
 assert.ok(Math.abs(integrated-before-1)<lab.timestep);
});

test('airborne spray fades through most of its lifetime without extending expiry',()=>{
 const life=2,alpha=age=>detailOpacity(0,age,life,1),values=Array.from({length:90},(_,i)=>alpha((i+10)/100*life));
 assert.ok(alpha(.2)<.65);assert.ok(alpha(.8)<alpha(.4));assert.ok(values.every((v,i)=>i===0||v<=values[i-1]));
 const maxSlope=Math.max(...values.slice(1).map((v,i)=>(values[i]-v)/.02));assert.ok(maxSlope<.6);
 assert.ok(alpha(1.95)<.002);assert.equal(alpha(life),0);assert.equal(alpha(life+1),0);
});

test('water outside the displaced player cavity supplies swimming buoyancy',()=>{
 const data=[],s=.14,eye=[0,2.5,0];
 for(let y=.1;y<4;y+=s)for(let z=-1.3;z<1.3;z+=s)for(let x=-1.3;x<1.3;x+=s)if(Math.hypot(x,z)>.34)data.push(x,y,z,0);
 const positions=new Float32Array(data),wet=playerImmersion(positions,eye,.28,1.65,s);
 assert.ok(densityAt(positions,[0,2,0],s)<.01);assert.ok(wet>.8);
 const w=new Walker();w.position=eye.slice();for(let i=0;i<15;i++)w.step(1/15,{buoyant:true},()=>null,()=>wet);assert.ok(w.velocity[1]>.8);
 for(let i=0;i<30;i++)w.step(1/15,{},()=>null,()=>wet);assert.ok(w.velocity[1]<0);
 assert.equal(playerImmersion(positions,[0,6,0],.28,1.65,s),0);
});

test('player contact reduces projected launch momentum but retains incoming flow',()=>{
 assert.deepEqual(softenPlayerImpulse([4,1,2],[1,1,2],[1,0,0],1),[1.5999999999999996,1,2]);
 assert.deepEqual(softenPlayerImpulse([-2,1,2],[1,1,2],[1,0,0],1),[-2,1,2]);
});

test('cup rotation tracks requested rpm in simulation seconds independent of fixed-step size',()=>{
 const angles=[];for(const dt of [1/30,Math.sqrt(.05)/35]){const motion=createMotion();motion.targetSpin=Math.PI;let time=0;while(time<3){stepMotion(motion,dt);time+=dt;}const start=motion.spin;for(let i=0;i<Math.round(2/dt);i++)stepMotion(motion,dt);const elapsed=Math.round(2/dt)*dt;assert.ok(Math.abs(motion.spinVelocity*30/Math.PI-30)<.01);assert.ok(Math.abs((motion.spin-start)/elapsed-Math.PI)<.001);angles.push(motion.spin);}
});

// The small cup previously inherited an arbitrary scale-only step cap. The
// step must instead respect the resolved spacing and capillary timescale.
test('small-vessel steps follow resolved gravity and capillary scales',()=>{
 const lab=new WaterLab(mock);lab.configure('glass');const h=lab.spacing*lab.spec.scale;
 assert.ok(lab.timestep>.018&&lab.timestep<.022);assert.ok(.5*9.81*lab.timestep**2<=.2*h+1e-12);
 lab.configure('glass',.1);assert.ok(lab.timestep<.001);
});

test('rain, nearby splash tracers and sweeping through drops collect on the camera',()=>{
 const lab=new WaterLab(mock);lab.configure('pool');lab.positions=new Float32Array(0);lab.velocities=new Float32Array(0);lab.chem=new Float32Array(0);
 const camera=new PerspectiveCamera();camera.position.set(0,2,0);camera.updateMatrixWorld();lab.wetting.setCamera(camera);lab.rain.enabled=true;lab.rain.rate=600;
 for(let i=0;i<30;i++)lab.wetting.stepLens(1/30);assert.ok(lab.wetting.lens.length>0);
 lab.rain.enabled=false;lab.wetting.lens=[];for(let i=0;i<16;i++)lab.wetting.trace([0,2,-.3],[0,0,2],0);lab.wetting.step(.1);assert.ok(lab.wetting.lens.length>0);
 lab.wetting.lens=[];camera.position.set(0,2,1);camera.updateMatrixWorld();lab.wetting.setCamera(camera);camera.position.set(0,2,-1);camera.updateMatrixWorld();lab.wetting.setCamera(camera,.1);lab.wetting.hitLens([0,2,0],[0,2,0]);assert.ok(lab.wetting.lens.length>0);
});


test('foam and dense mist wet glass, other solids and the camera within fixed budgets',()=>{
 for(const kind of [0,1,2,3]){
  const lab=new WaterLab(mock);lab.configure('pane');const w=lab.wetting;
  // Hit the upper face with each category; mist is caught in its thin contact layer.
  for(let i=0;i<16;i++)w.trace([0,2.048,0],[0,-1,0],kind);
  w.step(.02,false);assert.ok(w.spots.length>0,`glass kind ${kind}`);
  const initial=w.spots[0].radius;for(let j=0;j<20;j++){for(let i=0;i<16;i++)w.trace([0,2.048,0],[0,-1,0],kind);w.step(.02,false);}
  assert.ok(w.spots[0].radius>initial*2);assert.ok(w.spots.length<=64);
  w.collectSurface({point:[3,0,0]},kind,16);assert.ok(w.surfaceSpots.length>0);
  const camera=new PerspectiveCamera();camera.position.set(0,3,0);camera.updateMatrixWorld();w.setCamera(camera);
  for(let i=0;i<16;i++)w.trace([0,3,-.18],[0,0,2],kind);w.step(.05,false);assert.ok(w.lens.length>0,`camera kind ${kind}`);
  for(let i=0;i<10000;i++)w.trace([0,4,0],[0,0,0],kind);assert.ok(w.tracers.length<=256);assert.ok(w.traceCounts[kind]<=64);
 }
});


test('foam floor scattering redistributes light within an energy bound',()=>{
 assert.equal(foamDiffuseTransmission(1),0);assert.equal(foamDiffuseTransmission(.3,0),0);
 for(let i=1;i<100;i++){const t=i/100,fill=foamDiffuseTransmission(t);assert.ok(fill>0);assert.ok(fill+t<=1);}
 assert.ok(foamDiffuseTransmission(.05)>.1);assert.ok(foamDiffuseTransmission(1e-6)<.002);
 assert.ok(foamDiffuseTransmission(.2,.94)>foamDiffuseTransmission(.2,.7));
});
