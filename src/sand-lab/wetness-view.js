import {solidRayHit} from './interaction.js';
import {sandIsTracer,shapeDistance,shapeBlend} from './sand-shape.js';
const clamp=x=>Math.max(0,Math.min(1,x));
// Amber (dry) -> teal (damp) -> blue (saturated). Diagnostic color is unlit.
export const wetnessColor=wet=>{const w=clamp(wet);return [.9-.85*w,.3+.45*4*w*(1-w),.04+.91*w];};
export const WETNESS_VIEW_GLSL=`uniform bool uSandWetnessView;
vec3 sandWetnessColor(float wet){float w=clamp(wet,0.,1.);return vec3(.9-.85*w,.3+.45*4.*w*(1.-w),.04+.91*w);}`;

// The surface color blends at a smooth union, but the label reports the actual
// dominant parcel's value, not a misleading average with the ground beneath.
export function inspectSandMaterial(sand,point){
 let distance=(point[1]-sand.height(point[0],point[2]))*.65,weight=1,parcel=null;
 for(const p of sand.parcels){
  if(p.mass<=0||sandIsTracer(p))continue;
  const q=shapeDistance(p,point),blend=shapeBlend(p),h=clamp(.5+.5*(distance-q)/Math.max(blend,.00001));
  weight*=1-h;if(h>weight){parcel=p;weight=h;}
  const t=Math.max(blend-Math.abs(distance-q),0)/Math.max(blend,.00001);
  distance=Math.min(distance,q)-t*t*blend*.25;
 }
 return {wetness:clamp(parcel?parcel.wet:sand.sample(point[0],point[2])),parcel};
}
export function inspectSandRay(sand,bodies,origin,direction){
 const hit=solidRayHit({distance:p=>sand.distance(p,true)},bodies.map(b=>b.held?{...b,held:false}:b),origin,direction);
 return hit?.kind==='sand'?{...inspectSandMaterial(sand,hit.point),point:hit.point}:null;
}
