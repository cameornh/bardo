import * as THREE from 'three';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
import {FieldSliceView} from '../src/fluid-fields/view.js';
const lab=new LiveSandLab({extensions:{has:()=>false}},{physicalResolution:true,boulders:true,bulkFields:true});lab.resolutions.ocean=1;lab.configure('ocean');lab.wind=5;lab.tidesEnabled=false;lab.lunarCycle=false;lab.detail.enabled=false;
const $=id=>document.getElementById(id),view=new FieldSliceView($('slice'),$('legend'));view.key='gauge';view.axis=0;view.slice=.5;let busy=false;
function display(){if(lab.bulkFields.grid)view.draw(lab.bulkFields.grid);}
async function run(n){if(busy)return;busy=true;const initial=lab.count,times=[];
 try{for(let i=0;i<n;i++){const start=performance.now();lab.step(lab.timestep);times.push(performance.now()-start);display();await new Promise(requestAnimationFrame);}
  $('result').textContent=JSON.stringify({pass:lab.count===initial&&lab.positions.every(Number.isFinite)&&lab.bulkFields.stats.relativeResidual<1e-3,time:lab.time,count:lab.count,stats:lab.bulkFields.stats,stepMilliseconds:times,temperatureRange:[Math.min(...lab.bulkFields.grid.temperature),Math.max(...lab.bulkFields.grid.temperature)],humidityRange:[Math.min(...lab.bulkFields.grid.humidity),Math.max(...lab.bulkFields.grid.humidity)]},null,2);
 }catch(error){$('result').textContent=String(error.stack||error);}finally{busy=false;}
}
$('step').onclick=()=>run(1);$('run').onclick=()=>run(12);$('value').onchange=e=>{view.key=e.target.value;display();};$('slice').onpointermove=e=>{if(!lab.bulkFields.grid)return;view.hover=view.cellFromEvent(e,lab.bulkFields.grid);$('hover').textContent=view.readout(lab.bulkFields.grid,view.hover);};
$('gpu').onclick=async()=>{if(busy)return;busy=true;$('gpu').disabled=true;let renderer;
 try{renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(8,8);renderer.setClearColor(0x713d29);renderer.debug.onShaderError=()=>{throw Error('Small field shader failed; stopped');};lab.renderer=renderer;const result=await lab.bulkFields.verify();$('result').textContent=JSON.stringify({...result,contextLost:renderer.getContext().isContextLost()},null,2);}
 catch(error){$('result').textContent=String(error.stack||error);}finally{lab.bulkFields.gpu?.dispose();lab.bulkFields.gpu=null;renderer?.dispose();busy=false;}
};
