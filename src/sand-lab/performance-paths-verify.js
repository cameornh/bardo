import {LabFluidGPU} from './water-lab-gpu.js';
import {LabTransportGPU} from './transport-gpu.js';
import {EmitterProbes} from './emitter-probes.js';
import {detailAirExposure} from './water-lab-detail.js';
import {LabWaterField} from './water-lab-field.js';

const error=(a,b)=>{let e=0;for(let i=0;i<a.length;i++)e=Math.max(e,Math.abs(a[i]-b[i]));return e;};
export function verifyPerformancePaths(renderer,lab){
 if(lab.gpu.cpuContacts)return {pass:false,skipped:true,backend:lab.gpu.constraintBackend,reason:'GPU contact probes are disabled for sand scenes containing objects. Run the CPU contact checks instead.'};
 const fluid=new LabFluidGPU(renderer,lab.u),transport=new LabTransportGPU(renderer),probe=new EmitterProbes(renderer,lab.u),field=new LabWaterField(renderer,{ratio:.6});
 const old=new Float32Array(280*4),chem=old.slice();for(let i=0;i<280;i++){old.set([(i%7)*.2-1,.08+(Math.floor(i/7)%5)*.19,Math.floor(i/35)*.2, i%19===0?1:0],i*4);}
 const prior=renderer.getRenderTarget(),readField=()=>{const data=new Float32Array(field.target.width*field.target.height*4);renderer.readRenderTargetPixels(field.target,0,0,field.target.width,field.target.height,data);return data;};
 try{
  fluid.uniforms.uReuseBoundary.value=false;const before=fluid.solve(old,.22,p=>lab.collide(p));fluid.uniforms.uReuseBoundary.value=true;const after=fluid.solve(old,.22,p=>lab.collide(p));const boundaryError=error(before,after);
  const state=transport.solve(old,after,chem,chem,fluid.neighbors,.22,10,1/30,old,fluid);probe.update(fluid,transport,280,.22);const data=new Float32Array(64*fluid.height*4);renderer.readRenderTargetPixels(probe.target,0,0,64,fluid.height,data);
  const reference={positions:after,surfaceMetrics:state.metrics,spacing:.22,gpu:fluid,optimizations:{emitterProbes:false}};let exposureError=0,solidError=0,eligible=0;
  for(let i=0;i<280;i++){const o=i*4,p=[0,1,2].map(k=>after[o+k]+state.metrics[o+k]*.22*.8),solid=lab.solid(p);solidError=Math.max(solidError,Math.abs(solid-data[o+1]));if(!after[o+3]&&solid>=.22*.08){eligible++;exposureError=Math.max(exposureError,Math.abs(detailAirExposure(reference,i)-data[o]));}}
  const packedLab={positions:after,velocities:state.velocities,neighborCounts:state.counts,spacing:.22,count:280,fieldBounds:{min:[-2,-1,-1],max:[2,2,3]}};
  const items=Array.from({length:280},(_,i)=>({position:Array.from(after.subarray(i*4,i*4+3)),radius:.22*(.65+.2*Math.min(1,Math.max(0,((state.counts[i]||0)-5)/20))),volume:.22**3,dye:state.velocities[i*4],tannin:state.velocities[i*4+1],sediment:state.velocities[i*4+2]}));
  field.packedFields=false;field.update(items,.22,packedLab.fieldBounds);const legacy=readField();field.packedFields=true;field.update(items,.22,packedLab.fieldBounds);const fieldError=error(legacy,readField());field.updateBulk(packedLab);const flowError=error(legacy,readField());
  return {backend:fluid.cpu?'CPU':'GPU',boundaryError,exposureError,solidError,eligible,fieldError,flowError,pass:!fluid.cpu&&boundaryError<1e-6&&exposureError<2e-5&&solidError<1e-4&&fieldError<1e-6&&flowError<1e-6};
 }finally{renderer.setRenderTarget(prior);fluid.dispose();transport.dispose();probe.dispose();field.dispose();}
}
