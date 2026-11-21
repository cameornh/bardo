// Bounded real-scene reference. The two cantilevers differ only in tensile strength.
import {StudioView} from '../src/asset-studio/view.js';
import {StudioPhysics} from '../src/asset-studio/physics.js';
import {seedLibrary,asset,part,stamp,transform} from '../src/asset-studio/model.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

export async function showStructures(canvas,output){
 const library=seedLibrary(),wood=library.materials.find(m=>m.id==='wood');
 library.materials.push({...wood,id:'strong',tensileStrength:2e7},
  {...wood,id:'soft',color:'#946a4a',youngModulus:2e5,tensileStrength:2e6});
 library.world.groundMaterialId='sand';library.world.wind={speed:0,heading:0};
 library.assets=[];library.world.instances=[];
 for(const [i,material] of ['wood','strong','soft'].entries()){
  const a=asset('Loaded member'),column=i===2;
  const post=part('Support',[stamp('box','add',[0,.65,0],[.27,.65,.27],'stone',0)]);
  const beam=part('Member',[stamp('box','add',column?[0,1.5,0]:[1.1,1.36,0],column?[.08,1.5,.08]:[1.1,.08,.08],material,0)]);
  beam.physics={fixed:true};post.physics={fixed:true};a.parts=column?[beam]:[post,beam];library.assets.push(a);
  library.world.instances.push({id:material,assetId:a.id,transform:{...transform(),position:[column?-.8:-2.4,0,(i-1)*2]}});
 }
 const view=new StudioView(canvas,()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});let sim;
 try{
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(640,360,false);
  view.camera.aspect=640/360;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(640,360);
  view.rebuild(library,'world',library.assets[0].id);view.camera.position.set(4.5,3.3,6.5);view.controls.target.set(-1.4,.95,0);view.controls.update();
  sim=await StudioPhysics.create(library,'world',library.assets[0].id);view.sand=sim.sand;
  const fence=new FrameCompletion(view.renderer);
  for(let i=0;i<26;i++){
   await new Promise(requestAnimationFrame);sim.advance(1/12);view.applyPhysics(sim);await fence.run(()=>view.draw());
  }
  const rows=sim.sections.map(s=>[s.material.id,s.status]);
  if(rows.map(r=>r[1]).join()!=='fractured,intact,buckled')throw Error('Unexpected load outcomes '+JSON.stringify(rows));
  output.textContent=JSON.stringify({members:rows,visiblePieces:view.sectionView.meshes.size*2,contextLost:view.renderer.getContext().isContextLost()},null,2);
 }finally{sim?.dispose();view.dispose();}
}
