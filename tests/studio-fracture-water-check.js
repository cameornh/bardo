import {StudioView} from '../src/asset-studio/view.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {seedLibrary,stamp,transform} from '../src/asset-studio/model.js';
import {studioTests} from '../src/asset-studio/workbenches.js';
import {planarSurface} from '../src/asset-studio/surface-support.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const buttons=[...document.querySelectorAll('button')],status=document.querySelector('pre');
for(const button of buttons)button.onclick=async()=>{
 const water=button.id==='water',width=640,height=360;
 let view,sim;
 try{
  buttons.forEach(b=>b.disabled=true);status.textContent='Running bounded check…';
  const l=water?studioTests.find(t=>t.id==='water').create():seedLibrary(),asset=l.assets[0],part=asset.parts[0];
  if(water)l.world.wind={speed:60,heading:25,turbulence:1};
  else{
   Object.assign(l.materials.find(m=>m.id==='wood'),{cohesion:50,tensileStrength:800});
   part.stamps=[stamp('box','add',[0,0,0],[.79,.44,.57],'wood',0)];
   l.world.instances=[{id:'block',assetId:asset.id,transform:{...transform(),position:[0,1.25,0],rotation:[8,15,24]}}];
   l.world.groundMaterialId='stone';
  }
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(width,height,false);
  view.camera.aspect=width/height;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(width,height);
  for(const a of l.assets)for(const p of a.parts)view.setSurface(a.id+':'+p.id,planarSurface(p.stamps,a.spacing)??bakeFast(p.stamps,a.spacing),l.materials);
  sim=await StudioPhysics.create(l,'world',asset.id);view.rebuild(l,'world',asset.id);view.sea=sim.sea;
  view.camera.position.set(...(water?[3,3.8,7]:[2.8,1.95,3.05]));view.controls.target.set(0,water?0:.22,0);view.controls.update();
  const fence=new FrameCompletion(view.renderer),gl=view.renderer.getContext();
  view.renderer.debug.onShaderError=(g,program,vs,fs)=>{throw Error(g.getProgramInfoLog(program)||g.getShaderInfoLog(fs)||g.getShaderInfoLog(vs)||'Shader failed');};
  for(let i=0;i<(water?480:180);i+=6){for(let j=0;j<6;j++)sim.step();await new Promise(requestAnimationFrame);}
  view.applyPhysics(sim);
  const draw=()=>fence.run(()=>view.draw());
  await draw();
  let results;
  if(water){
   const world=sim.materialWorld,wet=[...world.tiles.values()].filter(t=>t.material===sim.groundMaterial&&t.finish>.015);
   const pixels=()=>{const p=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
   const changed=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])))>2)n++;return n;};
   const clean=pixels(),oldMaterial=wet.map(t=>t.material),oldFinish=wet.map(t=>t.finish);
   for(const t of wet)t.finish=0;world.version++;await draw();const clear=pixels();
   // Recreate the previous finish pass on the same sampled contact sites and camera.
   for(const [i,t] of wet.entries()){t.finish=oldFinish[i];t.material=l.materials.find(m=>m.id==='stone');}
   world.version++;await draw();const old=pixels();
   for(const [i,t] of wet.entries())t.material=oldMaterial[i];world.version++;await draw();
   results={wetOceanTiles:wet.length,previousMarkPixels:changed(old,clear),currentMarkPixels:changed(clean,clear)};
   results.pass=results.previousMarkPixels>0&&results.currentMarkPixels===0;
  }else{
   const s=sim.structures[0],pieces=s.grid.voronoi.parts.flat();
   const faces=pieces.flatMap(p=>p.faces??[]).filter(f=>f.neighbor!=null);
   results={pieces:s.bodies.size,obliqueFaces:faces.filter(f=>Math.max(...f.normal.toArray().map(Math.abs))<.98).length};
   results.pass=results.pieces>5&&results.obliqueFaces>0;
  }
  results.contextLost=gl.isContextLost();results.pass&&=!results.contextLost&&gl.getError()===gl.NO_ERROR;
  status.textContent=JSON.stringify(results,null,2);
 }catch(e){status.textContent='Stopped: '+e.stack;}finally{sim?.dispose();view?.dispose();buttons.forEach(b=>b.disabled=false);}
};
