import * as T from 'three';
import {StudioView} from '../src/asset-studio/view.js';
import {WindSea} from '../src/asset-studio/ocean.js';
import {lipPoint} from '../src/asset-studio/breaking-wave.js';
import {breakerVertex} from '../src/asset-studio/breaking-grid.js';
import {seedLibrary} from '../src/asset-studio/model.js';
import {FrameCompletion} from '../src/rtx-sand-lab/frame-completion.js';

// Run the production deformation shader at known material coordinates. Comparing
// world positions catches axis swaps and disagreement about when a lip detaches.
async function compare(view,complete,c,sea){
 const width=32,target=new T.WebGLRenderTarget(width,1,{type:T.FloatType,depthBuffer:false});
 const g=new T.BufferGeometry(),rect=[],zeros=new Float32Array(width*4),expected=[];
 for(let i=0;i<width;i++){
  const p=lipPoint(c,Math.sin(1.4*i)*.8,.23+.7*i/(width-1),sea.time-c.t);
  rect.push(p.baseX,p.baseZ,0,0);expected.push(p);
 }
 g.setAttribute('position',new T.BufferAttribute(new Float32Array(width*3),3));
 g.setAttribute('cellRect',new T.Float32BufferAttribute(rect,4));g.setAttribute('cornerSpacing',new T.BufferAttribute(zeros,4));
 const m=new T.ShaderMaterial({uniforms:view.oceanView.breakingGrid.uniforms,
  vertexShader:`float surfaceHeight(vec2 p,float lod){return 0.;}`+breakerVertex+`
   varying vec3 pos;void main(){refineOcean(pos);gl_PointSize=1.;gl_Position=vec4(2.*(float(gl_VertexID)+.5)/32.-1.,0.,0.,1.);}`,
  fragmentShader:'varying vec3 pos;void main(){gl_FragColor=vec4(pos,1.);}'});
 const scene=new T.Scene(),points=new T.Points(g,m);points.frustumCulled=false;scene.add(points);
 const r=view.renderer;
 try{
  const values=new Float32Array(width*4);r.setRenderTarget(target);
  await complete.run(()=>r.render(scene,view.camera));r.readRenderTargetPixels(target,0,0,width,1,values);
  let error=0;for(let i=0;i<width;i++)for(const [k,axis] of ['x','y','z'].entries())error=Math.max(error,Math.abs(expected[i][axis]-values[4*i+k]));
  return error;
 }finally{r.setRenderTarget(null);g.dispose();m.dispose();target.dispose();}
}
const button=document.querySelector('button'),status=document.querySelector('pre');
button.onclick=async()=>{
 button.disabled=true;let view;
 try{
  const lib=seedLibrary();lib.world.instances=[];lib.world.groundMaterialId='water';
  const canvas=document.querySelector('canvas');view=new StudioView(canvas,()=>{},()=>{},{liveStudio:true,preserveDrawingBuffer:true});
  view.resizeObserver.disconnect();view.renderer.setPixelRatio(1);view.renderer.setSize(440,240,false);view.camera.aspect=440/240;view.camera.updateProjectionMatrix();
  view.renderer.debug.onShaderError=(gl,p,v,f)=>{throw Error([gl.getShaderInfoLog(v),gl.getShaderInfoLog(f),gl.getProgramInfoLog(p)].join(' '));};
  const sea=view.sea=new WindSea(16,15);view.rebuild(lib,'world','starter');sea.organicLoad=.5;
  for(let i=0;i<600&&!sea.crests.length;i++)sea.advance(1/60);
  const c=sea.crests[0];if(!c)throw Error('No breaking spectral crest');
  const y=sea.height(c.x,c.z);
  const travel=.45*c.duration*c.travelSpeed,cx=c.x+travel*c.dx,cz=c.z+travel*c.dz;
  view.camera.position.set(cx+2.9*c.dx-3.0*c.dz,y+.88,cz+2.9*c.dz+3.0*c.dx);
  view.controls.target.set(cx,y+.09,cz);view.controls.update();
  const complete=new FrameCompletion(view.renderer),gl=view.renderer.getContext();
  const steps=[0,.23,.51,.78,1.02],sequence=document.querySelector('#sequence');sequence.replaceChildren();
  let error=null,maxCells=0;
  for(const phase of steps){
   while(sea.time<c.t+phase*c.duration-1e-7)sea.advance(Math.min(1/120,c.t+phase*c.duration-sea.time));
   await complete.run(()=>view.draw());
   const figure=document.createElement('figure'),img=new Image(),caption=document.createElement('figcaption');
   img.src=canvas.toDataURL('image/jpeg',.93);caption.textContent=(sea.time-c.t).toFixed(2)+' s';figure.append(img,caption);sequence.append(figure);
   const grid=view.oceanView.breakingGrid;maxCells=Math.max(maxCells,grid.active.size);
   if(phase===.51){
    // Isolate the selected crest for the numerical measurement.
    const list=sea.crests;sea.crests=[c];grid.update(sea,view.camera.position);
    try{error=await compare(view,complete,c,sea);}finally{sea.crests=list;}
   }
  }
  status.textContent=JSON.stringify({pass:maxCells>0&&error<.001&&gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),gpuSamples:32,maxPositionErrorMetres:error,maxRefinedCells:maxCells,contextLost:gl.isContextLost()},null,2);
 }catch(e){status.textContent='Stopped: '+e.message;}finally{view?.dispose();button.disabled=false;}
};
