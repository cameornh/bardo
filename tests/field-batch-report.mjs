import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
const source='.native/field-batch',out='tests/results/field-batch-2026-11-14';await mkdir(out,{recursive:true});
const files=(await readdir(source)).filter(f=>/^(busy|rain|calm)-(reference|batch)-headless-[ab]\.json$/.test(f)),rows=[];
for(const file of files){
 const r=JSON.parse(await readFile(source+'/'+file,'utf8'));
 if(r.error||r.deviceLoss||r.rendererFailed||r.contextLost||r.totalFrames!==96)throw Error('Incomplete/failed measurement: '+file);
 const frames=r.frames.slice(16),intervals=frames.slice(1).map((f,i)=>f.wall-frames[i].wall),seconds=intervals.reduce((a,b)=>a+b)/1000,simulated=frames.at(-1).simulation-frames[0].simulation;
 const profile=Object.fromEntries(Object.entries(r.profile).map(([k,v])=>[k,{...v,meanMs:v.ms/v.calls}]));
 rows.push({file,workload:r.experiment.workload,mode:r.experiment.mode,intervals,seconds,simulated,fps:intervals.length/seconds,realtime:simulated/seconds,profile,allocationMiB:r.experiment.allocationMiB,batchBytes:r.experiment.batchBytes});await copyFile(source+'/'+file,out+'/'+file);
}
const summary={};
for(const workload of ['busy','rain','calm']){
 const pair={};for(const mode of ['reference','batch']){
  const selected=rows.filter(r=>r.workload===workload&&r.mode===mode);if(!selected.length)throw Error('Missing '+workload+' '+mode);
  const intervals=selected.flatMap(r=>r.intervals),seconds=selected.reduce((s,r)=>s+r.seconds,0),mean=seconds*1000/intervals.length,sorted=intervals.slice().sort((a,b)=>a-b);
  const timing=key=>selected.reduce((s,r)=>s+(r.profile[key]?.ms||0),0)/selected.reduce((s,r)=>s+(r.profile[key]?.calls||0),0);
  pair[mode]={runs:selected.length,fps:intervals.length/seconds,realtime:selected.reduce((s,r)=>s+r.simulated,0)/seconds,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],standardDeviationMs:Math.sqrt(intervals.reduce((s,v)=>s+(v-mean)**2,0)/intervals.length),depositMs:timing('prepareMs'),scalarsMs:timing('scalarMs'),surfaceMs:timing('surfaceMs'),neighborsMs:timing('neighborMs'),transportMs:timing('transportMs')};
 }
 pair.gain=pair.batch.fps/pair.reference.fps-1;summary[workload]=pair;
}
await writeFile(out+'/summary.json',JSON.stringify({summary,rows},null,2));
console.log(JSON.stringify(summary,null,2));
try{
 const file='rain-interleaved-headless-abba.json',r=JSON.parse(await readFile(source+'/'+file,'utf8'));
 if(r.error||r.deviceLoss||r.rendererFailed||r.contextLost||r.totalFrames!==160)throw Error('Incomplete alternating comparison');
 const result={};for(const mode of ['reference','batch']){
  const intervals=[];let simulated=0;
  for(let i=34;i<r.frames.length;i++)if((i-32)%16>=2&&r.modeFrames[i]===mode){intervals.push(r.frames[i].wall-r.frames[i-1].wall);simulated+=r.frames[i].simulation-r.frames[i-1].simulation;}
  const seconds=intervals.reduce((a,b)=>a+b,0)/1000,sorted=intervals.slice().sort((a,b)=>a-b);result[mode]={intervals:intervals.length,fps:intervals.length/seconds,realtime:simulated/seconds,p95Ms:sorted[Math.ceil(sorted.length*.95)-1]};
 }
 result.gain=result.batch.fps/result.reference.fps-1;await writeFile(out+'/interleaved.json',JSON.stringify(result,null,2));await copyFile(source+'/'+file,out+'/'+file);console.log('Alternating rain:',result);
}catch(e){if(e.code!=='ENOENT')throw e;}
