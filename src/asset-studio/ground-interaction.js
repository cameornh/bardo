import {sphereScoop,sampledPackets,dampPackets} from './sphere-scoop.js';
import {Box3,Vector3} from 'three';
import {CELL,chunkPackets,impactResponse} from './ground-tools.js';
import {looseKind} from './loose-matter.js';

function excavate(sim,point,depth,radius){
 const cut=radius?sphereScoop(sim,point,radius):(sim.sandTerrain??sim.cuts).extract(point.x,point.z,depth,(x,z)=>sim.matter.groundHeight(sim,x,z));
 if(!cut)return null;
 if(!radius&&sim.groundMaterial.phase==='gas'){
  const n=sim.cuts.node(cut.top.x,cut.top.z);n.depth-=depth;n.elastic+=depth;
 }
 if(sim.sandTerrain){
  sim.dunes.next=0;sim.dunes.update(sim);
  for(const r of sim.bodies.values()){
   if(!r.body?.isDynamic?.())continue;
   const bt=r.body.translation();
   if(Math.hypot(bt.x-point.x,bt.z-point.z)<4.0)r.body.wakeUp();
  }
 }else updateGroundContacts(sim);
 sim.onGroundDisturb?.({kind:'excavate',point:point.clone(),depth,force:0,reach:1.4});
 return cut;
}
function updateGroundContacts(sim){
 if(sim.flatFloor){sim.world.removeCollider(sim.flatFloor,true);sim.flatFloor=null;}
 sim.dunes.next=0;sim.dunes.update(sim);
}
export function liftGround(sim,point,radius){
 const m=sim.groundMaterial,loose=looseKind(m)===1||m.phase==='gas';
 const terrain=sim.sandTerrain?.base?.landscape;
 const shoreWet=sim.pondSea?Math.max(0,Math.min(1,1-(point.y-sim.pondSea.height(point.x,point.z))/.65)):0;
 const soil=radius&&terrain?Math.max(shoreWet,terrain.environment?.(point.x,point.z)?.moisture??0):0;
 const skin=radius&&sim.materialWorld?.ground(sim,point.x,point.z,false);
 const wet=Math.min(1,Math.max(m.moisture||0,soil,skin?.water/Math.max(1e-8,skin?.mass)||0));
 const damp=radius&&m.phase==='granular'&&wet>.001;
 const count=damp?Math.max(8,Math.min(18,Math.round(8+radius*12))):(sim.sandTerrain?8:18);
 if(sim.heldChunk||sim.heldDeposit||sim.chunks.size>=32||loose&&sim.matter.count+count>768)return false;
 const c=excavate(sim,point,.32,radius);if(!c)return false;
 const key='ground-'+(++sim.chunkSerial),R=sim.R;
 if(damp){
  const packets=dampPackets(c,m,count);
  const group=sim.matter.addPackets(sim,key,m,packets,true,undefined,true);
  // A terrain heightfield is one-sided. A newly excavated grain can
  // start beneath a coarse triangle and must be able to leave the cut.
  for(const p of packets){
   p.leavingCut=true;p.body.collider(0).setCollisionGroups(0x0002fffb);
  }
  group.wet=wet;group.sourceTile=skin;group.grip={target:point.clone()};sim.heldDeposit=group;
  if(sim.materialWorld){
   sim.materialWorld.collectLoose(sim);
   const state=sim.materialWorld.loose.get(key+'/'+m.id);
   if(state){state.water=Math.max(state.water,wet*state.mass);group.surfaceMoisture=state.water/state.mass;}
  }
  sim.dunes.next=0;sim.dunes.update(sim);
  return true;
 }
 const body=sim.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(c.top.x,c.top.y+.003,c.top.z)
  .setCcdEnabled(true).setLinearDamping(.12).setAngularDamping(.3));
 if(c.vertices){
  const hull=R.ColliderDesc.convexHull(Float32Array.from(c.vertices));
  sim.world.createCollider(hull.setMass(m.density*c.volume).setRestitution(m.restitution).setFriction(m.friction),body);
 }else for(let i=0;i<6;i++){
  const hull=R.ColliderDesc.convexHull(new Float32Array([0,0,0,0,-c.depth,0,...c.ring[i].toArray(),...c.ring[(i+1)%6].toArray()]));
  sim.world.createCollider(hull.setDensity(m.density).setRestitution(m.restitution).setFriction(m.friction),body);
 }
 const chunk={cut:c,key,body,material:m,loose,target:c.top.clone(),offset:c.top.clone().sub(point)};
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
  const depth=Math.min(.3,.15*Math.sqrt(force/5000));
  const cut=excavate(sim,point,depth);if(!cut)return false;
  if(sim.sandTerrain){
   const blastReach=Math.max(1.8,4.5*reach);
   for(const r of [...sim.bodies.values(),...sim.chunks.values()]){
    const b=r.body;if(!b||(!b.isDynamic()&&!r.structure))continue;
    const origin=b.translation(),center=r.probeCenter?.clone().applyQuaternion(b.rotation()).add(origin)??origin;
    const dx=center.x-point.x,dz=center.z-point.z,hd=Math.hypot(dx,dz);
    if(hd>blastReach+(r.probeRadius||CELL))continue;
    const bedY=sim.matter.groundHeight(sim,center.x,center.z);
    if(center.y-(r.probeRadius||CELL)>bedY+0.45)continue;
    b.wakeUp?.();
    const falloff=Math.exp(-hd/Math.max(0.4,reach));
    const nx=hd>1e-4?dx/hd:0,nz=hd>1e-4?dz/hd:0;
    const scale=Math.min(8,b.mass()*0.45)*Math.sqrt(force/900)*falloff;
    b.applyImpulse({x:nx*scale*0.75,y:Math.max(0.12,scale),z:nz*scale*0.75},true);
   }
   sim.stand?.impulse?.(point,force,blastReach,sim.sandTerrain);
   sim.onGroundDisturb?.({kind:'impulse',point:point.clone(),force,reach:blastReach,depth});
  }
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
