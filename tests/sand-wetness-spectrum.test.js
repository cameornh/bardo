import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed} from '../src/sand-lab/sand.js';
import {sandMaterial,sandMobility,sandVelocityExchange} from '../src/sand-lab/sand-material.js';
import {inspectSandRay,inspectSandMaterial,wetnessColor} from '../src/sand-lab/wetness-view.js';
import {Walker} from '../src/sand-lab/walker.js';
import {makeBody,playerBodyContact,bodyVolume} from '../src/sand-lab/objects.js';
const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
const flat=()=>{const b=new SandBed(33);b.base.fill(-.7);b.update();return b;};
const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function add(b,wet,position=[0,.6,0]){const p={id:b.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*.2**3*.56,packing:.56,wet,memory:wet};b.parcels.push(p);return p;}

test('all moisture-dependent coefficients vary continuously across the full saturation range',()=>{
 for(const memory of [0,.1,.35,.7,1]){
  let previous=sandMaterial(0,memory);
  for(let i=1;i<=10000;i++){
   const wet=i/10000,next=sandMaterial(wet,memory);
   for(const key of Object.keys(next)){
    assert.ok(Number.isFinite(next[key]));assert.ok(Math.abs(next[key]-previous[key])<.06,`${key} jumps at ${wet}`);
    assert.ok(key==='dispersion'?next[key]<=previous[key]:next[key]>=previous[key],`${key} reverses at ${wet}`);
   }
   assert.ok(Math.abs(sandMobility(wet,memory)-sandMobility(wet-.0001,memory))<.002);
   previous=next;
  }
 }
 for(const w of [.05,.2,.35,.5,.7,.9])assert.ok(sandMaterial(w).adhesion<sandMaterial(w+.05).adhesion,'no early full-strength plateau');
 assert.ok(sandMaterial(.05,.05).adhesion<.01);
 assert.ok(sandMaterial(0,.05).residual<1e-8,'slight moisture is not a permanent clay conversion');
 near(sandMaterial(0,1).adhesion,.2);
});

test('damp mobile grains exchange progressively more momentum with exact conservation',()=>{
 let previous=0;
 for(const wet of [0,.001,.05,.2,.35,.5,.7,.9,1]){
  const a={mass:2,wet,memory:wet,velocity:[0,1,2]},b={mass:3,wet,memory:wet,velocity:[4,3,-1]};
  sandVelocityExchange(a,b,.1);
  for(let k=0;k<3;k++)near(a.velocity[k]*2+b.velocity[k]*3,[12,11,1][k]);
  assert.ok(a.velocity[0]>=previous);previous=a.velocity[0];
 }
});

test('dry-to-damp drops transfer a continuously decreasing fraction to the loose bed',()=>{
 let previous=1;
 for(const wet of [0,.001,.01,.05,.15,.3,.4,.45,.5,.55,.7,.9,1]){
  const b=flat(),p=add(b,wet),mass=p.mass,total=b.totalMass();b.deposit(p,mass);
  const transferred=(mass-p.mass)/mass;
  assert.ok(transferred<=previous+1e-12);previous=transferred;near(b.totalMass(),total);
  if(wet<=.05)assert.ok(transferred>.99999,'slightly damp scoop must still disperse');
  if(wet===.4)assert.ok(transferred>.5&&transferred<.8,'an intermediate response, not a dry/wet mode');
  if(wet===1)near(transferred,0);
 }
});

test('grabbed damp sand retains its own wetness and relaxes between the dry and saturated limits',()=>{
 let lastAspect=0;
 for(const wet of [0,.05,.2,.3,.4,.45,.5,.65,.95]){
  const b=flat();b.wet.fill(.95);b.memory.fill(.95);const source=add(b,wet,[0,.2,0]);source.anchored=true;
  const p=b.extract([0,.2,0],.3,[0,0,0],true).find(p=>p===source);assert.ok(p);near(p.wet,wet);
  p.position[1]=.8;p.held=false;const mass=b.totalMass();
  for(let i=0;i<120;i++)b.step(1/30,air,calm,10,0,.08);
  assert.ok(p.anchored&&p.mass>0);assert.ok(p.wet<=wet&&p.wet>=wet*.99);
  const aspect=p.aspect||1;assert.ok(aspect>=lastAspect-1e-5,`${wet}: ${aspect} < ${lastAspect}`);lastAspect=aspect;
  if(wet<=.05)assert.ok(aspect<.34);
  if(wet===.4)assert.ok(aspect>.45&&aspect<.65);
  if(wet===.95)near(aspect,1);
  near(b.totalMass(),mass);
 }
});

test('material merging averages retained history instead of assigning a whole grab the wettest grain',()=>{
 const b=flat();b.memory.fill(0);b.memory[16*b.n+16]=1;
 const p=b.takeSmallSphere([.05,0,.05],.01);assert.ok(p.memory>0&&p.memory<1);
});

test('hover reads exact parcel moisture, including held sand, respecting object occlusion and CSG cuts',()=>{
 const b=flat(),p=add(b,.31729,[0,.5,0]);p.held=true;
 let hit=inspectSandRay(b,[],[0,2,0],[0,-1,0]);assert.equal(hit.parcel,p);near(hit.wetness,.31729);
 b.wet.fill(.8);near(inspectSandMaterial(b,[0,.7,0]).wetness,.31729);
 const ball=makeBody('rock','sphere',.3,[0,1.5,0]);assert.equal(inspectSandRay(b,[ball],[0,2,0],[0,-1,0]),null);
 p.cuts=[{offset:[0,.15,0],radius:.4}];hit=inspectSandRay(b,[],[0,2,0],[0,-1,0]);assert.equal(hit.parcel,null);near(hit.wetness,.8);
 p.cuts=[];p.held=false;p.windborne=true;hit=inspectSandRay(b,[],[0,2,0],[0,-1,0]);assert.equal(hit.parcel,null);
 assert.equal(inspectSandRay(b,[],[0,2,0],[0,1,0]),null);
 for(let i=0;i<=100;i++)assert.ok(wetnessColor(i/100).every(v=>v>=0&&v<=1));
});

test('heavier player reduces outside impulses without changing gravity or Space buoyancy',()=>{
 const current=new Walker(),before=new Walker();before.mass=80;
 for(const w of [current,before]){w.position=[0,10,0];for(let i=0;i<60;i++)w.step(1/60,{},()=>null,()=>0,{air:[40,0,0]});}
 assert.ok(current.velocity[0]>0&&current.velocity[0]<before.velocity[0]);
 const gravity=new Walker();gravity.position=[0,10,0];gravity.step(.1,{},()=>null);near(gravity.velocity[1],-.981,.005);
 const swim=new Walker();swim.position=[0,10,0];swim.step(.1,{buoyant:true},()=>null,()=>1);assert.ok(swim.velocity[1]>0);
 for(const mass of [80,100]){const w=new Walker();w.mass=mass;const b=makeBody('rock','sphere',.3,[-.5,.82,0],[4,0,0]),bodyMass=bodyVolume(b)*b.ratio*1000;playerBodyContact(w,b,[0,.82,0]);near(w.velocity[0]*mass+b.velocity[0]*bodyMass,bodyMass*4);}
});
