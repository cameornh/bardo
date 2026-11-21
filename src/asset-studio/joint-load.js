import {Vector3} from 'three';
const vec=x=>new Vector3().copy(x);
function angularMomentum(body){
 const w=body.angvel(),m=body.effectiveAngularInertia();
 return new Vector3(m.m11*w.x+m.m12*w.y+m.m13*w.z,m.m21*w.x+m.m22*w.y+m.m23*w.z,m.m31*w.x+m.m32*w.y+m.m33*w.z);
}
// Rapier JS doesn't expose joint impulses. Balance momentum over the bodies on
// the child side of each cut. Internal joint reactions cancel in that sum.
export function prepareLoads(links,gravity){
 const records=new Map();
 for(const {child} of links){
  const b=child.body;if(!b.isDynamic())continue;
  records.set(child,{velocity:vec(b.linvel()),angular:angularMomentum(b),
   force:vec(b.userForce()).addScaledVector(gravity,b.mass()),torque:vec(b.userTorque())});
 }
 return records;
}
export function releaseOverloaded(sim,records,dt){
 if(!records.size)return;
 const loads=new Map();
 for(const [r,before] of records){
  const b=r.body,com=vec(b.worldCom());
  const force=before.force.sub(vec(b.linvel()).sub(before.velocity).multiplyScalar(b.mass()/dt));
  const torque=before.torque.sub(angularMomentum(b).sub(before.angular).divideScalar(dt));
  // Include impact and ground support. A contact normal points from shape 1 to 2.
  for(let i=0;i<b.numColliders();i++){
   const collider=b.collider(i);
   sim.world.contactPairsWith(collider,other=>sim.world.contactPair(collider,other,(m,flipped)=>{
    const n=vec(m.normal()).multiplyScalar(flipped?1:-1);
    for(let j=0;j<m.numContacts();j++){
     const f=n.clone().multiplyScalar(m.contactImpulse(j)/dt);force.add(f);
     const local=flipped?m.localContactPoint2(j):m.localContactPoint1(j);
     if(local){const arm=vec(local).applyQuaternion(collider.rotation()).add(collider.translation()).sub(com);torque.add(arm.cross(f));}
    }
   }));
  }
  loads.set(r,{force,moment:torque.add(com.cross(force))});
 }
 const children=new Map();
 for(const l of sim.joints){if(!children.has(l.parent))children.set(l.parent,[]);children.get(l.parent).push(l.child);}
 const total=r=>{
  const w=loads.get(r);if(!w)return null;
  if(!w.summed){for(const c of children.get(r)||[]){const b=total(c);if(b){w.force.add(b.force);w.moment.add(b.moment);}}w.summed=true;}
  return w;
 };
 for(let i=sim.joints.length-1;i>=0;i--){
  const l=sim.joints[i],w=total(l.child);if(!w)continue;
  const anchor=sim.worldPoint(l.child,l.anchorChild);
  const moment=w.moment.clone().sub(anchor.cross(w.force));
  const lever=Math.max(.05,Math.cbrt(l.child.fluidVolume)*.5);
  const load=Math.hypot(w.force.length(),moment.length()/lever);
  if(load>(l.j.breakForce??50000)*l.support){
   sim.world.removeImpulseJoint(l.joint,true);sim.joints.splice(i,1);sim.broken++;
  }
 }
}
