import {StudioView} from '../src/asset-studio/view.js';
import {WindSea} from '../src/asset-studio/ocean.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {seedLibrary,stamp,transform} from '../src/asset-studio/model.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {FramePacer} from '../src/rtx-sand-lab/frame-pacing.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const status=document.querySelector('#result'),button=document.querySelector('#run');
const pacer=new FramePacer(60);
const next=()=>new Promise(resolve=>{function frame(t){if(pacer.shouldRender(t))resolve(t);else requestAnimationFrame(frame);}requestAnimationFrame(frame);});
button.onclick=async()=>{
 button.disabled=true;let view,physics;
 try{
  const dense=new URLSearchParams(location.search).has('dense'),count=dense?24:12,spacing=dense ? .05 : .08;
  const l=seedLibrary();l.world.wind={speed:8,heading:25};l.world.groundMaterialId='water';
  const part=l.assets[0].parts[0];part.stamps=[stamp('sphere','add',[0,.2,0],[.55,.48,.55],'wood')];
  const block=structuredClone(l.assets[0]);block.id='block';block.parts[0].stamps[0].shape='box';l.assets.push(block);
  l.world.instances=Array.from({length:count},(_,i)=>({id:'float'+i,assetId:i%2?'block':'starter',transform:{...transform(),position:[i%4*1.4-2.1,0,Math.floor(i/4)*1.4-1.4]}}));
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(640,360,false);view.camera.aspect=640/360;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(640,360);
  const completion=new FrameCompletion(view.renderer);
  const errors=[];view.renderer.debug.onShaderError=(gl,program,vs,fs)=>{errors.push([gl.getShaderInfoLog(vs),gl.getShaderInfoLog(fs),gl.getProgramInfoLog(program)].join(' '));};
  const surface=bakeFast(part.stamps,spacing);view.setSurface('starter:'+part.id,surface,l.materials);
  const boxSurface=bakeFast(block.parts[0].stamps,spacing);view.setSurface('block:'+part.id,boxSurface,l.materials);
  const rows=[],mat=l.materials.find(m=>m.id==='wood');
  for(const mode of ['gaussian','auto','auto','gaussian']){
   mat.surfaceMode=mode;view.rebuild(l,'world','starter');view.sea=new WindSea(8,25);
   physics=await StudioPhysics.create(l,'world','starter',9.81,view.sea);
   status.textContent='Testing '+mode+' · '+(rows.length+1)+'/4';
   await completion.run(()=>view.draw());if(errors.length)throw Error(errors.join('\n'));
   for(let i=0;i<6;i++){await next();physics.advance(1/60);view.applyPhysics(physics);await completion.run(()=>view.draw());}
   let start=performance.now(),prev=start,sim=0;const times=[];
   for(let i=0;i<72;i++){
    await next();const now=performance.now();sim+=physics.advance((now-prev)/1000);prev=now;
    view.applyPhysics(physics);await completion.run(()=>view.draw());
    if(errors.length)throw Error(errors.join('\n'));
    times.push(performance.now()-now);
   }
   const wall=(performance.now()-start)/1000;
   rows.push({mode,fps:+(72/wall).toFixed(2),realtime:+(sim/wall).toFixed(3),completedFrameMs:+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(2)});
   physics.dispose();physics=null;
  }
  status.textContent=JSON.stringify({rows,placements:count,spacing,framesPerBlock:72,submittedSamplesPerGaussianPass:count/2*(surface.positions.length+boxSurface.positions.length)/3,dimensions:[640,360],lost:view.failed||false},null,2);
 }catch(e){status.textContent='Stopped: '+e.message;}finally{physics?.dispose();view?.dispose();}
};
