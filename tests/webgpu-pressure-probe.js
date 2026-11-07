import {pressureFixture,packPressure,referencePressure,pressureReport,probeWebGPU,PROBE_LIMITS} from '../src/webgpu-probe/pressure.js';
const $=id=>document.getElementById(id),fixture=pressureFixture(),packed=packPressure(fixture.operator,fixture.rhs);let abort;
function showSlice(values){
 const context=$('slice').getContext('2d'),image=context.createImageData(8,6),range=Math.max(.001,...values.map(Math.abs));
 for(let y=0;y<6;y++)for(let x=0;x<8;x++){const cell=x+8*(y+6*3),v=values[cell]/range,i=(x+(5-y)*8)*4;image.data.set(fixture.grid.phase[cell]?[Math.max(0,v)*255,80+80*(1-Math.abs(v)),Math.max(0,-v)*255,255]:[25,25,25,255],i);}
 context.putImageData(image,0,0);
}
function reference(){const start=performance.now(),values=referencePressure(packed);showSlice(values);return {values,ms:performance.now()-start};}
$('cpu').onclick=()=>{const cpu=reference();$('status').textContent='CPU reference complete. No GPU work was submitted.';$('result').textContent=JSON.stringify({backend:'CPU float32 reference',gpuValidated:false,cells:packed.n,iterations:32,milliseconds:cpu.ms,...pressureReport(fixture,cpu.values,cpu.values),limits:PROBE_LIMITS},null,2);};
$('stop').onclick=()=>abort?.abort();
$('gpu').onclick=async()=>{
 $('cpu').disabled=$('gpu').disabled=true;$('stop').disabled=false;abort=new AbortController();const cpu=reference();
 try{
  const gpu=await probeWebGPU(packed,{signal:abort.signal,onProgress:text=>$('status').textContent=text}),comparison=pressureReport(fixture,gpu.result,cpu.values);showSlice(gpu.result);
  $('status').textContent=comparison.pass?'WebGPU matches the CPU reference. Device released.':'Numerical comparison failed. Device released.';
  const {result,...metadata}=gpu;$('result').textContent=JSON.stringify({...metadata,gpuValidated:comparison.pass,...comparison,cpuMs:cpu.ms,limits:PROBE_LIMITS},null,2);
 }catch(error){$('status').textContent='GPU probe stopped. CPU result is shown.';$('result').textContent=JSON.stringify({backend:'CPU reference',gpuValidated:false,error:error.message,cells:packed.n,limits:PROBE_LIMITS},null,2);}
 finally{$('stop').disabled=true;$('cpu').disabled=false;/* A failed probe is never automatically retried. */}
};
