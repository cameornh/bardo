import {Vector3} from 'three';
import {StudioView} from '../src/asset-studio/view.js';
import {seedLibrary,stamp,transform} from '../src/asset-studio/model.js';
import {installEquipment} from '../src/asset-studio/studio-equipment.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {liftGround,releaseChunk,moveChunk} from '../src/asset-studio/ground-interaction.js';

const button=document.querySelector('button'),output=document.querySelector('pre');
button.onclick=async()=>{
 button.disabled=true;output.textContent='Checking';let view,sim;
 await new Promise(resolve=>setTimeout(resolve,30));
 try{
  const lib=installEquipment(seedLibrary()),width=480,height=300;
  const blocker=lib.assets.find(a=>a.id==='starter');
  blocker.parts[0].stamps=[stamp('box','add',[0,.52,0],[.24,.52,.34],'stone',0)];
  const instance=(id,assetId,x,y,z)=>({id,assetId,transform:{...transform(),position:[x,y,z]}});
  lib.materials.find(m=>m.id==='stone').color='#c6c8ca';lib.world.groundMaterialId='stone';lib.world.instances=[instance('red','luminaire-red',-1.2,1,0),instance('block','starter',0,0,0)];
  view=new StudioView(document.querySelector('main canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(width,height,false);view.renderer.getDrawingBufferSize(view.uniforms.viewport.value);
  view.camera.aspect=width/height;view.camera.updateProjectionMatrix();
  view.camera.position.set(1.6,3.3,4.7);view.controls.target.set(.4,.15,0);view.controls.update();
  view.uniforms.sunColor.value.setRGB(0,0,0);for(const sh of view.uniforms.environment.value)sh.multiplyScalar(.18);
  const gl=view.renderer.getContext();
  view.renderer.debug.onShaderError=(g,program,vs,fs)=>{throw Error([vs,fs].map(s=>g.getShaderInfoLog(s)).join(' ')+g.getProgramInfoLog(program));};
  const frame=()=>{
   view.draw();
   // A one-pixel read waits for this bounded frame before the next submission.
   gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
   if(gl.isContextLost()||gl.getError())throw Error('Studio frame failed');
  };
  const sample=z=>{
   const p=new Vector3(1.05,0,z).project(view.camera),pixels=new Uint8Array(5*5*4);
   gl.readPixels(Math.round((p.x*.5+.5)*width)-2,Math.round((p.y*.5+.5)*height)-2,5,5,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   return Math.round(pixels.reduce((sum,v,i)=>sum+(i%4===0?v:0),0)/25);
  };
  view.rebuild(lib,'world','starter');frame();
  const shadow=sample(0),beside=sample(1.6);
  const object=view.groups.get('block');object.position.z=-3;frame();
  const open=sample(0),besideAfter=sample(1.6);
  object.position.z=0;frame();
  const restored=sample(0),error=gl.getError();
  if(error||gl.isContextLost()||!(open>=shadow+8&&Math.abs(beside-besideAfter)<3&&Math.abs(restored-shadow)<3))throw Error(JSON.stringify({shadow,open,restored,beside,besideAfter,error}));
  const lamps=lib.assets.filter(a=>a.id.startsWith('luminaire-'));
  lib.world.instances=lamps.map((a,i)=>instance(a.id,a.id,(i-2.5)*1.22,0,0));
  for(const a of lamps)for(const part of a.parts){
   view.setSurface(a.id+':'+part.id,bakeFast(part.stamps,a.spacing),lib.materials,part.stamps);
  }
  view.rebuild(lib,'world','starter');
  view.camera.position.set(0,1.6,5.6);view.controls.target.set(0,.38,0);view.controls.update();
  for(const lamp of lamps)frame();
  if(view.activeLamps.length!==6||!view.shadowUniforms.studioLampRange.value.slice(0,6).every(v=>v>0))throw Error('Missing colored lamp shadow map');
  // Check each silhouette above the floor, independently of its pool of light.
  for(const [i,a] of lamps.entries()){
   const center=new Vector3((i-2.5)*1.22,.5,0).project(view.camera);
   const pixels=new Uint8Array(60*56*4);
   gl.readPixels(Math.max(0,Math.min(width-60,Math.round((center.x*.5+.5)*width)-30)),Math.round((center.y*.5+.5)*height)-22,60,56,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   let bright=0;
   for(let j=0;j<pixels.length;j+=4)if(Math.max(pixels[j],pixels[j+1],pixels[j+2])>200&&Math.min(pixels[j],pixels[j+1],pixels[j+2])<145)bright++;
   if(bright<50)throw Error(a.name+' silhouette missing ('+bright+' luminous pixels)');
  }
  const gallery=document.getElementById('lamps');gallery.hidden=false;
  gallery.getContext('2d').drawImage(view.renderer.domElement,0,65,width,165,0,0,width,165);
  // Render the settled handful in the same lighting path. No background loop.
  lib.world.instances=[];lib.world.groundMaterialId='sand';lib.world.wind={speed:0,heading:0};
  lib.materials.find(m=>m.id==='sand').moisture=1;
  sim=await StudioPhysics.create(lib,'world','arch');
  view.rebuild(lib,'world','arch');view.sand=sim.sand;
  function place(x,r,y){
   if(!liftGround(sim,new Vector3(x,sim.sandTerrain.height(x,2),2),r))throw Error('Scoop failed');
   moveChunk(sim,new Vector3(0,y,0));for(let i=0;i<100;i++)sim.step();
   releaseChunk(sim);for(let i=0;i<220;i++)sim.step();
  }
  place(2,.55,1.2);place(3,.32,1);
  view.uniforms.sunColor.value.setRGB(1.1,1.02,.88);
  for(let i=0;i<9;i++)view.uniforms.environment.value[i].copy(view.defaultEnvironment[i]);
  view.camera.position.set(1.9,1.05,2.05);view.controls.target.set(0,.24,0);view.controls.update();
  view.applyPhysics(sim);frame();
  const meshes=[...view.matterView.meshes.values()].filter(m=>m.visible&&m.geometry.drawRange.count>0);
  if(!meshes.length||gl.getError()||gl.isContextLost())throw Error('Wet-sand draw failed');
  output.textContent=JSON.stringify({pass:true,coloredLamps:lamps.length,shadowRed:shadow,unblockedRed:open,restoredRed:restored,besideShadow:[beside,besideAfter],sandSurfaces:meshes.length},null,2);
 }catch(e){output.textContent='Failed: '+e.stack;}
 finally{sim?.dispose();view?.dispose();button.disabled=false;}
};
