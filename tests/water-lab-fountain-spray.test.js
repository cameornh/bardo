import test from 'node:test';
import assert from 'node:assert/strict';
import {jetBreakupStep, FountainDetail} from '../src/water-lab-fountain-spray.js';
import {WaterLab} from '../src/water-lab.js';
import {fountainNozzles} from '../src/water-lab-fountain.js';
import {labAirVelocity} from '../src/water-lab-air.js';
const mock={extensions:{has:()=>false}};
const flow={spacing:.21,scale:2,speed:44,deformation:0,breakup:0,neighbors:5,previousNeighbors:5,exposure:1};

test('jet breakup develops in flight and retains emission after support is lost at the crest',()=>{
 let state={load:.85,damage:0},early,late;
 for(let i=0;i<450;i++){
  state=jetBreakupStep(state,{...flow,speed:Math.max(0,44-i*.0981),neighbors:i<400?5:0,previousNeighbors:i===400?5:i<400?5:0},.01);
  if(i===20)early={...state};if(i===400)late={...state};
 }
 assert.ok(late.energy>early.energy,`${late.energy} > ${early.energy}`);
 assert.ok(late.mist>early.mist);assert.ok(state.energy>.3);assert.ok(state.mist>.1);
 for(let i=0;i<5000;i++)state=jetBreakupStep(state,{...flow,speed:0,neighbors:0,previousNeighbors:0},.01);
 assert.ok(state.energy<1e-4,'spent liquid must not emit indefinitely');
});
test('a quiet unaerated jet in matching air does not gain whitewater merely from gravity or height',()=>{
 let state={load:0,damage:0};for(let i=0;i<1000;i++)state=jetBreakupStep(state,{...flow,speed:0},.01);
 assert.equal(state.energy,0);assert.equal(state.mist,0);
 const strain=jetBreakupStep(state,{...flow,speed:0,deformation:12,breakup:1},.1);assert.ok(strain.energy>0);
});
test('fountain emits fine spray and mist at actual high liquid positions, including isolated fragments',()=>{
 const lab=new WaterLab(mock);lab.configure('fountain');const d=lab.detail;assert.ok(d instanceof FountainDetail);
 lab.positions=new Float32Array([0,45,0,0]);lab.velocities=new Float32Array([0,0,0,0]);lab.neighborCounts=new Uint16Array([0]);lab.aerationActivity=new Float32Array([2,0]);lab.surfaceBreakup=new Float32Array([1]);lab.surfaceMetrics=new Float32Array([1,0,0,0]);
 d.jetPrimed=true;d.launch(0,fountainNozzles(lab.fountain)[0]);d.jetStates[0].damage=1.4;
 const volume=lab.volume;for(let i=0;i<30;i++)d.emit(lab,1/30);
 assert.ok(d.jetSprayEmitted>20);assert.ok(d.jetMistEmitted>10);assert.equal(lab.volume,volume);
 for(let i=0;i<d.pending;i++)assert.ok(Math.abs(d.spawn[0].image.data[i*4+1]-45)<lab.spacing);
 d.reset();assert.equal(d.jetStates.length,0);assert.equal(d.jetMistEmitted,0);
});
test('recirculation clears old breakup memory and small physical volumes shed less detail',()=>{
 const d=new FountainDetail(mock,32768),n={aeration:.85};d.launch(8,n);d.jetStates[8].damage=2;d.jetStates[8].mistBudget=32;d.launch(8,n);
 assert.equal(d.jetStates[8].damage,0);assert.equal(d.jetStates[8].mistBudget,0);
 const full=jetBreakupStep({load:0,damage:0},flow,1),tiny=jetBreakupStep({load:0,damage:0},{...flow,scale:.02,speed:4.4},1);
 assert.ok(full.energy>tiny.energy);
});
test('high fountain wind uses open-air variation rather than clamping at the old atlas top',()=>{
 const lab=new WaterLab(mock);lab.configure('fountain');lab.wind=12;lab.windTurbulence=1;lab.time=3;lab.air.update(lab);
 const p=[1,45,.7],high=lab.air.sample(p),reference=labAirVelocity(p,lab);
 assert.deepEqual(high,reference);assert.notDeepEqual(high,lab.air.sample([1,13,.7]));
});

test('maximum fountain flight has spare headroom above the previous ceiling',()=>{const lab=new WaterLab(mock);lab.configure('fountain');assert.ok(lab.solid([0,70,0])>10);});

test('impact-ejected liquid outside the nozzle lineage can develop spray and mist',()=>{
 const lab=new WaterLab(mock);lab.configure('fountain');const d=lab.detail;
 lab.positions=new Float32Array([0,75,0,0]);lab.velocities=new Float32Array([0,20,0,0]);lab.neighborCounts=new Uint16Array([0]);lab.aerationActivity=new Float32Array([1,0]);lab.surfaceBreakup=new Float32Array([0]);lab.surfaceMetrics=new Float32Array([0,0,0,0]);d.reset();d.jetPrimed=true;
 for(let i=0;i<90;i++)d.emit(lab,1/30);
 assert.ok(d.jetSprayEmitted>50);assert.ok(d.jetMistEmitted>10);
});
