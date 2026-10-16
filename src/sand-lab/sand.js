// Conservative sand stock, packing, retained moisture and mobile aggregates.
// Coordinates are lab units; `mass` is solid-grain volume (multiply by rho and scale³).
export const SAND={packing:.56,maxPacking:.72,wettingSeconds:5,dryingSeconds:600,looseDensity:.55,wetDensity:1.7,cohesionWetness:.35};
const noise=i=>{const x=Math.sin(i*12.9898)*43758.5453;return x-Math.floor(x);};
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const beachHeight=(x,z)=>Math.max(-.3,(z-1)*.48)+.045*Math.sin(x*.6)*Math.exp(-(((z-3)/2)**2));
export function aggregateDensity(wet){return SAND.looseDensity+(SAND.wetDensity-SAND.looseDensity)*clamp(wet);}
export function moisture(wet,contact,dt,rain=0){return contact?1-(1-wet)*Math.exp(-dt/SAND.wettingSeconds):clamp(wet*Math.exp(-dt/SAND.dryingSeconds)+rain*dt);}
export const cubicWeights=t=>[(1-t)**3/6,(3*t**3-6*t*t+4)/6,(-3*t**3+3*t*t+3*t+1)/6,t**3/6];
export const aggregateRadius=p=>Math.cbrt(p.mass/(p.packing*4*Math.PI/3));
const cohesive=p=>Math.max(p.wet,p.memory||0)>=SAND.cohesionWetness;
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
 distance(p){let d=(p[1]-this.height(p[0],p[2]))*.65;for(const a of this.parcels){if(a.held||a.mass<=0)continue;const r=aggregateRadius(a);d=union(d,Math.hypot(...p.map((v,k)=>v-a.position[k]))-r,Math.min(.08,r*.5));}return d;}
 // Bonded deposits are persistent volumetric terms of the same terrain SDF.
 // They keep their own material instead of mixing into the entire dry column.
 contactDistance(p,radius){let d=(p[1]-radius-this.height(p[0],p[2]))*.65;for(const a of this.parcels){if(!a.anchored||a.held||a.mass<=0)continue;const r=aggregateRadius(a);d=union(d,Math.hypot(...p.map((v,k)=>v-a.position[k]))-r-radius,Math.min(.08,r*.5));}return d;}
 materialAt(p){let d=(p[1]-this.height(p[0],p[2]))*.65,wet=this.sample(p[0],p[2]);for(const a of this.parcels){const r=aggregateRadius(a),q=Math.hypot(...p.map((v,k)=>v-a.position[k]))-r,k=Math.min(.08,r*.5),h=clamp(.5+.5*(d-q)/Math.max(k,.00001));wet=wet*(1-h)+a.wet*h;d=d*(1-h)+q*h-k*h*(1-h);}return wet;}
 sample(x,z,array=this.wet){return this.weights(x,z).reduce((s,[k,w])=>s+array[k]*w,0);}
 totalMass(){return this.mass.reduce((a,b)=>a+b,0)+this.parcels.reduce((a,b)=>a+b.mass,0);}
 update(){this.dirty=false;for(let k=0;k<this.mass.length;k++)this.data.set([this.heightAt(k),this.wet[k],this.packing[k],this.memory[k]],k*4);this.revision++;}
 compact(x,z,radius,load){this.dirty=true;let displaced=0;for(const [k,w] of this.footprint(x,z,radius)){const before=this.heightAt(k),capacity=SAND.maxPacking-this.packing[k],gain=capacity*(1-Math.exp(-load*w*this.wet[k]*3));this.packing[k]+=gain;this.memory[k]=Math.max(this.memory[k],this.wet[k]);displaced+=(before-this.heightAt(k))*this.area;}return displaced;}
 footprint(x,z,r){const result=[];const a=Math.max(0,Math.floor((x-r+5.5)/this.dx)),b=Math.min(this.n-1,Math.ceil((x+r+5.5)/this.dx)),c=Math.max(0,Math.floor((z-r+4.9)/this.dz)),d=Math.min(this.n-1,Math.ceil((z+r+4.9)/this.dz));for(let j=c;j<=d;j++)for(let i=a;i<=b;i++){const distance=Math.hypot(i*this.dx-5.5-x,j*this.dz-4.9-z);if(distance<r)result.push([j*this.n+i,(1-(distance/r)**2)**3]);}return result.length?result:this.weights(x,z);}
 takeSmallSphere(point,radius,fraction=1){
  const top=this.height(point[0],point[2]),weights=this.weights(point[0],point[2]),bottom=weights.reduce((sum,[k,w])=>sum+this.base[k]*w,0);
  const cap=y=>{const h=clamp(y-point[1]+radius,0,2*radius);return Math.PI*h*h*(radius-h/3);};
  const volume=Math.max(0,cap(top)-cap(bottom))*clamp(fraction);let mass=0,occupied=0,water=0,memory=0;
  for(const [k,w] of weights){const amount=Math.min(this.mass[k],volume*w*this.packing[k]);this.mass[k]-=amount;mass+=amount;occupied+=amount/this.packing[k];water+=amount*this.wet[k];if(amount>0)memory=Math.max(memory,this.memory[k]);}
  return mass>1e-14?{position:[point[0],Math.min(point[1],top-radius*.25),point[2]],mass,wet:water/mass,packing:mass/occupied,memory}:null;
 }
 extract(point,radius,velocity=[0,0,0],held=false,fraction=1){const created=[],small=radius<Math.min(this.dx,this.dz)*.7;if(small){const p=this.takeSmallSphere(point,radius,fraction);if(p)created.push({...p,velocity:velocity.slice(),held,id:this.nextId++});}else for(const [k,w] of this.footprint(point[0],point[2],radius)){const top=this.heightAt(k),x=(k%this.n)*this.dx-5.5,z=Math.floor(k/this.n)*this.dz-4.9,radial=Math.hypot(x-point[0],z-point[2]),half=Math.sqrt(Math.max(0,radius*radius-radial*radial)),depth=Math.max(0,Math.min(top,point[1]+half)-Math.max(this.base[k],point[1]-half)),amount=Math.min(this.mass[k],depth*this.packing[k]*this.area*fraction);if(amount<1e-8)continue;this.mass[k]-=amount;created.push({position:[x,top-depth*.5,z],mass:amount,wet:this.wet[k],packing:this.packing[k],memory:this.memory[k],velocity:velocity.slice(),held,id:this.nextId++});}
 // Combine adjacent extracted cells into bounded, unequal aggregates without losing mass.
 while(created.length>24){let small=0;for(let i=1;i<created.length;i++)if(created[i].mass<created[small].mass)small=i;const p=created.splice(small,1)[0];let q=created[0],best=Infinity;for(const candidate of created){const distance=candidate.position.reduce((sum,v,k)=>sum+(v-p.position[k])**2,0);if(distance<best){best=distance;q=candidate;}}const m=q.mass+p.mass;for(let k=0;k<3;k++)q.position[k]=(q.position[k]*q.mass+p.position[k]*p.mass)/m;mergeStock(q,p,p.mass);}
 if(!small)irregularize(created,this.dx,this.dz);
 const existing=[];
 for(const p of this.parcels.slice())if(!p.held&&p.mass>0&&Math.hypot(...p.position.map((v,k)=>v-point[k]))<radius+aggregateRadius(p)){
  if(held){p.held=true;p.anchored=false;p.velocity.fill(0);existing.push(p);}
  else if(p.anchored){const amount=p.mass*clamp(fraction);if(amount<=0)continue;const q={...p,id:this.nextId++,position:p.position.slice(),velocity:velocity.slice(),mass:amount,held:false,anchored:false};p.mass-=amount;this.parcels.push(q);existing.push(q);}
 }
 const batch=this.nextBatch++;for(const p of [...created,...existing])p.batch=batch;
 this.parcels.push(...created);this.parcels=this.parcels.filter(p=>p.mass>0);this.update();return [...created,...existing];}
 carve(point,radius){
  // Subtract the sphere's intersection with the exposed column stock. This
  // is a surface crater in the current sand model, not an underground tunnel.
  const small=radius<Math.min(this.dx,this.dz)*.7;let removed=small?(this.takeSmallSphere(point,radius)?.mass||0):0;if(!small)for(const [k] of this.footprint(point[0],point[2],radius)){const x=k%this.n*this.dx-5.5,z=Math.floor(k/this.n)*this.dz-4.9,rr=radius*radius-(x-point[0])**2-(z-point[2])**2;if(rr<=0)continue;const top=this.heightAt(k),half=Math.sqrt(rr),low=Math.max(this.base[k],point[1]-half),high=Math.min(top,point[1]+half),amount=Math.max(0,high-low)*this.packing[k]*this.area;this.mass[k]-=amount;removed+=amount;}
  this.removedMass+=removed;this.update();return removed;
 }
 deposit(parcel,amount){amount=Math.min(parcel.mass,amount);if(amount<=0)return;
  if(cohesive(parcel)){
   if(amount>=parcel.mass){parcel.anchored=true;parcel.held=false;parcel.velocity=[0,0,0];}
   else{this.parcels.push({...parcel,id:this.nextId++,position:parcel.position.slice(),velocity:[0,0,0],mass:amount,held:false,anchored:true});parcel.mass-=amount;}
   this.dirty=true;return;
  }
  // Dry grains join the continuous bed in one transfer, then repose acts on
  // that field. No collection of shrinking/bouncing spheres at the landing.
  const radius=Math.max(this.dx*2.8,this.dz*2.8,aggregateRadius(parcel)*2),weights=this.footprint(parcel.position[0],parcel.position[2],radius),sum=weights.reduce((a,b)=>a+b[1],0)||1;
  for(const [k,w] of weights){const added=amount*w/sum,m=this.mass[k]+added,volume=this.mass[k]/this.packing[k]+added/parcel.packing;this.wet[k]=(this.wet[k]*this.mass[k]+parcel.wet*added)/m;this.packing[k]=m/volume;this.memory[k]=Math.max(this.memory[k],parcel.wet,parcel.memory||0);this.mass[k]=m;}parcel.mass-=amount;this.dirty=true;
 }
 push(point,radius,direction,strength=.06){const wet=this.materialAt(point),packing=this.sample(point[0],point[2],this.packing),capacity=clamp((SAND.maxPacking-packing)/.16);this.compact(point[0],point[2],radius,strength*12);const mobilize=1-wet*capacity;return this.extract(point,radius,direction.map((v,k)=>v*strength*14+(k===1?strength*3:0)),false,strength*mobilize);}
 step(dt,sampleWater,wind,scale=6,rain=0,waterSpacing=0){
  // Only a shallow bed layer exchanges with water. Interior stock is stationary.
  this.exchangeClock=(this.exchangeClock||0)+dt;
  if(this.exchangeClock>.15){const h=this.exchangeClock;this.exchangeClock=0;for(let k=0;k<this.mass.length;k++){const x=k%this.n*this.dx-5.5,z=Math.floor(k/this.n)*this.dz-4.9,y=this.heightAt(k),water=sampleWater([x,y+.06,z]);this.wet[k]=moisture(this.wet[k],water.density>.12,h,rain);if(water.density>.12){const speed=Math.hypot(...water.velocity),stress=Math.max(0,speed-.35-this.wet[k]*.4);this.compact(x,z,this.dx*1.1,h*.015);if(stress>0&&this.parcels.length<64&&((Math.imul(k+1,1664525)+Math.imul(this.revision+1,1013904223))>>>0)%5===0){const amount=Math.min(this.mass[k],stress*h*this.area*.008);if(amount>1e-6){this.mass[k]-=amount;this.parcels.push({id:this.nextId++,mass:amount,position:[x+this.dx*(.8*noise(k+this.revision*71)-.4),y+.04,z+this.dz*(.8*noise(k+this.revision*131+17)-.4)],velocity:water.velocity.map((v,a)=>v*.4+(a===1?.04:0)),wet:this.wet[k],packing:.56,memory:this.memory[k],held:false});}}}}
   // Yield only above the retained angle of repose. Compaction and plastic
   // memory do not vanish when moisture does, so a dried sculpture stays put.
   const delta=new Float64Array(this.mass.length),waterDelta=delta.slice(),volumeDelta=delta.slice();for(let j=1;j<this.n-1;j++)for(let i=1;i<this.n-1;i++){const k=j*this.n+i;for(const q of [k+1,k+this.n]){const diff=this.heightAt(k)-this.heightAt(q),from=diff>0?k:q,to=diff>0?q:k;if(Math.max(this.memory[from],this.wet[from])>=SAND.cohesionWetness)continue;const reach=q===k+1?this.dx:this.dz,slope=.67+1.8*Math.max(this.memory[from],this.wet[from]),excess=Math.abs(diff)-reach*slope;if(excess>0){const flow=Math.min(this.mass[from]*.08,excess*this.area*this.packing[from]*Math.min(.18,h*.6));delta[from]-=flow;delta[to]+=flow;waterDelta[from]-=flow*this.wet[from];waterDelta[to]+=flow*this.wet[from];volumeDelta[from]-=flow/this.packing[from];volumeDelta[to]+=flow/this.packing[from];this.memory[to]=Math.max(this.memory[to],this.memory[from]);}}}for(let k=0;k<delta.length;k++){const next=this.mass[k]+delta[k],volume=this.mass[k]/this.packing[k]+volumeDelta[k];if(next>1e-12){this.wet[k]=clamp((this.mass[k]*this.wet[k]+waterDelta[k])/next);this.packing[k]=clamp(next/Math.max(1e-12,volume),SAND.packing,SAND.maxPacking);}this.mass[k]=next;}
  }
  this.stepParcels(dt,sampleWater,wind,scale,rain,waterSpacing);
  this.parcels=this.parcels.filter(p=>p.mass>0);this.update();
 }
 stepParcels(dt,sampleWater,wind,scale,rain,waterSpacing){
  const samples=new Map(),batchContact=new Map();
  // Sampling the centre alone misses water displaced by the sand itself.
  // Probe just outside its surface, including while it is held or bonded.
  for(const p of this.parcels){
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
   const key=cohesive(p)&&p.batch?p.batch:p,group=groups.get(key)||[];
   group.push(p);groups.set(key,group);
  }
  const connected=[];
  for(const batch of groups.values()){
   const remaining=new Set(batch);
   for(const seed of batch){if(!remaining.delete(seed))continue;const group=[seed];
    for(const p of group)for(const q of remaining){const r=aggregateRadius(p),s=aggregateRadius(q),bond=Math.min(.08,Math.min(r,s)*.5)*.45;
     if(Math.hypot(...p.position.map((v,k)=>v-q.position[k]))<=r+s+bond){remaining.delete(q);group.push(q);}
    }
    connected.push(group);
   }
  }
  for(const group of connected){
   let mass=0;const velocity=[0,0,0];
   for(const p of group){const water=samples.get(p).water,immersed=clamp(water.density*1.6),density=aggregateDensity(p.wet),air=wind(p.position),v=p.velocity.slice();
    v[1]+=9.81/scale*(immersed/density-1)*dt;
    for(let k=0;k<3;k++){v[k]+=(water.velocity[k]-v[k])*(1-Math.exp(-dt*immersed*3));v[k]+=(air[k]-v[k])*dt*.06*(1-immersed);velocity[k]+=v[k]*p.mass;}mass+=p.mass;
   }
   for(let k=0;k<3;k++)velocity[k]/=mass;
   const delta=velocity.map(v=>v*dt);
   // Preserve the shape at the basin bounds as well as at sand contact.
   for(const k of [0,2]){const edge=k===0?5.45:4.85;let lo=-Infinity,hi=Infinity;for(const p of group){lo=Math.max(lo,-edge-p.position[k]);hi=Math.min(hi,edge-p.position[k]);}delta[k]=clamp(delta[k],lo,hi);}
   const distance=t=>{let d=Infinity;for(const p of group)d=Math.min(d,this.contactDistance(p.position.map((v,k)=>v+delta[k]*t),aggregateRadius(p)));return d;};
   const reach=Math.hypot(...delta),radius=Math.min(...group.map(aggregateRadius)),steps=Math.min(64,Math.max(1,Math.ceil(reach/Math.max(.005,radius*.5))));
   const start=distance(0),escaping=start<=.0005&&distance(1)>start+.0001;
   // An explicit push may start inside the deposit it was cut from. Let that
   // outward motion detach; only incoming contact should immediately bond.
   let hit=start<=.0005&&!escaping,travel=hit?0:1,previous=0;
   for(let i=1;!hit&&!escaping&&i<=steps;i++){const t=i/steps;if(distance(t)<=.0005){let lo=previous,hi=t;for(let j=0;j<9;j++){const mid=(lo+hi)*.5;if(distance(mid)>.0005)lo=mid;else hi=mid;}travel=hi;hit=true;}previous=t;}
   for(const p of group){for(let k=0;k<3;k++)p.position[k]+=delta[k]*travel;p.velocity=velocity.slice();}
   if(hit)for(const p of group)this.deposit(p,p.mass);
  }
 }
}
