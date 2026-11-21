import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion,Scene,ShaderMaterial} from 'three';
import {GroundEditView} from '../src/asset-studio/ground-edit-view.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {jointDefaults} from '../src/asset-studio/physics-data.js';
import {part,seedLibrary,stamp,transform} from '../src/asset-studio/model.js';
import {CELL,groundWedge} from '../src/asset-studio/ground-tools.js';
import {liftGround,releaseChunk,moveChunk,strikeGround} from '../src/asset-studio/ground-interaction.js';
import {WindSand} from '../src/asset-studio/wind-sand.js';
import {SandTerrain} from '../src/asset-studio/sand-terrain.js';

const run=(s,n)=>{for(let i=0;i<n;i++)s.step();};
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} vs ${b}`);
function volume(terrain){let sum=0;for(const tile of terrain.tiles.values())for(const h of tile.heights)sum+=h;return sum*CELL**2;}
function library(){
 const l=seedLibrary();l.world.instances=[];l.world.wind={speed:0,heading:0};return l;
}
test('a local sand pit slumps at rest, refills conservatively and never tiles or exhausts the solid cut budget',()=>{
 const l=library(),s=new SandTerrain(new WindSand(),l.materials.find(m=>m.id==='sand'));
 const cut=s.extract(0,0,.9,(x,z)=>s.height(x,z));
 near(volume(s),-cut.volume);
 for(let i=0;i<80;i++)s.advance(.05);
 assert.ok(s.node(0,0)>-.55);near(volume(s),-cut.volume);near(s.offset(12,0),0);
 const before=s.node(0,0);s.deposit(0,0,cut.volume);
 for(let i=0;i<80;i++)s.advance(.05);
 assert.ok(s.node(0,0)>before+.2);near(volume(s),0);
 for(let i=0;i<180;i++)assert.ok(s.extract(-i*.75,-12,.18,(x,z)=>s.height(x,z)));
 near(volume(s),-180*.18*CELL**2);assert.ok(s.revision(-1,-2)>0);
 const neighbor=s.revision(-1,0);s.change(3,2,.05);
 assert.equal(s.revision(-1,0),neighbor);
 s.change(0,2,.05);assert.ok(s.revision(-1,0)>neighbor);
});
test('tool sand settles into the physical ground; repeated scoops and impulses leave no loose piles or bodies',async()=>{
 const l=library(),s=await StudioPhysics.create(l,'world','starter');
 try{
  for(let n=0;n<75;n++){
   const point=new Vector3((n%9-4)*CELL,0,(Math.floor(n/9)-4)*CELL);
   assert.ok(liftGround(s,point));moveChunk(s,point.clone().add(new Vector3(0,.85,0)));
   run(s,12);releaseChunk(s);assert.ok(strikeGround(s,point,3000));run(s,5);
  }
  run(s,600);assert.equal(s.matter.count,0);assert.equal(s.matter.beds.size,0);
  assert.equal(s.chunks.size+s.cuts.nodes.size+s.matter.parts.size,0);near(volume(s.sandTerrain),0);
  assert.equal(s.dunes.tiles.size,0);
 }finally{s.dispose();}
});
async function beam({vertical=false,wind=0,fixed=true,height=4,gravity=9.81,properties={}}={}){
 const l=library(),p=l.assets[0].parts[0],m=l.materials.find(m=>m.id==='wood');
 l.world.groundMaterialId='stone';Object.assign(m,properties);
 p.stamps=[stamp('box','add',vertical?[0,1.5,0]:[1.5,0,0],vertical?[.08,1.5,.08]:[1.5,.08,.08],'wood',0)];
 p.physics={fixed};l.world.instances=[{id:'structure',assetId:'starter',transform:{...transform(),position:[0,height,0]}}];l.world.wind.speed=wind;
 return StudioPhysics.create(l,'world','starter',gravity);
}
test('an anchored cantilever fractures under sustained weight; short loading, free fall and strong material survive',async()=>{
 const s=await beam(),strong=await beam({properties:{tensileStrength:2e7}}),fall=await beam({fixed:false,height:100});
 try{
  const b=s.sections[0];run(s,3);assert.equal(b.status,'intact');
  run(s,177);assert.equal(b.status,'fractured');assert.ok(b.tip.body.worldCom().y<b.root.body.worldCom().y-1);
  near(b.tip.body.mass(),.16**2*1.5*650,.001);
  for(const other of [strong,fall]){run(other,180);assert.equal(other.sections[0].status,'intact');}
 }finally{for(const sim of [s,strong,fall])sim.dispose();}
});
test('a compressed soft post buckles without detaching; steady crosswind breaks a stiffer post',async()=>{
 const soft=await beam({vertical:true,properties:{youngModulus:2e5,tensileStrength:2e6}}),calm=await beam({vertical:true,properties:{youngModulus:1e8}}),
 windy=await beam({vertical:true,wind:55,properties:{youngModulus:1e8}});
 try{
  for(const sim of [soft,calm,windy])run(sim,210);
  assert.equal(soft.sections[0].status,'buckled');assert.ok(Math.abs(soft.sections[0].tip.body.rotation().y)+Math.abs(soft.sections[0].tip.body.rotation().z)+Math.abs(soft.sections[0].tip.body.rotation().x)>.02);
  assert.equal(calm.sections[0].status,'intact');assert.equal(windy.sections[0].status,'fractured');
 }finally{for(const sim of [soft,calm,windy])sim.dispose();}
});
test('a heavy object compresses a soft floor; after unloading elastic depth recovers and plastic depth remains',async()=>{
 const l=library();l.world.groundMaterialId='clay';
 Object.assign(l.materials.find(m=>m.id==='clay'),{youngModulus:90000,yieldStress:800,cohesion:300,restitution:.25});
 const p=l.assets[0].parts[0];p.stamps=[stamp('box','add',[0,0,0],[.25,.25,.25],'stone',0)];
 l.world.instances=[{id:'weight',assetId:'starter',transform:{...transform(),position:[0,.26,0]}}];
 const sim=await StudioPhysics.create(l,'world','starter');
 try{
  run(sim,300);const nodes=[...sim.cuts.nodes.values()];
  assert.ok(nodes.some(n=>n.bearing>.001));assert.ok(nodes.some(n=>n.compaction>.001));
  const body=sim.get('weight',p.id).body;body.setTranslation({x:8,y:3,z:0},true);
  run(sim,360);assert.ok(nodes.every(n=>n.bearing<.0006));assert.ok(nodes.some(n=>n.compaction>.001));
 }finally{sim.dispose();}
});
test('a beam lying on broad support stays intact under its own weight',async()=>{
 const sim=await beam({fixed:false,height:.08});
 try{run(sim,480);assert.equal(sim.sections[0].status,'intact');}
 finally{sim.dispose();}
});
test('wind transports edited sand downwind above entrainment and conserves it',()=>{
 const m=library().materials.find(m=>m.id==='sand'),s=new SandTerrain({height:()=>0},m);
 const amount=.015;s.deposit(0,0,amount);
 for(let i=0;i<120;i++)s.advance(.05,{speed:2,heading:0});
 near(s.node(0,0),amount/CELL**2);
 for(let i=0;i<120;i++)s.advance(.05,{speed:40,heading:0});
 assert.ok(s.node(2,0)>0);near(volume(s),amount);near(s.node(-1,0),0);
});
test('a falling scoop refills an existing excavation and the rigid collision surface rises with it',async()=>{
 const s=await StudioPhysics.create(library(),'world','starter');
 try{
  const t=s.sandTerrain,original=t.height(0,0),cut=t.extract(0,0,.65,(x,z)=>t.height(x,z));
  run(s,60);const floor=t.height(0,0);assert.ok(floor<original-.1);
  s.matter.addPackets(s,'fall',s.groundMaterial,[{position:new Vector3(0,.9,0),radius:.045,volume:cut.volume}],true);
  run(s,240);assert.equal(s.matter.count,0);assert.ok(t.height(0,0)>floor+.12);near(volume(t),0);
  const x=-.07,z=-.04,heights=new Float32Array(33*33);
  for(let i=0;i<=32;i++)for(let j=0;j<=32;j++)heights[i*33+j]=s.sand.height((i-32)*CELL,(j-32)*CELL);
  t.addTileHeights(heights,-1,-1);
  const ray=new s.R.Ray({x,y:2,z},{x:0,y:-1,z:0}),collider=s.world.createCollider(s.R.ColliderDesc.heightfield(32,32,heights,{x:12,y:1,z:12}).setTranslation(-6,0,-6),s.ground);
  near(2-collider.castRay(ray,5,true),t.height(x,z),.0002);
 }finally{s.dispose();}
});
test('repeated lifts reuse their drawing buffers and material until the preview resets',()=>{
 const view={scene:new Scene(),camera:{position:new Vector3()},groundMaterial:new ShaderMaterial(),matterView:{material:()=>new ShaderMaterial()}};
 const display=new GroundEditView(view),sim={chunks:new Map()},body={translation:()=>new Vector3(),rotation:()=>new Quaternion()};
 const cut=groundWedge(0,0,.32,()=>0);let first;
 try{
  for(let k=0;k<80;k++){
   const chunk={key:String(k),body,cut,material:{}};
   sim.chunks.set(chunk.key,chunk);display.update(sim);
   const mesh=display.meshes.get(chunk);first??=mesh;assert.equal(mesh,first);
   sim.chunks.clear();display.update(sim);assert.equal(display.chunkPool.length,1);
  }
  let disposed=0;first.material.addEventListener('dispose',()=>disposed++);
  display.update(null);assert.equal(display.chunkPool.length,0);assert.equal(disposed,1);
 }finally{display.dispose();view.groundMaterial.dispose();}
});

test('a weight attached beyond the internal section loads the beam and stays attached to the detached end',async()=>{
 const setup=weighted=>{
  const l=library(),a=l.assets[0],p=a.parts[0];
  l.world.groundMaterialId='stone';l.materials.find(m=>m.id==='wood').tensileStrength=3e5;
  p.stamps=[stamp('box','add',[1.5,0,0],[1.5,.08,.08],'wood',0)];p.physics={fixed:true};
  if(weighted){
   const weight=part('Load',[stamp('box','add',[3,-.35,0],[.25,.25,.25],'stone',0)]);
   weight.joint={...jointDefaults(),parentId:p.id,type:'fixed',anchor:[3,0,0],breakForce:1e9};a.parts.push(weight);
  }
  l.world.instances=[{id:'cantilever',assetId:a.id,transform:{...transform(),position:[0,5,0]}}];
  return StudioPhysics.create(l,'world',a.id);
 };
 const bare=await setup(false),loaded=await setup(true);
 try{
  for(const sim of [bare,loaded])run(sim,180);
  assert.equal(bare.sections[0].status,'intact');assert.equal(loaded.sections[0].status,'fractured');
  assert.equal(loaded.joints[0].parent,loaded.sections[0].tip);
  assert.ok(loaded.joints[0].child.body.worldCom().y<3);
 }finally{bare.dispose();loaded.dispose();}
});
