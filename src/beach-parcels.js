import * as THREE from 'three';
import { airVelocity } from './beach-wind.js';
import { GRAIN_MATERIALS } from './granular.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hash=i=>{const q=Math.sin(i*91.713+17.51)*43758.5453;return q-Math.floor(q);};
export function sedimentProperties(wet){const a=GRAIN_MATERIALS[1],b=GRAIN_MATERIALS[2],t=clamp(wet,0,1);return {friction:a.friction*(1-t)+b.friction*t,cohesion:a.cohesion*(1-t)+b.cohesion*t,damping:a.damping*(1-t)+b.damping*t};}
export class BeachParcels {
 constructor(sim){this.sim=sim;this.items=[];this.serial=0;this.capacity=0;this.scan=0;this.revision=0;this.texture=null;this.updateTexture();}
 add(kind,position,velocity,radius,wet=0){const volume=4*Math.PI/3*radius**3;this.items.push({kind,position:position.slice(),previous:position.slice(),velocity:velocity.slice(),radius,volume,wet,rest:0,age:0});this.revision++;}
 nudge(point,direction,radius=2){const sim=this.sim;let added=0;for(let i=0;i<64;i++){const id=this.serial++,angle=hash(id)*Math.PI*2,r=Math.sqrt(hash(id+310))*radius*.8,x=point[0]+Math.cos(angle)*r,z=point[2]+Math.sin(angle)*r,s=sim.sample(x,z,false),size=.085+hash(id+800)*.035,volume=4*Math.PI/3*size**3,wet=s.wet,weight=1-r/radius;
   // Each mobile parcel is withdrawn from the resting soil, then deposited
   // again when it settles. Mounds, loose grains and wet clumps share a ledger.
   if(sim.bedrock?.[Math.floor((z-sim.origin[1])/sim.dx)*sim.n+Math.floor((x-sim.origin[0])/sim.dx)]||!sim.queueTransfer(x,z,0,-volume))continue;const horizontal=Math.hypot(direction[0],direction[2])||1,lift=(4.5*(1-wet)+.65*wet)*weight;
   this.add('sand',[x,s.bed+size*1.4,z],[direction[0]/horizontal*3*weight,lift,direction[2]/horizontal*3*weight],size,wet);added++;
  }return added;
 }
 splash(point,velocity,volume=.035){const sim=this.sim,s=sim.sample(point[0],point[2],false);if(s.h<.04)return;volume=Math.min(volume,s.h*sim.dx*sim.dx*.3);if(!sim.queueTransfer(point[0],point[2],-volume,0))return;const count=12,radius=Math.cbrt(volume/count*3/(4*Math.PI));for(let i=0;i<count;i++){const angle=i/count*Math.PI*2,speed=1.4+hash(this.serial++)*1.8;this.add('water',[point[0],s.surface+.07,point[2]],[velocity[0]*.35+Math.cos(angle)*speed,1.5+Math.min(4,Math.abs(velocity[1]))*.7,velocity[2]*.35+Math.sin(angle)*speed],radius);}}
 emitBreaking(dt){const s=this.sim;const n=s.n;for(let k=0;k<96;k++){const i=this.scan++%(n*n),x=i%n,z=Math.floor(i/n);if(x<3||z<3||x>n-4||z>n-4)continue;const h=s.flow[i*4];if(h<.05||h>2.5)continue;const u=s.flow[i*4+1]/h,v=s.flow[i*4+2]/h,speed=Math.hypot(u,v),eta=j=>s.bed[j]+s.aux[j*4+3]+s.flow[j*4],slope=Math.hypot(eta(i+1)-eta(i-1),eta(i+n)-eta(i-n))/(2*s.dx),froude=speed/Math.sqrt(9.81*h);if(slope<.12||froude<.48||hash(this.serial++)>.35)continue;
   const px=s.origin[0]+(x+.5)*s.dx,pz=s.origin[1]+(z+.5)*s.dx,r=.04+hash(i+this.serial)*.025,volume=4*Math.PI/3*r**3,up=Math.min(3.5,Math.sqrt(9.81*h)*slope*3);if(s.queueTransfer(px,pz,-volume,0,[-volume*u,-volume*v]))this.add('water',[px,eta(i)+.04,pz],[u,up+.4,v],r);
  }
 }
 step(dt,balls){const sim=this.sim,items=this.items;this.emitBreaking(dt);
  for(const p of items){p.dormant=!sim.contains(p.position[0],p.position[2]);if(p.dormant)continue;p.age+=dt;p.previous=p.position.slice();const s=sim.sample(p.position[0],p.position[2],false),air=airVelocity(p.position,sim.time,sim.wind,sim.windAngle,sim.jet,sim.turbulence);p.wet=clamp(p.wet+(p.position[1]-p.radius<s.surface&&s.h>.01?dt*4:-dt*.008),0,1);p.velocity[1]-=9.81*dt;
   const windDrag=p.kind==='water'?.12:.035*(1-.9*p.wet);for(let j=0;j<3;j++){const k=dt*windDrag*Math.abs(air[j]-p.velocity[j]);p.velocity[j]=(p.velocity[j]+k*air[j])/(1+k);}
   if(p.kind==='sand'&&p.position[1]<s.surface&&s.h>.01){p.velocity[1]+=9.81*1000/1800*dt;const k=dt*4;p.velocity[0]=(p.velocity[0]+k*s.u)/(1+k);p.velocity[2]=(p.velocity[2]+k*s.v)/(1+k);p.velocity[1]/=1+k;}
   for(let j=0;j<3;j++)p.position[j]+=p.velocity[j]*dt;
  }
  // The same friction/cohesion law as test 05, applied only to mobilized sand.
  const grid=new Map(),pairs=[],cell=.3;for(let i=0;i<items.length;i++){const p=items[i];if(p.kind!=='sand'||p.dormant)continue;const c=p.position.map(v=>Math.floor(v/cell));for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const j of grid.get(`${c[0]+x},${c[1]+y},${c[2]+z}`)||[])pairs.push([i,j]);const key=c.join(',');if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);}
  for(let iteration=0;iteration<3;iteration++){
   for(const [i,j] of pairs){const a=items[i],b=items[j],delta=a.position.map((v,k)=>v-b.position[k]),length=Math.hypot(...delta)||1e-6,n=delta.map(v=>v/length),rest=a.radius+b.radius,ma=sedimentProperties(a.wet),mb=sedimentProperties(b.wet),cohesion=ma.cohesion*mb.cohesion;if(length>rest*(1+.25*cohesion))continue;const penetration=rest-length,push=penetration>0?penetration:penetration*cohesion*.24,ia=b.volume/(a.volume+b.volume),ib=1-ia;for(let k=0;k<3;k++){a.position[k]+=n[k]*push*ia;b.position[k]-=n[k]*push*ib;}const relative=a.position.map((v,k)=>(v-a.previous[k])-(b.position[k]-b.previous[k])),vn=relative.reduce((v,x,k)=>v+x*n[k],0),t=relative.map((v,k)=>v-n[k]*vn),scale=Math.min(1,(Math.sqrt(ma.friction*mb.friction)*Math.max(0,penetration)+cohesion*.006)/Math.max(Math.hypot(...t),1e-8));for(let k=0;k<3;k++){a.position[k]-=t[k]*scale*ia;b.position[k]+=t[k]*scale*ib;}}
   for(const p of items){if(p.kind!=='sand'||p.dormant)continue;const s=sim.sample(p.position[0],p.position[2],false);if(this.terrain){const hit=this.terrain.projectSphere(p.position,p.radius);if(hit.contact){const displacement=p.position.map((v,k)=>v-p.previous[k]),normal=displacement.reduce((v,x,k)=>v+x*hit.normal[k],0),mat=sedimentProperties(p.wet);for(let k=0;k<3;k++)p.position[k]-=(displacement[k]-normal*hit.normal[k])*Math.min(.5,mat.friction*.25);}}else if(p.position[1]<s.bed+p.radius){const penetration=s.bed+p.radius-p.position[1],mat=sedimentProperties(p.wet),dx=p.position[0]-p.previous[0],dz=p.position[2]-p.previous[2],f=Math.min(1,mat.friction*penetration/Math.max(Math.hypot(dx,dz),1e-8));p.position[1]=s.bed+p.radius;p.position[0]-=dx*f;p.position[2]-=dz*f;}
    for(const b of balls){const d=p.position.map((v,k)=>v-b.position[k]),length=Math.hypot(...d),overlap=p.radius+b.radius-length;if(overlap>0&&length>1e-6){const pmass=p.volume*1800,share=b.mass/(b.mass+pmass);for(let k=0;k<3;k++){const change=d[k]/length*overlap;p.position[k]+=change*share;b.position[k]-=change*(1-share);b.velocity[k]-=change*(1-share)/dt*.3;}}}
   }
  }
  const alive=[];for(const p of items){if(p.dormant){alive.push(p);continue;}const s=sim.sample(p.position[0],p.position[2],false);if(p.kind==='water'){if(p.age>.07&&(p.position[1]<=s.surface||p.position[1]<=s.bed)){if(sim.queueTransfer(p.position[0],p.position[2],p.volume,0,[p.volume*p.velocity[0],p.volume*p.velocity[2]])){this.revision++;continue;}}}
   else{const damp=Math.exp(-sedimentProperties(p.wet).damping*dt*10);for(let k=0;k<3;k++)p.velocity[k]=(p.position[k]-p.previous[k])/dt*damp;const contact=this.terrain?this.terrain.distance(p.position)<p.radius*.4:p.position[1]<=s.bed+p.radius+.01;if(contact&&!this.terrain){const slope=sim.sample(p.position[0],p.position[2]);p.velocity[0]-=9.81*slope.dx*dt;p.velocity[2]-=9.81*slope.dz*dt;}p.rest=contact&&Math.hypot(...p.velocity)<.25?p.rest+dt:0;if(p.rest>.7&&Math.abs(p.position[1]-s.bed-p.radius)<.08&&sim.queueTransfer(p.position[0],p.position[2],0,p.volume)){this.revision++;continue;}}
   // Dormant material is retained when outside the active tile, never deleted.
   alive.push(p);
  }this.items=alive;
 }
 updateTexture(){const height=2**Math.ceil(Math.log2(Math.max(1,Math.ceil(this.items.length*2/256))));if(height*256>this.capacity){this.texture?.dispose();this.capacity=height*256;this.data=new Float32Array(this.capacity*4);this.texture=new THREE.DataTexture(this.data,256,height,THREE.RGBAFormat,THREE.FloatType);}this.items.forEach((p,i)=>{this.data.set([...p.position,p.radius],i*8);this.data.set([...p.velocity,p.kind==='water'?2:p.wet],i*8+4);});this.texture.needsUpdate=true;}
 get sandVolume(){return this.items.filter(p=>p.kind==='sand').reduce((v,p)=>v+p.volume,0);}
}
