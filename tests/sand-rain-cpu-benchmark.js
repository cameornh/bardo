// Isolates CPU rain work: fluid positions are held fixed and detail emission is
// stubbed. This measures rainfall bookkeeping, not overall frame time.
import {SandLab} from '../src/sand-lab/lab.js';
const lab=new SandLab({extensions:{has:()=>false}});lab.wind=13;lab.detail.impact=()=>{};lab.wetting.hitLens=()=>{};lab.rain.enabled=true;lab.rain.rate=12000;
const samples=[];let first=null;
for(let i=0;i<260;i++){lab.time+=.05;const t=performance.now();lab.rain.step(.05);if(i>=200)samples.push(performance.now()-t);if(first===null&&lab.rain.hits)first=lab.time;}
const before=lab.rain.hits;lab.rain.enabled=false;for(let i=0;i<20;i++){lab.time+=.05;lab.rain.step(.05);}
samples.sort((a,b)=>a-b);console.log(JSON.stringify({meanMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],firstImpactSeconds:first,hitsInSecondAfterStop:lab.rain.hits-before,drops:lab.rain.drops.length,deposits:lab.rain.deposits.size,staticGroundKernels:lab.rain.fieldItems().length,count:lab.count},null,2));
