import {MaterialBed,BED_CELL} from './material-bed.js';
import {Vector3} from 'three';
import {liquidity} from './physics-data.js';
import {entrainment,SAND_SIDE,SAND_METRES} from './wind-sand.js';

export const looseKind=m=>m.phase==='gas'?0:m.phase==='liquid'||liquidity(m)>=.999?2:m.phase==='granular'?1:0;
const volume=s=>s.type==='box'?8*s.half[0]*s.half[1]*s.half[2]:Math.PI*s.radius**2*(4*s.radius/3+2*(s.halfHeight||0));
const frac=x=>x-Math.floor(x);
// Stratified volume sampling of the carved collider. One authored part can
// contain several materials. Mass is apportioned by occupied volume.
export function seedMatter(shapes,matrix,material,count){
 const volumes=shapes.map(volume),total=volumes.reduce((a,b)=>a+b,0),out=[];
 const massVolume=total*Math.abs(matrix.determinant())/count;
 const radius=Math.cbrt(massVolume*.23873)*.87;
 let shape=0,edge=volumes[0];
 for(let i=0;i<count;i++){
  const target=(i+.5)*total/count;while(shape<shapes.length-1&&target>edge)edge+=volumes[++shape];
  const s=shapes[shape],c=new Vector3(...s.center),half=s.half||[s.radius,s.radius+(s.halfHeight||0),s.radius];
  let q;
  for(let j=0;j<120;j++){
   const n=i+1+j*count;
   q=[frac(n*.754877666),frac(n*.569840291),frac(n*.43857902)].map((v,k)=>(2*v-1)*half[k]);
   if(s.type==='box'||Math.hypot(q[0],Math.max(0,Math.abs(q[1])-(s.halfHeight||0)),q[2])<s.radius)break;
  }
  out.push({position:c.add(new Vector3(...q)).applyMatrix4(matrix),radius,volume:massVolume,material});
 }
 return out;
}
export class LooseMatter{
 constructor(){this.parts=new Map();this.beds=new Map();this.count=0;this.bedTime=0;}
 add(sim,key,shapes,matrix,material,budget){
  return this.addPackets(sim,key,material,seedMatter(shapes,matrix,material,budget));
 }
 addPackets(sim,key,material,packets,groundTool=false){
  if(this.count+packets.length>768)throw Error('This physics preview exceeds the 768 loose parcel budget.');
  const {R,world}=sim,kind=looseKind(material),id=key+'/'+material.id;
  const group={key,material,kind,packets,groundTool,age:0,radius:packets[0].radius};this.parts.set(id,group);
  for(const p of packets){
   const body=world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.position.x,p.position.y,p.position.z)
    .setLinearDamping(kind===2?.8:.3).setAngularDamping(3).lockRotations().setCcdEnabled(true));
   const shape=R.ColliderDesc.ball(p.radius).setMass(p.volume*material.density)
    .setRestitution(.015).setFriction(kind===2?.018:material.friction+.18*material.moisture);
   if(material.phase==='gas'){body.setGravityScale(0,true);body.setLinearDamping(1.8);}
   world.createCollider(shape,body);p.body=body;this.count++;
  }
  return group;
 }
 liquidColumn(sim,x,z){
  let depth=0,densityMass=0;
  for(const bed of this.beds.values())if(bed.liquid){
   const h=bed.sample(x,z);depth+=h;densityMass+=h*bed.material.density;
  }
  if(depth<.001)return null;
  const bottom=this.groundHeight(sim,x,z);return {top:bottom+depth,bottom,density:densityMass/depth};
 }
 groundHeight(sim,x,z){
  let y=(sim.sand?.height(x,z)||0)+(sim.cuts?.offset(x,z)||0);
  for(const bed of this.beds.values())if(!bed.liquid)y+=bed.sample(x,z);
  return y;
 }
 update(sim,dt){
  const {world,sea,wind}=sim;
  const wx=Math.cos(wind.heading*Math.PI/180),wz=Math.sin(wind.heading*Math.PI/180);
  for(const [id,g] of this.parts){
   g.age+=dt;
   const m=g.material,r=g.radius,liquid=g.kind===2;
   const shear=Math.max(0,wind.speed-entrainment(m)),packets=g.packets;
   const pressure=liquid?Math.min(8,3.5/(1+m.viscosity)):0;
   for(let i=packets.length-1;i>=0;i--){
    const p=packets[i],pos=p.position.copy(p.body.translation()),v=p.body.linvel();
    if(m.phase==='gas'){
     if(g.age>=2.4){world.removeRigidBody(p.body);packets.splice(i,1);this.count--;continue;}
     const drag=p.body.mass()*Math.min(.1,dt*2);
     p.body.applyImpulse({x:(wx*wind.speed*.2-v.x)*drag,y:(.45-v.y)*drag,z:(wz*wind.speed*.2-v.z)*drag},true);
     continue;
    }
    const surface=sea?sea.height(pos.x,pos.z):-Infinity;
    if(sea&&m.id===sim.groundMaterial.id&&pos.y<=surface+r*.15){
     if(!g.merged||sim.time-g.merged>.12)sea.splash(pos.x,pos.z,Math.min(1.2,.35+Math.abs(v.y)*.12));
     g.merged=sim.time;sea.mergedVolume=(sea.mergedVolume||0)+p.volume;world.removeRigidBody(p.body);packets.splice(i,1);this.count--;continue;
    }
    let floorContact=false;
    if(!sea&&v.y<.45){
     const gap=pos.y-this.groundHeight(sim,pos.x,pos.z)-r;
     floorContact=gap<=r*.14;
     if(!floorContact&&gap<.38&&Math.abs(v.y)<.2){
      world.contactPairsWith(p.body.collider(0),c=>{if(c.parent()?.handle===sim.ground.handle)floorContact=true;});
     }
    }
    if(floorContact){
     let bed=this.beds.get(m.id);
     if(!bed){bed=new MaterialBed(m,liquid);this.beds.set(m.id,bed);}
     if(bed.add(pos.x,pos.z,p.volume,g.groundTool?'ground:'+m.id:g.key)){
      world.removeRigidBody(p.body);packets.splice(i,1);this.count--;continue;
     }
    }
    // A sinking grain and a submerged pocket of another fluid displace the
    // surrounding water. Only their exposed area receives direct wind load.
    const submerged=Math.max(0,Math.min(1,.5+(surface-pos.y)/(2*r)));
    if(submerged>0){
     const flow=sea.flow(pos.x,pos.z),displaced=p.volume*sim.waterDensity*submerged;
     const drag=Math.min(.4*p.body.mass(),dt*displaced*(2+.45*Math.hypot(flow.x-v.x,flow.y-v.y,flow.z-v.z)));
     p.body.applyImpulse({x:(flow.x-v.x)*drag,y:(flow.y-v.y)*drag-dt*displaced*world.gravity.y,z:(flow.z-v.z)*drag},true);
    }
    if(shear>0&&submerged<1){
     const load=Math.min(25,.00048*shear*shear/Math.max(.045,r))*(liquid?.4:1);
     const impulse=dt*p.body.mass()*load*(1-submerged);
     p.body.applyImpulse({x:wx*impulse,y:impulse*(liquid?.01:.065),z:wz*impulse},true);
    }
    // Short-range lateral pressure prevents a fluid column retaining a bead stack.
    // Pair impulses are equal and opposite; frictional contacts carry granular loads.
    if(!liquid||!pressure)continue;
    for(let j=0;j<i;j++){
     const other=packets[j],q=other.position,dx=pos.x-q.x,dz=pos.z-q.z,h=Math.hypot(dx,dz);
     const d=Math.hypot(h,pos.y-q.y),reach=3.1*r;
     if(d>=reach||h<1e-5)continue;
     const amount=dt*p.body.mass()*pressure*(1-d/reach)/h;
     p.body.applyImpulse({x:dx*amount,y:0,z:dz*amount},true);
     other.body.applyImpulse({x:-dx*amount,y:0,z:-dz*amount},true);
    }
   }
   if(g.groundTool&&!packets.length)this.parts.delete(id);
  }
  this.bedTime+=dt;
  if(this.bedTime+1e-8>=1/20){
   if(this.beds.size){
    const obstacles=[];
    for(const r of sim.bodies.values()){
     const center=r.probeCenter.clone().applyQuaternion(r.body.rotation()).add(r.body.translation());
     obstacles.push({center,radius:r.probeRadius,body:r.body});
    }
    for(const bed of this.beds.values()){
     const floor=(x,z)=>bed.liquid?this.groundHeight(sim,x,z):(sim.sand?.height(x,z)||0)+(sim.cuts?.offset(x,z)||0);
     const obstructed=(i,j)=>{
      const x=i*BED_CELL,z=j*BED_CELL,y=floor(x,z)+.025;
      let hit=false;
      for(const {center,radius,body} of obstacles){
       if(Math.abs(x-center.x)>radius||Math.abs(z-center.z)>radius||Math.abs(y-center.y)>radius)continue;
       for(let k=0;k<body.numColliders();k++)if(body.collider(k).containsPoint({x,y,z})){hit=true;break;}
       if(hit)break;
      }
      return hit;
     };
     bed.advance(this.bedTime,wind,floor,obstacles.length?obstructed:null);
    }
   }
   this.bedTime=0;
  }
 }
 nudge(key,point,force,dt){
  for(const bed of this.beds.values())if(key==='ground:'+bed.material.id||[...this.parts.values()].some(g=>g.key===key&&g.material.id===bed.material.id))bed.push(point,force,dt);
  let total=0;const picked=[];
  for(const group of this.parts.values())if(group.key===key)for(const p of group.packets){
   const w=Math.exp(-p.position.distanceToSquared(point)/(5*p.radius*p.radius));if(w>.01){picked.push([p,w]);total+=w;}
  }
  for(const [p,w] of picked){const scale=dt*w/total;p.body.applyImpulse({x:force.x*scale,y:force.y*scale,z:force.z*scale},true);}
 }
}
// Periodic terrain collision tiles exist around physical bodies, independently
// of the camera. Reuse tiles until the sand bed changes by a measurable amount.
export class DuneContacts{
 constructor(){this.tiles=new Map();this.next=0;this.version=-1;}
 update(sim){
  if(sim.time<this.next)return;this.next=sim.time+.16;
  const n=SAND_SIDE,L=SAND_METRES,needed=new Set(),mark=(p,r)=>{
   for(let x=Math.floor((p.x-r)/L);x<=Math.floor((p.x+r)/L);x++)
    for(let z=Math.floor((p.z-r)/L);z<=Math.floor((p.z+r)/L);z++)needed.add(x+','+z);
  };
  for(const node of sim.cuts?.nodes.values()||[])mark(node,L/n+.01);
  for(const r of sim.bodies.values())mark(r.body.translation(),Math.min(L,1+r.probeRadius));
  for(const c of sim.chunks?.values()||[])mark(c.body.translation(),1);
  for(const g of sim.matter.parts.values())for(const p of g.packets)mark(p.position,p.radius+.5);
  const sand=sim.sand,R=sim.R,scale={x:L,y:1,z:L};
  const solids=[...sim.matter.beds.values()].filter(b=>!b.liquid);
  const version=(sim.cuts?.version||0)+(sand?.version||0)+solids.reduce((n,b)=>n+b.version,0);
  let base;
  for(const key of needed){
   const old=this.tiles.get(key);if(old&&version===this.version)continue;
   const [tx,tz]=key.split(',').map(Number);
   let heights=base;
   if(!heights){heights=new Float32Array((n+1)**2);for(let x=0;x<=n;x++)for(let z=0;z<=n;z++)
    heights[x*(n+1)+z]=sim.matter.groundHeight(sim,tx*L+x*L/n,tz*L+z*L/n);if(!solids.length&&!sim.cuts?.nodes.size)base=heights;}
   if(old)old.setShape(new R.Heightfield(n,n,heights,scale));
   else{const [x,z]=key.split(',').map(Number);
    this.tiles.set(key,sim.world.createCollider(R.ColliderDesc.heightfield(n,n,heights,scale).setTranslation((x+.5)*L,0,(z+.5)*L)
     .setFriction(sim.groundMaterial.friction).setRestitution(sim.groundMaterial.restitution),sim.ground));}
  }
  for(const [key,tile] of this.tiles)if(!needed.has(key)){sim.world.removeCollider(tile,false);this.tiles.delete(key);}
  this.version=version;
 }
}
