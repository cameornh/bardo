import {Quaternion,Vector3} from 'three';
import {activeMass,heat,phaseState,surfaceState} from './material-reactions.js';
import {seedMatter} from './loose-matter.js';
import {separateMeltRegions,structureBody} from './fracture.js';

// Two interior reservoirs per connected material volume. The skin and the
// interior have separate heat capacities and share the same latent-heat law.
export function conductInterior(a,dt,peer=null,area=a.area){
 const b=peer?.core??a.core,from=peer?a.core:a;
 const ka=from.material.thermalConductivity,kb=b.material.thermalConductivity;
 if(from.t===b.t||ka<=0||kb<=0)return;
 const conductance=area/(a.depth/ka+(peer?peer.depth/kb:0));
 const ca=activeMass(from)*from.material.heatCapacity,cb=activeMass(b)*b.material.heatCapacity;
 const capacity=ca*cb/(ca+cb),energy=(from.t-b.t)*capacity*(-Math.expm1(-dt*conductance/capacity));
 heat(from,-energy,dt);heat(b,energy,dt);
}

function fused(zone){
 const m=zone[0].material,liquidH=m.meltingPoint*m.heatCapacity+m.latentHeat;
 let surplus=0;
 for(const s of zone){
  surplus+=activeMass(s)*(s.h-liquidH);
  if(s.core){
   if(s.core.melt<1)return false;
   surplus+=activeMass(s.core)*(s.core.h-liquidH);
  }
 }
 return surplus>=0;
}

function zoneOf(node,r){
 // Locate an occupied voxel by one of its constituent boxes. Its centroid
 // alone can lie in empty space on a curved or concave painted region.
 const sample=node.shapes[0].center,field=r.field;
 for(let i=0;i<field.shapes.length;i++){
  const box=field.shapes[i];
  if(box.materialId===node.material.id&&box.half&&sample.every((x,k)=>Math.abs(x-box.center[k])<=box.half[k]+1e-6))return field.mapping[i];
 }
 return field.mapping.find(zone=>zone[0].material.id===node.material.id);
}

function emit(sim,r,zone,available){
 const m=zone[0].material,liquid={...m,phase:'liquid',liquidity:1,fromSolid:true};
 if(m.waterContent>.5){
  const water=sim.materialWorld.palette.get('water');
  if(water)for(const prop of ['color','ior','roughness','scattering','absorption','opacity'])
   liquid[prop]=water[prop];
 }
 const shapes=r.field.shapes.filter((_,i)=>r.field.mapping[i]===zone);
 const samples=zone.flatMap(s=>s.core?[s,s.core]:[s]);
 const mass=samples.reduce((sum,s)=>sum+activeMass(s),0);
 const volume=mass/m.density;
 const count=Math.min(available,32,Math.max(4,Math.ceil(volume/.0006)));
 // Field updates run before the display transform is refreshed. A fast-moving
 // body must release at its current physics pose, including thermal expansion.
 const transform=r.matrix.clone().compose(r.body.translation(),new Quaternion().copy(r.body.rotation()),r.scale.clone().multiplyScalar(r.field.scale));
 const packets=seedMatter(shapes,transform,liquid,count);
 for(const p of packets){p.volume=volume/count;p.radius=.87*Math.cbrt(3*p.volume/(4*Math.PI));}
 const key=r.instance.id+':'+r.part.id,id=key+'/melt/'+(++sim.matter.meltSerial);
 const g=sim.matter.addPackets(sim,key,liquid,packets,false,id);
 g.fromMelt=true;
 const mean=new Vector3(),velocity=new Vector3().copy(r.body.linvel());
 for(const p of packets){p.velocity=new Vector3().copy(r.body.velocityAtPoint(p.position));mean.addScaledVector(p.velocity,1/count);}
 // Match the mean rigid velocity over this material's actual collider volumes.
 const center=new Vector3();let weight=0;
 for(let i=0;i<r.field.mapping.length;i++)if(r.field.mapping[i]===zone){
  const c=r.body.collider(i);center.addScaledVector(c.translation(),c.mass());weight+=c.mass();
 }
 if(weight>0)velocity.copy(r.body.velocityAtPoint(center.divideScalar(weight)));
 for(const p of packets)p.body.setLinvel(p.velocity.add(velocity).sub(mean),true);
 const state=surfaceState(liquid,id,center,4*volume**(2/3),mass);
 state.mass=mass;state.h=0;state.fuel=0;state.water=0;state.bulkWater=0;
 for(const s of samples){
  const share=activeMass(s)/mass;state.h+=s.h*share;state.fuel+=s.fuel*share;
  state.water+=s.water;state.bulkWater+=s.bulkWater;
 }
 Object.assign(state,phaseState(liquid,state.h),{group:g,radius:Math.cbrt(volume)*.4});
 sim.materialWorld.loose.set(id,state);g.thermal=state;
 if(zone.includes(sim.materialWorld.probe))sim.materialWorld.probe=state;
 sim.matter.meltedMass+=mass;
}
function retire(sim,r){
 for(const links of [sim.joints,sim.internalLinks])for(let i=links.length-1;i>=0;i--){
  const l=links[i];if(l.parent!==r&&l.child!==r)continue;
  sim.world.removeImpulseJoint(l.joint,true);links.splice(i,1);sim.broken++;
 }
 if(r.obstacle)sim.parcelObstacles=sim.parcelObstacles.filter(o=>o!==r.obstacle);
 const structure=r.structure;
 if(structure){
  structure.bodies.delete(r);structure.meltRevision=(structure.meltRevision||0)+1;
  for(const i of r.regions)structure.owners[i]=null;
  if(structure.beam)structure.beam.status='melted';
 }
 const key=r.instance.id+':'+r.part.id;
 const hinges=sim.paintedHinges.parts.get(key);
 if(hinges){
  const kept=hinges.filter(h=>{
   const next=structure?structureBody(h.body,h.anchor):null;
   if(!next)return false;
   h.owner=next;h.initialized=false;return true;
  });
  sim.paintedHinges.count-=hinges.length-kept.length;sim.paintedHinges.parts.set(key,kept);sim.paintedHinges.revision++;
 }
 if(sim.drag?.key===r.key)sim.clearDrag();
 sim.pulses=sim.pulses.filter(f=>f.loose||f.key!==r.key);
 if(sim.materialWorld.probe?.record===r)sim.materialWorld.probe=null;
 sim.colliderCount-=r.body.numColliders();sim.bodies.delete(r.key);sim.world.removeRigidBody(r.body);
 if(!structure||!structure.bodies.size)sim.matter.meltedParts.add(key);
}
export function releaseMelt(sim,r){
 const matter=sim.matter;
 if(!r.field.sites.some(s=>s.zone&&s.melt>0)||matter.lastMeltStep===sim.steps)return;
 const zones=new Set(r.field.mapping),ready=new Set([...zones].filter(fused));
 if(!ready.size)return;
 // Reserve space before changing any bonds. A saturated simulation keeps the
 // hot solid intact and retries after existing parcels have left the pool.
 let slots=768-matter.count-(sim.heldChunk?.loose?18:0);
 if(slots<ready.size*4)return;
 let records=[r];
 if(ready.size<zones.size){
  if(!r.structure)return;
  const liquid=new Set(r.regions.filter(i=>ready.has(zoneOf(r.structure.grid.nodes[i],r))));
  if(!liquid.size||liquid.size===r.regions.length)return;
  records=separateMeltRegions(sim,r,liquid,Math.floor(slots/4));
  if(!records.length)return;
 }
 const groups=records.flatMap(piece=>[...new Set(piece.field.mapping)].map(zone=>({piece,zone})));
 for(const [index,{piece,zone}] of groups.entries()){
  const budget=Math.floor(slots/(groups.length-index));
  const before=matter.count;emit(sim,piece,zone,budget);slots-=matter.count-before;
 }
 for(const piece of records)retire(sim,piece);
 matter.lastMeltStep=sim.steps;
 return true;
}
