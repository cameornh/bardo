import {runNative} from './runtime.js';
import {installFieldBatch,setBatchKernel} from '../.native/generated/field-batch.mjs';


// Ordinary capped application loop, one bounded native job per invocation.
// Simulation, all rendering passes and native controls run together. Headless
// tags substitute a texture for the window image, excluding OS presentation.
const [mode='reference',workload='busy',tag='profile']=Deno.args;
if(!['reference','batch','interleaved'].includes(mode)||!['calm','busy','rain'].includes(workload))throw Error('Unknown field-batch benchmark');
await Deno.mkdir('.native/field-batch',{recursive:true});
await runNative({width:640,height:400,resolution:1.4,backend:'safe',headless:tag==='offscreen'||tag.startsWith('headless'),frames:mode==='interleaved'?160:tag==='offscreen'?32:96,exit:true,report:`.native/field-batch/${workload}-${mode}-${tag}.json`,screenshot:`.native/field-batch/${workload}-${mode}-${tag}.png`,onReady:async({app,reports,shutdown})=>{
 const {lab,draw,renderer}=app;lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();
 const timer=setTimeout(async()=>{reports.error='Benchmark did not finish within 90 seconds (possibly hidden window)';lab.qaRunning=true;await shutdown();Deno.exit(1);},90000);timer.unref?.();
 lab.optimizations.sharedWaterInputs=true;
 draw.fixedLoadScale=.5;document.getElementById('adaptive').checked=false;
 lab.wind=workload==='calm'?0:12;lab.tidesEnabled=false;lab.lunarCycle=false;lab.rain.enabled=workload==='rain';lab.rain.rate=600;lab.day=14;
 Object.assign(lab.optimizations,{simdPressure:false,simdParticles:false});
 if(workload!=='calm'){
  for(let i=0;i<144;i++){
   const x=-3.8+(i%12)*.62,z=1.8+(Math.floor(i/12)%4)*.65,y=lab.sand.height(x,z),chunks=lab.sand.extract([x,y,z],.18,[0,0,0],true);
   for(const p of chunks){p.held=false;p.position[0]+=.24;p.position[1]=lab.sand.height(p.position[0],p.position[2])+.06;p.anchored=true;p.layer=true;}
   lab.sand.editPolicy.maintain(lab.sand);lab.sand.update();
  }
  lab.tannins=1.2;
  const sea=lab.seaFoam;sea.generation(lab);sea.surface.update(lab);sea.surfaceTexture.needsUpdate=true;
  for(let i=0;i<sea.size*sea.size;i++){const o=i*4,x=i%sea.size,z=Math.floor(i/sea.size),wet=sea.surface.surface[o]>sea.surface.surface[o+1];sea.reference[o+(wet?0:1)]=(Math.sin(x*.33+z*.12)>.3&&z>34)?.4:0;}
  sea.zero.image.data=sea.reference;sea.zero.needsUpdate=true;sea.u.uSeaState.value=sea.zero;sea.active=true;sea.revision++;
 }
 await setBatchKernel(await Deno.readFile('src/rtx-sand-lab/fields/batch/grid.wasm'));installFieldBatch(lab);lab.optimizations.fieldBatch=mode==='batch';
 lab.syncUniforms();draw.drawKey=null;
 // One warmup draw ensures experiment uniforms and targets are initialized.
 draw.render({dt:0,adaptive:false});await renderer.flush();renderer.assertHealthy();
 reports.experiment={mode,workload,edits:workload==='calm'?0:144,sandParcels:lab.sand.parcels.length,waterSamples:lab.count,discardFrames:16,renderSize:[draw.field.target.width,draw.field.target.height],allocationMiB:renderer.allocationBytes/1048576,backend:lab.bulkFields.particleBackend,get batchBytes(){return lab.bulkFields.grid?.faceBatch?.bytes||0;}};
 const profile=reports.profile={};
 const finish=lab.bulkFields.finish.bind(lab.bulkFields);lab.bulkFields.finish=(...args)=>{const result=finish(...args);if(reports.totalFrames>=16)for(const key of ['prepareMs','scalarMs','gatherMs','neighborMs','surfaceMs','transportMs']){const ms=lab.bulkFields.stats[key];if(Number.isFinite(ms)){const row=profile[key]??={calls:0,ms:0,max:0};row.calls++;row.ms+=ms;row.max=Math.max(row.max,ms);}}return result;};
 const wrap=(o,key,label)=>{if(!o?.[key])return;const fn=o[key];o[key]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{const row=profile[label]??={calls:0,ms:0,max:0};const ms=performance.now()-start;row.calls++;row.ms+=ms;row.max=Math.max(row.max,ms);}};};
 for(const [o,key,label] of [[lab.detail.contact,'update','fine contact'],[lab,'prepareStep','prepare'],[lab,'finishCPUFieldStep','finish'],[lab,'publishCPUFieldSteps','publish'],[lab.bulkFields,'prepare','deposit'],[lab.bulkFields,'finishFields','scalars'],[lab.bulkFields,'finish','transfer+surface+transport'],[lab.bulkFields,'solveCPU','pressure'],[lab.bulkFields.grid,'setPhase','topology'],[lab.bulkFields.grid,'transport','scalar transport'],[lab.bulkFields.grid,'buildAirVelocity','air extension'],[lab.detail,'emit','emission'],[lab.detail,'advance','detail'],[lab.detail.flow.field,'updateBulk','flow reconstruct'],[lab.seaFoam.surface,'update','foam input'],[draw,'updateParticles','optical particles'],[draw.density,'update','optical reconstruct'],[draw.blobRenderer,'update','daughter geometry'],[draw.rainSurface,'update','rain input'],[lab.wetting,'step','wetting'],[lab,'stepBodies','rigid bodies'],[lab,'syncUniforms','uniforms'],[lab.rain,'step','rain']])wrap(o,key,label);
 reports.ownership={cpuPhysics:lab.gpu.cpu,fieldBackend:lab.bulkFields.particleBackend,flowCPU:lab.detail.cpu,renderCPU:draw.density.cpu};
 const render=draw.render.bind(draw);draw.render=(...args)=>{if(mode==='interleaved'){const frame=reports.totalFrames||0,block=Math.floor((frame-32)/16)%4;lab.optimizations.fieldBatch=frame<32?frame>=16:block===1||block===2;(reports.modeFrames??=[])[frame]=lab.optimizations.fieldBatch?'batch':'reference';}const result=render(...args);reports.stages={...draw.cpuStages};reports.fieldStats={...lab.bulkFields.stats,potential:undefined};return result;};
 reports.totalFrames=0;reports.frames=[];lab.qaRunning=false;lab.paused=false;document.getElementById('pause').textContent='Pause';
}});
