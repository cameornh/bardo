import {waterWindDrag,waterWindPressure} from './wind-response.js';
import {labAirVelocity} from './water-lab-air.js';
import {normalAt} from './water-lab-model.js';
// Same predictor as the reference ocean path, without two slices, three
// temporary vectors and a callback per parcel. No water/force term is omitted.
export function predictBeach(lab,old,predicted,dt){
 const s=lab.spacing,scale=lab.spec.scale,velocity=lab.velocities,p=[0,0,0],v=[0,0,0],limit=s*.45/dt,gravity=9.81/scale*dt;
 for(let o=0;o<old.length;o+=4){if(old[o+3])continue;const i=o/4;
  p[0]=old[o];p[1]=old[o+1];p[2]=old[o+2];v[0]=velocity[o];v[1]=velocity[o+1]-gravity;v[2]=velocity[o+2];
  if((lab.chem[o+3]>.01||lab.sampleFastSurface(i))&&(lab.wind||lab.jet)){
   const air=lab.air.grid?lab.air.sampleGrid(p):labAirVelocity(p,lab);
   for(let k=0;k<3;k++){const relative=air[k]-v[k];v[k]+=dt*(lab.jet?.025:waterWindDrag(lab.wind,lab.reactiveWaves))*relative*Math.abs(relative);}
   v[1]-=dt*waterWindPressure(p[0]*scale,p[2]*scale,lab.time,lab.wind,lab.windTurbulence,lab.reactiveWaves)*Math.min(1,(Math.hypot(...air)*scale/Math.max(lab.wind,1e-6))**2)/(scale*Math.max(.2,s*scale));
  }
  if(lab.player&&lab.playerDistance(p)<s){const n=normalAt(p,q=>lab.playerDistance(q)),relative=lab.player.velocity.reduce((sum,x,k)=>sum+(x-v[k])*n[k],0),w=Math.max(0,Math.min(1,1-lab.playerDistance(p)/s));if(relative>0)for(let k=0;k<3;k++)v[k]+=n[k]*relative*w*.22;}
  const speed=Math.hypot(...v);if(speed>limit)for(let k=0;k<3;k++)v[k]*=limit/speed;
  predicted[o]=p[0]+v[0]*dt;predicted[o+1]=p[1]+v[1]*dt;predicted[o+2]=p[2]+v[2]*dt;
 }
}
