// CPU-only benchmark. Optional argument: a checkout containing src/sand-lab.
// Never creates a graphics context, renders, or compiles a shader.
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=process.argv[2]||fileURLToPath(new URL('..',import.meta.url)),{SandLab}=await import(pathToFileURL(resolve(root,'src/sand-lab/lab.js')));
const forbidden=()=>{throw new Error('Graphics call in CPU benchmark');};
const lab=new SandLab({extensions:{has:()=>true},render:forbidden,compileAsync:forbidden,getRenderTarget:forbidden,setRenderTarget:forbidden,readRenderTargetPixels:forbidden});
lab.wind=0;lab.tidesEnabled=false;lab.lunarCycle=false;lab.objectRadius=.3;lab.sand.wet.fill(.8);lab.sand.extract([0,lab.sand.height(0,3),3],.3,[0,0,0],true);
for(let i=0;i<6;i++)lab.spawn('glass',[-2+i*.8,1.6,3],[0,-1,0],i%2?'cup':'sphere');
const rows=[];
for(let i=0;i<12;i++){
 const t=performance.now(),c=lab.prepareStep(1/60),t2=performance.now(),p=lab.gpu.solve(c.predicted,c.s,p=>lab.collide(p),3,p=>lab.solid(p),false,true),t3=performance.now();
 if(!lab.gpu.cpuContacts||!p.every(Number.isFinite))throw new Error('Invalid CPU result');
 lab.positions=p;lab.fluidIndex=null;rows.push({prepare:t2-t,solve:t3-t2,neighbors:lab.gpu.neighborMs});
}
const mean=key=>rows.slice(3).reduce((sum,row)=>sum+row[key],0)/9;
console.log(JSON.stringify({samples:lab.count,objects:lab.balls.length,warmupSteps:3,measuredSteps:9,backend:lab.gpu.constraintBackend,meanMs:{prepare:mean('prepare'),solve:mean('solve'),neighbors:mean('neighbors')},rows},null,2));
lab.gpu.dispose();
