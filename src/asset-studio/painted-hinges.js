import {Vector3} from 'three';
import {structureBody} from './fracture.js';
import {supportedMark} from './gaussian-marks.js';

const v = a => new Vector3().fromArray(a);
const clamp = (x, limit) => Math.max(-limit, Math.min(limit,x));

// One angular degree of freedom per painted root. Loads are evaluated on the
// simulation clock. A split host transfers each hinge to its owning fragment.
export class PaintedHinges {
  constructor(){
    this.parts=new Map();this.revision=0;this.count=0;
    this.probe=new Vector3();this.normal=new Vector3();this.along=new Vector3();this.force=new Vector3();
  }
  attach(body,materials){
    if(!body.part.marks?.length)return;
    const hinges=[];
    for(const mark of body.part.marks){
      if(!supportedMark(body.part,mark,materials))continue;
      const paint=materials.get(mark.materialId);
      hinges.push({mark,body,owner:body,regionCount:0, angle:0,velocity:0,
        anchor:v(mark.root).multiply(body.scale),probe:v(mark.root).addScaledVector(v(mark.axis),mark.length*.55),
        previous:new Vector3(),speed:new Vector3(),initialized:false,
        // A thinner, lighter lamina has less mass per unit of exposed area.
        windFactor:Math.min(1,1.2/(Math.max(1,paint.density)*Math.max(.002,.016*mark.length)))});
    }
    if(hinges.length){this.parts.set(body.key,hinges);this.count+=hinges.length;}
  }
  // Cursor force is measured at the point grabbed. Near-root grabs have
  // proportionally less leverage, and released forces expire on simulation time.
  grab(key,id,worldPoint){
    const hinge=this.parts.get(key)?.find(h=>h.mark.id===id);
    if(!hinge||hinge.mark.flex===0)return null;
    const tipDistance=worldPoint.clone().applyMatrix4(hinge.owner.matrix.clone().invert())
      .sub(v(hinge.mark.root)).dot(v(hinge.mark.axis));
    hinge.lever=Math.max(0,Math.min(1,tipDistance/hinge.mark.length));
    hinge.cursorForce=new Vector3();hinge.until=Infinity;
    return hinge;
  }
  step(dt,wind,gravity,time){
    const heading=(wind?.heading||0)*Math.PI/180,wx=Math.cos(heading)*(wind?.speed||0),wz=Math.sin(heading)*(wind?.speed||0);
    for(const hinges of this.parts.values())for(const h of hinges){
      const count=h.body.structure?.bodies.size||1;
      if(h.regionCount!==count){
        const owner=count>1||h.body.structure?.meltRevision?structureBody(h.body,h.anchor):h.body;
        if(owner!==h.owner){h.owner=owner;h.initialized=false;this.revision++;}
        h.regionCount=count;
      }
      const m=h.mark, matrix=h.owner.matrix;
      if(m.flex===0)continue;
      this.probe.copy(h.probe).applyMatrix4(matrix);
      this.normal.fromArray(m.up).transformDirection(matrix);
      this.along.fromArray(m.axis).transformDirection(matrix);
      // Re-orthogonalize after a nonuniform placement scale.
      this.normal.addScaledVector(this.along,-this.normal.dot(this.along)).normalize();
      let acceleration=0;
      if(h.initialized){
        this.force.subVectors(this.probe,h.previous).multiplyScalar(1/dt);
        acceleration=(this.force.dot(this.normal)-h.speed.dot(this.normal))/dt;
        h.speed.copy(this.force);
      }
      h.initialized=true;h.previous.copy(this.probe);
      const incidence=wx*this.normal.x+wz*this.normal.z;
      const gust=.86+.14*Math.sin(time*2.8+this.probe.x*.71+this.probe.z*.47);
      let load=gravity*this.normal.y-acceleration+incidence*Math.hypot(wx,wz)*h.windFactor*gust;
      if(h.cursorForce){
        if(time>=h.until)h.cursorForce=null;
        else load+=h.cursorForce.dot(this.normal)*h.lever*h.windFactor/Math.max(.001,m.length*m.length*m.width);
      }
      const frequency=5+15*(1-m.flex);
      const target=clamp(load*m.flex/(frequency*frequency*Math.max(.1,m.length)*.52),1.02);
      h.velocity+=(frequency*frequency*(target-h.angle)-1.25*frequency*h.velocity)*dt;
      h.angle=clamp(h.angle+h.velocity*dt,1.18);
    }
  }
}
