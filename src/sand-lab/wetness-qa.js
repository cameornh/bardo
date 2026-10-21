import {sandMaterial,sandMobility} from './sand-material.js';

// Explicit fixture: same mass, support and height, varying only saturation.
export function installWetnessQA({lab,camera,controls,panel,results}){
 let portions=[];
 const report=()=>{lab.sand.update();lab.syncUniforms();lab.revision++;results.textContent=JSON.stringify({fixture:'wetness spectrum',backend:'CPU sand / GPU rendering',massError:lab.sand.totalMass()-lab.sand.initialMass,portions:portions.map(p=>({id:p.id,wetness:p.wet,memory:p.memory,mass:p.mass,aspect:p.aspect||1,position:p.position,mobility:sandMobility(p.wet,p.memory),...sandMaterial(p.wet,p.memory)}))},null,2);};
 for(const [label,action] of [
  ['Wetness spectrum fixture',()=>{
   lab.configure('ocean');lab.paused=true;lab.wind=0;lab.rain.enabled=false;
   for(const id of ['wind']){panel.querySelector('#'+id).value='0';panel.querySelector('#'+id).oninput();}
   panel.querySelector('#rain').checked=false;panel.querySelector('#pause').textContent='Resume';
   portions=[0,.05,.15,.3,.45,.6,.8,1].map((wet,i)=>({id:lab.sand.nextId++,position:[(i-3.5)*.62,2.7,3.75],velocity:[0,0,0],mass:4*Math.PI/3*.19**3*.56,packing:.56,wet,memory:wet}));
   lab.sand.parcels.push(...portions);lab.sand.initialMass=lab.sand.totalMass();
   camera.position.set(.1,4.2,9.3);controls.target.set(0,1.9,3.75);camera.lookAt(controls.target);report();
  }],
  ['Settle wetness spectrum 4 s',()=>{
   if(!portions.length||!portions.some(p=>lab.sand.parcels.includes(p)))return;
   lab.paused=true;panel.querySelector('#pause').textContent='Resume';
   for(let i=0;i<120;i++)lab.sand.step(1/30,()=>({density:0,velocity:[0,0,0]}),()=>[0,0,0],lab.spec.scale,0,lab.spacing);
   report();
  }]
 ]){const button=document.createElement('button');button.textContent=label;button.onclick=action;panel.append(button);}
}
