// CPU-only reconstruction grouping cost, without simulation or a GL context.
import {SandLab} from '../src/sand-lab/lab.js';
import {InteriorWaterCompression} from '../src/sand-lab/adaptive-water-detail.js';
import {shoreImage} from '../src/sand-lab/reconstruction.js';
const forbidden=()=>{throw Error('Graphics call in CPU benchmark');};
const lab=new SandLab({extensions:{has:()=>false},render:forbidden,compileAsync:forbidden});
const items=[];
for(let i=0;i<lab.count;i++){
 const o=i*4,p={sourceIndex:i,kind:'water',position:Array.from(lab.positions.subarray(o,o+3)),radius:lab.spacing*(.65+.2*Math.min(1,Math.max(0,((lab.neighborCounts?.[i]||0)-5)/20))),volume:lab.spacing**3,dye:lab.chem[o],tannin:lab.chem[o+1],sediment:lab.chem[o+2]};
 items.push(p);const image=!lab.positions[o+3]?shoreImage(p,(x,z)=>lab.terrainHeight(x,z)):null;if(image)items.push(image);
}
// Measure calm interiors at the seeded positions; this is not an FPS benchmark.
lab.velocities.fill(0);const compression=new InteriorWaterCompression();
for(let i=0;i<15;i++)compression.update(items,lab,.1);
const samples=[];let output;
for(let i=0;i<40;i++){const start=performance.now();output=compression.update(items,lab,.1);samples.push(performance.now()-start);}
samples.sort((a,b)=>a-b);
console.log(JSON.stringify({fixture:'Calm seeded beach, existing kernel sizes and shoreline images',physicsParcels:lab.count,...compression.stats,groupingMs:{median:samples[20],p95:samples[38]},volumeError:output.reduce((n,p)=>n+p.volume,0)-items.reduce((n,p)=>n+p.volume,0),scope:'CPU grouping only; estimated Gaussian voxel work, not measured GPU time or FPS'},null,2));
lab.gpu.dispose();
