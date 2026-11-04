import {SandBed} from '../src/sand-lab/sand.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {bodyContactPoints} from '../src/sand-lab/rigid-contacts.js';
import {LiveRigidPhysics} from '../src/rtx-sand-lab/rigid-physics.js';
import {buildCollisionMesh,meshField,exactShape} from '../src/rtx-sand-lab/collision-mesh.js';
import {TerrainCollider} from '../src/rtx-sand-lab/terrain-collider.js';
import {buildSandBricks,brickDistance} from '../src/rtx-sand-lab/sand-bricks.js';
import {normalAt} from '../src/sand-lab/water-lab-model.js';
const quantile=(a,q)=>a.slice().sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*q))];
function fixture(kind,live){
 const sand=new SandBed(33);sand.mass.fill(0);sand.base.fill(0);sand.update();
 const n=kind==='settled cups'||kind==='touching spheres'?24:kind==='busy falling spheres'?120:12,balls=Array.from({length:n},(_,i)=>{
  const shape=kind==='settled cups'?'cup':'sphere',r=kind==='settled cups'?.15:.1,gap=kind==='touching spheres'?.195:.7,b=makeBody('rock',shape,r,[(i%12)*gap-3.85,kind==='settled cups'?r*1.16:.7+Math.floor(i/12)*.03,Math.floor(i/12)*gap-3.5]);return b;
 });
 if(kind==='edited terrain'){
  sand.base.fill(-.5);sand.parcels=Array.from({length:360},(_,id)=>({id,position:[(id%24)*.4-4.6,-.1,Math.floor(id/24)*.4-2.8],shapeRadius:.2,mass:.02,packing:.56,wet:1,anchored:true,velocity:[0,0,0],cuts:Array.from({length:12},(_,i)=>({offset:[Math.cos(i)*.16,.08,Math.sin(i)*.16],radius:.08}))}));sand.update();
 }
 return {sand,balls,optimizations:{},spec:{scale:10},spacing:.05,wind:0,air:{},waterAt:()=>({density:0,velocity:[0,0,0]}),positions:new Float32Array(),fluidIndex:{bins:new Map(),reach:.1},indexFluid(){},rigidContacts:live?new LiveRigidPhysics({workerFactory:()=>null}):null};
}
function run(kind,live){
 const lab=fixture(kind,live),samples=[];if(kind==='settled cups')for(let i=0;i<120;i++)SandLab.prototype.stepBodies.call(lab,1/60);
 for(let i=0;i<180;i++){const start=performance.now();SandLab.prototype.stepBodies.call(lab,1/120);const elapsed=performance.now()-start;if(i>=30)samples.push(elapsed);}
 const minClearance=Math.min(...lab.balls.flatMap(b=>bodyContactPoints(b).map(p=>lab.sand.distance(p))));
 return {meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,medianMs:quantile(samples,.5),p95Ms:quantile(samples,.95),minimumClearance:minClearance,finalCenters:lab.balls.map(b=>b.position),stats:lab.rigidContacts?.stats};
}
const reports=[];
for(const kind of ['settled cups','busy falling spheres','touching spheres','edited terrain']){
 const baseline=run(kind,false),live=run(kind,true);let maxCenterDifference=0;for(let i=0;i<baseline.finalCenters.length;i++)maxCenterDifference=Math.max(maxCenterDifference,Math.hypot(...baseline.finalCenters[i].map((v,k)=>v-live.finalCenters[i][k])));
 delete baseline.finalCenters;delete live.finalCenters;
 reports.push({kind,baseline,live,meanSpeedup:baseline.meanMs/live.meanMs,maxCenterDifference});
}
// Isolate the mesh's benefit against the already accelerated exact CSG bricks,
// with a moving object actually touching carved geometry (sleep disabled).
const bowlShape={radius:1,aspect:1,cuts:[{offset:[0,.7,0],radius:.8},...Array.from({length:19},(_,i)=>({offset:[Math.cos(i)*.7,.75,Math.sin(i)*.7],radius:.25}))]},bowlMesh=buildCollisionMesh(bowlShape),bowlBricks=buildSandBricks(bowlShape);
function bowlRun(cached){
 const lab=fixture('edited terrain',true),p={id:1,position:[0,1,0],shapeRadius:1,mass:1,packing:.56,wet:1,anchored:true,cuts:bowlShape.cuts,distanceCache:{distance:(p,q)=>brickDistance(bowlShape,bowlBricks,q.map((v,k)=>v-p.position[k]))}};
 lab.sand.base.fill(-.7);lab.sand.parcels=[p];lab.sand.update();lab.balls=[makeBody('rock','sphere',.18,[.1,1.2,0])];lab.optimizations.rigidSleep=false;
 lab.rigidContacts=new LiveRigidPhysics({workerFactory:()=>cached?{postMessage(){},terminate(){}}:null});const c=lab.rigidContacts.terrainCache;if(cached){c.begin(lab.sand,lab.balls,.3);c.finish({id:c.pending.id,mesh:bowlMesh});}
 const samples=[];for(let i=0;i<360;i++){const t=performance.now();SandLab.prototype.stepBodies.call(lab,1/120);if(i>30)samples.push(performance.now()-t);}
 return {meanMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:quantile(samples,.95),position:lab.balls[0].position,stats:c.stats};
}
const cachedBowlContacts={exactBricks:bowlRun(false),mesh:bowlRun(true)};
// Compare a field as a conservative reject, not as an approximate replacement
// for pressure distances. Every possible contact retains the exact value.
const shape={radius:1,aspect:1,cuts:Array.from({length:20},(_,i)=>({offset:[Math.cos(i)*.8,.4,Math.sin(i)*.8],radius:.35}))};
const start=performance.now(),mesh=buildCollisionMesh(shape),buildMs=performance.now()-start,points=Array.from({length:40000},(_,i)=>[Math.sin(i*.711)*1.07,Math.cos(i*.123)*1.07,Math.sin(i*.923)*1.07]);
let reference=0,t=performance.now();for(const p of points)if(exactShape(shape,p)<=.04)reference++;const exactMs=performance.now()-t;
let hits=0,rejected=0;t=performance.now();for(const p of points){const f=meshField(mesh,p);if(f&&f.value-f.error>.04){rejected++;continue;}if(exactShape(shape,p)<=.04)hits++;}const cachedMs=performance.now()-t;
const bricks=buildSandBricks(shape);let brickHits=0;t=performance.now();for(const p of points)if((brickDistance(shape,bricks,p)??exactShape(shape,p))<=.04)brickHits++;const existingBrickMs=performance.now()-t;
const normalLab=fixture('edited terrain',true),parcel={id:1,position:[0,0,0],shapeRadius:1,mass:1,packing:.56,wet:1,anchored:true,cuts:shape.cuts};normalLab.sand.base.fill(-10);normalLab.sand.parcels=[parcel];normalLab.sand.update();
const collider=new TerrainCollider({workerFactory:()=>({postMessage(){},terminate(){}})});collider.begin(normalLab.sand,[makeBody('rock','sphere',1,[0,0,0])],.3);collider.finish({id:collider.pending.id,mesh});const field=collider.forBody(makeBody('rock','sphere',1,[0,0,0]));
const contactPoints=mesh.triangles.filter(t=>t.reliable).filter((_,i)=>i%137===0).slice(0,64).map(t=>t.a.map((v,k)=>(v+t.b[k]+t.c[k])/3+t.normal[k]*.001));
const normals=[];t=performance.now();for(let j=0;j<80;j++)for(const p of contactPoints)normals.push(normalAt(p,q=>exactShape(shape,q)));const exactNormalsMs=performance.now()-t;
let maxNormalAngle=0;t=performance.now();let ni=0;for(let j=0;j<80;j++)for(const p of contactPoints){const n=field.normal(p),ref=normals[ni++];maxNormalAngle=Math.max(maxNormalAngle,Math.acos(Math.max(-1,Math.min(1,n.reduce((s,v,k)=>s+v*ref[k],0))))*180/Math.PI);}const meshNormalsMs=performance.now()-t;collider.dispose();
console.log(JSON.stringify({scope:'CPU rigid solver only, same fixed timestep and stock; no renderer, GPU or water pressure solve',reports,cachedBowlContacts,cachedContactNormals:{queries:normals.length,exactNormalsMs,meshNormalsMs,maxNormalAngleDegrees:maxNormalAngle,stats:collider.stats},cachedWaterBoundaryExperiment:{points:points.length,triangles:mesh.triangles.length,buildMs,exactMs,existingBrickMs,cachedMs,rejected,contactCountsEqual:reference===hits&&hits===brickHits,enabledForWater:false}},null,2));
