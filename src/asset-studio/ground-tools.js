// The six triangles share the same diagonal as the Rapier terrain heightfield.
// Removing one node's linear basis function cuts exactly CELL² * depth.
import {Vector3} from 'three';
import {SAND_SIDE,SAND_METRES} from './wind-sand.js';
export const CELL=SAND_METRES/SAND_SIDE,MAX_CUTS=64;
const rim=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
export const footprint=(u,v)=>Math.max(0,1-Math.max(Math.abs(u),Math.abs(v),Math.abs(u+v)));
export class GroundCuts{
 constructor(){this.nodes=new Map();this.version=0;}
 offset(x,z){
  const u=x/CELL,v=z/CELL,i=Math.floor(u),j=Math.floor(v);let depth=0;
  for(let a=i;a<=i+1;a++)for(let b=j;b<=j+1;b++){
   const n=this.nodes.get(a+','+b);if(n)depth+=(n.depth+n.elastic)*footprint(u-a,v-b);
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
  const top=new Vector3(n.x,height(n.x,n.z),n.z);
  const ring=rim.map(([i,j])=>new Vector3(i*CELL,height(n.x+i*CELL,n.z+j*CELL)-top.y,j*CELL));
  n.depth+=depth;this.version++;return {top,ring,depth,volume:CELL*CELL*depth};
 }
 displace(x,z,depth,elasticity){
  if(depth<.0002)return;
  const n=this.node(x,z);if(!n)return;
  n.depth=Math.min(4,n.depth+depth*(1-elasticity));n.elastic=Math.min(.3,n.elastic+depth*elasticity);this.version++;
 }
 relax(dt){
  for(const [key,n] of this.nodes)if(n.elastic>0){
   n.elastic*=Math.exp(-7*dt);if(n.elastic<.0005)n.elastic=0;
   if(!n.depth&&!n.elastic)this.nodes.delete(key);this.version++;
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
export function impactResponse(m,force){
 const stress=force/(CELL*CELL),binding=m.cohesion+m.yieldStress;
 const compression=Math.max(0,stress-binding)/Math.max(1,m.youngModulus);
 return {dent:Math.min(.22,CELL*compression),recovery:m.restitution,
  reach:Math.min(5,.35+.018*Math.sqrt(m.youngModulus/Math.max(.01,m.density))/(1+m.friction))};
}
