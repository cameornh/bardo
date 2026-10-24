// CPU-only regression benchmark, including moving water (the missing case in
// the prior calm-only benchmark). No renderer, graphics context or fluid solve.
import {SandLab} from '../src/sand-lab/lab.js';
import * as before from './fixtures/water-detail-2026-10-24-before.js';
import * as after from '../src/sand-lab/adaptive-water-detail.js';
const lab=new SandLab({extensions:{has:()=>false}}),items=[];
for(let i=0;i<lab.count;i++){const o=i*4;items.push({sourceIndex:i,kind:'water',position:Array.from(lab.positions.subarray(o,o+3)),radius:lab.spacing*.8,volume:lab.spacing**3});}
const rows=[];
for(const speed of [0,.35,.7,1.3]){
 for(let i=0;i<lab.count;i++)lab.velocities[i*4]=speed/lab.spec.scale;
 const row={speedMetresPerSecond:speed};
 for(const [name,api] of [['before',before],['after',after]]){
  const c=new api.InteriorWaterCompression();for(let i=0;i<20;i++)c.update(items,lab,.1);
  const times=[];for(let i=0;i<30;i++){const start=performance.now();c.update(items,lab,.1);times.push(performance.now()-start);}times.sort((a,b)=>a-b);
  row[name]={kernels:c.stats.kernels,estimatedVoxelWork:c.stats.estimatedVoxelWork,groupingMedianMs:times[15],groupingP95Ms:times[28]};
 }rows.push(row);
}
const oldSize=before.stableDrawingSize(960,640),newSize=after.stableDrawingSize(960,640);
console.log(JSON.stringify({physicalParcels:lab.count,scope:'Reconstruction grouping CPU costs; not full-scene FPS',rows,screenPixels:{before:oldSize.width*oldSize.height,after:newSize.width*newSize.height},distanceScale:[1,3,6,12,24].map(distance=>({distance,before:before.distanceDetail(distance,.2,320),after:after.distanceDetail(distance,.2,320)}))},null,2));lab.gpu.dispose();
