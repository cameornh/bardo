// Development-only controls, exposed by ?qa=1. Reference modes retain the
// original algorithms; all modes advance exactly the same number of steps.
export function installPerformanceQA({lab,draw,field,renderer,camera,controls,reset,results,panel}){
 const defaults={...lab.optimizations},select=document.createElement('select');select.setAttribute('aria-label','Performance comparison mode');
 for(const [value,label] of [['all','All optimizations'],['reference','Reference paths'],...Object.keys(defaults).map(k=>[k,`All except ${k}`])]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}panel.append(select);
 function apply(mode){for(const k of Object.keys(defaults))lab.optimizations[k]=mode==='reference'?false:mode===k?false:defaults[k];lab.gpu.neighborOrigin=null;lab.sandRevision=-1;draw.densityRevision=-1;draw.drawKey=null;draw.detailRenderer.pathsKey=null;draw.mediumShadows.key=null;draw.mediumShadows.tiles.key=null;lab.revision++;}
 select.onchange=()=>apply(select.value);
 const imageCheck=document.createElement('button');imageCheck.textContent='Compare optimized rendering';panel.append(imageCheck);
 imageCheck.onclick=async()=>{
  if(lab.qaRunning)return;lab.qaRunning=true;const saved={...lab.optimizations},oldAdaptive=draw.adaptiveResolution,oldFixed=draw.fixedLoadScale;lab.paused=true;
  try{
   draw.adaptiveResolution=false;draw.fixedLoadScale=.5;camera.updateMatrixWorld();
   const images=[];
   for(const mode of ['reference','all']){apply(mode);draw.render({dt:1/15,adaptive:false,focusDistance:camera.position.distanceTo(controls.target)});const t=field.target,data=new Float32Array(t.width*t.height*4),depth=new Float32Array(data.length);renderer.readRenderTargetPixels(t,0,0,t.width,t.height,data);renderer.readRenderTargetPixels(draw.water,0,0,t.width,t.height,depth);images.push({data,depth});await new Promise(requestAnimationFrame);}
   let sum=0,max=0,missing=0,nonFinite=0,depthSum=0,hits=0;const n=images[0].data.length/4;
   for(let i=0;i<n;i++){for(let k=0;k<3;k++){const d=Math.abs(images[0].data[i*4+k]-images[1].data[i*4+k]);sum+=d;max=Math.max(max,d);if(!Number.isFinite(d))nonFinite++;}const a=images[0].depth[i*4+3],b=images[1].depth[i*4+3];if(a<999&&b>=999)missing++;if(a<999&&b<999){depthSum+=Math.abs(a-b);hits++;}}
   results.textContent=JSON.stringify({fixture:'fixed-state render comparison',resolution:[field.target.width,field.target.height],meanLinearColorError:sum/(n*3),maxLinearColorError:max,meanWaterDepthError:depthSum/Math.max(1,hits),missingWaterPixels:missing,totalPixels:n,nonFinite,pass:nonFinite===0&&sum/(n*3)<.015&&missing/n<.003},null,2);
  }catch(e){results.textContent=e.stack;}finally{Object.assign(lab.optimizations,saved);draw.drawKey=null;draw.densityRevision=-1;draw.mediumShadows.key=null;draw.detailRenderer.pathsKey=null;draw.adaptiveResolution=oldAdaptive;draw.fixedLoadScale=oldFixed;lab.qaRunning=false;document.getElementById('pause').textContent='Resume';}
 };
 const button=document.createElement('button');button.textContent='Benchmark matched beach';panel.append(button);
 button.onclick=async()=>{
  if(lab.qaRunning)return;lab.qaRunning=true;button.disabled=true;
  const previous={adaptive:draw.adaptiveResolution,load:draw.loadScale,fixed:draw.fixedLoadScale};
  try{
   reset();apply(select.value);lab.paused=false;lab.frameDrivenLens=true;lab.wetting.cameraEnabled=false;
   camera.position.set(4.8,4,4.4);controls.target.set(0,.65,0);camera.lookAt(controls.target);camera.updateMatrixWorld();
   draw.adaptiveResolution=false;draw.fixedLoadScale=.5;field.motion.factor=1;
   const frames=[],neighbor=[],read=[],geometryStart=lab.sandBinRebuilds||0;let started,simStart;
   const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),adapter=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
   for(let i=0;i<60;i++){
    await new Promise(requestAnimationFrame);if(i===15){started=performance.now();simStart=lab.time;}
    const start=performance.now();lab.step(1/30,true);lab.step(1/30,true);lab.detail.advance(1/15,lab,lab.detailJet);draw.render({dt:1/15,adaptive:false,focusDistance:camera.position.distanceTo(controls.target)});gl.finish();
    if(i>=15){frames.push(performance.now()-start);neighbor.push(lab.gpu.neighborMs);read.push(lab.optimizations.gpuBatch?lab.stepReadback?.waitMs||0:0);}
    results.textContent=`Matched beach ${select.selectedOptions[0].textContent}: ${i+1}/60 frames (15 warm-up).`;
   }
   const sorted=frames.slice().sort((a,b)=>a-b),wall=(performance.now()-started)/1000;
   results.textContent=JSON.stringify({fixture:'matched beach',adapter,mode:select.value,optimizationFlags:lab.optimizations,frames:45,physicsSteps:90,bulk:lab.count,fine:lab.detail.count,resolution:[field.target.width,field.target.height],simulatedSeconds:lab.time-simStart,wallSeconds:wall,realtime:(lab.time-simStart)/wall,medianWorkMs:sorted[22],p95WorkMs:sorted[42],maxWorkMs:sorted.at(-1),meanNeighborMs:neighbor.reduce((a,b)=>a+b,0)/45,meanBatchReadMs:read.reduce((a,b)=>a+b,0)/45,sandBinRebuilds:(lab.sandBinRebuilds||0)-geometryStart,gpu:draw.timers.ms,sandMassError:(lab.sand.totalMass()+lab.sand.removedMass-lab.sand.initialMass)/lab.sand.initialMass},null,2);
  }catch(e){results.textContent=e.stack;}finally{lab.paused=true;lab.qaRunning=false;draw.adaptiveResolution=previous.adaptive;draw.loadScale=previous.load;draw.fixedLoadScale=previous.fixed;button.disabled=false;document.getElementById('pause').textContent='Resume';}
 };
}
