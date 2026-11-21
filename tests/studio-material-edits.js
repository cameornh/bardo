import {StudioView} from '../src/asset-studio/view.js';
import {seedLibrary, asset, part, stamp, transform} from '../src/asset-studio/model.js';
import {bakeFast} from '../src/asset-studio/sculpt-fast.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

const button = document.querySelector('button'), status = document.querySelector('pre');
const nextFrame = () => new Promise(requestAnimationFrame);

button.onclick = async () => {
  button.disabled = true;
  let view;
  try {
    const library = seedLibrary(), original = '#368880', edit = '#bc6432';
    const paint = {...library.materials[0], id:'paint', color:original};
    library.materials.push(paint);
    library.assets = []; library.world.instances = []; library.world.groundMaterialId='stone';
    const surfaces = new Map();
    for (const [index, base] of ['wood','stone','clay','rubber'].entries()) {
      const a = asset(base);
      a.parts = [part('Body', [stamp('box','add',[0,1,0],[.95,.95,.5],base),
        stamp('sphere','paint',[0,1,.5],[.62,.62,.62],index===0?paint.id:'bronze')])];
      library.assets.push(a);
      library.world.instances.push({id:a.id, assetId:a.id, transform:{...transform(),position:[(index%2-0.5)*2.4,0,-Math.floor(index/2)*2.2]}});
      surfaces.set(a.id+':'+a.parts[0].id, bakeFast(a.parts[0].stamps,.05));
    }
    view = new StudioView(document.querySelector('canvas'),()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
    view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(480,300,false);
    view.camera.aspect=480/300;view.camera.updateProjectionMatrix();view.uniforms.viewport.value.set(480,300);
    view.camera.position.set(3,3.8,7);view.controls.target.set(0,1,-1);view.controls.update();
    const fence = new FrameCompletion(view.renderer), gl = view.renderer.getContext(), rows = [];
    const oracle = [];
    for (const incremental of [false,true,true,false]) {
      status.textContent = 'Comparison '+(rows.length+1)+' of 4';
      view.geometry = incremental ? StudioView.prototype.geometry : StudioView.prototype.referenceGeometry;
      paint.color=original;
      for(const [key,surface] of surfaces)view.setSurface(key,surface,library.materials);
      view.rebuild(library,'world');await fence.run(()=>view.draw());
      let workMs=0, latencyMs=0, differences=0;
      for(let i=0;i<12;i++){
        await nextFrame();
        const start=performance.now();paint.color=i%2?original:edit;
        if(incremental)view.recolor(library.materials,paint,'color');
        else view.recolor(library.materials);
        view.rebuild(library,'world');
        workMs+=performance.now()-start;
        await fence.run(()=>view.draw());
        latencyMs+=performance.now()-start;
        if(i<2){
          const pixels=new Uint8Array(480*300*4);
          gl.readPixels(0,0,480,300,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          if(!rows.length)oracle.push(pixels);
          else for(let j=0;j<pixels.length;j++)if(oracle[i][j]!==pixels[j])differences++;
        }
      }
      if(differences)throw Error(differences+' image channels differed from the full rebuild.');
      rows.push({incremental,editCpuMs:+(workMs/12).toFixed(2),completedEditMs:+(latencyMs/12).toFixed(2)});
    }
    let changePixels=0;
    for(let i=0;i<oracle[0].length;i+=4){
      if(oracle[0][i]!==oracle[1][i] || oracle[0][i+1]!==oracle[1][i+1] || oracle[0][i+2]!==oracle[1][i+2])changePixels++;
    }
    if(!changePixels)throw Error('Material edit made no visible difference.');
    status.textContent=[
      'Editing four painted sculpts · '+view.gaussianCount.toLocaleString()+' Gaussian samples',
      '12 edits per block, milliseconds per edit',
      '',
      'Update          Edit CPU   Edit to completed frame',
      ...rows.map(row=>(row.incremental?'In place':'Full rebuild').padEnd(16)
        +row.editCpuMs.toFixed(2).padStart(8)+'   '+row.completedEditMs.toFixed(2).padStart(8)),
      '',
      changePixels.toLocaleString()+' pixels changed color between paints.',
      'Both implementations rendered identical pixels for each paint.',
      gl.isContextLost()?'Graphics context lost.':'Graphics context healthy.'
    ].join('\n');
  } catch(error){status.textContent='Stopped: '+error.message;} finally{view?.dispose();button.disabled=false;}
};
