// Visual tracers sample the chemical heat and smoke flux. They carry no fuel:
// changing the draw budget cannot change temperature, oxygen or fracture.
export const PLUME_LIMIT = 224;
const tick = 1 / 40;
const axes = ['x','y','z'];

// Nearby burning fragments feed a common flame. Share heat and burning area
// across 0.6 m lattice cells, with a continuous kernel at each cell boundary.
function sizeFlames(sources) {
 const grid=new Map();
 const footprints=sources.map(({site,power})=>{
  const pos=axes.map(key=>site.position[key]/.6), cell=pos.map(Math.floor);
  const frac=pos.map((value,i)=>value-cell[i]);
  const area=site.area??Math.PI*site.radius**2, footprint=[];
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){
   const weight=(x?frac[0]:1-frac[0])*(y?frac[1]:1-frac[1])*(z?frac[2]:1-frac[2]);
   if(!weight)continue;
   const key=[cell[0]+x,cell[1]+y,cell[2]+z].join(',');
   let sum=grid.get(key);
   if(!sum){sum={power:0,area:0};grid.set(key,sum);}
   sum.power+=weight*power;sum.area+=weight*area;
   footprint.push({sum,weight});
  }
  return footprint;
 });
 for(let i=0;i<sources.length;i++){
  let power=0,area=0,kernel=0;
  for(const {sum,weight} of footprints[i]){
   power+=sum.power*weight;area+=sum.area*weight;kernel+=weight*weight;
  }
  // Normalize the gathered footprint so moving a single fire past a lattice
  // corner or subdividing it in place preserves its apparent size.
  sources[i].size=Math.max(.035,Math.min(.48,.065+.13*Math.sqrt(power/(kernel*1e5)),.85*Math.sqrt(area/(kernel*Math.PI))));
 }
}

function sourcePoint(site, rand, sim, time) {
 const radius = Math.min(.85, Math.max(.025,site.radius));
 // Several tongues feed from slowly moving patches, with fine scatter
 // inside each patch. A new tracer continues a thread already in flight.
 const thread=Math.floor(rand()*3),phase=time*2.2+thread*2.39996+site.position.z;
 const angle=phase+.32*(rand()-.5),spread=radius*(.14+.28*thread)*(.86+.28*rand());
 const body=site.record?.body;
 const origin=body?site.local.clone().multiplyScalar(site.record.field.scale)
  .applyQuaternion(body.rotation()).add(body.translation()):site.position;
 const x=origin.x+Math.cos(angle)*spread,z=origin.z+Math.sin(angle)*spread;
 let y=origin.y;
 if (site.record && !site.mark) {
  // Find the exposed upper skin of this material. Composite sculpts can have
  // cavities, and the thermal samples themselves typically lie inside them.
  const record=site.record, ray=new sim.R.Ray({x,y:y+2*radius+.15,z},{x:0,y:-1,z:0});
  let distance=Infinity, closest=null, gap=Infinity;
  for(const i of site.colliderIndices){
   const shape=record.body.collider(i),limit=4*radius+.3;
   const t=shape.castRay(ray,limit,false);
   if(typeof t==='number'&&t>=0&&t<=limit){distance=Math.min(distance,t);continue;}
   if(distance<Infinity)continue;
   const p=shape.projectPoint(ray.origin,false)?.point;
   if(p){const d=(p.x-x)**2+(p.y-ray.origin.y)**2+(p.z-z)**2;if(d<gap){gap=d;closest=p;}}
  }
  if(distance<Infinity)y=ray.origin.y-distance;
  else if(closest)return [closest.x,closest.y+.004,closest.z];
 }else if(site.group)y+=radius*.65;
 return [x,y+.004,z];
}

export class CombustionPlume {
 constructor(seed=7213){
  this.seed=seed>>>0;this.time=0;this.clock=0;this.version=0;
  this.particles=[];this.sources=[];this.credit=[0,0];this.totals=[0,0];
 }
 random(){this.seed=(Math.imul(1664525,this.seed)+1013904223)>>>0;return this.seed/4294967296;}
 setSources(nodes){
  this.sources.length=0;this.totals.fill(0);
  for(const site of nodes){
   if(!(site.burning>0)||site.submerged)continue;
   const power=site.burning*site.material.fuelEnergy;
   this.totals[0]+=power;
   this.totals[1]+=site.burning*site.material.smokeYield;
   this.sources.push({site,power,end:[...this.totals]});
  }
  if(this.sources.length)sizeFlames(this.sources);
  for(let k=0;k<2;k++)if(!this.totals[k])this.credit[k]=0;
 }
 emit(kind,sim){
  const pick=this.random()*this.totals[kind];
  let lo=0,hi=this.sources.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(this.sources[mid].end[kind]>pick)hi=mid;else lo=mid+1;}
  const {site,size}=this.sources[lo];
  // Chemistry is refreshed at 8 Hz. A body may have melted or fractured since
  // then. Emitted wisps outlive their source without querying a removed body.
  if(site.record&&(!site.record.body.isValid()||!site.record.field.sites.includes(site)))return;
  const [x,y,z]=sourcePoint(site,()=>this.random(),sim,this.time);
  const phase=this.random()*6.283, jitter=.78+.46*this.random();
  this.particles.push({kind,x,y,z,vx:0,vy:(kind?.9:1.6)*Math.sqrt(size)*jitter,vz:0,
   age:0,life:(kind?2.5+this.random()*1.8:.40+this.random()*.30)*(.75+.7*Math.sqrt(size)),
   size:size*jitter,phase,prev:[x,y,z],tail:[x,y,z]});
 }
 step(dt,wind,sim){
  if(!this.sources.length&&!this.particles.length){this.clock=0;return;}
  this.clock+=dt;
  while(this.clock+1e-9>=tick){
   this.clock-=tick;this.time+=tick;const t=this.time;
   const heading=wind.heading*Math.PI/180, wx=Math.cos(heading), wz=Math.sin(heading);
   const speed=Math.max(0,wind.speed);
   for(let k=0;k<2;k++){
    const flux=this.totals[k],rate=k?34*flux/(flux+.0018):68*flux/(flux+9000);
    this.credit[k]+=rate*tick;
    while(this.credit[k]>=1-1e-10){
     this.credit[k]=Math.max(0,this.credit[k]-1);if(this.particles.length<PLUME_LIMIT)this.emit(k,sim);
    }
   }
   let count=0;
   for(const p of this.particles){
    p.age+=tick;if(p.age>=p.life)continue;
    const smoke=p.kind===1, u=p.age/p.life;
    const curl=Math.sin(4*p.y-4.8*t+1.4*p.x+.7*p.z)+.42*Math.sin(6.5*t-3*p.z+p.phase);
    const rise=Math.sqrt(p.size)*(smoke?2.8-1.45*u:4.1+.55*Math.sin(7*t+p.phase));
    const roll=2.9*t-2.1*(p.x*wx+p.z*wz)+p.y*1.8;
    const eddy=Math.sqrt(p.size)*(smoke?1.35:.85);
    const drift=speed*(smoke?.48:.33)+eddy*Math.cos(roll), swirl=Math.sqrt(p.size)*(smoke?1.15:1.5)*curl;
    const response=1-Math.exp(-tick*(smoke?1.9:5));
    p.vx+=(wx*drift-wz*swirl-p.vx)*response;
    p.vz+=(wz*drift+wx*swirl-p.vz)*response;
    p.vy+=(rise+eddy*Math.sin(roll)+.17*Math.sin(t*3.8+p.z)-p.vy)*response;
    const trail=smoke?.17:.40;
    for(let i=0;i<3;i++){
     p.tail[i]+=(p.prev[i]-p.tail[i])*trail;
     p.prev[i]+=(p[axes[i]]-p.prev[i])*trail;
    }
    p.x+=p.vx*tick;p.y+=p.vy*tick;p.z+=p.vz*tick;
    this.particles[count++]=p;
   }
   this.particles.length=count;this.version++;
  }
 }
}
