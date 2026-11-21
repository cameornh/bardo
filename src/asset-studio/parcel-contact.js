// Sweep the visible parcel envelope against the authored constructive solid.
// The smallest axis scale is a conservative step bound under non-uniform scale.
import {Box3,Matrix3,Matrix4,Ray,Vector3} from 'three';
import {field,gridSpec} from './sculpt.js';
import {looseKind} from './loose-matter.js';

export function parcelObstacle(stamps,matrix,materials,playing=false){
 if(materials)stamps=stamps.filter(s=>{
  if(s.mode==='paint')return false;if(s.mode==='subtract')return true;
  const m=materials.find(m=>m.id===s.materialId);
  return m&&m.phase!=='gas'&&looseKind(m)<(playing?1:2);
 });
 const spec=gridSpec(stamps,.25);
 if(!spec)return null;
 const lo=new Vector3(...spec.origin),hi=new Vector3(...spec.dims.map((v,i)=>lo.getComponent(i)+(v-1)*spec.h));
 return {stamps,matrix,local:new Box3(lo,hi),box:new Box3(),last:null,inverse:new Matrix4(),normal:new Matrix3()};
}
function sync(o){
 const m=o.matrix();
 if(o.last?.equals(m))return;
 (o.last??=new Matrix4()).copy(m);o.inverse.copy(m).invert();o.normal.getNormalMatrix(m);o.box.copy(o.local).applyMatrix4(m);
 const e=o.inverse.elements;
 // A row-sum bound on the squared inverse stretch also covers sheared placements.
 let norm2=0;for(let i=0;i<3;i++){let sum=0;for(let j=0;j<3;j++)sum+=Math.abs(e[i]*e[j]+e[i+4]*e[j+4]+e[i+8]*e[j+8]);norm2=Math.max(norm2,sum);}
 o.scale=1/Math.sqrt(norm2);
}
function obstacleDistance(o,p){
 const d=field(p.toArray(),o.stamps)[0];if(!o.fragments)return d;
 let nearest=Infinity;
 for(const s of o.fragments){
  const x=Math.abs(p.x-s.center[0])-s.half[0],y=Math.abs(p.y-s.center[1])-s.half[1],z=Math.abs(p.z-s.center[2])-s.half[2];
  let distance=Math.hypot(Math.max(0,x),Math.max(0,y),Math.max(0,z))+Math.min(0,Math.max(x,y,z));
  if(s.planes&&distance<nearest)for(const [nx,ny,nz,d] of s.planes)distance=Math.max(distance,nx*p.x+ny*p.y+nz*p.z-d);
  nearest=Math.min(nearest,distance);
 }
 return Math.max(d,nearest);
}
function sweep(o,start,dir,length,radius){
 sync(o);
 const end=start.clone().addScaledVector(dir,length),lo=o.box.min,hi=o.box.max;
 for(const axis of ['x','y','z'])if(Math.max(start[axis],end[axis])<lo[axis]-radius-.003||Math.min(start[axis],end[axis])>hi[axis]+radius+.003)return null;
 const box=o.box.clone().expandByScalar(radius+.003);
 let t=0;
 if(!box.containsPoint(start)){
  if(!length)return null;
  const entry=new Ray(start,dir).intersectBox(box,new Vector3());
  if(!entry||(t=entry.distanceTo(start))>length)return null;
 }
 const p=new Vector3(),local=new Vector3(),n=new Vector3(),eps=.0005;
 for(let i=0;i<80;i++){
  p.copy(start).addScaledVector(dir,t);local.copy(p).applyMatrix4(o.inverse);
  const d=obstacleDistance(o,local),gap=d*o.scale-radius;
  if(gap<.001){
   let best=0,bestSign=1,bestAxis='y';
   for(const axis of ['x','y','z']){
    local[axis]+=eps;const a=obstacleDistance(o,local);local[axis]-=2*eps;
    const b=obstacleDistance(o,local);local[axis]+=eps;n[axis]=(a-b)/(2*eps);
    const rise=Math.max(a,b)-d;if(rise>best){best=rise;bestSign=a>=b?1:-1;bestAxis=axis;}
   }
   // Convert the local signed distance to metres along the world normal.
   if(n.lengthSq()<1e-12&&best>0){n.set(0,0,0);n[bestAxis]=bestSign*best/eps;}
   n.applyMatrix3(o.normal);const gradient=n.length();
   if(gradient>1e-6)n.divideScalar(gradient);else if(length)n.copy(dir).negate();else n.set(0,1,0);
   const separation=radius-d/Math.max(1e-6,gradient||1/o.scale);
   if(separation>=-.001)return {t,p:p.clone().addScaledVector(n,Math.max(0,separation)+.0015),n};
   t+=Math.max(.001,-separation*.45);
  }else t+=gap*.95;
  if(t>length)return null;
 }
 return null;
}
export function resolveParcel(obstacles,drop,previous){
 if(!obstacles.length)return false;
 const start=new Vector3().copy(previous),target=new Vector3().copy(drop);
 const stretch=drop.held?1.30:1+Math.min(1.05,Math.hypot(drop.vx,drop.vy,drop.vz)*.16);
 const radius=drop.r*stretch;
 let touched=false;
 for(let pass=0;pass<4;pass++){
  const direction=target.clone().sub(start),length=direction.length();if(length)direction.divideScalar(length);
  let hit=null;
  for(const obstacle of obstacles){
   const next=sweep(obstacle,start,direction,hit?hit.t:length,radius);if(next&&(!hit||next.t<hit.t))hit=next;
  }
  if(!hit){start.copy(target);break;}
  const {n,p,t}=hit,remaining=direction.multiplyScalar(Math.max(0,length-t));
  remaining.addScaledVector(n,-Math.min(0,remaining.dot(n)));
  const vn=drop.vx*n.x+drop.vy*n.y+drop.vz*n.z;
  if(vn<0){drop.vx=(drop.vx-1.1*vn*n.x)*.85;drop.vy=(drop.vy-1.1*vn*n.y)*.85;drop.vz=(drop.vz-1.1*vn*n.z)*.85;drop.foam=Math.min(.7,.12-vn*.075);}
  touched=true;start.copy(p);target.copy(p).add(remaining);
  // Recheck even a stationary parcel: the first correction can reveal a second contact.
 }
 if(touched){drop.x=start.x;drop.y=start.y;drop.z=start.z;}
 return touched;
}
