import {Quaternion,Vector3} from 'three';

// One interior section for a slender solid beam. Both rigid segments retain the
// author's local frame. Section forces come from the solved external reactions.
export function beamSection(part,shapes,scale,rotation,anchor,material){
 if(part.stamps.length!==1||shapes.length!==1||shapes[0].type!=='box'||material.phase!=='solid'||material.youngModulus<=0)return null;
 const box=shapes[0],dims=box.half.map((h,i)=>2*h*scale.getComponent(i));
 const axis=dims.indexOf(Math.max(...dims)),b=(axis+1)%3,c=(axis+2)%3,length=dims[axis];
 if(length<.35||length<2.7*Math.max(dims[b],dims[c]))return null;
 const axisVector=new Vector3().setComponent(axis,1),center=new Vector3(...box.center).multiply(scale);
 // Choose the supported half from the authored joint or pivot. For a centered
 // freestanding post choose the lower end in world space.
 const offset=anchor.getComponent(axis)-center.getComponent(axis);
 const sign=Math.abs(offset)>.01?-Math.sign(offset):(axisVector.clone().applyQuaternion(rotation).y<0?-1:1);
 const halves=[-sign,sign].map(side=>{
  const half=box.half.slice(),mid=box.center.slice();half[axis]*=.5;mid[axis]+=side*half[axis];
  return {...box,center:mid,half};
 });
 const area=dims[b]*dims[c],ib=area*dims[c]**2/12,ic=area*dims[b]**2/12;
 return {halves,axis,b,c,sign,center,length,area,ib,ic,zb:ib/(dims[c]/2),zc:ic/(dims[b]/2),
  material,status:'intact',buckling:0,fracture:0,exposed:false};
}

export function bindSection(sim,section,parent,child){
 const id=new Quaternion(),at=section.center,R=sim.R;
 const joint=sim.world.createImpulseJoint(R.JointData.fixed(at,id,at,id),parent.body,child.body,true);
 joint.setContactsEnabled(false);
 const link={j:{type:'fixed'},section,parent,child,joint,support:1,rest:id,anchorParent:at,anchorChild:at};
 parent.section=section;child.section=section;section.root=parent;section.tip=child;
 sim.sections.push(section);sim.internalLinks.push(link);
}

// Time over capacity matters. A single solver spike cannot break a member.
function exposure(previous,ratio,dt){
 return Math.max(0,previous+dt*(ratio>1?Math.min(5,ratio-1):-2));
}
export function sectionFailure(sim,link,force,moment,dt){
 const s=link.section,m=s.material,rotation=new Quaternion().copy(link.parent.body.rotation());
 const inv=rotation.clone().invert(),f=force.clone().applyQuaternion(inv),torque=moment.clone().applyQuaternion(inv);
 const axial=f.getComponent(s.axis)*s.sign;
 const bending=Math.abs(torque.getComponent(s.b))/s.zb+Math.abs(torque.getComponent(s.c))/s.zc;
 const shear=1.5*Math.hypot(f.getComponent(s.b),f.getComponent(s.c))/s.area;
 const tension=Math.max(0,bending+axial/s.area),strength=Math.max(1,m.cohesion+m.tensileStrength);
 const effectiveLength=s.length*(link.parent.body.isFixed()?2:1);
 const critical=Math.PI**2*m.youngModulus*Math.min(s.ib,s.ic)/effectiveLength**2;
 const compressRatio=Math.max(0,-axial)/Math.max(1,critical);
 let ratio=Math.hypot(tension,shear)/strength;
 if(s.status==='buckled'){
  // The articulated section now carries its bending moment through a spring.
  const angle=rotation.angleTo(new Quaternion().copy(link.child.body.rotation()));
  const strain=angle*Math.max(s.ib/s.zb,s.ic/s.zc)/s.length;
  ratio=Math.max(ratio,m.youngModulus*strain/strength);
 }
 s.fracture=exposure(s.fracture,ratio,dt);
 if(s.fracture>.24){s.status='fractured';s.exposed=true;return true;}
 if(s.status!=='intact')return false;
 s.buckling=exposure(s.buckling,compressRatio,dt);
 if(s.buckling>.18){
  s.status='buckled';s.exposed=true;
  sim.world.removeImpulseJoint(link.joint,true);
  link.joint=sim.world.createImpulseJoint(sim.R.JointData.spherical(s.center,s.center),link.parent.body,link.child.body,true);
  link.joint.setContactsEnabled(false);
  const k=m.youngModulus*Math.min(s.ib,s.ic)/s.length;
  link.j={type:'ball',looseness:0,stiffness:k,damping:.28*Math.sqrt(k*Math.min(...Object.values(link.child.body.principalInertia())))};
  // Seed the weakest bending axis in a perfectly aligned numerical column.
  const axis=new Vector3().setComponent(s.ib<=s.ic?s.b:s.c,1).applyQuaternion(rotation);
  const kick=axis.multiplyScalar(.006*link.child.body.mass()*s.length);
  link.child.body.applyTorqueImpulse(kick,true);
  if(link.parent.body.isDynamic())link.parent.body.applyTorqueImpulse(kick.negate(),true);
 }
 return false;
}
export function sectionBody(record,localAnchor){
 const s=record?.section;
 if(!s||record!==s.root)return record;
 return (localAnchor.getComponent(s.axis)-s.center.getComponent(s.axis))*s.sign>0?s.tip:record;
}
