import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterLab} from '../src/water-lab.js';
import {riverCenter,riverBottom,riverHeight,riverVelocity,RIVER_BOUNDS,RIVER_BED} from '../src/water-lab-river.js';
import {fieldLayout} from '../src/water-lab-field.js';
import {soluteCoefficients} from '../src/water-lab-solutes.js';
const mock={extensions:{has:()=>false}};

test('long S channel has recessed banks, continuous pond entry and adjustable downhill grade',()=>{
 assert.ok(riverCenter(-46)>2.5);assert.ok(riverCenter(-32)<-2.5);
 for(const z of [-48,-30,-9,12,24]){const x=riverCenter(z);assert.ok(riverHeight([x+3.4,0,z])>riverHeight([x,0,z])+1.4);}
 assert.ok(riverHeight([riverCenter(-51),0,-51],.2)>riverHeight([0,0,42],.2)+5);
 for(let z=27;z<42;z+=.1)assert.ok(Math.abs(riverHeight([riverCenter(Math.min(z,33)),0,z+.1])-riverHeight([riverCenter(Math.min(z,33)),0,z]))<.2);
 const layout=fieldLayout(.42,.5,RIVER_BOUNDS);assert.equal(layout.min[2],-60);assert.ok(layout.dimensions[2]>=570);assert.ok(layout.width<=8192&&layout.height<=8192);
});

test('gravity drives the channel even with source speed and pump flow at zero',()=>{
 const distance=[];
 for(const slope of [0,.15]){
  const lab=new WaterLab(mock);lab.riverSlope=slope;lab.sourceSpeed=0;lab.configure('river');lab.flow=0;lab.detail.enabled=false;
  const z=-10,x=riverCenter(z);lab.positions=new Float32Array([x,riverBottom(z,slope)+.14,z,0]);lab.velocities=new Float32Array(4);lab.chem=new Float32Array(4);lab.neighborCounts=new Uint16Array(1);
  for(let i=0;i<90;i++)lab.step(1/60);
  assert.ok(lab.positions.every(Number.isFinite));distance.push(lab.positions[2]-z);
 }
 assert.ok(Math.abs(distance[0])<.02);assert.ok(distance[1]>.08,JSON.stringify(distance));
 assert.ok(Math.abs(Math.hypot(...riverVelocity(-15,4,2)) -2)<1e-12);
});

test('eroded bed volume is transported to the pond and visibly deposited with a conserved ledger',()=>{
 const lab=new WaterLab(mock);lab.configure('river');lab.velocities.fill(0);
 const z=-12,x=riverCenter(z);lab.positions=new Float32Array([x,riverBottom(z)+.14,z,0]);lab.velocities=new Float32Array([0,0,2,0]);lab.chem=new Float32Array(4);lab.neighborCounts=new Uint16Array(1);
 for(let i=0;i<90;i++)lab.exchangeSediment(1/60);
 const carried=lab.suspendedSediment;assert.ok(carried>.001);assert.ok(lab.bedDelta([x,0,z])<-.015);
 lab.positions.set([0,.19,42,0]);lab.velocities.fill(0);
 for(let i=0;i<120;i++)lab.exchangeSediment(1/60);
 assert.ok(lab.suspendedSediment<carried*.1);assert.ok(lab.bedDelta([0,0,42])>.015);assert.ok(lab.deposited>0);
 assert.ok(Math.abs(lab.bedStock.reduce((a,b)=>a+b,0)+lab.suspendedSediment-lab.initialBed)<1e-7);
 assert.ok(lab.bedStock.every(v=>v>=-1e-12));assert.equal(lab.bedData.length,RIVER_BED.width*RIVER_BED.height*4);
});

test('tannin slider changes amber extinction and scattering; dye remains strongly chromatic',()=>{
 const base=soluteCoefficients([0,0,0],0,.2);[.492,.291,.27].forEach((v,k)=>assert.ok(Math.abs(base.extinction[k]-v)<1e-12));
 const clean=soluteCoefficients([0,0,0]),tannin=soluteCoefficients([0,0,0],1),dye=soluteCoefficients([1,0,0]);
 for(let k=0;k<3;k++){assert.ok(tannin.extinction[k]>clean.extinction[k]);assert.ok(tannin.scatter[k]>clean.scatter[k]);}
 assert.ok(tannin.extinction[2]>tannin.extinction[0]);assert.ok(dye.extinction[0]>dye.extinction[2]*5);
 const lab=new WaterLab(mock);lab.configure('river');const dyeMass=lab.addSoluteNear('dye',[riverCenter(-16),riverBottom(-16)+.5,-16]);assert.ok(dyeMass>2);assert.ok(Math.max(...lab.chem)>1);
});

test('the fuller river remains bounded, and inlet speed applies only when recycling from the pond',()=>{
 const lab=new WaterLab(mock);lab.configure('river');assert.ok(lab.volume>1400);assert.ok(lab.count<=lab.particleBudget);
 for(const speed of [0,8]){
  lab.sourceSpeed=speed;lab.positions=new Float32Array([0,1,45,0]);lab.velocities=new Float32Array(4);lab.chem=new Float32Array([.3,0,0,0]);lab.pumpCursor=0;lab.pumpBudget=1;
  lab.pump(0);assert.ok(lab.positions[2]<-52);assert.ok(Math.abs(Math.hypot(...lab.velocities.subarray(0,3))*lab.spec.scale-speed)<1e-6);assert.equal(lab.chem[0],Math.fround(.3));
  const position=lab.positions.slice(),velocity=lab.velocities.slice();lab.sourceSpeed=3;lab.pumpBudget=1;lab.pump(0);assert.deepEqual(lab.positions,position);assert.deepEqual(lab.velocities,velocity);
 }
});
