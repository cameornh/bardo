import {StudioView} from '../src/asset-studio/view.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {part,asset,stamp,transform} from '../src/asset-studio/model.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';
import {fractureFixture} from './studio-fracture-fixture.js';

const button=document.querySelector('button'),status=document.querySelector('pre');
button.onclick=async()=>{
 let sim,view;button.disabled=true;
 try{
  const l=fractureFixture(),front=l.assets[0],rear=structuredClone(front);
  const strong={...l.materials.find(m=>m.id==='inlay'),id:'bonded',adhesion:8e7};
  l.materials.push(strong);rear.id='strong-sculpt';
  for(const stamp of rear.parts[0].stamps)if(stamp.materialId==='inlay')stamp.materialId=strong.id;
  l.assets=[front,rear];l.world.instances[0].transform.position=[0,1.85,.95];
  l.world.instances.push({id:'strong',assetId:rear.id,transform:{...transform(),position:[0,2.05,-1.5]}});
  // Make the mounting points visible. The fixed pivots support the sculpts.
  const stands=asset('Supports');
  stands.parts=[part('Front support',[stamp('box','add',[0,.86,.95],[.17,.86,.22],'stone',0)]),
   part('Rear support',[stamp('box','add',[0,.96,-1.5],[.17,.96,.22],'stone',0)])];
  for(const p of stands.parts)p.physics={fixed:true};
  l.assets.push(stands);l.world.instances.push({id:'mounts',assetId:stands.id,transform:transform()});
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(700,400,false);
  view.camera.aspect=700/400;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(700,400);
  for(const a of l.assets)for(const p of a.parts)view.setSurface(a.id+':'+p.id,bakeFast(p.stamps,.052),l.materials);
  view.rebuild(l,'world',front.id);
  view.camera.position.set(3.5,3.1,6.4);view.controls.target.set(0,1.25,-.1);view.controls.update();
  sim=await StudioPhysics.create(l,'world',front.id);
  const fence=new FrameCompletion(view.renderer);
  for(let i=0;i<=20;i++){
   if(i)for(let s=0;s<3;s++)sim.step();
   view.applyPhysics(sim);await fence.run(()=>view.draw());await new Promise(requestAnimationFrame);
  }
  const [a,b]=sim.structures;
  if(a.bodies.size!==3||b.bodies.size!==1||view.sectionView.meshes.get(a)?.pieces.size!==3)throw Error('Unexpected physical or visible fragment count');
  status.textContent=JSON.stringify({weakSeamPieces:a.bodies.size,strongSeamPieces:b.bodies.size,
   separatedAtMeters:a.grid.bonds.filter(e=>e.broken).map(e=>+e.center[0].toFixed(2)),steps:sim.steps,contextLost:view.renderer.getContext().isContextLost()},null,2);
 }catch(e){status.textContent='Stopped: '+e.stack;}finally{sim?.dispose();view?.dispose();button.disabled=false;}
};
