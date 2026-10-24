import {LAB_PRESETS} from './water-lab-model.js';
import {beachHeight} from './sand.js';

// Live beach only. Snapshot fixtures retain their original normalized scale.
// Width changes horizontal extent; depth and the metre-sized sampling lattice
// stay fixed. The camera never enters the simulation resolution calculation.
export function beachScalePlan(multiplier=1,quality=2.2){
 const scale=10*Math.max(.4,Math.min(2,multiplier)),q=Math.max(1,Math.min(3,quality)),spacingMeters=4.2/q;
 const sandCells=Math.ceil(11*scale/(spacingMeters*.9))+1;
 return {scale,spacing:spacingMeters/scale,spacingMeters,sandCells,heightScale:10/scale,quality:q,
  // Grow storage with area, not by silently coarsening the selected resolution.
  particleBudget:Math.max(8192,Math.ceil(32768*(scale/10)**2/64)*64),depthMeters:16.5};
}
export function seedBeach(plan){
 const {spacing:s,scale,heightScale}=plan,items=[];
 // Initial occupied depth matches the old coarse seed's extent. Seed directly
 // on the requested lattice so higher resolution doesn't inherit coarse gaps.
 const low=.03*heightScale,high=1.29*heightScale;
 for(let z=-4.61+s*.5;z<4.71;z+=s)for(let y=low+s*.5;y<high;y+=s)for(let x=-4.91+s*.5;x<5.01;x+=s){
  if(y<physicalBeachHeight(x,z,plan)+s*.12)continue;
  items.push({p:[x,y,z],v:[0,0,0]});
 }
 if(items.length>plan.particleBudget)throw Error('Beach sampling exceeded its planned storage.');
 return {items,spec:{...LAB_PRESETS.ocean,scale,spacing:s},resolution:plan.quality*scale/10,
  resolutionInfo:{factor:plan.quality*scale/10,requested:plan.quality*scale/10,targetSpacing:plan.spacingMeters,budget:plan.particleBudget,limited:false}};
}
// Expand around the same metre-space shoreline and landmarks. Stretching
// the shore with the bounding box would submerge the fixed boulders as the
// beach widens, even though their own dimensions had stayed constant.
export const physicalBeachHeight=(x,z,plan)=>beachHeight(x/plan.heightScale,z/plan.heightScale)*plan.heightScale;
export function scaleBeachStock(sand,plan){
 for(let j=0;j<sand.n;j++)for(let i=0;i<sand.n;i++){
  const k=j*sand.n+i;sand.base[k]=physicalBeachHeight(i*sand.dx-5.5,j*sand.dz-4.9,plan)-.7*plan.heightScale;sand.mass[k]*=plan.heightScale;
 }
 sand.initialMass=sand.totalMass();sand.update();
}
