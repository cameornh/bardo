import {Vector3} from 'three';
import {StudioView} from '../src/asset-studio/view.js';
import {seedLibrary,transform} from '../src/asset-studio/model.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {WindSand} from '../src/asset-studio/wind-sand.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {liftGround,moveChunk} from '../src/asset-studio/ground-interaction.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const button=document.querySelector('button'),status=document.querySelector('pre');
button.onclick=async()=>{
 button.disabled=true;let view,sim;
 try{
  const lib=seedLibrary(),arch=lib.assets.find(a=>a.id==='arch'),p=arch.parts[0];
  lib.world.instances=[{id:'arch',assetId:'arch',transform:transform()}];p.physics={fixed:true};
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  const r=view.renderer,gl=r.getContext(),width=640,height=360;
  view.resizeObserver.disconnect();r.setPixelRatio(1);r.setSize(width,height,false);view.uniforms.viewport.value.set(width,height);
  view.camera.aspect=width/height;view.camera.updateProjectionMatrix();
  r.debug.onShaderError=(g,p,v,f)=>{throw Error(g.getShaderInfoLog(v)+' '+g.getShaderInfoLog(f)+' '+g.getProgramInfoLog(p));};
  view.setSurface('arch:'+p.id,bakeFast(p.stamps,.09),lib.materials);
  view.rebuild(lib,'world','arch');view.sand=new WindSand();view.camera.position.set(1.12,.95,3);
  view.controls.target.set(1.12,.95,0);view.controls.update();
  const fence=new FrameCompletion(r);
  async function draw(){
   await fence.run(()=>view.draw());
   const a=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,a);return a;
  }
  const clean=await draw(),grain={x:1.12,y:.95,z:2.96,r:.015,vx:1,vy:0,vz:0};
  view.sand.grains.push(grain);const close=await draw();
  const changes=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])))>3)n++;return n;};
  const eye=view.sandView.eye.visible,center=4*((height/2)*width+width/2);
  const centerChange=Math.max(...[0,1,2].map(k=>Math.abs(clean[center+k]-close[center+k])));
  const closePixels=changes(clean,close);
  grain.z=2.78;await draw();const fartherEye=view.sandView.eye.visible;
  grain.z=-.65;const behindPixels=changes(clean,await draw());
  view.sand.grains.length=0;
  lib.world.groundMaterialId='wood';view.sand=null;view.rebuild(lib,'world','arch');
  sim=await StudioPhysics.create(lib,'world','arch');liftGround(sim,new Vector3(.75,0,1.5));
  moveChunk(sim,new Vector3(1.55,.92,1.4));for(let i=0;i<96;i++)sim.step();
  view.applyPhysics(sim);view.camera.position.set(3.3,2.65,5.2);view.controls.target.set(.4,.85,.6);view.controls.update();
  await draw();const hasCavity=view.groundEdits.patch.visible,meshes=view.groundEdits.meshes.size;
  const pass=eye&&!fartherEye&&centerChange>10&&closePixels>0&&closePixels<.025*width*height&&behindPixels===0&&hasCavity&&meshes===1&&gl.getError()===0&&!gl.isContextLost();
  status.textContent=JSON.stringify({pass,nearGrainPixelsOverPillar:closePixels,centerChannelChange:centerChange,eyeEffectAt22cm:fartherEye,visibleGrainPixelsBehindPillar:behindPixels,renderedCut:hasCavity,renderedChunks:meshes},null,2);
 }catch(e){status.textContent=String(e.stack||e);}finally{sim?.dispose();view?.dispose();button.disabled=false;}
};
