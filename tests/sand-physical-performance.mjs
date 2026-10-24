// Matched full-beach CPU arithmetic, without creating a graphics context.
// Both paths receive identical predictions, neighbors and collision geometry.
import {readFile} from 'node:fs/promises';
import {SandLab} from '../src/sand-lab/lab.js';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
import {solveDensityCPU} from '../src/sand-lab/density-cpu.js';
await setDensityKernel(await readFile(new URL('../src/sand-lab/kernels/density.wasm',import.meta.url)));
await setNeighborKernel(await readFile(new URL('../src/sand-lab/kernels/neighbors.wasm',import.meta.url)));
const forbidden=()=>{throw Error('CPU benchmark attempted graphics work');};
const renderer={extensions:{has:()=>true},render:forbidden,compileAsync:forbidden,getRenderTarget:forbidden,setRenderTarget:forbidden};
const report={description:'CPU constraint solve only; not an FPS benchmark',warmupPairs:3,measuredPairs:8,scenarios:[]};
for(const scenario of ['standard','objects','scattered']){
 const busy=scenario!=='standard';
 const lab=new SandLab(renderer,{boulders:true,physicalResolution:true});lab.air.cpu=true;lab.wind=24;lab.tidesEnabled=false;lab.lunarCycle=false;
 if(busy){
  lab.objectRadius=.3;for(let i=0;i<4;i++){const b=lab.spawn('glass',[-1.2+i*.8,1.6,2.8],[0,-1,0],i%2?'cup':'sphere');b.tilt=.47;b.pitch=.31;}
  lab.sand.wet.fill(.8);lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);
 }
 const context=lab.prepareStep(1/60);
 if(scenario==='scattered'){
  for(let i=0;i<64;i++)lab.sand.parcels.push({id:lab.sand.nextId++,position:[(i%8-3.5)*1.3,.1+Math.floor(i/8)*.2,(Math.floor(i/8)-3.5)*1.15],velocity:[0,0,0],mass:.001,packing:.56,wet:.6,anchored:true});
  lab.sand.update();lab.syncUniforms();
 }
 const predicted=context.predicted,neighbors=lab.gpu.neighborList(predicted,lab.spacing).data,native=new NativeDensity(),collide=p=>lab.collide(p),solid=p=>lab.solid(p),times={javascript:[],wasm:[]};let error=0;
 for(let i=0;i<report.warmupPairs+report.measuredPairs;i++){
  const results={};for(const name of i%2?['wasm','javascript']:['javascript','wasm']){
   const start=performance.now();results[name]=name==='wasm'?native.solve(predicted,neighbors,lab.spacing,3,collide,solid,lab):solveDensityCPU(predicted,neighbors,lab.spacing,3,collide,solid);
   if(i>=report.warmupPairs)times[name].push(performance.now()-start);
  }
  for(let j=0;j<predicted.length;j++)error=Math.max(error,Math.abs(results.wasm[j]-results.javascript[j]));
 }
 if(!Number.isFinite(error)||error>1e-6)throw Error(`Numerical mismatch: ${error}`);
 const summarize=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length;return {meanMs:mean,minMs:Math.min(...a),maxMs:Math.max(...a),standardDeviationMs:Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/a.length)};};
 const javascript=summarize(times.javascript),wasm=summarize(times.wasm);
 report.scenarios.push({name:scenario==='scattered'?'Boulders, objects and widely scattered sand':busy?'Boulders, four objects and edited sand':'Default beach with boulders',samples:lab.count,objects:lab.balls.length,sandParcels:lab.sand.parcels.length,javascript,wasm,speedup:javascript.meanMs/wasm.meanMs,maximumPositionError:error,times});lab.gpu.dispose();
}
console.log(JSON.stringify(report,null,2));
