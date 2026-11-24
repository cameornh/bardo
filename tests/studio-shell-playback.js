import {startStudioApp} from '../src/asset-studio/main.js';
import {StudioView} from '../src/asset-studio/view.js';

const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));

function image(view,target){
 const pixels=new Uint8Array(target.width*target.height*4);
 view.renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
 return pixels;
}

// Read the actual terrain and water passes with the same camera and physics state.
// Counting draw calls alone missed the driver rejecting both colour draws.
function visiblePixels(view,target,materials,draw){
 draw.call(view);
 const before=image(view,target);
 const prior=materials.map(m=>m.colorWrite);
 let after;
 try{
  for(const material of materials)material.colorWrite=false;
  draw.call(view);
  after=image(view,target);
 }finally{materials.forEach((mat,i)=>{mat.colorWrite=prior[i];});}
 let changed=0;
 for(let i=0;i<before.length;i+=4){
  if(Math.abs(before[i]-after[i])>8||Math.abs(before[i+1]-after[i+1])>8||Math.abs(before[i+2]-after[i+2])>8)changed++;
 }
 return changed;
}

document.querySelector('#start').onclick=()=>checkPlayback(true);
document.querySelector('#full').onclick=()=>checkPlayback(false);

async function checkPlayback(compact){
 document.documentElement.classList.toggle('compact',compact);
 for(const button of document.querySelectorAll('button'))button.disabled=true;
 let view,draws=0;
 const errors=new Set(),report=document.createElement('pre');
 const original=StudioView.prototype.draw,logError=console.error;
 console.error=(...args)=>{errors.add(args.join(' ').slice(0,1800));logError(...args);};
 StudioView.prototype.draw=function(){view=this;original.call(view);draws++;};
 try{
  await startStudioApp(undefined,{testId:'wetland'});
  document.body.append(report);
  const gl=document.querySelector('canvas').getContext('webgl2');
  async function waitDraws(count){
   const target=draws+count,deadline=performance.now()+45000;
   while(draws<target){
    if(gl.isContextLost()||performance.now()>deadline)throw Error('Beach playback stalled');
    await nextFrame();
   }
  }
  document.querySelector('#studio-play').click();
  for(let i=0;i<600&&!view?.activePhysics;i++)await nextFrame();
  if(!view?.activePhysics)throw Error('Beach physics failed to start');
  const samples=[];
  let terrainPixels,waterPixels;
  for(const preset of ['overview','wildlife']){
   const select=document.querySelector('#studio-transect');
   select.value=preset;select.dispatchEvent(new Event('change'));
   await waitDraws(12);
   gl.finish();
   const start=performance.now(),t=view.activePhysics.time,first=draws;
   await waitDraws(42);
   gl.finish();
   const seconds=(performance.now()-start)/1000;
   samples.push({preset,fps:(draws-first)/seconds,physics:(view.activePhysics.time-t)/seconds,glError:gl.getError()});
   if(preset==='overview'){
    const ocean=view.oceanView;
    terrainPixels=visiblePixels(view,ocean.capture.source,[view.garden.terrain,view.garden.sandPatchTerrain],original);
    waterPixels=visiblePixels(view,ocean.capture.bulk,[ocean.mesh.material,ocean.breakingGrid.mesh.material],original);
   }
   report.textContent=JSON.stringify({samples,terrainPixels,waterPixels},null,2);
  }
  const error=gl.getError(),contextLost=gl.isContextLost();
  const pass=samples.every(s=>s.glError===0&&s.physics>0)&&error===0&&!contextLost&&!errors.size&&terrainPixels>100&&waterPixels>100;
  report.textContent=JSON.stringify({pass,samples,terrainPixels,waterPixels,size:[gl.drawingBufferWidth,gl.drawingBufferHeight],errors:[...errors],error,contextLost},null,2);
 }catch(e){document.body.append(report);report.textContent=String(e)+'\n'+[...errors].join('\n');}
 finally{window.dispatchEvent(new Event('pagehide'));StudioView.prototype.draw=original;console.error=logError;}
}
