import {Vector3} from 'three';
import {StudioView} from '../src/asset-studio/view.js';
import {WindSea} from '../src/asset-studio/ocean.js';
import {seedLibrary,stamp,transform} from '../src/asset-studio/model.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const button=document.querySelector('button'),result=document.querySelector('#result'),width=480,height=300;
button.onclick=async()=>{
 let view;
 button.disabled=true;
 try{
  const l=seedLibrary(),mat=l.materials.find(m=>m.id==='wood'),water=l.materials.find(m=>m.id==='water');
  l.world.groundMaterialId='water';mat.color='#fa3821';mat.emission=.45;
  const p=l.assets[0].parts[0];p.stamps=[stamp('box','add',[0,0,0],[.58,.44,.4],'wood')];
  const placement=(x,y)=>({id:'witness'+x,assetId:'starter',transform:{...transform(),position:[x,y,0]}});
  const above=placement(-1.1,1.15),below=placement(1.1,-.65);
  view=new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(width,height,false);
  view.camera.aspect=width/height;view.camera.updateProjectionMatrix();
  view.camera.position.set(0,2.5,6);view.controls.target.set(0,0,0);view.controls.update();
  const completion=new FrameCompletion(view.renderer),gl=view.renderer.getContext();
  view.renderer.debug.onShaderError=(g,prog,vs,fs)=>{throw Error(g.getShaderInfoLog(vs)+' '+g.getShaderInfoLog(fs)+' '+g.getProgramInfoLog(prog));};
  view.sea=new WindSea();
  async function frame(placements){
   l.world.instances=placements;view.rebuild(l,'world','starter');view.oceanView.capture.nextReflection=-Infinity;
   await completion.run(()=>view.draw());const pixels=new Uint8Array(width*height*4);
   gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   if(gl.getError()!==gl.NO_ERROR||gl.isContextLost())throw Error('Pixel readback failed');
   return pixels;
  }
  const project=(x,y,z)=>{const p=new Vector3(x,y,z).project(view.camera);return [Math.round((p.x*.5+.5)*width),Math.round((p.y*.5+.5)*height)];};
  function compare(a,b,center,rx,ry){
   let changed=0,peak=0,total=0;
   for(let y=Math.max(0,center[1]-ry);y<=Math.min(height-1,center[1]+ry);y++)for(let x=Math.max(0,center[0]-rx);x<=Math.min(width-1,center[0]+rx);x++){
    const i=4*(y*width+x),v=Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])));
    if(v>3)changed++;total+=v;peak=Math.max(peak,v);
   }
   return {changed,peak,total};
  }
  const empty=await frame([]),transmitted=await frame([below]),both=await frame([above,below]);
  const mirror=compare(both,transmitted,project(-1.1,-1.15,0),24,15);
  const transmission=compare(transmitted,empty,project(1.1,-.65,0),30,25);
  water.ior=1;const straight=await frame([above,below]);water.ior=1.333;
  const refraction=compare(both,straight,project(1.1,-.65,0),38,28);
  water.absorption=5;const turbid=await frame([above,below]);water.absorption=0;
  const scattering=compare(both,turbid,project(1.1,-.65,0),30,25);
  view.sea.lift(0,1);view.sea.moveLift({x:0,y:.68,z:1});const lifted=await frame([above,below]);
  const handful=compare(lifted,both,project(0,.68,1),14,14);
  const boxes=view.oceanView.parcels.mesh.count;
  const pass=mirror.changed>30&&transmission.changed>40&&refraction.changed>40&&scattering.changed>40&&handful.changed>30&&boxes===1;
  result.textContent=JSON.stringify({pass,mirror,transmission,refraction,scattering,handful,connectedHandfulDrawBoxes:boxes,contextLost:gl.isContextLost()},null,2);
 }catch(e){result.textContent='Stopped: '+e.message;}finally{view?.dispose();button.disabled=false;}
};
