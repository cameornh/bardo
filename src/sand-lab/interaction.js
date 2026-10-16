import {boundaryMetric} from './water-lab-model.js';
import {bodyDistance} from './objects.js';

const at=(o,d,t)=>o.map((v,k)=>v+d[k]*t);
export function carryDistance(extent,scale){return extent+Math.max(1/scale,extent*.18);}
export function heldDistance(lab){return lab.heldBody?lab.objectDistance:lab.sandHeld?.length?(lab.sandHoldDistance??carryDistance(lab.radius,lab.spec.scale)):lab.held?.ids?.length?lab.held.distance:null;}
// Wheel events use pixels, lines or pages depending on the device. Up is a
// negative delta: increase distance. Keep the held volume outside the camera.
export function scrollHeldDistance(lab,deltaY,deltaMode=0){
 const selections=[],scale=lab.spec.scale;
 if(lab.heldBody){const b=lab.heldBody;selections.push([lab,'objectDistance',b.radius*(b.shape==='cup'?1.55:1)]);}
 if(lab.sandHeld?.length){const extent=Math.max(...lab.sandHeld.map(p=>Math.hypot(...p.offset)+Math.cbrt(p.mass/(p.packing*4*Math.PI/3))));selections.push([lab,'sandHoldDistance',extent]);}
 if(lab.held?.ids?.length){const extent=Math.max(...lab.held.offsets.map(p=>Math.hypot(...p)))+lab.spacing*.8;selections.push([lab.held,'distance',extent]);}
 if(!selections.length)return false;
 if(!Number.isFinite(deltaY)||deltaY===0)return true;
 const pixels=deltaY*(deltaMode===1?16:deltaMode===2?640:1),factor=Math.exp(-Math.max(-600,Math.min(600,pixels))*.0015);
 for(const [holder,key,extent] of selections){const near=extent+Math.max(.04,.15/scale),far=Math.max(100/scale,extent*4,near);holder[key]=Math.max(near,Math.min(far,(holder[key]??carryDistance(extent,scale))*factor));}
 return true;
}
// A click queries the first solid surface, including loose sand and hollow
// objects. Simulation bounding walls are not pickable and the player is omitted.
export function solidRayHit(sand,bodies,origin,direction,maxDistance=150){
 let nearest=null,t=.005;
 for(let i=0;i<2400&&t<maxDistance;i++){
  const p=at(origin,direction,t),inside=Math.abs(p[0])<=5.5&&Math.abs(p[2])<=4.9;
  const distance=inside?sand.distance(p):Math.max(Math.abs(p[0])-5.5,Math.abs(p[2])-4.9,.03);
  if(inside&&distance<.003){const b=boundaryMetric(p,q=>sand.distance(q)),incidence=b.normal.reduce((sum,v,k)=>sum+v*direction[k],0);if(Math.abs(incidence)>.05)t=Math.max(.005,t-b.distance/incidence);nearest={kind:'sand',point:at(origin,direction,t),distance:t};break;}
  t+=Math.max(.003,Math.min(.15,distance*.7));
 }
 for(const body of bodies){if(body.held)continue;t=.005;
  for(let i=0;i<240&&t<(nearest?.distance??maxDistance);i++){
   const p=at(origin,direction,t),distance=bodyDistance(p,body);
   if(distance<.003){nearest={kind:'object',body,point:p,distance:t};break;}
   t+=Math.max(.003,distance*.8);
  }
 }
 return nearest;
}
// Intersect finite parcel supports, rather than picking whichever centre is
// closest along a wide cylinder. Solids limit the ray so water behind land or
// an object cannot be grabbed through it.
export function waterRayHit(positions,spacing,origin,direction,limit=150){
 let nearest=limit;const radius=spacing*.8;
 for(let i=0;i<positions.length;i+=4){
  const q=[0,1,2].map(k=>origin[k]-positions[i+k]),b=q.reduce((s,v,k)=>s+v*direction[k],0),h=b*b-q.reduce((s,v)=>s+v*v,0)+radius*radius;
  if(h<0||-b+Math.sqrt(h)<.005)continue;
  const t=Math.max(.005,-b-Math.sqrt(h));if(t<nearest)nearest=t;
 }
 return nearest<limit?{kind:'water',distance:nearest,point:at(origin,direction,nearest)}:null;
}

// Sub-resolution water tools select the nearest existing parcel. They never
// silently create smaller simulation particles or increase the sample budget.
export function selectWaterParcels(positions,point,radius,spacing){
 const ids=[];let nearest=-1,best=Infinity;
 for(let i=0;i<positions.length/4;i++){const d=Math.hypot(...point.map((v,k)=>v-positions[i*4+k]));if(d<=radius)ids.push(i);if(d<best){best=d;nearest=i;}}
 if(!ids.length&&nearest>=0&&best<=spacing*.81)ids.push(nearest);
 return ids;
}
