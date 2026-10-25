import * as THREE from 'three';
import {FieldOccupancy,fillMacroCPU} from '../src/sand-lab/field-occupancy.js';
import {fieldLayout} from '../src/sand-lab/water-lab-field.js';
import {prepareShaderJobs} from '../src/rtx-sand-lab/shader-startup.js';
import {installRTXShaderCompatibility} from '../src/rtx-sand-lab/shader-compatibility.js';
import {installProgramSpecialization} from '../src/sand-lab/program-specialization.js';
import {installRTXGraphicsGuard} from '../src/rtx-sand-lab/graphics.js';
import {createLabRenderer} from '../src/sand-lab/graphics-health.js';
const out=document.querySelector('#result');
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;let renderer,field,target,source;
 try{
  renderer=createLabRenderer(THREE.WebGLRenderer,{canvas:document.querySelector('#view'),antialias:false},e=>{out.textContent=e.message;});
  installRTXGraphicsGuard(renderer,e=>{out.textContent=e.message;});installRTXShaderCompatibility(renderer);installProgramSpecialization(renderer,()=>true,{warmObjects:false,prepareCompile:true});
  const l=fieldLayout(1,1,{min:[0,0,0],max:[17,9,11]}),data=new Float32Array(l.width*l.height*4);
  for(let y=0;y<l.dimensions[1];y++)for(let z=0;z<l.dimensions[2];z++)for(let x=0;x<l.dimensions[0];x++){
   const px=(y%l.columns)*(l.dimensions[0]+2)+1+x,py=Math.floor(y/l.columns)*(l.dimensions[2]+2)+1+z;data[(py*l.width+px)*4]=((x*37+y*19+z*13)%257)/257;
  }
  const expected=data.slice();fillMacroCPU(expected,l);field=new FieldOccupancy(renderer);
  field.u.uSize.value.set(l.dimensions);field.u.uMacroSize.value.set(l.macro.size);field.u.uColumns.value=l.columns;field.u.uWidth.value=l.width;
  target=new THREE.WebGLRenderTarget(l.width,l.macro.rows,{type:THREE.FloatType,depthBuffer:false});
  const prepared=await prepareShaderJobs(renderer,[{name:'flat water field maxima',scene:field.scene,camera:field.camera,target}],{before:async name=>{out.textContent=name;}});
  const programs=renderer.info.programs.length;
  source=new THREE.DataTexture(data,l.width,l.height,THREE.RGBAFormat,THREE.FloatType);source.needsUpdate=true;field.u.uSource.value=source;
  renderer.setRenderTarget(target);renderer.render(field.scene,field.camera);
  const actual=new Float32Array(l.width*l.macro.rows*4);renderer.readRenderTargetPixels(target,0,0,l.width,l.macro.rows,actual);
  let error=0;for(let i=0;i<l.macro.count;i++)error=Math.max(error,Math.abs(actual[i*4]-expected[(l.macro.offset*l.width+i)*4]));
  const reused=renderer.info.programs.length===programs;
  out.textContent=JSON.stringify({pass:Number.isFinite(error)&&error===0&&reused,prepared,macroCells:l.macro.count,samplesPerCell:729,maxError:error,reusedPreparedProgram:reused},null,2);
 }catch(error){out.textContent=error.stack||String(error);}
 finally{field?.dispose();target?.dispose();source?.dispose();renderer?.dispose();}
};
