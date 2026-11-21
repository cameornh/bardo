import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import {WindSea,OCEAN_SIZE,TILE_METRES} from '../src/asset-studio/ocean.js';
import {implicitStamp} from '../src/asset-studio/implicit-surface.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {jointDefaults} from '../src/asset-studio/physics-data.js';
import {seedLibrary,validateLibrary,stamp,transform} from '../src/asset-studio/model.js';

test('inverse FFT matches direct spectral summation, wraps, and has zero mean',()=>{
 const sea=new WindSea(9,35);sea.sampleTime(.5);
 let mean=0;
 for(let z=0;z<OCEAN_SIZE;z+=3)for(let x=0;x<OCEAN_SIZE;x+=2){
  let expected=0;
  for(const m of sea.modes){
   const kx=m.index%OCEAN_SIZE,kz=Math.floor(m.index/OCEAN_SIZE);
   expected+=2*m.a*Math.cos(m.phase+m.omega*.5+2*Math.PI*(kx*x+kz*z)/OCEAN_SIZE);
  }
  const dx=x*TILE_METRES/OCEAN_SIZE,dz=z*TILE_METRES/OCEAN_SIZE;
  assert.ok(Math.abs(expected-sea.height(dx,dz))<1e-6);
  assert.equal(sea.height(dx,dz),sea.height(dx-TILE_METRES,dz+TILE_METRES));
 }
 for(const h of sea.frames[0])mean+=h;
 assert.ok(Math.abs(mean)/sea.frames[0].length<1e-6);
});
test('wind changes height and direction, temporal interpolation stays continuous, particles return locally',()=>{
 const sea=new WindSea();assert.equal(sea.height(1,2),0);
 const rms=s=>Math.sqrt(s.frames[0].reduce((n,x)=>n+x*x,0)/s.frames[0].length);
 sea.setWind(4,0);const low=rms(sea);sea.setWind(10,0);assert.ok(rms(sea)>low*2);
 const first=sea.height(2,4);sea.setWind(10,90);assert.ok(Math.abs(first-sea.height(2,4))>.001);
 sea.sampleTime(.049999);const before=sea.height(3,5);sea.sampleTime(.050001);assert.ok(Math.abs(before-sea.height(3,5))<.0001);
 sea.setWind(0,0);sea.splash(3,1);assert.ok(sea.height(3,1)>.1);assert.equal(sea.drops.length,8);
 for(let i=0;i<500;i++)sea.advance(1/120);
 assert.equal(sea.drops.length,0);assert.equal(sea.ripples.length,0);assert.equal(sea.height(3,1),0);
});
function bodyFixture(mid='wood'){
 const l=seedLibrary(),a=l.assets[0],p=a.parts[0];p.stamps=[stamp('sphere','add',[0,0,0],[.25,.25,.25],mid)];p.transform.position=[0,1,0];
 l.world.instances=[{id:'body',assetId:a.id,transform:transform()}];return {l,p,a};
}
test('wood floats at the moving interface and stone sinks through it',async()=>{
 for(const mid of ['wood','stone']){
  const {l,p}=bodyFixture(mid);l.world.groundMaterialId='water';const sea=new WindSea(6,45);
  const sim=await StudioPhysics.create(l,'world','starter',9.81,sea);
  try{for(let i=0;i<720;i++)sim.step();const pos=sim.get('body',p.id).body.translation();
   if(mid==='wood')assert.ok(Math.abs(pos.y-sea.height(pos.x,pos.z))<.28);else assert.ok(pos.y< -2);
  }finally{sim.dispose();}
 }
});
test('joint releases at a material-scaled load. Reset restores authoring data',async()=>{
 const {l,p}=bodyFixture();p.joint={...jointDefaults(),parentId:'ground',type:'fixed',anchor:[0,1,0],breakForce:900};
 const sim=await StudioPhysics.create(l,'world','starter');
 try{for(let i=0;i<60;i++)sim.step();assert.equal(sim.joints.length,1);
  sim.addPulse('body:'+p.id,new Vector3(),new Vector3(1800,0,0),.1);sim.step();
  assert.equal(sim.broken,1);assert.equal(sim.joints.length,0);assert.equal(p.joint.breakForce,900);
 }finally{sim.dispose();}
});
test('a collision can break a fixed link without an authored force on the linked part',async()=>{
 const {l,p,a}=bodyFixture();p.joint={...jointDefaults(),parentId:'ground',type:'fixed',anchor:[0,1,0],breakForce:2000};
 const projectile=structuredClone(a);projectile.id='projectile';delete projectile.parts[0].joint;
 l.assets.push(projectile);l.world.instances.push({id:'shot',assetId:projectile.id,transform:{...transform(),position:[-2,0,0]}});
 const sim=await StudioPhysics.create(l,'world','starter',0);
 try{sim.get('shot',p.id).body.setLinvel({x:8,y:0,z:0},true);for(let i=0;i<70;i++)sim.step();assert.equal(sim.broken,1);}
 finally{sim.dispose();}
});
test('rendering eligibility preserves paint, fibres and transparency; older libraries acquire defaults',()=>{
 const {l,p}=bodyFixture('wood'),m=l.materials.find(m=>m.id==='wood');
 delete m.fiberLength;validateLibrary(l);assert.equal(m.fiberLength,0);assert.ok(implicitStamp(p,l.materials));
 m.roughness=1;assert.ok(implicitStamp(p,l.materials));m.fiberLength=.08;assert.equal(implicitStamp(p,l.materials),null);
 m.fiberLength=0;m.opacity=.5;assert.equal(implicitStamp(p,l.materials),null);
 m.opacity=1;p.stamps.push({...p.stamps[0],mode:'paint'});assert.equal(implicitStamp(p,l.materials),null);
});
test('lifted water follows the tool, then falls and rejoins the ocean',()=>{
 const sea=new WindSea();sea.lift(0,0);sea.moveLift({x:4,y:2,z:0});
 for(let i=0;i<25;i++)sea.advance(.02);assert.ok(sea.drops.every(p=>p.held&&p.y>1.9));
 sea.release();for(let i=0;i<120;i++)sea.advance(.02);assert.equal(sea.drops.length,0);
});
test('implicit picking returns the authored surface under nonuniform placement scale',async()=>{
 const {Object3D,Ray}=await import('three');
 const {intersectImplicit}=await import('../src/asset-studio/implicit-surface.js');
 const parent=new Object3D(),mesh=new Object3D();parent.add(mesh);
 parent.position.set(0,2,0);mesh.position.z=3;mesh.scale.set(2,1,.5);parent.updateMatrixWorld(true);
 const ray=new Ray(new Vector3(0,2,6),new Vector3(0,0,-1));
 for(const shape of ['box','sphere']){
  mesh.userData.implicit=shape;const hit=intersectImplicit(ray,mesh);
  assert.deepEqual(hit.point.toArray(),[0,2,3.5]);assert.deepEqual(hit.normal.toArray(),[0,0,1]);assert.deepEqual(hit.localPoint.toArray(),[0,0,3.5]);
 }
});
test('a weak loaded anchor fails under gravity, two freely falling joined bodies stay together',async()=>{
 const {l,p,a}=bodyFixture();p.joint={...jointDefaults(),type:'fixed',anchor:[0,1,0],breakForce:10};
 let sim=await StudioPhysics.create(l,'world','starter');
 try{sim.step();assert.equal(sim.broken,1);}finally{sim.dispose();}
 const parent=structuredClone(p);parent.id='parent';parent.transform.position[1]=2;delete parent.joint;a.parts.push(parent);p.joint.parentId=parent.id;
 sim=await StudioPhysics.create(l,'world','starter');
 try{for(let i=0;i<25;i++)sim.step();assert.equal(sim.broken,0);}finally{sim.dispose();}
});
