import {execFileSync} from 'node:child_process';
// Matched constraint arithmetic only; no graphics context and no FPS claim.
import {readFile} from 'node:fs/promises';
import {SandLab} from '../src/sand-lab/lab.js';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
await setDensityKernel(await readFile(new URL('../src/sand-lab/kernels/density.wasm',import.meta.url)));
await setNeighborKernel(await readFile(new URL('../src/sand-lab/kernels/neighbors.wasm',import.meta.url)));
const forbidden=()=>{throw Error('Unexpected graphics work');},renderer={extensions:{has:()=>true},render:forbidden,compileAsync:forbidden,getRenderTarget:forbidden,setRenderTarget:forbidden};
const baselineCommit='e2953a7',baselineModule=await WebAssembly.compile(execFileSync('git',['show',`${baselineCommit}:src/sand-lab/kernels/density.wasm`]));
const report={baselineCommit,description:'CPU water constraints, compared with the existing compiled solver; not FPS or full realtime speed',warmupPairs:6,measuredPairs:24,scenarios:[]};
for(const scenario of ['standard','objects','scattered','large']){
 const lab=new SandLab(renderer,{boulders:true,physicalResolution:true});lab.air.cpu=true;lab.wind=24;lab.tidesEnabled=lab.lunarCycle=false;
 if(scenario==='large')lab.configure('ocean',1.5);
 if(scenario==='objects'||scenario==='scattered'){lab.objectRadius=.3;for(let i=0;i<4;i++){const b=lab.spawn('glass',[-1.2+i*.8,1.6,2.8],[0,-1,0],i%2?'cup':'sphere');b.tilt=.47;b.pitch=.31;}lab.sand.wet.fill(.8);lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);}
 const c=lab.prepareStep(lab.timestep);
 if(scenario==='scattered'){for(let i=0;i<64;i++)lab.sand.parcels.push({id:lab.sand.nextId++,position:[(i%8-3.5)*1.3,.1+Math.floor(i/8)*.2,(Math.floor(i/8)-3.5)*1.15],velocity:[0,0,0],mass:.001,packing:.56,wet:.6,anchored:true});lab.sand.update();lab.syncUniforms();}
 const neighbors=lab.gpu.neighborList(c.predicted,lab.spacing).data,solvers=[new NativeDensity(),new NativeDensity()],times=[[],[]];solvers[0].instance=new WebAssembly.Instance(baselineModule,{});let error=0,activeCounts;
 for(let repeat=0;repeat<report.warmupPairs+report.measuredPairs;repeat++){const values=[];for(const which of repeat%2?[1,0]:[0,1]){lab.optimizations.batchedContacts=!!which;lab.optimizations.nativeSandContacts=!!which;lab.optimizations.adaptivePressure=!!which;const solver=solvers[which],start=performance.now();values[which]=solver.solve(c.predicted,neighbors,lab.spacing,3,p=>lab.collide(p),p=>lab.solid(p),lab);if(repeat>=report.warmupPairs)times[which].push(performance.now()-start);if(which)activeCounts=solver.activeCounts;}for(let i=0;i<c.predicted.length;i++)error=Math.max(error,Math.abs(values[0][i]-values[1][i]));}
 const stats=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length,sorted=a.slice().sort((a,b)=>a-b);return {meanMs:mean,sdMs:Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/a.length),p95Ms:sorted[Math.ceil(a.length*.95)-1]};};
 const [previous,current]=times.map(stats);report.scenarios.push({scene:scenario,samples:lab.count,objects:lab.balls.length,sandParcels:lab.sand.parcels.length,timestep:lab.timestep,previous,current,speedup:previous.meanMs/current.meanMs,maxPositionError:error,maxPositionErrorMeters:error*lab.spec.scale,spacing:lab.spacing,activeCounts,times});lab.gpu.dispose();
}
console.log(JSON.stringify(report,null,2));
