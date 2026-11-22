// Idle procedural roots need no rigid bodies. A contact or a grab instantiates
// the authored capsules and flexures in the same Rapier world as placed parts.
import {Vector3,Quaternion,Euler,Matrix4} from 'three';
import {flotationSamples,applyEnvironment} from './fluid-forces.js';
import {REED_TILE} from './wetland.js';
import {parcelObstacle} from './parcel-contact.js';
import {anchorRetention} from './attachment-material.js';
import {windAt} from './wind.js';

const rad=Math.PI/180;
export const MAX_ACTIVE_CROWNS=12;
export function reedFamily(library){
 const members=library.families.find(f=>f.id==='example-rushes')?.members??[];
 return members.map(m=>library.assets.find(a=>a.id===m.assetId));
}
export function instancedReed(asset){
 return !!asset?.parts.length&&asset.parts.every(p=>p.stamps.length===1&&p.stamps[0].shape==='capsule'&&p.stamps[0].mode==='add'&&
  p.stamps[0].position.every((v,i)=>Math.abs(v-(i===1?p.stamps[0].size[1]:0))<1e-6)&&p.joint?.type==='flexure'&&p.marks?.every(m=>m.kind==='ribbon')&&p.pivot.every(v=>v===0)&&p.transform.scale.every(v=>v===1));
}
export function reedPartMatrix(p){
 return new Matrix4().compose(new Vector3(...p.transform.position),new Quaternion().setFromEuler(new Euler(...p.transform.rotation.map(v=>v*rad))),new Vector3(1,1,1));
}
export function plantedCrown(instance,variant){
 const [x,y,z]=instance.transform.position;
 return {x,y,z,id:instance.id,variant,yaw:instance.transform.rotation[1]*rad,size:instance.transform.scale[1]};
}
// Roots embedded in sand must not fight the heightfield that anchors them.
// Free sections can strike the bed. Stems slide past their overlapping siblings.
export function stemGroups(p){return p.joint.parentId==='ground'?0x0008fffb:0x0008ffff;}

export class ReedStand{
 constructor(sim,library){
  this.sim=sim;this.library=library;this.assets=reedFamily(library);this.materials=new Map(library.materials.map(m=>[m.id,m]));
  this.planted=library.world.instances.filter(i=>this.assets.some(a=>a?.id===i.assetId));
  this.owners=new Map();
  for(const r of sim.bodies.values())if(this.planted.some(p=>p.id===r.instance.id))this.owners.set(r.body.handle,r.instance.id);
  this.events=new sim.R.EventQueue(true);
  this.hooks={
   filterContactPair:(_c1,_c2,a,b)=>this.owners.has(a)&&this.owners.get(a)===this.owners.get(b)?null:sim.R.SolverFlags.COMPUTE_IMPULSE,
   filterIntersectionPair:()=>true
  };
  this.active=new Map();this.records=new Map();this.tiles=new Map();this.nextSurvey=0;
 }
 eligible(crown){return this.planted.every(i=>Math.hypot(i.transform.position[0]-crown.x,i.transform.position[2]-crown.z)>1.1);}
 activate(site){
  const sim=this.sim,known=this.active.get(site.id);
  if(known){known.last=sim.time;return known;}
  const asset=this.assets[site.variant];if(!instancedReed(asset))return;
  if(this.active.size>=MAX_ACTIVE_CROWNS){
   const stale=[...this.active.values()].filter(s=>sim.time-s.last>2&&s.links.every(l=>sim.joints.includes(l))&&s.records.every(r=>r.key!==sim.drag?.key&&!sim.paintedHinges.parts.get(r.key)?.some(h=>h.cursorForce))).sort((a,b)=>a.last-b.last)[0];
   if(!stale)return;
   this.release(stale);
  }
  const state={site,records:[],links:[],born:sim.time,last:sim.time};
  const im=new Matrix4().makeRotationY(site.yaw).scale(new Vector3().setScalar(site.size)).setPosition(site.x,site.y,site.z);
  const R=sim.R;
  for(const p of asset.parts){
   const matrix=im.clone().multiply(reedPartMatrix(p)),pos=new Vector3(),rot=new Quaternion(),scale=new Vector3();
   matrix.decompose(pos,rot,scale);
   const s=p.stamps[0],m=this.materials.get(s.materialId),size=site.size;
   const body=sim.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x,pos.y,pos.z).setRotation(rot).setAngularDamping(.04).setLinearDamping(.025).setCcdEnabled(true));
   const collider=R.ColliderDesc.capsule(s.size[1]*size,s.size[0]*size).setTranslation(...s.position.map(v=>v*size));
   sim.world.createCollider(collider.setDensity(m.density).setFriction(m.friction).setRestitution(m.restitution).setCollisionGroups(stemGroups(p)).setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS),body);
   this.owners.set(body.handle,site.id);
   const floats=flotationSamples([{center:s.position,radius:s.size[0],halfHeight:s.size[1]}],scale),key=site.id+':'+p.id;
   const r={key,body,part:p,asset,instance:{id:site.id,assetId:asset.id},matrix,scale,floats,fluidVolume:floats.reduce((a,f)=>a+f.volume,0)};
   r.obstacle=parcelObstacle(p.stamps,()=>r.matrix,this.library.materials,true);
   if(r.obstacle)sim.parcelObstacles.push(r.obstacle);
   sim.paintedHinges.attach(r,this.materials);state.records.push(r);this.records.set(key,r);
  }
  for(const child of state.records){
   const j=child.part.joint,parent=this.records.get(site.id+':'+j.parentId)??null;
   const anchor=new Vector3(...j.anchor).applyMatrix4(im),a=parent?sim.localPoint(parent,anchor):anchor,b=sim.localPoint(child,anchor);
   const rest=new Quaternion().copy((parent?.body??sim.ground).rotation()).invert().multiply(new Quaternion().copy(child.body.rotation()));
   const retention=(r,point)=>anchorRetention(r.part,this.library.materials,point.clone().divide(r.scale).toArray());
   const support=Math.min(retention(child,b),parent?retention(parent,a):1);
   if(support<1e-4)continue;
   const link={child,parent,j,support,rest,anchorParent:a,anchorChild:b,data:R.JointData.spherical(a,b)};
   sim.rebindJoint(link);sim.joints.push(link);state.links.push(link);
  }
  this.active.set(site.id,state);return state;
 }
 release(state){
  const sim=this.sim;
  for(const l of state.links){const i=sim.joints.indexOf(l);if(i>=0){sim.world.removeImpulseJoint(l.joint,false);sim.joints.splice(i,1);}}
  for(const r of state.records){
   sim.paintedHinges.count-=sim.paintedHinges.parts.get(r.key)?.length??0;
   sim.paintedHinges.parts.delete(r.key);
   const i=sim.parcelObstacles.indexOf(r.obstacle);if(i>=0)sim.parcelObstacles.splice(i,1);
   this.owners.delete(r.body.handle);sim.world.removeRigidBody(r.body);this.records.delete(r.key);
  }
  this.active.delete(state.site.id);
 }
 around(point,radius){
  if(point.y-radius>5||point.y+radius<-1)return;
  const sim=this.sim,margin=radius+2;
  for(let j=Math.floor((point.z-margin)/REED_TILE);j<=Math.floor((point.z+margin)/REED_TILE);j++)
   for(let i=Math.floor((point.x-margin)/REED_TILE);i<=Math.floor((point.x+margin)/REED_TILE);i++){
    const key=i+','+j;let tile=this.tiles.get(key);
    if(!tile){if(this.tiles.size>=64)this.tiles.delete(this.tiles.keys().next().value);
     tile=sim.sand.landscape.crowns(i,j).filter(c=>this.eligible(c));this.tiles.set(key,tile);}
    for(const c of tile)if(Math.hypot(c.x-point.x,c.z-point.z)<radius+.8&&point.y-radius<c.y+3*c.size)this.activate(c);
   }
 }
 beforeStep(dt,pool){
  const sim=this.sim;
  if(sim.time>=this.nextSurvey){
   this.nextSurvey=sim.time+.12;
   for(const r of sim.bodies.values())if(!this.planted.some(i=>i.id===r.instance.id)){
    const center=r.probeCenter.clone().applyQuaternion(r.body.rotation()).add(r.body.translation());
    this.around(center,Math.min(6,r.probeRadius+.12*Math.hypot(...Object.values(r.body.linvel()))));
   }
   if(sim.pondSea.grip)this.around(sim.pondSea.grip,.5);
   for(const d of sim.pondSea.drops)if(!d.held&&d.scoop)this.around(d,d.r);
   for(const c of sim.chunks.values())this.around(c.body.translation(),.65);
   for(const group of sim.matter.parts.values())for(const p of group.packets)this.around(p.position,p.radius);
  }
  for(const state of this.active.values()){
   const {site}=state,air=windAt(sim.windSettings,sim.time,site.x,site.z,this.gust??={});
   for(const r of state.records){
    r.body.resetForces(false);r.body.resetTorques(false);
    applyEnvironment(r,sim.pondSea,sim.pondDensity,air,-sim.world.gravity.y,dt,pool);
   }
  }
 }
 afterStep(){
  const q=this.rotation??=new Quaternion();
  for(const r of this.records.values())r.matrix.compose(r.body.translation(),q.copy(r.body.rotation()),r.scale);
 }
}
