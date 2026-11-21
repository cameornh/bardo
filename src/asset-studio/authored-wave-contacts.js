import {Box3,Matrix3,Matrix4,Ray,Vector3} from 'three';
import {field,gridSpec} from './sculpt.js';
import {sampleWaveContact} from './fluid-forces.js';

const stationary=new Vector3();
export class AuthoredWaveContacts{
 constructor(){this.entries=[];this.cursor=0;this.at=0;}
 rebuild(view){
  this.entries=[];this.cursor=0;this.at=0;
  for(const group of view.groups.values()){
   const asset=view.library.assets.find(a=>a.id===group.userData.assetId);
   for(const object of group.children){
    const part=asset.parts.find(p=>p.id===object.userData.partId),spec=gridSpec(part.stamps,.25);
    if(!spec)continue;
    const lo=new Vector3(...spec.origin),hi=new Vector3(...spec.dims.map((v,i)=>spec.origin[i]+(v-1)*spec.h));
    this.entries.push({object,stamps:part.stamps,bounds:new Box3(lo,hi)});
   }
  }
 }
 advance(sea){
  if(!this.entries.length||sea.speed<4)return;
  if(this.at>sea.time+.05)this.at=0;
  if(sea.time<this.at)return;
  this.at=sea.time+1/30;
  const e=this.entries[this.cursor++%this.entries.length];
  if(sea.time<(e.nextProbe||0))return;
  e.object.updateWorldMatrix(true,false);
  const matrix=e.object.matrixWorld,box=e.bounds.clone().applyMatrix4(matrix);
  sampleWaveContact(sea,e,box.getCenter(new Vector3()),box.getSize(new Vector3()).length()*.5,stationary,(origin,dir,reach)=>{
   const inverse=new Matrix4().copy(matrix).invert(),ray=new Ray(new Vector3().copy(origin),new Vector3().copy(dir)).applyMatrix4(inverse);
   const point=ray.intersectBox(e.bounds,new Vector3());if(!point)return null;
   if(e.bounds.containsPoint(ray.origin))point.copy(ray.origin);
   // March only inside one authored part, with a fixed per-update budget.
   const distance=p=>field(p.toArray(),e.stamps)[0];
   for(let i=0;i<32;i++){
    const d=distance(point);
    if(d<.006){
     const grad=new Vector3();
     for(const axis of ['x','y','z']){const p=point.clone();p[axis]+=.004;grad[axis]=(distance(p)-d)/.004;}
     const world=point.applyMatrix4(matrix);
     if(world.distanceTo(origin)>reach)return null;
     return {point:world,normal:grad.applyNormalMatrix(new Matrix3().getNormalMatrix(matrix))};
    }
    point.addScaledVector(ray.direction,Math.max(.004,d*.85));if(!e.bounds.containsPoint(point))break;
   }
   return null;
  });
 }
}
