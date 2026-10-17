import {pathToFileURL} from 'node:url';
import {SandBed as CurrentSandBed} from '../src/sand-lab/sand.js';

// Optional prior module path for a matched before/after capture. Restrict the
// old implementation to six strokes: subdivision grows rapidly beyond that.
const PreviousSandBed=process.argv[2]?(await import(pathToFileURL(process.argv[2]))).SandBed:null;
const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
function run(Bed,strokes){
 const b=new Bed(65);b.wet.fill(.95);b.memory.fill(.95);b.update();const times=[];
 for(let i=0;i<strokes;i++){
  const x=.1*Math.sin(i*.1),point=[x,b.height(x,3),3],start=performance.now();
  b.push(point,.35,[0,-.6,1],.09);const afterPush=performance.now();b.step(1/30,air,calm,10);
  times.push({pushMs:afterPush-start,stepMs:performance.now()-afterPush});
 }
 const combined=times.map(p=>p.pushMs+p.stepMs).sort((a,b)=>a-b);
 return {strokes,clumps:b.parcels.length,cuts:b.parcels.reduce((s,p)=>s+(p.cuts?.length||0),0),massError:b.totalMass()-b.initialMass,medianMs:combined[Math.floor(strokes/2)],p95Ms:combined[Math.floor(strokes*.95)],finalStroke:times.at(-1)};
}
const report={scope:'CPU sand compaction and sand step only; excludes fluid solver and drawing',before:PreviousSandBed?run(PreviousSandBed,6):null,afterMatched:run(CurrentSandBed,6),afterSustained:run(CurrentSandBed,120)};
console.log(JSON.stringify(report,null,2));
