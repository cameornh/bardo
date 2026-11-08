// CPU-only whole simulation profile; no graphics context or GPU work.
import {Session} from 'node:inspector';
import {readFile,writeFile} from 'node:fs/promises';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {configureRTXLab} from '../src/rtx-sand-lab/profile.js';
import {setDensityKernel} from '../src/sand-lab/native-density.js';
import {setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
import {setTransportKernel} from '../src/rtx-sand-lab/fields/native-transport.js';
import {setPressureKernel} from '../src/rtx-sand-lab/fields/native-pressure.js';
for(const [load,path] of [[setDensityKernel,'sand-lab/kernels/density.wasm'],[setNeighborKernel,'sand-lab/kernels/neighbors.wasm'],[setTransportKernel,'rtx-sand-lab/fields/kernels/transport.wasm'],[setPressureKernel,'rtx-sand-lab/fields/kernels/pressure.wasm']])await load(await readFile(new URL('../src/'+path,import.meta.url)));
const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});configureRTXLab(lab);lab.resolutions.ocean=2.2;lab.configure('ocean');lab.wind=24;lab.reactiveWaves=true;lab.tidesEnabled=false;lab.detail.enabled=false;
if(process.argv.includes('--edited')){for(let i=0;i<240;i++){
 const x=-3.8+(i%12)*.62,z=1.8+(Math.floor(i/12)%4)*.65,y=lab.sand.height(x,z);
 const chunks=lab.sand.extract([x,y,.0+z],.18,[0,0,0],true);
 for(const p of chunks){p.held=false;p.position[0]+=.24;p.position[1]=lab.sand.height(p.position[0],p.position[2])+.02;p.anchored=true;p.layer=true;}
 lab.sand.editPolicy.maintain(lab.sand);lab.sand.update();
}console.log('edited',lab.sand.parcels.length);}
for(let i=0;i<15;i++)lab.step(lab.timestep);
const session=new Session();session.connect();const post=(method,args={})=>new Promise((resolve,reject)=>session.post(method,args,(e,r)=>e?reject(e):resolve(r)));await post('Profiler.enable');await post('Profiler.start');
const timings=[],rows=[];
for(let i=0;i<45;i++){const start=performance.now();lab.step(lab.timestep);timings.push(performance.now()-start);if(i%15===14)rows.push({step:i+1,ms:timings.at(-1),timings:lab.timings,sand:lab.sand.stepTimes,parcelTimes:lab.sand.parcelTimes,fields:{...lab.bulkFields.stats,potential:undefined},parcels:lab.sand.parcels.length});}
const {profile}=await post('Profiler.stop');session.disconnect();
const names=new Map(profile.nodes.map(n=>[n.id,n.callFrame.functionName+' '+n.callFrame.url.split('/').slice(-2).join('/')+':'+(n.callFrame.lineNumber+1)]));const counts=new Map();for(let i=0;i<profile.samples.length;i++){const name=names.get(profile.samples[i]);counts.set(name,(counts.get(name)||0)+profile.timeDeltas[i]/1000);}const top=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,45);
const result={medianMs:timings.slice().sort((a,b)=>a-b)[22],meanMs:timings.reduce((a,b)=>a+b)/timings.length,rows,top};await writeFile('/tmp/live-cpu-edited-profile.json',JSON.stringify(profile));await writeFile('/tmp/live-cpu-edited-summary.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
