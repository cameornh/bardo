import {recordLoad} from './fracture.js';
import {sectionFailure} from './structural-section.js';
import {Quaternion, Vector3} from 'three';
const vec=x=>new Vector3().copy(x);
const _v1=new Vector3(),_v2=new Vector3(),_v3=new Vector3(),_v4=new Vector3(),_com=new Vector3(),_arm=new Vector3(),_f=new Vector3(),_n=new Vector3(),_anchor=new Vector3(),_moment=new Vector3(),_q1=new Quaternion();
function angularMomentum(body,out=new Vector3()){
 const w=body.angvel(),m=body.effectiveAngularInertia();
 return out.set(m.m11*w.x+m.m12*w.y+m.m13*w.z,m.m21*w.x+m.m22*w.y+m.m23*w.z,m.m31*w.x+m.m32*w.y+m.m33*w.z);
}
// Rapier JS doesn't expose joint impulses. Balance momentum over the bodies on
// the child side of each cut. Internal joint reactions cancel in that sum.
export function prepareLoads(links,gravity){
 const records=new Map();
 for(const {child} of links){
  const b=child.body;if(!b.isDynamic())continue;
  const rec=child._loadBefore??={velocity:new Vector3(),angular:new Vector3(),force:new Vector3(),torque:new Vector3()};
  rec.velocity.copy(b.linvel());
  angularMomentum(b,rec.angular);
  const mass=(child.field?.scale===1&&child.mass!==undefined)?child.mass:b.mass();
  rec.force.copy(b.userForce()).addScaledVector(gravity,mass);
  rec.torque.copy(b.userTorque());
  records.set(child,rec);
 }
 return records;
}
export function releaseOverloaded(sim,records,dt,links=sim.joints){
 if(!records.size)return;
 const loads=new Map(),invDt=1/dt;
 for(const [r,before] of records){
  const b=r.body,mass=(r.field?.scale===1&&r.mass!==undefined)?r.mass:b.mass();
  _com.copy(b.worldCom());
  const out=r._loadOut??={force:new Vector3(),moment:new Vector3(),summed:false};
  out.summed=false;
  const force=out.force.copy(before.force).sub(_v1.copy(b.linvel()).sub(before.velocity).multiplyScalar(mass*invDt));
  const torque=_v4.copy(before.torque).sub(angularMomentum(b,_v2).sub(before.angular).multiplyScalar(invDt));
  // Include impact and ground support. A contact normal points from shape 1 to 2.
  const onFloor=r.structure?.beam?.status==='buckled'&&Math.abs(b.linvel().y)<.08?{force:new Vector3(),torque:new Vector3(),corners:0}:null;
  const skipGroundPairs=sim.reference&&((r.part.joint?.parentId==='ground'&&!r.jointBroken)||_com.y-(r.probeRadius||0)>.08);
  if(!skipGroundPairs){
   const cols=r.colliders,nCols=cols?cols.length:b.numColliders();
   for(let i=0;i<nCols;i++){
    const collider=cols?cols[i]:b.collider(i);
    sim.world.contactPairsWith(collider,other=>sim.world.contactPair(collider,other,(m,flipped)=>{
     _n.copy(m.normal()).multiplyScalar(flipped?1:-1);
     const nContacts=m.numContacts();
     for(let j=0;j<nContacts;j++){
      _f.copy(_n).multiplyScalar(m.contactImpulse(j)*invDt);force.add(_f);
      const local=flipped?m.localContactPoint2(j):m.localContactPoint1(j);
      if(local){
       _q1.copy(collider.rotation());_v1.copy(collider.translation());
       _arm.copy(local).applyQuaternion(_q1).add(_v1).sub(_com);
       _v2.crossVectors(_arm,_f);torque.add(_v2);
       if(onFloor&&other.parent()?.handle===sim.ground.handle&&_n.y>.95&&m.contactDist(j)<.004){
        onFloor.corners|=1<<((_arm.x>0?1:0)+(_arm.z>0?2:0));
        onFloor.force.add(_f);onFloor.torque.add(_v2);
       }
      }
     }
    }));
   }
  }
  // A broad, level support can balance the weight directly under the segment.
  // The distribution between redundant rigid contact points is indeterminate.
  // Do not turn the solver's arbitrary corner-to-corner reaction into fracture.
  if(onFloor?.corners===15&&onFloor.force.y<1.4*mass*(-sim.world.gravity.y)){
   force.sub(onFloor.force);force.y-=mass*sim.world.gravity.y;
   torque.sub(onFloor.torque);
  }
  out.moment.copy(_com).cross(force).add(torque);
  loads.set(r,out);
 }
 const children=new Map();
 for(const l of links){let list=children.get(l.parent);if(!list){list=[];children.set(l.parent,list);}list.push(l.child);}
 const total=r=>{
  const w=loads.get(r);if(!w)return null;
  if(!w.summed){for(const c of children.get(r)||[]){const b=total(c);if(b){w.force.add(b.force);w.moment.add(b.moment);}}w.summed=true;}
  return w;
 };
 for(let i=links.length-1;i>=0;i--){
  const l=links[i],w=total(l.child);if(!w)continue;
  const cb=l.child.body;_q1.copy(cb.rotation());_v1.copy(cb.translation());
  _anchor.copy(l.anchorChild).applyQuaternion(_q1).add(_v1);
  _v2.crossVectors(_anchor,w.force);
  _moment.subVectors(w.moment,_v2);
  if(l.parent?.forceSamples)recordLoad(l.parent,w.force,_anchor,_moment);
  if(l.child.forceSamples)recordLoad(l.child,_v3.copy(w.force).negate(),_anchor,_v4.copy(_moment).negate());
  const lever=Math.max(.05,Math.cbrt(l.child.fluidVolume)*.5);
  const load=Math.hypot(w.force.length(),_moment.length()/lever);
  if(l.section?sectionFailure(sim,l,w.force,_moment,dt):load>(l.j.breakForce??50000)*l.support*Math.min(l.child.materialStrength??1,l.parent?.materialStrength??1)){
   if(sim.reedContacts?.owners.has(cb.handle)&&l.j.parentId==='ground'){
    const cols=l.child.colliders,nCols=cols?cols.length:cb.numColliders();
    for(let k=0;k<nCols;k++)(cols?cols[k]:cb.collider(k)).setCollisionGroups(0x0008ffff);
   }
   l.child.jointBroken=true;sim.world.removeImpulseJoint(l.joint,true);const list=l.section?sim.internalLinks:sim.joints;list.splice(list.indexOf(l),1);if(!l.section)sim.broken++;
  }
 }
}
