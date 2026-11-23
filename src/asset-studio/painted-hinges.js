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
      const probe=v(mark.root).addScaledVector(v(mark.axis),mark.length*.55);
      const ux=mark.up[0],uy=mark.up[1],uz=mark.up[2];
      const ax=mark.axis[0],ay=mark.axis[1],az=mark.axis[2];
      const freq=5+15*(1-mark.flex),freq2=freq*freq;
      hinges.push({mark,body,owner:body,regionCount:0, angle:0,velocity:0,
        anchor:v(mark.root).multiply(body.scale),probe,
        previous:new Vector3(),speed:new Vector3(),initialized:false,
        // A thinner, lighter lamina has less mass per unit of exposed area.
        windFactor:Math.min(1,1.2/(Math.max(1,paint.density)*Math.max(.002,.016*mark.length))),
        px:probe.x,py:probe.y,pz:probe.z,ux,uy,uz,ax,ay,az,
        freq2,damp:1.25*freq,
        targetScale:mark.flex/(freq2*Math.max(.1,mark.length)*.52),
        isFlexure:body.part.joint?.type==='flexure',
        fastNormal:Math.abs(body.scale.x-body.scale.y)<1e-6&&Math.abs(body.scale.x-body.scale.z)<1e-6&&Math.abs(ux*ax+uy*ay+uz*az)<1e-5,
        prevX:0,prevY:0,prevZ:0,spdX:0,spdY:0,spdZ:0});
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
    const windSpeed=Math.hypot(wx,wz),invDt=1/dt,flexAlpha=-Math.expm1(-dt/.055);
    for(const hinges of this.parts.values())for(const h of hinges){
      if(h.body.structure){
        const count=h.body.structure.bodies.size||1;
        if(h.regionCount!==count){
          const owner=count>1||h.body.structure.meltRevision?structureBody(h.body,h.anchor):h.body;
          if(owner!==h.owner){h.owner=owner;h.initialized=false;this.revision++;}
          h.regionCount=count;
        }
      }
      const m=h.mark;
      if(m.flex===0)continue;
      const e=h.owner.matrix.elements;
      const prx=e[0]*h.px+e[4]*h.py+e[8]*h.pz+e[12];
      const pry=e[1]*h.px+e[5]*h.py+e[9]*h.pz+e[13];
      const prz=e[2]*h.px+e[6]*h.py+e[10]*h.pz+e[14];
      let nx=e[0]*h.ux+e[4]*h.uy+e[8]*h.uz;
      let ny=e[1]*h.ux+e[5]*h.uy+e[9]*h.uz;
      let nz=e[2]*h.ux+e[6]*h.uy+e[10]*h.uz;
      let nLen=Math.hypot(nx,ny,nz);
      if(nLen>0){const inv=1/nLen;nx*=inv;ny*=inv;nz*=inv;}
      if(!h.fastNormal){
        let lx=e[0]*h.ax+e[4]*h.ay+e[8]*h.az;
        let ly=e[1]*h.ax+e[5]*h.ay+e[9]*h.az;
        let lz=e[2]*h.ax+e[6]*h.ay+e[10]*h.az;
        const lLen=Math.hypot(lx,ly,lz);
        if(lLen>0){const inv=1/lLen;lx*=inv;ly*=inv;lz*=inv;}
        const d=nx*lx+ny*ly+nz*lz;
        nx-=d*lx;ny-=d*ly;nz-=d*lz;
        nLen=Math.hypot(nx,ny,nz);
        if(nLen>0){const inv=1/nLen;nx*=inv;ny*=inv;nz*=inv;}
      }
      let acceleration=0;
      if(h.initialized){
        const fx=(prx-h.prevX)*invDt,fy=(pry-h.prevY)*invDt,fz=(prz-h.prevZ)*invDt;
        acceleration=((fx-h.spdX)*nx+(fy-h.spdY)*ny+(fz-h.spdZ)*nz)*invDt;
        // A flexing stem can carry tiny contact corrections at the physics
        // frequency. Its blade responds to sustained acceleration and gusts.
        if(h.isFlexure){
          h.acceleration=(h.acceleration??0)+(acceleration-(h.acceleration??0))*flexAlpha;
          acceleration=h.acceleration;
        }
        h.spdX=fx;h.spdY=fy;h.spdZ=fz;
      }
      h.initialized=true;h.prevX=prx;h.prevY=pry;h.prevZ=prz;h.previous.set(prx,pry,prz);
      const incidence=wx*nx+wz*nz;
      const gust=.86+.14*Math.sin(time*2.8+prx*.71+prz*.47);
      let load=gravity*ny-acceleration+incidence*windSpeed*h.windFactor*gust;
      if(h.cursorForce){
        if(time>=h.until)h.cursorForce=null;
        else load+=(h.cursorForce.x*nx+h.cursorForce.y*ny+h.cursorForce.z*nz)*h.lever*h.windFactor/Math.max(.001,m.length*m.length*m.width);
      }
      const target=clamp(load*h.targetScale,1.02);
      h.velocity+=(h.freq2*(target-h.angle)-h.damp*h.velocity)*dt;
      h.angle=clamp(h.angle+h.velocity*dt,1.18);
    }
  }
}
