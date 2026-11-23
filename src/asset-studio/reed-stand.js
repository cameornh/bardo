// Shared wind solves keep an unbounded habitat affordable. A local impact
// forks the same authored bodies and flexures at their current poses.
import {Vector3,Quaternion,Euler,Matrix4} from 'three';
import {collisionProxy} from './collision.js';
import {REED_TILE} from './wetland.js';

const rad=Math.PI/180;
export const MAX_ACTIVE_CROWNS=12;
export function reedFamily(library){
 const members=library.families.find(f=>f.id==='example-rushes')?.members??[];
 return members.map(m=>library.assets.find(a=>a.id===m.assetId));
}
export function instancedReed(asset){
 return !!asset?.parts.length&&asset.parts.every(p=>p.stamps.length===1&&p.stamps[0].shape==='capsule'&&p.stamps[0].mode==='add'&&
  p.stamps[0].position.every((v,i)=>Math.abs(v-(i===1?p.stamps[0].size[1]:0))<1e-6)&&p.joint?.type==='flexure'&&p.marks?.every(m=>m.kind==='ribbon'||m.kind==='dab')&&p.pivot.every(v=>v===0)&&p.transform.scale.every(v=>v===1));
}
export function reedPartMatrix(p){
 return new Matrix4().compose(new Vector3(...p.transform.position),new Quaternion().setFromEuler(new Euler(...p.transform.rotation.map(v=>v*rad))),new Vector3(1,1,1));
}
export function plantedCrown(instance,variant){
 const [x,y,z]=instance.transform.position;
 return {x,y,z,id:instance.id,variant,yaw:instance.transform.rotation[1]*rad,size:instance.transform.scale[1],
  vitality:1,leanX:0,leanZ:0,hueShift:0};
}
// Roots embedded in sand must not fight the heightfield that anchors them.
// Free sections can strike the bed. Stems slide past their overlapping siblings.
export function stemGroups(p){return p.joint.parentId==='ground'?0x0008fffb:0x0008ffff;}

export function reedContactFilter(sim){
 const owners=new Map(),events=new sim.R.EventQueue(true);
 return {owners,events,hooks:{
  filterContactPair:(_a,_b,first,second)=>owners.has(first)&&owners.get(first)===owners.get(second)?null:sim.R.SolverFlags.COMPUTE_IMPULSE,
  filterIntersectionPair:()=>true
 }};
}
export function crownTransform(site){
 return new Matrix4().makeRotationY(site.yaw).scale(new Vector3().setScalar(site.size)).setPosition(site.x,site.y,site.z);
}
function placement(site,asset){
 return {id:site.id,assetId:asset.id,transform:{position:[site.x,site.y,site.z],rotation:[0,site.yaw/rad,0],scale:Array(3).fill(site.size)}};
}

// Wind and gravity are common loads over an unbounded population. Solve the
// actual asset in an isolated world for representative exposures. A local
// contact forks that moving instance, including every already-broken joint.
function breakGroundJoint(sim,state,r){
 const link=state.links.find(l=>l.child===r);if(!link)return false;
 const idx=sim.joints.indexOf(link);
 sim.world.removeImpulseJoint(link.joint,true);
 if(idx>=0)sim.joints.splice(idx,1);
 r.jointBroken=true;
 if(r.part.joint?.parentId==='ground')r.body.collider(0).setCollisionGroups(0x0008ffff);
 return true;
}

export class ReedStand{
 constructor(sim,library){
  this.sim=sim;this.library=library;this.assets=reedFamily(library);this.materials=new Map(library.materials.map(m=>[m.id,m]));
  this.planted=new Map();
  for(const i of library.world.instances){
   const variant=this.assets.findIndex(a=>instancedReed(a)&&a.id===i.assetId);
   if(variant>=0)this.planted.set(i.id,plantedCrown(i,variant));
  }
  this.proxies=this.assets.map(a=>instancedReed(a)?a.parts.map(collisionProxy):[]);
  this.parked=new Map();this.active=new Map();this.records=new Map();this.tiles=new Map();this.persistentDamage=new Map();this.nextSurvey=0;this.samples=[];this.exposures=this.assets.map(()=>[]);
 }
 isPlanted(id){return this.planted.has(id);}
 eligible(crown){for(const s of this.planted.values())if(Math.hypot(s.x-crown.x,s.z-crown.z)<=1.1)return false;return true;}
 _restHeight(variant){
  this._restH??=[];
  if(this._restH[variant]!==undefined)return this._restH[variant];
  const asset=this.assets[variant];
  let maxH=0.35;
  if(asset?.parts){
   const p0=new Vector3();
   for(const p of asset.parts){
    const m=reedPartMatrix(p),stem=p.stamps[0],L=2*stem.size[1];
    p0.set(0,L,0).applyMatrix4(m);
    if(p0.y>maxH)maxH=p0.y;
   }
  }
  this._restH[variant]=maxH;
  return maxH;
 }
 summarizeCrownDamage(records,site,inverse=null){
  if(!records?.length)return null;
  const scale=Math.max(0.2,site.size||1);
  const restH=this._restHeight(site.variant)*scale;
  let broken=0,maxRelY=0,minBaseY=Infinity,sx=0,sz=0,upperN=0;
  const tmp=new Vector3();
  for(const r of records){
   if(r.jointBroken)broken++;
   if(r.matrix)tmp.set(0,0,0).applyMatrix4(r.matrix);
   else if(r.body)tmp.copy(r.body.translation());
   else continue;
   if(inverse)tmp.applyMatrix4(inverse);
   const relY=inverse?tmp.y:(tmp.y-site.y);
   if(relY>maxRelY)maxRelY=relY;
   if(r.part?.joint?.parentId==='ground'&&relY<minBaseY)minBaseY=relY;
   if(relY>restH*0.25){
    sx+=inverse?tmp.x:(tmp.x-site.x);
    sz+=inverse?tmp.z:(tmp.z-site.z);
    upperN++;
   }
  }
  const intactFrac=Math.max(0.14,Math.min(1.0,1-(broken/records.length)*0.86));
  const heightScale=Math.max(0.22,Math.min(1.0,maxRelY>0.02?(maxRelY*1.08)/Math.max(0.25,restH):1.0));
  const tiltScale=1/Math.max(0.35,restH*Math.max(1,upperN));
  const tiltX=Math.max(-1.2,Math.min(1.2,sx*tiltScale));
  const tiltZ=Math.max(-1.2,Math.min(1.2,sz*tiltScale));
  const dropY=inverse||!Number.isFinite(minBaseY)?0:Math.max(-2.0,Math.min(0.6,minBaseY));
  return {intactFrac,heightScale,tiltX,tiltZ,dropY};
 }
 crownSummary(siteId){
  const act=this.active.get(siteId);
  if(act)return this.summarizeCrownDamage(act.records,act.site);
  const pk=this.parked.get(siteId);
  if(pk){
   const recs=[];
   for(const [pid,sv] of pk.saved.entries())recs.push({part:this.assets[pk.site.variant]?.parts.find(p=>p.id===pid),matrix:sv.matrix,jointBroken:sv.jointBroken});
   if(recs.length)return this.summarizeCrownDamage(recs,pk.site);
  }
  return this.persistentDamage.get(siteId)??null;
 }
 windDamageByVariant(){
  if(!this.windWorld)return null;
  const stepKey=this.windWorld.steps;
  if(this._windDmgStep===stepKey&&this._windDmgCache)return this._windDmgCache;
  this._windDmgStep=stepKey;
  const out=this.exposures.map((samples,v)=>{
   if(!samples?.length)return {intactFrac:1,heightScale:1,leanX:0,leanZ:0};
   let intact=0,hs=0,lx=0,lz=0,cnt=0;
   const parts=this.assets[v]?.parts||[];
   for(const s of samples){
    const recs=[];
    for(const p of parts){const rec=this.windWorld.get(s.site.id,p.id);if(rec)recs.push(rec);}
    const sum=this.summarizeCrownDamage(recs,s.site,s.inverse);
    if(sum){
     const c=Math.cos(s.site.yaw),sn=Math.sin(s.site.yaw);
     intact+=sum.intactFrac;hs+=sum.heightScale;
     lx+=c*sum.tiltX-sn*sum.tiltZ;lz+=sn*sum.tiltX+c*sum.tiltZ;
     cnt++;
    }
   }
   return cnt?{intactFrac:intact/cnt,heightScale:hs/cnt,leanX:lx/cnt,leanZ:lz/cnt}:{intactFrac:1,heightScale:1,leanX:0,leanZ:0};
  });
  this._windDmgCache=out;
  return out;
 }
 async prepareWind(create){
  const eligible=this.assets.filter(a=>instancedReed(a));
  const totalParts=eligible.reduce((n,a)=>n+a.parts.length,0);
  const count=eligible.length===1?Math.min(3,Math.floor(32/(eligible[0]?.parts.length||1))):(totalParts*2<=96?2:1);
  for(const [variant,a] of this.assets.entries())if(instancedReed(a))for(let i=0;i<count;i++){
   const index=this.samples.length,site={id:'wind/'+index,x:index*10,y:0,z:0,yaw:2*Math.PI*i/count,size:1,variant};
   const sample={site,inverse:crownTransform(site).invert(),instance:placement(site,a)};
   this.samples.push(sample);this.exposures[variant].push(sample);
  }
  if(this.samples.length)this.windWorld=await create({...this.library.world,wetlandSeed:undefined,instances:this.samples.map(s=>s.instance)});
 }
 sample(site){
  const samples=this.exposures[site.variant];
  if(!samples?.length)return null;
  if(samples.length===1)return samples[0];
  const angle=site.yaw/(2*Math.PI);
  return samples[Math.round((angle-Math.floor(angle))*samples.length)%samples.length];
 }
 // Used by drawing, cursor hits and physical hand-off alike.
 pose(site,part,out){
  const active=this.sim.get(site.id,part.id);
  if(active)return out.copy(active.matrix);
  const saved=this.parked.get(site.id)?.saved.get(part.id);if(saved)return out.copy(saved.matrix);
  const sample=this.sample(site),r=sample&&this.windWorld?.get(sample.site.id,part.id);
  return r?out.copy(crownTransform(site)).multiply(sample.inverse).multiply(r.matrix):out.copy(crownTransform(site)).multiply(reedPartMatrix(part));
 }
 activate(site,direct=true){
  const sim=this.sim,known=this.active.get(site.id);
  if(known){known.last=sim.time;return known;}
  const asset=this.assets[site.variant];if(!instancedReed(asset))return;
  if(this.active.size>=MAX_ACTIVE_CROWNS){
   const candidates=[...this.active.values()].filter(s=>!s.fieldActive&&s.records.every(r=>
    r.key!==sim.drag?.key&&!sim.pulses.some(f=>f.key===r.key)&&!sim.paintedHinges.parts.get(r.key)?.some(h=>h.cursorForce)));
   const stale=candidates.filter(s=>direct||sim.time-s.last>2).sort((a,b)=>a.last-b.last)[0];
   if(!stale)return;
   this.release(stale);
  }
  const state={site,records:[],links:[],last:sim.time};
  const im=crownTransform(site),instance=placement(site,asset);
  for(const [j,p] of asset.parts.entries()){
   const r=sim.instantiatePart(this.library,this.materials,instance,asset,p,im,this.proxies[site.variant][j],asset.parts.length);
   if(r){this.records.set(r.key,r);state.records.push(r);}
  }
  // Bind in the authored rest pose, then inherit current motion, so waking
  // a wind-bent stem never resets its spring's neutral angle.
  for(const r of state.records){const link=sim.attachPartJoint(this.library,r);if(link)state.links.push(link);}
  const sample=this.sample(site);
  if(sample&&this.windWorld){
   const fromSample=im.clone().multiply(sample.inverse),rot=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),site.yaw-sample.site.yaw);
   const parked=this.parked.get(site.id);
   for(const r of state.records){
    const saved=parked?.saved.get(r.part.id);
    const other=this.windWorld.get(sample.site.id,r.part.id);if(!other)continue;
    if(saved)r.matrix.copy(saved.matrix);
    else r.matrix.multiplyMatrices(fromSample,other.matrix);
    const pos=new Vector3(),q=new Quaternion();r.matrix.decompose(pos,q,new Vector3());
    r.body.setTranslation(pos,true);r.body.setRotation(q,true);
    r.body.setLinvel(saved?.velocity??new Vector3().copy(other.body.linvel()).applyQuaternion(rot).multiplyScalar(site.size),true);
    r.body.setAngvel(saved?.spin??new Vector3().copy(other.body.angvel()).applyQuaternion(rot),true);
    const hinges=sim.paintedHinges.parts.get(r.key)||[],windHinges=this.windWorld.paintedHinges.parts.get(other.key)||[];
    hinges.forEach((h,i)=>{const prev=saved?.hinges[i]??windHinges[i];if(prev){h.angle=prev.angle;h.velocity=prev.velocity;}});
    if(saved?saved.jointBroken:other.jointBroken)breakGroundJoint(sim,state,r);
   }
  }
  this.parked.delete(site.id);this.active.set(site.id,state);return state;
 }
 release(state){
  const sim=this.sim;
  const saved=new Map(),byId=new Map(state.records.map(r=>[r.part.id,r]));
  for(const r of state.records){
   let ancestor=r;
   while(ancestor&&!ancestor.jointBroken)ancestor=byId.get(ancestor.part.joint.parentId);
   if(!ancestor)continue;
   saved.set(r.part.id,{matrix:r.matrix.clone(),jointBroken:!!r.jointBroken,
    velocity:new Vector3().copy(r.body.linvel()),spin:new Vector3().copy(r.body.angvel()),
    hinges:(sim.paintedHinges.parts.get(r.key)??[]).map(h=>({mark:h.mark,angle:h.angle,velocity:h.velocity}))});
  }
  if(saved.size)this.parked.set(state.site.id,{site:state.site,saved});
  const dmg=this.summarizeCrownDamage(state.records,state.site);
  if(dmg&&(dmg.intactFrac<0.98||dmg.heightScale<0.92||Math.abs(dmg.dropY)>0.03)){
   this.persistentDamage.set(state.site.id,dmg);
  }
  for(const l of state.links){const i=sim.joints.indexOf(l);if(i>=0){sim.world.removeImpulseJoint(l.joint,false);sim.joints.splice(i,1);}}
  for(const r of state.records){
   sim.paintedHinges.count-=sim.paintedHinges.parts.get(r.key)?.length??0;sim.paintedHinges.parts.delete(r.key);
   const i=sim.parcelObstacles.indexOf(r.obstacle);if(i>=0)sim.parcelObstacles.splice(i,1);
   sim.reedContacts.owners.delete(r.body.handle);sim.colliderCount-=r.body.numColliders();
   sim.world.removeRigidBody(r.body);this.records.delete(r.key);sim.bodies.delete(r.key);
  }
  this.active.delete(state.site.id);
 }
 around(point,radius){
  if(point.y-radius>14||point.y+radius<-2.5)return;
  const sim=this.sim,margin=radius+2.5;
  const visit=c=>{
   if(Math.hypot(c.x-point.x,c.z-point.z)<radius+.95&&point.y-radius<c.y+4.5*c.size)this.activate(c,false);
  };
  for(const c of this.planted.values())visit(c);
  for(let j=Math.floor((point.z-margin)/REED_TILE);j<=Math.floor((point.z+margin)/REED_TILE);j++)
   for(let i=Math.floor((point.x-margin)/REED_TILE);i<=Math.floor((point.x+margin)/REED_TILE);i++){
    const key=i+','+j;let tile=this.tiles.get(key);
    if(!tile){if(this.tiles.size>=64)this.tiles.delete(this.tiles.keys().next().value);
     tile=sim.sand.landscape.crowns(i,j,this.assets).filter(c=>this.eligible(c));this.tiles.set(key,tile);}
    for(const c of tile)visit(c);
   }
 }
 impulse(point,force,reach=2.0,sandTerrain=null){
  this.around(point,reach);
  const sim=this.sim;
  for(const state of this.active.values()){
   const sd=Math.hypot(state.site.x-point.x,state.site.z-point.z);
   if(sd>reach+1.2)continue;
   const undercut=sandTerrain?sandTerrain.offset(state.site.x,state.site.z):-0.0;
   const snapBase=undercut<-0.075||(force>2200&&sd<reach*0.58);
   for(const r of state.records){
    if(snapBase&&r.part.joint?.parentId==='ground'&&!r.jointBroken)breakGroundJoint(sim,state,r);
    const bt=r.body.translation();
    const dx=bt.x-point.x,dz=bt.z-point.z,hd=Math.hypot(dx,dz);
    if(hd>reach+0.6)continue;
    r.body.wakeUp?.();
    const fall=Math.exp(-hd/Math.max(0.45,reach*0.45));
    const nx=hd>1e-4?dx/hd:0,nz=hd>1e-4?dz/hd:0;
    const mag=Math.min(4.5,r.body.mass()*1.2)*Math.sqrt(Math.max(100,force)/1200)*fall;
    r.body.applyImpulse({x:nx*mag,y:mag*0.75,z:nz*mag},true);
   }
  }
 }
 step(dt){
  const sim=this.sim;
  if(this.windWorld){this.windWorld.wind=sim.windSettings;this.windWorld.step(dt);}
  if(sim.sandTerrain&&sim.sandTerrain.version!==this._lastSandVer){
   this._lastSandVer=sim.sandTerrain.version;
   for(const state of this.active.values()){
    if(sim.sandTerrain.offset(state.site.x,state.site.z)<-0.075){
     for(const r of state.records){
      if(r.part.joint?.parentId==='ground'&&!r.jointBroken){
       breakGroundJoint(sim,state,r);
       r.body.wakeUp?.();
      }
     }
    }
   }
  }
  if(sim.time<this.nextSurvey)return;
  this.nextSurvey=sim.time+.12;
  for(const r of sim.bodies.values())if(!this.records.has(r.key)){
   const center=r.probeCenter.clone().applyQuaternion(r.body.rotation()).add(r.body.translation());
   this.around(center,Math.min(6,r.probeRadius+.12*Math.hypot(...Object.values(r.body.linvel()))));
  }
  if(sim.pondSea.grip)this.around(sim.pondSea.grip,.5);
  for(const d of sim.pondSea.drops)if(!d.held&&d.scoop)this.around(d,d.r);
  for(const c of sim.chunks.values())this.around(c.body.translation(),.65);
  for(const group of sim.matter.parts.values())for(const p of group.packets)this.around(p.position,p.radius);
 }
 dispose(){this.persistentDamage.clear();this.windWorld?.dispose();}
}
