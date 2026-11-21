import {GroundCuts} from './ground-tools.js';
import {stepChunks} from './ground-interaction.js';
import {parcelObstacle,resolveParcel} from './parcel-contact.js';
import {LooseMatter,DuneContacts,looseKind} from './loose-matter.js';
import {WindSand} from './wind-sand.js';
import {WindSea} from './ocean.js';
import {flotationSamples,applyEnvironment,waveImpact} from './fluid-forces.js';
import {prepareLoads,releaseOverloaded} from './joint-load.js';
import * as THREE from 'three';
import {collisionProxy} from './collision.js';
import {partRetention,sampleForces} from './physics-data.js';
const v=x=>new THREE.Vector3(x.x,x.y,x.z),q=x=>new THREE.Quaternion(x.x,x.y,x.z,x.w),V=a=>new THREE.Vector3(...a),rad=Math.PI/180;
const compose=t=>new THREE.Matrix4().compose(V(t.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation.map(x=>x*rad))),V(t.scale));
function partTransform(p){const m=compose({...p.transform,position:p.transform.position.map((x,k)=>x+p.pivot[k])});return m.multiply(new THREE.Matrix4().makeTranslation(...p.pivot.map(x=>-x)));}
let engine;
export async function loadPhysics(){if(!engine)engine=import('@dimforge/rapier3d-compat').then(async m=>{const R=m.default;await R.init();return R;});return engine;}
export class StudioPhysics {
 static async create(library,mode,assetId,gravity=9.81,sea=null,sand=null){const R=await loadPhysics(),p=new StudioPhysics(R,gravity);p.wind=library.world.wind||{speed:0,heading:0};
 p.groundMaterial=library.materials.find(m=>m.id===library.world.groundMaterialId);
 const kind=mode==='world'?looseKind(p.groundMaterial):0,liquid=kind===2;p.sand=kind===1?(sand??new WindSand()):null;
 p.matter=new LooseMatter();p.dunes=new DuneContacts();p.sea=liquid?(sea??new WindSea(p.wind.speed,p.wind.heading)):null;if(p.sea)p.sea.organicLoad=p.groundMaterial.organicLoad??0;p.broken=0;try{await p.build(library,mode,assetId);return p;}catch(e){p.dispose();throw e;}}
 constructor(R,gravity){this.R=R;this.cuts=new GroundCuts();this.chunks=new Map();this.chunkSerial=0;this.parcelObstacles=[];this.collideDrop=(d,from)=>resolveParcel(this.parcelObstacles,d,from);this.world=new R.World({x:0,y:-gravity,z:0});this.world.timestep=1/120;this.world.numSolverIterations=8;this.bodies=new Map();this.joints=[];this.pulses=[];this.time=0;this.accumulator=0;this.steps=0;this.skipped=[];this.maxProxySpacing=0;this.motorEnabled=true;this.lastStepMs=0;this.colliderCount=0;}
 async proxy(part){if(typeof Worker==='undefined')return collisionProxy(part);const worker=new Worker(new URL('./collision-worker.js',import.meta.url),{type:'module'});try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Collision preparation exceeded six seconds; simplify or split this part.')),6000);worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data.proxy);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage(part);});}finally{worker.terminate();}}
 async build(library,mode,assetId){
  const R=this.R,ground=library.materials.find(m=>m.id===library.world.groundMaterialId);
  this.ground=this.world.createRigidBody(R.RigidBodyDesc.fixed());
  this.waterDensity=ground.density;
  if(!this.sea&&!this.sand)this.flatFloor=this.world.createCollider(R.ColliderDesc.cuboid(100000,.1,100000).setTranslation(0,-.1,0).setFriction(ground.friction).setRestitution(ground.restitution),this.ground);
  const instances=mode==='asset'?[{id:'editor',assetId,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]:library.world.instances,cache=new Map();let total=0;
  const partCount=instances.reduce((n,i)=>n+library.assets.find(a=>a.id===i.assetId).parts.length,0);
  for(const i of instances){const asset=library.assets.find(a=>a.id===i.assetId),im=compose(i.transform);
   for(const p of asset.parts){
    const key=asset.id+':'+p.id;if(!cache.has(key))cache.set(key,await this.proxy(p));
    const original=cache.get(key);if(!original.shapes.length)continue;
    if(++total>32)throw Error('Physics preview is limited to 32 parts');
    const m=im.clone().multiply(partTransform(p)),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();m.decompose(position,rotation,scale);
    const proxy={...original,shapes:[]},loose=new Map();
    for(const shape of original.shapes){
     const mat=library.materials.find(v=>v.id===shape.materialId);
     if(mat.phase==='gas')continue;
     if(!looseKind(mat)){proxy.shapes.push(shape);continue;}
     if(!loose.has(mat))loose.set(mat,[]);loose.get(mat).push(shape);
    }
    const budget=Math.max(1,Math.min(64,Math.floor(768/(Math.max(1,partCount)*Math.max(1,loose.size)))));
    for(const [mat,shapes] of loose)this.matter.add(this,i.id+':'+p.id,shapes,m,mat,budget);
    if(!proxy.shapes.length){if(p.joint)this.skipped.push(p.name+': loose material cannot retain a rigid joint');continue;}
    // Nonuniform placement scale plus part rotation produces shear; reject instead of mismatching the visible shape.
    const rebuilt=new THREE.Matrix4().compose(position,rotation,scale);if(m.elements.some((x,k)=>Math.abs(x-rebuilt.elements[k])>.001))throw Error('Physics needs uniform placement scale for rotated parts. Apply scale inside the sculpt first.');
    const desc=(p.physics?.fixed?R.RigidBodyDesc.fixed():R.RigidBodyDesc.dynamic()).setTranslation(...position.toArray()).setRotation(rotation).setCcdEnabled(true).setCanSleep(false).setLinearDamping(.025).setAngularDamping(.04);
    const body=this.world.createRigidBody(desc);
    for(const s of proxy.shapes){const mat=library.materials.find(x=>x.id===s.materialId),center=V(s.center).multiply(scale);let shape;
     if(s.type==='box')shape=R.ColliderDesc.cuboid(...V(s.half).multiply(scale).toArray());
     else if(s.type==='ball'&&Math.abs(scale.x-scale.y)+Math.abs(scale.x-scale.z)<1e-6)shape=R.ColliderDesc.ball(s.radius*scale.x);
     else if(s.type==='capsule'&&Math.abs(scale.x-scale.y)+Math.abs(scale.x-scale.z)<1e-6)shape=R.ColliderDesc.capsule(s.halfHeight*scale.y,s.radius*scale.x);
     else {const points=[];for(let y=0;y<=12;y++)for(let x=0;x<24;x++){const a=Math.PI*y/12,b=2*Math.PI*x/24;points.push(s.radius*Math.sin(a)*Math.cos(b)*scale.x,(s.radius*Math.cos(a)+(s.type==='capsule'?(Math.cos(a)>=0?1:-1)*s.halfHeight:0))*scale.y,s.radius*Math.sin(a)*Math.sin(b)*scale.z);}shape=R.ColliderDesc.convexHull(new Float32Array(points));}
     if(!shape)throw Error('Cannot build collision shape for '+p.name);
     this.world.createCollider(shape.setTranslation(...center.toArray()).setDensity(mat.density).setFriction(mat.friction).setRestitution(mat.restitution),body);this.colliderCount++;
    }
    const record={body,part:p,asset,instance:i,scale,initialRotation:rotation.clone(),matrix:m,retention:partRetention(p,library.materials)};if(this.sea){
     const obstacle=parcelObstacle(p.stamps,()=>record.matrix,library.materials,true);
     if(obstacle)this.parcelObstacles.push(obstacle);
    }
    record.floats=flotationSamples(proxy.shapes,scale);record.fluidVolume=record.floats.reduce((sum,p)=>sum+p.volume,0);const bounds=new THREE.Box3();
    for(const s of record.floats){const reach=s.extent.clone().multiplyScalar(2);bounds.expandByPoint(s.p.clone().sub(reach));bounds.expandByPoint(s.p.clone().add(reach));}
    record.probeCenter=bounds.getCenter(new THREE.Vector3());record.probeRadius=bounds.getSize(new THREE.Vector3()).length()*.5;
    record.nextProbe=(total%7)*.024;this.bodies.set(i.id+':'+p.id,record);this.maxProxySpacing=Math.max(this.maxProxySpacing,proxy.spacing*Math.max(...scale.toArray()));
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  for(const child of this.bodies.values()){const j=child.part.joint;if(!j)continue;const parent=j.parentId==='ground'?null:this.bodies.get(child.instance.id+':'+j.parentId);if(j.parentId!=='ground'&&!parent){this.skipped.push(child.part.name+': joint parent has no rigid support');continue;}
   const support=Math.min(child.retention,parent?.retention??1);if(support<1e-4){this.skipped.push(child.part.name+': material cannot retain a joint');continue;}
   const im=compose(child.instance.transform),anchor=V(j.anchor).applyMatrix4(im),a=parent?this.localPoint(parent,anchor):anchor.clone(),b=this.localPoint(child,anchor),pa=parent?.body||this.ground;
   let data;
   if(j.type==='spring')data=R.JointData.spring(0,j.extensionStiffness*support,2*Math.sqrt(j.extensionStiffness*support*child.body.mass())*.3,a,b);
   else if(j.type==='fixed'){const frame=q(pa.rotation()).invert().multiply(q(child.body.rotation()));data=R.JointData.fixed(a,frame,b,new THREE.Quaternion());}
   else if(j.type==='hinge'){
    // Rapier's revolute factory uses the same local axis on both bodies. Set the two local frames explicitly for differing rest poses.
    const axis=V(j.axis).normalize().transformDirection(im),axisParent=axis.clone().applyQuaternion(q(pa.rotation()).invert());data=R.JointData.revolute(a,b,axisParent);
    data.axis=axisParent;
   }else data=R.JointData.spherical(a,b);
   const joint=this.world.createImpulseJoint(data,pa,child.body,true);joint.setContactsEnabled(false);
   // Correct local hinge axis when parent and child have different authored rotations.
   if(j.type==='hinge'){
    const axis=V(j.axis).normalize().transformDirection(im),frame=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),axis);
    joint.setLocalFrame1(a,q(pa.rotation()).invert().multiply(frame));joint.setLocalFrame2(b,q(child.body.rotation()).invert().multiply(frame));
   }
   this.joints.push({child,parent,j,joint,support,rest:q(pa.rotation()).invert().multiply(q(child.body.rotation())),anchorParent:a,anchorChild:b});
  }
 }
 localPoint(r,point){return point.clone().sub(v(r.body.translation())).applyQuaternion(q(r.body.rotation()).invert());}
 worldPoint(r,local){return local.clone().applyQuaternion(q(r.body.rotation())).add(v(r.body.translation()));}
 get(instanceId,partId){return this.bodies.get(instanceId+':'+partId);}
 addPulse(key,localPoint,force,duration,loose=false){if(this.pulses.length>=64)this.pulses.shift();this.pulses.push({key,loose,localPoint:localPoint.clone(),force:force.clone().clampLength(0,100000),until:this.time+Math.max(0,Math.min(5,duration))});}
 setDrag(key,localPoint,force,loose=false){this.drag={key,loose,localPoint:localPoint.clone(),force:force.clone().clampLength(0,100000)};}
 clearDrag(){this.drag=null;}
 applyForce(f){const r=this.bodies.get(f.key)||this.chunks.get(f.key);if(r&&!f.loose)r.body.addForceAtPoint(f.force,this.worldPoint(r,f.localPoint),true);else this.matter.nudge(f.key,f.localPoint,f.force,this.world.timestep);}
 step(dt=1/120){
  if(dt<=0||dt>1/60)throw Error('Invalid physics timestep');const start=performance.now();this.world.timestep=dt;
  const pool=!this.sea&&this.matter.beds.size?(x,z)=>this.matter.liquidColumn(this,x,z):null;
  for(const r of this.bodies.values()){r.body.resetForces(false);r.body.resetTorques(false);if(this.sea||this.wind.speed||pool)applyEnvironment(r,this.sea,this.waterDensity,this.wind,-this.world.gravity.y,dt,pool);}
  for(const link of this.joints){const {child,parent,j,support,rest}=link,b=child.body,a=parent?.body||this.ground;
   if(j.type!=='fixed'){
    const qa=q(a.rotation()),relative=qa.clone().invert().multiply(q(b.rotation())),err=relative.multiply(rest.clone().invert());if(err.w<0)err.set(-err.x,-err.y,-err.z,-err.w);
    const angle=2*Math.acos(Math.min(1,Math.max(-1,err.w))),axis=new THREE.Vector3(err.x,err.y,err.z).normalize().applyQuaternion(qa),velocity=v(b.angvel()).sub(v(a.angvel()));
    // Passive elastic rest is distinct from the open-loop animation. No pose motor is used.
    const inertia=Math.max(.00001,Math.min(...Object.values(b.principalInertia()))),k=j.stiffness*support,d=j.damping*support;
    const torque=axis.multiplyScalar(-Math.max(0,angle-j.looseness*rad)*k).addScaledVector(velocity,-d).multiplyScalar(1/(1+dt*d/inertia+dt*dt*k/inertia)).clampLength(0,100000);
    b.addTorque(torque,true);if(parent)a.addTorque(torque.clone().negate(),true);
   }
   if(this.motorEnabled){const f=sampleForces(child.part.forceKeys,this.time,child.asset.duration),orientation=q(a.rotation());
    const force=V(f.force).applyQuaternion(orientation),torque=V(f.torque).applyQuaternion(orientation),anchor=this.worldPoint(child,link.anchorChild);
    b.addForceAtPoint(force,anchor,true);b.addTorque(torque,true);if(parent){a.addForceAtPoint(force.clone().negate(),anchor,true);a.addTorque(torque.clone().negate(),true);}
   }
  }
  stepChunks(this,dt);
  this.pulses=this.pulses.filter(f=>f.until>this.time);for(const pulse of this.pulses){const fraction=Math.min(1,(pulse.until-this.time)/dt);this.applyForce({...pulse,force:pulse.force.clone().multiplyScalar(fraction)});}if(this.drag)this.applyForce(this.drag);
  const loads=prepareLoads(this.joints,this.world.gravity);
  if(this.sand)this.sand.advance(dt,this.wind,this.groundMaterial);
  this.cuts.relax(dt);
  if(!this.flatFloor&&!this.sea||[...this.matter.beds.values()].some(b=>!b.liquid))this.dunes.update(this);
  this.matter.update(this,dt);this.world.step();if(this.sea)for(const record of this.bodies.values())waveImpact(this,record);releaseOverloaded(this,loads,dt);this.time+=dt;this.steps++;this.lastStepMs=performance.now()-start;
  for(const r of this.bodies.values()){const p=r.body.translation(),rot=r.body.rotation();if(![p.x,p.y,p.z,rot.x,rot.y,rot.z,rot.w].every(Number.isFinite))throw Error('Physics stopped: non-finite body state');r.matrix.compose(v(p),q(rot),r.scale);}
  this.sea?.advance(dt,this.collideDrop);
 }
 advance(seconds){this.accumulator=Math.min(.1,this.accumulator+Math.max(0,seconds));let n=0;while(this.accumulator>=1/120&&n<12){this.step();this.accumulator-=1/120;n++;}return n/120;}
 dispose(){this.world?.free();this.world=null;this.bodies.clear();this.matter.parts.clear();this.matter.beds.clear();}
 diagnostics(){return {backend:'CPU · Rapier WASM',bodies:this.bodies.size,joints:this.joints.length,broken:this.broken,colliders:this.colliderCount,steps:this.steps,seconds:this.time,looseParcels:this.matter.count,stepMs:this.lastStepMs,proxySpacing:this.maxProxySpacing,skipped:this.skipped,poses:[...this.bodies].map(([id,r])=>({id,position:r.body.translation(),rotation:r.body.rotation(),mass:r.body.mass()}))};}
}
