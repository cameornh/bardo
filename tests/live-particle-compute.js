import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {configureRTXLab} from '../src/rtx-sand-lab/profile.js';
import {ParticlePipeline} from '../src/rtx-sand-lab/fields/particles/pipeline.js';
import {verifyParticles,particleFixture,referenceParticles,compareParticles} from '../src/rtx-sand-lab/fields/particles/verify.js';
const $=id=>document.getElementById(id);let pipeline;
function busy(value){for(const id of ['verify','benchmark','beach'])$(id).disabled=value||(id!=='verify'&&!pipeline?.validated);}
function plot(a,b){const c=$('view').getContext('2d');c.clearRect(0,0,800,320);for(const [result,x,color] of [[a,200,'#6dc8f0'],[b,600,'#e4be7e']]){c.fillStyle=color;for(let o=0;o<result.positions.length;o+=4){const p=result.positions;c.beginPath();c.arc(x+p[o]*40,270-p[o+1]*50,2,0,7);c.fill();}}c.fillStyle='white';c.fillText('CPU reference',150,20);c.fillText('WebGPU result',550,20);}
$('verify').onclick=async()=>{ busy(true);try{$('result').textContent='Compiling bounded compute kernels…';pipeline?.dispose();pipeline=await new ParticlePipeline().initialize();const result=await verifyParticles(pipeline);$('result').textContent=JSON.stringify(result,null,2);$('benchmark').disabled=$('beach').disabled=!result.pass;if(!result.pass)return;const f=particleFixture(),r=referenceParticles(f),a=await pipeline.solve(f.context,f.lab,f.grid,{geometry:f.geometry});plot(r,a);}catch(e){$('result').textContent=String(e.stack)+'\n'+JSON.stringify(pipeline?.stats,null,2);pipeline?.dispose();}finally{busy(false);}};
$('benchmark').onclick=async()=>{busy(true);try{const f=particleFixture({nx:16,ny:16,nz:16,objects:false}),reference=referenceParticles(f),rows=[],cpu=[];for(let i=0;i<7;i++){const r=referenceParticles(f,{optimized:true});if(i)cpu.push(r.milliseconds);}for(let i=0;i<6;i++){const a=await pipeline.solve(f.context,f.lab,f.grid,{geometry:f.geometry});rows.push({...a.stats,...compareParticles(a,reference)});plot(reference,a);} $('result').textContent=JSON.stringify({cpuReferenceMs:reference.milliseconds,cpuOptimizedMs:cpu,cpuBackend:f.lab.benchmarkTransport.backend,rows},null,2);}catch(e){$('result').textContent=String(e.stack)+'\n'+JSON.stringify(pipeline?.stats,null,2);}finally{busy(false);}};
window.addEventListener('pagehide',()=>pipeline?.dispose(),{once:true});

$('beach').onclick=async()=>{
 busy(true);const runs=[];
 try{for(const backend of ['webgpu','cpu']){
  const lab=new LiveSandLab({extensions:{has:()=>false}},{boulders:true,physicalResolution:true,bulkFields:true});configureRTXLab(lab);lab.resolutions.ocean=1.4;lab.configure('ocean');lab.wind=24;lab.tidesEnabled=false;lab.lunarCycle=false;lab.detail.enabled=false;lab.bulkFields.particleBackend=backend;lab.bulkFields.particles=pipeline;
  const rows=[];for(let i=0;i<16;i++){
   const start=performance.now(),context=lab.prepareStep(lab.timestep),next=await lab.bulkFields.solveAsync(context);lab.finishStep(context,next);const ms=performance.now()-start;
   if(!lab.positions.every(Number.isFinite)||lab.bulkFields.stats.relativeResidual>1e-3)throw Error('Non-finite or unconverged beach');
   rows.push({ms,prepare:lab.bulkFields.stats.prepareMs,pressure:lab.bulkFields.stats.milliseconds,scalar:lab.bulkFields.stats.scalarMs,surface:lab.bulkFields.stats.surfaceMs,transfer:lab.bulkFields.stats.transferMs,transport:lab.bulkFields.stats.transportMs,particle:lab.bulkFields.stats.particleCompute});
   $('result').textContent=JSON.stringify({phase:backend,step:i+1,count:lab.count,ms,fallback:lab.bulkFields.stats.particleFallback,runs},null,2);await new Promise(requestAnimationFrame);
   if(ms>2000)throw Error('Stopped after a slow beach step');
  }runs.push({backend,actualBackend:lab.bulkFields.particleBackend,count:lab.count,time:lab.time,fallback:lab.bulkFields.stats.particleFallback,rows});plot({positions:lab.positions},{positions:lab.positions});
 }$('result').textContent=JSON.stringify({pass:runs.length===2&&runs.every(r=>r.backend===r.actualBackend),runs},null,2);
 }catch(e){$('result').textContent=JSON.stringify({pass:false,error:e.stack,runs},null,2);}
 finally{busy(false);}
};
