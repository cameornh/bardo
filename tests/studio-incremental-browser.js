import {FramePacer} from '../src/rtx-sand-lab/frame-pacing.js';
const $=id=>document.getElementById(id),pacer=new FramePacer(60),tell=t=>$('status').textContent=t;
const frame=()=>new Promise(resolve=>{function tick(t){if(pacer.shouldRender(t))resolve(t);else requestAnimationFrame(tick);}requestAnimationFrame(tick);});
const stats=a=>{const b=a.slice().sort((x,y)=>x-y);return {mean:a.reduce((s,x)=>s+x,0)/a.length,p95:b[Math.floor((b.length-1)*.95)]};};
let stopped=false,started,view,baker,scene,results=[];
$('stop').onclick=()=>{stopped=true;};
function healthy(){if(stopped)throw Error('Stopped by user');if(performance.now()-started>180000)throw Error('Three-minute check limit');if(view?.failed)throw Error('Studio graphics stopped');}
function exact(a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Surface differs from reference');}
function pixels(){const gl=view.renderer.getContext(),p=new Uint8Array(960*540*4);gl.readPixels(0,0,960,540,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;}
async function edits(){
 const useGPU=new URLSearchParams(location.search).get('gpu')==='1';
 const [{StudioView},{Baker},{seedLibrary},{bakeFast},{FrameCompletion},{prepareShaderJobs},{sculptFixture,editStamp,sculptSpacing}]=await Promise.all([
  import('../src/asset-studio/view.js'),import('../src/asset-studio/baker.js'),import('../src/asset-studio/model.js'),import('../src/asset-studio/sculpt-fast.js'),import('../src/rtx-sand-lab/frame-completion.js'),import('../src/rtx-sand-lab/shader-startup.js'),import('./studio-incremental-fixture.js')]);
 view=new StudioView($('view'),()=>{},()=>{},{preserveDrawingBuffer:true});view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(960,540,false);view.camera.aspect=960/540;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(960,540);view.controls.enableDamping=false;view.focus('asset');
 const library=seedLibrary(),asset=library.assets[0],part=asset.parts[0],key=asset.id+':'+part.id;asset.parts=[part];asset.spacing=sculptSpacing;
 baker=new Baker(tell,{incremental:true});if(useGPU){await baker.init();if(!baker.gpu)throw Error('GPU comparison unavailable: '+baker.validation?.reason);}const completion=new FrameCompletion(view.renderer),images=[];
 for(let block=0;block<8;block++){
  healthy();const optimized=[false,true,true,false][block%4];tell(`Studio editing: ${optimized?'incremental':'full rebuild'}, block ${block+1}/8`);
  part.stamps=sculptFixture();const initial=await baker.bake(part.stamps,sculptSpacing,useGPU,true,{key,incremental:optimized,gpuIncremental:true});view.setSurface(key,initial,library.materials);view.rebuild(library,'asset',asset.id);
  if(!block)await prepareShaderJobs(view.renderer,[{name:'studio-ground',scene:view.scene,camera:view.camera,target:null},{name:'studio-surfaces',scene:view.assetScene,camera:view.camera,target:null}],{timeoutMs:15000,before:async t=>{tell(t);await frame();}});
  tell(`Studio ${useGPU?'GPU':'CPU'} editing: ${optimized?'incremental':'full rebuild'}, block ${block+1}/8`);
  for(let i=0;i<4;i++){await frame();await completion.run(()=>view.draw());}
  const start=performance.now(),rows=[],jobs=[];let previous=start,next=0,pending=null,ready=null,jobError=null,lastSurface=initial;
  // Match live authoring: worker rebuilds while presentation continues; physics
  // is paused. Never queue more than one bake or one graphics frame at a time.
  while(performance.now()-start<4000||next<8||pending||ready){
   healthy();if(jobError)throw jobError;
   if(ready){const upload=performance.now();view.setSurface(key,ready.surface,library.materials);jobs.push({...ready.row,uploadMs:performance.now()-upload});lastSurface=ready.surface;ready=null;}
   if(!pending&&next<8&&performance.now()-start>=next*350){
    const edit=24+next++,begin=performance.now();part.stamps.push(editStamp(edit));pending=baker.bake(part.stamps,sculptSpacing,useGPU,true,{key,incremental:optimized,gpuIncremental:true}).then(surface=>{ready={surface,row:{edit,latencyMs:performance.now()-begin,stats:baker.lastStats}};},e=>{jobError=e;}).finally(()=>{pending=null;});
   }
   await frame();const now=performance.now();await completion.run(()=>view.draw());rows.push({intervalMs:now-previous});previous=now;
  }
  const wall=(performance.now()-start)/1000;exact(lastSurface,useGPU?await baker.bake(part.stamps,sculptSpacing,true,true,{key:'oracle',incremental:false}):bakeFast(part.stamps,sculptSpacing));if(useGPU&&!baker.gpu)throw Error('GPU comparison fell back; excluded');const image=pixels();if(!image.some((v,i)=>i%4!==3&&v>0))throw Error('Empty studio image');
  images.push(image);if(block){let max=0;for(let i=0;i<image.length;i++)max=Math.max(max,Math.abs(image[i]-images[0][i]));if(max)throw Error('Frozen image differs by '+max);images.pop();}
  results.push({block,optimized,frames:rows.length,wallSeconds:wall,fps:rows.length/wall,realtime:0,frame:stats(rows.map(r=>r.intervalMs)),latency:stats(jobs.map(j=>j.latencyMs)),jobs,rows});$('result').textContent=JSON.stringify({phase:'running',results});
 }
 const aggregate=optimized=>{const r=results.filter(x=>x.optimized===optimized),wall=r.reduce((s,x)=>s+x.wallSeconds,0);return {fps:r.reduce((s,x)=>s+x.frames,0)/wall,realtime:0,frame:stats(r.flatMap(x=>x.rows.map(y=>y.intervalMs))),editLatency:stats(r.flatMap(x=>x.jobs.map(j=>j.latencyMs))),upload:stats(r.flatMap(x=>x.jobs.map(j=>j.uploadMs)))};};
 return {pass:true,check:'Studio editing',reference:aggregate(false),incremental:aggregate(true),frozenImageMaximumByteDifference:0,contextLost:view.renderer.getContext().isContextLost(),metadata:{output:[960,540],initialStamps:25,editsPerBlock:8,blocks:8,physics:'Paused, matching live authoring',sculpt:useGPU?'Full GPU sampling + CPU extraction: full versus cached blocks':'CPU worker, full fast reference versus incremental',render:'Unchanged covariance Gaussian / SH',spacing:sculptSpacing,savedData:'Untouched'},results};
}
async function gpu(){
 const [{SculptGPU},{gridSpec},{extractSurface},{IncrementalSculpt},{sculptFixture,editStamp,sculptSpacing}]=await Promise.all([import('../src/asset-studio/gpu-sculpt.js'),import('../src/asset-studio/sculpt.js'),import('../src/asset-studio/sculpt.js'),import('../src/asset-studio/sculpt-incremental.js'),import('./studio-incremental-fixture.js')]);
 const sampler=new SculptGPU();try{tell('Checking existing bounded GPU sculpt sampler');await sampler.init();const validation=await sampler.validate(),cache=new IncrementalSculpt(),stamps=sculptFixture();
  for(let i=0;i<4;i++){healthy();if(i)stamps.push(editStamp(23+i));const grid=gridSpec(stamps,sculptSpacing),values=await sampler.sample(stamps,grid),got=cache.update(stamps,sculptSpacing,{grid,values});exact(got.surface,extractSurface(values,grid,stamps));results.push({step:i,stats:got.stats});}
  return {pass:true,check:'Real GPU grids / exact incremental CPU extraction',validation,results};
 }finally{sampler.dispose();}
}
async function control(name){
 scene=await (name==='beach'?(await import('./scene-performance-beach.js')).beachScene:(await import('./scene-performance-studio.js')).studioScene)($('view'),tell);
 // Both sides run the same current production path. No previous experimental
 // contact or rendering toggles are enabled by these regression controls.
 for(let block=0;block<4;block++){
  healthy();tell(name+' unchanged control '+(block+1)+'/4');await scene.reset(name==='studio');let previous=performance.now();
  for(let i=0;i<8;i++){await frame();const now=performance.now();await scene.frame((now-previous)/1000);previous=now;}
  const start=performance.now(),sim=scene.time,rows=[];previous=start;
  for(let i=0;i<(name==='studio'?120:24);i++){healthy();await frame();const now=performance.now(),dt=(now-previous)/1000;previous=now;const row=await scene.frame(dt);rows.push({...row,intervalMs:dt*1000});}
  const wall=(performance.now()-start)/1000;results.push({block,frames:rows.length,wallSeconds:wall,fps:rows.length/wall,realtime:(scene.time-sim)/wall,frame:stats(rows.map(r=>r.intervalMs)),rows});$('result').textContent=JSON.stringify({phase:'running',results});
 }
 scene.pause();const image=await scene.pixels();if(!image.some((v,i)=>i%4!==3&&v>0))throw Error('Empty control image');
 const wall=results.reduce((s,r)=>s+r.wallSeconds,0);return {pass:true,check:name+' unchanged regression control',metadata:scene.metadata,fps:results.reduce((s,r)=>s+r.frames,0)/wall,realtime:results.reduce((s,r)=>s+r.realtime*r.wallSeconds,0)/wall,contextLost:scene.renderer.getContext().isContextLost(),results};
}
async function run(kind){for(const id of ['edits','gpu','studio','beach'])$(id).disabled=true;started=performance.now();let report;
 try{report=await(kind==='edits'?edits():kind==='gpu'?gpu():control(kind));tell('Complete. No further graphics work.');}
 catch(e){report={pass:false,check:kind,stage:$('status').textContent,error:e.stack,results};tell('Stopped. No retry or further frames.');}
 finally{scene?.pause();baker?.dispose();$('result').textContent=JSON.stringify(report,null,2);$('summary').textContent=JSON.stringify({...report,results:undefined},null,2);}
}
for(const id of ['edits','gpu','studio','beach'])$(id).onclick=()=>run(id);
