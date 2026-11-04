import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed} from '../src/sand-lab/sand.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {makeBody,bodyDistance} from '../src/sand-lab/objects.js';
import {shapeDistance} from '../src/sand-lab/sand-shape.js';
import {bodyContactPoints,bodyMass,resolveBodyPairs,resolveBodyTerrain,integrateOrientation} from '../src/sand-lab/rigid-contacts.js';
import {LiveRigidPhysics} from '../src/rtx-sand-lab/rigid-physics.js';
import {TerrainCollider} from '../src/rtx-sand-lab/terrain-collider.js';
import {buildCollisionMesh,exactShape,meshField,meshNearest} from '../src/rtx-sand-lab/collision-mesh.js';
import {buildSandBricks} from '../src/rtx-sand-lab/sand-bricks.js';
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} vs ${b} (tolerance ${t})`);
const zeroWater=()=>({density:0,velocity:[0,0,0]});
export function fixture(balls=[],live=true){
 const sand=new SandBed(33);sand.base.fill(0);sand.mass.fill(0);sand.update();
 return {sand,balls,optimizations:{},spec:{scale:10},spacing:.03,wind:0,air:{},waterAt:zeroWater,positions:new Float32Array(),fluidIndex:{bins:new Map()},indexFluid(){},rigidContacts:live?new LiveRigidPhysics({workerFactory:()=>null}):undefined};
}
export function step(lab,n=1,dt=1/60){for(let i=0;i<n;i++)SandLab.prototype.stepBodies.call(lab,dt);}
function sculpted(){return {id:1,position:[0,1,0],velocity:[0,0,0],mass:.56*4*Math.PI/3,packing:.56,shapeRadius:1,wet:1,memory:1,anchored:true,cuts:[{offset:[0,.7,0],radius:.8},...Array.from({length:3},(_,i)=>({offset:[3+i,0,0],radius:.1}))]};}
const shape={radius:1,aspect:1,cuts:[{offset:[0,.7,0],radius:.8}]};
const mesh=buildCollisionMesh(shape);
test('worker mesh retains an open bowl and has bounded surface error and outward normals',()=>{
 assert.ok(mesh.triangles.length>100&&mesh.triangles.length<50000);
 let max=0;for(const t of mesh.triangles){const q=t.a.map((v,k)=>(v+t.b[k]+t.c[k])/3),d=exactShape(shape,q);max=Math.max(max,Math.abs(d));assert.ok(t.normal.every(Number.isFinite));
  assert.ok(exactShape(shape,q.map((v,k)=>v+t.normal[k]*.002))>=d-1e-5);
 }
 assert.ok(max<mesh.error*.4,`${max}`); // Creases are refined with exact CSG at contact.
 for(const p of [[0,.4,0],[0,1.05,0],[0,0,0],[.98,0,0],[.7,.5,0]]){const hit=meshNearest(mesh,p);assert.equal(Math.sign(hit.distance),Math.sign(exactShape(shape,p)));assert.ok(hit.visited<mesh.triangles.length/3);}
 near(meshNearest(mesh,[0,0,0]).distance,.1,.003);
});
test('cached field bounds contain the exact carved distance, including thin features',()=>{
 for(let i=0;i<2000;i++){const p=[Math.sin(i*1.7),Math.sin(i*.7),Math.cos(i*.41)],f=meshField(mesh,p);assert.ok(f);assert.ok(Math.abs(exactShape(shape,p)-f.value)<=f.error+1e-6);}
 assert.equal(meshField(mesh,[10,0,0]),null);
});
test('edited, deleted, unanchored and reset shapes cannot accept stale worker replies',()=>{
 let worker;const c=new TerrainCollider({workerFactory:()=>worker={jobs:[],postMessage(m){this.jobs.push(m);},terminate(){}}}),lab=fixture([makeBody('rock','sphere',.2,[0,1.4,0])]),p=sculpted();lab.sand.parcels=[p];
 c.begin(lab.sand,lab.balls,.3);assert.equal(worker.jobs.length,1);const job=worker.jobs[0];
 p.cuts[0].radius=.9;c.begin(lab.sand,lab.balls,.3);c.finish({id:job.id,mesh});assert.ok(!c.valid(p));assert.equal(c.stats.built,0);
 c.finish({id:worker.jobs.at(-1).id,mesh:buildCollisionMesh({...shape,cuts:[{offset:[0,.7,0],radius:.9}]},16)});assert.ok(c.valid(p));
 p.position[0]=.2;assert.ok(c.valid(p),'local mesh translates with parcel');p.anchored=false;assert.ok(!c.valid(p));
 c.begin(lab.sand,lab.balls,.3);assert.equal(c.entries.size,0);p.anchored=true;c.begin(lab.sand,lab.balls,.3);const last=worker.jobs.at(-1);c.begin(new SandBed(9),[],.3);c.finish({id:last.id,mesh});assert.equal(c.entries.size,0);c.dispose();
});
test('spatial terrain queries preserve contact signs and smooth blends',()=>{
 const lab=fixture([makeBody('rock','sphere',.2,[0,1.3,0])]);lab.sand.base.fill(-.7);
 lab.sand.parcels=[sculpted(),...Array.from({length:80},(_,i)=>({...sculpted(),id:i+2,position:[3+i,1,0]}))];lab.sand.update();const c=lab.rigidContacts.terrainCache;c.begin(lab.sand,lab.balls,0);
 const f=c.forBody(lab.balls[0]);for(let i=0;i<80;i++){const p=[Math.sin(i)*.2,1.3+Math.cos(i)*.2,Math.sin(i*2)*.2];near(f.exact(p),lab.sand.distance(p),1e-10);}
});
test('live sphere pairs conserve linear momentum and do not generate off-axis spin',()=>{
 const a=makeBody('rock','sphere',.2,[-.15,1,0],[1,0,0]),b=makeBody('glass','sphere',.2,[.15,1,0],[-1,0,0]),lab=fixture([a,b]),r=lab.rigidContacts;
 const momentum=a.velocity[0]*bodyMass(a)+b.velocity[0]*bodyMass(b);r.begin(lab,1/60);r.pairs(lab.balls,1/60);
 near(a.velocity[0]*bodyMass(a)+b.velocity[0]*bodyMass(b),momentum);near(Math.hypot(...a.omega)+Math.hypot(...b.omega),0);
 assert.ok(b.position[0]-a.position[0]>.399);
});
test('nearby pair filtering preserves cup contact solutions and skips distant pairs',()=>{
 const a=makeBody('rock','cup',.4,[-.22,0,0],[1,0,0]),b=makeBody('glass','cup',.4,[.22,.17,0],[-1,0,0]);a.pitch=.7;b.tilt=-.4;
 const expected=structuredClone([a,b]),lab=fixture([a,b,...Array.from({length:150},(_,i)=>makeBody('rock','sphere',.1,[5+i*2,0,0]))]);lab.optimizations.rigidReuse=false;
 const r=lab.rigidContacts;r.begin(lab,1/60);const result=r.pairs(lab.balls,1/120);resolveBodyPairs(expected,1/120);
 for(let i=0;i<2;i++)for(let k=0;k<3;k++){near(lab.balls[i].position[k],expected[i].position[k],1e-8);near(lab.balls[i].velocity[k],expected[i].velocity[k],1e-8);}
 assert.ok(result.tested<=4,`${result.tested}`);
});
test('cups keep hollow cavities; small spheres inside do not collide with an invisible cap',()=>{
 const cup=makeBody('rock','cup',.5,[0,1,0]),ball=makeBody('glass','sphere',.1,[0,1,0]);cup.fixed=true;
 const lab=fixture([cup,ball]),r=lab.rigidContacts;r.begin(lab,1/60);assert.equal(r.pairs(lab.balls,1/60).contacts,0);assert.deepEqual(ball.position,[0,1,0]);
});
test('a cup tips on a slope while terrain contact reuse stays within reference penetration',()=>{
 const b=makeBody('rock','cup',.2,[0,.7,0]),lab=fixture([b]);for(let i=0;i<lab.sand.base.length;i++)lab.sand.base[i]=((i%33)*lab.sand.dx-5.5)*.25;lab.sand.update();
 step(lab,240);assert.ok(Math.abs(b.tilt)+Math.abs(b.pitch)>.1);assert.ok(Math.min(...bodyContactPoints(b).map(p=>lab.sand.distance(p)))>-.003);
});
test('mesh accelerated carved bowl contacts settle at the same floor and do not fill cavities',()=>{
 const b=makeBody('rock','sphere',.18,[0,2.2,0]),lab=fixture([b]),p=sculpted();lab.sand.base.fill(-.7);lab.sand.parcels=[p];lab.sand.update();
 let worker;lab.rigidContacts.terrainCache=new TerrainCollider({workerFactory:()=>worker={postMessage(m){this.job=m;},terminate(){}}});
 const cache=lab.rigidContacts.terrainCache;cache.begin(lab.sand,lab.balls,.3);cache.finish({id:worker.job.id,mesh});step(lab,480,1/120);
 assert.ok(b.position[1]>1.07&&b.position[1]<1.12,`${b.position}`);assert.ok(cache.stats.meshNormals>0);assert.ok(Math.min(...bodyContactPoints(b).map(q=>shapeDistance(p,q)))>-.002);
});
test('supported objects sleep, and edits, impulses, wind and waves wake them',()=>{
 for(const cause of ['edit','impulse','wind','water','held']){
  const b=makeBody('rock','sphere',.2,[0,.2,0]),lab=fixture([b]),r=lab.rigidContacts;step(lab,120);assert.ok(r.sleeping(b),cause+' did not sleep');
  const original=b.position.slice();step(lab,10);assert.deepEqual(b.position,original);assert.equal(r.stats.terrainProbes,0);
  if(cause==='edit'){lab.sand.base.fill(-.3);lab.sand.update();}
  if(cause==='impulse')b.velocity[0]=.2;if(cause==='wind')lab.wind=30;
  if(cause==='water')lab.waterAt=()=>({density:.8,velocity:[1,0,0]});if(cause==='held')b.held=true;
  step(lab);assert.ok(!r.sleeping(b),cause+' did not wake');
  if(cause==='edit')assert.ok(b.position[1]<original[1]);
 }
});
test('an active object colliding with a sleeping body wakes and pushes it',()=>{
 const a=makeBody('rock','sphere',.2,[0,.2,0]),lab=fixture([a]);step(lab,120);assert.ok(lab.rigidContacts.sleeping(a));
 const b=makeBody('rock','sphere',.2,[-.38,.2,0],[1,0,0]);lab.balls.push(b);step(lab);assert.ok(!lab.rigidContacts.sleeping(a));assert.ok(a.velocity[0]>0);
});
test('a stack sleeps together and wakes when its lower body is removed',()=>{
 const a=makeBody('rock','sphere',.2,[0,.2,0]),b=makeBody('rock','sphere',.2,[0,.6,0]),lab=fixture([a,b]);step(lab,300);
 assert.ok(lab.rigidContacts.sleeping(a));assert.ok(lab.rigidContacts.sleeping(b));lab.balls=[b];const y=b.position[1];step(lab,15);assert.ok(!lab.rigidContacts.sleeping(b));assert.ok(b.position[1]<y-.01);
});
test('removing a supporting sand formation wakes a sleeper without holding it in the air',()=>{
 const b=makeBody('rock','sphere',.2,[0,1.2,0]),lab=fixture([b]),p={...sculpted(),position:[0,0,0],cuts:[]};lab.sand.parcels=[p];lab.sand.update();step(lab,180);assert.ok(lab.rigidContacts.sleeping(b));
 p.mass=0;lab.sand.update();const y=b.position[1];step(lab,20);assert.ok(b.position[1]<y-.03);
});
test('historical constructors do not install live collision policy',()=>{
 const renderer={extensions:{has:()=>false}},old=new SandLab(renderer),live=new LiveSandLab(renderer);assert.equal(old.rigidContacts,undefined);assert.ok(live.rigidContacts instanceof LiveRigidPhysics);live.rigidContacts.dispose();
});
test('worker budgets, simple-shape bypass, distant eviction and worker failure keep an exact fallback',()=>{
 let worker;const c=new TerrainCollider({limit:2,workerFactory:()=>worker={jobs:[],postMessage(m){this.jobs.push(m);},terminate(){this.terminated=true;}}}),lab=fixture([makeBody('rock','sphere',.4,[0,1.3,0])]);
 lab.sand.parcels=Array.from({length:5},(_,i)=>({...sculpted(),id:i,position:[i*.1,1,0]}));lab.sand.update();c.begin(lab.sand,lab.balls,.3);assert.equal(c.entries.size,2);assert.equal(worker.jobs.length,1);
 c.finish({id:worker.jobs[0].id,mesh:{tree:{},triangles:{length:50001}}});assert.equal(c.stats.built,0);assert.equal(worker.jobs.length,2);
 c.finish({id:worker.jobs[1].id,error:'worker failure'});assert.equal(c.stats.built,0);assert.ok(Number.isFinite(c.forBody(lab.balls[0]).distance([0,1,0])));
 c.begin(lab.sand,[],.3);assert.equal(c.entries.size,0);assert.equal(c.pending,null);
 lab.sand.parcels=[{...sculpted(),cuts:[{offset:[0,.7,0],radius:.8}]}];lab.sand.update();c.begin(lab.sand,lab.balls,1);assert.equal(c.entries.size,0);
 worker.onerror();assert.ok(worker.terminated);assert.equal(c.worker,null);
});
test('a tiny cut missing from a mesh uses the exact cut normal',()=>{
 const p=sculpted();p.cuts.push({offset:[.97,0,0],radius:.03});const lab=fixture([makeBody('rock','sphere',.01,[.97,1.025,0])]);lab.sand.base.fill(-2);lab.sand.parcels=[p];lab.sand.update();
 const c=new TerrainCollider({workerFactory:()=>({postMessage(){},terminate(){}})});c.begin(lab.sand,lab.balls,.3);
 // Deliberately provide a coarse mesh whose enclosing face is reliable but
 // does not represent the tiny cut. It must never supply this contact normal.
 c.finish({id:c.pending.id,mesh:{...mesh,bricks:buildSandBricks({radius:1,aspect:1,cuts:p.cuts})}});const f=c.forBody(lab.balls[0]),q=[.97,1.025,0],n=f.normal(q);assert.ok(n[1]<-.99,`${n}`);assert.equal(c.stats.meshNormals,0);
});
test('nonuniform terrain disables the plane shortcut and edits invalidate its proof',()=>{
 const lab=fixture([makeBody('rock','sphere',.2,[0,.2,0])]),c=lab.rigidContacts.terrainCache;c.begin(lab.sand,lab.balls,0);assert.ok(c.forBody(lab.balls[0]).plane);
 lab.sand.base[16+16*33]=.05;lab.sand.update();c.begin(lab.sand,lab.balls,0);assert.equal(c.forBody(lab.balls[0]).plane,null);
});
test('turning off sleeping and contact reuse keeps the simulation active',()=>{
 const lab=fixture([makeBody('rock','sphere',.2,[0,.2,0])]);step(lab,120);assert.ok(lab.rigidContacts.sleeping(lab.balls[0]));
 Object.assign(lab.optimizations,{rigidSleep:false,rigidReuse:false,rigidBroadphase:false,collisionMesh:false});step(lab,20);assert.ok(!lab.rigidContacts.sleeping(lab.balls[0]));assert.ok(lab.rigidContacts.stats.terrainProbes>0);assert.equal(lab.rigidContacts.stats.reusedContacts,0);
});
test('an upright cup falling onto a flat plane does not gain sideways motion or spin',()=>{
 const b=makeBody('rock','cup',.2,[1,1,0]),lab=fixture([b]);step(lab,480,1/120);
 near(b.position[0],1,1e-8);near(b.position[2],0,1e-8);near(Math.hypot(...b.omega),0,1e-8);assert.ok(lab.rigidContacts.sleeping(b));near(b.position[1],.232,.001);
});
test('rainwater accumulating inside a sleeping cup wakes it before exterior immersion',()=>{
 const b=makeBody('rock','cup',.2,[0,.232,0]),lab=fixture([b]);step(lab,240);assert.ok(lab.rigidContacts.sleeping(b));
 lab.waterAt=p=>({density:Math.hypot(p[0],p[2])<.02&&Math.abs(p[1]-b.position[1])<.02?.8:0,velocity:[0,0,0]});lab.rigidContacts.begin(lab,1/60);assert.ok(!lab.rigidContacts.sleeping(b));
});
