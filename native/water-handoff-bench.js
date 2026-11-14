import {runNative} from './runtime.js';
import {installWaterConsumers} from '../.native/generated/water-consumers.mjs';


// Ordinary capped application loop, one bounded native window per invocation.
// Simulation and rendering continue together; timings include presentation.
const [mode='reference',workload='busy',tag='profile']=Deno.args;
if(!['reference','shared'].includes(mode)||!['calm','busy','rain'].includes(workload))throw Error('Unknown water-handoff benchmark');
await Deno.mkdir('.native/water-handoff',{recursive:true});
await runNative({width:640,height:400,resolution:1.4,backend:'safe',headless:tag==='offscreen',frames:tag==='offscreen'?32:96,exit:true,report:`.native/water-handoff/${workload}-${mode}-${tag}.json`,screenshot:`.native/water-handoff/${workload}-${mode}-${tag}.png`,onReady:async({app,reports})=>{
 const {lab,draw,renderer}=app;lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();
 if(draw.waterConsumers)draw.waterConsumers.enabled=false;
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
 const experiment=mode==='shared'?await installWaterConsumers(draw):null;
 if(experiment){experiment.enabled=true;for(const k of Object.keys(experiment.gpu.stats))experiment.gpu.stats[k]=0;}
 lab.syncUniforms();draw.drawKey=null;
 // One warmup draw ensures experiment uniforms and targets are initialized.
 draw.render({dt:0,adaptive:false});await renderer.flush();renderer.assertHealthy();
 reports.experiment={mode,workload,edits:workload==='calm'?0:144,sandParcels:lab.sand.parcels.length,waterSamples:lab.count,discardFrames:16,renderSize:[draw.field.target.width,draw.field.target.height],allocationMiB:renderer.allocationBytes/1048576,backend:lab.bulkFields.particleBackend,get consumers(){return experiment?.gpu.stats;}};
 const profile=reports.profile={};
 const wrap=(o,key,label)=>{if(!o?.[key])return;const fn=o[key];o[key]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{const row=profile[label]??={calls:0,ms:0,max:0};const ms=performance.now()-start;row.calls++;row.ms+=ms;row.max=Math.max(row.max,ms);}};};
 for(const [o,key,label] of [[lab.detail.contact,'update','fine contact'],[lab,'prepareStep','prepare'],[lab,'finishCPUFieldStep','finish'],[lab,'publishCPUFieldSteps','publish'],[lab.bulkFields,'prepare','deposit'],[lab.bulkFields,'finishFields','scalars'],[lab.bulkFields,'finish','transfer+surface+transport'],[lab.bulkFields,'solveCPU','pressure'],[lab.detail,'emit','emission'],[lab.detail,'advance','detail'],[lab.detail.flow.field,'updateBulk','flow reconstruct'],[lab.seaFoam.surface,'update','foam input'],[draw,'updateParticles','optical particles'],[draw.density,'update','optical reconstruct'],[draw.blobRenderer,'update','daughter geometry'],[draw.rainSurface,'update','rain input'],[lab.wetting,'step','wetting'],[lab,'stepBodies','rigid bodies'],[lab,'syncUniforms','uniforms'],[lab.rain,'step','rain']])wrap(o,key,label);
 reports.ownership={cpuPhysics:lab.gpu.cpu,fieldBackend:lab.bulkFields.particleBackend,flowCPU:lab.detail.cpu,renderCPU:draw.density.cpu};
 const render=draw.render.bind(draw);draw.render=(...args)=>{const result=render(...args);reports.stages={...draw.cpuStages};reports.fieldStats={...lab.bulkFields.stats,potential:undefined};return result;};
 reports.totalFrames=0;reports.frames=[];lab.qaRunning=false;lab.paused=false;document.getElementById('pause').textContent='Pause';
}});
