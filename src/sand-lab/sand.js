import {SandStress,cross,sandWindForce} from './sand-stress.js';
import {erodeSand} from './sand-wind.js';
import {BoundsGrid} from './spatial-bounds.js';
import {SandShapeStamp} from './sand-cache.js';
import {sandAdhesion,sandFriction} from './sand-material.js';
import {shapeRadius,sandIsTracer,shapeHeight,shapeDistance,shapeBlend,cutShape} from './sand-shape.js';
import {sandFeet,sandColumn,hasSandBond,supportsSand,loosePatches} from './sand-support.js';
// Conservative sand stock, packing, retained moisture and mobile aggregates.
// Coordinates are lab units; `mass` is solid-grain volume (multiply by rho and scale³).
export const SAND={packing:.56,maxPacking:.72,wettingSeconds:5,dryingSeconds:600,looseDensity:.55,wetDensity:1.7,cohesionWetness:.35};
const noise=i=>{const x=Math.sin(i*12.9898)*43758.5453;return x-Math.floor(x);};
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const beachHeight=(x,z)=>Math.max(-.3,(z-1)*.48)+.045*Math.sin(x*.6)*Math.exp(-(((z-3)/2)**2));
export function aggregateDensity(wet){return SAND.looseDensity+(SAND.wetDensity-SAND.looseDensity)*clamp(wet);}
export function moisture(wet,contact,dt,rain=0){return contact?1-(1-wet)*Math.exp(-dt/SAND.wettingSeconds):clamp(wet*Math.exp(-dt/SAND.dryingSeconds)+rain*dt);}
export const cubicWeights=t=>[(1-t)**3/6,(3*t**3-6*t*t+4)/6,(-3*t**3+3*t*t+3*t+1)/6,t**3/6];
export const aggregateRadius=shapeRadius;
const cohesive=p=>sandAdhesion(p.wet,p.memory||0)>=.9;
const union=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/Math.max(k,.00001);return Math.min(a,b)-h*h*k*.25;};
// Transfer stock between nearby clumps to vary size, then offset once at
// creation. Mass, moisture and occupied volume travel together; no frame noise.
function mergeStock(to,from,amount){
 const before=to.mass,total=before+amount,volume=before/to.packing+amount/from.packing;
 to.wet=(to.wet*before+from.wet*amount)/total;to.packing=total/volume;
 to.memory=Math.max(to.memory,from.memory);to.mass=total;from.mass-=amount;
}
function irregularize(parcels,dx,dz){
 const unused=new Set(parcels);
 for(const p of parcels){if(!unused.delete(p))continue;let q=null,best=Infinity;
  for(const candidate of unused){const d=candidate.position.reduce((sum,v,k)=>sum+(v-p.position[k])**2,0);if(d<best){best=d;q=candidate;}}
  if(q){unused.delete(q);const donor=noise(p.id+73)<.5?p:q,receiver=donor===p?q:p;mergeStock(receiver,donor,donor.mass*(.18+.42*noise(p.id+127)));}
 }
 for(const p of parcels){const r=aggregateRadius(p);p.position[0]+=dx*(noise(p.id+19)-.5)*.85;p.position[2]+=dz*(noise(p.id+47)-.5)*.85;p.position[1]+=Math.min(r,dx,dz)*(noise(p.id+83)-.5)*.4;}
}
export class SandBed{
 constructor(n=65){this.n=n;this.dx=11/(n-1);this.dz=9.8/(n-1);this.area=this.dx*this.dz;this.mass=new Float64Array(n*n);this.wet=new Float64Array(n*n);this.packing=new Float64Array(n*n).fill(SAND.packing);this.memory=new Float64Array(n*n);this.base=new Float64Array(n*n);this.data=new Float32Array(n*n*4);this.parcels=[];this.nextId=1;this.nextBatch=1;this.revision=0;for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i;this.base[k]=beachHeight(i*this.dx-5.5,j*this.dz-4.9)-.7;this.mass[k]=.7*SAND.packing*this.area;}this.removedMass=0;this.initialMass=this.totalMass();this.update();}
 weights(x,z){const a=clamp((x+5.5)/this.dx,0,this.n-1),b=clamp((z+4.9)/this.dz,0,this.n-1),i=Math.min(this.n-2,Math.floor(a)),j=Math.min(this.n-2,Math.floor(b)),u=a-i,v=b-j;return [[j*this.n+i,(1-u)*(1-v)],[j*this.n+i+1,u*(1-v)],[(j+1)*this.n+i,(1-u)*v],[(j+1)*this.n+i+1,u*v]];}
 heightAt(k){return this.base[k]+this.mass[k]/(this.packing[k]*this.area);}
 height(x,z){
  const a=clamp((x+5.5)/this.dx,0,this.n-1),b=clamp((z+4.9)/this.dz,0,this.n-1),i=Math.floor(a),j=Math.floor(b),wx=cubicWeights(a-i),wz=cubicWeights(b-j);let h=0;
  for(let z0=0;z0<4;z0++)for(let x0=0;x0<4;x0++)h+=this.heightAt(clamp(j+z0-1,0,this.n-1)*this.n+clamp(i+x0-1,0,this.n-1))*wx[x0]*wz[z0];return h;
 }
 distance(p){let d=(p[1]-this.height(p[0],p[2]))*.65;for(const a of this.parcels){if(a.held||a.mass<=0||sandIsTracer(a))continue;d=union(d,shapeDistance(a,p),shapeBlend(a));}return d;}
 // Bonded deposits are persistent volumetric terms of the same terrain SDF.
 // They keep their own material instead of mixing into the entire dry column.
 contactDistance(p,radius,exclude=null,ceiling=Infinity,looseGroup=null){let d=(p[1]-radius-this.height(p[0],p[2]))*.65;for(const a of this.parcels){if(!a.anchored||a.held||a.mass<=0||(a.id===exclude||exclude?.has?.(a.id))||a.position[1]>ceiling||(looseGroup&&a.layerGroup===looseGroup&&!hasSandBond(a)))continue;const r=aggregateRadius(a);if(Math.hypot(p[0]-a.position[0],p[1]-a.position[1],p[2]-a.position[2])-r-radius>d+.08)continue;d=union(d,shapeDistance(a,p)-radius,Math.min(.08,r*.5));}return d;}
 materialAt(p){let d=(p[1]-this.height(p[0],p[2]))*.65,wet=this.sample(p[0],p[2]);for(const a of this.parcels){if(sandIsTracer(a))continue;const r=aggregateRadius(a),q=shapeDistance(a,p),k=shapeBlend(a),h=clamp(.5+.5*(d-q)/Math.max(Math.min(.08,r*.5),.00001));wet=wet*(1-h)+a.wet*h;d=union(d,q,k);}return wet;}
 sample(x,z,array=this.wet){return this.weights(x,z).reduce((s,[k,w])=>s+array[k]*w,0);}
 totalMass(){return this.mass.reduce((a,b)=>a+b,0)+this.parcels.reduce((a,b)=>a+b.mass,0);}
 update(){
  this.dirty=false;let bedChanged=false;
  for(let k=0;k<this.mass.length;k++){const o=k*4,h=this.heightAt(k);if(this.data[o]!==Math.fround(h))bedChanged=true;this.data[o]=h;this.data[o+1]=this.wet[k];this.data[o+2]=this.packing[k];this.data[o+3]=this.memory[k];}
  if(bedChanged)this.bedGeometryRevision=(this.bedGeometryRevision||0)+1;
  this.touchShapes();
  this.revision++;
 }
 touchShapes(){if((this.shapeStamp??=new SandShapeStamp()).changed(this.parcels)){this.shapeRevision=(this.shapeRevision||0)+1;this.revision++;}}
 compact(x,z,radius,load){let displaced=0;for(const [k,w] of this.footprint(x,z,radius)){const before=this.heightAt(k),capacity=SAND.maxPacking-this.packing[k],gain=capacity*(1-Math.exp(-load*w*this.wet[k]*3));if(gain<1e-12)continue;this.dirty=true;this.packing[k]+=gain;this.memory[k]=Math.max(this.memory[k],this.wet[k]);displaced+=(before-this.heightAt(k))*this.area;}return displaced;}
 footprint(x,z,r){const result=[];const a=Math.max(0,Math.floor((x-r+5.5)/this.dx)),b=Math.min(this.n-1,Math.ceil((x+r+5.5)/this.dx)),c=Math.max(0,Math.floor((z-r+4.9)/this.dz)),d=Math.min(this.n-1,Math.ceil((z+r+4.9)/this.dz));for(let j=c;j<=d;j++)for(let i=a;i<=b;i++){const distance=Math.hypot(i*this.dx-5.5-x,j*this.dz-4.9-z);if(distance<r)result.push([j*this.n+i,(1-(distance/r)**2)**3]);}return result.length?result:this.weights(x,z);}
 takeSmallSphere(point,radius,fraction=1){
  const top=this.height(point[0],point[2]),weights=this.weights(point[0],point[2]),bottom=weights.reduce((sum,[k,w])=>sum+this.base[k]*w,0);
  const cap=y=>{const h=clamp(y-point[1]+radius,0,2*radius);return Math.PI*h*h*(radius-h/3);};
  const volume=Math.max(0,cap(top)-cap(bottom))*clamp(fraction);let mass=0,occupied=0,water=0,memory=0;
  for(const [k,w] of weights){const amount=Math.min(this.mass[k],volume*w*this.packing[k]);this.mass[k]-=amount;mass+=amount;occupied+=amount/this.packing[k];water+=amount*this.wet[k];if(amount>0)memory=Math.max(memory,this.memory[k]);}
  return mass>1e-14?{position:[point[0],Math.min(point[1],top-radius*.25),point[2]],mass,wet:water/mass,packing:mass/occupied,memory}:null;
 }
 extract(point,radius,velocity=[0,0,0],held=false,fraction=1,includeParcels=true){const created=[],small=radius<Math.min(this.dx,this.dz)*.7;if(small){const p=this.takeSmallSphere(point,radius,fraction);if(p)created.push({...p,velocity:velocity.slice(),held,id:this.nextId++});}else for(const [k,w] of this.footprint(point[0],point[2],radius)){const top=this.heightAt(k),x=(k%this.n)*this.dx-5.5,z=Math.floor(k/this.n)*this.dz-4.9,radial=Math.hypot(x-point[0],z-point[2]),half=Math.sqrt(Math.max(0,radius*radius-radial*radial)),depth=Math.max(0,Math.min(top,point[1]+half)-Math.max(this.base[k],point[1]-half)),amount=Math.min(this.mass[k],depth*this.packing[k]*this.area*fraction);if(amount<1e-8)continue;this.mass[k]-=amount;created.push({position:[x,top-depth*.5,z],mass:amount,wet:this.wet[k],packing:this.packing[k],memory:this.memory[k],velocity:velocity.slice(),held,id:this.nextId++});}
 // Combine adjacent extracted cells into bounded, unequal aggregates without losing mass.
 while(created.length>24){let small=0;for(let i=1;i<created.length;i++)if(created[i].mass<created[small].mass)small=i;const p=created.splice(small,1)[0];let q=created[0],best=Infinity;for(const candidate of created){const distance=candidate.position.reduce((sum,v,k)=>sum+(v-p.position[k])**2,0);if(distance<best){best=distance;q=candidate;}}const m=q.mass+p.mass;for(let k=0;k<3;k++)q.position[k]=(q.position[k]*q.mass+p.position[k]*p.mass)/m;mergeStock(q,p,p.mass);}
 if(!small)irregularize(created,this.dx,this.dz);
 const existing=[];
 for(const p of (includeParcels?this.parcels.slice():[]))if(!p.held&&p.mass>0&&(held||p.anchored)){
  if(held&&fraction===1&&Math.hypot(...p.position.map((v,k)=>v-point[k]))+aggregateRadius(p)<=radius){p.held=true;p.anchored=false;p.velocity.fill(0);existing.push(p);continue;}
  const q=cutShape(p,point,radius*Math.cbrt(clamp(fraction)));if(!q)continue;
  q.id=this.nextId++;q.held=held;q.anchored=false;q.velocity=velocity.slice();q.departingFrom=held?null:p.id;this.parcels.push(q);existing.push(q);
 }
 const batch=this.nextBatch++;for(const p of [...created,...existing])p.batch=batch;
 this.parcels.push(...created);this.parcels=this.parcels.filter(p=>p.mass>0);this.releaseUnsupported();this.update();return [...created,...existing];}
 carve(point,radius){
  // Subtract the sphere's intersection with the exposed column stock. This
  // is a surface crater in the current sand model, not an underground tunnel.
  const small=radius<Math.min(this.dx,this.dz)*.7;let removed=small?(this.takeSmallSphere(point,radius)?.mass||0):0;if(!small)for(const [k] of this.footprint(point[0],point[2],radius)){const x=k%this.n*this.dx-5.5,z=Math.floor(k/this.n)*this.dz-4.9,rr=radius*radius-(x-point[0])**2-(z-point[2])**2;if(rr<=0)continue;const top=this.heightAt(k),half=Math.sqrt(rr),low=Math.max(this.base[k],point[1]-half),high=Math.min(top,point[1]+half),amount=Math.max(0,high-low)*this.packing[k]*this.area;this.mass[k]-=amount;removed+=amount;}
  for(const p of this.parcels){if(p.held)continue;const q=cutShape(p,point,radius);if(q)removed+=q.mass;}this.parcels=this.parcels.filter(p=>p.mass>0);
  this.removedMass+=removed;this.releaseUnsupported();this.update();return removed;
 }
 deposit(parcel,amount){amount=Math.min(parcel.mass,amount);if(amount<=0)return;
  // A height column underneath a raised SDF deposit is not its surface.
  // Keep a separate material parcel on wet/raised supports, even when dry.
  const raised=this.parcels.some(p=>p!==parcel&&p.anchored&&!p.held&&p.mass>0&&supportsSand(p,parcel));
  if((cohesive(parcel)||(parcel.layer&&hasSandBond(parcel))||raised||this.sample(parcel.position[0],parcel.position[2])>.05)&&!(parcel.windborne&&!raised)){
   parcel.layer=true;
   if(amount>=parcel.mass&&raised&&!hasSandBond(parcel)&&!parcel.looseResolved){
    const patches=loosePatches(parcel,()=>this.nextId++);
    if(patches.length){this.parcels.push(...patches.slice(1));this.dirty=true;return;}
   }
   if(amount>=parcel.mass){parcel.anchored=true;parcel.held=false;parcel.velocity=[0,0,0];}
   else{this.parcels.push({...parcel,id:this.nextId++,position:parcel.position.slice(),velocity:[0,0,0],mass:amount,held:false,anchored:true});parcel.mass-=amount;}
   this.dirty=true;return;
  }
  // Dry grains join the continuous bed in one transfer, then repose acts on
  // that field. No collection of shrinking/bouncing spheres at the landing.
  const radius=Math.max(this.dx*2.8,this.dz*2.8,aggregateRadius(parcel)*2),weights=this.footprint(parcel.position[0],parcel.position[2],radius),sum=weights.reduce((a,b)=>a+b[1],0)||1;
  for(const [k,w] of weights){const added=amount*w/sum,m=this.mass[k]+added,volume=this.mass[k]/this.packing[k]+added/parcel.packing;this.wet[k]=(this.wet[k]*this.mass[k]+parcel.wet*added)/m;this.packing[k]=m/volume;this.memory[k]=Math.max(this.memory[k],parcel.wet,parcel.memory||0);this.mass[k]=m;}parcel.mass-=amount;this.dirty=true;
 }
 push(point,radius,direction,strength=.06){
  // Pressure changes packing first. Repeated strokes then move the existing
  // field/parcels; they must not grow a new CSG tree on every pointer event.
  const moved=[],batch=this.nextBatch++;
  for(const p of this.parcels){
   if(p.held||p.mass<=0)continue;
   const r=aggregateRadius(p),distance=Math.hypot(...point.map((v,k)=>v-p.position[k]));
   if(distance>=radius+r||shapeDistance(p,point)>radius)continue;
   const influence=clamp((radius+r-distance)/Math.min(radius*2,r*2)) * Math.min(1,(radius/r)**2);
   const capacity=clamp((SAND.maxPacking-p.packing)/.16),before=p.packing;
   p.packing+=(SAND.maxPacking-p.packing)*(1-Math.exp(-strength*12*influence*p.wet*3));
   if(p.packing!==before){const factor=Math.cbrt(before/p.packing);if(p.shapeRadius)p.shapeRadius*=factor;
    if(p.cuts)p.cuts=p.cuts.map(c=>({...c,offset:c.offset.map(v=>v*factor),radius:c.radius*factor}));}
   p.memory=Math.max(p.memory||0,p.wet);
   const impulse=strength*influence*(1-p.wet*capacity)*14;
   if(impulse>1e-6){p.anchored=false;p.batch=batch;p.velocity=direction.map((v,k)=>p.velocity[k]+v*impulse+(k===1?impulse*.12:0));moved.push(p);}
  }
  if(point[1]-radius<=this.height(point[0],point[2])){
   const wet=this.sample(point[0],point[2]),capacity=clamp((SAND.maxPacking-this.sample(point[0],point[2],this.packing))/.16);
   this.compact(point[0],point[2],radius,strength*12);
   // Conservative local plastic shear of bulk columns. This keeps the cost
   // proportional to the brush footprint, even after a prolonged wet stroke.
   if(wet>.15)this.shear(point,radius,direction,strength*(1-wet*capacity));
   else if(!moved.length)moved.push(...this.extract(point,radius,direction.map((v,k)=>v*strength*14+(k===1?strength*3:0)),false,strength,false));
  }
  this.releaseUnsupported();this.update();return moved;
 }
 shear(point,radius,direction,strength){
  const transfers=[];
  for(const [k,w] of this.footprint(point[0],point[2],radius)){
   const x=k%this.n*this.dx-5.5,z=Math.floor(k/this.n)*this.dz-4.9,top=this.heightAt(k);
   if(top<point[1]-radius)continue;
   const amount=Math.min(this.mass[k]*.2,Math.min(radius*2,Math.max(0,top-point[1]+radius))*this.packing[k]*this.area*strength*w);
   if(amount<1e-12)continue;
   const weights=this.weights(x+direction[0]*radius*.65,z+direction[2]*radius*.65);
   transfers.push({k,amount,wet:this.wet[k],packing:this.packing[k],memory:this.memory[k],weights});
  }
  for(const t of transfers)this.mass[t.k]-=t.amount;
  for(const t of transfers)for(const [k,w] of t.weights){const added=t.amount*w,old=this.mass[k],total=old+added;if(added<=0)continue;
   this.wet[k]=(old*this.wet[k]+added*t.wet)/total;
   this.memory[k]=(old*this.memory[k]+added*t.memory)/total;
   this.packing[k]=total/(old/this.packing[k]+added/t.packing);this.mass[k]=total;this.dirty=true;
  }
 }
 step(dt,sampleWater,wind,scale=6,rain=0,waterSpacing=0){
  // Only a shallow bed layer exchanges with water. Interior stock is stationary.
  this.exchangeClock=(this.exchangeClock||0)+dt;
  if(this.exchangeClock>.15){const h=this.exchangeClock;this.exchangeClock=0;for(let k=0;k<this.mass.length;k++){const x=k%this.n*this.dx-5.5,z=Math.floor(k/this.n)*this.dz-4.9,y=this.heightAt(k),water=sampleWater([x,y+.06,z]);this.wet[k]=moisture(this.wet[k],water.density>.12,h,rain);if(water.density>.12){const speed=Math.hypot(...water.velocity),stress=Math.max(0,speed-.35-this.wet[k]*.4);this.compact(x,z,this.dx*1.1,h*.015);if(stress>0&&this.parcels.length<64&&((Math.imul(k+1,1664525)+Math.imul(this.revision+1,1013904223))>>>0)%5===0){const amount=Math.min(this.mass[k],stress*h*this.area*.008);if(amount>1e-6){this.mass[k]-=amount;this.parcels.push({id:this.nextId++,mass:amount,position:[x+this.dx*(.8*noise(k+this.revision*71)-.4),y+.04,z+this.dz*(.8*noise(k+this.revision*131+17)-.4)],velocity:water.velocity.map((v,a)=>v*.4+(a===1?.04:0)),wet:this.wet[k],packing:.56,memory:this.memory[k],held:false});}}}}
   // Yield only above the retained angle of repose. Compaction and plastic
   // memory do not vanish when moisture does, so a dried sculpture stays put.
   const delta=new Float64Array(this.mass.length),waterDelta=delta.slice(),volumeDelta=delta.slice();for(let j=1;j<this.n-1;j++)for(let i=1;i<this.n-1;i++){const k=j*this.n+i;for(const q of [k+1,k+this.n]){const diff=this.heightAt(k)-this.heightAt(q),from=diff>0?k:q,to=diff>0?q:k;if(sandAdhesion(this.wet[from],this.memory[from])>=.9)continue;const reach=q===k+1?this.dx:this.dz,slope=sandFriction(this.wet[from],this.memory[from]),excess=Math.abs(diff)-reach*slope-.12*this.memory[from];if(excess>0){const flow=Math.min(this.mass[from]*.08,excess*this.area*this.packing[from]*Math.min(.18,h*.6));if(flow>0)this.dirty=true;delta[from]-=flow;delta[to]+=flow;waterDelta[from]-=flow*this.wet[from];waterDelta[to]+=flow*this.wet[from];volumeDelta[from]-=flow/this.packing[from];volumeDelta[to]+=flow/this.packing[from];this.memory[to]=Math.max(this.memory[to],this.memory[from]);}}}for(let k=0;k<delta.length;k++){const next=this.mass[k]+delta[k],volume=this.mass[k]/this.packing[k]+volumeDelta[k];if(next>1e-12){this.wet[k]=clamp((this.mass[k]*this.wet[k]+waterDelta[k])/next);this.packing[k]=clamp(next/Math.max(1e-12,volume),SAND.packing,SAND.maxPacking);}this.mass[k]=next;}
  }
  erodeSand(this,dt,wind,scale,sampleWater);
  this.stepParcels(dt,sampleWater,wind,scale,rain,waterSpacing);
  this.parcels=this.parcels.filter(p=>p.mass>0);this.update();
 }
 releaseUnsupported(){
  const anchored=this.parcels.filter(p=>p.anchored&&!p.held&&p.mass>0),supported=new Set();
  const shapeChanged=(this.supportStamp??=new SandShapeStamp()).changed(anchored),bedRevision=this.bedGeometryRevision||0;
  const bonds=anchored.map(p=>hasSandBond(p)?1:0).join(''),bondChanged=bonds!==this.supportBonds;this.supportBonds=bonds;
  if(this.optimizations?.sandCache!==false&&!this.dirty&&!shapeChanged&&!bondChanged&&this.supportBedRevision===bedRevision){this.supportCacheHits=(this.supportCacheHits||0)+1;return;}
  this.supportBedRevision=bedRevision;this.supportRebuilds=(this.supportRebuilds||0)+1;
  const grid=this.optimizations?.broadphase!==false&&anchored.length>8?(this.supportGrid??=new BoundsGrid()).build(anchored,p=>aggregateRadius(p)+.04):null;
  for(const p of anchored)if(sandFeet(p).some(f=>p.position[1]+f[1]<=this.height(p.position[0]+f[0],p.position[2]+f[2])+.002))supported.add(p);
  const frontier=[...supported];for(const p of frontier)for(const q of (grid?grid.query(p.position,aggregateRadius(p)+.04).map(i=>anchored[i]):anchored)){if(supported.has(q))continue;
   if(supportsSand(p,q)){supported.add(q);frontier.push(q);}}
  const batch=this.nextBatch++;for(const p of anchored)if(!supported.has(p)){p.anchored=false;p.velocity=[0,0,0];p.batch=batch;}
  this.supportStamp.changed(anchored.filter(p=>p.anchored));
 }
 // A dry patch needs a support footprint, not just one point of contact.
 // Sample the upper face of real CSG stock; empty cuts and side bonds cannot
 // create an invisible shelf. This also sees the sides of a stacked dry pile.
 supportHeight(x,z,ceiling,exclude,looseGroup){
  let height=this.height(x,z);
  for(const a of this.parcels){
   if(!a.anchored||a.held||a.mass<=0||a.id===exclude||a.position[1]>=ceiling||
      (looseGroup&&a.layerGroup===looseGroup&&!hasSandBond(a)))continue;
   for(const [,top] of sandColumn(a,x-a.position[0],z-a.position[2]))height=Math.max(height,a.position[1]+top);
  }
  return height;
 }
 looseSlope(p,r){
  const height=(x,z)=>this.supportHeight(x,z,p.position[1],p.id,p.layerGroup),x=p.position[0],z=p.position[2],y=height(x,z);
  const reach=r*1.35,friction=sandFriction(p.wet,p.memory||0);let best=0,axis=[0,0];
  // Rotating the stencil once per parcel avoids a world-axis settling grid.
  const phase=p.id*2.399963229728653;
  for(let i=0;i<8;i++){const a=phase+i*Math.PI/4,dx=Math.cos(a),dz=Math.sin(a),slope=(y-height(x+dx*reach,z+dz*reach))/reach;
   if(slope>friction+.04&&slope>best){best=slope;axis=[dx,dz];}
  }
  return {slope:best,axis};
 }
 settleLayers(dt,scale){
  const shapeChanged=(this.layerStamp??=new SandShapeStamp()).changed(this.parcels),bedRevision=this.bedGeometryRevision||0;
  const loose=this.parcels.filter(p=>p.anchored&&!p.held&&p.mass>0&&sandAdhesion(p.wet,p.memory||0)<.9);
  const material=loose.map(p=>`${p.id}:${p.wet}:${p.memory||0}`).join(','),active=loose.some(p=>p.spreadRemaining>1e-5||p.slideSpeed>1e-8||(p.layer&&!p.cuts?.length&&(p.memory||0)<.34&&Math.abs(shapeBlend(p)-Math.min(.18,aggregateRadius(p)*1.8))>1e-5));
  const unchanged=!shapeChanged&&!this.dirty&&this.layerBedRevision===bedRevision&&this.layerMaterial===material&&!active;
  this.layerBedRevision=bedRevision;this.layerMaterial=material;
  if(this.optimizations?.sandCache!==false&&unchanged)return;
  for(const p of this.parcels){
   if(!p.anchored||p.held||p.mass<=0)continue;
   const adhesion=sandAdhesion(p.wet,p.memory||0);if(adhesion>=.9||((p.memory||0)>=.34&&hasSandBond(p)))continue;
   const r=aggregateRadius(p);
   if(p.layer&&!p.cuts?.length&&(p.memory||0)<.34){const goal=Math.min(.18,r*1.8),old=shapeBlend(p);if(Math.abs(goal-old)>1e-5)p.surfaceBlend=old+(goal-old)*(1-Math.exp(-dt*4));}
   const height=shapeHeight(p),e=Math.max(.0001,Math.min(.01,height*.1));
   const sdf=q=>this.contactDistance(q,0,p.id,p.position[1]-.00001,!hasSandBond(p)?p.layerGroup:null);
   const foot=[p.position[0],p.position[1]-height,p.position[2]],normal=[0,1,2].map(k=>{const a=foot.slice(),b=foot.slice();a[k]+=e;b[k]-=e;return sdf(a)-sdf(b);});
   const length=Math.hypot(...normal)||1;for(let k=0;k<3;k++)normal[k]/=length;
   const supportNormalY=normal[1];
   let slope=Math.hypot(normal[0],normal[2])/Math.max(.05,normal[1]);
   if(!hasSandBond(p)){const edge=this.looseSlope(p,r);if(edge.slope>slope){const inv=1/Math.hypot(1,edge.slope);normal[0]=edge.axis[0]*edge.slope*inv;normal[1]=inv;normal[2]=edge.axis[1]*edge.slope*inv;slope=edge.slope;}}
   const yieldSlope=sandFriction(p.wet,p.memory||0);let moved=false;
   // Plastic collapse of the initial loose lump widens its footprint too;
   // independently supported patches must not remain a rigid cap while only
   // their own individual ellipsoids flatten.
   if(p.spreadRemaining>0&&!hasSandBond(p)){
    const spread=p.spreadRemaining*(1-Math.exp(-dt*4));p.spreadRemaining-=spread;
    p.position[0]+=p.spreadOffset[0]*spread;p.position[2]+=p.spreadOffset[1]*spread;moved=true;
   }
   if(slope>yieldSlope+.02){
    const horizontal=Math.hypot(normal[0],normal[2]);
    const speed=p.slideSpeed=Math.min(2,((p.slideSpeed||0)+9.81/scale*dt*Math.max(0,horizontal-yieldSlope*normal[1]))*Math.exp(-dt*.8));
    p.position[0]+=normal[0]/horizontal*speed*dt;p.position[2]+=normal[2]/horizontal*speed*dt;moved=true;
   }else p.slideSpeed=0;
   // Fresh loose sand spreads into a continuous low mound. Previously wet
   // structures retain their current shape, with a smaller frictional bond.
   if(p.layer&&!p.cuts?.length&&(p.memory||0)<.34){
    const oldAspect=p.aspect||1,looseAspect=p.looseResolved ? .75 : .32,target=looseAspect+(1-looseAspect)*adhesion,t=Math.min(oldAspect,target+(oldAspect-target)*Math.exp(-dt*4));
    if(oldAspect-t>1e-6){moved=true;p.aspect=t;if(p.shapeRadius)p.shapeRadius*=Math.cbrt(oldAspect/t);p.position[1]+=shapeHeight(p)-height;}
   }
   // Project onto the actual support; removing that support releases the
   // layer, rather than leaving a floating cap or depositing beneath it.
   if(!moved&&(p.memory||0)>=.34)continue;
   const bottom=[p.position[0],p.position[1]-shapeHeight(p),p.position[2]],distance=sdf(bottom);
   if(distance>.015){p.anchored=false;p.velocity=[0,0,0];continue;}
   if(Math.abs(distance)>1e-5)p.position[1]-=distance/Math.max(.2,supportNormalY)*.7;
  }
 }
 stepParcels(dt,sampleWater,wind,scale,rain,waterSpacing){
  this.releaseUnsupported();
  this.settleLayers(dt,scale);
  // A loose support can slide, spread or detach during this very step.
  this.releaseUnsupported();
  (this.stress??=new SandStress()).step(this,dt,wind,scale,sampleWater);
  const samples=new Map(),batchContact=new Map();
  // Sampling the centre alone misses water displaced by the sand itself.
  // Probe just outside its surface, including while it is held or bonded.
  for(const p of this.parcels){
   if(p.fractureTime>0){p.fractureTime-=dt;if(p.fractureTime<=0)p.fractureIgnore=null;}
   let water=sampleWater(p.position),contact=water.density>.065;
   if(!contact){const reach=aggregateRadius(p)+waterSpacing*.65;
    for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
     const q=sampleWater(p.position.map((v,k)=>v+axis[k]*reach));
     if(q.density>water.density)water=q;
     if(q.density>.065)contact=true;
    }
   }
   samples.set(p,{water,contact});
   if(p.held&&p.batch){const b=batchContact.get(p.batch)||[0,0];b[0]+=Number(contact);b[1]++;batchContact.set(p.batch,b);}
  }
  const groups=new Map();
  for(const p of this.parcels){
   const {contact}=samples.get(p),batch=batchContact.get(p.batch);
   // Exterior contact wets the porous held chunk through its connected grains.
   p.wet=moisture(p.wet,contact||!!(p.held&&batch&&batch[0]/batch[1]>=.2),dt,rain);
   p.memory=Math.max(p.memory||0,p.wet);
   if(p.held||p.anchored||p.mass<=0)continue;
   // A wet grab falls as a cohesive shape; it does not rain down one grid cell
   // at a time. Dry grains remain independent until they enter the bed field.
   const key=hasSandBond(p)&&p.batch?p.batch:p,group=groups.get(key)||[];
   group.push(p);groups.set(key,group);
  }
  const connected=[];
  for(const batch of groups.values()){
   const remaining=new Set(batch);
   for(const seed of batch){if(!remaining.delete(seed))continue;const group=[seed];
    for(const p of group)for(const q of remaining){
     if(supportsSand(p,q)||supportsSand(q,p)){remaining.delete(q);group.push(q);}
    }
    connected.push(group);
   }
  }
  for(const group of connected){
   let mass=0;const velocity=[0,0,0],nextVelocity=new Map();
   for(const p of group){const water=samples.get(p).water,immersed=clamp(water.density*1.6),density=aggregateDensity(p.wet),air=wind(p.position),v=p.velocity.slice(),force=sandWindForce(p,wind,scale),kg=p.mass*2650*scale**3,area=Math.PI*(aggregateRadius(p)*scale)**2*Math.max(.3,p.aspect||1),forceSize=Math.hypot(...force),relativeSpeed=Math.sqrt(forceSize/Math.max(1e-12,.5*1.225*.9*area)),dragLimit=1/(1+forceSize*dt/Math.max(1e-12,kg*relativeSpeed));
    v[1]+=9.81/scale*(immersed/density-1)*dt;
    for(let k=0;k<3;k++){v[k]+=(water.velocity[k]-v[k])*(1-Math.exp(-dt*immersed*3));v[k]+=p.windborne?(air[k]-v[k])*(1-Math.exp(-dt*2.5))*(1-immersed):force[k]/Math.max(1e-12,kg)/scale*dt*dragLimit*(1-immersed);velocity[k]+=v[k]*p.mass;}mass+=p.mass;nextVelocity.set(p,v);
   }
   for(let k=0;k<3;k++)velocity[k]/=mass;
   const delta=velocity.map(v=>v*dt),center=[0,1,2].map(k=>group.reduce((s,p)=>s+p.mass*p.position[k],0)/mass),angular=[0,0,0];let inertia=0;
   const tumble=group.length>1&&group.every(p=>!p.cuts?.length&&(!p.aspect||p.aspect===1));
   if(tumble)for(const p of group){const arm=p.position.map((v,k)=>v-center[k]),spin=cross(arm,nextVelocity.get(p).map((v,k)=>v-velocity[k]));for(let k=0;k<3;k++)angular[k]+=(spin[k]+.4*aggregateRadius(p)**2*(p.angularVelocity?.[k]||0))*p.mass;inertia+=p.mass*(arm.reduce((s,v)=>s+v*v,0)+.4*aggregateRadius(p)**2);}
   const omega=angular.map(v=>v/Math.max(1e-12,inertia)),rate=Math.hypot(...omega);if(rate>2)for(let k=0;k<3;k++)omega[k]*=2/rate;
   const offsets=new Map(group.map(p=>{const arm=p.position.map((v,k)=>v-center[k]),speed=Math.hypot(...omega),axis=omega.map(v=>v/Math.max(1e-12,speed)),angle=speed*dt,turn=cross(axis,arm),dot=axis.reduce((s,v,k)=>s+v*arm[k],0);return [p,arm.map((v,k)=>v*(Math.cos(angle)-1)+turn[k]*Math.sin(angle)+axis[k]*dot*(1-Math.cos(angle)))];}));
   // Preserve the shape at the basin bounds as well as at sand contact.
   for(const k of [0,2]){const edge=k===0?5.45:4.85;let lo=-Infinity,hi=Infinity;for(const p of group){lo=Math.max(lo,-edge-p.position[k]);hi=Math.min(hi,edge-p.position[k]);}delta[k]=clamp(delta[k],lo,hi);}
   for(const p of group)if(p.departingFrom){const parent=this.parcels.find(q=>q.id===p.departingFrom);if(!parent||p.position.reduce((sum,v,k)=>sum+(v-parent.position[k])*velocity[k],0)<0)p.departingFrom=null;}
   // Dry stock lands on its underside. Inflating the collider by a spherical
   // radius also accepts a nearby side wall, which can pin a loose cap in air.
   const distance=t=>{let d=Infinity;for(const p of group){
    const center=p.position.map((v,k)=>v+(delta[k]+offsets.get(p)[k])*t),bond=hasSandBond(p),ceiling=bond?Infinity:center[1]-.00001,looseGroup=bond?null:p.layerGroup;
    if(p.cuts?.length){for(const f of sandFeet(p))d=Math.min(d,this.contactDistance(center.map((v,k)=>v+f[k]),0,p.fractureIgnore||p.departingFrom,ceiling,looseGroup));}
    else if(!bond)d=Math.min(d,this.contactDistance([center[0],center[1]-shapeHeight(p),center[2]],0,p.fractureIgnore||p.departingFrom,ceiling,looseGroup));
    else d=Math.min(d,this.contactDistance(center,shapeHeight(p),p.fractureIgnore||p.departingFrom,ceiling,looseGroup));
   }return d;};
   const reach=Math.max(...group.map(p=>Math.hypot(...delta.map((v,k)=>v+offsets.get(p)[k])))),radius=Math.min(...group.map(aggregateRadius)),steps=Math.min(64,Math.max(1,Math.ceil(reach/Math.max(.005,radius*.5))));
   const start=distance(0),escaping=start<=.0005&&distance(1)>start+.0001;
   // An explicit push may start inside the deposit it was cut from. Let that
   // outward motion detach; only incoming contact should immediately bond.
   let hit=start<=.0005&&!escaping,travel=hit?0:1,previous=0;
   for(let i=1;!hit&&!escaping&&i<=steps;i++){const t=i/steps;if(distance(t)<=.0005){let lo=previous,hi=t;for(let j=0;j<9;j++){const mid=(lo+hi)*.5;if(distance(mid)>.0005)lo=mid;else hi=mid;}travel=hi;hit=true;}previous=t;}
   for(const p of group){for(let k=0;k<3;k++)p.position[k]+=(delta[k]+offsets.get(p)[k])*travel;const spin=cross(omega,p.position.map((v,k)=>v-center[k]-delta[k]*travel));p.velocity=velocity.map((v,k)=>v+spin[k]);p.angularVelocity=omega.slice();}
   if(hit)for(const p of group)this.deposit(p,p.mass);
  }
  // Depositing dry stock can consume its old supporting parcel. Do not leave
  // an attached wet selection anchored to that parcel until a later edit.
  this.releaseUnsupported();
 }
}
