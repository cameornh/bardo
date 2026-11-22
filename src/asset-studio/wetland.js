// Wind-built dune ridges cross the direction of the prevailing wind. The water
// table is our zero datum. Translate the survey to a naturally occurring bank
// so the opening view is useful even when the garden seed changes.
import {randomSequence} from './family.js';

export const REED_TILE=18;
const smooth=t=>t*t*(3-2*t);
const clamp=t=>Math.max(0,Math.min(1,t));
function hash(x,z){
  let n=Math.imul(x,1597334677)^Math.imul(z,3812015801);
  n=Math.imul(n^(n>>>16),2246822519);
  return ((n^(n>>>13))>>>8)/16777216;
}
function noise(x,z){
  const i=Math.floor(x),j=Math.floor(z),a=smooth(x-i),b=smooth(z-j);
  return (1-b)*((1-a)*hash(i,j)+a*hash(i+1,j))+b*((1-a)*hash(i,j+1)+a*hash(i+1,j+1));
}
function land(x,z){
  const u=.906308*x-.422618*z,v=.422618*x+.906308*z;
  const hills=5.6*(noise(u/71,v/54)-.50)+2.5*(noise(u/34+11,v/57)-.52);
  const warp=21*noise(u/48,v/24)+9*noise(u/21+9,v/56);
  const phase=(u+warp)*.228;
  const ridge=.5+.5*Math.sin(phase+.50*Math.sin(phase-.48));
  return hills-.05+(1.0+3.4*noise(u/57,v/31+19))*ridge*ridge;
}

// Keep the integer lattice hash and the land profile in step with the CPU
// contact sampler. GPU work is per terrain vertex rather than per fragment.
export const wetlandGLSL=`
 uniform vec2 survey;
 float landHash(ivec2 p){
  uint n=uint(p.x)*1597334677u ^ uint(p.y)*3812015801u;
  n=(n^(n>>16u))*2246822519u;
  return float((n^(n>>13u))>>8u)/16777216.;
 }
 float landNoise(vec2 p){
  ivec2 i=ivec2(floor(p));vec2 f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(landHash(i),landHash(i+ivec2(1,0)),f.x),
   mix(landHash(i+ivec2(0,1)),landHash(i+ivec2(1)),f.x),f.y);
 }
 float landHeight(vec2 pos){
  vec2 p=pos+survey;
  float u=dot(p,vec2(.906308,-.422618)),v=dot(p,vec2(.422618,.906308));
  float hills=5.6*(landNoise(vec2(u/71.,v/54.))-.50)+2.5*(landNoise(vec2(u/34.+11.,v/57.))-.52);
  float warp=21.*landNoise(vec2(u/48.,v/24.))+9.*landNoise(vec2(u/21.+9.,v/56.));
  float phase=(u+warp)*.228,ridge=.5+.5*sin(phase+.50*sin(phase-.48));
  return hills-.05+(1.+3.4*landNoise(vec2(u/57.,v/31.+19.)))*ridge*ridge;
 }`;

export class Wetland {
 constructor(seed){
  this.seed=seed>>>0;
  const rng=randomSequence(this.seed),x=(rng()-.5)*32000,z=(rng()-.5)*32000;
  let best=Infinity;
  for(let i=0;i<512;i++){
   const radius=14*Math.sqrt(i),a=i*2.399963;
   const px=x+radius*Math.cos(a),pz=z+radius*Math.sin(a);
   const h=land(px,pz),slope=Math.hypot(land(px+1,pz)-h,land(px,pz+1)-h);
   const basin=Math.min(land(px-4,pz+7),land(px-9,pz+5),land(px-6,pz+11));
   const cost=Math.abs(h-.08)+Math.abs(slope-.18)*.55+1.25*Math.max(0,basin+.65);
   if(cost<best){best=cost;this.x=px;this.z=pz;}
   if(cost<.02)break;
  }
 }
 height(x,z){return land(x+this.x,z+this.z);}
 suitability(x,z,h=this.height(x,z)){
  // Rhizomes spread laterally from established colonies. Local moisture
  // limits the colony to a band from shallow standing water to damp sand.
  const moisture=smooth(clamp((h+.68)/.58))*smooth(clamp((.85-h)/.67));
  return moisture*(.08+.92*smooth(clamp((noise((x+this.x)/9,(z+this.z)/9)-.20)/.55)));
 }
 crowns(tx,tz){
  const salt=(Math.floor(hash(tx,tz)*4294967296)^this.seed)>>>0,r=randomSequence(salt),out=[];
  // Nearby ramets share a founder. Daughters may cross their founder's
  // tile boundary, and retain that tile as their sole owner.
  for(let i=0;i<48;i++){
   const cx=(tx+r())*REED_TILE,cz=(tz+r())*REED_TILE;
   if(r()>=this.suitability(cx,cz))continue;
   const scale=.65+.45*r(),count=2+Math.floor(r()*5),orientation=r()*Math.PI*2;
   for(let j=0;j<count;j++){
    const angle=orientation+j*2.39996+.5*r(),reach=j?Math.sqrt(r())*1.7:0;
    const x=cx+reach*Math.cos(angle),z=cz+reach*Math.sin(angle),y=this.height(x,z);
    if(y<-.59||y>.70)continue;
    out.push({x,y,z,yaw:r()*2*Math.PI,size:scale*(.78+.28*r()),variant:Math.floor(r()*5)});
   }
  }
  return out;
 }
}

// The water table is a reservoir. Only the handful leaving it becomes loose
// water; released parcels rejoin it on contact or settle on the dry bed.
export function disturbPond(sim,point,material,force=null){
 if(!material||sim.heldDeposit||sim.heldChunk||sim.matter.count+9>768)return false;
 const packets=[];
 for(let i=0;i<9;i++){
  const angle=i*2.399963,r=.17*Math.sqrt(i/8),offset=point.clone().set(r*Math.cos(angle),0,r*Math.sin(angle));
  const position=point.clone().add(offset),depth=-sim.matter.groundHeight(sim,position.x,position.z);
  if(depth<=.005)continue;
  const volume=.009*Math.min(.10,depth),radius=.87*Math.cbrt(.238732*volume);
  offset.y=radius;position.y=radius;
  packets.push({position,volume,radius,material,gripOffset:offset});
 }
 if(!packets.length)return false;
 const key='pond-'+(++sim.chunkSerial),group=sim.matter.addPackets(sim,key,material,packets,true,key);
 if(force===null){group.grip={target:point.clone()};sim.heldDeposit=group;}
 else{
  const speed=Math.min(4,.6+.018*Math.sqrt(force));
  for(const p of packets)p.body.setLinvel({x:5*p.gripOffset.x,y:speed,z:5*p.gripOffset.z},true);
 }
 return true;
}
