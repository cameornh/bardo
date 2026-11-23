// The six triangles share the same diagonal as the Rapier terrain heightfield.
// Removing one node's linear basis function cuts exactly CELL² * depth.
import {liquidity} from './physics-data.js';
import {Vector3} from 'three';
import {SAND_SIDE,SAND_METRES} from './wind-sand.js';
export const CELL=SAND_METRES/SAND_SIDE,MAX_CUTS=64;
const rim=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
export const footprint=(u,v)=>Math.max(0,1-Math.max(Math.abs(u),Math.abs(v),Math.abs(u+v)));
export function groundWedge(x,z,depth,height){
 const top=new Vector3(x,height(x,z),z);
 const ring=rim.map(([i,j])=>new Vector3(i*CELL,height(x+i*CELL,z+j*CELL)-top.y,j*CELL));
 return {top,ring,depth,volume:CELL*CELL*depth};
}
export class GroundCuts{
 constructor(){this.nodes=new Map();this.version=0;}
 offset(x,z){
  if(!this.nodes.size)return 0;
  const u=x/CELL,v=z/CELL,i=Math.floor(u),j=Math.floor(v);let depth=0;
  for(let a=i;a<=i+1;a++)for(let b=j;b<=j+1;b++){
   const n=this.nodes.get(a+','+b);if(n)depth+=(n.depth+n.elastic+(n.bearing||0)+(n.compaction||0))*footprint(u-a,v-b);
  }
  return -depth;
 }
 node(x,z){
  const i=Math.round(x/CELL),j=Math.round(z/CELL),key=i+','+j;
  let n=this.nodes.get(key);
  if(!n){if(this.nodes.size>=MAX_CUTS)return null;n={i,j,x:i*CELL,z:j*CELL,depth:0,elastic:0};this.nodes.set(key,n);}
  return n;
 }
 extract(x,z,depth,height){
  const n=this.node(x,z);if(!n||n.depth+depth>4)return null;
  const cut=groundWedge(n.x,n.z,depth,height);
  n.depth+=depth;this.version++;return cut;
 }
 displace(x,z,depth,elasticity){
  if(depth<.0002)return;
  const n=this.node(x,z);if(!n)return;
  n.depth=Math.min(4,n.depth+depth*(1-elasticity));n.elastic=Math.min(.3,n.elastic+depth*elasticity);this.version++;
 }
 relax(dt){
  for(const [key,n] of this.nodes)if(n.elastic>0){
   n.elastic*=Math.exp(-7*dt);if(n.elastic<.0005)n.elastic=0;
   if(!n.depth&&!n.elastic&&!n.bearing&&!n.compaction)this.nodes.delete(key);this.version++;
  }
 }
 triangles(){
  const faces=new Map();
  for(const {i,j} of this.nodes.values())for(let k=0;k<6;k++){
   const a=rim[k],b=rim[(k+1)%6],f=[[i,j],[i+a[0],j+a[1]],[i+b[0],j+b[1]]];
   faces.set(f.map(p=>p.join(',')).sort().join('|'),f);
  }
  return [...faces.values()].flatMap(f=>f.flatMap(([i,j])=>[i*CELL,this.offset(i*CELL,j*CELL),j*CELL]));
 }
}
export function chunkTriangles(c){
 if(c.vertices)return c.vertices;
 const out=[],bottom=[0,-c.depth,0];
 for(let i=0;i<6;i++){const a=c.ring[i].toArray(),b=c.ring[(i+1)%6].toArray();out.push(0,0,0,...a,...b,...bottom,...b,...a);}
 return out;
}
// Each cut wedge is a tetrahedron. Stratified barycentric samples preserve its volume.
export function chunkPackets(c,m,origin,count=18){
 const out=[],volume=c.volume/count;
 for(let i=0;i<count;i++){
  const k=i%6,frac=x=>x-Math.floor(x),u=[0,frac((i+1)*.75488),frac((i+1)*.56984),frac((i+1)*.43858),1].sort((a,b)=>a-b);
  const position=origin.clone().addScaledVector(c.ring[k],u[2]-u[1]).addScaledVector(c.ring[(k+1)%6],u[3]-u[2]);
  position.y-=(1-u[3])*c.depth;
  out.push({position,radius:Math.cbrt(volume*3/(4*Math.PI))*.87,volume,material:m});
 }
 return out;
}
// Distance in metres for a ground impulse to fall to 1/e of its contact force.
export const LOCAL_IMPULSE_REACH=.32;
export function impulseReach(m){
 const strength=m.cohesion+(m.phase==='granular'?0:m.tensileStrength);
 const connected=(1-liquidity(m))**2*strength/(strength+18000);
 const speed=Math.sqrt(m.youngModulus/Math.max(.01,m.density));
 return LOCAL_IMPULSE_REACH+4.7*connected*speed/(speed+170*(1+m.friction));
}
export function impactResponse(m,force){
 const stress=force/(CELL*CELL),binding=m.cohesion+m.yieldStress;
 const compression=Math.max(0,stress-binding)/Math.max(1,m.youngModulus);
 return {dent:Math.min(.22,CELL*compression),recovery:m.restitution,
  reach:impulseReach(m)};
}

// At a grazing angle a ray can cross several crests before the mean plane.
// Walk from the eye to bracket the first crossing, then refine that bracket.
export function firstSurfaceHit(ray,height,far,bound){
 const dy=ray.direction.y,y=ray.origin.y;
 let start=0,end=far;
 if(Math.abs(dy)>1e-8){
  const a=(-bound-y)/dy,b=(bound-y)/dy;
  start=Math.max(0,Math.min(a,b));end=Math.min(far,Math.max(a,b));
 }else if(Math.abs(y)>bound)return null;
 if(start>end)return null;
 const p=new Vector3();
 const residual=t=>{ray.at(t,p);return p.y-height(p.x,p.z);};
 let lo=start,prior=residual(lo);
 if(Math.abs(prior)<1e-7)return ray.at(lo,p);
 const span=end-start,steps=Math.min(384,Math.max(1,Math.ceil(span/.25)));
 const logSpan=span>steps*.25?Math.log1p(span/6):0;
 for(let i=1;i<=steps;i++){
  let hi=start+(logSpan?6*Math.expm1(logSpan*i/steps):span*i/steps);const next=residual(hi);
  if((prior<0)!==(next<0)||next===0){
   for(let j=0;j<16;j++){
    const mid=(lo+hi)*.5;if((residual(mid)<0)===(prior<0))lo=mid;else hi=mid;
   }
   return ray.at((lo+hi)*.5,p);
  }
  lo=hi;prior=next;
 }
 return null;
}
