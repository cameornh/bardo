import {Vector3} from 'three';
import {CELL} from './ground-tools.js';

// Sample solved support reactions at 12 Hz. Each ground vertex receives the
// surrounding contacts' share of the load. A single impact cannot excavate it.
export class BearingLoad{
 constructor(){this.points=new Map();this.clock=0;}
 advance(sim,dt){
  this.clock+=dt;if(this.clock<1/12)return;
  const interval=this.clock;this.clock=0;
  const m=sim.groundMaterial,loads=new Map(),supports=new Map();
  const accumulate=(x,z,force)=>{
   const u=x/CELL,v=z/CELL,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
   for(const [dx,dz,w] of [[0,0,Math.max(0,1-a-b)],[1,0,Math.min(a,1-b)],[0,1,Math.min(1-a,b)],[1,1,Math.max(0,a+b-1)]]){
    if(w<=0)continue;const key=(i+dx)+','+(j+dz);
    let loc=loads.get(key);if(!loc){loc={i:i+dx,j:j+dz,force:0};loads.set(key,loc);}loc.force+=force*w;
   }
  };
  for(let i=0;i<sim.ground.numColliders();i++){
   const floor=sim.ground.collider(i);
   sim.world.contactPairsWith(floor,other=>sim.world.contactPair(floor,other,(manifold,flipped)=>{
    const up=manifold.normal().y*(flipped?-1:1),body=other.parent();
    if(up<.15||!body?.isDynamic())return;
    for(let k=0;k<manifold.numContacts();k++){
     const force=up*manifold.contactImpulse(k)/dt;
     if(force<=0&&manifold.contactDist(k)>.004)continue;
     const point=flipped?manifold.localContactPoint2(k):manifold.localContactPoint1(k);
     if(!point)continue;
     const world=new Vector3().copy(point).applyQuaternion(floor.rotation()).add(floor.translation());
     let contact=supports.get(body);
     if(!contact){contact={points:[],force:0};supports.set(body,contact);}
     contact.points.push(world);contact.force+=force;
     if(force>0)accumulate(world.x,world.z,force);
    }
   }));
  }
  // Sleeping or contact-reduced bodies may report manifold points but zero impulses.
  // Recover static weight across their actual support polygon only at rest.
  for(const [body,contact] of supports){
   if(contact.force>.001||Math.abs(body.linvel().y)>.08)continue;
   if(sim.joints.some(l=>l.child.body===body||l.parent?.body===body))continue;
   const share=Math.max(0,-body.mass()*sim.world.gravity.y-body.userForce().y)/contact.points.length;
   for(const p of contact.points)accumulate(p.x,p.z,share);
  }
  for(const [key,p] of loads)if(!this.points.has(key))this.points.set(key,{...p,stress:0});
  let changed=false;
  for(const [key,p] of this.points){
   const force=loads.get(key)?.force||0;
   p.stress+=(force/(CELL*CELL)-p.stress)*(-Math.expm1(-interval/.22));
   const modulus=Math.max(1,m.youngModulus),yieldStress=m.yieldStress+m.cohesion;
   const elastic=Math.min(.18,CELL*Math.min(p.stress,yieldStress)/modulus);
   const plastic=Math.min(.24,CELL*Math.max(0,p.stress-yieldStress)/modulus*(1-m.restitution));
   let n=sim.cuts.nodes.get(key);
   if(Math.max(elastic,plastic)>.0006)n??=sim.cuts.node(p.i*CELL,p.j*CELL);
   if(n){
    const deflection=elastic>.0005?elastic:0,old=n.bearing||0;
    const creep=Math.max(0,plastic-(n.compaction||0))*(-Math.expm1(-interval/.7));
    if(Math.abs(deflection-old)>.00025||creep>.0001){
     n.bearing=deflection;n.compaction=(n.compaction||0)+creep;sim.cuts.version++;changed=true;
     if(!n.bearing&&!n.compaction&&!n.depth&&!n.elastic)sim.cuts.nodes.delete(key);
    }
   }
   if(!force&&p.stress<1)this.points.delete(key);
  }
  if(changed){
   if(sim.flatFloor){sim.world.removeCollider(sim.flatFloor,true);sim.flatFloor=null;}
   sim.dunes.next=0;
  }
 }
}
