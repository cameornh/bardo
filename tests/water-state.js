import {createCleanupFixture} from './webgpu-pass-cleanup-fixture.js';
import {firstFrameShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
import {ResidentWaterPipeline} from '../src/rtx-sand-lab/fields/resident/pipeline.js';
import {verifyConnected} from '../src/rtx-sand-lab/fields/connected/verify.js';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
import {installResidentWater} from '../src/rtx-sand-lab/fields/resident/install.js';
const canvas=document.querySelector('#view'),out=document.querySelector('#result'),report={checks:[],runs:[]};let fixture,pipeline;
const show=v=>out.textContent=JSON.stringify(v,null,2),frame=()=>new Promise(requestAnimationFrame);
function cleanup(){pipeline?.dispose();fixture?.renderer.dispose();fixture=null;pipeline=null;}
function action(id,fn){document.querySelector('#'+id).onclick=async()=>{const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await fn();}catch(e){const failure={action:id,pass:false,error:e.stack};report.checks.push(failure);show(failure);cleanup();}finally{buttons.forEach(b=>b.disabled=false);}};}
async function check(p){
 const r=await verifyConnected(p);if(!r.pass)throw Error(JSON.stringify(r));report.checks.push({name:'original CPU/GPU oracles',...r});
 const v=await p.verifyState();report.checks.push({name:'persistent state and GPU prediction',...v});return v;
}
action('verify',async()=>{const p=await new ResidentWaterPipeline().initialize();try{show(await check(p));}finally{p.dispose();}});
action('prepare',async()=>{
 cleanup();const params=new URLSearchParams(location.search),width=Math.min(640,Math.max(320,Number(params.get('width'))||320)),resolution=Math.min(1.4,Math.max(1,Number(params.get('resolution'))||1));
 fixture=await createCleanupFixture(canvas,{width,height:Math.round(width*.625),resolution});installFieldLocality(fixture.lab);installResidentWater(fixture.lab);
 for(const job of firstFrameShaderJobs(fixture.draw)){show({phase:'compile',name:job.name});await fixture.renderer.compileAsync(job.scene,job.camera);}
 fixture.draw.render({dt:0,adaptive:false});await fixture.complete();
 pipeline=await fixture.lab.bulkFields.createConnectedPipeline().initialize(fixture.lab.bulkFields.sharedDevice());show({phase:'numerical checks'});await check(pipeline);fixture.lab.bulkFields.connected=pipeline;
 show({pass:true,phase:'ready',water:fixture.lab.count,size:[width,Math.round(width*.625)]});
});
function reset(enabled){const {lab,draw}=fixture;lab.optimizations.residentWater=enabled;lab.configure('ocean');lab.rain.enabled=false;lab.tannins=0;lab.lunarCycle=false;lab.seaFoam.reset();lab.clock=draw.clock=0;lab.bulkFields.ensure();lab.bulkFields.particleBackend='connected';}
async function step(){const {lab,draw}=fixture,began=performance.now(),ctx=lab.prepareStep(lab.timestep);const positions=await lab.bulkFields.solveAsync(ctx);if(lab.bulkFields.particleBackend!=='connected')throw Error('Unexpected CPU fallback: '+lab.bulkFields.stats.particleFallback);lab.finishStep(ctx,positions);const physicsMs=performance.now()-began;draw.render({dt:lab.timestep,adaptive:false});await fixture.complete();return {frameMs:performance.now()-began,physicsMs,particle:lab.bulkFields.stats.particleCompute};}
action('measure',async()=>{
 if(!fixture)throw Error('Prepare beach first');const blocks=[],{lab,renderer}=fixture;
 for(const enabled of [false,true,true,false]){
  reset(enabled);const rows=[];let start;
  for(let i=-12;i<48;i++){const r=await step();if(i===-1)start=performance.now();if(i>=0)rows.push(r);if(i%8===0)show({phase:'measure',enabled,block:blocks.length+1,frame:i+1});await frame();}
  const wall=(performance.now()-start)/1000,sorted=rows.map(r=>r.frameMs).sort((a,b)=>a-b);blocks.push({enabled,wall,fps:48/wall,realtime:48*lab.timestep/wall,p95Ms:sorted[45],rows});
 }
 const summary=[false,true].map(enabled=>{const b=blocks.filter(b=>b.enabled===enabled),wall=b.reduce((s,b)=>s+b.wall,0),rows=b.flatMap(b=>b.rows);return {enabled,fps:rows.length/wall,realtime:rows.length*lab.timestep/wall,physicsMs:rows.reduce((s,r)=>s+r.physicsMs,0)/rows.length,particleMs:rows.reduce((s,r)=>s+r.particle.totalMs,0)/rows.length,particleUploadBytes:enabled?rows.reduce((s,r)=>s+r.particle.particleUploadBytes,0)/rows.length:lab.count*68,readbackBytes:rows[0].particle.readbackBytes};});
 const run={summary,blocks,adapter:{vendor:renderer.adapter.info.vendor,architecture:renderer.adapter.info.architecture},water:lab.count,renderSize:[canvas.width,canvas.height]};report.runs.push(run);show({...run,blocks:blocks.map(({rows,...b})=>b)});
});
action('features',async()=>{
 if(!fixture)throw Error('Prepare beach first');reset(true);const {lab}=fixture,rows=[];
 for(let i=0;i<24;i++){
  if(i===3){lab.positions[3]=1;lab.positions[0]+=.1;lab.chem[1]=.6;}
  if(i===6)lab.positions[3]=0;
  if(i===9){lab.rain.enabled=true;lab.rain.rate=60;lab.tannins=.6;}
  if(i===12)lab.spawn('glass',[0,2,0],[0,0,-1],'cup');
  if(i===15)lab.optimizations.residentWater=false;
  if(i===18)lab.optimizations.residentWater=true;
  const r=await step();rows.push({step:i,resident:!!r.particle.resident,prediction:!!r.particle.gpuPrediction,patches:r.particle.patchedParticles,reset:r.particle.reset,count:lab.count,bodies:lab.balls.length});await frame();
 }
 const result={pass:true,name:'feature synchronization',rows};report.checks.push(result);show(result);
});
action('lifecycle',async()=>{
 if(!fixture)throw Error('Prepare beach first');reset(true);const {lab,draw}=fixture,fields=lab.bulkFields,rows=[];
 const record=async(name)=>{const r=await step();const x={name,count:lab.count,resident:r.particle.resident,prediction:r.particle.gpuPrediction,reset:r.particle.reset,patches:r.particle.patchedParticles};rows.push(x);return x;};
 await record('seed');await record('unchanged');
 const count=lab.count;lab.rain.appendParcels([{position:[0,2,0],velocity:[0,-.1,0]}]);
 const appended=await record('rain append');if(appended.count!==count+1||!appended.reset)throw Error('Append did not reseed');
 const removed=lab.carveWater(Array.from(lab.positions.subarray(0,3)),lab.spacing*.6);if(!removed)throw Error('Carve fixture removed no water');
 if(!(await record('water carve')).reset)throw Error('Removal did not reseed');
 lab.setPlayer([0,1.7,0],[.01,0,.02],.028,.165);const player=await record('first person');if(player.prediction||!player.resident)throw Error('Player reference prediction not preserved');lab.setPlayer(null,[0,0,0]);
 // Reject one job before submission to exercise the real CPU recovery path.
 const solve=pipeline.solve;pipeline.solve=async()=>{throw Error('Deliberate pre-submit CPU fallback');};
 let ctx;try{ctx=lab.prepareStep(lab.timestep);if(!ctx.predictionDeferred)throw Error('Fallback fixture did not defer');const next=await fields.solveAsync(ctx);lab.finishStep(ctx,next);}finally{pipeline.solve=solve;}
 if(ctx.predictionDeferred||fields.particleBackend!=='cpu')throw Error('CPU fallback left stale prediction');draw.render({dt:lab.timestep,adaptive:false});await fixture.complete();rows.push({name:'CPU fallback',pass:true});
 fields.particleBackend='connected';if(!(await record('GPU resume')).reset)throw Error('Intervening CPU step not synchronized');
 lab.configure('ocean');fields.ensure();fields.particleBackend='connected';if(!(await record('scene reset')).reset)throw Error('Generation reset not synchronized');
 const result={name:'lifecycle and CPU fallback',pass:true,rows};report.checks.push(result);show(result);
});
action('export',async()=>{show(report);const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));link.href=url;link.download='water-state.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
action('image',async()=>{if(!fixture)throw Error('Prepare beach first');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='water-state.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
