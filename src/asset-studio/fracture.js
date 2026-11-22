import {Matrix3,Quaternion,Vector3} from 'three';
import {fractureBoxes,fractureGrid,islands,nearestRegion} from './fracture-grid.js';
import {cellShapes,fractureCells,mergeBoxes} from './fracture-cells.js';
import {charBondStrength} from './char-fracture.js';
import {factorNetwork,solveBonds} from './fracture-stress.js';

const vec=p=>new Vector3().copy(p);
function regionAt(r,point){
 return nearestRegion(r.structure.grid,point.clone().divide(r.scale).toArray(),r.regions);
}
export function structureBody(r,point,candidates){
 if(!r?.structure)return r;
 const {grid,owners,indices}=r.structure;
 return owners[nearestRegion(grid,point.clone().divide(r.scale).toArray(),candidates??indices)];
}
function assignRegions(r,s,ids){
 r.structure=s;r.regions=ids;r.net=null;
 for(const i of ids)s.owners[i]=r;
 for(const sample of r.floats)sample.region=regionAt(r,sample.p);
}
export function attachStructure(sim,r,shapes,materials,anchor,beam,makeBody){
 if(!shapes.some(s=>materials.get(s.materialId).youngModulus>0)&&shapes.every(s=>s.materialId===shapes[0].materialId))return;
 const grid=fractureGrid(mergeBoxes(fractureBoxes(shapes)),r.scale.toArray(),materials);
 if(!grid||grid.nodes.length<2)return;
 const indices=grid.nodes.map(n=>n.index);
 const s={grid,indices,owners:[],root:r,anchor,makeBody,serial:0,beam,
  loads:new Float64Array(indices.length*6),bodies:new Set([r]),brokenBonds:0};
 r.massScale=r.body.mass()/grid.nodes.reduce((sum,n)=>sum+n.mass,0)||1;
 r.forceSamples=[];assignRegions(r,s,indices);sim.structures.push(s);
 if(beam){beam.root=r;beam.tip=r;sim.sections.push(beam);}
 const groups=islands(grid);if(groups.length>1)separate(sim,r,groups);
}

// Force samples share Rapier's world frame, including joint reactions. The
// structural solve converts them to material coordinates at the end of the step.
export function recordLoad(r,force,point,torque,region){
 if(r?.forceSamples)r.forceSamples.push({force:vec(force),point:vec(point),torque:torque&&vec(torque),region});
}
export function beforeFractureStep(sim){
 sim.fractureMotion??=new Map();sim.fractureMotion.clear();
 for(const s of sim.structures)for(const r of s.bodies){
  sim.fractureMotion.set(r.body.handle,r);
  r.forceSamples.length=0;r.impactImpulse=0;r.priorVelocity=vec(r.body.linvel());r.priorSpin=vec(r.body.angvel());
 }
}
function addWrench(out,i,f,p,m){
 const j=i*6;out[j]+=f.x;out[j+1]+=f.y;out[j+2]+=f.z;
 out[j+3]+=p.y*f.z-p.z*f.y+(m?.x||0);
 out[j+4]+=p.z*f.x-p.x*f.z+(m?.y||0);
 out[j+5]+=p.x*f.y-p.y*f.x+(m?.z||0);
}
function contactLoads(sim,r,dt){
 const b=r.body;
 const floor=[],up=new Vector3(0,1,0),com=vec(b.worldCom()),slow=Math.abs(b.linvel().y)<.15;
 for(let k=0;k<b.numColliders();k++){
  const collider=b.collider(k);
  sim.world.contactPairsWith(collider,other=>sim.world.contactPair(collider,other,(manifold,flip)=>{
   const normal=vec(manifold.normal()).multiplyScalar(flip?1:-1);
   for(let j=0;j<manifold.numContacts();j++){
    const impulse=manifold.contactImpulse(j);if(impulse<=0)continue;
    const local=flip?manifold.localContactPoint2(j):manifold.localContactPoint1(j);
    if(!local)continue;
    const point=vec(local).applyQuaternion(collider.rotation()).add(collider.translation());
    const force=normal.clone().multiplyScalar(impulse/dt);
    const otherBody=other.parent();
    if(!slow||otherBody?.isDynamic()){
     const relative=r.priorSpin.clone().cross(point.clone().sub(com)).add(r.priorVelocity);
     const moving=otherBody&&sim.fractureMotion.get(otherBody.handle);
     if(moving)relative.sub(moving.priorSpin.clone().cross(point.clone().sub(otherBody.worldCom())).add(moving.priorVelocity));
     else if(otherBody?.isDynamic())relative.sub(otherBody.velocityAtPoint(point));
     if(relative.dot(normal)<-.8)r.impactImpulse+=impulse;
    }
    if(otherBody?.handle===sim.ground.handle&&normal.y>.98&&slow)floor.push({force,point});
    else recordLoad(r,force,point);
   }
  }));
 }
 if(!floor.length)return;
 // In a resting coplanar manifold the solver can arbitrarily concentrate
 // weight on a couple of corners. Spread that normal reaction over the actual
 // bottom faces touching the same plane. Empty space under an arch carries none.
 const level=floor.reduce((n,c)=>n+c.point.y,0)/floor.length;
 const rot=new Quaternion().copy(b.rotation()),origin=vec(b.translation()),normal=up.clone().applyQuaternion(rot.clone().invert());
 const faces=[];let area=0;
 for(const i of r.regions)for(const shape of r.structure.grid.nodes[i].shapes){
  const half=new Vector3(...shape.half).multiply(r.scale),center=new Vector3(...shape.center).multiply(r.scale).applyQuaternion(rot).add(origin);
  for(const k of [0,1,2]){
   const vertical=normal.getComponent(k);if(Math.abs(vertical)<.985)continue;
   const off=new Vector3().setComponent(k,-Math.sign(vertical)*half.getComponent(k)).applyQuaternion(rot);
   const point=center.clone().add(off);if(Math.abs(point.y-level)>.016)continue;
   const weight=4*half.getComponent((k+1)%3)*half.getComponent((k+2)%3);
   faces.push({i,weight,point});area+=weight;
  }
 }
 const total=floor.reduce((v,c)=>v.add(c.force),new Vector3());
 if(!area||total.y>1.6*b.mass()*Math.max(.01,-sim.world.gravity.y)){
  for(const c of floor)recordLoad(r,c.force,c.point);
 }else for(const face of faces){
  r.forceSamples.push({force:total.clone().multiplyScalar(face.weight/area),point:face.point,region:face.i});
 }

}
function inertiaProduct(t,v,out){
 return out.set(t[0]*v.x+t[3]*v.y+t[4]*v.z,t[3]*v.x+t[1]*v.y+t[5]*v.z,t[4]*v.x+t[5]*v.y+t[2]*v.z);
}
function evaluate(sim,r,dt){
 const {structure:s,body:b,regions}=r;
 if(regions.length<2)return;
 // After a stable body sleeps there are no new impact loads. A partially
 // damaged member continues to integrate its last static loading.
 if(b.isSleeping()&&!r.forceSamples.length&&!r.accumulating)return;
 const {grid,loads}=s,inv=new Quaternion().copy(b.rotation()).invert();
 const com=vec(b.localCom()),origin=vec(b.translation());
 const accel=vec(b.linvel()).sub(r.priorVelocity).divideScalar(dt);
 const spin=vec(b.angvel()).applyQuaternion(inv),alpha=vec(b.angvel()).sub(r.priorSpin).applyQuaternion(inv).divideScalar(dt);
 const weight=vec(sim.world.gravity).sub(accel).applyQuaternion(inv);
 const regionMass=regions.reduce((sum,i)=>sum+grid.nodes[i].mass,0);
 const massCenter=new Vector3();
 const massScale=r.massScale??1;
 const force=new Vector3(),center=new Vector3(),arm=new Vector3(),angular=new Vector3(),torque=new Vector3();
 loads.fill(0);
 for(const i of regions){
  const n=grid.nodes[i];center.fromArray(n.center);arm.copy(center).sub(com);
  force.copy(weight).sub(angular.crossVectors(alpha,arm)).sub(angular.crossVectors(spin,arm).crossVectors(spin,angular)).multiplyScalar(n.mass*massScale);
  massCenter.addScaledVector(center,n.mass/regionMass);
  // Angular inertia about the region's own centroid, in addition to its arm.
  inertiaProduct(n.inertia,spin,angular);torque.crossVectors(spin,angular);
  inertiaProduct(n.inertia,alpha,angular);torque.add(angular).multiplyScalar(-massScale);
  addWrench(loads,i,force,center,torque);
 }
 contactLoads(sim,r,dt);
 for(const sample of r.forceSamples){
  const point=sample.point.sub(origin).applyQuaternion(inv);
  addWrench(loads,sample.region??regionAt(r,point),sample.force.applyQuaternion(inv),point,sample.torque?.applyQuaternion(inv));
 }
 const residual=new Float64Array(6);
 for(const i of regions)for(let k=0;k<6;k++)residual[k]+=loads[i*6+k];
 // A mounted part reacts at its authored pivot. For an unmounted fragment
 // eliminate the net rigid motion, including numerical damping and friction.
 if(b.isFixed()){
  const i=regionAt(r,s.anchor);for(let k=0;k<6;k++)loads[i*6+k]-=residual[k];
 }else{
  const netForce=new Vector3().fromArray(residual);
  torque.fromArray(residual,3).sub(angular.crossVectors(massCenter,netForce));
  for(const i of regions){
   const n=grid.nodes[i],share=-n.mass/regionMass;
   addWrench(loads,i,force.copy(netForce).multiplyScalar(share),center.fromArray(n.center),arm.copy(torque).multiplyScalar(share));
  }
 }
 let amplitude=0;
 for(const i of regions)for(let k=0;k<6;k++)amplitude=Math.max(amplitude,Math.abs(loads[6*i+k]));
 if(amplitude<.001&&!r.accumulating)return;
 r.net??=factorNetwork(regions,grid);
 let selected=null,highest=0,compression=0;const beam=s.beam;
 const mid=beam?.center.getComponent(beam.axis);
 r.accumulating=false;
 // Reuse a stress solution for exactly repeated loads. Small variations well
 // away from failure use at most three intervening steps before a fresh solve.
 const net=r.net;
 if(!net.lastLoad)net.lastLoad=new Float64Array(loads.length);
 let change=0;for(const i of regions)for(let k=i*6;k<i*6+6;k++)change=Math.max(change,Math.abs(net.lastLoad[k]-loads[k]));
 if(net.lastStep===undefined||net.pending||change>0&&(change>.01*amplitude||net.peak>.65||sim.steps-net.lastStep>=4||r.impactImpulse)){
  net.lastLoad.set(loads);net.lastStep=sim.steps;net.peak=0;
  solveBonds(net,loads,(e,ratio,axial)=>{e.ratio=ratio;e.axial=axial;net.peak=Math.max(net.peak,ratio);});
 }
 // Defer irreversible damage if a large iterative solve still needs refinement.
 if(net.pending)return;
 for(const e of net.edges){
  const strengthA=charBondStrength(s,e,r.fieldStrength?.get(e.a)??1,r.fieldChar?.get(e.a)??0);
  const strengthB=charBondStrength(s,e,r.fieldStrength?.get(e.b)??1,r.fieldChar?.get(e.b)??0);
  const ratio=e.ratio/Math.min(strengthA,strengthB),axial=e.axial;
  if(beam?.status==='intact'&&e.axis===beam.axis&&Math.abs(e.center[e.axis]-s.bucklingPlane)<1e-5)compression-=axial;
  e.damage=Math.max(0,e.damage+dt*(ratio>1?Math.min(7,ratio-1):-2));
  if(e.damage>0)r.accumulating=true;
  const shock=r.impactImpulse>0 && ratio*dt>e.overloadTime && r.impactImpulse>regionMass*massScale*.08;
  if(ratio>1&&(e.damage>e.overloadTime||shock)&&ratio>highest){selected=e;highest=ratio;}
 }
 if(beam?.status==='intact'){
  // The analytic column mode remains available for slender rectangular stock.
  if(s.bucklingPlane===undefined){
   const faces=r.net.edges.filter(e=>e.axis===beam.axis);
   s.bucklingPlane=faces.reduce((x,e)=>Math.abs(e.center[e.axis]-mid)<Math.abs(x-mid)?e.center[e.axis]:x,Infinity);
  }
  const length=beam.length*(b.isFixed()?2:1),critical=Math.PI**2*beam.material.youngModulus*Math.min(beam.ib,beam.ic)/(length*length);
  beam.buckling=Math.max(0,beam.buckling+dt*(compression>critical?Math.min(5,compression/critical-1):-2));
  if(beam.buckling>.18&&!selected){
   const edges=r.net.edges.filter(e=>e.axis===beam.axis&&Math.abs(e.center[e.axis]-s.bucklingPlane)<1e-5);
   for(const e of edges)e.broken=true;
   const groups=componentsOf(r);if(groups.length===2){
    beam.center.setComponent(beam.axis,s.bucklingPlane);
    const [parent,child]=separate(sim,r,groups);
    sim.buckle(beam,parent,child);return;
   }
   for(const e of edges)e.broken=false;
  }
 }
 if(!selected)return;
 // Redistribute the load before breaking an alternate path. Several cracks can
 // grow in one part, and a detached fragment keeps its own surviving bonds.
 selected.char=Math.max(r.fieldChar?.get(selected.a)??0,r.fieldChar?.get(selected.b)??0);selected.broken=true;s.brokenBonds++;r.net=null;
 const groups=componentsOf(r);
 if(groups.length>1){
  separate(sim,r,groups);
  if(beam?.status==='intact'){beam.status='fractured';beam.exposed=true;}
  if(beam?.status==='fractured'){
   beam.tip=structureBody(r,beam.tipPoint);
  }
 }
}
function componentsOf(r){
 const ids=new Set(r.regions);
 return islands(r.structure.grid).filter(group=>ids.has(group[0]));
}
// Cut only interfaces between ready-to-flow regions and the remaining solid.
// Existing fractures and disconnected supports still determine the rigid islands.
export function separateMeltRegions(sim,r,liquid,maxGroups){
 const s=r.structure,interfaces=[];
 for(const e of s.grid.bonds){
  if(e.broken||s.owners[e.a]!==r||s.owners[e.b]!==r)continue;
  const a=liquid.has(e.a),b=liquid.has(e.b);
  if(a!==b||(a&&s.grid.nodes[e.a].material!==s.grid.nodes[e.b].material)){
   interfaces.push(e);e.broken=true;
  }
 }
 const groups=componentsOf(r);
 // Each hot island stays homogeneous and needs one parcel group. Capacity
 // backpressure must never silently cut bonds in a still-rigid sculpt.
 if(groups.filter(ids=>liquid.has(ids[0])).length>maxGroups){
  for(const e of interfaces)e.broken=false;
  return [];
 }
 return separate(sim,r,groups).filter(piece=>liquid.has(piece.regions[0]));
}
export function advanceFractures(sim,dt){
 for(const s of sim.structures)for(const r of [...s.bodies])evaluate(sim,r,dt);
}
function worldInertia(body){
 const m=body.effectiveAngularInertia();
 return new Matrix3().set(m.m11,m.m12,m.m13,m.m21,m.m22,m.m23,m.m31,m.m32,m.m33);
}
function separate(sim,r,groups){
 const s=r.structure,old=r.body,rot=new Quaternion().copy(old.rotation()),origin=vec(old.translation()),spin=vec(old.angvel()),v=vec(old.linvel());
 const previousRegions=r.regions,previousField=r.field;
 fractureCells(s.grid);
 const held=regionAt(r,s.anchor);
 groups.sort((a,b)=>Number(b.includes(held))-Number(a.includes(held))||b.length-a.length);
 const originalColliders=old.numColliders(),records=[];
 const jointLinks=[...sim.joints,...sim.internalLinks].filter(l=>l.parent===r||l.child===r);
 // Capture all incident attachments before replacing the old collider/body.
 for(const l of jointLinks)sim.world.removeImpulseJoint(l.joint,true);
 const mass=old.isDynamic()?old.mass():r.regions.reduce((sum,i)=>sum+s.grid.nodes[i].mass,0)*(r.massScale??1);
 const geometry=groups.map(ids=>cellShapes(s.grid,ids));
 const scaledVolume=r.scale.x*r.scale.y*r.scale.z;
 const pieceMass=geometry.map(shapes=>shapes.reduce((sum,p)=>{
  const volume=p.volume??8*p.half[0]*p.half[1]*p.half[2];
  return sum+volume*scaledVolume*sim.materialWorld.palette.get(p.materialId).density;
 },0));
 const densityScale=mass/pieceMass.reduce((a,b)=>a+b,0);
 for(const [j,ids] of groups.entries()){
  const shapes=geometry[j];
  const key=j?r.key.split('#fragment')[0]+'#fragment'+(++s.serial):r.key;
  // Create colliders at the current pose so CCD starts at the fracture site.
  const fresh=s.makeBody(shapes,key,!j&&old.isFixed(),r.part.stamps,densityScale,origin,rot);
  fresh.matrix.compose(origin,rot,fresh.scale);
  fresh.massScale=pieceMass[j]*densityScale/ids.reduce((sum,i)=>sum+s.grid.nodes[i].mass,0);
  let rec=fresh;
  if(!j){
   if(r.obstacle)sim.parcelObstacles.splice(sim.parcelObstacles.indexOf(r.obstacle),1);
   Object.assign(r,fresh);sim.bodies.set(key,r);rec=r;
  }
  if(rec.obstacle){
   const o=rec.obstacle;o.matrix=()=>rec.matrix;o.fragments=shapes;o.local.makeEmpty();
   for(const shape of shapes){
    const p=new Vector3(...shape.center),h=new Vector3(...shape.half);
    o.local.expandByPoint(p.clone().sub(h));o.local.expandByPoint(p.add(h));
   }
  }
  rec.forceSamples=[];assignRegions(rec,s,ids);s.bodies.add(rec);records.push(rec);
 }
 const centroid=records.reduce((c,rec)=>c.addScaledVector(rec.body.worldCom(),rec.body.mass()/mass),new Vector3());
 // The curved primitive's original analytic collider becomes a row proxy
 // on first break. Preserve its angular momentum as well as its total mass.
 if(old.isDynamic()&&spin.lengthSq()>0){
  const momentum=spin.clone().applyMatrix3(worldInertia(old)),totalInertia=new Matrix3().set(0,0,0,0,0,0,0,0,0);
  for(const rec of records){
   const I=worldInertia(rec.body),arm=vec(rec.body.worldCom()).sub(centroid),m=rec.body.mass(),d2=arm.lengthSq();
   for(let col=0;col<3;col++)for(let row=0;row<3;row++){
    const j=col*3+row;
    totalInertia.elements[j]+=I.elements[j]+m*((row===col?d2:0)-arm.getComponent(row)*arm.getComponent(col));
   }
  }
  if(totalInertia.determinant()>0)spin.copy(momentum.applyMatrix3(totalInertia.invert()));
 }
 for(const rec of records)if(rec.body.isDynamic()){
  const velocity=spin.clone().cross(vec(rec.body.worldCom()).sub(centroid)).add(v);
  rec.body.setLinvel(velocity,true);rec.body.setAngvel(spin,true);
 }
 for(const l of jointLinks){
  if(l.parent===r)l.parent=structureBody(r,l.anchorParent,previousRegions);
  if(l.child===r)l.child=structureBody(r,l.anchorChild,previousRegions);
  sim.rebindJoint(l);
 }
 for(const f of sim.drag?[...sim.pulses,sim.drag]:sim.pulses)if(f.key===r.key&&!f.loose)f.key=structureBody(r,f.localPoint,previousRegions).key;
 sim.materialWorld?.inherit(previousField,records);
 sim.world.removeRigidBody(old);sim.colliderCount-=originalColliders;
 return records;
}
