import {ParticlePipeline} from '../src/rtx-sand-lab/fields/particles/pipeline.js';
import {ConnectedPipeline} from '../src/rtx-sand-lab/fields/connected/pipeline.js';
import {verifyConnected,freshGrid} from '../src/rtx-sand-lab/fields/connected/verify.js';
import {particleFixture,referenceParticles} from '../src/rtx-sand-lab/fields/particles/verify.js';
import {FieldPressure} from '../src/rtx-sand-lab/fields/native-pressure.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {configureRTXLab} from '../src/rtx-sand-lab/profile.js';
const out=document.querySelector('#results');let gpu;
const show=r=>out.textContent=JSON.stringify(r,null,2);
document.querySelector('#verify').onclick=async()=>{const b=document.querySelector('#verify');b.disabled=true;out.textContent='Compiling bounded kernels…';try{gpu?.dispose();gpu=await new ConnectedPipeline().initialize();out.textContent='Comparing independent CPU/GPU results…';const r=await verifyConnected(gpu);show(r);document.querySelector('#beach').disabled=document.querySelector('#bench').disabled=!r.pass;}catch(e){show({pass:false,error:e.stack});}finally{b.disabled=false;}};
document.querySelector('#bench').onclick=async()=>{const b=document.querySelector('#bench'),buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const rows=[];try{
 const f=particleFixture({nx:16,ny:16,nz:16,objects:false,held:false}),g=freshGrid(f.grid),cpu=freshGrid(f.grid),c=f.context,environment={solid:p=>f.lab.solid(p.map(v=>v/c.scale))*c.scale,wind:()=>[2,0,0],wall:()=>[0,0,0]},pressure=new FieldPressure();
 for(let step=0;step<16;step++){out.textContent=`Step ${step+1}/16`;const start=performance.now(),rhs=cpu.deposit(c.old,c.predicted,c.dt,c.scale,c.s,environment.solid,environment.wind,environment.wall),r=pressure.solve(cpu.levels,rhs);cpu.project(r.potential,c.dt);referenceParticles({...f,grid:cpu},{optimized:true});const cpuMs=performance.now()-start;const actual=await gpu.solve(c,f.lab,g,{environment,geometry:f.geometry});gpu.fields.commit(actual.fieldResult);rows.push({cpuMs,gpuMs:actual.stats.totalMs,packMs:actual.stats.packMs,waitMs:actual.stats.waitMs,iterations:actual.fieldResult.iterations,residual:actual.fieldResult.relativeResidual,topologyUploads:actual.fieldResult.topologyUploads});await new Promise(r=>setTimeout(r,20));}
 const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];show({pass:true,medianCPU:median(rows.slice(4).map(r=>r.cpuMs)),medianGPU:median(rows.slice(4).map(r=>r.gpuMs)),rows});
 }catch(e){show({pass:false,error:e.stack,rows});}finally{buttons.forEach(b=>b.disabled=false);}};
window.addEventListener('pagehide',()=>gpu?.dispose());

document.querySelector('#beach').onclick=async()=>{
 const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const runs=[];
 try{for(const backend of ['connected','webgpu','cpu']){
  const lab=new LiveSandLab({extensions:{has:()=>false}},{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab);lab.resolutions.ocean=Number(document.querySelector('#resolution').value);lab.configure('ocean');lab.wind=24;lab.tidesEnabled=false;lab.lunarCycle=false;lab.detail.enabled=false;lab.bulkFields.particleBackend=backend;lab.bulkFields.connected=gpu;lab.bulkFields.particles={validated:true,disabled:false,solve:(...args)=>ParticlePipeline.prototype.solve.apply(gpu,args)};
  const rows=[];for(let step=0;step<20;step++){
   const start=performance.now(),context=lab.prepareStep(lab.timestep),next=await lab.bulkFields.solveAsync(context);lab.finishStep(context,next);const s=lab.bulkFields.stats,ms=performance.now()-start;
   if(!lab.positions.every(Number.isFinite)||s.relativeResidual>1e-3)throw Error('Non-finite or unconverged beach');
   rows.push({ms,prepare:s.prepareMs,pressure:s.milliseconds,scalar:s.scalarMs,transport:s.transportMs,particle:s.particleCompute,backend:lab.bulkFields.particleBackend,iterations:s.iterations,topologyUploads:s.topologyUploads,residual:s.relativeResidual,fallback:s.particleFallback});
   show({phase:backend,step:step+1,ms,runs});await new Promise(r=>setTimeout(r,20));if(ms>2000)throw Error('Step exceeded time budget');
  }
  const tail=rows.slice(5).map(r=>r.ms).sort((a,b)=>a-b);runs.push({backend,actualBackend:lab.bulkFields.particleBackend,count:lab.count,median:tail[Math.floor(tail.length/2)],rows});
 }show({pass:runs.every(r=>r.backend===r.actualBackend),runs});
 }catch(e){show({pass:false,error:e.stack,runs});}finally{buttons.forEach(b=>b.disabled=false);}
};
