import { SAND_MATERIAL } from './sand-material.js';
import { Terrain } from './terrain.js';

export const GRAIN_STEP=1/60;
export const GRAIN_MATERIALS=[
 {name:'Gravel',radius:.15,friction:.75,cohesion:0,damping:.015,color:[.26,.26,.245],roughness:.8},
 {name:'Sand',radius:.10,friction:.55,cohesion:0,damping:.025,color:[...SAND_MATERIAL.color],roughness:SAND_MATERIAL.dryRoughness},
 {name:'Mud',radius:.12,friction:.35,cohesion:.55,damping:.16,color:[.19,.115,.06],roughness:.22},
];
// Coarse equal-mass parcels per material, with position-level Coulomb friction
// and short-range cohesive contacts. Mud is a wet-soil proxy, not a pore-fluid solve.
export class Granular {
 constructor(){
  this.terrain=new Terrain();this.capacity=1400;this.enabled=false;
  for(const key of ['positions','previous','velocities','predicted','normals'])this[key]=new Float32Array(this.capacity*3);
  for(const key of ['radius','mass','kind','foam','temperature','density'])this[key]=new Float32Array(this.capacity);
  this.time=0;this.contacts=0;this.simMs=0;this.spacing=.24;this.reset();
 }
 reset(){
  this.count=0;this.time=0;this.velocities.fill(0);this.temperature.fill(20);this.density.fill(1);this.normals.fill(0);
  for(let kind=0;kind<3;kind++){
   const material=GRAIN_MATERIALS[kind],r=material.radius,spacing=r*2.07;
   for(let y=r+.4;y<1.8;y+=spacing)for(let z=-.72;z<.8;z+=spacing)for(let x=-.72;x<.8;x+=spacing){
    if(Math.hypot(x,z)>.85)continue;
    const i=this.count++,o=i*3,seed=Math.sin(i*97.31)*.012;
    this.positions.set([(kind-1)*3+x+seed,y,z-seed],o);this.radius[i]=r;this.mass[i]=1800*4/3*Math.PI*r**3;this.kind[i]=kind;this.normals[o+1]=1;
   }
  }
  this.counts=GRAIN_MATERIALS.map((_,kind)=>Array.from(this.kind.subarray(0,this.count)).filter(k=>k===kind).length);
 }
 pairs(){
  const size=.42,grid=new Map(),p=this.predicted,pairs=[];
  for(let i=0;i<this.count;i++){
   const o=i*3,cx=Math.floor(p[o]/size),cy=Math.floor(p[o+1]/size),cz=Math.floor(p[o+2]/size);
   for(let z=cz-1;z<=cz+1;z++)for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++){
    const cell=grid.get(`${x},${y},${z}`);if(cell)for(const j of cell){const a=j*3,reach=this.radius[i]+this.radius[j]+.045;if((p[o]-p[a])**2+(p[o+1]-p[a+1])**2+(p[o+2]-p[a+2])**2<reach*reach)pairs.push(i,j);}
   }
   const key=`${cx},${cy},${cz}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);
  }
  return pairs;
 }
 step(dt,probe=null){
  if(!this.enabled)return;const start=performance.now(),p=this.predicted,n=this.count;this.contacts=0;
  this.previous.set(this.positions.subarray(0,n*3));
  for(let i=0;i<n;i++){const o=i*3;this.velocities[o+1]-=9.81*dt;for(let k=0;k<3;k++)p[o+k]=this.positions[o+k]+this.velocities[o+k]*dt;}
  const pairs=this.pairs();
  for(let it=0;it<4;it++){
   for(let k=0;k<pairs.length;k+=2){
    const i=pairs[k],j=pairs[k+1],a=i*3,b=j*3,mi=GRAIN_MATERIALS[this.kind[i]],mj=GRAIN_MATERIALS[this.kind[j]];
    let dx=p[a]-p[b],dy=p[a+1]-p[b+1],dz=p[a+2]-p[b+2],d=Math.hypot(dx,dy,dz),rest=this.radius[i]+this.radius[j];
    const cohesive=mi.cohesion*mj.cohesion,range=rest*(1+.25*cohesive);
    if(d>=range)continue;if(d<1e-7){dx=1;dy=dz=0;d=1e-7;}else{dx/=d;dy/=d;dz/=d;}
    const shareI=this.mass[j]/(this.mass[i]+this.mass[j]),shareJ=1-shareI,penetration=rest-d,correction=penetration>0?penetration:penetration*cohesive*.24;
    p[a]+=dx*correction*shareI;p[a+1]+=dy*correction*shareI;p[a+2]+=dz*correction*shareI;p[b]-=dx*correction*shareJ;p[b+1]-=dy*correction*shareJ;p[b+2]-=dz*correction*shareJ;
    // Cancel tangential displacement up to the Coulomb limit. This lets static
    // piles support a slope without continuously damping all free-flight motion.
    const rx=(p[a]-this.previous[a])-(p[b]-this.previous[b]),ry=(p[a+1]-this.previous[a+1])-(p[b+1]-this.previous[b+1]),rz=(p[a+2]-this.previous[a+2])-(p[b+2]-this.previous[b+2]);
    const normal=rx*dx+ry*dy+rz*dz,tx=rx-normal*dx,ty=ry-normal*dy,tz=rz-normal*dz,t=Math.hypot(tx,ty,tz);
    const friction=Math.sqrt(mi.friction*mj.friction),limit=friction*Math.max(0,penetration)+cohesive*.006;
    const scale=Math.min(1,limit/Math.max(t,1e-8));
    p[a]-=tx*scale*shareI;p[a+1]-=ty*scale*shareI;p[a+2]-=tz*scale*shareI;p[b]+=tx*scale*shareJ;p[b+1]+=ty*scale*shareJ;p[b+2]+=tz*scale*shareJ;
   }
   for(let i=0;i<n;i++){
    const o=i*3,r=this.radius[i],mat=GRAIN_MATERIALS[this.kind[i]],point=[p[o],p[o+1],p[o+2]],field=this.terrain.distance(point);
    if(this.terrain.edits.length===0){
     if(p[o+1]<r){const penetration=r-p[o+1],dx=p[o]-this.previous[o],dz=p[o+2]-this.previous[o+2],scale=Math.min(1,mat.friction*penetration/Math.max(Math.hypot(dx,dz),1e-8));p[o+1]=r;p[o]-=dx*scale;p[o+2]-=dz*scale;}
    }else if(field<r){const normal=this.terrain.normal(point),eps=.004,gradient=Math.max(.2,(this.terrain.distance(point.map((v,k)=>v+normal[k]*eps))-field)/eps),penetration=Math.max(0,r-field/gradient);
     if(penetration>0){for(let k=0;k<3;k++)p[o+k]+=normal[k]*penetration;
      const delta=point.map((_,k)=>p[o+k]-this.previous[o+k]),vn=delta.reduce((sum,v,k)=>sum+v*normal[k],0),t=delta.map((v,k)=>v-vn*normal[k]),length=Math.hypot(...t),scale=Math.min(1,mat.friction*penetration/Math.max(length,1e-8));
      for(let k=0;k<3;k++)p[o+k]-=t[k]*scale;
     }
    }
    if(probe?.active){let dx=p[o]-probe.position.x,dy=p[o+1]-probe.position.y,dz=p[o+2]-probe.position.z,d=Math.hypot(dx,dy,dz),rest=r+probe.radius;
     if(d<rest){if(d<1e-7){dx=0;dy=1;dz=0;}else{dx/=d;dy/=d;dz/=d;}
      const mass=this.mass[i],share=probe.mass/(probe.mass+mass),push=(rest-d)*.8;
      p[o]+=dx*push*share;p[o+1]+=dy*push*share;p[o+2]+=dz*push*share;
      const reaction=push*(1-share);probe.position.x-=dx*reaction;probe.position.y-=dy*reaction;probe.position.z-=dz*reaction;
      probe.velocity.x-=dx*reaction/dt;probe.velocity.y-=dy*reaction/dt;probe.velocity.z-=dz*reaction/dt;this.contacts++;
     }
    }
    p[o]=Math.max(-7,Math.min(7,p[o]));p[o+2]=Math.max(-4,Math.min(4,p[o+2]));
   }
  }
  for(let i=0;i<n;i++){const damping=GRAIN_MATERIALS[this.kind[i]].damping;for(let k=0;k<3;k++){const o=i*3+k;this.velocities[o]=(p[o]-this.previous[o])/dt*Math.exp(-damping*dt*10);this.positions[o]=p[o];}}
  probe?.sync();this.time+=dt;this.simMs=performance.now()-start;
 }
 disturb(point){let count=0;for(let i=0;i<this.count;i++){const o=i*3,dx=this.positions[o]-point[0],dz=this.positions[o+2]-point[2],d=Math.hypot(dx,dz);if(d<1.3){const w=1-d/1.3;this.velocities[o]+=dx*3*w;this.velocities[o+1]+=2.8*w;this.velocities[o+2]+=dz*3*w;count++;}}return count;}
}
