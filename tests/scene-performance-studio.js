import {installEarlyReject} from '../src/asset-studio/research/early-reject.js';
import {StudioView} from '../src/asset-studio/view.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {seedLibrary,transform} from '../src/asset-studio/model.js';
import {bakeCPU} from '../src/asset-studio/sculpt.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';
import {prepareShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
export async function studioScene(canvas,status){
 const view=new StudioView(canvas,()=>{},()=>{},{preserveDrawingBuffer:true}),library=seedLibrary();view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(960,540,false);view.camera.aspect=960/540;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(960,540);
 // 24 placements / 32 parts is the existing rigid preview limit, not an enlarged simulation budget.
 library.world.instances=Array.from({length:24},(_,i)=>({id:'instance-'+i,assetId:library.assets[i%3].id,transform:{...transform(),position:[(i%6-2.5)*3.1,.2+Math.floor(i/6)*.1,(Math.floor(i/6)-1.5)*3.1]}}));
 const params=new URLSearchParams(location.search),hover=params.get('hover')!=='0',renderTrial=params.get('variant')==='render',bakeRows=[];installEarlyReject(view);
 for(const a of library.assets)for(const p of a.parts){
  status('Building studio surface: '+p.name);await new Promise(requestAnimationFrame);let surface;
  for(const optimized of [false,true,true,false]){const start=performance.now();surface=(optimized?bakeFast:bakeCPU)(p.stamps,a.spacing);bakeRows.push({part:p.name,optimized,ms:performance.now()-start,count:surface.positions.length/3});}
  view.setSurface(a.id+':'+p.id,surface,library.materials);
 }
 view.rebuild(library,'world','starter');view.controls.target.set(0,1,0);view.camera.position.set(13,10,16);view.controls.update();view.scene.updateMatrixWorld(true);view.assetScene.updateMatrixWorld(true);
 const completion=new FrameCompletion(view.renderer);let physics,index=0,optimized=false;const rect=canvas.getBoundingClientRect(),picks=[];
 const event=i=>({clientX:rect.left+rect.width*(.15+.7*((i*37)%101)/100),clientY:rect.top+rect.height*(.28+.5*((i*17)%101)/100)});
 for(let i=0;i<120;i++){const a=view.pick(event(i),{optimized:false}),b=view.pick(event(i),{optimized:true});const key=h=>h?[h.assetId,h.partId,h.instanceId,h.ground,h.point.toArray(),h.normal.toArray(),h.distance]:null;if(JSON.stringify(key(a))!==JSON.stringify(key(b)))throw Error('Studio picking parity failed at '+i);}
 status('Compiling studio programs');await prepareShaderJobs(view.renderer,[{name:'studio-ground',scene:view.scene,camera:view.camera,target:null},{name:'studio-surfaces',scene:view.assetScene,camera:view.camera,target:null}],{timeoutMs:15000,before:async text=>{status(text);await new Promise(requestAnimationFrame);}});
 async function reset(value){physics?.dispose();optimized=value;view.uniforms.earlyReject.value=value&&renderTrial;index=0;physics=await StudioPhysics.create(library,'world','starter');view.applyPhysics(physics);}
 await reset(false);
 return {name:'studio',renderer:view.renderer,frames:120,metadata:{placements:24,parts:32,output:[960,540],backend:'WebGL Gaussian / SH rendering; CPU Rapier 120 Hz; optional cursor-pick stress workload',hover,renderTrial,bakeRows,pickParity:120},reset,
 get time(){return physics.time;},
 async frame(dt){const start=performance.now();physics.advance(dt);view.applyPhysics(physics);const begin=performance.now(),hit=hover?view.pick(event(index++),{optimized}):null;const pickMs=performance.now()-begin;view.showBrush(hit,.22);await completion.run(()=>view.draw());return {workMs:performance.now()-start,pickMs,physicsMs:physics.lastStepMs,steps:physics.steps};},
 pause(){},async pixels(){const r=view.renderer,gl=r.getContext(),data=new Uint8Array(960*540*4);gl.readPixels(0,0,960,540,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;},
 async frozenParity(){
  view.showBrush(null);const saved=view.camera.position.clone(),differences=[],gl=view.renderer.getContext();
  for(const position of [[13,10,16],[3,1.8,4],[-8,2,-8]]){
   view.camera.position.set(...position);view.controls.update();view.uniforms.earlyReject.value=false;await completion.run(()=>view.draw());
   const a=new Uint8Array(960*540*4);gl.readPixels(0,0,960,540,gl.RGBA,gl.UNSIGNED_BYTE,a);view.uniforms.earlyReject.value=true;await completion.run(()=>view.draw());
   const b=new Uint8Array(a.length);gl.readPixels(0,0,960,540,gl.RGBA,gl.UNSIGNED_BYTE,b);let max=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d;}differences.push({position,maximumByteDifference:max,meanByteDifference:sum/a.length});
  }
  view.camera.position.copy(saved);view.controls.update();await completion.run(()=>view.draw());return differences;
 },
 dispose(){physics?.dispose();view.dispose();}
 };
}
