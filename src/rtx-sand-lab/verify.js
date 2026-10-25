import {SandLab} from '../sand-lab/lab.js';
import {RTXPressureGPU} from './pressure.js';
import {verifyBoundedPressure} from '../sand-lab/bounded-pressure-verify.js';
import {buildNeighbors} from '../sand-lab/water-lab-model.js';
import {solveDensityCPU} from '../sand-lab/density-cpu.js';
import {pressureComparison} from '../sand-lab/bounded-pressure-model.js';
import {makeBody} from '../sand-lab/objects.js';
import {rendererInfo} from './profile.js';

// One check per graphics context, no retry after failure. Never compile the
// historical monolithic pressure/CSG shader, even for a tiny validation fixture.
const checks=new WeakMap(),solvers=new WeakMap();
export const getRTXPressure=renderer=>solvers.get(renderer);
export function verifyRTXPressure(renderer){
 if(!checks.has(renderer))checks.set(renderer,run(renderer));
 return checks.get(renderer);
}

export function rtxPressureFixtures(lab){
 lab.sand.wet.fill(.8);
 const cup=makeBody('glass','cup',.26,[0,lab.sand.height(0,3)+.17,3]);cup.tilt=.63;cup.pitch=.41;
 lab.balls.push(cup);lab.setPlayer([.65,1.8,3],[0,0,0],.03,.17);lab.syncUniforms();
 const positions=new Float32Array(175*4),spacing=.14;
 for(let i=0;i<175;i++)positions.set([(i%7-3)*.115,cup.position[1]-.12+(Math.floor(i/7)%5)*.115,3+(Math.floor(i/35)-2)*.115,i%23===0?1:0],i*4);
 const contact={positions,spacing,collide:p=>lab.collide(p,spacing*.12),boundary:p=>lab.solid(p)};
 return [
  {...contact,name:'Free water and held samples',collision:false},
  {...contact,name:'Beach, boulders, tilted cup and player',collision:true},
  {...contact,name:'Edited sand contacts',collision:true,prepare(){
   const pieces=lab.sand.extract([0,lab.sand.height(0,3),3],.22,[0,0,0],false);
   for(const p of pieces){p.position[1]+=.2;p.wet=.9;p.memory=.9;}
   lab.sand.update();lab.syncUniforms();
  }},
 ];
}

async function run(renderer){
 const rows=[];let lab;
 try{
  const device=rendererInfo(renderer);
  if(!device.floatTargets)return {pass:false,device,reason:'Floating-point WebGL render targets unavailable.'};
  const gpu=new RTXPressureGPU(renderer);solvers.set(renderer,gpu);
  const split=await verifyBoundedPressure(gpu);
  if(!split.pass)return {...split,device};
  // Construct CPU state without submitting the full beach to the renderer.
  lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true});
  const fixtures=rtxPressureFixtures(lab);
  for(const f of fixtures){
   f.prepare?.();lab.syncUniforms();
   const neighbors=buildNeighbors(f.positions,f.spacing).data;
   const collide=f.collision?f.collide:undefined,boundary=f.collision?f.boundary:null;
   const start=performance.now(),actual=gpu.run(f.positions,neighbors,f.spacing,3,collide,boundary,f.collision?lab:null,true);
   const expected=solveDensityCPU(f.positions,neighbors,f.spacing,3,collide,boundary);
   const comparison=pressureComparison(actual,expected,f.positions,f.spacing);
   rows.push({name:f.name,particles:175,backend:gpu.backend,...comparison,ms:performance.now()-start});
   if(!comparison.pass){gpu.stop('GPU/CPU pressure comparison failed.');return {pass:false,device,rows,reason:gpu.stopped};}
   if(renderer.getContext().isContextLost())throw Error('Graphics context lost during validation.');
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {pass:true,device,split,rows};
 }catch(error){solvers.get(renderer)?.stop(error.message);return {pass:false,rows,reason:error.message};}
 finally{lab?.gpu.dispose();}
}
