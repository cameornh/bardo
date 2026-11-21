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
 const b=record.body;if(!b.isDynamic())return;
 const v=new Vector3().copy(b.linvel()),center=new Vector3().copy(b.translation());
 const rotation=new Quaternion().copy(b.rotation());
 let wetVolume=0;
 if(sea){
  const up=new Vector3(0,1,0).applyQuaternion(rotation.clone().invert());
  for(const sample of record.floats){
   const pt=sample.p.clone().applyQuaternion(rotation).add(center);
   const e=sample.extent,r=Math.max(.01,Math.abs(up.x)*e.x+Math.abs(up.y)*e.y+Math.abs(up.z)*e.z);
   const fraction=Math.max(0,Math.min(1,.5+(sea.height(pt.x,pt.z)-pt.y)/(2*r)));
   if(!fraction)continue;wetVolume+=fraction*sample.volume;
   const mass=sample.volume*waterDensity*fraction;
   const velocity=new Vector3().copy(b.velocityAtPoint(pt));
   const drag=Math.min(mass*(2+.45*velocity.length()),.4*b.mass()*sample.volume/record.fluidVolume/dt);
   const force=velocity.multiplyScalar(-drag);force.y+=mass*gravity;
   b.addForceAtPoint(force,pt,true);
  }
  // Crossing the surface can disturb it locally without activating a particle ocean.
  const wet=wetVolume/record.fluidVolume;
  if(record.wetFraction!==undefined&&record.wetFraction<.1&&wet>=.1&&v.y<-.9&&sea.time>=(record.nextImpact||0)){
   sea.splash(center.x,center.z);record.nextImpact=sea.time+.45;
  }
  record.wetFraction=wet;
 }
 if(wind.speed>0){const angle=wind.heading*Math.PI/180;
  const flow=new Vector3(wind.speed*Math.cos(angle),0,wind.speed*Math.sin(angle)).sub(v);
  const drag=(1-wetVolume/record.fluidVolume)*.35*record.fluidVolume**(2/3)*flow.length();b.addForce(flow.multiplyScalar(Math.min(drag,b.mass()*.25/dt)),true);
 }
}
