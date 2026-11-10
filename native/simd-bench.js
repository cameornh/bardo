import {runNative} from './runtime.js';
// The ordinary capped application loop, CPU physics / native WebGPU drawing.
// Each invocation owns one bounded window and exits; run comparisons serially.
const mode=Deno.args[0]||'scalar',workload=Deno.args[1]||'calm',tag=Deno.args[2]||'trial';
if(!['scalar','pressure','particles','both'].includes(mode)||!['calm','edited'].includes(workload))throw Error('Unknown benchmark mode/workload');
await runNative({width:640,height:400,resolution:1.4,backend:'safe',frames:96,exit:true,report:`.native/simd-${workload}-${mode}-${tag}.json`,screenshot:`.native/simd-${workload}-${mode}-${tag}.png`,onReady:async({app,reports})=>{
 const {lab,draw}=app;lab.paused=true;lab.qaRunning=true;await app.waitForSceneIdle();
 Object.assign(lab.optimizations,{simdPressure:mode==='pressure'||mode==='both',simdParticles:mode==='particles'||mode==='both'});
 lab.wind=workload==='calm'?0:12;lab.tidesEnabled=false;lab.lunarCycle=false;lab.rain.enabled=false;
 draw.fixedLoadScale=.5;document.getElementById('adaptive').checked=false;
 if(workload==='edited')for(let i=0;i<144;i++){
  const x=-3.8+(i%12)*.62,z=1.8+(Math.floor(i/12)%4)*.65,y=lab.sand.height(x,z),chunks=lab.sand.extract([x,y,z],.18,[0,0,0],true);
  for(const p of chunks){p.held=false;p.position[0]+=.24;p.position[1]=lab.sand.height(p.position[0],p.position[2])+.06;p.anchored=true;p.layer=true;}
  lab.sand.editPolicy.maintain(lab.sand);lab.sand.update();
 }
 lab.syncUniforms();reports.experiment={mode,workload,edits:workload==='edited'?144:0,sandParcels:lab.sand.parcels.length,discardFrames:16};reports.kernelSteps=[];
 const solve=lab.bulkFields.solve.bind(lab.bulkFields);lab.bulkFields.solve=(...args)=>{const start=performance.now(),result=solve(...args);reports.kernelSteps.push({ms:performance.now()-start,...lab.bulkFields.stats});return result;};
 reports.totalFrames=0;reports.frames=[];lab.qaRunning=false;lab.paused=false;document.getElementById('pause').textContent='Pause';
}});
