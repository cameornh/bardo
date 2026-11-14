// Diagnostic only: instruments the unchanged reference. No graphics work.
import {readFile,writeFile} from 'node:fs/promises';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {BeachFieldGrid,AIR,WATER} from '../src/rtx-sand-lab/fields/grid.js';
import {MATERIAL} from '../src/fluid-fields/model.js';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
import {setTransferKernel} from '../src/rtx-sand-lab/fields/native-transfer.js';
import {setTransportKernel} from '../src/rtx-sand-lab/fields/native-transport.js';
import {setPressureKernel} from '../src/rtx-sand-lab/fields/native-pressure.js';
import {setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
import {setDensityKernel} from '../src/sand-lab/native-density.js';
for(const [set,path] of [[setTransferKernel,'rtx-sand-lab/fields/kernels/transfer.wasm'],[setTransportKernel,'rtx-sand-lab/fields/kernels/transport.wasm'],[setPressureKernel,'rtx-sand-lab/fields/kernels/pressure.wasm'],[setNeighborKernel,'sand-lab/kernels/neighbors.wasm'],[setDensityKernel,'sand-lab/kernels/density.wasm']])await set(await readFile(new URL('../src/'+path,import.meta.url)));
const totals={};let last=0,record=false;
const mark=name=>{const now=performance.now();if(record&&name){const row=totals[name]??={calls:0,ms:0};row.calls++;row.ms+=now-last;}last=now;};
let source=BeachFieldGrid.prototype.deposit.toString().replace('deposit(','function(').replace('{\n','{\nmark();\n');
for(const [text,name] of [['  this.setPhase(phase);','occupancy'],['  for(const f of this.faces){f.weight.fill(0);','topology'],['  // A sparsely sampled','scatter'],['  const prior=this.faces.map','extrapolation'],['  // Physical kinematic','air/walls'],['  return this.rhs();','viscosity']])source=source.replace(text,`mark('${name}');\n`+text);
const deposit=Function('mark','WATER','AIR','MATERIAL','clamp','xyz','idx','return '+source)(mark,WATER,AIR,MATERIAL,(v,a,b)=>Math.max(a,Math.min(b,v)),(d,i)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))],(d,x,y,z)=>x+d[0]*(y+d[1]*z));
const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});
lab.resolutions.ocean=1.4;lab.configure('ocean');lab.wind=12;lab.tidesEnabled=false;lab.detail.enabled=false;lab.detail.advance=()=>{};lab.grains={advance(){},reset(){}};lab.seaFoam=null;lab.bulkFields.publishAir=()=>{};
Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true});installFieldLocality(lab);lab.bulkFields.ensure();lab.bulkFields.grid.deposit=deposit;
for(let i=0;i<48;i++){record=i>=8;lab.step(lab.timestep);if(record)for(const key of ['prepareMs','scalarMs','gatherMs','neighborMs','surfaceMs','transportMs']){const row=totals[key]??={calls:0,ms:0};row.calls++;row.ms+=lab.bulkFields.stats[key];}}
const result={samples:lab.count,cells:lab.bulkFields.grid.count,stages:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,{...v,meanMs:v.ms/v.calls}])),last:lab.bulkFields.stats};
console.log(JSON.stringify(result,null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2));lab.gpu.dispose();
