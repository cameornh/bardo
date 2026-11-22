import {Box3,Vector3} from 'three';
import {CombustionPlume} from './combustion-plume.js';
import {releaseMelt,conductInterior} from './bulk-melt.js';
import {BED_CELL} from './material-bed.js';
import {MaterialAir,clamp} from './material-air.js';
import {surfaceState,heat,addWater,react,exchangePair,chargeNetwork,activeMass,phaseState} from './material-reactions.js';

export const GROUND_FIELD_CELL=.65;
const CELL=GROUND_FIELD_CELL, MAX_GROUND=150, INTERVAL=.125;
const offsets=[[1,0],[-1,0],[0,1],[0,-1]];
const v=()=>new Vector3();
const groundKey=(x,z)=>x+','+z;
function nearest(sites,p,materialId){
 let best=null,distance=Infinity;
 for(const s of sites){if(materialId&&s.material.id!==materialId)continue;
  const d=s.position.distanceToSquared(p);if(d<distance){distance=d;best=s;}}
 return best;
}
function average(sites,k){return sites.reduce((sum,s)=>sum+s[k],0)/sites.length;}
// Redistribute extensive quantities when one skin is split into several.
function splitSkin(oldSites,newSites){
 const shares=new Map(newSites.map(s=>[s,{weight:s.mass,mass:0,remaining:0,energy:0,water:0,bulk:0,fuel:0,charge:0,trapped:0}]));
 for(const old of oldSites){
  let targets=newSites.filter(s=>nearestLocal(oldSites,s)===old);
  if(!targets.length)targets=[nearestLocal(newSites,old)];
  const total=targets.reduce((sum,s)=>sum+shares.get(s).weight,0);
  for(const s of targets){
   const a=shares.get(s),w=a.weight/total,left=activeMass(old)*w;
   a.mass+=old.mass*w;a.remaining+=left;a.energy+=old.h*left;a.water+=old.water*w;
   a.trapped+=(old.trapped||0)*left;a.bulk+=old.bulkWater*w;a.fuel+=old.fuel*left;a.charge+=old.volts*old.area*w;
  }
 }
 for(const [s,a] of shares){
  s.mass=a.mass;s.lost=1-a.remaining/a.mass;s.h=a.energy/a.remaining;s.water=a.water;s.bulkWater=a.bulk;
  s.trapped=a.trapped/a.remaining;s.fuel=a.fuel/a.remaining;s.volts=a.charge/s.area;Object.assign(s,phaseState(s.material,s.h));
 }
}
function nearestLocal(sites,target){
 let best=sites[0],d=Infinity;
 for(const s of sites){const gap=s.local.distanceToSquared(target.local);if(gap<d){best=s;d=gap;}}
 return best;
}
// Two material samples along the longest dimension of each occupied material.
// These travel with the body. Ground tiles and the atmosphere live in world space.
export class MaterialWorld {
 constructor(materials){this.palette=new Map(materials.map(m=>[m.id,m]));this.air=new MaterialAir();this.plume=new CombustionPlume();this.tiles=new Map();this.loose=new Map();this.clock=0;this.version=0;this.nodes=[];this.edges=[];this.probe=null;this.activeCircuit=false;}
 bind(record,shapes){
  // Keep disconnected pieces of one material electrically separate even when
  // they belong to one rigid body (for example, two traces in an insulator).
  const pieces=shapes.map((shape,index)=>{
   const center=v().fromArray(shape.center).multiply(record.scale);
   const half=v().fromArray(shape.half||[shape.radius,shape.radius+(shape.halfHeight||0),shape.radius]).multiply(record.scale);
   return {index,material:this.palette.get(shape.materialId),box:new Box3(center.clone().sub(half),center.clone().add(half))};
  });
  const parent=pieces.map(p=>p.index),interfaces=[],ordered=[...pieces].sort((a,b)=>a.box.min.x-b.box.min.x);
  const root=index=>{while(parent[index]!==index){parent[index]=parent[parent[index]];index=parent[index];}return index;};
  for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
   const a=ordered[i],b=ordered[j];
   if(b.box.min.x>a.box.max.x+1e-5)break;
   const lo=a.box.min.clone().max(b.box.min),hi=a.box.max.clone().min(b.box.max);
   const span=hi.clone().sub(lo).toArray().sort((x,y)=>y-x);
   if(span[2]<-1e-5||span[1]<=1e-5)continue;
   if(a.material===b.material)parent[root(a.index)]=root(b.index);
   else interfaces.push({i:a.index,j:b.index,point:lo.add(hi).multiplyScalar(.5),area:span[0]*span[1]});
  }
  const groups=new Map(),sites=[],pairs=[],mapping=[];
  for(const p of pieces){
   const id=root(p.index);
   if(!groups.has(id))groups.set(id,{material:p.material,box:new Box3(),indices:[],volume:0,mass:0});
   const g=groups.get(id),collider=record.body.collider(p.index);
   g.box.union(p.box);g.indices.push(p.index);
   g.volume+=collider.volume();g.mass+=collider.mass();
  }
  for(const [id,{material:m,box,indices,volume,mass}] of groups){
   const extent=box.getSize(v()),axis=extent.x>=extent.y&&extent.x>=extent.z?0:extent.y>=extent.z?1:2;
   const area=Math.max(.002,Math.min(2*(extent.x*extent.y+extent.z*(extent.x+extent.y)),6*volume**(2/3)))/2;
   const group=[-1,1].map(sign=>{
    const local=box.getCenter(v());local.setComponent(axis,local.getComponent(axis)+sign*.30*extent.getComponent(axis));
    const s=surfaceState(m,record.key+'/'+id+'/'+sign,v(),area,Math.min(volume*.5,area*.008)*m.density);
    if(record.part && mass>0){
     const halfMass=mass*.5;
     const skinFraction=Math.min(1,area*.008/(volume*.5));
     s.mass=halfMass*skinFraction;s.water=m.moisture*s.mass;s.bulkWater=m.waterContent*s.mass;
     if(skinFraction<1){
      const core=surfaceState(m,s.key+'/core',v(),area,halfMass-s.mass);
      core.mass=halfMass-s.mass;core.water=0;core.bulkWater=m.waterContent*core.mass;core.local=local.clone();
      s.core=core;s.depth=Math.max(.008,volume/(2*area));
     }
    }
    s.colliderIndices=indices;s.local=local;s.record=record;s.radius=Math.sqrt(area/Math.PI);
    sites.push(s);return s;
   });
   if(record.part)for(const site of group)site.zone=group;
   pairs.push([group[0],group[1],area*.4]);for(const i of indices)mapping[i]=group;
  }
  for(const {i,j,point,area} of interfaces)pairs.push([nearestLocal(mapping[i],{local:point}),nearestLocal(mapping[j],{local:point}),area]);
  record.field={sites,pairs,mapping,shapes,scale:1,rest:shapes.map((_,i)=>{
   const c=record.body.collider(i);return {center:v().copy(c.translationWrtParent()),mass:c.mass()};
  })};
  this.positionBody(record);
 }
 attachMarks(record,hinges){
  for(const {mark,owner} of hinges||[]){
   const base=owner.field.sites;
   const m=this.palette.get(mark.materialId);if(!m)continue;
   const local=new Vector3(...mark.root).multiply(record.scale);
   const position=local.clone().applyQuaternion(record.body.rotation()).add(record.body.translation());
   const host=nearest(base.filter(s=>!s.mark),position);if(!host)continue;
   const area=Math.max(.0001,mark.length**2*mark.width);
   const s=surfaceState(m,record.key+'/mark/'+mark.id,position,area,area*.001*m.density);
   s.local=local;s.record=owner;s.radius=mark.length*.3;s.mark=mark.id;
   base.push(s);owner.field.pairs.push([host,s,area*.04]);
  }
 }
 positionBody(r){const pos=r.body.translation(),rot=r.body.rotation();for(const s of r.field.sites)s.position.copy(s.local).multiplyScalar(r.field.scale).applyQuaternion(rot).add(pos);}
 inherit(prior,records){
  if(!prior)return;
  const fresh=records.flatMap(r=>r.field.sites.map(s=>{s.record=r;return s;}));
  const ids=new Set(fresh.map(s=>s.material.id));
  for(const id of ids){
   const old=prior.sites.filter(s=>!s.mark&&s.material.id===id);
   const next=fresh.filter(s=>s.material.id===id);
   if(old.length){
    splitSkin(old,next);
    // A fracture can leave pieces thinner than the modeled skin. Keep each
    // original interior reservoir represented when remapping to those pieces.
    const cores=old.filter(s=>s.core).map(s=>s.core);
    if(cores.length){
     for(const s of next)if(!s.core){
      s.core=surfaceState(s.material,s.key+'/core',v(),s.area,s.mass);
      s.core.local=s.local.clone();s.depth=.008;
     }
     splitSkin(cores,next.map(s=>s.core));
    }else for(const s of next)delete s.core;
   }
  }
  // Point attachments and electrodes move to exactly one surviving owner.
  for(const s of prior.sites){
   const candidates=records.flatMap(r=>r.field.sites.filter(x=>x.material.id===s.material.id&&!x.mark));
   const host=candidates.sort((a,b)=>a.local.distanceToSquared(s.local)-b.local.distanceToSquared(s.local))[0]
    ?? records.flatMap(r=>r.field.sites).sort((a,b)=>a.local.distanceToSquared(s.local)-b.local.distanceToSquared(s.local))[0];
   if(!host)continue;
   if(s.mark){s.record=host.record;host.record.field.sites.push(s);host.record.field.pairs.push([host,s,s.area*.04]);}
   else if(s.electrode!=null)host.electrode=s.electrode;
   if(this.probe===s)this.probe=s.mark?s:host;
  }
 }
 ground(sim,x,z,create=true,explicit=false,refresh=false){
  for(const bed of sim.matter.beds.values()){const s=bed.thermalAt(x,z);if(s)return s;}
  const i=Math.floor(x/CELL),j=Math.floor(z/CELL),key=groundKey(i,j);
  let tile=this.tiles.get(key);
  if(tile&&refresh&&sim.matter.beds.size){
   let material=sim.groundMaterial;
   for(const bed of sim.matter.beds.values())if(bed.sample(tile.position.x,tile.position.z)>.003)material=bed.material;
   if(material.id!==tile.material.id){
    const replacement=surfaceState(material,tile.key,tile.position,CELL**2);
    Object.assign(replacement,{i,j,radius:tile.radius,electrode:tile.electrode});
    if(this.probe===tile)this.probe=replacement;
    this.tiles.set(key,replacement);tile=replacement;
   }
  }
  if(!tile&&explicit&&this.tiles.size>=MAX_GROUND){
   // The far boundary is an ambient reservoir. Reclaim the least disturbed unpinned tile.
   let victim=null,best=Infinity;
   for(const t of this.tiles.values())if(t!==this.probe&&t.electrode==null){
    const score=Math.abs(t.t-t.material.initialTemperature)+100*t.lost+Math.abs(t.volts)+t.burning*500+t.water/t.mass;
    if(score<best){victim=t;best=score;}
   }
   if(victim)this.tiles.delete(groundKey(victim.i,victim.j));
  }
  if(!tile&&create&&this.tiles.size<MAX_GROUND){
   const p=new Vector3((i+.5)*CELL,0,(j+.5)*CELL);
   p.y=sim.sea?.height(p.x,p.z)??sim.matter.groundHeight(sim,p.x,p.z);
   let material=sim.groundMaterial;
   for(const bed of sim.matter.beds.values())if(bed.sample(p.x,p.z)>.003)material=bed.material;
   tile=surfaceState(material,'ground/'+key,p,CELL**2);tile.i=i;tile.j=j;tile.radius=CELL*.53;this.tiles.set(key,tile);
  }
  return tile;
 }
 liftSkin(tile,sites){
  if(!tile||!sites.length||sites[0].material.id!==tile.material.id)return;
  const original=surfaceState(tile.material,'',tile.position,tile.area,tile.mass);
  const carried=sites.reduce((total,s)=>total+s.mass,0);
  const fraction=Math.min(1,tile.mass/carried);
  // A scoop carries the exposed skin. Deeper material and the newly exposed
  // ground start at the bulk material's authored conditions.
  for(const s of sites){
   s.lost=tile.lost*fraction;
   s.trapped=(tile.trapped||0)*(1-tile.lost)*fraction/(1-s.lost);
   s.h=(tile.h*(1-tile.lost)*fraction+original.h*(1-fraction))/(1-s.lost);
   s.water=s.mass*(tile.water/tile.mass*fraction+tile.material.moisture*(1-fraction));
   s.bulkWater=s.mass*(tile.bulkWater/tile.mass*fraction+tile.material.waterContent*(1-fraction));
   s.fuel=(tile.fuel*(1-tile.lost)*fraction+original.fuel*(1-fraction))/(1-s.lost);
   Object.assign(s,phaseState(s.material,s.h));
  }
  const removed=Math.min(1,carried/tile.mass),lost=tile.lost*(1-removed);
  tile.trapped=(tile.trapped||0)*(1-tile.lost)*(1-removed)/(1-lost);
  tile.h=(tile.h*(1-tile.lost)*(1-removed)+original.h*removed)/(1-lost);
  tile.fuel=(tile.fuel*(1-tile.lost)*(1-removed)+original.fuel*removed)/(1-lost);
  tile.water+=(original.water-tile.water)*removed;tile.bulkWater+=(original.bulkWater-tile.bulkWater)*removed;
  tile.lost=lost;Object.assign(tile,phaseState(tile.material,tile.h));
 }
 collectLoose(sim){
  for(const [key,g] of sim.matter.parts){
   if(!g.packets.length)continue;
   let s=this.loose.get(key);const center=v();let volume=0;
   for(const p of g.packets){center.addScaledVector(p.position,p.volume);volume+=p.volume;}
   center.divideScalar(volume);
   if(g.material.phase==='gas'){
    if(!g.dispersed){
     const air=this.air.at(center);
     if(air){const kg=volume*g.material.density;air.water+=kg*g.material.waterContent;air.vapour+=kg*(1-g.material.waterContent);air.heat+=kg*g.material.heatCapacity*(g.material.initialTemperature-this.air.temperature);g.dispersed=true;}
    }
    continue;
   }
   if(!s){
    const area=4*volume**(2/3);s=surfaceState(g.material,key,center,area,Math.min(volume,area*.008)*g.material.density);
    if(g.skin?.length){
     s.local=v();splitSkin(g.skin,[s]);
     s.electrode=g.skin.find(site=>site.electrode!=null)?.electrode??null;
     if(g.skin.includes(this.probe))this.probe=s;
     delete g.skin;
    }else if(g.sourceTile){this.liftSkin(g.sourceTile,[s]);delete g.sourceTile;}
    this.loose.set(key,s);
   }
   s.position.copy(center);s.group=g;s.radius=Math.cbrt(volume)*.4;
   g.surfaceMoisture=clamp(s.water/s.mass,0,1);
  }
  for(const [key,s] of this.loose)if(!sim.matter.parts.get(key)?.packets.length){
   if(s.group?.thermal){if(this.probe===s)this.probe=null;this.loose.delete(key);continue;}
   const tile=this.ground(sim,s.position.x,s.position.z,true,false,true);
   if(tile){
    const ct=activeMass(tile)*tile.material.heatCapacity,cs=activeMass(s)*s.material.heatCapacity;
    const shared=cs/(cs+ct);
    if(s.material.id===tile.material.id){
     tile.h+=(s.h-tile.h)*shared;tile.fuel+=(s.fuel-tile.fuel)*shared;
     Object.assign(tile,phaseState(tile.material,tile.h));
    }else heat(tile,(s.t-tile.t)*ct*shared);
    tile.water+=s.water;if(s.electrode!=null)tile.electrode=s.electrode;
    if(this.probe===s)this.probe=tile;}
   this.loose.delete(key);
  }
 }
 target(sim,hit){
  if(hit.bedMaterial){const site=sim.matter.beds.get(hit.bedMaterial)?.thermalAt(hit.point.x,hit.point.z,true);if(site)return site;}
  if(hit.mark){const owner=sim.bodies.get(hit.bodyKey)??sim.get(hit.instanceId,hit.partId);const s=owner?.field.sites.find(s=>s.mark===hit.mark.id);if(s)return s;}
  if(hit.loose&&!hit.bedMaterial){this.collectLoose(sim);
   if(hit.looseGroup&&this.loose.has(hit.looseGroup))return this.loose.get(hit.looseGroup);
   const s=nearest([...this.loose.values()].filter(s=>s.group.key===hit.looseKey),hit.point);if(s)return s;}
  const r=hit.chunk??sim.bodies.get(hit.bodyKey)??sim.get(hit.instanceId,hit.partId);
  if(r?.field&&!hit.bedMaterial)return nearest(r.field.sites,hit.point,hit.materialId)||nearest(r.field.sites,hit.point);
  return this.ground(sim,hit.point.x,hit.point.z,true,true);
 }
 apply(s,tool,strength=1){
  if(!s)return false;this.probe=s;const level=clamp(strength,.01,5);
  if(tool==='heat'||tool==='cool')heat(s,(tool==='heat'?6e5:-6e5)*s.area*level);
  else if(tool==='bulkHeat'||tool==='bulkCool'){
   if(!s.zone&&!s.deposit&&!s.group)return false;
   const dose=(tool==='bulkHeat'?1:-1)*400000*level;
   for(const site of s.zone??[s]){
    heat(site,dose*activeMass(site));
    if(site.core)heat(site.core,dose*activeMass(site.core));
   }
  }
  else if(tool==='wet')addWater(s,level*.8*s.area);
  else if(tool==='positive'||tool==='return'||tool==='unpin'){s.electrode=tool==='unpin'?null:tool==='return'?0:48*level;this.activeCircuit=true;}
  this.version++;return true;
 }
 heatVolumeOver(record,material,joulesPerKg,duration){
  if(!record||duration<=0)return;
  (this.heaters??=[]).push({instance:record.instance.id,part:record.part.id,material,
   remaining:duration,power:joulesPerKg/duration});
 }
 step(sim,dt){
  this.plume.step(dt,sim.wind,sim);
  this.clock+=dt;if(this.clock<INTERVAL-1e-8)return;this.clock-=INTERVAL;
  if(sim.matter.beds.size)for(const t of this.tiles.values())this.ground(sim,t.position.x,t.position.z,false,false,true);
  if(this.heaters?.length){
   for(const heater of this.heaters){
    const duration=Math.min(heater.remaining,INTERVAL);
    for(const r of sim.bodies.values())if(r.instance.id===heater.instance&&r.part.id===heater.part){
     for(const s of r.field.sites)if(s.material.id===heater.material&&!s.mark){
      heat(s,heater.power*duration*activeMass(s),duration);
      if(s.core)heat(s.core,heater.power*duration*activeMass(s.core),duration);
     }
    }
    heater.remaining-=duration;
   }
   this.heaters=this.heaters.filter(h=>h.remaining>0);
  }
  this.collectLoose(sim);
  const nodes=[],edges=[],byBody=new Map(),seen=new Set();
  const link=(a,b,area)=>{if(!a||!b||a===b)return;const k=a.key<b.key?a.key+'|'+b.key:b.key+'|'+a.key;if(seen.has(k))return;seen.add(k);edges.push({a,b,area:Math.max(.00001,area)});};
  const bodies=[...sim.bodies.values(),...sim.chunks.values()].filter(r=>r.field);
  for(const r of bodies){this.positionBody(r);byBody.set(r.body.handle,r);
   nodes.push(...r.field.sites);for(const pair of r.field.pairs)link(...pair);}
  nodes.push(...this.loose.values());
  for(const r of bodies){
   const b=r.body;
   for(let i=0;i<b.numColliders();i++){
    const c=b.collider(i),sites=r.field.mapping[i];if(!sites)continue;
    const contactWith=other=>{
     const peer=byBody.get(other.parent()?.handle);
     if(peer&&peer===r)return;
     if(!peer&&other.parent()?.handle!==sim.ground.handle)return;
     const contact=c.contactCollider(other,.003);if(!contact)return;
     // A half-space stays in the broad phase at every altitude. Its world
     // surface is y=0, so reject separated support points explicitly.
     if(other.handle===sim.flatFloor?.handle&&contact.point1.y>.003)return;
     const a=nearest(sites,contact.point1),p=contact.point2;
     let peerSites;
     if(peer){for(let j=0;j<peer.body.numColliders();j++)if(peer.body.collider(j).handle===other.handle){peerSites=peer.field.mapping[j];break;}}
     const next=peer?nearest(peerSites||peer.field.sites,p):this.ground(sim,p.x,p.z);
     link(a,next,.14*Math.min(a.area,next?.area??1));
    };
    sim.world.contactPairsWith(c,contactWith);
    // Rapier omits fixed/fixed manifolds. Query its broad phase and then the
    // actual shape distance, so anchored samples can still conduct on contact.
    if(b.isFixed()){
     const shape=r.field.shapes[i],size=shape.half||[shape.radius,shape.radius+(shape.halfHeight||0),shape.radius];
     const radius=v().fromArray(size).multiply(r.scale).length()*r.field.scale+.003;
     sim.world.collidersWithAabbIntersectingAabb(c.translation(),v().setScalar(radius),other=>{
      if(other.parent()?.isFixed()&&other.parent().handle!==b.handle)contactWith(other);return true;
     });
    }
   }
   if(sim.sea||sim.matter.beds.size)for(const s of r.field.sites){
    const {x,y,z}=s.position,col=sim.sea?null:sim.matter.liquidColumn(sim,x,z);
    s.submerged=sim.sea?y<sim.sea.height(x,z):!!col&&y<col.top&&y>=col.bottom;
    if(s.submerged)link(s,this.ground(sim,x,z),s.area);
   }
  }
  // Reuse the particle broad phase: only real touching parcels bridge a circuit or wick.
  const parcelOwners=new Map();
  for(const s of this.loose.values())for(const p of s.group.packets)parcelOwners.set(p.body.handle,s);
  for(const s of this.loose.values()){
   for(const p of s.group.packets){
    const c=p.body.collider(0);
    sim.world.contactPairsWith(c,other=>{
     const handle=other.parent()?.handle,rigid=byBody.get(handle),loose=parcelOwners.get(handle);
     if(!rigid&&(!loose||loose===s))return;
     const contact=c.contactCollider(other,.003);
     if(contact)link(s,loose??nearest(rigid.field.sites,contact.point2),p.radius**2);
    });
   }
   const bottom=sim.sea?.height(s.position.x,s.position.z)??sim.matter.groundHeight(sim,s.position.x,s.position.z);
   s.submerged=!!sim.sea&&s.position.y<bottom;
   if(s.position.y-s.radius<bottom+.08)link(s,this.ground(sim,s.position.x,s.position.z),s.area*.25);
  }
  for(const t of [...this.tiles.values()]){
   const active=Math.abs(t.t-t.material.initialTemperature)>4||Math.abs(t.volts)>.25||t.electrode!=null||t.water>t.mass*t.material.moisture+.004;
   for(const [di,dj] of offsets){
    const n=this.ground(sim,(t.i+di+.5)*CELL,(t.j+dj+.5)*CELL,active);
    if(n)link(t,n,CELL*.008);
   }
  }
  nodes.push(...this.tiles.values());
  // Cool sparse deposits in rotating batches. Contacted cells
  // always participate now, including both ends of every electrical edge.
  const deposits=new Set();
  for(const bed of sim.matter.beds.values()){
   const cells=bed.thermalCells,n=Math.min(48,cells.length);
   for(let j=0;j<n;j++){const c=cells[bed.thermalCursor++%cells.length];if(c.h>1e-7)deposits.add(c.thermal);}
  }
  for(const {a,b} of edges){if(a.deposit)deposits.add(a);if(b.deposit)deposits.add(b);}

  for(const s of deposits){
   s.position.y=sim.matter.groundHeight(sim,s.position.x,s.position.z)+s.deposit.h;
   nodes.push(s);
  }
  for(const {a,b,area} of edges)exchangePair(a,b,area,INTERVAL);
  if(this.activeCircuit){
   chargeNetwork(nodes,edges,INTERVAL);
   this.activeCircuit=nodes.some(s=>s.electrode!=null||Math.abs(s.volts)>.0001);
  }
  for(const s of nodes){
   const c=this.air.at(s.position)||{heat:0,water:0,oxygenUsed:0,smoke:0,vapour:0};
   const dt=s.deposit?Math.max(INTERVAL,sim.time-(s.lastExchange??sim.time)):INTERVAL;
   react(s,this.air,c,dt,sim.wind.speed);
   if(s.deposit){
    s.lastExchange=sim.time;
    if(s.lost){s.deposit.h=activeMass(s)/(s.material.density*BED_CELL**2);s.mass=activeMass(s);s.lost=0;sim.matter.beds.get(s.material.id).version++;}
   }else if(s.group?.thermal&&s.lost){
    const remaining=1-s.lost,g=s.group;
    for(const p of g.packets){p.volume*=remaining;p.radius*=Math.cbrt(remaining);const c=p.body.collider(0);c.setRadius(p.radius);c.setMass(p.volume*s.material.density);}
    g.radius=g.packets[0]?.radius??g.radius;s.mass=activeMass(s);s.lost=0;
   }
  }
  this.air.advance(INTERVAL,sim.wind);
  let changedBodies=false;
  for(const r of bodies){
   for(const s of r.field.sites)if(s.core)conductInterior(s,INTERVAL);
   for(const [a,b,area] of r.field.pairs)if(a.core&&b.core)conductInterior(a,INTERVAL,b,area);
   this.mechanics(r);
   if(r.part&&releaseMelt(sim,r))changedBodies=true;
  }
  if(changedBodies){
   const active=new Set(nodes.filter(s=>!s.record));
   for(const r of [...sim.bodies.values(),...sim.chunks.values()])for(const s of r.field?.sites??[])active.add(s);
   for(const s of this.loose.values())active.add(s);
   this.nodes=[...active];this.edges=edges.filter(({a,b})=>active.has(a)&&active.has(b));
  }else{this.nodes=nodes;this.edges=edges;}
  this.plume.setSources(this.nodes);
  this.version++;
 }
 mechanics(r){
  const f=r.field,body=r.body;
  const bonded=f.sites.filter(s=>!s.mark);
  const strength=average(bonded,'strength');
  if(strength<(r.materialStrength??1)-.01)body.wakeUp();
  r.materialStrength=strength;
  // Use one uniform dilation per host, preserving collision volumes and rest
  // offsets. Fine differences in wetting and softening remain per collider.
  const scale=average(bonded,'scale'),resize=Math.abs(scale-f.scale)>.001;
  for(let i=0;i<body.numColliders();i++){
   const sites=f.mapping[i];if(!sites)continue;const s=sites[0],m=s.material,c=body.collider(i);
   const wet=average(sites,'water')/Math.max(.00001,s.area*.08);
   const melt=average(sites,'melt');
   const friction=m.friction*(1-.38*clamp(wet,0,1))*(1-.86*melt);
   if(Math.abs(c.friction()-friction)>.005)c.setFriction(friction);
   const restitution=m.restitution*(1-.85*melt);if(Math.abs(c.restitution()-restitution)>.005)c.setRestitution(restitution);
   if(!resize)continue;
   const shape=f.shapes[i],type=c.shapeType();
   if(shape&&type===1)c.setHalfExtents(v().fromArray(shape.half).multiply(r.scale).multiplyScalar(scale));
   else if(shape&&(type===0||type===2)){c.setRadius(shape.radius*r.scale.x*scale);if(type===2)c.setHalfHeight(shape.halfHeight*r.scale.y*scale);}
   else if(type===9){
    const rest=f.rest[i];rest.vertices??=c.vertices();rest.indices??=c.indices();
    c.setShape(new c.shape.constructor(rest.vertices.map(x=>x*scale),rest.indices));
   }
   c.setTranslationWrtParent(f.rest[i].center.clone().multiplyScalar(scale));
   c.setMass(f.rest[i].mass);
  }
  if(r.structure&&(r.fieldStrength||bonded.some(s=>s.strength<.9999))){
   r.fieldStrength??=new Map();
   for(const i of r.regions){const n=r.structure.grid.nodes[i],p=v().fromArray(n.center);
    let best=Infinity,factor=1,char=0;
    for(const s of bonded)if(s.material.id===n.material.id){const d=p.distanceToSquared(s.local);if(d<best){best=d;factor=s.strength;char=s.material.fuelEnergy>0?1-s.fuel:0;}}
    r.fieldStrength.set(i,factor);
    if(char>0||r.fieldChar){r.fieldChar??=new Map();r.fieldChar.set(i,char);}
   }
  }
  if(resize){f.scale=scale;body.wakeUp();}
 }
}
