// A bounded ocean exchanges water with an unresolved offshore reservoir.
// This is a tidal boundary condition, not a simulation of an entire planet.
// M2/S2 interference follows the lunar/solar hour angles (NOAA tidal harmonics).
export const LUNAR_MONTH=29.53059;
const tau=2*Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function lunarState(day){const age=((day%LUNAR_MONTH)+LUNAR_MONTH)%LUNAR_MONTH,elongation=age/LUNAR_MONTH*tau;return {age,elongation,illuminated:(1-Math.cos(elongation))*.5,waxing:age<LUNAR_MONTH/2};}
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
  const height=tidalElevation(lab.day,lab.lunarDay,lab.tideAmplitude),scale=lab.spec.scale;
  this.height=height;
  if(!lab.tidesEnabled){this.previous=height;this.demand=this.exchanged;return;}
  if(this.previous!==null)this.demand+=(height-this.previous)/scale*75;
  this.previous=height;this.clock+=dt;
  const pending=this.demand-this.exchanged,s=lab.spacing,pv=s**3;
  if(this.clock<.25||Math.abs(pending)<pv)return;this.clock%=.25;
  const budget=Math.min(24,Math.floor(Math.abs(pending)/pv)),p=lab.positions,n=lab.count,keep=[],items=[];
  if(pending<0){
   // Export the highest free parcels at the offshore edge. Held water and
   // user-created sand/objects remain intact; rain ownership is remapped.
   const candidates=[];for(let i=0;i<n;i++){const o=i*4;if(!p[o+3]&&p[o+2]<-3.7)candidates.push(i);}
   candidates.sort((a,b)=>p[b*4+1]-p[a*4+1]);const removed=new Set(candidates.slice(0,Math.min(budget,Math.max(0,n-128))));
   for(let i=0;i<n;i++)if(!removed.has(i))keep.push(i);
   if(removed.size){resizeWater(lab,keep,items);this.exchanged-=removed.size*pv;this.exported+=removed.size*pv;}
   this.capacityLimited=false;return;
  }
  this.capacityLimited=n>=lab.particleBudget;if(this.capacityLimited)return;
  // Spatial hash keeps insertion linear in particle count, with bounded local
  // separation tests. New parcels inherit adjacent flow, rather than exploding
  // into overlapped water at a single inlet point.
  const bins=new Map(),tops=new Map(),key=(x,y,z)=>`${x},${y},${z}`;
  const insert=(q,i)=>{const x=Math.floor(q[0]/s),y=Math.floor(q[1]/s),z=Math.floor(q[2]/s),id=key(x,y,z);if(!bins.has(id))bins.set(id,[]);bins.get(id).push(q);const c=`${x},${z}`;if(!tops.has(c)||q[1]>tops.get(c).y)tops.set(c,{y:q[1],i});};
  for(let i=0;i<n;i++){const o=i*4;insert([p[o],p[o+1],p[o+2]],i);keep.push(i);}
  const clear=q=>{const c=q.map(v=>Math.floor(v/s));for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const other of bins.get(key(c[0]+x,c[1]+y,c[2]+z))||[])if(Math.hypot(...q.map((v,k)=>v-other[k]))<s*.86)return false;return true;};
  for(let attempt=0;attempt<96&&items.length<budget&&n+items.length<lab.particleBudget;attempt++){
   const seq=++this.sequence,x=-4.65+9.3*((seq*.61803398875)%1),z=-4.5+.55*((seq*.754877666)%1),cx=Math.floor(x/s),cz=Math.floor(z/s);let top=-Infinity,nearest=-1;
   for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const t=tops.get(`${cx+dx},${cz+dz}`);if(t&&t.y>top){top=t.y;nearest=t.i;}}
   if(!Number.isFinite(top))continue;const position=[x,top+s*.9,z];if(!clear(position)||lab.solid(position)<s*.3)continue;
   const velocity=nearest>=0?Array.from(lab.velocities.subarray(nearest*4,nearest*4+3)):[0,0,0];velocity[1]=clamp(velocity[1],-.1,.1);
   items.push({position,velocity});insert(position,nearest);
  }
  if(items.length){resizeWater(lab,keep,items);this.exchanged+=items.length*pv;this.imported+=items.length*pv;}
 }
}
