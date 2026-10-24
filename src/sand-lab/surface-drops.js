import {bodyDistance,bodyLocal,bodyNormal} from './objects.js';
import {pointVelocity} from './rigid-contacts.js';
import {shapeDistance,sandIsTracer} from './sand-shape.js';
import {rotate,normalAt,hash,clamp} from './water-lab-model.js';
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export const DROP_BEADS=48;
export const DROP_BEAD_INTERVAL=.065;
export const SURFACE_BEAD_LIMIT=16384;
export const DROP_MERGE_SECONDS=1.2;
export function beadRadius(volume){return Math.cbrt(Math.max(0,volume)*3/(4*Math.PI));}
// Rain-only capillary water, distinct from airborne spray and bulk solver water.
// The CPU owns conservative volumes/attachment; the GPU draws the small beads.
export class SurfaceDrops {
 constructor(rain){this.rain=rain;this.lab=rain.lab;this.patches=new Map();this.births=[];this.absorbed=0;this.sequence=0;this.revision=0;}
 get volume(){let v=this.absorbed;for(const p of this.patches.values())v+=p.volume;for(const p of this.births)v+=p.volume;return v;}
 receiver(hit){if(hit.particle>=0)return null;return this.lab.balls.find(b=>Math.abs(bodyDistance(hit.point,b))<.008)||null;}
 frame(p){return p.body?{point:rotate(p.local,p.body.tilt,p.body.spin,false,p.body.pitch).map((v,k)=>v+p.body.position[k]),normal:rotate(p.localNormal,p.body.tilt,p.body.spin,false,p.body.pitch)}:{point:p.point.slice(),normal:p.normal.slice()};}
 absorb(point,volume){
  const sand=this.lab.sand;if(!sand.weights)return volume*(1-clamp(sand.materialAt(point),0,1)**2);
  let receiver=null,closest=.015;for(const p of sand.parcels||[]){if(sandIsTracer(p))continue;const d=Math.abs(shapeDistance(p,point));if(d<closest){closest=d;receiver=p;}}
  if(receiver){const capacity=Math.max(1e-9,receiver.mass/receiver.packing*(1-receiver.packing)),amount=Math.min(volume*(1-receiver.wet**2),(1-receiver.wet)*capacity);receiver.wet+=amount/capacity;this.sandWetDirty=true;return amount;}
  let left=volume;
  // Water fills the pore space locally instead of creating a hidden bulk blob.
  for(const [k,w] of sand.weights(point[0],point[2])){const capacity=Math.max(1e-9,sand.area*.08*(1-sand.packing[k])),amount=Math.min(left,volume*w*(1-sand.wet[k]**2),(1-sand.wet[k])*capacity);sand.wet[k]+=amount/capacity;left-=amount;}
  if(left<volume)this.sandWetDirty=true;return volume-left;
 }
 impact(drop,hit){
  if(hit.particle>=0)return false;
  // The player capsule is not a condensation receiver. Rain can still hit
  // it, splash and run off through the ordinary rain volume ledger.
  if(this.lab.player&&this.lab.playerDistance?.(hit.point)<=.008)return false;
  const body=this.receiver(hit);let volume=drop.volume;
  if(!body){
   const absorbed=this.absorb(hit.point,volume);this.absorbed+=absorbed;volume-=absorbed;
   if(volume>1e-14)this.rain.addDeposit(hit,volume);
   return true; // sand retains pore water/runoff, never visible surface beads
  }
  if(volume<=1e-14)return true;
  const local=body?bodyLocal(hit.point,body):hit.point.slice(),size=this.lab.spacing*.9;
  const localNormal=body?rotate(hit.normal,body.tilt,body.spin,true,body.pitch):hit.normal,axis=localNormal.reduce((best,v,k)=>Math.abs(v)>Math.abs(localNormal[best])?k:best,0),face=axis*2+Number(localNormal[axis]>0);
  const receiverId=`${body?this.lab.balls.indexOf(body)+1:0}/${face}`,cell=local.map(v=>Math.floor(v/size)),key=`${receiverId}:`+cell.join(',');
  let p=this.patches.get(key),nearest=size;
  // Coalesce across cell borders too, but never collect distant droplets or
  // mix opposite faces / separate objects into an unexplained large blob.
  if(!p)for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
   const q=this.patches.get(`${receiverId}:`+[cell[0]+x,cell[1]+y,cell[2]+z].join(','));if(!q)continue;
   const distance=Math.hypot(...local.map((v,k)=>v-q.local[k]));if(distance<nearest&&this.frame(q).normal.reduce((n,v,k)=>n+v*hit.normal[k],0)>.8){p=q;nearest=distance;}
  }
  if(!p){p={id:++this.sequence,body,local,localNormal:body?rotate(hit.normal,body.tilt,body.spin,true,body.pitch):hit.normal.slice(),point:hit.point.slice(),normal:hit.normal.slice(),volume:0,shown:0,age:0,beads:[],beadClock:0,arrivals:[]};this.patches.set(key,p);}
  p.volume+=volume;if(p.beads.length>=DROP_BEADS)p.beads.shift();if(p.arrivals.length<DROP_BEADS)p.arrivals.push(local);this.revision++;return true;
 }
 step(dt){
  const lab=this.lab,s=lab.spacing,pv=s**3,wasActive=this.patches.size||this.births.length;
  // Optical detail has a fixed budget; conservative water mass and coalescence
  // continue even when a long rain session fills the display budget.
  let beadBudget=SURFACE_BEAD_LIMIT;for(const p of this.patches.values())beadBudget-=p.beads.length;beadBudget=Math.min(64,beadBudget);
  if(this.sandWetDirty){lab.sand.dirty=true;lab.sand.revision++;this.sandWetDirty=false;}
  for(const [key,p] of this.patches){
   p.age+=dt;p.waterClock=(p.waterClock??.1)+dt;p.shown+=(p.volume-p.shown)*(1-Math.exp(-dt/.22));
   const {point,normal}=this.frame(p);
   if(!p.body||!lab.balls.includes(p.body)){
    const births=this.births.filter(b=>b.patch===p);this.births=this.births.filter(b=>b.patch!==p);
    this.rain.addDeposit({point,normal,particle:-1},p.volume+births.reduce((sum,b)=>sum+b.volume,0));this.patches.delete(key);continue;
   }
   const pose=[...p.body.position,p.body.tilt,p.body.spin,p.body.pitch].join(',');
   if(p.waterClock>=.1||p.waterPose!==pose){
    p.waterClock=0;p.waterPose=pose;this.clearSubmerged(p);
   }
   // Each impact leaves one bead at its own contact, not a rosette grown
   // around a reservoir centre. The reservoir still conserves all rain mass.
   p.beadClock+=dt;
   const target=Math.min(DROP_BEADS,p.beads.length+p.arrivals.length);
   if(beadBudget<=0&&p.beads.length===0&&p.arrivals.length){
    let donor=null;for(const q of this.patches.values())if(q.beads.length>(donor?.beads.length??1))donor=q;
    if(donor){donor.beads.pop();beadBudget++;}
   }
   if(beadBudget>0&&p.beads.length<target&&p.beadClock>=DROP_BEAD_INTERVAL){this.addBead(p);beadBudget--;p.beadClock%=DROP_BEAD_INTERVAL;}
   if(p.volume+1e-12>=pv&&!this.births.some(b=>b.patch===p)&&lab.count+this.births.length<lab.particleBudget){
    let position=point.map((v,k)=>v+normal[k]*s*.45);
    for(let j=0;j<8;j++){const d=lab.solid(position,false,false);if(d>=s*.4)break;const n=normalAt(position,q=>lab.solid(q,false,false));position=position.map((v,k)=>v+n[k]*(s*.4-d));}
    this.births.push({position,local:p.body?bodyLocal(position,p.body):null,body:p.body,volume:pv,age:0,patch:p,normal:normal.slice(),velocity:p.body?pointVelocity(p.body,position):[0,0,0]});p.volume=Math.max(0,p.volume-pv);p.shown=Math.min(p.shown,p.volume);
   }
   if(p.volume<1e-14&&!this.births.some(b=>b.patch===p))this.patches.delete(key);
  }
  const done=[];for(const b of this.births){
   if(b.body){b.position=rotate(b.local,b.body.tilt,b.body.spin,false,b.body.pitch).map((v,k)=>v+b.body.position[k]);b.velocity=pointVelocity(b.body,b.position);}
   b.age+=dt;if(b.age>=DROP_MERGE_SECONDS)done.push(b);}
  if(done.length){this.rain.appendParcels(done);this.births=this.births.filter(b=>!done.includes(b));}
  // Invalidating the final removed patch is essential: otherwise its old
  // GPU instances stay visible even though the water ledger is already clear.
  if(wasActive||this.patches.size||this.births.length)this.revision++;
 }
 clearSubmerged(p){
  if(!this.lab.waterAt)return;
  const b=p.body,world=local=>rotate(local,b.tilt,b.spin,false,b.pitch).map((v,k)=>v+b.position[k]);
  const submerged=local=>{const q=world(local),n=bodyNormal(q,b),offset=Math.max(.004,Math.min(this.lab.spacing*.35,b.radius*.25));return this.lab.waterAt(q.map((v,k)=>v+n[k]*offset)).density>.24;};
  const count=p.beads.length+p.arrivals.length,kept=p.beads.filter(bead=>!submerged(bead.point)),arrivals=p.arrivals.filter(local=>!submerged(local));
  const fraction=count?1-(kept.length+arrivals.length)/count:Number(submerged(p.local)),point=this.frame(p).point;
  if(fraction>0){this.rain.addWaterDeposit(point,p.volume*fraction);p.volume*=1-fraction;p.shown*=1-fraction;p.beads=kept;p.arrivals=arrivals;}
  // An incipient large drop is still attached capillary water. Immersion
  // merges its entire reserved mass as well, rather than leaving a ghost blob.
  if(submerged(p.local)){const wet=this.births.filter(x=>x.patch===p);for(const drop of wet)this.rain.addWaterDeposit(point,drop.volume);this.births=this.births.filter(x=>x.patch!==p);}
 }
 fieldItems(){return this.births.map(p=>({kind:'water',position:p.position,radius:Math.cbrt(p.volume*smooth(p.age/DROP_MERGE_SECONDS))*.65,volume:p.volume*smooth(p.age/DROP_MERGE_SECONDS),wet:0,dye:0,tannin:0,sediment:0}));}
 addBead(p){
  const lab=this.lab,s=lab.spacing,{point,normal:n}=this.frame(p),t=Math.abs(n[1])<.9?[n[2],0,-n[0]]:[1,0,0],len=Math.hypot(...t);for(let k=0;k<3;k++)t[k]/=len;
  const v=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]],field=p.body?q=>bodyDistance(q,p.body):q=>lab.sand.distance?lab.sand.distance(q):lab.solid(q,false,false);
  const arrival=p.arrivals.shift(),origin=arrival?(p.body?rotate(arrival,p.body.tilt,p.body.spin,false,p.body.pitch).map((v,k)=>v+p.body.position[k]):arrival):point;
  let chosen=null,best=-1,normal;
  // Best-candidate sampling avoids both a fixed rosette and random clumps.
  // Keep genuine hit positions when they are not already occupied.
  for(let j=0;j<9;j++){
   const seed=p.id*131+p.beads.length*197+j*43,dx=j?(hash(seed)-.5)*s*1.35:0,dy=j?(hash(seed+17)-.5)*s*1.35:0;
   let q=origin.map((x,k)=>x+t[k]*dx+v[k]*dy),nn=n;
   for(let k=0;k<3;k++){const d=field(q);nn=p.body?bodyNormal(q,p.body):normalAt(q,field);q=q.map((x,k)=>x-nn[k]*d);}
   if(Math.abs(field(q))>s*.01||nn.reduce((sum,x,k)=>sum+x*n[k],0)<.4)continue;
   const local=p.body?bodyLocal(q,p.body):q;let distance=Infinity;
   for(const b of p.beads)distance=Math.min(distance,Math.hypot(...local.map((x,k)=>x-b.point[k])));
   if(distance>best){best=distance;chosen=local;normal=p.body?rotate(nn,p.body.tilt,p.body.spin,true,p.body.pitch):nn;}
   if(j===0&&distance>s*.12)break;
  }
  if(chosen)p.beads.push({point:chosen,normal});
 }
 beads(){
  const lab=this.lab,s=lab.spacing,out=[];
  for(const p of this.patches.values()){
   const birth=this.births.find(b=>b.patch===p),volume=Math.min(s**3,p.shown+(birth?birth.volume*(1-smooth(birth.age/DROP_MERGE_SECONDS)):0));if(volume<1e-14||!p.beads.length)continue;
   const radius=Math.min(s*.1,beadRadius(volume/p.beads.length));
   for(const bead of p.beads){
    const point=p.body?rotate(bead.point,p.body.tilt,p.body.spin,false,p.body.pitch).map((v,k)=>v+p.body.position[k]):bead.point,normal=p.body?rotate(bead.normal,p.body.tilt,p.body.spin,false,p.body.pitch):bead.normal;
    // Terrain can deform under a bead, so keep its attachment on the receiver.
    if(!p.body&&lab.sand.distance&&bead.revision!==lab.sand.revision){const field=q=>lab.sand.distance(q),d=field(point);if(Math.abs(d)>s*.01){const n=normalAt(point,field);for(let k=0;k<3;k++){point[k]-=n[k]*d;normal[k]=n[k];}}bead.revision=lab.sand.revision;}
    out.push({position:point.map((v,k)=>v+normal[k]*radius*.5),normal,radius});
   }
  }
  return out;
 }
}
