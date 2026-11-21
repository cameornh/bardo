import {mixDeposit,takeDeposit} from './deposit-heat.js';
import {entrainment,repose,launchGrain,driftGrain} from './wind-sand.js';

// Finite, non-repeating deposits. h is the thickness in metres over a square
// cell. Ground and objects contribute to the same free-surface elevation.
export const BED_CELL=.20,MAX_BED_NODES=6144;
const area=BED_CELL**2;
// Exact integer keys throughout the editable world; retain a collision-free
// fallback for material transported beyond that range.
export const bedKey=(x,z)=>Math.abs(x)<2**24&&Math.abs(z)<2**24?x+2**25*z:x+','+z;
const directions=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[-1,-1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2]];
export class MaterialBed{
 constructor(material,liquid){this.material=material;this.liquid=liquid;this.nodes=new Map();this.version=0;this.grains=[];this.grainCredit=0;this.seed=71;this.thermalCells=[];this.thermalCursor=0;}
 at(x,z){return this.nodes.get(bedKey(x,z));}
 add(x,z,volume,owner,thermal=null){
  const u=x/BED_CELL,v=z/BED_CELL,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
  const corners=[[i,j,(1-a)*(1-b)],[i+1,j,a*(1-b)],[i,j+1,(1-a)*b],[i+1,j+1,a*b]];
  if(this.nodes.size+corners.filter(([x,z,w])=>w>0&&!this.at(x,z)).length>MAX_BED_NODES)return false;
  for(const [x,z,w] of corners)if(w){
   const c=this.node(x,z,owner);mixDeposit(this,c,volume*w,thermal,BED_CELL);c.h+=volume*w/area;
  }this.version++;return true;
 }
 node(x,z,owner){
  const k=bedKey(x,z);let c=this.nodes.get(k);
  if(!c){c={x,z,h:0,owner};this.nodes.set(k,c);}
  return c;
 }
 sample(x,z){
  const u=x/BED_CELL,v=z/BED_CELL,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
  return (1-a)*(1-b)*(this.at(i,j)?.h||0)+a*(1-b)*(this.at(i+1,j)?.h||0)
   +(1-a)*b*(this.at(i,j+1)?.h||0)+a*b*(this.at(i+1,j+1)?.h||0);
 }
 thermalAt(x,z){
  if(!this.thermalCells.length)return null;
  const u=x/BED_CELL,v=z/BED_CELL,i=Math.floor(u),j=Math.floor(v);let best=0,site=null;
  for(const dx of [0,1])for(const dz of [0,1]){
   const c=this.at(i+dx,j+dz),weight=(c?.h||0)*(1-Math.abs(i+dx-u))*(1-Math.abs(j+dz-v));
   if(c?.thermal&&weight>best){best=weight;site=c.thermal;}
  }
  return site;
 }
 volume(){let h=0;for(const c of this.nodes.values())h+=c.h;return h*area;}
 move(c,nx,nz,amount){
  if(amount<=0||(!this.at(nx,nz)&&this.nodes.size>=MAX_BED_NODES))return;
  const neighbour=this.node(nx,nz,c.owner);
  mixDeposit(this,neighbour,amount*area,c.thermal,BED_CELL);
  if(c.thermal)takeDeposit(c.thermal,amount*area*this.material.density);
  neighbour.h+=amount;c.h-=amount;
 }
 random(){this.seed=(Math.imul(1664525,this.seed)+1013904223)>>>0;return this.seed/4294967296;}
 saltate(dt,wind,wx,wz,shear,cells,floor){
  for(let i=this.grains.length-1;i>=0;i--){
   const g=this.grains[i];driftGrain(g,dt,wind,wx,wz);
   if(g.y>floor(g.x,g.z)+this.sample(g.x,g.z))continue;
   // Return to the donor if the bounded sparse footprint cannot grow further.
   if(!this.add(g.x,g.z,g.load,g.donor.owner)){g.donor.h+=g.load/area;this.version++;}
   this.grains.splice(i,1);
  }
  this.grainCredit=shear?Math.min(8,this.grainCredit+dt*shear*Math.min(5,cells.length*area*.6)):0;
  while(this.grainCredit>=1&&this.grains.length<96){
   this.grainCredit--;const c=cells[Math.floor(this.random()*cells.length)];if(c.h<.001)continue;
   const x=(c.x+this.random()-.5)*BED_CELL,z=(c.z+this.random()-.5)*BED_CELL;
   const load=Math.min(.003,c.h*.20)*area;
   const g=launchGrain(x,floor(x,z)+this.sample(x,z),z,load,wind,wx,wz,Math.min(70,shear),()=>this.random());
   c.h-=load/area;g.donor=c;this.grains.push(g);this.version++;
  }
 }
 advance(dt,wind,floor,obstructed){
  if(!this.nodes.size)return;
  const m=this.material,angle=wind.heading*Math.PI/180,wx=Math.cos(angle),wz=Math.sin(angle);
  const threshold=this.liquid?.045:repose(m),shear=Math.max(0,wind.speed-entrainment(m));
  const spread=Math.min(.20,dt*(this.liquid?4/(1+m.viscosity):3.5));
  // A shallow liquid keeps a thin film. Grain friction and cohesion permit a finite slope.
  const film=this.liquid?.008:.0015,keys=[...this.nodes.values()];
  if(!this.liquid)this.saltate(dt,wind,wx,wz,shear,keys,floor);
  const support=new Map(),flux=new Float64Array(directions.length);
  const elevation=(x,z)=>{
   const k=bedKey(x,z);let h=support.get(k);
   if(h===undefined){h=obstructed?.(x,z)?Infinity:floor(x*BED_CELL,z*BED_CELL);support.set(k,h);}
   return h;
  };
  let moved=0;
  for(const c of keys){
   if(c.h<=film+.000004)continue;
   // Allow a moving obstacle to displace material already inside its footprint.
   const base=floor(c.x*BED_CELL,c.z*BED_CELL);
   let demand=0;
   for(let k=0;k<directions.length;k++){
    const [dx,dz,dist]=directions[k],x=c.x+dx,z=c.z+dz;
    const level=elevation(x,z)+(this.at(x,z)?.h||0);
    const diff=(base+c.h-level)/(dist*dist)-threshold*BED_CELL/dist;
    const drift=Math.max(0,dx*wx+dz*wz)*shear*.00013*dt/dist;
    const value=level===Infinity?0:Math.max(0,diff)*spread*.55+Math.min(c.h*.03,drift);
    flux[k]=value>1e-6?value:0;demand+=flux[k];
   }
   if(!demand)continue;
   const scale=Math.min(1,(c.h-film)/demand)*(c.thermal?.melt??1);
   for(let k=0;k<directions.length;k++)if(flux[k]){
    this.move(c,c.x+directions[k][0],c.z+directions[k][1],flux[k]*scale);
   }
   moved+=demand*scale;
  }
  if(moved>0)this.version++;
 }
 push(point,force,dt){
  const size=Math.hypot(force.x,force.z);if(!size)return;
  const dx=Math.abs(force.x)>.4*size?Math.sign(force.x):0,dz=Math.abs(force.z)>.4*size?Math.sign(force.z):0;
  let moved=false;
  for(const c of [...this.nodes.values()]){
   const d2=(c.x*BED_CELL-point.x)**2+(c.z*BED_CELL-point.z)**2;
   if(d2>.75**2)continue;
   this.move(c,c.x+dx,c.z+dz,Math.min(c.h*.35,size*dt/(this.material.density*area)*.07*Math.exp(-8*d2))*(c.thermal?.melt??1));moved=true;
  }
  if(moved)this.version++;
 }
}
