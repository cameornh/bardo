import {LabFluidGPU} from './water-lab-gpu.js';
import {LabTransportGPU} from './transport-gpu.js';
import {StepReadback} from './gpu-step-readback.js';
import {solveDensity} from './water-lab-model.js';
import {transportFluid} from './water-lab-transport.js';

export function verifyBatchedStep(renderer,uniforms){
 const gpu=new LabFluidGPU(renderer,uniforms),transport=new LabTransportGPU(renderer),readback=new StepReadback(renderer);
 gpu.uniforms.uCollision.value=false;gpu.packedNeighbors=true;
 let batchError=0,cpuError=0,countsEqual=true;const sizes=[150,67,257,1,175];
 const compare=(a,b)=>{let error=0;for(let i=0;i<a.length;i++)error=Math.max(error,Math.abs(a[i]-b[i]));return error;};
 try{
  for(const n of sizes){
   const old=new Float32Array(n*4),predicted=new Float32Array(n*4),chem=new Float32Array(n*4),velocity=new Float32Array(n*4);
   for(let i=0;i<n;i++){old.set([(i%7)*.18-1,Math.floor(i/7)%5*.18+1,Math.floor(i/35)*.18-1,i%11===0?1:0],i*4);for(let k=0;k<4;k++)chem[i*4+k]=(i+k)%17/23;}
   predicted.set(old);for(let i=0;i<n;i++)if(!old[i*4+3])predicted[i*4+1]-=.001;
   const next=gpu.solve(predicted,.22,p=>p),reference=transport.solve(old,next,velocity,chem,gpu.neighbors,.22,10,1/30,predicted,gpu);
   gpu.solve(predicted,.22,p=>p,3,null,false,true);transport.solve(old,old,velocity,chem,gpu.neighbors,.22,10,1/30,predicted,gpu,true);
   const batch=readback.read(gpu,transport,n),cpuPositions=solveDensity(predicted,gpu.neighbors,.22,3).positions,cpu=transportFluid(old,cpuPositions,velocity,chem,gpu.neighbors,.22,10,1/30,predicted);
   batchError=Math.max(batchError,compare(next,batch.positions));cpuError=Math.max(cpuError,compare(cpuPositions,batch.positions));
   for(const key of ['velocities','chem','metrics','activity','breakup']){batchError=Math.max(batchError,compare(reference[key],batch.transport[key]));cpuError=Math.max(cpuError,compare(cpu[key],batch.transport[key]));}
   countsEqual&&=compare(reference.counts,batch.transport.counts)===0&&compare(cpu.counts,batch.transport.counts)===0;
  }
  return {backend:gpu.cpu?'CPU fallback':'GPU',sizes,batchError,cpuError,countsEqual,readbacksPerStep:readback.calls,pass:!gpu.cpu&&batchError<1e-6&&cpuError<.003&&countsEqual};
 }finally{gpu.dispose();transport.dispose();readback.dispose();}
}
