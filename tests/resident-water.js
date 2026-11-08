import {currentCPU} from '../src/resident-water/current-cpu.js';
import {ResidentSimulation} from '../src/resident-water/simulation.js';
import {ResidentRenderer} from '../src/resident-water/renderer.js';
import {fixture,outputState,frameSchedule,LIMITS,stateMetrics} from '../src/resident-water/model.js';
import {referenceStep,compareState} from '../src/resident-water/reference.js';
const el=id=>document.getElementById(id),out=el('result'),hud=el('hud');let sim,draw,stop=false,running=false,verification,cpu,preparing=false,redraw=Promise.resolve(),failed=false,starting=false;
const yieldFrame=()=>new Promise(r=>requestAnimationFrame(r));
const report=value=>out.textContent=JSON.stringify(value,null,2);
const failure=e=>{if(failed)return;failed=true;stop=true;running=false;draw?.dispose();sim?.dispose();hud.textContent='Stopped safely. '+e.message;report({pass:false,error:e.stack});for(const id of ['start','prepare','run','play'])el(id).disabled=true;};
el('stop').onclick=()=>stop=true;document.addEventListener('visibilitychange',()=>{if(document.hidden)stop=true;});
el('verify').onclick=async()=>{
 el('verify').disabled=true;el('start').disabled=true;
 try{
  hud.textContent='Creating bounded WebGPU pipelines';sim=await new ResidentSimulation().initialize();const rows=[];
  for(const size of [48,192,1164]){
   const f=fixture(size===1164?1:1.4);f.positions=f.positions.slice(0,size*4);f.velocities=f.velocities.slice(0,size*4);f.chem=f.chem.slice(0,size*4);if(size>48)for(let i=0;i<f.positions.length/4;i++){f.velocities[i*4]=.08*Math.sin(i*.31);f.velocities[i*4+1]=.06*Math.cos(i*.27);f.chem[i*4+1]=.3+.1*Math.sin(i*.17);}
   sim.load(f);let cpu=outputState(f);
   for(let step=0;step<3;step++){hud.textContent=`Checking ${size} particles, step ${step+1}`;await yieldFrame();const reference=referenceStep(f,cpu);cpu=reference.state;await sim.submit(e=>sim.encode(e));const gpu=await sim.snapshot();rows.push({size,step:step+1,...compareState(gpu.state,cpu),fault:gpu.fault,beforeDivergence:reference.before,afterDivergence:reference.divergence});if(!rows.at(-1).pass||gpu.fault)throw Error('Numerical comparison failed: '+JSON.stringify(rows.at(-1)));}
  }
  // Deliberately crowded but bounded: 65 markers exceed a 64-slot hash
  // bucket. The guard must stop the job, not truncate it or retry it forever.
  const crowded=fixture(1.4);crowded.positions=new Float32Array(65*4);crowded.velocities=crowded.positions.slice();crowded.chem=crowded.positions.slice();for(let i=0;i<65;i++)crowded.positions.set([0,2,0,0],i*4);sim.load(crowded);let overflowGuard=false;
  try{await sim.submit(e=>sim.encode(e));}catch(e){if(!e.message.includes('Capacity guard'))throw e;overflowGuard=true;}
  if(!overflowGuard)throw Error('Capacity guard did not stop an overfull bucket');
  sim=await new ResidentSimulation().initialize();verification={pass:true,overflowGuard,adapter:sim.adapter,rows};report(verification);hud.textContent='Checks passed. Click Start test to show and play the beach, or Prepare beach for a paused view.';el('prepare').disabled=false;if(!starting)el('start').disabled=false;
 }catch(e){failure(e);}
};
el('prepare').onclick=async()=>{
 if(running||preparing)return;preparing=true;el('prepare').disabled=true;await redraw;
 try{
  draw?.dispose();cpu?.lab.bulkFields?.dispose();const f=fixture(Number(el('resolution').value));sim.load(f);cpu=el('backend').value==='current'?await currentCPU(f):null;hud.textContent='Preparing Gaussian rendering';await yieldFrame();const width=Number(new URLSearchParams(location.search).get('width')||640),height=Math.round(width*9/16);draw=await new ResidentRenderer(sim,el('view'),{width,height}).initialize();
  await sim.submit(e=>draw.encode(e));el('view').hidden=false;preparing=false;await viewChange();hud.textContent=`Ready · ${f.positions.length/4} particles · ${width} × ${height} · ${(sim.bytes/1048576).toFixed(1)} MiB compute storage`;el('run').disabled=false;el('play').disabled=false;el('prepare').disabled=false;report({pass:true,phase:'ready',adapter:sim.adapter,water:f.positions.length/4,storageBytes:sim.bytes,grid:sim.gridPlan.dims,verification});
 }catch(e){failure(e);}
};
function viewChange(){if(!draw||running||preparing)return redraw;redraw=redraw.then(async()=>{if(running||preparing||sim.disabled)return;const views={shore:[[4.8,4,4.4],[0,.65,0]],low:[[3.8,2.4,1.8],[0,1.2,-2]],top:[[0,10,.1],[0,0,0]]},v=views[el('camera').value];draw.camera.position.fromArray(v[0]);draw.camera.lookAt(...v[1]);draw.update({organic:Number(el('organic').value),debug:Number(el('debug').value)});try{await sim.submit(e=>draw.encode(e));}catch(e){failure(e);}});return redraw;}
for(const id of ['backend','resolution'])el(id).onchange=()=>{el('run').disabled=true;el('play').disabled=true;hud.textContent='Select Prepare beach to apply physics or resolution changes.';};
el('camera').onchange=viewChange;el('organic').onchange=viewChange;el('debug').onchange=viewChange;
async function stepAndDraw(steps){if(cpu){for(let i=0;i<steps;i++){const state=cpu.step(Number(el('wind').value));sim.device.queue.writeBuffer(sim.state,0,state);sim.time+=sim.fixture.dt;sim.steps++;}await sim.submit(e=>draw.encode(e));}else await sim.submit(e=>{for(let i=0;i<steps;i++)sim.encode(e,Number(el('wind').value));draw.encode(e);});}
async function run(seconds){
 await redraw;if(running||preparing||sim.disabled)return;running=true;stop=false;el('run').disabled=true;el('play').disabled=true;el('prepare').disabled=true;const rows=[];for(const id of ['backend','resolution','camera','organic','wind','debug'])el(id).disabled=true;
 try{
  // Warmup consumes earned time too, and is excluded from measured totals.
  const warmStart=performance.now();for(let i=0;i<24&&!stop;i++){while(performance.now()<warmStart+(i+1)*sim.fixture.dt*1000&&!stop)await yieldFrame();if(!stop)await stepAndDraw(1);}
  const start=performance.now(),initialTime=sim.time;let last=start,accumulator=0;
  while(!stop&&(performance.now()-start)/1000<seconds){
   await yieldFrame();const begin=performance.now(),elapsed=(begin-last)/1000;if(elapsed<(1/60-.0005))continue;last=begin;
   const schedule=frameSchedule(accumulator,elapsed,sim.fixture.dt);accumulator=schedule.accumulator;
   draw.update({organic:Number(el('organic').value),debug:Number(el('debug').value)});await stepAndDraw(schedule.steps);
   const ms=performance.now()-begin;if(ms>LIMITS.frameMs)throw Error('Stopped after a frame exceeded the bounded workload budget');rows.push({ms,steps:schedule.steps});const wall=(performance.now()-start)/1000;hud.textContent=`FPS: ${(rows.length/wall).toFixed(1)} · Simulation: ${((sim.time-initialTime)/wall).toFixed(2)}× realtime · ${cpu?'Current CPU + WebGPU render':'WebGPU resident'}`;
  }
  const wall=(performance.now()-start)/1000,simulated=sim.time-initialTime;const checkpoint=await sim.snapshot(),sorted=rows.map(r=>r.ms).sort((a,b)=>a-b),finite=checkpoint.state.every(Number.isFinite);
  report({pass:finite&&checkpoint.fault===0,backend:cpu?'Current CPU + WebGPU rendering':'WebGPU resident simulation + rendering',adapter:sim.adapter,particles:sim.fixture.positions.length/4,resolution:sim.fixture.resolution,width:draw.width,height:draw.height,wind:Number(el('wind').value),organic:Number(el('organic').value),camera:el('camera').value,display:el('debug').value,fps:rows.length/wall,realtime:simulated/wall,frames:rows.length,wallSeconds:wall,simulatedSeconds:simulated,dt:sim.fixture.dt,frameMs:{mean:rows.reduce((s,r)=>s+r.ms,0)/rows.length,median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)]},runtimeParticleReadbackBytes:0,runtimeHealthReadbackBytes:rows.length*16,runtimeParticleUploadBytes:cpu?Math.round(simulated/sim.fixture.dt)*sim.fixture.positions.length/4*80:0,checkpointOutsideTiming:true,fault:checkpoint.fault,finite,storageBytes:sim.bytes,gridCells:sim.gridPlan.count,state:stateMetrics(sim.fixture,checkpoint.state),rows});
  if(!finite||checkpoint.fault)throw Error('Checkpoint failed; no further work submitted');
 }catch(e){failure(e);return;}finally{running=false;for(const id of ['backend','resolution','camera','organic','wind','debug'])el(id).disabled=false;}
 el('run').disabled=false;el('play').disabled=false;el('prepare').disabled=false;
}
el('run').onclick=()=>run(15);el('play').onclick=()=>run(30);
// One visible entry point retains the exact checks and bounded workload, but
// no longer makes users discover three separate startup buttons in sequence.
el('start').onclick=async()=>{
 if(starting||running||preparing||failed)return;starting=true;el('start').disabled=true;
 try{if(!verification)await el('verify').onclick();if(failed)return;await el('prepare').onclick();if(failed)return;el('start').hidden=true;await run(30);if(!failed)hud.textContent+=' · Paused — select Play 30 seconds to continue.';}
 catch(e){failure(e);}finally{starting=false;}
};

window.addEventListener('pagehide',()=>{stop=true;draw?.dispose();sim?.dispose();cpu?.lab.bulkFields?.dispose();});
