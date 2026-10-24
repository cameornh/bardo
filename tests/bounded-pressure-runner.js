import {verifyBoundedPressure} from '../src/sand-lab/bounded-pressure-verify.js';
import * as THREE from 'three';
import {BoundedPressureGPU} from '../src/sand-lab/bounded-pressure-gpu.js';
import {densityKernelReady,NativeDensity} from '../src/sand-lab/native-density.js';
import {neighborKernelReady} from '../src/sand-lab/native-neighbors.js';
import {createLabRenderer,installGraphicsGuard} from '../src/sand-lab/graphics-health.js';
import {SandLab} from '../src/sand-lab/lab.js';
const status=document.getElementById('status'),r=createLabRenderer(THREE.WebGLRenderer,{canvas:document.createElement('canvas')},error=>{status.textContent=error.message;});r.setSize(64,64,false);
const guard=installGraphicsGuard(r,error=>{status.textContent=error.message;}),gpu=new BoundedPressureGPU(r);
export async function validate(){
 const result=await verifyBoundedPressure(gpu);guard.assertHealthy();return result;
}

const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const stats=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return {meanMs:mean,minMs:Math.min(...values),maxMs:Math.max(...values),sdMs:Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length)};};
export async function benchmark(){
 if(!gpu.validated||guard.failed)return {pass:false,reason:'Small GPU validation required.'};
 await Promise.all([densityKernelReady,neighborKernelReady]);
 // The lab supplies CPU geometry only. Never instantiate WaterLabRenderer,
 // dispatch air/transport/detail, or compile the monolithic contact shaders.
 const lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true});
 Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true,adaptivePressure:true});lab.syncUniforms();
 const p=lab.positions.slice();for(let o=0;o<p.length;o+=4){p[o+1]-=.004;p[o]+=.002*Math.sin(o);}
 lab.gpu.nativeNeighbors=true;lab.gpu.packedNeighbors=true;lab.gpu.neighborBounds=true;
 const neighbors=lab.gpu.neighborList(p,lab.spacing).data,cpu=new NativeDensity(),times=[[],[]],rows=[];let maxError=0;
 try{
  // First one complete solve, then only six alternating measured pairs.
  for(let pair=0;pair<8;pair++){
   const outputs=[];
   for(const mode of pair%2?[1,0]:[0,1]){
    await yieldTask();guard.assertHealthy();status.textContent=`Pressure-only comparison ${pair+1}/8 · ${mode?'GPU':'CPU'}`;
    const start=performance.now();outputs[mode]=(mode?gpu:cpu).solve(p,neighbors,lab.spacing,3,q=>lab.collide(q),q=>lab.solid(q),lab);const elapsed=performance.now()-start;
    if(gpu.stopped)return {pass:false,reason:gpu.stopped,last:gpu.last,rows};
    if(pair>=2)times[mode].push(elapsed);if(mode)rows.push({...gpu.last});
   }
   for(let o=0;o<p.length;o++)maxError=Math.max(maxError,Math.abs(outputs[0][o]-outputs[1][o]));
  }
  const [cpuTime,gpuTime]=times.map(stats);return {pass:true,description:'Pressure and beach contacts only, including GPU transfers. Not whole-scene FPS.',particles:lab.count,backend:gpu.backend,cpu:cpuTime,gpu:gpuTime,speedup:cpuTime.meanMs/gpuTime.meanMs,maxError,rows};
 }finally{lab.gpu.dispose();}
}

export async function trajectory(){
 if(!gpu.geometryValidated||guard.failed)return {pass:false,reason:'Small GPU validation required.'};
 const {transportFluid}=await import('../src/sand-lab/water-lab-transport.js'),{predictBeach}=await import('../src/sand-lab/beach-predict.js'),{NativeNeighbors}=await import('../src/sand-lab/native-neighbors.js');
 await neighborKernelReady;
 const rows=[];let maxPositionError=0,meanPositionError=0;
 const outputs=[];
 for(const mode of [0,1]){
  const lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true});lab.resolutions.ocean=1.4;lab.configure('ocean');lab.wind=0;lab.air.grid=null;lab.tidesEnabled=false;
  Object.assign(lab.optimizations,{batchedContacts:true,nativeSandContacts:true,adaptivePressure:false});lab.syncUniforms();
  const solver=mode?gpu:new NativeDensity(),neighbors=new NativeNeighbors();let peakSpeed=0,minClearance=Infinity;const times=[];
  for(let i=0;i<lab.count;i++){const o=i*4;if(Math.hypot(lab.positions[o],lab.positions[o+2]+1)<.6)lab.velocities[o]=.3;}
  try{
   for(let step=0;step<60;step++){
    await yieldTask();guard.assertHealthy();status.textContent=`Four-second coupled simulation · ${mode?'GPU':'CPU'} · ${step+1}/60`;
    const dt=lab.timestep,old=lab.positions,predicted=old.slice();predictBeach(lab,old,predicted,dt);const list=neighbors.build(predicted,lab.spacing).data;
    const start=performance.now(),next=solver.solve(predicted,list,lab.spacing,3,p=>lab.collide(p),p=>lab.solid(p),lab);times.push(performance.now()-start);
    if(gpu.stopped)throw Error(gpu.stopped);
    const t=transportFluid(old,next,lab.velocities,lab.chem,list,lab.spacing,lab.spec.scale,dt,predicted);
    lab.positions=next;lab.velocities=t.velocities;lab.chem=t.chem;lab.neighborCounts=t.counts;lab.surfaceMetrics=t.metrics;
    for(let o=0;o<next.length;o+=4){if(!Number.isFinite(next[o]+next[o+1]+next[o+2]))throw Error('Nonfinite trajectory.');minClearance=Math.min(minClearance,lab.solid(Array.from(next.slice(o,o+3))));peakSpeed=Math.max(peakSpeed,Math.hypot(...t.velocities.slice(o,o+3)));}
   }
   const y=Array.from({length:lab.count},(_,i)=>lab.positions[i*4+1]).sort((a,b)=>a-b);outputs.push(lab.positions);
   rows.push({backend:mode?gpu.backend:'Full WebAssembly CPU reference',count:lab.count,volume:lab.count*lab.spacing**3,meanHeight:y.reduce((s,v)=>s+v,0)/y.length,upperHeight:y[Math.floor(y.length*.95)],peakSpeed,minClearance,pressureTime:stats(times)});
  }finally{lab.gpu.dispose();}
 }
 for(let i=0;i<outputs[0].length;i++){const e=Math.abs(outputs[0][i]-outputs[1][i]);maxPositionError=Math.max(maxPositionError,e);meanPositionError+=e/outputs[0].length;}
 const pass=rows[0].volume===rows[1].volume&&Math.abs(rows[0].meanHeight-rows[1].meanHeight)<.025&&Math.abs(rows[0].upperHeight-rows[1].upperHeight)<.05&&rows[1].peakSpeed<rows[0].peakSpeed*1.5&&rows[1].minClearance>-.025;
 return {pass,description:'60 coupled pressure/prediction/transport steps, four simulated seconds. CPU transport in both paths. Camera-independent.',rows,maxPositionError,meanPositionError};
}
