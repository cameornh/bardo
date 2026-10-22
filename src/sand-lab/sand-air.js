import {windAt,windNoise,BEACH_WIND_GLSL} from '../beach-wind.js';
import {normalAt} from './water-lab-model.js';
import {obstacleAir} from './water-lab-air.js';
import {bodyDistance} from './objects.js';
import {SandAirGeometry} from './sand-air-geometry.js';
import {solidRayHit} from './interaction.js';

// Sand needs the velocity at its actual surface. Interpolating the coarse air
// lattice mixes buried zero-velocity nodes into it and can miss a whole brush.
// Evaluate the same forcing/obstacle model locally; the grain GPU uses it too.
export function createSandWind(lab){
 const solid=p=>{let d=lab.sand.distance(p);for(const b of lab.balls||[])d=Math.min(d,bodyDistance(p,b));return d;};
 const jet=lab.jet,hit=jet?solidRayHit(lab.sand,lab.balls||[],jet.origin,jet.direction,30):null;
 const brush=hit?{...hit,normal:normalAt(hit.point,solid),radius:lab.radius}:null;
 const forcing={spec:lab.spec,time:lab.time,wind:lab.wind,windTurbulence:lab.windTurbulence,windStrength:lab.windStrength,radius:lab.radius,jet};
 const geometry=lab.optimizations?.windGeometry?new SandAirGeometry(lab.sand,lab.balls||[]):null;
 let batched=false;
 const sample=p=>{if(geometry&&!batched)geometry.refresh();return sandAirVelocity(p,forcing,geometry?geometry.solid:solid,brush);};
 if(geometry){sample.beginBatch=(spatial=true)=>{geometry.refresh(spatial);batched=true;};sample.endBatch=()=>{batched=false;};}
 sample.forcing=forcing;
 sample.brush=brush;sample.normal=p=>normalAt(p,solid);return sample;
}
export function sandAirVelocity(p,lab,solid,brush=null){
 if(solid(p)<0)return [0,0,0];
 const scale=lab.spec.scale,t=lab.time,speed=lab.wind,turbulence=lab.windTurbulence??1;
 const w=windAt(p[0]*scale,p[2]*scale,t,speed,0,turbulence),q=[p[0]*scale*.4+p[1]*.7,p[2]*scale*.4-t*speed*.07];
 const v=[w[0]+speed*turbulence*.45*(windNoise(q[0]+9,q[1]+17)-.5),speed*turbulence*.28*(windNoise(q[0]+31,q[1]+5)-.5),w[1]];
 if(lab.jet){const delta=p.map((v,k)=>v-lab.jet.origin[k]),along=delta.reduce((s,v,k)=>s+v*lab.jet.direction[k],0),r2=delta.reduce((s,v,k)=>s+(v-along*lab.jet.direction[k])**2,0),weight=along>0?Math.exp(-r2/lab.radius**2)*Math.exp(-along/25):0;
  for(let k=0;k<3;k++)v[k]+=lab.jet.direction[k]*lab.windStrength*weight;
 }
 const out=obstacleAir(p,v,solid);
 // An impinging jet turns into a wall jet. Do not discard all its momentum
 // when the cursor is aimed straight down at the sand.
 if(brush&&lab.jet){const n=brush.normal,d=p.map((v,k)=>v-brush.point[k]),h=d.reduce((s,v,k)=>s+v*n[k],0),tangent=d.map((v,k)=>v-n[k]*h),r=Math.hypot(...tangent),incidence=Math.max(0,-n.reduce((s,v,k)=>s+v*lab.jet.direction[k],0)),weight=Math.exp(-r*r/(brush.radius**2))*Math.exp(-Math.max(0,h)/Math.max(.01,brush.radius*.5))*Math.exp(-brush.distance/25)*incidence*lab.windStrength;
  if(h>=-.005)for(let k=0;k<3;k++)out[k]+=weight*(.7*tangent[k]/Math.max(r,brush.radius*.15)+.12*n[k]);
 }
 return out.map(v=>v/scale);
}
export const SAND_AIR_GLSL=`
uniform float uAirTime,uAirScale,uAirSpeed,uAirTurbulence,uAirJetStrength,uAirRadius;
uniform vec3 uAirJetOrigin,uAirJetDirection,uSandBrushPoint,uSandBrushNormal;
uniform float uSandBrushDistance;
${BEACH_WIND_GLSL}
vec3 sandAir(vec3 p){
 vec2 w=beachWind(p.xz*uAirScale,uAirTime,uAirSpeed,0.,uAirTurbulence),q=vec2(p.x*uAirScale*.4+p.y*.7,p.z*uAirScale*.4-uAirTime*uAirSpeed*.07);
 vec3 v=vec3(w.x+uAirSpeed*uAirTurbulence*.45*(windNoise(q+vec2(9,17))-.5),uAirSpeed*uAirTurbulence*.28*(windNoise(q+vec2(31,5))-.5),w.y);
 vec3 delta=p-uAirJetOrigin;float along=dot(delta,uAirJetDirection);if(along>0.)v+=uAirJetDirection*uAirJetStrength*exp(-dot(delta-along*uAirJetDirection,delta-along*uAirJetDirection)/(uAirRadius*uAirRadius))*exp(-along/25.);
 float distance=labPhysicalSolid(p),speed=length(v);if(distance<0.)return vec3(0);vec3 outV=v;
 if(speed>1e-8){if(distance<1.2){float e=.003;vec3 n=vec3(labPhysicalSolid(p+vec3(e,0,0))-labPhysicalSolid(p-vec3(e,0,0)),labPhysicalSolid(p+vec3(0,e,0))-labPhysicalSolid(p-vec3(0,e,0)),labPhysicalSolid(p+vec3(0,0,e))-labPhysicalSolid(p-vec3(0,0,e)));n/=max(length(n),1e-12);outV-=n*dot(v,n)*pow(1.-distance/1.2,2.);}
 float t=.08,shelter=0.;for(int i=0;i<8;i++){if(t>=2.4)break;float d=labPhysicalSolid(p-v/speed*t);if(d<.015){shelter=.8*(1.-t/3.);break;}t+=max(.035,d*.8);}outV*=1.-shelter;}
 if(uSandBrushDistance>=0.){vec3 d=p-uSandBrushPoint;float h=dot(d,uSandBrushNormal);vec3 tangent=d-uSandBrushNormal*h;float r=length(tangent),incidence=max(0.,-dot(uSandBrushNormal,uAirJetDirection)),weight=exp(-r*r/(uAirRadius*uAirRadius))*exp(-max(0.,h)/max(.01,uAirRadius*.5))*exp(-uSandBrushDistance/25.)*incidence*uAirJetStrength;
 if(h>=-.005)outV+=weight*(.7*tangent/max(r,uAirRadius*.15)+.12*uSandBrushNormal);}
 return outV/uAirScale;
}`;
