import {bodyDistance} from './objects.js';

const at=(o,d,t)=>o.map((v,k)=>v+d[k]*t);
export function carryDistance(extent,scale){return extent+Math.max(1/scale,extent*.18);}
// A click queries the first solid surface, including loose sand and hollow
// objects. Simulation bounding walls are not pickable and the player is omitted.
export function solidRayHit(sand,bodies,origin,direction,maxDistance=150){
 let nearest=null,t=.005;
 for(let i=0;i<2400&&t<maxDistance;i++){
  const p=at(origin,direction,t),inside=Math.abs(p[0])<=5.5&&Math.abs(p[2])<=4.9;
  const distance=inside?sand.distance(p):Math.max(Math.abs(p[0])-5.5,Math.abs(p[2])-4.9,.03);
  if(inside&&distance<.003){nearest={kind:'sand',point:p,distance:t};break;}
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
