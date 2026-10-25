import * as THREE from 'three';
import {SandLab} from '../src/sand-lab/lab.js';
import {LabFluidGPU} from '../src/sand-lab/water-lab-gpu.js';
import {LabTransportGPU} from '../src/sand-lab/transport-gpu.js';
import {StepReadback} from '../src/sand-lab/gpu-step-readback.js';
import {verifyRTXPressure,getRTXPressure,rtxPressureFixtures} from '../src/rtx-sand-lab/verify.js';
import {solveDensityCPU} from '../src/sand-lab/density-cpu.js';
import {pressureComparison} from '../src/sand-lab/bounded-pressure-model.js';
const button=document.querySelector('#run'),out=document.querySelector('#result');
button.onclick=async()=>{
 button.disabled=true;let r,gpu,transport,readback,lab;
 try{
  r=new THREE.WebGLRenderer({canvas:document.querySelector('#view'),antialias:false});r.autoClear=false;
  r.debug.onShaderError=(gl,p,v,f)=>{throw Error(gl.getProgramInfoLog(p)||gl.getShaderInfoLog(f));};
  out.textContent='Validating bounded GPU arithmetic…';const validation=await verifyRTXPressure(r);if(!validation.pass)throw Error(JSON.stringify(validation));
  lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true});
  gpu=new LabFluidGPU(r,lab.u);gpu.allowGPUObjectContacts=true;gpu.uniforms.uPackedGpuNeighbors.value=true;gpu.packedNeighbors=true;gpu.boundedPressure=getRTXPressure(r);gpu.contactGeometry=lab;lab.optimizations.gpuPressure=true;
  transport=new LabTransportGPU(r);readback=new StepReadback(r);const rows=[];
  for(const f of rtxPressureFixtures(lab).slice(0,2)){
   const p=f.positions,n=p.length/4,zeros=new Float32Array(p.length),collide=f.collide,boundary=f.boundary;
   gpu.deferBoundedRead=false;const syncStart=performance.now(),sync=gpu.solve(p,f.spacing,collide,3,boundary,false,true);
   transport.solve(p,p,zeros,zeros,gpu.neighbors,f.spacing,10,1/30,p,gpu,true);const packed=readback.read(gpu,transport,n);
   const expected={positions:sync.slice(),velocity:packed.transport.velocities.slice(),chem:packed.transport.chem.slice(),metrics:packed.transport.metrics.slice()},syncMs=performance.now()-syncStart;
   gpu.deferBoundedRead=true;const asyncStart=performance.now();gpu.solve(p,f.spacing,collide,3,boundary,false,true);
   const deferred=typeof gpu.finishDeferredPressure==='function';
   transport.solve(p,p,zeros,zeros,gpu.neighbors,f.spacing,10,1/30,p,gpu,true);
   const promise=readback.read(gpu,transport,n,null,true),submitMs=performance.now()-asyncStart;
   const actual=await promise;gpu.finishDeferredPressure?.(actual.positions);
   let packedError=0;for(const [a,b] of [[actual.positions,expected.positions],[actual.transport.velocities,expected.velocity],[actual.transport.chem,expected.chem],[actual.transport.metrics,expected.metrics]])for(let i=0;i<a.length;i++)packedError=Math.max(packedError,Math.abs(a[i]-b[i]));
   const cpu=solveDensityCPU(p,gpu.neighbors,f.spacing,3,collide,boundary),comparison=pressureComparison(actual.positions,cpu,p,f.spacing);
   rows.push({fixture:f.name,particles:n,deferred,packedError,...comparison,syncMs,submitMs,totalAsyncMs:performance.now()-asyncStart,packedReadbacks:readback.calls,pressureReadbacks:gpu.boundedPressure.last.readbacks});
  }
  out.textContent=JSON.stringify({pass:rows.every(x=>x.pass&&x.deferred&&x.packedError<1e-6&&x.pressureReadbacks===0),rows,note:'Small numerical fixtures; timings are not RTX full-scene throughput measurements.'},null,2);
 }catch(e){out.textContent=e.stack||String(e);}
 finally{gpu?.dispose();transport?.dispose();readback?.dispose();lab?.gpu.dispose();r?.dispose();}
};
