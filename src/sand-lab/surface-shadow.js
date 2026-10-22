import {SAND_BOUNDS_GLSL,sandRayInterval,sandCellExit} from './surface-trace.js';

// Visibility belongs at the receiver, not in a coarse absorption voxel. This
// bounded query only visits the detached sand's bounds and occupied x/z bins;
// water, glass, and the base terrain retain their existing transport queries.
export const SAND_SHADOW_GLSL=`
${SAND_BOUNDS_GLSL}
float sandVisibility(vec3 p,vec3 direction){
 if(uSandCount==0)return 1.;
 vec2 interval=sandRayInterval(p,direction);float t=max(.002,interval.x+.00001);
 if(interval.y<t)return 1.;float visibility=1.;
 for(int i=0;i<128;i++){
  if(t>interval.y)break;vec3 q=p+direction*t;float h=sandDistance(q);
  if(h<.00003)return 0.;
  // The finite solar disk makes silhouettes fade continuously as they move.
  visibility=min(visibility,clamp(h/max(.0001,t*.0093),0.,1.));
  t+=min(max(.00001,h*.7),sandCellExit(q,direction));
 }
 return visibility;
}
// Short-range diffuse occlusion follows the same smooth shape. Unlike opaque
// flags in a low resolution grid, this is continuous as a clump translates.
float sandAmbientVisibility(vec3 p,vec3 n){
 if(!uMediumShadows||uSandCount==0)return 1.;float occlusion=0.,weight=.5;
 for(int i=0;i<4;i++){
  float reach=.035*exp2(float(i));float h=sandDistance(p+n*reach);
  occlusion+=weight*clamp(1.-h/(reach*.65),0.,1.);weight*=.5;
 }
 return 1.-occlusion*.8;
}
`;

export function sandVisibility(origin,direction,{distance,min,max}){
 const [enter,exit]=sandRayInterval(origin,direction,min,max);let t=Math.max(.002,enter+.00001),visibility=1;
 for(let i=0;i<128&&t<=exit;i++){
  const p=origin.map((v,k)=>v+direction[k]*t),h=distance(p);
  if(h<.00003)return 0;
  visibility=Math.min(visibility,Math.max(0,Math.min(1,h/Math.max(.0001,t*.0093))));
  t+=Math.min(Math.max(.00001,h*.7),sandCellExit(p,direction));
 }
 return visibility;
}
