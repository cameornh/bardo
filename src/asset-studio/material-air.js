// Sparse one-cubic-metre air cells, stored as departures from the room reservoir.
// Quantities advect together; only water vapour contributes to relative humidity.
export const ROOM = 293.15;
export const AIR_CAPACITY = 1200; // J/K per cell
export const AIR_OXYGEN = .275; // kg per cell
export const MAX_AIR = 384;
export const clamp = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
const names = ['heat','water','oxygenUsed','smoke','vapour'];
export const saturation = t => .0173*Math.exp(clamp(17.27*(t-ROOM)/(Math.max(170,t)-35.85),-12,5));
const key = (x,y,z) => x+','+y+','+z;
export class MaterialAir {
 constructor(){this.cells=new Map();this.temperature=ROOM;this.humidity=.45;}
 at(p,create=true){return this.cell(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z),create);}
 cell(x,y,z,create,limit=MAX_AIR){
  const id=key(x,y,z);let c=this.cells.get(id);
  if(!c&&create&&this.cells.size<limit){
   c={id,x,y,z,heat:0,water:0,oxygenUsed:0,smoke:0,vapour:0};this.cells.set(id,c);
  }
  return c;
 }
 read(c){
  const t=clamp(this.temperature+(c?.heat||0)/AIR_CAPACITY,70,2500);
  const water=Math.max(0,this.humidity*saturation(this.temperature)+(c?.water||0));
  return {temperature:t,water,humidity:water/saturation(t),oxygen:clamp(AIR_OXYGEN-(c?.oxygenUsed||0),0,AIR_OXYGEN)};
 }
 advance(dt,wind){
  // Conservative upwind flux with an open far boundary. Never spawn an expanding
  // shell of empty cells from a single sub-pixel smoke trace.
  const flow=wind.heading*Math.PI/180,dx=wind.speed*Math.cos(flow),dz=wind.speed*Math.sin(flow);
  const changes=new Map();
  const add=(c,k,v)=>{if(!c)return;let a=changes.get(c);if(!a){a=[0,0,0,0,0];changes.set(c,a);}a[k]+=v;};
  for(const c of [...this.cells.values()]){
   const visible=Math.max(Math.abs(c.heat)/130,Math.abs(c.water)*3500,c.oxygenUsed*500,c.smoke*5000,c.vapour*2200);
   if(visible<.015)continue;
   const rise=clamp(c.heat/AIR_CAPACITY*.018,-.35,2.8);
   const mix=.038,weights=[mix+Math.max(0,dx),mix+Math.max(0,-dx),mix+Math.max(0,rise),mix+Math.max(0,-rise),mix+Math.max(0,dz),mix+Math.max(0,-dz)];
   const norm=weights.reduce((a,b)=>a+b,0),transfer=-Math.expm1(-dt*norm)/norm;
   for(let i=0;i<6;i++){
    const w=weights[i]*transfer;
    const dest=this.cell(c.x+(i===0)-(i===1),c.y+(i===2)-(i===3),c.z+(i===4)-(i===5),visible*w>.018,MAX_AIR-40);
    for(let k=0;k<names.length;k++){const amount=c[names[k]]*w;add(c,k,-amount);add(dest,k,amount);}
   }
  }
  const ventilation=Math.exp(-dt*.12);
  for(const c of this.cells.values()){
   const a=changes.get(c);
   for(let k=0;k<names.length;k++)c[names[k]]=(c[names[k]]+(a?.[k]||0))*ventilation;
   if(Math.abs(c.heat)<1&&Math.abs(c.water)<3e-6&&c.oxygenUsed<1e-5&&c.smoke<2e-6&&c.vapour<3e-6)this.cells.delete(c.id);
  }
 }
}
