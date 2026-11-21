import {sectionFailure} from './structural-section.js';
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
export function releaseOverloaded(sim,records,dt,links=sim.joints){
 if(!records.size)return;
 const loads=new Map();
 for(const [r,before] of records){
  const b=r.body,com=vec(b.worldCom());
  const force=before.force.sub(vec(b.linvel()).sub(before.velocity).multiplyScalar(b.mass()/dt));
  const torque=before.torque.sub(angularMomentum(b).sub(before.angular).divideScalar(dt));
  // Include impact and ground support. A contact normal points from shape 1 to 2.
  const onFloor=r.section&&Math.abs(b.linvel().y)<.08?{force:new Vector3(),torque:new Vector3(),corners:0}:null;
  for(let i=0;i<b.numColliders();i++){
   const collider=b.collider(i);
   sim.world.contactPairsWith(collider,other=>sim.world.contactPair(collider,other,(m,flipped)=>{
    const n=vec(m.normal()).multiplyScalar(flipped?1:-1);
    for(let j=0;j<m.numContacts();j++){
     const f=n.clone().multiplyScalar(m.contactImpulse(j)/dt);force.add(f);
     const local=flipped?m.localContactPoint2(j):m.localContactPoint1(j);
     if(local){
      const arm=vec(local).applyQuaternion(collider.rotation()).add(collider.translation()).sub(com);
      const moment=arm.clone().cross(f);torque.add(moment);
      if(onFloor&&other.parent()?.handle===sim.ground.handle&&n.y>.95&&m.contactDist(j)<.004){
       onFloor.corners|=1<<((arm.x>0?1:0)+(arm.z>0?2:0));
       onFloor.force.add(f);onFloor.torque.add(moment);
      }
     }
    }
   }));
  }
  // A broad, level support can balance the weight directly under the segment.
  // The distribution between redundant rigid contact points is indeterminate.
  // Do not turn the solver's arbitrary corner-to-corner reaction into fracture.
  if(onFloor?.corners===15&&onFloor.force.y<1.4*b.mass()*(-sim.world.gravity.y)){
   force.sub(onFloor.force);force.y-=b.mass()*sim.world.gravity.y;
   torque.sub(onFloor.torque);
  }
  loads.set(r,{force,moment:torque.add(com.cross(force))});
 }
 const children=new Map();
 for(const l of links){if(!children.has(l.parent))children.set(l.parent,[]);children.get(l.parent).push(l.child);}
 const total=r=>{
  const w=loads.get(r);if(!w)return null;
  if(!w.summed){for(const c of children.get(r)||[]){const b=total(c);if(b){w.force.add(b.force);w.moment.add(b.moment);}}w.summed=true;}
  return w;
 };
 for(let i=links.length-1;i>=0;i--){
  const l=links[i],w=total(l.child);if(!w)continue;
  const anchor=sim.worldPoint(l.child,l.anchorChild);
  const moment=w.moment.clone().sub(anchor.cross(w.force));
  const lever=Math.max(.05,Math.cbrt(l.child.fluidVolume)*.5);
  const load=Math.hypot(w.force.length(),moment.length()/lever);
  if(l.section?sectionFailure(sim,l,w.force,moment,dt):load>(l.j.breakForce??50000)*l.support){
   sim.world.removeImpulseJoint(l.joint,true);const list=l.section?sim.internalLinks:sim.joints;list.splice(list.indexOf(l),1);if(!l.section)sim.broken++;
  }
 }
}
