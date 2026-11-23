// Moist grains in contact form yielding capillary bridges. Each bridge transfers
// equal and opposite impulses; it never anchors a grain to a point in space.
import {sandMaterial} from '../sand-lab/sand-material.js';

const MAX_CONTACTS=12;
export function capillaryStrength(wet,memory){
 const {adhesion,cohesion,shapeYield,residual}=sandMaterial(wet,memory);
 return {adhesion:adhesion+.38*cohesion,yield:shapeYield+.40*(shapeYield-residual)+.10*cohesion};
}
export class CapillarySand{
 constructor(){this.links=new Map();this.serial=0;this.islands=[];}
 step(groups,dt){
  const grains=[];
  let largest=0;
  for(const g of groups){
   if(!g.capillary)continue;
   const wet=g.surfaceMoisture??g.wet;
   g.memory=Math.max(g.memory??0,wet);
   const strength=capillaryStrength(wet,g.memory);
   for(const p of g.packets){
    p.root=p;p.contacts=0;p.group=g;
    p.adhesion=strength.adhesion;p.yield=strength.yield;
    p.held=!!(p.sphereHeld||g.grip);
    p.position.copy(p.body.translation());p.motion=p.body.linvel();
    p.mass??=p.body.mass();p.serial??=++this.serial;
    largest=Math.max(largest,p.radius);grains.push(p);
   }
  }
  if(!grains.length){this.links.clear();this.islands=[];return;}
  const buckets=new Map(),cell=largest*2.6,root=p=>{
   while(p.root!==p){p.root=p.root.root;p=p.root;}return p;
  };
  // Preserve existing bridges until rupture. Newly touching grains can weld
  // across scoop boundaries, including when one handful lands on another.
  const active=new Set(grains);
  for(const [key,link] of this.links){
   const {a,b}=link,dist=a.position.distanceTo(b.position),span=a.radius+b.radius;
   const adhesion=Math.min(a.adhesion,b.adhesion);
   if(!active.has(a)||!active.has(b)||a.held!==b.held||dist>link.rest+span*(.06+.53*adhesion)||adhesion<.001){
    this.links.delete(key);continue;
   }
   a.contacts++;b.contacts++;root(b).root=root(a);
   if(dist<1e-7)continue;
   const dx=(b.position.x-a.position.x)/dist,dy=(b.position.y-a.position.y)/dist,dz=(b.position.z-a.position.z)/dist;
   const stretch=dist-link.rest,limit=span*(.025+.13*Math.min(a.yield,b.yield));
   if(Math.abs(stretch)>limit)link.rest+=Math.sign(stretch)*(Math.abs(stretch)-limit)*(-Math.expm1(-8*dt));
   const vx=b.motion.x-a.motion.x,vy=b.motion.y-a.motion.y,vz=b.motion.z-a.motion.z;
   const relative=vx*dx+vy*dy+vz*dz,reduced=a.mass*b.mass/(a.mass+b.mass);
   const spring=Math.max(-90,Math.min(90,stretch*1450+relative*19));
   const k=dt*reduced*adhesion;
   const impulse={x:k*(dx*spring+vx*2),y:k*(dy*spring+vy*2),z:k*(dz*spring+vz*2)};
   if(a.body.isSleeping()&&b.body.isSleeping())continue;
   a.body.applyImpulse(impulse,true);b.body.applyImpulse({x:-impulse.x,y:-impulse.y,z:-impulse.z},true);
  }
  for(const a of grains){
   const x=Math.floor(a.position.x/cell),y=Math.floor(a.position.y/cell),z=Math.floor(a.position.z/cell);
   for(let i=x-1;i<=x+1&&a.contacts<MAX_CONTACTS;i++)for(let j=y-1;j<=y+1&&a.contacts<MAX_CONTACTS;j++)
    for(let k=z-1;k<=z+1&&a.contacts<MAX_CONTACTS;k++)for(const b of buckets.get(i+','+j+','+k)??[]){
     if(a.contacts>=MAX_CONTACTS||b.contacts>=MAX_CONTACTS||a.group.material.id!==b.group.material.id||a.held!==b.held)continue;
     const adhesion=Math.min(a.adhesion,b.adhesion),span=a.radius+b.radius;
     if(adhesion<.001||a.position.distanceToSquared(b.position)>span**2*(1+.28*adhesion)**2)continue;
     const key=a.serial>b.serial?a.serial+','+b.serial:b.serial+','+a.serial;
     if(this.links.has(key))continue;
     this.links.set(key,{a,b,rest:span*.98});a.contacts++;b.contacts++;root(b).root=root(a);
    }
   const key=x+','+y+','+z;
   if(!buckets.has(key))buckets.set(key,[]);
   buckets.get(key).push(a);
  }
  const islands=new Map();
  for(const p of grains){
   const parent=root(p);let island=islands.get(parent);
   if(!island){island={id:p.serial,packets:[],material:p.group.material,kind:1,radius:0};islands.set(parent,island);}
   island.id=Math.min(island.id,p.serial);island.radius=Math.max(island.radius,p.radius);island.wet=Math.max(island.wet??0,p.group.surfaceMoisture??p.group.wet);island.packets.push(p);
  }
  this.islands=[...islands.values()];
 }
}
