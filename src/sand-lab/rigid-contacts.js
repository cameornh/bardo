import {Quaternion,Euler,Vector3} from 'three';
import {rotate,normalAt} from './water-lab-model.js';
import {bodyDistance,bodyNormal,bodyVolume,bodySupport} from './objects.js';
export const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const add=(a,b)=>a.map((v,k)=>v+b[k]);
export const bodyMass=b=>Math.max(1e-12,bodyVolume(b)*b.ratio+(b.waterVolume||0));
export function inverseInertia(b,v){
 if(b.held||b.fixed)return [0,0,0];const q=rotate(v,b.tilt,b.spin,true,b.pitch),mr2=bodyMass(b)*b.radius**2;
 return rotate(q.map((v,k)=>v/(mr2*(b.shape==='cup'?(k===1?.78:.69):.4))),b.tilt,b.spin,false,b.pitch);
}
export function pointVelocity(b,point){return add(b.velocity,cross(b.omega||[0,0,0],point.map((v,k)=>v-b.position[k])));}
export function bodyImpulse(b,point,impulse){
 if(b.held||b.fixed)return;const w=inverseInertia(b,cross(point.map((v,k)=>v-b.position[k]),impulse));
 for(let k=0;k<3;k++){b.velocity[k]+=impulse[k]/bodyMass(b);b.omega[k]+=w[k];}
}
export function integrateOrientation(b,dt){
 if(b.held||b.fixed)return;
 const speed=Math.hypot(...b.omega);if(speed<1e-12)return;
 const q=new Quaternion().setFromEuler(new Euler(b.pitch,b.spin,b.tilt,'XZY'));
 q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(...b.omega).multiplyScalar(1/speed),speed*dt)).normalize();
 const e=new Euler().setFromQuaternion(q,'XZY');b.pitch=e.x;b.spin=e.y;b.tilt=e.z;
}
export function bodyContactPoints(b){
 const r=b.radius,local=[];
 if(b.shape==='cup'){
  for(const y of [-1.16,-1,0,1])for(let i=0;i<24;i++){const a=i*Math.PI/12;local.push([r*Math.cos(a),r*y,r*Math.sin(a)]);}
  for(const y of [-1.16,-.84]){local.push([0,r*y,0]);for(let i=0;i<12;i++){const a=i*Math.PI/6;local.push([r*.5*Math.cos(a),r*y,r*.5*Math.sin(a)]);}}
  for(let i=0;i<24;i++){const a=i*Math.PI/12;local.push([r*.68*Math.cos(a),r,r*.68*Math.sin(a)]);}
 }else for(let i=0;i<48;i++){const y=1-2*(i+.5)/48,a=i*2.39996323,s=Math.sqrt(1-y*y);local.push([r*s*Math.cos(a),r*y,r*s*Math.sin(a)]);}
 return local.map(p=>add(b.position,rotate(p,b.tilt,b.spin,false,b.pitch)));
}
function effectiveMass(b,p,n){if(!b||b.held||b.fixed)return 0;const arm=p.map((v,k)=>v-b.position[k]);return 1/bodyMass(b)+dot(cross(inverseInertia(b,cross(arm,n)),arm),n);}
// n points out of the contacted receiver towards a. Contact impulses include
// angular velocity and Coulomb friction; an off-centre hit creates real torque.
export function solveContact(a,b,p,n,depth,dt){
 const ia=(a.held||a.fixed)?0:1/bodyMass(a),ib=!b||b.held||b.fixed?0:1/bodyMass(b),sum=ia+ib;if(!sum)return;
 const relative=pointVelocity(a,p).map((v,k)=>v-(b?pointVelocity(b,p)[k]:0)),vn=dot(relative,n),denom=effectiveMass(a,p,n)+effectiveMass(b,p,n);
 const impulse=Math.max(0,-vn*(vn<-.1?1.08:1))/Math.max(1e-12,denom);
 if(impulse){bodyImpulse(a,p,n.map(v=>v*impulse));if(b)bodyImpulse(b,p,n.map(v=>-v*impulse));
  const tangent=relative.map((v,k)=>v-n[k]*vn),speed=Math.hypot(...tangent);
  if(speed>1e-9){const t=tangent.map(v=>v/speed),friction=Math.min(impulse*.5,speed/(effectiveMass(a,p,t)+effectiveMass(b,p,t)));bodyImpulse(a,p,t.map(v=>-v*friction));if(b)bodyImpulse(b,p,t.map(v=>v*friction));}
 }
 const correction=Math.max(0,depth-1e-5)*.85;
 for(let k=0;k<3;k++){a.position[k]+=n[k]*correction*ia/sum;if(b)b.position[k]-=n[k]*correction*ib/sum;}
}
export function resolveBodyTerrain(b,distance,dt){
 if(b.held||b.fixed||distance(b.position)>b.radius*1.6)return 0;let max=0;
 for(let iteration=0;iteration<5;iteration++){
  const origin=b.position.slice();let points=bodyContactPoints(b);
  if(b.shape!=='cup'){const n=normalAt(b.position,distance);points.unshift(b.position.map((v,k)=>v-n[k]*b.radius));}
  const hits=points.map(p=>({p,d:distance(p)})).filter(c=>c.d<.0002).sort((a,b)=>a.d-b.d).slice(0,12);
  if(!hits.length)break;
  for(const hit of hits){const p=hit.p.map((v,k)=>v+b.position[k]-origin[k]),d=distance(p);if(d>.0002)continue;const n=normalAt(p,distance);max=Math.max(max,-d);solveContact(b,null,p,n,Math.max(0,-d),dt);}
 }
 return max;
}
export function resolveBodyPairs(bodies,dt){
 let tested=0,contacts=0;
 for(let iteration=0;iteration<4;iteration++)for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
  const a=bodies[i],b=bodies[j],separation=Math.hypot(...a.position.map((v,k)=>v-b.position[k]));if((a.held||a.fixed)&&(b.held||b.fixed)||separation>(a.radius+b.radius)*1.55)continue;tested++;
  // Two objects spawned at exactly the same pose have coincident surfaces:
  // a surface-only overlap query has no inward normal. Break that degeneracy
  // deterministically before resolving their actual hollow walls below.
  if(a.shape===b.shape&&Math.abs(a.radius-b.radius)<a.radius*.001&&separation<Math.min(a.radius,b.radius)*.001){const axis=[1,0,0],point=a.position.map((v,k)=>(v+b.position[k])*.5);solveContact(a,b,point,axis,(bodySupport(a,[-1,0,0])+bodySupport(b,axis)+.0001)/.85,dt);}

  for(const [first,other] of [[a,b],[b,a]]){
   const origin=first.position.slice();let points=bodyContactPoints(first);
   if(first.shape!=='cup'){const n=bodyNormal(first.position,other);points.unshift(first.position.map((v,k)=>v-n[k]*first.radius));}
   const hits=points.map(p=>({p,d:bodyDistance(p,other)})).filter(c=>c.d<0).sort((a,b)=>a.d-b.d).slice(0,8);
   for(const hit of hits){const p=hit.p.map((v,k)=>v+first.position[k]-origin[k]),d=bodyDistance(p,other);if(d>=0)continue;contacts++;solveContact(first,other,p,bodyNormal(p,other),-d,dt);}
  }
 }
 // Teleporting / spawning a held cup can interlock both shells deeply. Local
 // wall projections then oppose each other. Recover those invalid initial
 // overlaps along an exterior support axis; ordinary shallow contacts retain
 // their hollow geometry and smaller objects may still enter a cup's cavity.
 if(contacts)for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
  const a=bodies[i],b=bodies[j],delta=a.position.map((v,k)=>v-b.position[k]),d=Math.hypot(...delta);if((a.held||a.fixed)&&(b.held||b.fixed)||d>(a.radius+b.radius)*1.55)continue;
  const hits=[...bodyContactPoints(a).map(p=>({p,d:bodyDistance(p,b)})),...bodyContactPoints(b).map(p=>({p,d:bodyDistance(p,a)}))];
  const deepest=hits.reduce((a,b)=>a.d<b.d?a:b);if(deepest.d>=-Math.min(a.radius,b.radius)*.04)continue;
  const axis=d>1e-9?delta.map(v=>v/d):[1,0,0],depth=bodySupport(a,axis.map(v=>-v))+bodySupport(b,axis)-d;
  if(depth>0)solveContact(a,b,deepest.p,axis,(depth+.0001)/.85,dt);
 }
 return {tested,contacts};
}
