import {LabBlobFamilies} from '../sand-lab/water-lab-blobs.js';

// Presentation metadata only. Never filter positions, velocities, solver
// neighbors, volume, or chemistry. Count thresholds otherwise resize every
// Gaussian at once when a neighbor shell enters/leaves the search radius.
export class WaterSurfaceState {
 update(lab){
  const reset=this.generation!==lab.generation||this.spacing!==lab.spacing||lab.count<this.count||lab.time<this.time,oldCount=reset?0:this.count,step=lab.steps??lab.time;
  if(reset||this.count!==lab.count){const counts=new Float32Array(lab.count);if(!reset)counts.set(this.counts);this.counts=counts;}
  if(!reset&&this.step===step&&this.count===lab.count)return this.counts;
  const dt=reset?0:Math.max(0,lab.time-this.time),weight=1-Math.exp(-dt/.18);
  for(let i=0;i<lab.count;i++){
   const target=lab.neighborCounts?.[i]??25;
   this.counts[i]=i>=oldCount?target:this.counts[i]+(target-this.counts[i])*weight;
  }
  this.generation=lab.generation;this.spacing=lab.spacing;this.count=lab.count;this.step=step;this.time=lab.time;return this.counts;
 }
}

// A transient thin sheet is not a detached drop. Confirm separation in
// simulation time before handing a parcel to the analytic daughter renderer.
// Existing daughters keep the original smooth return to the bulk field.
export class StableBlobFamilies extends LabBlobFamilies {
 update(lab){
  const reset=this.generation!==lab.generation||this.spacing!==lab.spacing||lab.count<this.count||lab.time<this.confirmTime,step=lab.steps??lab.time;
  if(reset||this.count!==lab.count){const ages=new Float32Array(lab.count);if(!reset)ages.set(this.sparseAge);this.sparseAge=ages;this.count=lab.count;}
  if(reset){this.active.clear();this.generation=lab.generation;this.confirmStep=undefined;}
  const dt=reset?0:Math.max(0,lab.time-(this.confirmTime??lab.time));
  if(reset||this.confirmStep!==step){for(let i=0;i<lab.count;i++)this.sparseAge[i]=(lab.neighborCounts?.[i]??25)<=3?this.sparseAge[i]+dt:0;this.confirmStep=step;this.confirmTime=lab.time;}
  const counts=Float32Array.from(lab.neighborCounts||new Float32Array(lab.count).fill(25),(n,i)=>!this.active.has(i)&&this.sparseAge[i]<.24?Math.max(7,n):n);
  const view=Object.create(lab);view.neighborCounts=counts;
  return super.update(view);
 }
}
