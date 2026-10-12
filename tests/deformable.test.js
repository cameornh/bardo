import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Deformable } from '../src/deformable.js';
import { FabricPatch,FabricTest,FABRIC_PRESETS } from '../src/fabric.js';
import { Groom,FiberTest,FIBER_PRESETS } from '../src/fibers.js';
import { fabricSplats,fiberSplats,softLevels } from '../src/soft-splats.js';
import { SoftRenderer } from '../src/soft-renderer.js';
import { World } from '../src/world.js';
import { Probe } from '../src/physics.js';

const dt=1/60;
const displacement=p=>p.positions.reduce((sum,v,i)=>sum+(v-p.rest[i])**2,0)/p.count;
test('cloth stiffness changes extension under identical mass and load; clamps remain fixed',()=>{
 const soft=new FabricPatch(0,{...FABRIC_PRESETS[0],stretch:30,bend:0,density:.3});
 const stiff=new FabricPatch(0,{...soft.parameters,stretch:95});
 const anchors=[0,stiff.cols].map(i=>Array.from(stiff.positions.subarray(i*3,i*3+3)));
 for(let i=0;i<120;i++){soft.step(dt,null,0,false);stiff.step(dt,null,0,false);}
 assert.ok(soft.maxStrain>stiff.maxStrain*3);
 anchors.forEach((p,k)=>assert.deepEqual(Array.from(stiff.positions.subarray(k*stiff.cols*3,k*stiff.cols*3+3)),p));
 assert.ok([...soft.positions,...stiff.positions].every(Number.isFinite));
});

test('bending resistance has an independent response to transverse force',()=>{
 function beam(compliance){const p=new Deformable(6);for(let i=0;i<6;i++)p.node(i,[i*.2,1,0],.02,i<2);for(let i=0;i<5;i++)p.link(i,i+1,1e-6);for(let i=0;i<4;i++)p.bend(i,i+1,i+2,compliance);return p;}
 const soft=beam(1),stiff=beam(.0001);
 for(let i=0;i<120;i++)for(const p of [soft,stiff]){p.begin(dt,{gravity:0,damping:2,force:[0,0,.03]});for(let j=0;j<10;j++)p.solve(dt);p.finish(dt);}
 assert.ok(soft.positions[17]>stiff.positions[17]*2);
});

test('damping dissipates free motion without moving pinned roots',()=>{
 const free=new Deformable(2),damped=new Deformable(2);
 for(const p of [free,damped]){p.node(0,[0,2,0],1,true);p.node(1,[1,2,0],1);p.impulse([0,0,2]);}
 for(let i=0;i<60;i++)for(const p of [free,damped]){p.begin(dt,{gravity:0,damping:p===free?0:4});p.finish(dt);}
 assert.ok(Math.abs(free.velocities[5]-2)<.001);assert.ok(damped.velocities[5]<.05);
 assert.deepEqual(Array.from(damped.positions.subarray(0,3)),[0,2,0]);
});

test('tearing is opt-in, removes visible cells, and reset restores their constraints',()=>{
 const run=enabled=>{const p=new FabricPatch(0,{...FABRIC_PRESETS[0],tear:.12});p.setPull(true);for(let i=0;i<120;i++)p.step(dt,null,0,enabled);return p;};
 const intact=run(false),torn=run(true);
 assert.equal(intact.broken,0);assert.ok(torn.broken>0);
 assert.ok(fabricSplats(torn).length<fabricSplats(intact).length);
 assert.equal(softLevels(torn).length,1,'coarse splats cannot bridge tears');
 const scene=new FabricTest();scene.patches[0]=torn;scene.resetPatch(0);assert.equal(scene.patches[0].broken,0);assert.equal(scene.patches[0].cells.filter(c=>scene.patches[0].cellVisible(c)).length,252);
 torn.releasePins();assert.ok(torn.pinned.every(v=>v===0));
});

test('grabbing draped silk does not sever its hem before a continuous pull loads it',()=>{
 const silk=new FabricPatch(0);
 for(let i=0;i<600;i++)silk.step(dt,null,.25,false);
 const before=silk.positions.slice(),start=silk.rows*(silk.cols+1);
 assert.ok(Math.abs(before[start*3+2]-silk.rest[start*3+2])>.3,'exercise a hem far from its rest plane');
 silk.setPull(true);silk.step(dt,null,.25,true);
 assert.equal(silk.broken,0,'grabbing must not teleport or instantly detach the hem');
 for(let i=start;i<silk.count;i++)assert.ok(Math.hypot(...[0,1,2].map(k=>silk.positions[i*3+k]-before[i*3+k]))<.02);
 for(let i=0;i<150;i++)silk.step(dt,null,.25,true);
 assert.ok(silk.broken>0,'continued tension can still tear the silk');
 assert.ok(silk.positions[start*3+1]<before[start*3+1]-.5);
 for(let i=start;i<silk.count;i++)assert.ok(silk.positions[i*3+1]>=.034,'moving grips stay above the ground');
 silk.setPull(false);assert.ok(silk.inverseMass.subarray(start).every(w=>w>0));
});

test('deformable contact transfers equal and opposite linear momentum to the sphere',()=>{
 const p=new Deformable(1);p.node(0,[0,1,.3],.1);
 const probe=new Probe(new World());probe.position.set(0,1,0);probe.velocity.set(0,0,0);probe.active=true;probe.setMass(1.5);
 p.begin(dt,{gravity:0,damping:0});p.collide(probe,dt,.02);p.finish(dt);
 assert.equal(p.contacts,1);assert.ok(p.velocities[2]>0);assert.ok(probe.velocity.z<0);
 assert.ok(Math.abs(p.velocities[2]*.1+probe.velocity.z*probe.mass)<1e-5);
});

test('a launched physical probe reaches both the cloth and the fur guides',()=>{
 for(const Test of [FabricTest,FiberTest]){
  const scene=new Test(),world=new World();scene.enabled=true;world.terrain=scene.terrain;world.terrainEnabled=true;world.showcaseEnabled=false;
  const probe=new Probe(world);probe.setMass(1.5);const x=scene.patches?.[0].centerX??scene.grooms[0].center[0];
  probe.dropAt([x,2.05,1.1]);probe.velocity.set(0,1.2,-4);
  for(let i=0;i<45;i++){probe.step(dt/2);probe.step(dt/2);scene.step(dt,probe);}
  assert.ok(scene.totalContacts>0);assert.ok(probe.position.toArray().every(Number.isFinite));
 }
});

test('hair roots stay fixed, segment lengths are bounded, and stiff guides resist gravity',()=>{
 const soft=new Groom(0,{...FIBER_PRESETS[1],stiffness:10},{guides:8}),stiff=new Groom(0,{...FIBER_PRESETS[1],stiffness:96},{guides:8});
 for(let i=0;i<120;i++){soft.step(dt,null,0);stiff.step(dt,null,0);}
 assert.ok(displacement(soft)>displacement(stiff)*5);
 for(const p of [soft,stiff]){
  assert.ok(p.positions.every(Number.isFinite));assert.ok(Math.max(...p.links.filter(l=>!l.type).map(l=>Math.abs(p.strain(l))))<.05);
  for(let i=0;i<p.count;i++)if(p.pinned[i])assert.deepEqual(Array.from(p.positions.subarray(i*3,i*3+3)),Array.from(p.rest.subarray(i*3,i*3+3)));
 }
});

test('groom bending constraints permit a rigid rotation of the rest curl',()=>{
 const groom=new Groom(2,FIBER_PRESETS[2],{guides:4}),rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,2,3).normalize(),1.1),v=new THREE.Vector3();
 for(let i=0;i<groom.count;i++){v.fromArray(groom.positions,i*3).applyQuaternion(rotation);v.toArray(groom.positions,i*3);}
 const before=groom.positions.slice();groom.begin(dt,{gravity:0,damping:0});for(let i=0;i<10;i++)groom.solve(dt);
 assert.ok(Math.max(...groom.positions.map((v,i)=>Math.abs(v-before[i])))<1e-4,'bending must not pull a rotated curl toward a fixed world direction');
});

test('full wool groom settles after gravity and brushing instead of sustaining jitter',()=>{
 const groom=new Groom(2);let peakAfterBrush=0,settledPeak=0;
 for(let i=0;i<1800;i++){
  if(i===720)groom.brush();groom.step(dt,null,.4);
  const rms=Math.sqrt(groom.velocities.reduce((s,v)=>s+v*v,0)/groom.count);
  if(i>=720&&i<780)peakAfterBrush=Math.max(peakAfterBrush,rms);
  if(i>=1500)settledPeak=Math.max(settledPeak,rms);
 }
 assert.ok(peakAfterBrush>.1,'brush still creates real motion');
 assert.ok(settledPeak<.002,`settled RMS speed ${settledPeak} m/s exceeds 2 mm/s`);
 assert.ok(Math.max(...groom.links.filter(l=>!l.type).map(l=>Math.abs(groom.strain(l))))<.04);
});

test('curl changes rest geometry; brushing moves tips while reset is deterministic',()=>{
 const straight=new Groom(2,{...FIBER_PRESETS[2],curl:0},{guides:8}),curly=new Groom(2,FIBER_PRESETS[2],{guides:8});
 assert.notDeepEqual(straight.rest,curly.rest);
 const before=curly.positions.slice();curly.brush();curly.step(dt,null,0);assert.notDeepEqual(curly.positions,before);
 const scene=new FiberTest(),rest=scene.grooms[2].rest.slice();scene.grooms[2].brush();scene.enabled=true;scene.step(dt,null);scene.reset();assert.deepEqual(scene.grooms[2].rest,rest);
});

test('fabric and hair LOD preserve optical mass and do not touch physical state',()=>{
 const patch=new FabricPatch(1),groom=new Groom(2,FIBER_PRESETS[2],{guides:8});
 for(const [subject,fn] of [[patch,l=>fabricSplats(patch,l)],[groom,l=>fiberSplats(groom,6,l)]]){
  const before=subject.positions.slice(),fine=fn(0),coarse=fn(2),mass=nodes=>nodes.reduce((s,g)=>s+g.mass,0);
  assert.ok(coarse.length<fine.length);assert.ok(Math.abs(mass(fine)-mass(coarse))<1e-8);assert.deepEqual(subject.positions,before);
  for(const g of coarse){assert.ok([...g.center,...g.cov,g.tau].every(Number.isFinite));assert.ok(g.cov[0]>0&&g.cov[3]>0&&g.cov[5]>0);}
 }
 const colors=fiberSplats(groom,6,1).map(g=>g.color);for(let i=0;i<groom.positions.length;i+=3)groom.positions[i]+=1;
 fiberSplats(groom,6,1).forEach((g,i)=>g.color.forEach((v,k)=>assert.ok(Math.abs(v-colors[i][k])<1e-6,'strand variation stays attached while moving')));
});

test('both Gaussian LOD layers fit the deformable budget across camera speeds and groom densities',()=>{
 const fibers=new FiberTest(),fabrics=new FabricTest();fibers.enabled=true;
 const camera=new THREE.PerspectiveCamera(43,1,.1,200);camera.position.set(0,2.5,8);camera.lookAt(0,1.2,0);camera.updateMatrixWorld();
 const renderer=new SoftRenderer({uResolution:{value:new THREE.Vector2(700,700)}}),probe=new Probe(new World());
 for(const followers of [1,6,10])for(const motion of [1,4,16,1]){fibers.followers=followers;renderer.prepare(fabrics,fibers,camera,probe,motion,dt,2);assert.ok(renderer.count>0&&renderer.count<=renderer.budget);}
 fibers.enabled=false;fabrics.enabled=true;renderer.prepare(fabrics,fibers,camera,probe,1,dt,2);assert.ok(renderer.count<=renderer.budget);
 renderer.dispose();
});

test('stiff bristles settle after the actual launched-ball interaction without angle-constraint explosions',()=>{
 const scene=new FiberTest();scene.grooms=[scene.grooms[1]];scene.enabled=true;
 const groom=scene.grooms[0],world=new World();world.terrain=scene.terrain;world.terrainEnabled=true;world.showcaseEnabled=false;
 const ball=new Probe(world);ball.setMass(1.5);let impactPeak=0,settledPeak=0;
 for(let i=0;i<1800;i++){
  if(i===300){ball.dropAt([groom.center[0],2.1,1.05]);ball.velocity.set(0,.4,-3);}
  ball.step(dt/2);ball.step(dt/2);scene.step(dt,ball);
  const rms=Math.sqrt(groom.velocities.reduce((sum,v)=>sum+v*v,0)/groom.count);
  if(i>=300&&i<480)impactPeak=Math.max(impactPeak,rms);if(i>=1500)settledPeak=Math.max(settledPeak,rms);
 }
 assert.ok(scene.totalContacts>0);assert.ok(impactPeak>.1&&impactPeak<3,`impact RMS ${impactPeak}`);
 assert.ok(settledPeak<.002,`late RMS ${settledPeak} m/s`);
 assert.ok(Math.max(...groom.links.filter(l=>!l.type).map(l=>Math.abs(groom.strain(l))))<.04);
 for(let i=0;i<groom.count;i++)if(groom.pinned[i])assert.deepEqual(Array.from(groom.positions.subarray(i*3,i*3+3)),Array.from(groom.rest.subarray(i*3,i*3+3)));
});
