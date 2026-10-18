import {shapeHeight,cutShape} from './sand-shape.js';
import {moisture} from './sand.js';
import {sandAdhesion} from './sand-material.js';
import {sandFeet} from './sand-support.js';

// Explicit diagnostic fixtures only; never run on scene startup or saved edits.
export function installSandLayersQA({lab,camera,controls,panel,results,reset}){
 const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];let base,top;
 const finish=label=>{
  const pause=panel.querySelector('#pause');if(pause)pause.textContent=lab.paused?'Resume':'Pause';
  const wind=panel.querySelector('#wind'),windValue=panel.querySelector('#wind-value');if(wind)wind.value=String(lab.wind);if(windValue)windValue.textContent=String(lab.wind);
  lab.sand.update();lab.syncUniforms();lab.revision++;
  results.textContent=JSON.stringify({fixture:label,sandBackend:'CPU',waterBackend:lab.gpu.cpu?'CPU reference':'GPU',massError:lab.sand.totalMass()-lab.sand.initialMass,clumps:lab.sand.parcels.length,
   base:base&&{position:base.position,wet:base.wet,mass:base.mass},top:top&&{position:top.position,wet:top.wet,memory:top.memory,aspect:top.aspect,anchored:top.anchored,adhesion:sandAdhesion(top.wet,top.memory),height:shapeHeight(top),groundGap:Math.min(...sandFeet(top).map(f=>top.position[1]+f[1]-lab.sand.height(top.position[0]+f[0],top.position[2]+f[2])))}},null,2);
 };
 const run=(seconds,water=air)=>{for(let i=0;i<Math.ceil(seconds*30);i++)lab.sand.step(1/30,water,calm,lab.spec.scale,0,lab.spacing);};
 const actions=[
  ['Dry layer on wet sand',()=>{
   reset();lab.paused=true;lab.wind=0;const bed=lab.sand;
   const z=4.3,y=bed.height(0,z),make=(position,r,wet)=>{const p={id:bed.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*.56,packing:.56,wet,memory:wet};bed.parcels.push(p);return p;};
   base=make([0,y+.28,z],.32,.95);bed.deposit(base,base.mass);top=make([0,y+1,z],.19,0);bed.initialMass=bed.totalMass();
   camera.position.set(1.25,y+1.2,z+1.5);controls.target.set(0,y+.48,z);camera.lookAt(controls.target);
   finish('dry sand suspended above wet sand — Resume to watch the drop');
  }],
  ['Drop another dry handful',()=>{
   if(!base)return;const bed=lab.sand,y=Math.max(...bed.parcels.map(p=>p.position[1]+shapeHeight(p)));
   top={id:bed.nextId++,position:[base.position[0],y+.6,base.position[2]],velocity:[0,0,0],mass:4*Math.PI/3*.19**3*.56,packing:.56,wet:0,memory:0};bed.parcels.push(top);bed.initialMass=bed.totalMass();lab.paused=true;finish('another loose dry handful ready to drop');
  }],
  ['Soak loose layer 15 s',()=>{if(!top)return;const level=base.position[1]+.15;run(15,q=>({density:q[1]>level?1:0,velocity:[0,0,0]}));finish('loose surface has become wet and bonded');}],
  ['Dry layers 2 hours',()=>{if(!top)return;for(let i=0;i<480;i++){for(const p of lab.sand.parcels)p.wet=moisture(p.wet,false,15);lab.sand.stepParcels(.03,air,calm,lab.spec.scale,0,lab.spacing);}finish('both layers dry; retained shape and reduced adhesion');}],
  ['Mixed wet / dry drop',()=>{
   reset();lab.paused=true;lab.wind=0;const bed=lab.sand,y=bed.height(0,3.5),make=(position,r,wet)=>{const p={id:bed.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*.56,packing:.56,wet,memory:wet,batch:bed.nextBatch};bed.parcels.push(p);return p;};
   base=make([0,y+.9,3.5],.25,0);top=make([0,y+1.2,3.5],.22,.95);
   cutShape(top,[0,y+1,3.5],.25);bed.nextBatch++;bed.initialMass=bed.totalMass();
   camera.position.set(1.25,y+1.2,5);controls.target.set(0,y+.5,3.5);camera.lookAt(controls.target);finish('wet cap and loose dry support released; settle to inspect');
  }],
  ['Settle layers 8 s',()=>{if(!top)return;run(8);finish('sand after another 8 seconds');}],
  ['Wet compaction stress test',()=>{
   reset();lab.paused=true;lab.wind=0;const bed=lab.sand;bed.wet.fill(.95);bed.memory.fill(.95);bed.update();const times=[];
   for(let i=0;i<120;i++){const t=performance.now(),x=.1*Math.sin(i*.1);bed.push([x,bed.height(x,3),3],.35,[0,-.6,1],.09);bed.step(1/30,air,calm,lab.spec.scale);times.push(performance.now()-t);}
   camera.position.set(1.8,2.7,4.2);controls.target.set(0,1.1,3);camera.lookAt(controls.target);base=top=null;finish('120 compaction strokes');
   const report=JSON.parse(results.textContent);times.sort((a,b)=>a-b);results.textContent=JSON.stringify({...report,cpuSandMedianMs:times[60],cpuSandP95Ms:times[114],cuts:bed.parcels.reduce((n,p)=>n+(p.cuts?.length||0),0)},null,2);
  }]
 ];
 for(const [label,action] of actions){const b=document.createElement('button');b.textContent=label;b.onclick=action;panel.append(b);}
}
