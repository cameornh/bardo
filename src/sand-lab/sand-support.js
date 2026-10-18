import {shapeRadius,shapeHeight,shapeDistance} from './sand-shape.js';
import {sandAdhesion} from './sand-material.js';

// Vertical intervals of the actual CSG, including removed material. A brush's
// bounding sphere is not a contact surface after part of it has been cut away.
export function sandColumn(p,x,z){
 const r=shapeRadius(p),a=p.aspect||1,rr=r*r-x*x-z*z;
 if(rr<=0)return [];
 let spans=[[-Math.sqrt(rr)*a,Math.sqrt(rr)*a]];
 for(const c of p.cuts||[]){
  const rr=c.radius*c.radius-(x-c.offset[0])**2-(z-c.offset[2])**2;
  if(rr<=0){if(c.radius<0)return [];continue;}
  const dy=Math.sqrt(rr)*(c.aspect||1),lo=c.offset[1]-dy,hi=c.offset[1]+dy,next=[];
  for(const [low,high] of spans){
   if(c.radius<0){if(Math.min(high,hi)>Math.max(low,lo))next.push([Math.max(low,lo),Math.min(high,hi)]);}
   else if(high<=lo||low>=hi)next.push([low,high]);
   else{if(low<lo)next.push([low,lo]);if(high>hi)next.push([hi,high]);}
  }
  spans=next;
 }
 return spans;
}

const disk=[[0,0],...Array.from({length:24},(_,i)=>{const r=Math.sqrt((i+.5)/24)*.97,a=i*2.399963229728653;return [Math.cos(a)*r,Math.sin(a)*r];})];
const feetCache=new WeakMap();
export function sandFeet(p){
 const r=shapeRadius(p),a=p.aspect||1,old=feetCache.get(p);
 if(old&&old.r===r&&old.a===a&&old.cuts===p.cuts)return old.feet;
 const feet=[];
 for(const [u,v] of disk){const x=u*r,z=v*r,spans=sandColumn(p,x,z);if(spans.length)feet.push([x,spans[0][0],z]);}
 feetCache.set(p,{r,a,cuts:p.cuts,feet});return feet;
}

export const hasSandBond=p=>sandAdhesion(p.wet,p.memory||0)>=.16;

// Loose grains transmit compression from below, never tensile support from a
// side or from above. Only a bond between two cohesive materials can hang.
export function supportsSand(lower,upper){
 const r=shapeRadius(lower),s=shapeRadius(upper),bonded=hasSandBond(lower)&&hasSandBond(upper);
 const tolerance=bonded?Math.min(.08,Math.min(r,s)*.5)*.45:.002;
 const delta=upper.position.map((v,k)=>v-lower.position[k]),d=Math.hypot(...delta);
 if(d>r+s+tolerance)return false;
 if(!bonded&&upper.position[1]<=lower.position[1])return false;
 const axis=d>1e-12?delta.map(v=>v/d):[0,1,0];
 const rp=r/Math.hypot(axis[0],axis[1]/(lower.aspect||1),axis[2]),rq=s/Math.hypot(axis[0],axis[1]/(upper.aspect||1),axis[2]);
 const contact=lower.position.map((v,k)=>v+delta[k]*rp/(rp+rq));
 if(shapeDistance(lower,contact)<=tolerance&&shapeDistance(upper,contact)<=tolerance)return true;
 return sandFeet(upper).some(foot=>shapeDistance(lower,foot.map((v,k)=>v+upper.position[k]))<=tolerance);
}

// Resolve a loose deposit into a fixed number of independently supported
// patches once, not recursively every frame. Their volumes and moisture sum
// to the parent stock. Overhangs can then fall while supported grains stay.
export function loosePatches(p,nextId){
 const r=shapeRadius(p),samples=[];
 for(const [u,v] of disk){const x=u*r,z=v*r,spans=sandColumn(p,x,z),weight=spans.reduce((n,[a,b])=>n+b-a,0);if(weight>0)samples.push({x,z,spans,weight});}
 if(samples.length<2)return [];
 const total=samples.reduce((n,p)=>n+p.weight,0),stock=p.mass,origin=p.position.slice(),velocity=p.velocity.slice(),patches=[];
 let assigned=0;
 for(let i=0;i<samples.length;i++){
  const s=samples[i],mass=i===samples.length-1?stock-assigned:stock*s.weight/total;
  const q={...p,id:i?nextId():p.id,mass,aspect:.85,cuts:undefined,shapeRadius:undefined,
   position:[origin[0]+s.x,origin[1]+(s.spans[0][0]+s.spans.at(-1)[1])*.5,origin[2]+s.z],
   spreadOffset:[s.x,s.z],spreadRemaining:.55,
   velocity:velocity.slice(),anchored:false,layer:true,looseResolved:true,layerGroup:p.id};
  // Spread at the existing surface rather than starting inside the support.
  q.position[1]=Math.max(q.position[1],origin[1]-shapeHeight(p)+shapeHeight(q));
  assigned+=mass;patches.push(q);
 }
 Object.assign(p,patches[0]);patches[0]=p;return patches;
}
