import {verifyPerformancePaths} from './performance-paths-verify.js';
import {pollLabReadbacks} from './water-lab-readback.js';
// Development-only controls. Reference modes retain the original algorithms.
// Fixed scheduling compares equal physics work; live scheduling measures the
// production time budget. Both keep resolution and particle limits unchanged.
export function installPerformanceQA({lab,draw,field,renderer,camera,controls,reset,results,panel}){
 const defaults={...lab.optimizations},select=document.createElement('select');select.setAttribute('aria-label','Performance comparison mode');
 for(const [value,label] of [['all','All optimizations'],['reference','Reference paths'],['baseline','Before this performance pass'],...Object.keys(defaults).map(k=>[k,`All except ${k}`])]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}panel.append(select);
 const workload=document.createElement('select');workload.setAttribute('aria-label','Performance workload');for(const [value,label] of [['standard','Standard beach'],['large','Large beach, maximum resolution'],['busy','Sand drops and eight objects']]){const o=document.createElement('option');o.value=value;o.textContent=label;workload.append(o);}panel.append(workload);
 const schedule=document.createElement('select');schedule.setAttribute('aria-label','Benchmark scheduling');for(const [value,label] of [['fixed','Equal physics work'],['live','Live scheduler']]){const o=document.createElement('option');o.value=value;o.textContent=label;schedule.append(o);}panel.append(schedule);
 function apply(mode){for(const k of Object.keys(defaults))lab.optimizations[k]=mode==='reference'||mode==='baseline'&&['mergeWindDeposits','settlingIndex','patchFloor','predictBudget','fastHeight','windGeometry','fastEmission','terrainCache','sandPrograms','stressPruning','fastPredict','emitterProbes','packedFlow','packedFields','neighborBounds','boundaryReuse','fastSampling','sandQueryBounds','compactSand','blobDepth'].includes(k)?false:mode===k?false:defaults[k];lab.gpu.neighborOrigin=null;lab.sandRevision=-1;draw.densityRevision=-1;draw.drawKey=null;draw.detailRenderer.pathsKey=null;draw.mediumShadows.key=null;draw.mediumShadows.tiles.key=null;lab.revision++;}
 select.onchange=()=>apply(select.value);
 const imageCheck=document.createElement('button');imageCheck.textContent='Compare optimized rendering';panel.append(imageCheck);
 imageCheck.onclick=async()=>{
  if(lab.qaRunning)return;lab.qaRunning=true;const saved={...lab.optimizations},oldAdaptive=draw.adaptiveResolution,oldFixed=draw.fixedLoadScale;lab.paused=true;
  try{
   draw.adaptiveResolution=false;draw.fixedLoadScale=.5;camera.updateMatrixWorld();
   const images=[];
   for(const mode of ['baseline','all']){apply(mode);draw.render({dt:1/15,adaptive:false,focusDistance:camera.position.distanceTo(controls.target)});const t=field.target,data=new Float32Array(t.width*t.height*4),depth=new Float32Array(data.length);renderer.readRenderTargetPixels(t,0,0,t.width,t.height,data);renderer.readRenderTargetPixels(draw.water,0,0,t.width,t.height,depth);images.push({data,depth});await new Promise(requestAnimationFrame);}
   let sum=0,max=0,missing=0,nonFinite=0,depthSum=0,hits=0;const n=images[0].data.length/4;
   for(let i=0;i<n;i++){for(let k=0;k<3;k++){const d=Math.abs(images[0].data[i*4+k]-images[1].data[i*4+k]);sum+=d;max=Math.max(max,d);if(!Number.isFinite(d))nonFinite++;}const a=images[0].depth[i*4+3],b=images[1].depth[i*4+3];if(a<999&&b>=999)missing++;if(a<999&&b<999){depthSum+=Math.abs(a-b);hits++;}}
   results.textContent=JSON.stringify({fixture:'fixed-state render comparison',resolution:[field.target.width,field.target.height],meanLinearColorError:sum/(n*3),maxLinearColorError:max,meanWaterDepthError:depthSum/Math.max(1,hits),missingWaterPixels:missing,totalPixels:n,nonFinite,pass:nonFinite===0&&sum/(n*3)<.015&&missing/n<.003},null,2);
  }catch(e){results.textContent=e.stack;}finally{Object.assign(lab.optimizations,saved);lab.sandRevision=-1;draw.drawKey=null;draw.densityRevision=-1;draw.mediumShadows.key=null;draw.detailRenderer.pathsKey=null;draw.adaptiveResolution=oldAdaptive;draw.fixedLoadScale=oldFixed;lab.qaRunning=false;document.getElementById('pause').textContent='Resume';}
 };
 const numerical=document.createElement('button');numerical.textContent='Verify performance paths on GPU';panel.append(numerical);numerical.onclick=()=>{if(lab.qaRunning)return;try{results.textContent=JSON.stringify(verifyPerformancePaths(renderer,lab),null,2);}catch(e){results.textContent=e.stack;}};
 const button=document.createElement('button');button.textContent='Benchmark matched beach';panel.append(button);
 button.onclick=async(options={})=>{
  const measured=options.longRun?600:45,total=measured+15,samples=[];
  if(lab.qaRunning)return;lab.qaRunning=true;button.disabled=true;
  const previous={adaptive:draw.adaptiveResolution,load:draw.loadScale,fixed:draw.fixedLoadScale,quality:lab.resolutions.ocean,scale:lab.scaleMultipliers.ocean};
  try{
   reset();apply(select.value);
   lab.resolutions.ocean=workload.value==='large'?3:2.2;lab.configure('ocean',workload.value==='large'?2:1);lab.radius=.45;
   if(workload.value==='busy'){
    for(let j=0;j<12;j++){const x=(j%6-2.5)*.65,z=3+Math.floor(j/6)*.55,y=lab.sand.height(x,z);const pieces=lab.sand.extract([x,y,z],.26,[0,0,0],false);for(const p of pieces){p.position[1]+=.65+(j%3)*.18;p.wet=j%3===0?.9:0;p.memory=p.wet;}}
    lab.objectRadius=.18;for(let j=0;j<8;j++){const b=lab.spawn(['rock','glass','mirror','light'][j%4],[-2.8+j*.8,2.4,.3],[0,0,-1]);b.velocity.fill(0);}
    lab.sand.update();lab.syncUniforms();
   }
   lab.paused=false;lab.frameDrivenLens=true;lab.wetting.cameraEnabled=false;
   camera.position.set(4.8,4,4.4);controls.target.set(0,.65,0);camera.lookAt(controls.target);camera.updateMatrixWorld();
   draw.adaptiveResolution=false;draw.fixedLoadScale=.5;field.motion.factor=1;
   const frames=[],neighbor=[],read=[],cpu={},geometryStart=lab.sandBinRebuilds||0;let started,simStart,stepStart,lastFrame=performance.now();
   const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),adapter=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
   for(let i=0;i<total;i++){
    await new Promise(requestAnimationFrame);if(i===15){started=performance.now();simStart=lab.time;stepStart=lab.steps;}
    pollLabReadbacks(renderer);await Promise.resolve();const start=performance.now();if(schedule.value==='live')lab.advance((start-lastFrame)/1000,camera);else lab.step(1/15,true);lastFrame=start;const simulated=performance.now();if(schedule.value==='fixed')lab.detail.advance(1/15,lab,lab.detailJet);const detailed=performance.now();draw.render({dt:1/15,adaptive:false,focusDistance:camera.position.distanceTo(controls.target)});gl.finish();
    if(i>=15){frames.push(performance.now()-start);for(const [k,v] of Object.entries({...lab.prepareTimes,...lab.sand.stepTimes,...lab.sand.parcelTimes,sand:lab.sandStepMs,step:simulated-start,detail:detailed-simulated,draw:performance.now()-detailed})){cpu[k]=(cpu[k]||0)+v/measured;}neighbor.push(lab.gpu.neighborMs);read.push(lab.optimizations.gpuBatch?lab.stepReadback?.waitMs||0:0);}
    if(options.longRun&&i>=15&&(i-15)%30===0)samples.push({frame:i-15,time:lab.time,parcels:lab.sand.parcels.length,anchored:lab.sand.parcels.filter(p=>p.anchored).length,mergedWindDeposits:lab.sand.mergedWindDeposits||0,frameMs:frames.at(-1),sandMs:lab.sandStepMs,parts:{...lab.sand.parcelTimes}});
    results.textContent=`${workload.value} / ${schedule.value} / ${select.selectedOptions[0].textContent}: ${i+1}/${total} frames (15 warm-up); ${lab.sand.parcels.length} sand parcels, ${lab.sandStepMs.toFixed(1)} ms sand.`;
   }
   const sorted=frames.slice().sort((a,b)=>a-b),wall=(performance.now()-started)/1000;
   results.textContent=JSON.stringify({fixture:workload.value,scheduling:schedule.value,adapter,mode:select.value,optimizationFlags:lab.optimizations,frames:measured,...(options.longRun?{samples}:{}),physicsSteps:lab.steps-stepStart,cpu,airGrid:!!lab.air.grid,bulk:lab.count,fine:lab.detail.count,sandParcels:lab.sand.parcels.length,mergedWindDeposits:lab.sand.mergedWindDeposits||0,resolution:[field.target.width,field.target.height],simulatedSeconds:lab.time-simStart,wallSeconds:wall,fps:measured/wall,realtime:(lab.time-simStart)/wall,medianWorkMs:sorted[Math.floor(measured*.5)],p95WorkMs:sorted[Math.floor(measured*.95)],maxWorkMs:sorted.at(-1),meanNeighborMs:neighbor.reduce((a,b)=>a+b,0)/measured,meanBatchReadMs:read.reduce((a,b)=>a+b,0)/measured,sandBinRebuilds:(lab.sandBinRebuilds||0)-geometryStart,gpu:draw.timers.ms,sandMassError:(lab.sand.totalMass()+lab.sand.removedMass-lab.sand.initialMass)/lab.sand.initialMass},null,2);
  }catch(e){results.textContent=e.stack;}finally{lab.resolutions.ocean=previous.quality;lab.scaleMultipliers.ocean=previous.scale;lab.paused=true;lab.qaRunning=false;draw.adaptiveResolution=previous.adaptive;draw.loadScale=previous.load;draw.fixedLoadScale=previous.fixed;button.disabled=false;document.getElementById('pause').textContent='Resume';}
 };
 const soak=document.createElement('button');soak.textContent='Run 40 s wind accumulation check';panel.append(soak);soak.onclick=()=>{if(lab.qaRunning)return;schedule.value='fixed';workload.value='standard';return button.onclick({longRun:true});};
 const suite=document.createElement('button');suite.textContent='Run repeated performance suite';panel.append(suite);
 suite.onclick=async()=>{if(lab.qaRunning)return;suite.disabled=true;const reports=[];try{
  for(const scene of ['standard','large','busy'])for(const mode of ['baseline','all','all','baseline']){workload.value=scene;select.value=mode;await button.onclick();let report;try{report=JSON.parse(results.textContent);}catch{throw new Error(results.textContent);}if(!report.fps)throw new Error(JSON.stringify(report));reports.push(report);results.textContent=JSON.stringify({completed:reports.length,total:12,reports},null,2);await new Promise(requestAnimationFrame);}
  const average=mode=>{const group=reports.filter(r=>r.mode===mode),sum=key=>group.reduce((s,r)=>s+r[key],0);return {meanFPS:sum('fps')/group.length,meanRealtime:sum('realtime')/group.length,pooledFPS:sum('frames')/sum('wallSeconds'),pooledRealtime:sum('simulatedSeconds')/sum('wallSeconds')};};
  const before=average('baseline'),after=average('all');results.textContent=JSON.stringify({before,after,gainFPS:after.meanFPS/before.meanFPS,gainRealtime:after.meanRealtime/before.meanRealtime,reports},null,2);
 }catch(e){results.textContent=JSON.stringify({error:e.message,reports},null,2);}finally{suite.disabled=false;select.value='all';apply('all');}};

}
