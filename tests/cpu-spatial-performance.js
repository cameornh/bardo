import {FramePacer} from '../src/rtx-sand-lab/frame-pacing.js';
const pacer=new FramePacer(60);
const status=document.querySelector('#status'),output=document.querySelector('#result'),summary=document.querySelector('#summary');let stopped=false,scene;
const frame=()=>new Promise(resolve=>{function tick(t){if(pacer.shouldRender(t))resolve(t);else requestAnimationFrame(tick);}requestAnimationFrame(tick);}),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const stats=a=>{const sorted=a.slice().sort((a,b)=>a-b),average=mean(a);return {mean:average,p95:sorted[Math.floor((sorted.length-1)*.95)],p99:sorted[Math.floor((sorted.length-1)*.99)],stddev:Math.sqrt(mean(a.map(x=>(x-average)**2)))};};
document.querySelector('#stop').onclick=()=>{stopped=true;status.textContent='Stopping after the current bounded frame.';};
async function run(name){
 for(const id of ['beach','studio'])document.getElementById(id).disabled=true;stopped=false;const results=[];let stage='creating '+name;
 const tell=text=>{stage=text;status.textContent=text;};
 try{
  scene?.dispose();scene=null;document.querySelector('#view').replaceWith(Object.assign(document.createElement('canvas'),{id:'view'}));
  scene=await (name==='beach'?(await import('./cpu-spatial-beach.js')).beachScene:(await import('./cpu-spatial-studio.js')).studioScene)(document.querySelector('#view'),tell);
  const totalStart=performance.now();const cycles=Math.min(2,Math.max(1,Number(new URLSearchParams(location.search).get('cycles')||2)));
  for(let block=0;block<cycles*4;block++){
   const optimized=[false,true,true,false][block%4];tell(`${name}: ${optimized?'optimized':'reference'}, block ${block+1}/${cycles*4}`);await scene.reset(optimized);
   let previous=performance.now();for(let i=0;i<8;i++){await frame();const now=performance.now();await scene.frame((now-previous)/1000);previous=now;}
   const rows=[],start=performance.now(),sim=scene.time;previous=start;
   for(let i=0;i<scene.frames;i++){
    if(stopped)throw Error('Stopped by user');if(performance.now()-totalStart>180000)throw Error('Comparison exceeded three-minute budget');
    await frame();const now=performance.now(),dt=(now-previous)/1000;previous=now;const row=await scene.frame(dt);row.intervalMs=dt*1000;rows.push(row);
    if(row.workMs>2000)throw Error('Frame exceeded two-second budget');
   }
   const wall=(performance.now()-start)/1000,simulated=scene.time-sim;
   results.push({block,optimized,frames:rows.length,wallSeconds:wall,simulatedSeconds:simulated,fps:rows.length/wall,realtime:simulated/wall,frame:stats(rows.map(x=>x.intervalMs)),rows});output.textContent=JSON.stringify({phase:'running',name,results});
  }
  scene.pause();const pixels=await scene.pixels();let lit=0;for(let i=0;i<pixels.length;i+=4){if(!Number.isFinite(pixels[i]))throw Error('Non-finite rendering');lit+=pixels[i]+pixels[i+1]+pixels[i+2];}if(!lit)throw Error('Empty rendering');
  const aggregate=optimized=>{const r=results.filter(x=>x.optimized===optimized),wall=r.reduce((s,x)=>s+x.wallSeconds,0);return {fps:r.reduce((s,x)=>s+x.frames,0)/wall,realtime:r.reduce((s,x)=>s+x.simulatedSeconds,0)/wall,frame:stats(r.flatMap(x=>x.rows.map(y=>y.intervalMs)))};};
  const reference=aggregate(false),optimized=aggregate(true),image=scene.frozenParity?await scene.frozenParity():{note:'Unchanged renderer; full CPU state is checked independently.'};
  if(Array.isArray(image)&&image.some(x=>x.maximumByteDifference!==0))throw Error('Frozen image mismatch: '+JSON.stringify(image));
  const report={pass:true,name,metadata:scene.metadata,reference,optimized,fpsChangePercent:(optimized.fps/reference.fps-1)*100,simulationChangePercent:(optimized.realtime/reference.realtime-1)*100,image,contextLost:scene.renderer.getContext().isContextLost(),results};
  output.textContent=JSON.stringify(report,null,2);summary.textContent=JSON.stringify({...report,results:undefined,metadata:{...report.metadata,bakeRows:undefined}},null,2);tell('Complete. Scene paused; no further frames are running.');
 }catch(e){scene?.pause();const report={pass:false,name,stage,error:e.stack,contextLost:scene?.renderer?.getContext().isContextLost()??null,results};output.textContent=JSON.stringify(report,null,2);summary.textContent=e.message;tell('Stopped. No further frames will run.');}
 finally{document.getElementById('reload').hidden=false;document.getElementById('reload').href=location.href;}
}
document.querySelector('#beach').onclick=()=>run('beach');document.querySelector('#studio').onclick=()=>run('studio');
