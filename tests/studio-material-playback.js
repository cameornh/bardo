import {heat,activeMass,enthalpyAt} from '../src/asset-studio/material-reactions.js';
import {StudioView} from '../src/asset-studio/view.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {studioTests} from '../src/asset-studio/workbenches.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const status=document.querySelector('pre'),canvas=document.querySelector('canvas'),select=document.querySelector('select');
const controls=document.querySelectorAll('button,select');
const frame=()=>new Promise(requestAnimationFrame);
async function run(still,compareIce=false){
 if(compareIce)select.value='thaw';
 const fixture=studioTests.find(f=>f.id===select.value),library=fixture.create();
 let sim,view;
 try{
  for(const control of controls)control.disabled=true;
  status.textContent='Preparing '+fixture.name+'…';
  view=new StudioView(canvas,()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(640,360,false);
  view.camera.aspect=640/360;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(640,360);
  for(const asset of library.assets.filter(a=>library.world.instances.some(i=>i.assetId===a.id))){
   for(const p of asset.parts)view.setSurface(asset.id+':'+p.id,bakeFast(p.stamps,asset.spacing),library.materials,p.stamps);
  }
  view.rebuild(library,'world');view.frameWorld(library,fixture.framing);
  sim=await StudioPhysics.create(library,'world');fixture.start?.(sim);
  const fence=new FrameCompletion(view.renderer);
  for(let i=0;i<(still?240:120);i++)sim.step();
  const draw=async()=>{view.applyPhysics(sim);await fence.run(()=>view.draw());};
  if(compareIce){
   const lens=view.groups.get('ice'),record=sim.get('ice','body'),gl=view.renderer.getContext();
   const read=async()=>{await draw();const data=new Uint8Array(640*360*4);gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
   const difference=(a,b)=>{
    let pixels=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>8)pixels++;
    return pixels;
   };
   lens.visible=false;const floor=await read();lens.visible=true;
   const clear=await read();
   // Supply the same heat required for fusion, then remove it over two seconds.
   for(const site of record.field.sites)for(const s of [site,site.core].filter(Boolean)){
    const target=enthalpyAt(s.material,s.material.meltingPoint,true);
    heat(s,(target-s.h)*activeMass(s));
    for(let i=0;i<20;i++)heat(s,-s.material.latentHeat*activeMass(s)/20,.1);
   }
   const cloudy=await read(),clearLensPixels=difference(clear,floor),changedOnFreezing=difference(clear,cloudy);
   status.textContent=JSON.stringify({clearLensPixels,changedOnFreezing,pass:clearLensPixels>40&&changedOnFreezing>40&&!gl.isContextLost()},null,2);
   return;
  }
  if(still){await draw();status.textContent=fixture.name+' · 2.00 s\n'+(fixture.readout?.(sim)??'');return;}
  let last=performance.now(),begin,simulationBegin,physicsMs=0;
  for(let i=0;i<60;i++){
   await frame();const now=performance.now();
   if(i===12){begin=last;simulationBegin=sim.time;physicsMs=0;}
   sim.advance(Math.min(.1,(now-last)/1000));physicsMs+=performance.now()-now;
   last=now;await draw();
  }
  const seconds=(performance.now()-begin)/1000;
  status.textContent=JSON.stringify({test:fixture.id,frames:48,fps:48/seconds,
   realtime:(sim.time-simulationBegin)/seconds,physicsMsPerFrame:physicsMs/48,
   contextLost:view.renderer.getContext().isContextLost()},null,2);
 }catch(error){status.textContent='Stopped. '+error.message;}
 finally{sim?.dispose();view?.dispose();for(const control of controls)control.disabled=false;}
}
document.querySelector('#play').onclick=()=>run(false);
document.querySelector('#still').onclick=()=>run(true);
document.querySelector('#clarity').onclick=()=>run(true,true);
