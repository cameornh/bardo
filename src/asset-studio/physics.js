import {ReedStand,instancedReed,stemGroups,reedContactFilter} from './reed-stand.js';
import {MaterialWorld} from './material-world.js';
import {PaintedHinges} from './painted-hinges.js';
import {BearingLoad} from './bearing-load.js';
import {beamSection,bindBuckledSection} from './structural-section.js';
import {attachStructure,structureBody,recordLoad,beforeFractureStep,advanceFractures} from './fracture.js';
import {GroundCuts} from './ground-tools.js';
import {advanceGrip} from './sphere-grip.js';
import {stepChunks} from './ground-interaction.js';
import {parcelObstacle,resolveParcel} from './parcel-contact.js';
import {LooseMatter,DuneContacts,looseKind} from './loose-matter.js';
import {SandTerrain} from './sand-terrain.js';
import {windAt} from './wind.js';
import {Wetland} from './wetland.js';
import {WindSand} from './wind-sand.js';
import {WindSea} from './ocean.js';
import {flotationSamples,applyEnvironment,waveImpact} from './fluid-forces.js';
import {prepareLoads,releaseOverloaded} from './joint-load.js';
import * as THREE from 'three';
import {collisionProxy} from './collision.js';
import {anchorRetention} from './attachment-material.js';
import {sampleForces} from './physics-data.js';
const v=x=>new THREE.Vector3(x.x,x.y,x.z),q=x=>new THREE.Quaternion(x.x,x.y,x.z,x.w),V=a=>new THREE.Vector3(...a),rad=Math.PI/180;
const compose=t=>new THREE.Matrix4().compose(V(t.position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation.map(x=>x*rad))),V(t.scale));
function partTransform(p){const m=compose({...p.transform,position:p.transform.position.map((x,k)=>x+p.pivot[k])});return m.multiply(new THREE.Matrix4().makeTranslation(...p.pivot.map(x=>-x)));}
// An elastic flexure has three rotational modes. A slender member can bend
// easily yet have orders of magnitude less inertia about its long axis.
// Implicitly damp each mode with the relative inverse inertia of both bodies.
function flexureTorque(out, child, parent, response, matrix){
 // Rapier returns a view of shared WASM scratch space. Copy the child
 // tensor before asking for the parent's, even when the parent is fixed.
 const b=child.effectiveWorldInvInertia();
 const xx=b.m11,yy=b.m22,zz=b.m33,xy=b.m12,xz=b.m13,yz=b.m23;
 const a=parent.effectiveWorldInvInertia();
 matrix.set(xx+a.m11,xy+a.m12,xz+a.m13,xy+a.m12,yy+a.m22,yz+a.m23,xz+a.m13,yz+a.m23,zz+a.m33).multiplyScalar(response);
 matrix.elements[0]++;matrix.elements[4]++;matrix.elements[8]++;
 out.applyMatrix3(matrix.invert());
}
let engine;
export async function loadPhysics(){if(!engine)engine=import('@dimforge/rapier3d-compat').then(async m=>{const R=m.default;await R.init();return R;});return engine;}
export class StudioPhysics {
 static async create(library,mode,assetId,gravity=9.81,sea=null,sand=null,reference=false){const R=await loadPhysics(),p=new StudioPhysics(R,gravity);p.wind=library.world.wind||{speed:0,heading:0};
 p.materialWorld=new MaterialWorld(library.materials);
 p.groundMaterial=library.materials.find(m=>m.id===library.world.groundMaterialId);
 const kind=mode==='world'?looseKind(p.groundMaterial):0,liquid=kind===2;p.sand=kind===1&&!reference?(sand??new WindSand(Number.isInteger(library.world.wetlandSeed)?new Wetland(library.world.wetlandSeed):null)):null;
 p.bearing=mode==='world'&&p.groundMaterial.phase==='solid'?new BearingLoad():null;
 p.sandTerrain=p.sand?new SandTerrain(p.sand,p.groundMaterial):null;
 p.pondDensity=p.sand?.landscape?library.materials.find(m=>m.id==='water')?.density:undefined;
 if(p.pondDensity){
  p.pondSea=sea??new WindSea(p.wind.speed,p.wind.heading,p.wind.turbulence);
  p.pondSea.organicLoad=library.materials.find(m=>m.id==='water').organicLoad||0;
  if(!sea)p.pondSea.bedHeight=(x,z)=>p.sandTerrain.height(x,z);
 }
 p.matter=new LooseMatter();p.dunes=new DuneContacts();p.sea=liquid?(sea??new WindSea(p.wind.speed,p.wind.heading,p.wind.turbulence)):null;
 if(p.sea)p.sea.organicLoad=p.groundMaterial.organicLoad??0;
 p.broken=0;
 try{
  if(p.pondSea||reference)p.reedContacts=reedContactFilter(p);
  if(p.pondSea)p.stand=new ReedStand(p,library);
  await p.build(library,mode,assetId);
  if(p.stand)await p.stand.prepareWind((world)=>StudioPhysics.create({...library,world},'world',null,gravity,null,null,true));
  return p;
 }catch(e){p.dispose();throw e;}
 }

 constructor(R,gravity){this.paintedHinges=new PaintedHinges();this.R=R;this.cuts=new GroundCuts();this.chunks=new Map();this.chunkSerial=0;this.parcelObstacles=[];this.collideDrop=(d,from)=>resolveParcel(this.parcelObstacles,d,from);this.world=new R.World({x:0,y:-gravity,z:0});this.world.timestep=1/120;this.world.numSolverIterations=8;this.bodies=new Map();this.joints=[];this.sections=[];this.structures=[];this.internalLinks=[];this.pulses=[];this.time=0;this.accumulator=0;this.steps=0;this.skipped=[];this.maxProxySpacing=0;this.motorEnabled=true;this.lastStepMs=0;this.colliderCount=0;}
 async proxy(part){if(typeof Worker==='undefined')return collisionProxy(part);const worker=new Worker(new URL('./collision-worker.js',import.meta.url),{type:'module'});try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Collision preparation exceeded six seconds; simplify or split this part.')),6000);worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve(data.proxy);};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};worker.postMessage(part);});}finally{worker.terminate();}}
 async build(library,mode,assetId){
  const materials=new Map(library.materials.map(m=>[m.id,m]));
  const R=this.R,ground=materials.get(library.world.groundMaterialId);
  this.ground=this.world.createRigidBody(R.RigidBodyDesc.fixed());
  this.waterDensity=ground.density;
  if(!this.sea&&!this.sand){
   // A true plane avoids the contact precision loss of a 200 km-wide box against thin shards.
   const floor=new R.ColliderDesc(new R.HalfSpace({x:0,y:1,z:0}));
   this.flatFloor=this.world.createCollider(floor.setCollisionGroups(this.reedContacts?0x0004ffff:0xffffffff).setFriction(ground.friction).setRestitution(ground.restitution),this.ground);
  }
  const instances=mode==='asset'?[{id:'editor',assetId,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]:library.world.instances,cache=new Map();let total=0;
  const partCount=instances.reduce((n,i)=>n+library.assets.find(a=>a.id===i.assetId).parts.length,0);
  for(const i of instances){
   const asset=library.assets.find(a=>a.id===i.assetId),im=compose(i.transform);
   if(this.stand?.isPlanted(i.id))continue;
   for(const p of asset.parts){
    const key=asset.id+':'+p.id;
    if(!cache.has(key))cache.set(key,p.stamps.length===1?collisionProxy(p):await this.proxy(p));
    const original=cache.get(key);if(!original.shapes.length)continue;
    if(++total>32)throw Error('Physics preview is limited to 32 parts');
    this.instantiatePart(library,materials,i,asset,p,im,original,partCount);
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  for(const initial of this.bodies.values())this.attachPartJoint(library,initial);
 }
 instantiatePart(library,materials,i,asset,p,im,original,partCount){
    const R=this.R,reed=!!this.reedContacts&&instancedReed(asset);
    const m=im.clone().multiply(partTransform(p)),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();m.decompose(position,rotation,scale);
    const proxy={...original,shapes:[]},loose=new Map();
    for(const shape of original.shapes){
     const mat=library.materials.find(v=>v.id===shape.materialId);
     if(mat.phase!=='gas'&&!looseKind(mat)){proxy.shapes.push(shape);continue;}
     if(!loose.has(mat))loose.set(mat,[]);loose.get(mat).push(shape);
    }
    const budget=Math.max(1,Math.min(64,Math.floor(768/(Math.max(1,partCount)*Math.max(1,loose.size)))));
    for(const [mat,shapes] of loose)this.matter.add(this,i.id+':'+p.id,shapes,m,mat,budget);
    if(!proxy.shapes.length){if(p.joint)this.skipped.push(p.name+': loose material cannot retain a rigid joint');return;}
    // Nonuniform placement scale plus part rotation produces shear; reject instead of mismatching the visible shape.
    const rebuilt=new THREE.Matrix4().compose(position,rotation,scale);if(m.elements.some((x,k)=>Math.abs(x-rebuilt.elements[k])>.001))throw Error('Physics needs uniform placement scale for rotated parts. Apply scale inside the sculpt first.');
    const recordKey=i.id+':'+p.id;
    const mat=library.materials.find(item=>item.id===proxy.shapes[0].materialId);
    const anchor=(p.joint?V(p.joint.anchor).applyMatrix4(im).applyMatrix4(m.clone().invert()):V(p.pivot)).multiply(scale);
    const section=beamSection(p,proxy.shapes,scale,rotation,anchor,mat);
    const makeBody=(shapes,recordKey,fixed,stamps,densityScale=1,origin=position,orientation=rotation)=>{
     const desc=(fixed?R.RigidBodyDesc.fixed():R.RigidBodyDesc.dynamic()).setTranslation(origin.x,origin.y,origin.z).setRotation(orientation).setCcdEnabled(true).setCanSleep(this.world.gravity.y!==0).setLinearDamping(.025).setAngularDamping(.04);
     const body=this.world.createRigidBody(desc);
     for(const s of shapes){const mat=library.materials.find(x=>x.id===s.materialId),center=V(s.center).multiply(scale);let shape;
      if(s.type==='box')shape=R.ColliderDesc.cuboid(...V(s.half).multiply(scale).toArray());
      else if(s.type==='hull')shape=R.ColliderDesc.convexHull(Float32Array.from(s.vertices,(v,k)=>v*scale.getComponent(k%3)));
      else if(s.type==='ball'&&Math.abs(scale.x-scale.y)+Math.abs(scale.x-scale.z)<1e-6)shape=R.ColliderDesc.ball(s.radius*scale.x);
      else if(s.type==='capsule'&&Math.abs(scale.x-scale.y)+Math.abs(scale.x-scale.z)<1e-6)shape=R.ColliderDesc.capsule(s.halfHeight*scale.y,s.radius*scale.x);
      else {const points=[];for(let y=0;y<=12;y++)for(let x=0;x<24;x++){const a=Math.PI*y/12,b=2*Math.PI*x/24;points.push(s.radius*Math.sin(a)*Math.cos(b)*scale.x,(s.radius*Math.cos(a)+(s.type==='capsule'?(Math.cos(a)>=0?1:-1)*s.halfHeight:0))*scale.y,s.radius*Math.sin(a)*Math.sin(b)*scale.z);}shape=R.ColliderDesc.convexHull(new Float32Array(points));}
      if(!shape)throw Error('Cannot build collision shape for '+p.name);
      if(reed)shape.setCollisionGroups(stemGroups(p)).setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS);
      this.world.createCollider(shape.setTranslation(...center.toArray()).setDensity(mat.density*densityScale).setFriction(mat.friction).setRestitution(mat.restitution),body);this.colliderCount++;
     }
     const record={body,part:p,asset,instance:i,scale,initialRotation:rotation.clone(),matrix:m.clone(),key:recordKey};if(this.sea||this.pondSea){
      const obstacle=parcelObstacle(stamps,()=>record.matrix,library.materials,true);
      if(obstacle){record.obstacle=obstacle;this.parcelObstacles.push(obstacle);}
     }
     record.floats=flotationSamples(shapes,scale);record.fluidVolume=record.floats.reduce((sum,p)=>sum+p.volume,0);const bounds=new THREE.Box3();
     for(const s of record.floats){const reach=s.extent.clone().multiplyScalar(2);bounds.expandByPoint(s.p.clone().sub(reach));bounds.expandByPoint(s.p.clone().add(reach));}
     record.probeCenter=bounds.getCenter(new THREE.Vector3());record.probeRadius=bounds.getSize(new THREE.Vector3()).length()*.5;
     if(reed)this.reedContacts.owners.set(body.handle,i.id);
     this.materialWorld.bind(record,shapes);record.nextProbe=(this.bodies.size%7)*.024;this.bodies.set(recordKey,record);return record;
    };
    const record=makeBody(proxy.shapes,recordKey,p.physics?.fixed,p.stamps);
    if(!reed)attachStructure(this,record,proxy.shapes,materials,anchor,section,makeBody);
    this.paintedHinges.attach(record,materials);
    this.materialWorld.attachMarks(record,this.paintedHinges.parts.get(record.key));
    this.maxProxySpacing=Math.max(this.maxProxySpacing,proxy.spacing*Math.max(...scale.toArray()));
    return record;
 }
 attachPartJoint(library,initial){
   if(initial.structure&&initial.structure.root!==initial)return;
   let child=initial;const j=child.part.joint;if(!j)return;
   const R=this.R;
   let parent=j.parentId==='ground'?null:this.bodies.get(child.instance.id+':'+j.parentId);
   if(j.parentId!=='ground'&&!parent){this.skipped.push(child.part.name+': joint parent has no rigid support');return;}
   const im=compose(child.instance.transform),anchor=V(j.anchor).applyMatrix4(im);
   child=structureBody(child,this.localPoint(child,anchor));if(parent)parent=structureBody(parent,this.localPoint(parent,anchor));
   const a=parent?this.localPoint(parent,anchor):anchor.clone(),b=this.localPoint(child,anchor),pa=parent?.body||this.ground;
   const atAnchor=(r,p)=>anchorRetention(r.part,library.materials,p.clone().divide(r.scale).toArray());
   const support=Math.min(atAnchor(child,b),parent?atAnchor(parent,a):1);
   if(support<1e-4){this.skipped.push(child.part.name+': material cannot retain a joint');return;}
   let data;
   if(j.type==='spring')data=R.JointData.spring(0,j.extensionStiffness*support,2*Math.sqrt(j.extensionStiffness*support*child.body.mass())*.3,a,b);
   else if(j.type==='fixed'){const frame=q(pa.rotation()).invert().multiply(q(child.body.rotation()));data=R.JointData.fixed(a,frame,b,new THREE.Quaternion());}
   else if(j.type==='hinge'){
    // Rapier's revolute factory uses the same local axis on both bodies. Set the two local frames explicitly for differing rest poses.
    const axis=V(j.axis).normalize().transformDirection(im),axisParent=axis.clone().applyQuaternion(q(pa.rotation()).invert());data=R.JointData.revolute(a,b,axisParent);
    data.axis=axisParent;
   }else data=R.JointData.spherical(a,b);
   const link={child,parent,j,data,support,rest:q(pa.rotation()).invert().multiply(q(child.body.rotation())),anchorParent:a,anchorChild:b};
   if(j.type==='hinge'){
    const axis=V(j.axis).normalize().transformDirection(im),frame=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),axis);
    link.frames=[q(pa.rotation()).invert().multiply(frame),q(child.body.rotation()).invert().multiply(frame)];
   }
   this.rebindJoint(link);this.joints.push(link);return link;
 }
 rebindJoint(link){
  const {parent,child,data,frames}=link;
  link.joint=this.world.createImpulseJoint(data,parent?.body||this.ground,child.body,true);
  link.joint.setContactsEnabled(false);
  if(frames){link.joint.setLocalFrame1(link.anchorParent,frames[0]);link.joint.setLocalFrame2(link.anchorChild,frames[1]);}
 }
 buckle(section,parent,child){bindBuckledSection(this,section,parent,child);}
 localPoint(r,point){return point.clone().sub(v(r.body.translation())).applyQuaternion(q(r.body.rotation()).invert());}
 worldPoint(r,local){return local.clone().applyQuaternion(q(r.body.rotation())).add(v(r.body.translation()));}
 get(instanceId,partId){const key=instanceId+':'+partId;return this.bodies.get(key)??this.stand?.records.get(key);}
 addPulse(key,localPoint,force,duration,loose=false){if(this.pulses.length>=64)this.pulses.shift();this.pulses.push({key,loose,localPoint:localPoint.clone(),force:force.clone().clampLength(0,100000),until:this.time+Math.max(0,Math.min(5,duration))});}
 setDrag(key,localPoint,force,loose=false){this.drag={key,loose,localPoint:localPoint.clone(),force:force.clone().clampLength(0,100000)};}
 clearDrag(){this.drag=null;}
 applyForce(f){const r=this.bodies.get(f.key)||this.stand?.records.get(f.key)||this.chunks.get(f.key);if(r&&!f.loose){const pt=this.worldPoint(r,f.localPoint);recordLoad(r,f.force,pt);r.body.addForceAtPoint(f.force,pt,true);}else this.matter.nudge(f.key,f.localPoint,f.force,this.world.timestep);}
 set wind(settings){this.windSettings=settings;this.airflow=settings;(this.sea??this.pondSea)?.setWind(settings.speed,settings.heading,settings.turbulence);}
 get wind(){return this.airflow;}
 step(dt=1/120){
  if(dt<=0||dt>1/60)throw Error('Invalid physics timestep');const start=performance.now();this.world.timestep=dt;
  this.airflow=windAt(this.windSettings,this.time,0,0,this.gust??={});
  this.stand?.step(dt);
  beforeFractureStep(this);
  const pool=!this.sea&&(this.pondDensity||this.matter.beds.size)?(x,z)=>this.matter.liquidColumn(this,x,z):null;
  for(const r of this.bodies.values()){
   r.body.resetForces(false);r.body.resetTorques(false);
   if(!this.sea&&!this.wind.speed&&!pool)continue;
   let air=this.airflow;
   if(this.windSettings.turbulence&&air.speed){
    const point=r.body.translation();
    air=windAt(this.windSettings,this.time,point.x,point.z,this.bodyGust??={});
   }
   applyEnvironment(r,this.sea??this.pondSea,this.waterDensity,air,-this.world.gravity.y,dt,pool);
  }
  const links=this.internalLinks.length?this.joints.concat(this.internalLinks):this.joints;
  for(const link of links){const {child,parent,j,support,rest}=link,b=child.body,a=parent?.body||this.ground;
   if(j.type!=='fixed'){
    const qa=q(a.rotation()),relative=qa.clone().invert().multiply(q(b.rotation())),err=relative.multiply(rest.clone().invert());if(err.w<0)err.set(-err.x,-err.y,-err.z,-err.w);
    const angle=2*Math.acos(Math.min(1,Math.max(-1,err.w))),axis=new THREE.Vector3(err.x,err.y,err.z).normalize().applyQuaternion(qa),velocity=v(b.angvel()).sub(v(a.angvel()));
    // Passive elastic rest is distinct from the open-loop animation. No pose motor is used.
    const k=j.stiffness*support,d=j.damping*support;
    const torque=axis.multiplyScalar(-Math.max(0,angle-j.looseness*rad)*k).addScaledVector(velocity,-d);
    const response=dt*(d+dt*k);
    if(j.type==='flexure')flexureTorque(torque,b,a,response,this.springMatrix??=new THREE.Matrix3());
    else torque.multiplyScalar(1/(1+response/Math.max(.00001,Math.min(...Object.values(b.principalInertia())))));
    torque.clampLength(0,100000);
    recordLoad(child,new THREE.Vector3(),this.worldPoint(child,link.anchorChild),torque);b.addTorque(torque,true);if(parent){const opposite=torque.clone().negate();recordLoad(parent,new THREE.Vector3(),this.worldPoint(parent,link.anchorParent),opposite);a.addTorque(opposite,true);}
   }
   if(this.motorEnabled&&!link.section&&child.part.forceKeys?.length){const f=sampleForces(child.part.forceKeys,this.time,child.asset.duration),orientation=q(a.rotation());
    const force=V(f.force).applyQuaternion(orientation),torque=V(f.torque).applyQuaternion(orientation),anchor=this.worldPoint(child,link.anchorChild);
    recordLoad(child,force,anchor,torque);b.addForceAtPoint(force,anchor,true);b.addTorque(torque,true);if(parent){force.negate();torque.negate();recordLoad(parent,force,anchor,torque);a.addForceAtPoint(force,anchor,true);a.addTorque(torque,true);}
   }
  }
  if(this.sphereGrip)advanceGrip(this,dt);
  stepChunks(this,dt);
  this.pulses=this.pulses.filter(f=>f.until>this.time);for(const pulse of this.pulses){const fraction=Math.min(1,(pulse.until-this.time)/dt);this.applyForce({...pulse,force:pulse.force.clone().multiplyScalar(fraction)});}if(this.drag)this.applyForce(this.drag);
  const loads=prepareLoads(links,this.world.gravity);
  if(this.sand)this.sand.advance(dt,this.wind,this.groundMaterial);
  this.sandTerrain?.advance(dt,this.wind);this.cuts.relax(dt);
  if(!this.flatFloor&&!this.sea||[...this.matter.beds.values()].some(b=>!b.liquid))this.dunes.update(this);
  this.matter.update(this,dt);this.world.step(this.reedContacts?.events,this.reedContacts?.hooks);this.bearing?.advance(this,dt);if(this.sea||this.pondSea)for(const record of this.bodies.values())waveImpact(this,record);releaseOverloaded(this,loads,dt,links);advanceFractures(this,dt);this.time+=dt;this.steps++;
  for(const r of this.bodies.values()){const p=r.body.translation(),rot=r.body.rotation();if(![p.x,p.y,p.z,rot.x,rot.y,rot.z,rot.w].every(Number.isFinite))throw Error('Physics stopped: non-finite body state');r.matrix.compose(v(p),q(rot),r.field.scale===1?r.scale:r.scale.clone().multiplyScalar(r.field.scale));}
  if(this.paintedHinges.parts.size)this.paintedHinges.step(dt,this.wind,this.world.gravity.y,this.time);
  this.materialWorld?.step(this,dt);
  (this.sea??this.pondSea)?.advance(dt,this.collideDrop);this.lastStepMs=performance.now()-start;
 }
 advance(seconds){this.accumulator=Math.min(.1,this.accumulator+Math.max(0,seconds));let n=0;while(this.accumulator>=1/120&&n<12){this.step();this.accumulator-=1/120;n++;}return n/120;}
 dispose(){this.stand?.dispose();this.stand=null;this.reedContacts?.events.free();this.reedContacts=null;this.world?.free();this.world=null;this.bodies.clear();this.structures.length=0;this.sections.length=0;this.internalLinks.length=0;this.joints.length=0;this.fractureMotion?.clear();this.matter.parts.clear();this.matter.beds.clear();}
 diagnostics(){return {backend:'CPU · Rapier WASM',materialSamples:this.materialWorld?.nodes.length??0,airCells:this.materialWorld?.air.cells.size??0,bodies:this.bodies.size,interactiveCrowns:this.stand?.active.size??0,joints:this.joints.length,broken:this.broken,brokenBonds:this.structures.reduce((n,s)=>n+s.brokenBonds,0),meltedKg:this.matter.meltedMass,fragments:this.structures.reduce((n,s)=>n+Math.max(0,s.bodies.size-1),0),colliders:this.colliderCount,steps:this.steps,seconds:this.time,looseParcels:this.matter.count,stepMs:this.lastStepMs,proxySpacing:this.maxProxySpacing,skipped:this.skipped,poses:[...this.bodies].map(([id,r])=>({id,position:r.body.translation(),rotation:r.body.rotation(),mass:r.body.mass()}))};}
}
