import {installOptimizationControls,applyOptimizationFlags,optimizationPreset} from '../sand-lab/optimization-controls.js';

// Async diagnostics for the native backend. Snapshot QA remains unchanged.
export function installWebGPUQA({lab,draw,field,renderer,camera,controls,results,panel,waitForIdle}){
 const defaults={...lab.optimizations};
 // WebGPU has no synchronous pixel readback. Keep the asynchronous route
 // selected even when the user disables other optional optimizations.
 const apply=flags=>{flags.gpuBatch=true;applyOptimizationFlags(lab,draw,flags);};
 const choices=installOptimizationControls(panel,defaults,flags=>{apply(flags);choices.setSelection(flags);lockAsync();});
 const lockAsync=()=>{const input=panel.querySelector('#optimization-gpuBatch');input.disabled=true;input.checked=true;input.title='WebGPU uses asynchronous transfers; synchronous readback is unavailable';};lockAsync();
 // Old stress fixtures request a synchronous diagnostic, not simulation data.
 // Keep their report useful without blocking the graphics queue for a readback.
 if(lab.grains)lab.grains.inspect=()=>({backend:'WebGPU resident grains',emitted:lab.grains.emitted,capacity:8192,note:'Per-grain readback omitted from this synchronous report'});

 const add=(label,action)=>{const button=document.createElement('button');button.textContent=label;panel.append(button);button.onclick=async()=>{
  if(lab.qaRunning)return;lab.qaRunning=true;lab.paused=true;button.disabled=true;choices.setBusy(true);document.getElementById('pause').textContent='Resume';
  try{await waitForIdle();await action();}catch(e){results.textContent=e.stack;}finally{lab.qaRunning=false;button.disabled=false;choices.setBusy(false);lockAsync();}
 };};
 const read=async target=>{const pixels=new Float32Array(target.width*target.height*4);await renderer.readRenderTargetPixelsAsync(target,0,0,target.width,target.height,pixels);return pixels;};
 add('Compare selected rendering',async()=>{
  const saved={...lab.optimizations},images=[],fixed=draw.fixedLoadScale;
  try{draw.fixedLoadScale=.5;for(const flags of [optimizationPreset(defaults,'baseline'),saved]){
   apply(flags);draw.render({dt:0,adaptive:false});await renderer.flush();images.push(await read(field.target));
  }let sum=0,max=0,finite=true;for(let i=0;i<images[0].length;i++)if(i%4<3){const d=Math.abs(images[0][i]-images[1][i]);sum+=d;max=Math.max(max,d);finite&&=Number.isFinite(d);}results.textContent=JSON.stringify({pass:finite,backend:'WebGPU',meanLinearColorError:sum/(images[0].length*.75),maxLinearColorError:max,resolution:[field.target.width,field.target.height]},null,2);
  }finally{applyOptimizationFlags(lab,draw,saved);draw.fixedLoadScale=fixed;}
 });
 add('Benchmark current scene on WebGPU',async()=>{
  const rows=[];let start=performance.now(),last=start,simStart=lab.time,accumulator=0;
  for(let i=-12;i<45;i++){
   const now=performance.now(),dt=Math.min(.25,(now-last)/1000);last=now;accumulator=Math.min(2*lab.timestep,accumulator+dt*lab.simulationSpeed);
   const cpuStart=performance.now();let steps=0;
   while(accumulator>=lab.timestep&&steps<2){if(lab.bulkFields.particleBackend!=='cpu'||lab.bulkFields.backend==='gpu'){const context=lab.prepareStep(lab.timestep),next=await lab.bulkFields.solveAsync(context);lab.finishStep(context,next);}else lab.step(lab.timestep);accumulator-=lab.timestep;steps++;}
   const cpu=performance.now()-cpuStart,before=performance.now();draw.render({dt,adaptive:false,focusDistance:camera.position.distanceTo(controls.target)});await renderer.flush();
   if(i===-1){start=performance.now();simStart=lab.time;}if(i>=0)rows.push({cpu,render:performance.now()-before,...renderer.frameTimes});
   results.textContent=`WebGPU complete scene: ${Math.max(0,i+1)} / 45 measured frames`;await new Promise(requestAnimationFrame);
  }
  const seconds=(performance.now()-start)/1000;results.textContent=JSON.stringify({backend:'WebGPU',physics:lab.bulkFields.stats.backend,frames:rows.length,fps:rows.length/seconds,realtime:(lab.time-simStart)/seconds,seconds,simulatedSeconds:lab.time-simStart,resolution:[field.target.width,field.target.height],water:lab.count,objects:lab.balls.length,rows},null,2);
 });
 add('Check object horizon',async()=>{
  const balls=lab.balls.slice(),position=camera.position.toArray(),direction=camera.getWorldDirection(camera.position.clone()).toArray();
  try{lab.balls=[];lab.revision++;draw.render({dt:0,adaptive:false});const before=await read(draw.background),records={};
   for(const kind of ['glass','mirror','rock','light']){lab.balls=[];lab.spawn(kind,position,direction);lab.revision++;draw.render({dt:0,adaptive:false});const after=await read(draw.background);let max=0,changed=0,pixels=0;
    for(let i=0;i<after.length;i+=4)if(before[i+3]>15&&before[i+3]<9999&&Math.abs(after[i+3]-before[i+3])<.01){const delta=Math.max(...[0,1,2].map(k=>Math.abs(before[i+k]-after[i+k])));max=Math.max(max,delta);changed+=delta>.002?1:0;pixels++;}records[kind]={max,changed,pixels};
   }results.textContent=JSON.stringify({records,pass:['glass','mirror','rock'].every(k=>records[k].pixels>0&&records[k].max<.002)},null,2);
  }finally{lab.balls=balls;lab.revision++;}
 });
 const link=document.createElement('a');link.href='/tests/webgpu-scene-backend.html';link.textContent='WebGPU / WebGL comparison and numerical checks';panel.append(link);
}
