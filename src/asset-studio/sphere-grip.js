import {Vector3} from 'three';
import {selectScoop} from './scoop-fragments.js';
import {detachSphere} from './fracture.js';
import {detachSandBonds} from './ground-interaction.js';

export function grabBodies(sim,point,radius,hit){
 sim.stand?.around(point,radius);
 if(hit?.reedSite)sim.stand?.activate(hit.reedSite);
 const grip={target:point.clone(),items:[],packets:[]},seen=new Set();
 function hold(body){
  if(seen.has(body.handle)||!body.isDynamic())return;
  seen.add(body.handle);
  grip.items.push({body,offset:new Vector3().copy(body.worldCom()).sub(point)});
 }
 for(const record of new Set([...sim.bodies.values(),...(sim.stand?.records.values()??[])])){
  const b=record.body;
  let touching=false;
  for(let i=0;i<b.numColliders()&&!touching;i++){
   const projected=b.collider(i).projectPoint(point,true);
   touching=!!projected&&point.distanceToSquared(projected.point)<=radius*radius;
  }
  if(!touching)continue;
  // A large brush enclosing a complete sculpt, including its foundation, frees the whole piece.
  for(const piece of detachSphere(sim,record,sim.localPoint(record,point),radius)){
   if(piece.body.isFixed())piece.body.setBodyType(sim.R.RigidBodyType.Dynamic,true);
   hold(piece.body);
  }
 }
 for(const group of sim.matter.parts.values())for(const packet of group.packets){
  if(point.distanceToSquared(packet.body.translation())>(radius+packet.radius)**2)continue;
  packet.sphereHeld=true;grip.packets.push(packet);hold(packet.body);
 }
 for(const original of [...sim.chunks.values()]){
  if(original===sim.heldChunk)continue;
  const b=original.body;
  let overlaps=false;
  for(let i=0;i<b.numColliders()&&!overlaps;i++){
   const p=b.collider(i).projectPoint(point,true);
   overlaps=!!p&&point.distanceToSquared(p.point)<=radius*radius;
  }
  if(!overlaps)continue;
  const c=selectScoop(sim,original,point,radius);if(!c)continue;
  detachSandBonds(sim,c);c.sphereHeld=true;grip.items.push({body:c.body,chunk:c,offset:new Vector3().copy(c.body.worldCom()).sub(point)});
 }
 sim.sphereGrip=grip;return grip.items.length;
}
export function advanceGrip(sim,dt){
 for(const item of sim.sphereGrip.items){
  const body=item.body;if(!body.isValid())continue;
  const dv=sim.sphereGrip.target.clone().add(item.offset).sub(body.worldCom()).multiplyScalar(300)
   .addScaledVector(body.linvel(),-32).sub(sim.world.gravity).clampLength(0,160);
  body.applyImpulse(dv.multiplyScalar(dt*body.mass()),true);
 }
}
export function dropBodies(sim){
 for(const p of sim.sphereGrip?.packets??[])p.sphereHeld=false;
 for(const i of sim.sphereGrip?.items??[])if(i.chunk)i.chunk.sphereHeld=false;
 sim.sphereGrip=null;
}
