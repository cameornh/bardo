import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from 'three';
import {WaterLab} from '../src/water-lab.js';
import {pipeInlet} from '../src/water-lab-inlet.js';
import {RIVER_ROCKS,riverRockDistance,riverBottom,riverCenter} from '../src/water-lab-river.js';
import {buildNeighbors} from '../src/water-lab-model.js';
const mock={extensions:{has:()=>false}};

test('pending GPU frames retain elapsed time and update camera droplets at the requested speed',async()=>{
 const lab=new WaterLab({...mock,readRenderTargetPixelsAsync(){}}),camera=new PerspectiveCamera();lab.enabled=true;lab.asyncSimulation=true;lab.gpu.cpu=false;lab.simulationSpeed=.5;camera.position.set(0,5,7);
 let complete;lab.gpu.solve=()=>new Promise(resolve=>complete=resolve);lab.finishStep=()=>{};
 lab.wetting.addLens(1,[.5,.5]);lab.advance(lab.timestep*2+.001,camera);assert.ok(lab.asyncPending);
 const before=lab.accumulator,age=lab.wetting.lens[0].age;lab.advance(.1,camera);
 assert.ok(Math.abs(lab.accumulator-before-.05)<1e-8);assert.ok(Math.abs(lab.wetting.lens[0].age-age-.05)<1e-8);
 lab.enabled=false;complete(lab.positions.slice());await lab.asyncPending;
});

test('a laminar inlet has coherent parallel velocities while forcing creates transverse fluctuations',()=>{
 const laminar=[],turbulent=[];for(let i=0;i<100;i++){laminar.push(pipeInlet(.25,1,1,0,i,i*.01));turbulent.push(pipeInlet(.25,1,1,2,i,i*.01));}
 assert.ok(laminar.every(p=>p.velocity[1]===0&&p.velocity[2]===0));
 assert.ok(turbulent.reduce((a,p)=>a+p.velocity[1]**2+p.velocity[2]**2,0)/100>2);
 assert.ok(laminar[0].rate<80);assert.equal(pipeInlet(.25,1,2,0,0,0).rate,laminar[0].rate*2);
 assert.ok(new Set(laminar.map(p=>p.point.slice(1).join(','))).size>1);
});

test('the river has solid faceted obstacles throughout its extended channel',()=>{
 assert.equal(RIVER_ROCKS.length,22);assert.ok(RIVER_ROCKS.at(-1).z-RIVER_ROCKS[0].z>75);
 for(const r of RIVER_ROCKS){assert.ok(riverRockDistance([r.x,riverBottom(r.z)+r.height*.3,r.z])<0);assert.ok(riverRockDistance([r.x,riverBottom(r.z)+r.height*2,r.z])>0);}
});

test('settling moves suspended sediment downward before deposition, conserving total material',()=>{
 const lab=new WaterLab(mock);lab.configure('river');const z=40,x=0;
 lab.positions=new Float32Array([x,2.8,z,0,x,2.8-lab.spacing,z,0]);lab.velocities=new Float32Array(8);lab.chem=new Float32Array([0,0,.2,0,0,0,0,0]);lab.gpu.neighbors=buildNeighbors(lab.positions,lab.spacing).data;
 const before=lab.suspendedSediment;lab.exchangeSediment(.1);
 assert.ok(lab.chem[2]<.2);assert.ok(lab.chem[6]>0);assert.ok(Math.abs(lab.suspendedSediment-before)<1e-9);
});

test('the return pump leaves sediment-laden pond water available to settle',()=>{
 const lab=new WaterLab(mock);lab.configure('river');lab.positions=new Float32Array([0,1,45,0]);lab.velocities=new Float32Array(4);lab.chem=new Float32Array([0,0,.1,0]);lab.pumpBudget=1;lab.pump(0);assert.equal(lab.positions[2],45);assert.equal(lab.chem[2],Math.fround(.1));
});


test('airborne mist crosses the invisible bulk-fluid boundary without being killed or clipped',()=>{
 const lab=new WaterLab(mock);lab.positions=new Float32Array(0);lab.velocities=new Float32Array(0);lab.chem=new Float32Array(0);lab.wind=0;
 lab.detail.addMarker([5.45,4,0],[3,0,0],3,.008,9,.48);lab.detail.advance(.1,lab);
 const p=lab.detail.fallback[0].image.data,v=lab.detail.fallback[1].image.data;
 assert.ok(p[0]>5.5);assert.ok(p[3]<v[3]);assert.ok(p[3]>.09&&p[3]<.11);
 assert.ok(lab.solid([5.8,4,0])<0);assert.ok(lab.solid([5.8,4,0],true,false)>0);
});
