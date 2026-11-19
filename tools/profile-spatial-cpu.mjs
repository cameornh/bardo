// Bounded CPU-only decomposition. No browser or GPU context.
import {readFile,writeFile} from 'node:fs/promises';
import {Session} from 'node:inspector';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
import {installFieldBatch,setBatchKernel} from '../src/rtx-sand-lab/fields/batch/grid.js';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {NativeNeighbors,setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
import {setTransferKernel} from '../src/rtx-sand-lab/fields/native-transfer.js';
import {setTransportKernel} from '../src/rtx-sand-lab/fields/native-transport.js';
import {setPressureKernel} from '../src/rtx-sand-lab/fields/native-pressure.js';
import {installSnapshotHeights} from '../src/rtx-sand-lab/fields/spatial-cpu/terrain-height.js';
import {installSpatialCPU} from '../src/rtx-sand-lab/fields/spatial-cpu/install.js';
import {setTightNeighborKernel} from '../src/rtx-sand-lab/fields/spatial-cpu/neighbors.js';
import {makeBody} from '../src/sand-lab/objects.js';
for(const [set,path] of [[setDensityKernel,'sand-lab/kernels/density.wasm'],[setNeighborKernel,'sand-lab/kernels/neighbors.wasm'],[setTransferKernel,'rtx-sand-lab/fields/kernels/transfer.wasm'],[setTransportKernel,'rtx-sand-lab/fields/kernels/transport.wasm'],[setPressureKernel,'rtx-sand-lab/fields/kernels/pressure.wasm'],[setBatchKernel,'rtx-sand-lab/fields/batch/grid.wasm']])await set(await readFile(new URL('../src/'+path,import.meta.url)));
await setTightNeighborKernel(await readFile(new URL('../src/rtx-sand-lab/fields/spatial-cpu/neighbors.wasm',import.meta.url)));
const totals={};let record=false;
const timed=(name,fn)=>(...args)=>{const start=performance.now(),result=fn(...args);if(record){const r=totals[name]??={ms:0,calls:0};r.ms+=performance.now()-start;r.calls++;}return result;};
const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1.4;lab.configure('ocean');lab.wind=18;lab.tidesEnabled=false;lab.detail.enabled=false;lab.detail.advance=()=>{};lab.grains={advance(){},reset(){}};lab.seaFoam=null;lab.bulkFields.publishAir=()=>{};lab.rain.enabled=true;lab.rain.rate=100;
Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true});installFieldLocality(lab);installFieldBatch(lab);if(process.argv.includes('--cache'))installSnapshotHeights(lab);if(process.argv.includes('--tight')){installSpatialCPU(lab);lab.optimizations.snapshotHeights=process.argv.includes('--cache');}
for(let i=0;i<48;i++){const x=-3.8+(i%12)*.62,z=1.8+Math.floor(i/12)*.65,y=lab.sand.height(x,z);const chunks=lab.sand.extract([x,y,z],.18,[0,0,0],true);for(const p of chunks){p.held=false;p.position[0]+=.24;p.position[1]=lab.sand.height(p.position[0],p.position[2])+.02;p.anchored=true;p.layer=true;}lab.sand.editPolicy.maintain(lab.sand);lab.sand.update();}
lab.balls.push(makeBody('glass','cup',.24,[1,1.8,1]),makeBody('rock','sphere',.22,[-1,2,1]));
for(let i=0;i<8;i++)lab.step(lab.timestep);
const density=lab.fieldSurfaceKernel;density.prepareGeometry=timed('contact.pack',density.prepareGeometry.bind(density));const ex={...density.instance.exports};for(const name of ['boundaryBatch','contactBatch','activePairs','activeDensity','correction'])ex[name]=timed('contact.'+name,ex[name]);density.instance={exports:ex};
const neighbors=lab.bulkFields.neighbors.native;neighbors.grid.build=timed('neighbors.grid',neighbors.grid.build.bind(neighbors.grid));neighbors.instance={exports:{...neighbors.instance.exports,build:timed('neighbors.pairs',neighbors.instance.exports.build)}};
const session=new Session();session.connect();const post=(method)=>new Promise((resolve,reject)=>session.post(method,(e,r)=>e?reject(e):resolve(r)));await post('Profiler.enable');await post('Profiler.start');record=true;
let total=0;const stages={};for(let i=0;i<48;i++){const t=performance.now();lab.step(lab.timestep);total+=performance.now()-t;for(const name of ['prepareMs','scalarMs','gatherMs','neighborMs','surfaceMs','transportMs'])stages[name]=(stages[name]||0)+lab.bulkFields.stats[name];}
const {profile}=await post('Profiler.stop');session.disconnect();const names=new Map(profile.nodes.map(n=>[n.id,n.callFrame.functionName+' '+n.callFrame.url.split('/').slice(-2).join('/')+':'+(n.callFrame.lineNumber+1)])),counts=new Map();for(let i=0;i<profile.samples.length;i++){const name=names.get(profile.samples[i]);counts.set(name,(counts.get(name)||0)+profile.timeDeltas[i]/1000);}
const result={cache:lab.snapshotHeights?{hits:lab.snapshotHeights.hits,misses:lab.snapshotHeights.misses,size:lab.snapshotHeights.size,resets:lab.snapshotHeights.resets}:null,steps:48,markers:lab.count,meanStepMs:total/48,stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,v/48])),detail:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,{...v,meanMs:v.ms/v.calls}])),top:[...counts].sort((a,b)=>b[1]-a[1]).slice(0,35)};
console.log(JSON.stringify(result,null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2));lab.gpu.dispose();
