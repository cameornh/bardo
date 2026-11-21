import {Vector3, Quaternion} from 'three';

// At most eight displaced-volume samples per body, independent of view or render spacing.
export function flotationSamples(shapes,scale){
 const points=[],centroid=new Vector3();let total=0;
 for(const s of shapes){
  const box=s.type==='box',h=box?s.half:[s.radius,s.radius+(s.halfHeight||0),s.radius];
  const v0=box?8*h[0]*h[1]*h[2]:Math.PI*s.radius**2*(4*s.radius/3+2*(s.halfHeight||0));
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

export function applyEnvironment(record,sea,waterDensity,wind,gravity,dt){
 const b=record.body;
 if(!b.isDynamic())return;
 const center=new Vector3().copy(b.translation()),rotation=new Quaternion().copy(b.rotation());
 const inverse=rotation.clone().invert(),up=new Vector3(0,1,0).applyQuaternion(inverse);
 const angle=wind.heading*Math.PI/180,wx=Math.cos(angle),wz=Math.sin(angle);
 const pt=new Vector3(),velocity=new Vector3(),force=new Vector3(),dir=new Vector3();
 let wetVolume=0;
 const flow=sea?.flow(center.x,center.z);
 for(const sample of record.floats){
  pt.copy(sample.p).applyQuaternion(rotation).add(center);
  const e=sample.extent,r=Math.max(.01,Math.abs(up.x)*e.x+Math.abs(up.y)*e.y+Math.abs(up.z)*e.z);
  const wet=sea?Math.max(0,Math.min(1,.5+(sea.height(pt.x,pt.z)-pt.y)/(2*r))):0;
  const portion=sample.volume/record.fluidVolume,limit=b.mass()*portion*.38/dt;
  velocity.copy(b.velocityAtPoint(pt));force.set(0,0,0);
  if(wet){
   wetVolume+=wet*sample.volume;
   const mass=sample.volume*waterDensity*wet;
   dir.copy(flow).sub(velocity);
   force.copy(dir).multiplyScalar(Math.min(mass*(2+.45*dir.length()),limit));force.y+=mass*gravity;
  }
  if(wind.speed>0&&wet<1){
   // Integrate air pressure over exposed faces. Off-centre pressure loads the joint.
   const speed=wind.speed*(.72+.28*Math.min(1,Math.max(0,pt.y)/2));
   dir.set(speed*wx,0,speed*wz).sub(velocity);const relative=dir.length();
   if(relative>1e-5){
    dir.divideScalar(relative).applyQuaternion(inverse);
    const area=4*(Math.abs(dir.x)*e.y*e.z+Math.abs(dir.y)*e.x*e.z+Math.abs(dir.z)*e.x*e.y)*portion/(.55*.55);
    const magnitude=relative*Math.min(limit,.61*area*relative*(1-wet));
    force.addScaledVector(dir.applyQuaternion(rotation),magnitude);
   }
  }
  if(force.lengthSq())b.addForceAtPoint(force,pt,true);
 }
 const wet=wetVolume/record.fluidVolume;
 if(sea&&record.wetFraction!==undefined&&record.wetFraction<.1&&wet>=.1&&b.linvel().y<-.9){
  record.entryImpact=true;
 }
 record.wetFraction=wet;
}

// Probe the actual collision surface, including holes in compound sculpts and fixed parts.
export function waveImpact(sim,record){
 const sea=sim.sea,entry=record.entryImpact,b=record.body;
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
 if(entry){sea.splash(sx,sz,Math.min(2.4,1+Math.abs(velocity.y)*.13),normal.x*.5,normal.z*.5);}
 else{
  const length=Math.hypot(normal.x,normal.z)||1;
  sea.ripple(sx,sz,Math.min(.12,.034*(relative+flow.y)));
  sea.breakCrest(sx,sz,Math.min(2.5,relative*.7+flow.y*.4),normal.x/length,normal.z/length);
 }
 record.nextBreaker=sea.time+.38;
}
