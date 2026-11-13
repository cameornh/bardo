import {runNative} from './runtime.js';
import {installRepresentations} from '../.native/generated/representation.mjs';

// Ordinary capped application loop, one bounded native window per invocation.
// Simulation and rendering continue together; timings include presentation.
const [mode='reference',workload='busy',tag='trial']=Deno.args;
if(!['reference','terrain','foam','both','lighting'].includes(mode)||!['calm','busy'].includes(workload))throw Error('Unknown representation benchmark');
await Deno.mkdir('.native/representation',{recursive:true});
await runNative({width:640,height:400,resolution:1.4,backend:'safe',frames:96,exit:true,report:`.native/representation/${workload}-${mode}-${tag}.json`,screenshot:`.native/representation/${workload}-${mode}-${tag}.png`,onReady:async({app,reports})=>{
 const {lab,draw,renderer}=app;lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();
 draw.fixedLoadScale=.5;document.getElementById('adaptive').checked=false;
 lab.wind=workload==='busy'?12:0;lab.tidesEnabled=false;lab.lunarCycle=false;lab.rain.enabled=false;lab.day=14;
 Object.assign(lab.optimizations,{simdPressure:false,simdParticles:false,terrainPolynomial:mode==='terrain'||mode==='both',foamGeometryCache:mode==='foam'||mode==='both'||mode==='lighting'});
 let experiment;
 if(mode!=='reference'){
  experiment=installRepresentations(draw,{terrain:lab.optimizations.terrainPolynomial,foam:lab.optimizations.foamGeometryCache,foamLighting:mode==='lighting'});
  const jobs=[...experiment.jobs(),...(experiment.terrain?[...draw.splitSurfaces.values()].flatMap(s=>s.jobs(draw.background)):[])];
  for(const job of jobs){renderer.setRenderTarget(job.target);await renderer.compileAsync(job.scene,job.camera);renderer.assertHealthy();}
 }
 if(workload==='busy'){
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
 lab.syncUniforms();draw.drawKey=null;
 // One warmup draw ensures experiment uniforms and targets are initialized.
 draw.render({dt:0,adaptive:false});await renderer.flush();renderer.assertHealthy();
 reports.experiment={mode,workload,edits:workload==='busy'?144:0,sandParcels:lab.sand.parcels.length,waterSamples:lab.count,discardFrames:16,renderSize:[draw.field.target.width,draw.field.target.height],allocationMiB:renderer.allocationBytes/1048576};
 reports.totalFrames=0;reports.frames=[];lab.qaRunning=false;lab.paused=false;document.getElementById('pause').textContent='Pause';
}});
