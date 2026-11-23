import {sphereScoop,sampledPackets} from './sphere-scoop.js';
import {Box3,Quaternion,Vector3} from 'three';
import {CELL,chunkPackets,impactResponse} from './ground-tools.js';
import {looseKind} from './loose-matter.js';

function excavate(sim,point,depth,radius){
 const cut=radius?sphereScoop(sim,point,radius):(sim.sandTerrain??sim.cuts).extract(point.x,point.z,depth,(x,z)=>sim.matter.groundHeight(sim,x,z));
 if(!cut)return null;
 if(!radius&&sim.groundMaterial.phase==='gas'){
  const n=sim.cuts.node(cut.top.x,cut.top.z);n.depth-=depth;n.elastic+=depth;
 }
 if(sim.sandTerrain)sim.dunes.next=0;else updateGroundContacts(sim);return cut;
}
function updateGroundContacts(sim){
 if(sim.flatFloor){sim.world.removeCollider(sim.flatFloor,true);sim.flatFloor=null;}
 sim.dunes.next=0;sim.dunes.update(sim);
}
export function liftGround(sim,point,radius){
 const m=sim.groundMaterial,loose=looseKind(m)===1||m.phase==='gas';
 if(sim.heldChunk||sim.heldDeposit||sim.chunks.size>=32||loose&&sim.matter.count+(sim.sandTerrain?8:18)>768)return false;
 const c=excavate(sim,point,.32,radius);if(!c)return false;
 const key='ground-'+(++sim.chunkSerial),R=sim.R;
 const body=sim.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(c.top.x,c.top.y+.003,c.top.z)
  .setCcdEnabled(true).setLinearDamping(.12).setAngularDamping(.3));
 if(c.vertices){
  const hull=R.ColliderDesc.convexHull(Float32Array.from(c.vertices));
  sim.world.createCollider(hull.setMass(m.density*c.volume).setRestitution(m.restitution).setFriction(m.friction),body);
 }else for(let i=0;i<6;i++){
  const hull=R.ColliderDesc.convexHull(new Float32Array([0,0,0,0,-c.depth,0,...c.ring[i].toArray(),...c.ring[(i+1)%6].toArray()]));
  sim.world.createCollider(hull.setDensity(m.density).setRestitution(m.restitution).setFriction(m.friction),body);
 }
 const terrain=sim.sandTerrain?.base?.landscape;
 const shoreWet=sim.pondSea?Math.max(0,Math.min(1,1-(point.y-sim.pondSea.height(point.x,point.z))/.65)):0;
 const soil=radius&&terrain?Math.max(shoreWet,terrain.environment?.(point.x,point.z)?.moisture??0):0;
 const skin=radius&&sim.materialWorld?.ground(sim,point.x,point.z,false);
 const wet=Math.min(1,Math.max(m.moisture||0,soil,skin?.water/Math.max(1e-8,skin?.mass)||0));
 const chunk={wet,cut:c,key,body,material:m,loose,target:c.top.clone(),offset:c.top.clone().sub(point)};
 if(sim.materialWorld){
  chunk.scale=new Vector3(1,1,1);
  const bounds=c.vertices?new Box3().setFromArray(c.vertices):null;
  const shapes=bounds?[{type:'box',materialId:m.id,center:bounds.getCenter(new Vector3()).toArray(),half:bounds.getSize(new Vector3()).multiplyScalar(.5).toArray()}]:c.ring.map((p,i)=>({type:'box',materialId:m.id,center:[(p.x+c.ring[(i+1)%c.ring.length].x)/3,-c.depth/4,(p.z+c.ring[(i+1)%c.ring.length].z)/3],half:[.12,c.depth/2,.12]}));
  sim.materialWorld.bind(chunk,shapes);
  sim.materialWorld.liftSkin(sim.materialWorld.ground(sim,point.x,point.z,false),chunk.field.sites);
 }
 sim.chunks.set(key,chunk);sim.heldChunk=chunk;sim.dunes.next=0;if(!sim.sandTerrain)sim.dunes.update(sim);return true;
}
export function moveChunk(sim,point){
 if(sim.heldDeposit)sim.heldDeposit.grip.target.copy(point);
 const c=sim.heldChunk;if(c)c.target.copy(point).add(c.offset);
}
export function releaseChunk(sim,finishDrag=false){
 if(sim.heldDeposit){
  const grip=sim.heldDeposit.grip;
  const first=sim.heldDeposit.packets[0];
  if(finishDrag&&first&&grip.target.clone().add(first.gripOffset).distanceToSquared(first.body.translation())>.025**2)grip.releaseAt=sim.time+.06;
  else{sim.heldDeposit.grip=null;sim.heldDeposit=null;}
  return;
 }
 const c=sim.heldChunk;if(!c)return;
 // Very fast pointer gestures can arrive entirely between physics ticks.
 if(finishDrag&&c.target.distanceToSquared(c.body.translation())>.025**2){c.releaseAt=sim.time+.09;return;}
 sim.heldChunk=null;delete c.releaseAt;
 if(!c.loose)return;
 // Capillary cohesion supports a grain aggregate against its own weight.
 if(c.cut.radius&&c.material.phase==='granular'&&c.wet*c.wet*26000>c.material.density*9.81*c.cut.radius){
  c.cohesive=true;return;
 }
 const origin=new Vector3().copy(c.body.translation()),rot=c.body.rotation(),v=c.body.linvel(),omega=c.body.angvel();
 const packets=(c.cut.samples?sampledPackets:chunkPackets)(c.cut,c.material,new Vector3(),sim.sandTerrain?8:18);
 for(const p of packets){p.position.applyQuaternion(rot);p.velocity=new Vector3().copy(omega).cross(p.position).add(v);p.position.add(origin);}
 sim.world.removeRigidBody(c.body);sim.chunks.delete(c.key);
 const group=sim.matter.addPackets(sim,c.key,c.material,packets,true);
 if(c.field){group.skin=c.field.sites;sim.materialWorld.collectLoose(sim);}
 for(const p of packets)p.body.setLinvel(p.velocity,true);
}
export function stepChunks(sim,dt){
 for(const c of sim.chunks.values()){
  if(c===sim.heldChunk&&sim.time>=c.releaseAt){releaseChunk(sim);if(!sim.chunks.has(c.key))continue;}
  const b=c.body;b.resetForces(false);b.resetTorques(false);const m=b.mass();
  if(c===sim.heldChunk){
   // A force-limited grip keeps the chunk in the rigid contact solver while dragging.
   const accel=c.target.clone().sub(b.translation()).multiplyScalar(420)
    .addScaledVector(b.linvel(),-40).sub(sim.world.gravity).clampLength(0,180);
   b.applyImpulse(accel.multiplyScalar(m*dt),true);
  }
  if(c.bond&&c.groundAnchor&&c.bondParent===sim.ground.handle){
   const at=c.groundAnchor;
   if(sim.matter.groundHeight(sim,at.x,at.z)<at.y-.06){
    sim.world.removeImpulseJoint(c.bond,true);c.bond=null;c.bondParent=null;c.groundAnchor=null;
   }
  }
  if(c.cohesive&&!c.sphereHeld&&c!==sim.heldChunk&&!c.bond){
   const velocity=b.linvel(),speed2=velocity.x**2+velocity.y**2+velocity.z**2;
   let support=null;
   // A sleeping bonded clump may have no active solver pair when a new
   // handful first touches it. Test nearby clumps at the capillary gap.
   const atBody=new Vector3().copy(b.translation()),gap=.012;
   for(const other of sim.chunks.values()){
    if(other===c||!other.bond||other.bondParent===b.handle||other.sphereHeld)continue;
    // Compare kinetic energy per volume with the capillary bond strength.
    if(speed2*c.material.density*.5>26000*Math.min(c.wet,other.wet)**2)continue;
    if(atBody.distanceToSquared(other.body.translation())>(c.cut.radius+other.cut.radius+gap)**2)continue;
    for(let i=0;!support&&i<b.numColliders();i++){
     const face=b.collider(i);
     for(let j=0;j<other.body.numColliders();j++){
      const touch=face.contactCollider(other.body.collider(j),gap);
      if(touch&&touch.distance<=gap){support={parent:other.body,at:new Vector3().copy(touch.point1)};break;}
     }
    }
    if(support)break;
   }
   for(let i=0;!support&&speed2<.5&&i<b.numColliders();i++){
    const face=b.collider(i);
    sim.world.contactPairsWith(face,other=>{
     if(support)return;
     const parent=other.parent();if(!parent||parent.handle===b.handle)return;
     const otherChunk=[...sim.chunks.values()].find(item=>item.body.handle===parent.handle);
     if(!(parent.isFixed()||otherChunk?.cohesive&&otherChunk.bondParent!==b.handle))return;
     const contact=face.contactCollider(other,.012);
     if(contact&&contact.distance<=.012)support={parent,at:new Vector3().copy(contact.point1)};
    });
   }
   if(support){
    const {at,parent}=support,local=body=>at.clone().sub(body.translation()).applyQuaternion(new Quaternion().copy(body.rotation()).invert());
    const align=new Quaternion().copy(parent.rotation()).invert().multiply(b.rotation());
    c.bond=sim.world.createImpulseJoint(sim.R.JointData.fixed(local(parent),align,local(b),new Quaternion()),parent,b,true);
    c.bondParent=parent.handle;c.groundAnchor=parent.handle===sim.ground.handle?at:null;
   }
  }
  if(sim.wind.speed){
   const angle=sim.wind.heading*Math.PI/180,relative=new Vector3(Math.cos(angle),0,Math.sin(angle)).multiplyScalar(sim.wind.speed).sub(b.linvel());
   b.applyImpulse(relative.multiplyScalar(Math.min(m*.1,dt*.6*CELL*CELL*relative.length())),true);
  }
 }
}
export function strikeGround(sim,point,force,water=sim.sea,waterMaterial=null){
 const tile=!waterMaterial&&sim.materialWorld?.ground(sim,point.x,point.z,false),base=waterMaterial??tile?.material??sim.groundMaterial;
 const strength=tile?.strength??1;
 const m=tile?{...base,moisture:Math.min(1,tile.water/tile.mass),youngModulus:base.youngModulus*strength,
  yieldStress:base.yieldStress*strength,cohesion:base.cohesion*strength,adhesion:base.adhesion*strength}:base;
 const {reach,dent,recovery}=impactResponse(m,force);
 // Project onto actual collision shapes so a bulk impulse only reaches things touching the ground.
 sim.stand?.around(point,Math.min(4,4*reach));
 for(const [key,r] of [...sim.bodies,...sim.chunks]){
  const b=r.body;if(!b.isDynamic()&&!r.structure)continue;
  const origin=b.translation(),center=r.probeCenter?.clone().applyQuaternion(b.rotation()).add(origin)??origin;
  if(Math.hypot(center.x-point.x,center.z-point.z)>8*reach+(r.probeRadius||CELL))continue;
  const probe=water?point:{x:point.x,y:Math.min(point.y,origin.y)-.3,z:point.z};
  let best=null,nearest=Infinity;
  for(let i=0;i<b.numColliders();i++){
   const contact=b.collider(i).projectPoint(probe,!!water)?.point;
   if(!contact)continue;
   const surface=water?.height(contact.x,contact.z)??sim.matter.groundHeight(sim,contact.x,contact.z);
   const gap=contact.y-surface;
   const distance=Math.hypot(point.x-contact.x,point.z-contact.z,water?point.y-contact.y:0);
   const touching=water?gap<.09:Math.abs(gap)<.09;
   if(touching&&distance<nearest){nearest=distance;best=contact;}
  }
  if(!best||nearest>8*reach)continue;
  const pulse=new Vector3(0,force*Math.exp(-nearest/reach),0);
  if(r.part)sim.addPulse(key,sim.localPoint(r,new Vector3().copy(best)),pulse,.075);
  else b.applyImpulseAtPoint(pulse.multiplyScalar(.075),best,true);
 }
 if(water){water.splash(point.x,point.z,Math.min(3,Math.sqrt(force/5000)),0,0,reach);return true;}
 if(looseKind(m)===1||m.phase==='gas'){
  if(force<=CELL*CELL*m.cohesion)return true;
  if(sim.matter.count+(sim.sandTerrain?8:18)*(sim.heldChunk?.loose?2:1)>768)return false;
  const cut=excavate(sim,point,Math.min(.3,.15*Math.sqrt(force/5000)));if(!cut)return false;
  const packets=chunkPackets(cut,base,cut.top,sim.sandTerrain?8:18),speed=Math.min(6,force*.06/(cut.volume*m.density));
  const group=sim.matter.addPackets(sim,'strike-'+(++sim.chunkSerial),base,packets,true);
  if(tile){group.sourceTile=tile;sim.materialWorld.collectLoose(sim);}
  for(const [i,p] of packets.entries()){
   const v=p.position.clone().sub(cut.top);v.y=0;v.normalize().multiplyScalar(speed*.65);v.y=speed*(.8+.4*(i%5)/4);
   p.body.setLinvel(v,true);
  }
  return true;
 }
 if(dent>=.0002){sim.cuts.displace(point.x,point.z,dent,recovery);updateGroundContacts(sim);}
 return true;
}


export function detachSandBonds(sim,c){
 for(const other of sim.chunks.values())if(other.bond&&(other===c||other.bondParent===c.body.handle)){
  sim.world.removeImpulseJoint(other.bond,true);other.bond=null;other.bondParent=null;
 }
}
