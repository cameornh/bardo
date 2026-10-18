import {shapeRadius,shapeBlend} from './sand-shape.js';

// Exact comparisons are deliberate: this cache never suppresses a small edit.
// Moisture is excluded; it changes appearance without moving the solid surface.
export class SandShapeStamp {
 constructor(){this.values=new Float64Array(0);this.cuts=[];this.length=-1;}
 changed(parcels){
  let changed=this.length!==parcels.length;this.length=parcels.length;
  if(this.values.length<parcels.length*10)this.values=new Float64Array(parcels.length*20+10).fill(NaN);
  for(let i=0;i<parcels.length;i++){
   const p=parcels[i],o=i*10,values=[p.id||0,...p.position,shapeRadius(p),Number(!!p.held),Number(!!p.anchored),p.mass>0?1:0,p.aspect||1,shapeBlend(p)];
   for(let k=0;k<10;k++){if(this.values[o+k]!==values[k])changed=true;this.values[o+k]=values[k];}
   // CSG edits replace the immutable cuts array.
   if(this.cuts[i]!==p.cuts)changed=true;this.cuts[i]=p.cuts;
  }
  this.cuts.length=parcels.length;return changed;
 }
}
