import {performance} from 'node:perf_hooks';
import {PackedNeighbors} from '../src/sand-lab/packed-neighbors.js';
import {buildNeighbors} from '../src/sand-lab/water-lab-model.js';
import {BoundsGrid,separateBodies} from '../src/sand-lab/spatial-bounds.js';
import {SandLab} from '../src/sand-lab/lab.js';
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
// Microbenchmarks exclude drawing, fluid stepping and browser scheduling.
const bench=(fn,n=20)=>{for(let i=0;i<4;i++)fn();const a=[];for(let i=0;i<n;i++){const s=performance.now();fn();a.push(performance.now()-s);}return median(a);};
const data=new Float32Array(12852*4);for(let i=0;i<data.length/4;i++)data.set([i%42*.19,Math.floor(i/42)%17*.19,Math.floor(i/(42*17))*.19,0],i*4);const packed=new PackedNeighbors();
const bodies=Array.from({length:1000},(_,i)=>({position:[i%20*.8,Math.floor(i/20)%10*.8,Math.floor(i/200)*.8],radius:.12,held:false})),grid=new BoundsGrid();
const lab=new SandLab({extensions:{has:()=>false}});lab.sand.base.fill(-.7);for(let i=0;i<250;i++)lab.sand.parcels.push({id:i+1,position:[i%25*.35-4.2,.1,Math.floor(i/25)*.35-1.6],radius:.1,mass:.56*4*Math.PI/3*.1**3,packing:.56,wet:.9,anchored:true});lab.sand.update();
const report={neighborList:{particles:12852,referenceMs:bench(()=>buildNeighbors(data,.19)),packedMs:bench(()=>packed.build(data,.19))},bodyBroadphase:{bodies:1000,referenceMs:bench(()=>separateBodies(bodies)),optimizedMs:bench(()=>separateBodies(bodies,grid)),referencePairs:separateBodies(bodies).tested,candidatePairs:separateBodies(bodies,grid).tested},sandCache:{clumps:250}};
for(const [label,enabled] of [['referenceMs',false],['optimizedMs',true]]){lab.optimizations.sandCache=enabled;lab.sand.optimizations=lab.optimizations;report.sandCache[label]=bench(()=>{for(const p of lab.sand.parcels)p.wet-=.000001;lab.sand.update();lab.sand.releaseUnsupported();lab.syncSandUniforms();});}
console.log(JSON.stringify(report,null,2));
