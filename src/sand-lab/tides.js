// A bounded ocean exchanges water with an unresolved offshore reservoir.
// This is a tidal boundary condition, not a simulation of an entire planet.
// M2/S2 interference follows the lunar/solar hour angles (NOAA tidal harmonics).
export const LUNAR_MONTH=29.53059;
const tau=2*Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function lunarState(day){const age=((day%LUNAR_MONTH)+LUNAR_MONTH)%LUNAR_MONTH,elongation=age/LUNAR_MONTH*tau;return {age,elongation,illuminated:(1-Math.cos(elongation))*.5,waxing:age<LUNAR_MONTH/2};}
export function moonPhaseState(state){return lunarState((state.lunarDay??LUNAR_MONTH/2)+(state.moonPhaseOffset||0));}
export function advanceSkyClocks(state,dt){
 if(state.cycle)state.day=((state.day+dt/Math.max(1,state.daySeconds)*24)%24+24)%24;
 if(state.lunarCycle)state.lunarDay=lunarState(state.lunarDay+dt/Math.max(1,state.lunarSeconds)*LUNAR_MONTH).age;
}
export function tidalElevation(day,lunarDay,amplitude=1.5){
 const hour=(day-12)/24*tau,phase=lunarState(lunarDay).elongation;
 return amplitude*(Math.cos(2*(hour-phase))+.46*Math.cos(2*hour))/1.46;
}
function resizeWater(lab,keep,items){
 const n=keep.length+items.length,remap=new Int32Array(lab.count).fill(-1);
 keep.forEach((i,j)=>remap[i]=j);
 for(const name of ['positions','velocities','chem']){const old=lab[name],next=new Float32Array(n*4);keep.forEach((i,j)=>next.set(old.subarray(i*4,i*4+4),j*4));if(name!=='chem')items.forEach((p,j)=>next.set(p[name==='positions'?'position':'velocity'],(keep.length+j)*4));lab[name]=next;}
 if(lab.held)lab.held.ids=lab.held.ids.map(i=>remap[i]); // held parcels never leave at the boundary
 if(lab.rain){for(const p of lab.rain.deposits.values())if(p.particle>=0)p.particle=remap[p.particle]??-1;lab.rain.columns=null;}
 lab.detail?.remapEmitters(keep);lab.surfaceMetrics=null;lab.surfaceBreakup=null;lab.aerationActivity=null;lab.neighborCounts=new Uint16Array(n);lab.emitterSamples=null;lab.gpu.neighborOrigin=null;lab.fluidIndex=null;lab.revision++;
}
export class TideBoundary{
 constructor(){this.previous=null;this.demand=0;this.exchanged=0;this.imported=0;this.exported=0;this.clock=0;this.sequence=0;this.capacityLimited=false;this.height=0;}
 step(lab,dt){
  const height=tidalElevation(lab.day,moonPhaseState(lab).age,lab.tideAmplitude),scale=lab.spec.scale;
  this.height=height;
  if(!lab.tidesEnabled){this.previous=height;this.demand=this.exchanged;return;}
  if(this.previous!==null)this.demand+=(height-this.previous)/scale*75;
  this.previous=height;this.clock+=dt;
  const pending=this.demand-this.exchanged,s=lab.spacing,pv=s**3;
  if(this.clock<.25||Math.abs(pending)<pv)return;this.clock%=.25;
  const budget=Math.min(24,Math.floor(Math.abs(pending)/pv)),p=lab.positions,n=lab.count,keep=[],items=[];
  // Estimate the bulk level from the offshore water, not the highest flying
  // droplet. Exchange happens a full kernel below it, throughout a submerged
  // boundary strip. A changing target never creates a new surface emitter.
  const edge=[];for(let i=0;i<n;i++)if(!p[i*4+3]&&p[i*4+2]<-3.7)edge.push(i);
  if(edge.length<16)return;
  edge.sort((a,b)=>p[a*4+1]-p[b*4+1]);
  const waterline=p[edge[Math.floor((edge.length-1)*.85)]*4+1]+s*.45;
  const ceiling=waterline-s*1.4,floor=p[edge[Math.floor((edge.length-1)*.08)]*4+1];
  this.exchangeCeiling=ceiling;
  if(pending<0){
   const candidates=edge.filter(i=>p[i*4+1]<=ceiling);
   // Spread withdrawal through the submerged strip instead of peeling off
   // its visible top layer. Never export held water or isolated spray.
   const removed=new Set();for(let j=0;j<candidates.length&&removed.size<Math.min(budget,Math.max(0,n-128));j++){
    const at=(j+this.sequence)%candidates.length;removed.add(candidates[at]);
   }this.sequence+=budget;
   for(let i=0;i<n;i++)if(!removed.has(i))keep.push(i);
   if(removed.size){resizeWater(lab,keep,items);this.exchanged-=removed.size*pv;this.exported+=removed.size*pv;}
   this.capacityLimited=false;return;
  }
  this.capacityLimited=n>=lab.particleBudget;if(this.capacityLimited||ceiling<=floor)return;
  const bins=new Map(),key=(x,y,z)=>`${x},${y},${z}`;
  const insert=(q,i)=>{const id=key(...q.map(v=>Math.floor(v/s)));if(!bins.has(id))bins.set(id,[]);bins.get(id).push({q,i});};
  for(let i=0;i<n;i++){const o=i*4;insert([p[o],p[o+1],p[o+2]],i);keep.push(i);}
  for(let attempt=0;attempt<192&&items.length<budget&&n+items.length<lab.particleBudget;attempt++){
   const seq=++this.sequence,position=[-4.65+9.3*((seq*.61803398875)%1),floor+(ceiling-floor)*((seq*.569840291)%1),-4.5+.65*((seq*.754877666)%1)];
   if(lab.solid(position)<s*.45)continue;
   const c=position.map(v=>Math.floor(v/s));let nearest=-1,distance=Infinity,neighbors=0;
   for(let z=-2;z<=2;z++)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)for(const other of bins.get(key(c[0]+x,c[1]+y,c[2]+z))||[]){
    const d=Math.hypot(...position.map((v,k)=>v-other.q[k]));if(d<s*1.8)neighbors++;if(d<distance){distance=d;nearest=other.i;}
   }
   // Modest, distributed compression supplies volume to the constraint
   // solver. An occupied neighborhood excludes dry gaps / airborne islands.
   if(distance<s*.7||neighbors<8||nearest<0)continue;
   const velocity=Array.from(lab.velocities.subarray(nearest*4,nearest*4+3));velocity[1]=clamp(velocity[1],-.1,.1);
   items.push({position,velocity});insert(position,nearest);
  }
  if(items.length){resizeWater(lab,keep,items);this.exchanged+=items.length*pv;this.imported+=items.length*pv;}
 }
}
