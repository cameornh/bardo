// No browser or graphics work. Run a reproducible 30-second resting beach.
// Usage: node tools/check-beach-field-rest.mjs [output.json]
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {configureRTXLab} from '../src/rtx-sand-lab/profile.js';
import {setDensityKernel} from '../src/sand-lab/native-density.js';
import {setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
import {setTransportKernel} from '../src/rtx-sand-lab/fields/native-transport.js';
import {setPressureKernel} from '../src/rtx-sand-lab/fields/native-pressure.js';
for(const [load,path] of [[setDensityKernel,'sand-lab/kernels/density.wasm'],[setNeighborKernel,'sand-lab/kernels/neighbors.wasm'],[setTransportKernel,'rtx-sand-lab/fields/kernels/transport.wasm'],[setPressureKernel,'rtx-sand-lab/fields/kernels/pressure.wasm']])await load(await readFile(new URL('../src/'+path,import.meta.url)));
const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});
configureRTXLab(lab);lab.resolutions.ocean=2.2;lab.configure('ocean');lab.wind=0;lab.reactiveWaves=true;lab.tidesEnabled=lab.lunarCycle=lab.detail.enabled=false;
const initialCount=lab.count,rows=[],timings=[];
function sample(){let energy=0,edgeEnergy=0,edgeCount=0,edgeMax=0,peak=0;
 for(let i=0;i<lab.count;i++){const o=i*4,speed=Math.hypot(lab.velocities[o],lab.velocities[o+1],lab.velocities[o+2])*lab.spec.scale;assert.ok(Number.isFinite(speed));for(let k=0;k<3;k++)assert.ok(Number.isFinite(lab.positions[o+k]));energy+=speed*speed;peak=Math.max(peak,speed);
  if(Math.abs(lab.positions[o])>5||Math.abs(lab.positions[o+2])>4.4){edgeEnergy+=speed*speed;edgeMax=Math.max(edgeMax,speed);edgeCount++;}}
 return {rmsMetersPerSecond:Math.sqrt(energy/lab.count),edgeRmsMetersPerSecond:Math.sqrt(edgeEnergy/edgeCount),edgeMaxMetersPerSecond:edgeMax,peakMetersPerSecond:peak};
}
for(let i=0;i<450;i++){const start=performance.now();lab.step(lab.timestep);timings.push(performance.now()-start);if(i%75===74){const row={step:i+1,seconds:lab.time,...sample(),pressureMs:lab.bulkFields.stats.milliseconds,pressureResidual:lab.bulkFields.stats.relativeResidual};rows.push(row);console.log(JSON.stringify(row));}}
const last=rows.at(-1);assert.equal(lab.count,initialCount);assert.ok(last.rmsMetersPerSecond<.25);assert.ok(last.edgeRmsMetersPerSecond<.1);assert.ok(last.edgeMaxMetersPerSecond<1);
timings.sort((a,b)=>a-b);const result={pass:true,backend:lab.bulkFields.stats.backend,graphicsWork:false,wind:0,tides:false,particles:lab.count,spacingMeters:lab.spacing*lab.spec.scale,rows,medianStepMs:timings[225],p95StepMs:timings[427]};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');else console.log(JSON.stringify(result,null,2));
