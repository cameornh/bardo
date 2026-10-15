import {densityAt} from './water-lab-model.js';

// The player displaces the liquid. Sampling inside that cavity incorrectly
// disables buoyancy; integrate wetness immediately outside the capsule.
export function playerImmersion(positions,eye,radius,height,spacing){
 let wet=0;const reach=radius+spacing*.65;
 for(const fraction of [0,.5,1])for(let i=0;i<6;i++){
  const angle=i*Math.PI/3,p=[eye[0]+Math.cos(angle)*reach,eye[1]-height+radius+fraction*(height-2*radius),eye[2]+Math.sin(angle)*reach];
  wet+=Math.max(0,Math.min(1,(densityAt(positions,p,spacing)-.12)/.55));
 }
 return wet/18;
}

// Keep full geometric displacement, but suppress the extra outward launch
// velocity introduced when the kinematic player projects a parcel away.
export function softenPlayerImpulse(velocity,predictedVelocity,normal,weight){
 const outward=Math.max(0,velocity.reduce((sum,v,k)=>sum+(v-predictedVelocity[k])*normal[k],0));
 return velocity.map((v,k)=>v-normal[k]*outward*.75*weight);
}
