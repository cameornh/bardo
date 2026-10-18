import {sandAdhesion} from './sand-material.js';
import {shapeRadius} from './sand-shape.js';

const noise=i=>{const x=Math.sin(i*12.9898)*43758.5453;return x-Math.floor(x);};
export const erosionThreshold=(wet,memory=0)=>7+85*sandAdhesion(wet,memory)+18*wet;
// This is stock transfer, not a cosmetic emitter: every wind parcel is removed
// from the bed/deposit and returned by the normal sand landing path. Fine GPU
// grains are visual tracers of that transported stock, not another mass source.
export function erodeSand(bed,dt,wind,scale,water){
 bed.windClock=(bed.windClock||0)+dt;if(bed.windClock<.12)return;
 const elapsed=bed.windClock;bed.windClock=0;bed.windEvents??=[];
 const mobile=bed.parcels.filter(p=>p.windborne&&!p.anchored&&!p.held&&p.mass>0).length;
 let available=Math.max(0,Math.min(32-mobile,128-bed.parcels.length));if(!available)return;
 const count=Math.min(192,bed.mass.length),start=bed.windCursor||0;
 if(!bed.windStride){const gcd=(a,b)=>b?gcd(b,a%b):a;let stride=Math.floor(bed.mass.length*.61803398875);while(gcd(stride,bed.mass.length)!==1)stride++;bed.windStride=stride;}
 const emit=(point,air,mass,wet,memory,packing)=>{
  if(mass<=1e-10)return false;
  const r=Math.cbrt(mass/(packing*4*Math.PI/3)),speed=Math.hypot(...air)*scale;
  const p={id:bed.nextId++,position:[point[0],point[1]+r+.002,point[2]],velocity:air.map((v,k)=>v*.07+(k===1?Math.min(2.5,.25+speed*.025)/scale:0)),mass,wet,memory,packing,windborne:true};
  bed.parcels.push(p);bed.windEvents.push({position:p.position.slice(),velocity:p.velocity.slice(),amount:mass,seed:p.id});if(bed.windEvents.length>128)bed.windEvents.shift();
  bed.windMoved=(bed.windMoved||0)+mass;bed.dirty=true;available--;return true;
 };
 for(let j=0;j<count&&available;j++){
  const k=(start+j*bed.windStride)%bed.mass.length;if(bed.mass[k]<1e-8)continue;
  const x=k%bed.n*bed.dx-5.5+bed.dx*(noise(k+bed.revision)-.5)*.65,z=Math.floor(k/bed.n)*bed.dz-4.9+bed.dz*(noise(k+bed.revision+42)-.5)*.65,y=bed.height(x,z),p=[x,y+.045,z];
  const air=wind(p),excess=Math.hypot(...air)*scale-erosionThreshold(bed.wet[k],bed.memory[k]);
  if(excess<=0||water(p).density>.08)continue;
  const mass=Math.min(bed.mass[k]*.005,bed.area*bed.packing[k]*.000035*excess**1.5/scale*elapsed*bed.mass.length/count);
  // An overlying deposit shelters the bed; never create grains inside it.
  if(bed.parcels.some(q=>q.anchored&&Math.hypot(x-q.position[0],z-q.position[2])<shapeRadius(q)&&q.position[1]>y))continue;
  if(emit([x,y,z],air,mass,bed.wet[k],bed.memory[k],bed.packing[k]))bed.mass[k]-=mass;
 }
 bed.windCursor=(start+count*bed.windStride)%bed.mass.length;
 // Small loose deposited kernels lift as a unit; larger/dried bonded stock
 // is handled by the mechanical stress graph, without eroding a CSG cut away.
 for(const p of bed.parcels){if(!available||!p.anchored||p.held||p.mass<=0||p.cuts?.length||p.memory>.34)continue;
  const r=shapeRadius(p),point=[p.position[0],p.position[1]+r*(p.aspect||1)+.035,p.position[2]],air=wind(point),excess=Math.hypot(...air)*scale-erosionThreshold(p.wet,p.memory||0);
  if(excess<=0||water(point).density>.08)continue;
  const amount=Math.min(p.mass*.025,Math.PI*r*r*p.packing*.000035*excess**1.5/scale*elapsed);
  if(emit(point,air,amount,p.wet,p.memory||0,p.packing)){const before=p.mass;p.mass-=amount;if(p.shapeRadius)p.shapeRadius*=Math.cbrt(p.mass/before);}
 }
}
