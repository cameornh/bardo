import {Vector3} from 'three';
import {StudioView} from '../src/asset-studio/view.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {seedLibrary} from '../src/asset-studio/model.js';
import {liftGround,moveChunk,releaseChunk,strikeGround} from '../src/asset-studio/ground-interaction.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const status=document.querySelector('pre'),button=document.querySelector('button');
button.onclick=async()=>{
 let view,sim;
 structure.disabled=button.disabled=true;
 try{
  const l=seedLibrary();l.world.wind={speed:0,heading:0};
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(640,360,false);
  view.camera.aspect=640/360;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(640,360);
  for(const a of l.assets)for(const p of a.parts)view.setSurface(a.id+':'+p.id,bakeFast(p.stamps,.11),l.materials);
  view.rebuild(l,'world','starter');view.camera.position.set(3.5,2.8,5);view.controls.target.set(0,.1,0);view.controls.update();
  sim=await StudioPhysics.create(l,'world','starter');view.sand=sim.sand;
  const fence=new FrameCompletion(view.renderer),rows=[];
  let lifted=0,strikes=0;
  for(const stage of ['warm','before','editing','settled']){
   status.textContent=stage;
   const frames=stage==='warm'?8:stage==='editing'?96:48;
   let prev=performance.now(),start=prev,simStart=sim.time,physicsMs=0;
   for(let f=0;f<frames;f++){
    await new Promise(requestAnimationFrame);
    const now=performance.now(),dt=Math.min(.1,(now-prev)/1000);prev=now;
    if(stage==='editing'){
     const step=f>>2,point=new Vector3(((step%8)-3.5)*.375,0,(Math.floor(step/8)-1)*.375+1);
     if(f%4===0){if(liftGround(sim,point))lifted++;moveChunk(sim,point.add(new Vector3(.35,.8,.35)));}
     if(f%4===2){releaseChunk(sim);if(strikeGround(sim,point,4500))strikes++;}
    }
    const t=performance.now();sim.advance(dt);physicsMs+=performance.now()-t;
    view.applyPhysics(sim);await fence.run(()=>view.draw());
   }
   const wall=(performance.now()-start)/1000;
   rows.push({stage,fps:+(frames/wall).toFixed(2),realtime:+((sim.time-simStart)/wall).toFixed(3),physicsMsPerFrame:+(physicsMs/frames).toFixed(2),airborne:sim.matter.count});
  }
  status.textContent=JSON.stringify({rows,lifted,strikes,contextLost:view.renderer.getContext().isContextLost()},null,2);
 }catch(e){status.textContent='Stopped: '+e.stack;}finally{sim?.dispose();view?.dispose();structure.disabled=button.disabled=false;}
};

const structure=document.querySelector('#structure');
structure.onclick=async()=>{
 structure.disabled=button.disabled=true;
 try{const {showStructures}=await import('./studio-structure-preview.js');await showStructures(document.querySelector('canvas'),status);}
 catch(e){status.textContent='Stopped: '+e.stack;}finally{structure.disabled=button.disabled=false;}
};
