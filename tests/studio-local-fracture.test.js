import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {fractureGrid,fragmentBoxes,islands} from '../src/asset-studio/fracture-grid.js';
import {belowBondYield,factorNetwork,networkLayout,solveBonds} from '../src/asset-studio/fracture-stress.js';
import {structureBody} from '../src/asset-studio/fracture.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {jointDefaults} from '../src/asset-studio/physics-data.js';
import {stamp} from '../src/asset-studio/model.js';
import {fractureFixture} from './studio-fracture-fixture.js';

const step=(sim,n)=>{for(let i=0;i<n;i++)sim.step();};
const close=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);
const create=(l,g)=>StudioPhysics.create(l,'world','starter',g);
const owner=(s,x)=>structureBody(s.root,new Vector3(x,0,0));
const volume=s=>8*s.half[0]*s.half[1]*s.half[2];
test('a locally painted joint fails twice under weight; both detached wings collide, while strong adhesion holds',async()=>{
 const weak=await create(fractureFixture()),strong=await create(fractureFixture(8e7));
 try{
  const s=weak.structures[0],mass=s.root.body.mass();
  step(weak,35);step(strong,35);
  assert.equal(s.bodies.size,3);assert.equal(strong.structures[0].bodies.size,1);
  const cuts=s.grid.bonds.filter(e=>e.broken);assert.equal(cuts.length,2);
  assert.ok(cuts.some(e=>e.center[0]<-.4)&&cuts.some(e=>e.center[0]>.4));
  assert.ok(cuts.every(e=>s.grid.nodes[e.a].material!==s.grid.nodes[e.b].material));
  const left=owner(s,-1.8),right=owner(s,1.8);
  assert.notEqual(left,right);assert.notEqual(left,s.root);assert.equal(s.root.body.isFixed(),true);
  close([...s.bodies].reduce((m,r)=>m+r.body.mass(),0),mass,.001);
  const y=left.body.worldCom().y;step(weak,15);
  assert.ok(left.body.worldCom().y<y-.1&&right.body.linvel().y<-1);
  for(const r of [left,right]){
   const p=r.body.worldCom(),ray=new weak.R.Ray({x:p.x,y:p.y+1,z:p.z},{x:0,y:-1,z:0});
   assert.ok(Array.from({length:r.body.numColliders()},(_,i)=>r.body.collider(i).castRay(ray,2,true)).some(t=>t>=0&&t<2));
  }
 }finally{weak.dispose();strong.dispose();}
});
test('a carved neck in a single material breaks off-center under gravity; the full cross section carries the same load',async()=>{
 function make(carve){
  const l=fractureFixture(),p=l.assets[0].parts[0];
  l.materials.find(m=>m.id==='wood').tensileStrength=1e6;
  p.stamps=[stamp('box','add',[2,0,0],[2,.33,.32],'wood',0)];
  if(carve)p.stamps.push(...[-1,1].map(s=>stamp('box','subtract',[1.4,s*.37,0],[.32,.30,.5],'wood',0)));
  return create(l);
 }
 const sculpt=await make(true),whole=await make(false);
 try{
  step(sculpt,30);step(whole,180);
  assert.equal(whole.structures[0].brokenBonds,0);
  const s=sculpt.structures[0],cuts=s.grid.bonds.filter(e=>e.broken);
  assert.equal(s.bodies.size,2);assert.equal(cuts.length,1);
  assert.ok(Math.abs(cuts[0].center[0]-1.4)<.33);
 }finally{sculpt.dispose();whole.dispose();}
});
test('a detached wing can break again under opposed pulls and carries the active pull to its new piece',async()=>{
 const l=fractureFixture(),wood=l.materials.find(m=>m.id==='wood');
 // Enough strength for the detached section in free fall, but less than the test pull.
 wood.tensileStrength=7e4;wood.cohesion=0;
 const sim=await create(l);
 try{
  step(sim,12);const s=sim.structures[0],r=owner(s,-1.9),before=s.bodies.size;
  assert.ok(r!==s.root&&r.regions.length>1);
  const end=new Vector3(-1.95,0,0),inside=new Vector3(-1.28,0,0);
  sim.addPulse(r.key,end,new Vector3(-95000,0,0),.32);
  sim.addPulse(r.key,inside,new Vector3(95000,0,0),.32);
  step(sim,16);
  assert.ok(s.bodies.size>before);
  assert.notEqual(owner(s,inside.x),owner(s,end.x));
  assert.equal(sim.pulses.find(f=>f.force.x<0).key,owner(s,end.x).key);
 }finally{sim.dispose();}
});
test('the stress network recovers axial force and bending stress at every loaded section',()=>{
 const m=fractureFixture().materials.find(m=>m.id==='wood');
 const grid=fractureGrid([{type:'box',center:[3,0,0],half:[3,.2,.1],materialId:'wood'}],[1.5,1,2],new Map([['wood',m]]));
 const ids=grid.nodes.map(n=>n.index),net=factorNetwork(ids,grid),loads=new Float64Array(6*ids.length);
 const [a,b]=[ids[0]*6,ids.at(-1)*6],f=1200,t=150;
 loads[a]=-f;loads[b]=f;loads[a+5]=-t;loads[b+5]=t;
 let count=0;solveBonds(net,loads,(e,ratio,axial)=>{
  const expected=(f/.16+t/(.4**3/6))/e.strength;
  close(axial,f,.00001);close(ratio,expected,1e-9);count++;
 });assert.equal(count,ids.length-1);
});
test('the energy bound only skips intact bonds below yield under mixed forces and torques',()=>{
 const material=fractureFixture().materials.find(m=>m.id==='wood');
 const grid=fractureGrid([{type:'box',center:[.4,-.1,.7],half:[.6,.45,.3],materialId:'wood'}],
  [1,1.3,.8],new Map([['wood',material]]));
 const ids=grid.nodes.map(n=>n.index),layout=networkLayout(ids,grid),net=factorNetwork(ids,grid,layout);
 assert.ok(!net.tree);
 let safe=0,overloaded=0;
 for(const scale of [1,5e3,1e6,1e9])for(let m=1;m<=4;m++){
  const loads=new Float64Array(6*ids.length);
  for(let i=1;i<ids.length;i++)for(let k=0;k<6;k++){
   const v=scale*Math.sin(i*.37+k*m)*Math.cos(i*m*.47);loads[6*i+k]=v;loads[k]-=v;
  }
  const skip=belowBondYield(layout,loads);let peak=0;
  solveBonds(net,loads,(_,ratio)=>{peak=Math.max(peak,ratio);});
  if(skip){assert.ok(peak<1);safe++;}
  if(peak>1){assert.equal(skip,false);overloaded++;}
 }
 assert.ok(safe&&overloaded);
});
test('diagonal contact and carved space provide no bond; collider merging conserves distinct added materials',()=>{
 const l=fractureFixture(),materials=new Map(l.materials.map(m=>[m.id,m]));
 const box=(center,id)=>({type:'box',center,half:[.5,.5,.5],materialId:id});
 const grid=fractureGrid([box([0,0,0],'wood'),box([1,0,0],'inlay'),box([2,1,0],'wood')],[1,1,1],materials);
 const groups=islands(grid);assert.equal(groups.length,2);
 const joined=groups.find(g=>g.some(i=>grid.nodes[i].material.id==='inlay'));
 const shapes=fragmentBoxes(grid,joined);close(shapes.reduce((v,b)=>v+volume(b),0),2);
 assert.deepEqual(new Set(shapes.map(s=>s.materialId)),new Set(['wood','inlay']));
});

test('a collision against a mounted sculpt breaks the struck side even in zero gravity',async()=>{
 for(const [adhesion,expected] of [[15000,1],[8e7,0]]){
  const l=fractureFixture(adhesion),weight={...structuredClone(l.assets[0].parts[0]),id:'weight',physics:{fixed:false},
   stamps:[stamp('box','add',[1.65,1,0],[.22,.25,.22],'stone',0)]};
  l.assets[0].parts.push(weight);
  const sim=await create(l,0);
  try{
   const s=sim.structures[0];
   sim.get('sample','weight').body.setLinvel({x:0,y:-7,z:0},true);
   for(let i=0;i<40&&!s.brokenBonds;i++)sim.step();
   assert.equal(s.brokenBonds,expected);
   if(expected)assert.ok(s.grid.bonds.find(e=>e.broken).center[0]>.5);
  }finally{sim.dispose();}
 }
});
test('parallel load paths share traction, then carry the full load around a missing bond',()=>{
 const l=fractureFixture(8e7),materials=new Map(l.materials.map(m=>[m.id,m]));
 for(const size of [3,4]){
  const boxes=[];
  for(let x=0;x<size;x++)for(let y=0;y<size;y++)for(let z=0;z<size;z++){
   boxes.push({type:'box',center:[x,y,z],half:[.5,.5,.5],materialId:(x+y+z)%2?'inlay':'wood'});
  }
  const grid=fractureGrid(boxes,[1,1,1],materials),ids=grid.nodes.map(n=>n.index),load=new Float64Array(ids.length*6);
  for(const node of grid.nodes)for(const s of node.shapes){
   const outerLeft=Math.abs(s.center[0]-s.half[0]+.5)<1e-7,outerRight=Math.abs(s.center[0]+s.half[0]-(size-.5))<1e-7;
   const f=(Number(outerRight)-Number(outerLeft))*4*s.half[1]*s.half[2]*100,j=6*node.index;
   load[j]+=f;load[j+4]+=s.center[2]*f;load[j+5]-=s.center[1]*f;
  }
  const net=factorNetwork(ids,grid);
  assert.ok(!net.tree);if(size===4)assert.ok(net.sparse);
  solveBonds(net,load,(e,ratio,axial)=>close(axial/e.area,e.axis===0?100:0,.01));
  const middle=grid.bonds.find(e=>e.axis===0&&e.center[0]>.4);
  middle.broken=true;
  assert.equal(islands(grid).length,1);
  const diverted=factorNetwork(ids,grid);
  let sum=0,highest=0;
  for(let i=0;i<4;i++){
   sum=0;highest=0;
   solveBonds(diverted,load,(e,ratio,axial)=>{
    if(e.axis===0&&Math.abs(e.center[0]-middle.center[0])<1e-7){
     sum+=axial;highest=Math.max(highest,axial/e.area);
    }
   });
   if(!diverted.pending)break;
  }
  close(sum,100*size*size,.1);assert.ok(highest>101);
 }
});

test('a joint samples the material at its anchor inside a multi-material sculpt',async()=>{
 for(const [anchor,expected] of [[[-.86,0,0],0],[[0,0,0],1]]){
  const l=fractureFixture(0),p=l.assets[0].parts[0];
  p.physics.fixed=false;p.joint={...jointDefaults(),anchor};
  const sim=await create(l,0);
  try{assert.equal(sim.joints.length,expected);}
  finally{sim.dispose();}
 }
});
