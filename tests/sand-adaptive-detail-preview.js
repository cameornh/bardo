import * as THREE from 'three';
import {waterFixture} from './sand-adaptive-fixture.js';
import {InteriorWaterCompression,traceDensityInterval} from '../src/sand-lab/adaptive-water-detail.js';
import {LabWaterField} from '../src/sand-lab/water-lab-field.js';
import {sampleFieldCPU} from '../src/sand-lab/water-lab-medium-shadows.js';
import {requestLabContext} from '../src/sand-lab/graphics-health.js';
import {checkAdaptiveSearch} from './sand-adaptive-gpu-check.js';
const result=document.querySelector('#result'),fixture=waterFixture(),compression=new InteriorWaterCompression(),bounds={min:[-.4,-.4,-.4],max:[2.8,2.8,2.8]};
let output,fields,report;
function reference(){
 if(fields)return;
 for(let i=0;i<10;i++)output=compression.update(fixture.items,fixture.lab,.1);
 fields=[fixture.items,output].map(items=>{const f=new LabWaterField({extensions:{has:()=>false}});f.update(items,.2,bounds);return f;});
 const canvas=document.querySelector('#view'),ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height);
 for(let y=0;y<200;y++)for(let x=0;x<640;x++){
  const f=fields[x<320?0:1],p=[-.4+(x%320)/320*3.2,2.8-y/200*3.2,1.2],d=sampleFieldCPU(f.fallback.image.data,f.layout,p)[0];
  const color=d>=.18?[30+30*Math.min(1,d),100+25*Math.min(1,d),145+30*Math.min(1,d)]:[36,43,48];image.data.set([...color,255],(y*640+x)*4);
 }
 ctx.putImageData(image,0,0);
 let maximumSurfaceError=0;for(let x=.3;x<2.2;x+=.1){const intervals=fields.map(f=>traceDensityInterval(p=>sampleFieldCPU(f.fallback.image.data,f.layout,p)[0],[x,2.8,1.2],[0,-1,0],{spacing:.2,limit:4}));maximumSurfaceError=Math.max(maximumSurfaceError,Math.abs(intervals[0].entry-intervals[1].entry));}
 report={...compression.stats,maximumSurfaceError,volumeError:output.reduce((v,p)=>v+p.volume,0)-fixture.items.reduce((v,p)=>v+p.volume,0),pass:maximumSurfaceError<.001};result.textContent=JSON.stringify(report,null,2);
}
document.querySelector('#reference').onclick=reference;
document.querySelector('#gpu').onclick=async()=>{
 document.querySelector('#gpu').disabled=true;reference();let renderer,field,gl;
 try{
  // One small density atlas and one tiny scalar check. Never load the lab's
  // large lighting/object programs or queue simulation work in this fixture.
  const canvas=document.querySelector('#gpu-view');gl=requestLabContext(canvas);renderer=new THREE.WebGLRenderer({canvas,context:gl,antialias:false});
  field=new LabWaterField(renderer);if(field.cpu)throw Error('Floating-point render targets unavailable; CPU reference passed.');
  field.update(output,.2,bounds);const l=field.layout,data=new Float32Array(l.width*l.height*4);await renderer.readRenderTargetPixelsAsync(field.target,0,0,l.width,l.height,data);
  const expected=fields[1].fallback.image.data;let error=0,nonFinite=0;for(let i=0;i<data.length;i++){if(!Number.isFinite(data[i]))nonFinite++;else error=Math.max(error,Math.abs(data[i]-expected[i]));}
  report.gpu={maximumDensityError:error,nonFinite,atlas:[l.width,l.height],pass:error<.0001&&!nonFinite};
  report.cameraSearch=await checkAdaptiveSearch(renderer);report.pass&&=report.gpu.pass&&report.cameraSearch.pass;result.textContent=JSON.stringify(report,null,2);
 }catch(error){result.textContent=JSON.stringify({...report,gpuError:error.message},null,2);}
 finally{field?.dispose();renderer?.dispose();gl?.getExtension('WEBGL_lose_context')?.loseContext();}
};
