import {Quaternion,Vector3} from 'three';

// Slender rectangular stock also admits an Euler buckling mode. Failure of
// the intact stock is evaluated at the same local bonds as other solids.
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
 const area=dims[b]*dims[c],ib=area*dims[c]**2/12,ic=area*dims[b]**2/12;
 const tipPoint=center.clone().addScaledVector(axisVector,sign*length/2);
 return {axis,b,c,sign,center,tipPoint,length,area,ib,ic,zb:ib/(dims[c]/2),zc:ic/(dims[b]/2),
  material,status:'intact',buckling:0,fracture:0,exposed:false};
}

// Buckling leaves an elastic articulation at the compressed section. Other
// bonds in both pieces keep carrying load and can still fracture.
export function bindBuckledSection(sim,s,parent,child){
 s.status='buckled';s.exposed=true;s.root=parent;s.tip=child;
 const k=s.material.youngModulus*Math.min(s.ib,s.ic)/s.length;
 const data=sim.R.JointData.spherical(s.center,s.center);
 const link={j:{type:'ball',looseness:0,stiffness:k,damping:.28*Math.sqrt(k*Math.min(...Object.values(child.body.principalInertia())))},
  section:s,parent,child,data,support:1,rest:new Quaternion(),anchorParent:s.center,anchorChild:s.center};
 sim.rebindJoint(link);sim.internalLinks.push(link);
 const axis=new Vector3().setComponent(s.ib<=s.ic?s.b:s.c,1).applyQuaternion(parent.body.rotation());
 const kick=axis.multiplyScalar(.006*child.body.mass()*s.length);
 child.body.applyTorqueImpulse(kick,true);if(parent.body.isDynamic())parent.body.applyTorqueImpulse(kick.negate(),true);
}
export function sectionFailure(sim,link,force,moment,dt){
 const s=link.section,m=s.material,inv=new Quaternion().copy(link.parent.body.rotation()).invert();
 const f=force.clone().applyQuaternion(inv),t=moment.clone().applyQuaternion(inv);
 const bending=Math.abs(t.getComponent(s.b))/s.zb+Math.abs(t.getComponent(s.c))/s.zc;
 const tensile=Math.max(0,bending+f.getComponent(s.axis)*s.sign/s.area);
 const shear=1.5*Math.hypot(f.getComponent(s.b),f.getComponent(s.c))/s.area;
 const angle=new Quaternion().copy(link.parent.body.rotation()).angleTo(link.child.body.rotation());
 const strain=angle*Math.max(s.ib/s.zb,s.ic/s.zc)/s.length;
 const stress=Math.max(Math.hypot(tensile,shear),m.youngModulus*strain);
 const ratio=stress/Math.max(1,m.cohesion+m.tensileStrength);
 s.fracture=Math.max(0,s.fracture+dt*(ratio>1?Math.min(5,ratio-1):-2));
 if(s.fracture<=(m.fractureDelay??.24))return false;
 s.status='fractured';return true;
}
