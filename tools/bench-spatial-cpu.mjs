// Whole CPU physics timings, deliberately NOT presented as application FPS.
import {writeFile} from 'node:fs/promises';
import {makeSpatialFixture} from './spatial-cpu-fixture.mjs';
const rows=[],mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const stats=a=>{const sorted=a.slice().sort((a,b)=>a-b);return {mean:mean(a),p95:sorted[Math.floor((sorted.length-1)*.95)],p99:sorted[Math.floor((sorted.length-1)*.99)]};};
const start=performance.now();
for(const trial of ['heights','neighbors','combined']){
 for(let block=0;block<8;block++){
  if(performance.now()-start>120000)throw Error('CPU comparison exceeded two-minute budget');
  const optimized=[false,true,true,false][block%4];
  const lab=makeSpatialFixture({heights:optimized&&trial!=='neighbors',tight:optimized&&trial!=='heights'});
  try{
   for(let i=0;i<8;i++)lab.step(lab.timestep);
   const samples=[],stages={};
   for(let i=0;i<40;i++){
    const t=performance.now();lab.step(lab.timestep);const ms=performance.now()-t;
    if(ms>2000)throw Error('CPU step exceeded two-second budget');samples.push(ms);
    for(const key of ['prepareMs','neighborMs','surfaceMs','transportMs'])stages[key]=(stages[key]||0)+lab.bulkFields.stats[key];
   }
   rows.push({trial,block,optimized,markers:lab.count,stepMs:stats(samples),stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,v/samples.length])),samples});
  }finally{lab.gpu.dispose();}
 }
}
const trials=Object.fromEntries(['heights','neighbors','combined'].map(trial=>{
 const forMode=optimized=>stats(rows.filter(x=>x.trial===trial&&x.optimized===optimized).flatMap(x=>x.samples));
 const reference=forMode(false),candidate=forMode(true);
 return [trial,{reference,candidate,cpuTimeChangePercent:(candidate.mean/reference.mean-1)*100}];
}));
const result={pass:true,kind:'CPU-only fixed-step ABBA, no drawing or GPU fine particles; not FPS or realtime',stepsPerBlock:40,warmup:8,blocksPerTrial:8,trials,rows};
console.log(JSON.stringify({...result,rows:undefined},null,2));
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2));
