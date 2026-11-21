import * as T from 'three';
import {StudioView} from '../src/asset-studio/view.js';
import {WindSea} from '../src/asset-studio/ocean.js';
import {waveHeight} from '../src/asset-studio/wave-surface.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {seedLibrary,stamp,transform} from '../src/asset-studio/model.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const button=document.querySelector('button'),status=document.querySelector('pre'),width=800,height=440;
const difference=(a,b,i)=>Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));
async function waveError(view,fence){
 const r=view.renderer,sea=view.sea,target=new T.WebGLRenderTarget(48,24),scene=new T.Scene();
 const material=new T.ShaderMaterial({uniforms:view.oceanView.uniforms,
  vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:waveHeight+`void main(){vec2 p=gl_FragCoord.xy*vec2(8.13,9.7)-vec2(196.,128.);
   float k=floor(clamp((elevation(p)+6.)/12.,0.,1.)*65535.+.5);
   gl_FragColor=vec4(floor(k/256.),mod(k,256.),0.,255.)/255.;}`});
 const mesh=new T.Mesh(new T.PlaneGeometry(2,2),material);mesh.frustumCulled=false;scene.add(mesh);
 try{
  await fence.run(()=>{r.setRenderTarget(target);r.render(scene,view.camera);r.setRenderTarget(null);});
  const pixels=new Uint8Array(target.width*target.height*4);
  r.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
  let max=0;
  for(let y=0;y<target.height;y++)for(let x=0;x<target.width;x++){
   const i=(y*target.width+x)*4,h=(pixels[i]*256+pixels[i+1])*12/65535-6;
   max=Math.max(max,Math.abs(h-sea.height((x+.5)*8.13-196,(y+.5)*9.7-128)));
  }
  return max;
 }finally{mesh.geometry.dispose();material.dispose();target.dispose();}
}

// Inspect the actual depth silhouette. Colour alone cannot distinguish distant
// water blended into haze from a prematurely clipped ocean.
async function horizonError(view,fence,width,height){
 const r=view.renderer,gl=r.getContext(),scene=new T.Scene(),target=new T.WebGLRenderTarget(1,height);
 const material=new T.ShaderMaterial({uniforms:{depth:{value:view.oceanView.capture.bulk.depthTexture}},
  vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`uniform highp sampler2D depth;void main(){float d=texelFetch(depth,ivec2(${width/2},int(gl_FragCoord.y)),0).r;
   gl_FragColor=vec4(vec3(d<1.?1.:0.),1.);}`});
 const mesh=new T.Mesh(new T.PlaneGeometry(2,2),material);mesh.frustumCulled=false;scene.add(mesh);
 try{
  await fence.run(()=>{r.setRenderTarget(target);r.render(scene,view.camera);r.setRenderTarget(null);});
  const pixels=new Uint8Array(height*4);r.readRenderTargetPixels(target,0,0,1,height,pixels);
  let mismatches=0;
  for(let y=0;y<height;y++){
   const ray=new T.Vector3(0,2*(y+.5)/height-1,.5).unproject(view.camera).sub(view.camera.position);
   if((ray.y<0)!==(pixels[y*4]>127))mismatches++;
  }
  if(gl.getError()!==gl.NO_ERROR)throw Error('Horizon depth readback failed');
  return mismatches;
 }finally{material.dispose();mesh.geometry.dispose();target.dispose();}
}

button.onclick=async()=>{
 let view,sim;button.disabled=true;
 try{
  const lib=seedLibrary(),part=lib.assets[0].parts[0],water=lib.materials.find(m=>m.id==='water');
  lib.world.groundMaterialId='water';lib.world.wind={speed:0,heading:24};
  part.stamps=[stamp('box','add',[0,0,0],[.53,.53,.53],'sand')];
  lib.world.instances=[{id:'sand',assetId:'starter',transform:{...transform(),position:[0,2,0]}}];
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(width,height,false);
  view.camera.aspect=width/height;view.camera.updateProjectionMatrix();view.camera.position.set(0,2.8,8);
  view.controls.target.set(0,0,0);view.controls.update();
  const r=view.renderer,gl=r.getContext(),fence=new FrameCompletion(r),capture=view.oceanView.capture;
  r.debug.onShaderError=(g,p,v,f)=>{throw Error(g.getShaderInfoLog(v)+' '+g.getShaderInfoLog(f)+' '+g.getProgramInfoLog(p));};
  view.sea=new WindSea();view.rebuild(lib,'world','starter');
  sim=await StudioPhysics.create(lib,'world','starter',9.81,view.sea);
  function display(){capture.nextReflection=-Infinity;return fence.run(()=>view.draw());}
  function mirrorPixels(){
   const t=capture.mirror,data=new Uint8Array(t.width*t.height*4);
   r.readRenderTargetPixels(t,0,0,t.width,t.height,data);
   let count=0;for(let i=3;i<data.length;i+=4)if(data[i]>32)count++;return count;
  }
  function pixels(){const data=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;}
  function changes(a,b){let count=0;for(let i=0;i<a.length;i+=4)if(difference(a,b,i)>3)count++;return count;}
  sim.step();view.applyPhysics(sim);await display();const exposed=mirrorPixels();
  const g=sim.matter.parts.values().next().value;
  for(let i=0;i<480&&Math.max(...g.packets.map(p=>p.position.y))+g.radius>-.15;i++)sim.step();
  const highest=Math.max(...g.packets.map(p=>p.position.y))+g.radius;
  view.applyPhysics(sim);await display();const submerged=mirrorPixels(),visible=pixels();
  const mesh=view.matterView.meshes.values().next().value;mesh.visible=false;await display();
  const empty=pixels(),refractedSand=changes(visible,empty);
  // A sand clump just under the surface, 8 m from the camera, cannot be seen
  // through the sky or through a patch of water over 25 m away.
  let straySandPixels=0;
  for(let y=0;y<height;y++){
   const direction=new T.Vector3(0,2*(y+.5)/height-1,.5).unproject(view.camera).sub(view.camera.position).normalize();
   if(direction.y<0&&-view.camera.position.y/direction.y<25)continue;
   for(let x=0;x<width;x++)if(difference(visible,empty,4*(y*width+x))>3)straySandPixels++;
  }
  mesh.visible=true;
  const saved=water.scattering;water.scattering=0;await display();const clear=pixels();
  water.scattering=.65;await display();const scatteringPixels=changes(clear,pixels());water.scattering=saved;
  view.animate(0,false);lib.world.instances=[];view.rebuild(lib,'world','starter');
  view.camera.position.set(21,22,58);view.controls.target.set(0,12,0);view.controls.update();
  view.sea=new WindSea();await display();const calm=pixels();
  view.sea.setWind(18,24);view.sea.sampleTime(.371);await display();
  const windy=pixels(),rangeChanges=[0,0,0],sampled=[0,0,0],ray=new T.Vector3();
  for(let y=0;y<height;y++){
   ray.set(0,(y+.5)*2/height-1,.3).unproject(view.camera).sub(view.camera.position).normalize();
   const path=-view.camera.position.y/ray.y;
   const band=path>=1000&&path<3500?2:path>=300&&path<1000?1:path>=50&&path<300?0:-1;
   if(band<0)continue;
   for(let x=0;x<width;x++){
    const i=4*(x+width*y);sampled[band]++;
    if(difference(windy,calm,i)>=3)rangeChanges[band]++;
   }
  }
  const maxHeightErrorMetres=await waveError(view,fence);
  const position=view.camera.position.clone(),target=view.controls.target.clone();
  view.camera.position.set(0,2400,2800);view.controls.target.set(0,2000,0);view.controls.update();
  await display();const highOrbitHorizonErrorPixels=await horizonError(view,fence,width,height);
  view.camera.position.copy(position);view.controls.target.copy(target);view.controls.update();await display();
  const contextLost=gl.isContextLost();
  const pass=exposed>50&&highest<0&&submerged===0&&straySandPixels===0&&refractedSand>50&&scatteringPixels>1000&&rangeChanges.every(n=>n>40)&&maxHeightErrorMetres<.004&&highOrbitHorizonErrorPixels<=1&&!contextLost;
  status.textContent=JSON.stringify({pass,reflectedSandPixels:{exposed,submerged},highestSandMetres:highest,refractedSand,straySandPixels,scatteringPixels,
   windChangedPixelsAt50_300_1000m:rangeChanges,sampled,maxHeightErrorMetres,highOrbitHorizonErrorPixels,contextLost},null,2);
 }catch(e){status.textContent='Stopped: '+e.stack;}finally{sim?.dispose();view?.dispose();button.disabled=false;}
};
