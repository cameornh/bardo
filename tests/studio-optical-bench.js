import {StudioView} from '../src/asset-studio/view.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {opticsBench} from '../src/asset-studio/studio-equipment.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {GroundCuts} from '../src/asset-studio/ground-tools.js';
const button=document.querySelector('button'),out=document.querySelector('pre');
function checkPrograms(view){
 view.renderer.debug.onShaderError=(gl,p,v,f)=>{
  throw Error([gl.getShaderInfoLog(v),gl.getShaderInfoLog(f),gl.getProgramInfoLog(p)].filter(Boolean).join('\n')||'Optical shader failed to link');
 };
}
button.onclick=async()=>{
 button.disabled=document.querySelector('#pixels').disabled=true;
 let view,sim;
 try{
  const lib=opticsBench(),width=560,height=320;
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(width,height,false);
  view.camera.aspect=width/height;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(width,height);
  view.controls.target.set(0,.4,0);view.camera.position.set(4.6,3.9,5.8);
  const distance=new URLSearchParams(location.search).get('distance');
  if(distance==='far')view.camera.position.sub(view.controls.target).multiplyScalar(32).add(view.controls.target);
  view.controls.update();
  for(const inst of lib.world.instances){
   const a=lib.assets.find(a=>a.id===inst.assetId);
   for(const p of a.parts)view.setSurface(a.id+':'+p.id,bakeFast(p.stamps,a.spacing),lib.materials,p.stamps);
   inst.transform.position[1]+=.6;
  }
  view.rebuild(lib,'world');sim=await StudioPhysics.create(lib,'world');
  const gl=view.renderer.getContext();
  checkPrograms(view);
  const frame=()=>{view.applyPhysics(sim);view.draw();};
  const next=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  // At most two frames on the device. Poll asynchronously so timing includes
  // completed rendering without forcing an expensive pixel transfer every frame.
  const pending=[];
  async function completed(){
   const sync=pending.shift(),start=performance.now();
   try{for(;;){
    const state=gl.clientWaitSync(sync,0,0);
    if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED)return;
    if(state===gl.WAIT_FAILED||gl.isContextLost()||performance.now()-start>8000)throw Error('Stopped waiting for graphics');
    await new Promise(resolve=>setTimeout(resolve,4));
   }}finally{gl.deleteSync(sync);}
  }
  async function submit(){
   const start=performance.now();frame();const cpuMs=performance.now()-start;pending.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0));gl.flush();
   if(pending.length>=2)await completed();return cpuMs;
  }
  for(let i=0;i<8;i++){await next();sim.advance(1/60);await submit();}
  while(pending.length)await completed();
  const rows=[];
  for(let b=0;b<2;b++){
   const start=performance.now();let prev=start,simulated=0,physicsMs=0;
   for(let i=0;i<36;i++){
    await next();const now=performance.now();simulated+=sim.advance(Math.min(.1,(now-prev)/1000));physicsMs+=performance.now()-now;prev=now;await submit();
   }
   while(pending.length)await completed();
   const wall=(performance.now()-start)/1000;
   rows.push({fps:+(36/wall).toFixed(2),realtime:+(simulated/wall).toFixed(3),physicsMs:+(physicsMs/36).toFixed(1)});
  }
  out.textContent=JSON.stringify({rows},null,2);
  let profile;
  if(new URLSearchParams(location.search).has('profile')){
   const {opticalProfile}=await import('./studio-optical-profile.js');
   profile=await opticalProfile(view,submit,async()=>{while(pending.length)await completed();},next);
  }
  out.textContent=JSON.stringify({rows,profile,distance:distance??'near',ground:lib.world.groundMaterialId,width,height,placements:lib.world.instances.length,lost:gl.isContextLost()},null,2);
 }catch(e){out.textContent=e.stack;}finally{view?.dispose();sim?.dispose();button.disabled=document.querySelector('#pixels').disabled=false;}
};

document.querySelector('#pixels').onclick=async function(){
 this.disabled=button.disabled=true;
 let view;
 try{
  const {Vector3}=await import('three'),{lightPathBench}=await import('../src/asset-studio/studio-equipment.js');
  const lib=lightPathBench(),width=560,height=320;
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  checkPrograms(view);
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(width,height,false);
  view.camera.aspect=width/height;view.camera.updateProjectionMatrix();
  view.camera.position.set(3.3,4.5,6.7);view.controls.target.set(0,1.15,0);view.controls.update();
  for(const inst of lib.world.instances){
   const a=lib.assets.find(a=>a.id===inst.assetId);
   for(const p of a.parts)view.setSurface(a.id+':'+p.id,bakeFast(p.stamps,a.spacing),lib.materials,p.stamps);
  }
  view.rebuild(lib,'world');
  const gl=view.renderer.getContext(),lens=view.groups.get('mount-equipment-optical-glass-convex'),mirror=view.groups.get('mount-bench-plane-mirror');
  const sample=(x,z)=>{
   const uv=new Vector3(x,.006,z).project(view.camera),pixels=new Uint8Array(36);
   gl.readPixels(Math.floor((uv.x+1)*width/2)-1,Math.floor((uv.y+1)*height/2)-1,3,3,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   return [0,1,2].map(c=>Math.round(pixels.reduce((sum,value,i)=>sum+(i%4===c?value:0),0)/9));
  };
  const draw=()=>{
   view.caustics.reset();
   for(let i=0;i<4;i++){view.caustics.next=0;view.draw();}
   if(gl.isContextLost()||gl.getError())throw Error('Graphics check failed');
   return [sample(-1.35,0),sample(1.35,.82)];
  };
  const aimed=draw();lens.visible=false;mirror.rotation.x=-.30;
  const diverted=draw();lens.visible=true;mirror.rotation.x=-Math.PI/3;
  const savedSun=view.uniforms.sunDirection.value.clone();view.uniforms.sunDirection.value.set(0,1,0);
  for(const lamp of view.emitters)lamp.object.visible=false;
  const sun=draw()[0];lens.visible=false;const noLens=draw()[0];
  lens.visible=true;view.uniforms.sunDirection.value.copy(savedSun);
  for(const lamp of view.emitters)lamp.object.visible=true;
  draw();
  // Compare the tiled lamp atlas to the six-camera path in the same scene.
  if(!view.lampShadows.batch.mesh)throw Error('Expected batched optics shadows');
  const image=()=>{const p=new Uint8Array(4*width*height);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
  const compareShadows=()=>{
   const batched=image(),prepare=view.lampShadows.batch.prepare;
   view.lampShadows.batch.prepare=()=>null;view.lampShadows.slots=[];
   draw();const separate=image();
   let diff=0,max=0;
   for(let i=0;i<batched.length;i++)if(i%4!==3){const e=Math.abs(batched[i]-separate[i]);diff+=e;max=Math.max(max,e);}
   view.lampShadows.batch.prepare=prepare;view.lampShadows.slots=[];
   return {mean:diff/(width*height*3),max};
  };
  const flat=compareShadows(),cuts=new GroundCuts(),update=view.groundEdits.update;
  cuts.displace(1.35,.82,.12,0);const dentedGround={cuts,chunks:new Map()};
  view.groundEdits.update=function(){update.call(this,dentedGround);};
  draw();
  const shadowBatch=view.lampShadows.batch;
  if(shadowBatch.mesh.geometry.drawRange.count<=shadowBatch.patchIndex)throw Error('Dented surface missing from shadow batch');
  const dented=compareShadows();view.groundEdits.update=update;view.shadowRevision++;draw();
  out.textContent=JSON.stringify({pass:flat.mean<1&&dented.mean<1&&aimed[0][1]>diverted[0][1]+5&&aimed[1][0]>diverted[1][0]+5&&sun[0]>noLens[0]+5,aimed,diverted,sun,noLens,flat,dented,contextLost:gl.isContextLost()},null,2);
 }catch(e){out.textContent=e.stack;}finally{view?.dispose();this.disabled=button.disabled=false;}
};
