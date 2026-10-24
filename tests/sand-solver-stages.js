import {SandLab} from '../src/sand-lab/lab.js';
import {solveDensity,collideBoundary,WATER_CONTACT_SKIN} from '../src/sand-lab/water-lab-model.js';

// This page deliberately never creates a canvas or a WebGL context. Every
// graphics entry point throws, including readback and shader compilation.
const output=document.querySelector('#result'),button=document.querySelector('#checks');
const forbidden=()=>{throw new Error('Unexpected graphics call in CPU-only regression');};
const renderer={extensions:{has:()=>true},getRenderTarget:forbidden,setRenderTarget:forbidden,render:forbidden,compileAsync:forbidden,readRenderTargetPixels:forbidden};
button.onclick=async()=>{
 button.disabled=true;let lab;const rows=[];
 try{
  lab=new SandLab(renderer);lab.tidesEnabled=false;lab.lunarCycle=false;
  for(const kind of ['glass','mirror','rock','light'])for(const shape of ['sphere','cup']){
   output.textContent=`Checking ${kind} ${shape} on the CPU…`;await new Promise(requestAnimationFrame);
   lab.configure('ocean');lab.wind=0;lab.objectRadius=.3;lab.rain.enabled=false;
   lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);
   lab.sand.parcels[0].cuts=[{offset:[.02,.01,0],radius:.025}];lab.sand.update();
   const body=lab.spawn(kind,[-2,2,3],[0,-1,0],shape);body.tilt=.7;body.pitch=.3;
   const c=lab.prepareStep(1/60),start=performance.now();
   const actual=lab.gpu.solve(c.predicted,c.s,p=>lab.collide(p),3,p=>lab.solid(p),false,true),ms=performance.now()-start;
   if(!lab.gpu.cpuContacts||!lab.u.uSandCount.value||actual.length!==lab.count*4||!actual.every(Number.isFinite))throw new Error('Full-beach CPU contact check failed');
   const points=[];for(let z=-2;z<=2;z++)for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)points.push(body.position[0]+(x+.23)*.115,body.position[1]+(y+.31)*.115,body.position[2]+(z+.17)*.115,points.length%76===0?1:0);
   const p=new Float32Array(points),s=.12,solid=p=>lab.solid(p),collide=p=>collideBoundary(p,s*WATER_CONTACT_SKIN,solid);
   const result=lab.gpu.solve(p,s,collide,3,solid),reference=solveDensity(p,lab.gpu.neighbors,s,3,collide,solid).positions;
   let error=0;for(let i=0;i<result.length;i++)error=Math.max(error,Math.abs(result[i]-reference[i]));
   if(!Number.isFinite(error)||error>1e-6)throw new Error('CPU/reference mismatch: '+error);
   rows.push({kind,shape,samples:lab.count,sand:lab.u.uSandCount.value,ms:Math.round(ms),maxError:error});
  }
  output.textContent=JSON.stringify({pass:true,backend:'CPU object constraints',graphicsCalls:0,rows},null,2);
 }catch(error){output.textContent=JSON.stringify({pass:false,rows,error:error.stack},null,2);}
 finally{lab?.gpu.dispose();button.disabled=false;}
};
