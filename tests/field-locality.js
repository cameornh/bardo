import {createCleanupFixture} from './webgpu-pass-cleanup-fixture.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
import {ConnectedPipeline} from '../src/rtx-sand-lab/fields/connected/pipeline.js';
import {LocalPressurePipeline} from '../src/rtx-sand-lab/fields/research/local-pressure.js';
import {verifyConnected} from '../src/rtx-sand-lab/fields/connected/verify.js';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
const canvas=document.querySelector('#view'),out=document.querySelector('#result'),report={checks:[],runs:[]};let fixture,pipelines;
const show=v=>out.textContent=JSON.stringify(v,null,2),frame=()=>new Promise(requestAnimationFrame);
function cleanup(){for(const p of new Set([...(pipelines||[]),fixture?.lab.bulkFields?.connected]))p?.dispose();fixture?.renderer.dispose();fixture=null;pipelines=null;}
function action(id,fn){document.querySelector('#'+id).onclick=async()=>{const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await fn();}catch(e){const failure={action:id,pass:false,error:e.stack};report.checks.push(failure);show(failure);cleanup();}finally{buttons.forEach(b=>b.disabled=false);}};}
action('verify',async()=>{
 const p=await new LocalPressurePipeline().initialize();try{const result=await verifyConnected(p);report.checks.push({name:'coarse-local',...result});show(report.checks.at(-1));}finally{p.dispose();}
});
action('prepare',async()=>{
 cleanup();fixture=await createCleanupFixture(canvas);installFieldLocality(fixture.lab);
 for(const job of firstFrameShaderJobs(fixture.draw)){show({phase:'compile',name:job.name});await fixture.renderer.compileAsync(job.scene,job.camera);}
 fixture.draw.render({dt:0,adaptive:false});await fixture.complete();show({pass:true,phase:'ready',water:fixture.lab.count});
});
function reset(optimized){const {lab,draw}=fixture;lab.optimizations.fieldTopology=optimized;lab.configure('ocean');lab.rain.enabled=false;lab.tannins=0;lab.lunarCycle=false;lab.seaFoam.reset();lab.clock=draw.clock=0;lab.bulkFields.ensure();}
async function measure(mode){
 if(!fixture)throw Error('Prepare beach first');const {lab,draw,renderer}=fixture,blocks=[];
 if(mode==='gpu'&&!pipelines){lab.bulkFields.connected?.dispose();pipelines=[];for(const Type of [ConnectedPipeline,LocalPressurePipeline]){show({phase:'verify',name:Type.name});const p=await new Type().initialize(lab.bulkFields.sharedDevice());pipelines.push(p);const r=await verifyConnected(p);if(!r.pass)throw Error(JSON.stringify(r));report.checks.push({name:Type.name,...r});}}
 for(const optimized of [false,true,true,false]){
  reset(optimized);const fields=lab.bulkFields;fields.particleBackend=mode==='gpu'?'connected':'cpu';if(mode==='gpu')fields.connected=pipelines[+optimized];
  const rows=[];let start;
  for(let i=-12;i<48;i++){
   const began=performance.now();
   if(mode==='gpu'){const context=lab.prepareStep(lab.timestep);const positions=await fields.solveAsync(context);if(fields.particleBackend!=='connected')throw Error('Unexpected CPU fallback: '+fields.stats.particleFallback);lab.finishStep(context,positions);}
   else lab.step(lab.timestep);
   const physicsMs=performance.now()-began;draw.render({dt:lab.timestep,adaptive:false});await fixture.complete();
   if(i===-1)start=performance.now();if(i>=0)rows.push({frameMs:performance.now()-began,physicsMs,prepareMs:fields.stats.prepareMs,scalarMs:fields.stats.scalarMs,pressureMs:fields.stats.milliseconds,particle:fields.stats.particleCompute});
   if(i%8===0)show({phase:'measure',mode,optimized,block:blocks.length+1,frame:i+1});await frame();
  }
  const wall=(performance.now()-start)/1000,sorted=rows.map(r=>r.frameMs).sort((a,b)=>a-b);blocks.push({optimized,wall,fps:48/wall,realtime:48*lab.timestep/wall,p95Ms:sorted[45],rows});
 }
 const summary=[false,true].map(optimized=>{const b=blocks.filter(b=>b.optimized===optimized),wall=b.reduce((s,b)=>s+b.wall,0),rows=b.flatMap(b=>b.rows);return {optimized,fps:rows.length/wall,realtime:rows.length*lab.timestep/wall,physicsMs:rows.reduce((s,r)=>s+r.physicsMs,0)/rows.length,prepareMs:rows.reduce((s,r)=>s+r.prepareMs,0)/rows.length};});
 report.runs.push({mode,changes:mode==='gpu'?['fixed neighbors','numeric aggregation keys','coarse workgroup memory']:['fixed neighbors','numeric aggregation keys'],summary,blocks,adapter:renderer.adapter.info,water:lab.count,renderSize:[320,200]});show(report.runs.at(-1));
}
action('cpu',()=>measure('cpu'));action('gpu',()=>measure('gpu'));
action('live',async()=>{
 if(!fixture)throw Error('Prepare beach first');const {lab,draw}=fixture;
 for(const p of new Set([...(pipelines||[]),lab.bulkFields.connected]))p?.dispose();pipelines=null;lab.bulkFields.connected=null;
 installFieldLocality(lab);const verification=await lab.bulkFields.verifyConnected();if(!verification.pass)throw Error(JSON.stringify(verification));
 lab.bulkFields.particleBackend='connected';const rows=[];
 for(const enabled of [false,true]){
  lab.optimizations.fieldTopology=lab.optimizations.fieldLocalPressure=enabled;
  for(let i=0;i<12;i++){
   const context=lab.prepareStep(lab.timestep),next=await lab.bulkFields.solveAsync(context);if(lab.bulkFields.particleBackend!=='connected')throw Error('Unexpected fallback');lab.finishStep(context,next);
   draw.render({dt:lab.timestep,adaptive:false});await fixture.complete();await frame();
   rows.push({enabled,residual:lab.bulkFields.stats.relativeResidual,topology:!!lab.bulkFields.grid.topologyBuilder,coarseLocal:lab.bulkFields.connected.fields.packed.fieldConfig[23]});
  }
 }
 const result={name:'live integration',pass:rows.every(r=>r.topology===r.enabled&&r.coarseLocal===+r.enabled),verification,rows};report.checks.push(result);show(result);
});
action('export',async()=>{show(report);const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));link.href=url;link.download='field-locality.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
action('image',async()=>{if(!fixture)throw Error('Prepare beach first');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('No preview image');const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='field-locality.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
