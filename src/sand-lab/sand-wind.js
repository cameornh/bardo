import {AIR_DENSITY,sandParticleMaterial,particleRelease} from './particulate-material.js';
import {shapeRadius} from './sand-shape.js';
import {sandColumn} from './sand-support.js';
const noise=i=>{const x=Math.sin(i*12.9898)*43758.5453;return x-Math.floor(x);};
export const erosionThreshold=(wet,memory=0)=>Math.sqrt(2*sandParticleMaterial(wet,memory).yieldStress/AIR_DENSITY);
// Every airborne packet is removed from a surface and returned on landing.
// Reserve eight packets for the brush so global transport cannot starve it.
export function erodeSand(bed,dt,wind,scale,water){
 bed.windClock=(bed.windClock||0)+dt;if(bed.windClock<.12)return;
 const elapsed=Math.min(.25,bed.windClock);bed.windClock=0;bed.windEvents??=[];
 const mobile=bed.parcels.filter(p=>p.windborne&&!p.anchored&&!p.held&&p.mass>0).length;
 let available=Math.max(0,(wind.brush?32:24)-mobile);if(!available)return;
 const forcing=(point,wet,memory)=>{
  const liquid=water(point),submerged=liquid.density>.08,flow=submerged?liquid.velocity:wind(point),speed=Math.hypot(...flow)*scale,material=sandParticleMaterial(wet,memory);
  return {flow,speed,material,submerged,...particleRelease(material,{speed,density:submerged?1000:AIR_DENSITY,shear:submerged?.035:1})};
 };
 const emit=(point,force,mass,wet,memory,packing,spread)=>{
  if(mass<=1e-10)return false;
  const {flow,speed,material,submerged}=force,r=Math.cbrt(mass/(packing*4*Math.PI/3)),n=wind.normal?.(point)||[0,1,0];
  const velocity=flow.map(v=>v*(submerged?.65:.12)),vn=velocity.reduce((s,v,k)=>s+v*n[k],0),lift=(.6+Math.min(2.8,speed*.025))/scale;
  for(let k=0;k<3;k++)velocity[k]+=n[k]*(lift-Math.min(vn,0));
  const p={id:bed.nextId++,position:point.map((v,k)=>v+n[k]*(r+.006)),velocity,mass,wet,memory,packing,windborne:true};
  bed.parcels.push(p);bed.windEvents.push({position:point.map((v,k)=>v+n[k]*.008),velocity:velocity.slice(),normal:n,spread,amount:mass,seed:p.id,material,speed,duration:elapsed,submerged});if(bed.windEvents.length>128)bed.windEvents.shift();
  bed.windMoved=(bed.windMoved||0)+mass;bed.dirty=true;available--;return true;
 };
 const rate=excess=>.00035*Math.min(170,excess)**1.5/scale;
 // Deposits must be considered before the huge bed consumes the work budget.
 let deposits=0;
 for(const p of bed.parcels.slice()){
  if(!available||deposits>=8||!p.anchored||p.held||p.mass<=0)continue;
  const r=shapeRadius(p);let top=null;
  for(const [x,z] of [[0,0],[.5,0],[-.5,0],[0,.5],[0,-.5]])for(const [,y] of sandColumn(p,x*r,z*r))if(!top||y>top[1])top=[x*r,y,z*r];
  if(!top)continue;
  const point=p.position.map((v,k)=>v+top[k]+(k===1?.01:0)),force=forcing(point,p.wet,p.memory||0),excess=force.excess;
  if(excess<=0)continue;
  const amount=Math.min(p.mass*.08,Math.PI*r*r*p.packing*rate(excess)*elapsed);
  if(emit(point,force,amount,p.wet,p.memory||0,p.packing,r*.4)){const before=p.mass;p.mass-=amount;const shrink=Math.cbrt(p.mass/before);if(p.shapeRadius)p.shapeRadius*=shrink;if(p.cuts)p.cuts=p.cuts.map(c=>({...c,offset:c.offset.map(v=>v*shrink),radius:c.radius*shrink}));deposits++;}
 }
 const count=Math.min(192,bed.mass.length),start=bed.windCursor||0;
 if(!bed.windStride){const gcd=(a,b)=>b?gcd(b,a%b):a;let stride=Math.floor(bed.mass.length*.61803398875);while(gcd(stride,bed.mass.length)!==1)stride++;bed.windStride=stride;}
 const candidates=[],used=new Set(),brush=wind.brush;
 // Resolve the actual cursor hit every step, including brushes narrower than
 // one terrain cell. Sample inside its footprint, not at distant grid nodes.
 if(brush?.kind==='sand'){
  const radius=Math.max(brush.radius,Math.min(bed.dx,bed.dz)*.8);
  const footprint=bed.footprint(brush.point[0],brush.point[2],radius).sort((a,b)=>b[1]-a[1]);
  for(const [k,w] of footprint.slice(0,64)){
   const x=k%bed.n*bed.dx-5.5,z=Math.floor(k/bed.n)*bed.dz-4.9,d=Math.hypot(x-brush.point[0],z-brush.point[2]),f=Math.min(1,brush.radius*.65/Math.max(d,1e-8));
   candidates.push({k,x:brush.point[0]+(x-brush.point[0])*f,z:brush.point[2]+(z-brush.point[2])*f,weight:w*Math.min(1,Math.PI*brush.radius**2/bed.area),spread:brush.radius*.3});used.add(k);
  }
 }
 for(let j=0;j<count;j++){
  const k=(start+j*bed.windStride)%bed.mass.length;if(used.has(k))continue;
  candidates.push({k,x:k%bed.n*bed.dx-5.5+bed.dx*(noise(k+bed.revision)-.5)*.65,z:Math.floor(k/bed.n)*bed.dz-4.9+bed.dz*(noise(k+bed.revision+42)-.5)*.65,weight:bed.mass.length/count,spread:Math.min(bed.dx,bed.dz)*.4});
 }
 for(const {k,x,z,weight,spread} of candidates){
  if(!available)break;if(bed.mass[k]<1e-8)continue;
  const y=bed.height(x,z),p=[x,y+.01,z],force=forcing(p,bed.wet[k],bed.memory[k]),excess=force.excess;
  if(excess<=0)continue;
  if(bed.parcels.some(q=>q.anchored&&Math.hypot(x-q.position[0],z-q.position[2])<shapeRadius(q)&&q.position[1]>y))continue;
  const mass=Math.min(bed.mass[k]*.02,bed.area*bed.packing[k]*rate(excess)*elapsed*weight);
  if(emit([x,y,z],force,mass,bed.wet[k],bed.memory[k],bed.packing[k],spread))bed.mass[k]-=mass;
 }
 bed.windCursor=(start+count*bed.windStride)%bed.mass.length;
}
