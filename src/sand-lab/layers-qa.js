import {shapeHeight} from './sand-shape.js';
import {moisture} from './sand.js';
import {sandAdhesion} from './sand-material.js';

// Explicit diagnostic fixtures only; never run on scene startup or saved edits.
export function installSandLayersQA({lab,camera,controls,panel,results,reset}){
 const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];let base,top;
 const finish=label=>{
  lab.sand.update();lab.syncUniforms();lab.revision++;
  results.textContent=JSON.stringify({fixture:label,sandBackend:'CPU',waterBackend:lab.gpu.cpu?'CPU reference':'GPU',massError:lab.sand.totalMass()-lab.sand.initialMass,clumps:lab.sand.parcels.length,
   base:base&&{position:base.position,wet:base.wet},top:top&&{position:top.position,wet:top.wet,memory:top.memory,aspect:top.aspect,anchored:top.anchored,adhesion:sandAdhesion(top.wet,top.memory),height:shapeHeight(top)}},null,2);
 };
 const run=(seconds,water=air)=>{for(let i=0;i<Math.ceil(seconds*30);i++)lab.sand.step(1/30,water,calm,lab.spec.scale,0,lab.spacing);};
 const actions=[
  ['Dry layer on wet sand',()=>{
   reset();lab.paused=true;lab.wind=0;const bed=lab.sand;
   const y=bed.height(0,3.5),make=(position,r,wet)=>{const p={id:bed.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*.56,packing:.56,wet,memory:wet};bed.parcels.push(p);return p;};
   base=make([0,y+.28,3.5],.32,.95);bed.deposit(base,base.mass);top=make([0,y+1,3.5],.19,0);bed.initialMass=bed.totalMass();
   camera.position.set(1.25,y+1.2,5);controls.target.set(0,y+.48,3.5);camera.lookAt(controls.target);
   run(8);finish('dry loose layer resting on wet sand');
  }],
  ['Soak loose layer 15 s',()=>{if(!top)return;const level=base.position[1]+.15;run(15,q=>({density:q[1]>level?1:0,velocity:[0,0,0]}));finish('loose surface has become wet and bonded');}],
  ['Dry layers 2 hours',()=>{if(!top)return;for(let i=0;i<480;i++){for(const p of lab.sand.parcels)p.wet=moisture(p.wet,false,15);lab.sand.stepParcels(.03,air,calm,lab.spec.scale,0,lab.spacing);}finish('both layers dry; retained shape and reduced adhesion');}],
  ['Wet compaction stress test',()=>{
   reset();lab.paused=true;lab.wind=0;const bed=lab.sand;bed.wet.fill(.95);bed.memory.fill(.95);bed.update();const times=[];
   for(let i=0;i<120;i++){const t=performance.now(),x=.1*Math.sin(i*.1);bed.push([x,bed.height(x,3),3],.35,[0,-.6,1],.09);bed.step(1/30,air,calm,lab.spec.scale);times.push(performance.now()-t);}
   camera.position.set(1.8,2.7,4.2);controls.target.set(0,1.1,3);camera.lookAt(controls.target);base=top=null;finish('120 compaction strokes');
   const report=JSON.parse(results.textContent);times.sort((a,b)=>a-b);results.textContent=JSON.stringify({...report,cpuSandMedianMs:times[60],cpuSandP95Ms:times[114],cuts:bed.parcels.reduce((n,p)=>n+(p.cuts?.length||0),0)},null,2);
  }]
 ];
 for(const [label,action] of actions){const b=document.createElement('button');b.textContent=label;b.onclick=action;panel.append(b);}
}
