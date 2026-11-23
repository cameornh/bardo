import {recordLoad} from './fracture.js';
import {Vector3, Quaternion} from 'three';

const _center=new Vector3(),_rot=new Quaternion(),_inv=new Quaternion(),_up=new Vector3();
const _pt=new Vector3(),_vel=new Vector3(),_force=new Vector3(),_dir=new Vector3();
const _com=new Vector3(),_arm=new Vector3(),_netForce=new Vector3(),_netTorque=new Vector3();
const _linvel=new Vector3(),_angvel=new Vector3(),_cross=new Vector3();

// At most eight displaced-volume samples per body, independent of view or render spacing.
export function flotationSamples(shapes,scale){
 const points=[],centroid=new Vector3();let total=0;
 for(const s of shapes){
  const h=s.half??[s.radius,s.radius+(s.halfHeight||0),s.radius];
  const v0=s.volume??(s.half?8*h[0]*h[1]*h[2]:Math.PI*s.radius**2*(4*s.radius/3+2*(s.halfHeight||0)));
  const volume=v0*scale.x*scale.y*scale.z/8;
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
   const p=new Vector3(s.center[0]+x*h[0]*.45,s.center[1]+y*h[1]*.45,s.center[2]+z*h[2]*.45).multiply(scale);
   const extent=new Vector3(...h).multiply(scale).multiplyScalar(.55);
   points.push({p,volume,extent});centroid.addScaledVector(p,volume);total+=volume;
  }
 }
 centroid.divideScalar(total);const bins=new Map();
 for(const {p,volume,extent} of points){
  const key=(p.x>centroid.x?1:0)+(p.y>centroid.y?2:0)+(p.z>centroid.z?4:0);
  if(!bins.has(key))bins.set(key,{p:new Vector3(),volume:0,extent:new Vector3()});
  const b=bins.get(key);b.p.addScaledVector(p,volume);b.extent.addScaledVector(extent,volume);b.volume+=volume;
 }
 for(const b of bins.values()){b.p.divideScalar(b.volume);b.extent.divideScalar(b.volume);}
 return [...bins.values()];
}

export function applyEnvironment(record,sea,waterDensity,wind,gravity,dt,column){
 if(!sea&&!column&&!wind.speed){record.wetFraction=0;return;}
 const b=record.body;
 if(!b.isDynamic()&&!record.structure)return;
 _center.copy(b.translation());_rot.copy(b.rotation());
 _inv.copy(_rot).invert();_up.set(0,1,0).applyQuaternion(_inv);
 const angle=wind.heading*Math.PI/180,wx=Math.cos(angle),wz=Math.sin(angle);
 const needsSamples=!!record.forceSamples,dynamic=b.isDynamic();
 const mass=(record.field?.scale===1&&record.mass!==undefined)?record.mass:b.mass();
 if(!needsSamples){
  _com.copy(b.worldCom());
  _linvel.copy(b.linvel());
  _angvel.copy(b.angvel());
  _netForce.set(0,0,0);_netTorque.set(0,0,0);
 }
 let wetVolume=0;
 const flow=sea?.flow(_center.x,_center.z);
 for(const sample of record.floats){
  _pt.copy(sample.p).applyQuaternion(_rot).add(_center);
  const e=sample.extent,r=Math.max(.01,Math.abs(_up.x)*e.x+Math.abs(_up.y)*e.y+Math.abs(_up.z)*e.z);
  const pool=column?.(_pt.x,_pt.z);
  const wet=sea&&!column?Math.max(0,Math.min(1,.5+(sea.height(_pt.x,_pt.z)-_pt.y)/(2*r))):pool?Math.max(0,Math.min(_pt.y+r,pool.top)-Math.max(_pt.y-r,pool.bottom))/(2*r):0;
  if(!wet&&!wind.speed)continue;
  const portion=sample.volume/record.fluidVolume,limit=mass*portion*.38/dt;
  if(needsSamples)_vel.copy(b.velocityAtPoint(_pt));
  else _vel.crossVectors(_angvel,_arm.subVectors(_pt,_com)).add(_linvel);
  _force.set(0,0,0);
  if(wet){
   wetVolume+=wet*sample.volume;
   const wMass=sample.volume*(pool?.density??waterDensity)*wet;
   if(flow)_dir.copy(flow);else _dir.set(0,0,0);_dir.sub(_vel);
   _force.copy(_dir).multiplyScalar(Math.min(wMass*(2+.45*_dir.length()),limit));_force.y+=wMass*gravity;
  }
  if(wind.speed>0&&wet<1){
   // Integrate air pressure over exposed faces. Off-centre pressure loads the joint.
   const speed=wind.speed*(.72+.28*Math.min(1,Math.max(0,_pt.y)/2));
   _dir.set(speed*wx,0,speed*wz).sub(_vel);const relative=_dir.length();
   if(relative>1e-5){
    _dir.divideScalar(relative).applyQuaternion(_inv);
    const area=4*(Math.abs(_dir.x)*e.y*e.z+Math.abs(_dir.y)*e.x*e.z+Math.abs(_dir.z)*e.x*e.y)*portion/(.55*.55);
    const magnitude=relative*Math.min(limit,.61*area*relative*(1-wet));
    _force.addScaledVector(_dir.applyQuaternion(_rot),magnitude);
   }
  }
  if(_force.lengthSq()){
   if(needsSamples){recordLoad(record,_force,_pt,null,sample.region);if(dynamic)b.addForceAtPoint(_force,_pt,true);}
   else{_netForce.add(_force);_cross.crossVectors(_arm,_force);_netTorque.add(_cross);}
  }
 }
 if(!needsSamples&&dynamic&&(_netForce.lengthSq()||_netTorque.lengthSq())){
  b.addForce(_netForce,true);
  b.addTorque(_netTorque,true);
 }
 const wet=wetVolume/record.fluidVolume;
 if(sea&&record.wetFraction!==undefined&&record.wetFraction<.1&&wet>=.1&&b.linvel().y<-.9){
  record.entryImpact=true;
 }
 record.wetFraction=wet;
}

// Probe the actual collision surface, including holes in compound sculpts and fixed parts.
export function waveImpact(sim,record){
 const sea=sim.sea??sim.pondSea,entry=record.entryImpact,b=record.body;
 if(!entry&&(sea.speed<4||sea.time<(record.nextProbe||0)))return;
 const center=new Vector3().copy(record.probeCenter).applyQuaternion(b.rotation()).add(b.translation());
 sampleWaveContact(sea,record,center,record.probeRadius,b.linvel(),(origin,dir,reach)=>{
  const ray=new sim.R.Ray(origin,dir);
  const hit=sim.world.castRayAndGetNormal(ray,reach,true,undefined,undefined,undefined,undefined,c=>c.parent()?.handle===b.handle);
  return hit&&{point:ray.pointAt(hit.timeOfImpact),normal:hit.normal};
 });
}
export function sampleWaveContact(sea,record,center,radius,velocity,probe){
 const entry=record.entryImpact;
 record.entryImpact=false;record.nextProbe=sea.time+.18;
 const level=sea.height(center.x,center.z);
 if(sea.bedHeight&&sea.bedHeight(center.x,center.z)>=level)return;
 if(Math.abs(center.y-level)>radius+.08)return;
 const flow=sea.flow(center.x,center.z),relative=(flow.x-velocity.x)*sea.wx+(flow.z-velocity.z)*sea.wz;
 if(!entry&&(flow.y<.12||relative<.23||sea.time<(record.nextBreaker||0)))return;
 record.probes=(record.probes||0)+1;
 const lateral=Math.sin(record.probes*2.39996)*.53*radius;
 const x=center.x-sea.wz*lateral,z=center.z+sea.wx*lateral;
 const hit=probe({x:x-sea.wx*(radius+.12),y:sea.height(x,z),z:z-sea.wz*(radius+.12)},
  {x:sea.wx,y:0,z:sea.wz},2*radius+.24);
 if(!hit)return;
 const {point,normal}=hit,sx=point.x+.06*normal.x,sz=point.z+.06*normal.z;
 if(entry){sea.splash(sx,sz,Math.min(2.4,.4+Math.abs(velocity.y)*.13,radius*2),normal.x*.5,normal.z*.5);}
 else{
  const length=Math.hypot(normal.x,normal.z)||1;
  sea.breakCrest(sx,sz,Math.min(2.5,relative*.7+flow.y*.4),normal.x/length,normal.z/length,false,radius);
 }
 record.nextBreaker=sea.time+.38;
}
