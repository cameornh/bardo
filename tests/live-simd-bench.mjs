// CPU-only ABBA benchmark. Never initializes a renderer or GPU device.
import {readFile,writeFile} from 'node:fs/promises';
import {FieldPressure,setPressureKernel} from '../src/rtx-sand-lab/fields/native-pressure.js';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {BeachFieldGrid,AIR,WATER} from '../src/rtx-sand-lab/fields/grid.js';
import {buildNeighbors} from '../src/sand-lab/water-lab-model.js';
const file=p=>readFile(new URL('../src/'+p,import.meta.url));
await setPressureKernel(await file('rtx-sand-lab/fields/kernels/pressure.wasm'));
await setDensityKernel(await file('sand-lab/kernels/density.wasm'));
const modules={};for(const name of ['pressure','density'])modules[name]=await WebAssembly.compile(await file('rtx-sand-lab/simd/'+name+'.wasm'));
const rows=[];
function bench(name,calls,iterations){
 for(let k=0;k<20;k++)for(const call of calls)call();
 for(const mode of [0,1,1,0,1,0,0,1]){const start=performance.now();for(let k=0;k<iterations;k++)calls[mode]();rows.push({name,mode:mode?'simd':'scalar',milliseconds:(performance.now()-start)/iterations});}
}
for(const dims of [[13,9,11],[19,11,15]]){
 const g=new BeachFieldGrid({dims,h:1});g.setPhase(Uint8Array.from(g.coords,c=>c[0]===2&&c[1]===1?0:c[1]<3?WATER:AIR));
 const rhs=Float64Array.from(g.phase,(p,i)=>p?Math.sin(i*.31)*.1:0),solvers=[new FieldPressure(),new FieldPressure(modules.pressure)];
 bench('pressure-'+g.count,solvers.map(s=>()=>s.solve(g.levels,rhs)),100);
}
for(const n of [1164,3024]){
 const p=Float32Array.from({length:n*4},(_,i)=>i%4===3?0:i%4===0?Math.floor(i/4)%18*.13:i%4===1?Math.floor(i/72)%8*.13:Math.floor(i/576)*.13),neighbors=buildNeighbors(p,.14).data;
 const solvers=[new NativeDensity(),new NativeDensity(modules.density)];
 bench('density-'+n,solvers.map(s=>()=>s.solve(p,neighbors,.14,1)),100);
}
const summary={};for(const {name} of rows){const avg=mode=>{const a=rows.filter(r=>r.name===name&&r.mode===mode);return a.reduce((s,r)=>s+r.milliseconds,0)/a.length;};summary[name]={scalarMs:avg('scalar'),simdMs:avg('simd'),speedup:avg('scalar')/avg('simd')};}
const result={runtime:process.version,summary,rows};console.log(JSON.stringify(result,null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2));
