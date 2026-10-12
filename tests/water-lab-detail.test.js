import test from 'node:test';import assert from 'node:assert/strict';
import {WaterLab} from '../src/water-lab.js';
import {LAB_PRESETS,buildNeighbors,seedWater,diffuseChemistry} from '../src/water-lab-model.js';
import {transportFluid,physicalCoefficients} from '../src/water-lab-transport.js';
import {LabDetail,detailRadius,detailStep} from '../src/water-lab-detail.js';
import {refineWater,resolutionPlan} from '../src/water-lab-resolution.js';
const mock={extensions:{has:()=>false}};
test('scene enlargement refines normalized spacing until the visible resolution budget is reached',()=>{
 const lab=new WaterLab(mock);lab.configure('pool');const h=lab.spacing*lab.spec.scale,coarse=lab.count;
 lab.configure('pool',1.25);assert.ok(lab.count>coarse);assert.ok(Math.abs(lab.spacing*lab.spec.scale-h)<1e-8);assert.equal(lab.resolutionInfo.limited,false);
 lab.configure('pool',10);assert.ok(lab.count<=lab.particleBudget);assert.equal(lab.resolutionInfo.limited,true);assert.ok(lab.spacing>=.11);
 lab.configure('glass',.1);assert.ok(lab.timestep<.001);
 const small=physicalCoefficients(.19,.0025,.0001),large=physicalCoefficients(.19,.25,.0001);assert.ok(small.viscosity>large.viscosity*1000);assert.ok(small.capillary>large.capillary*1e5);
 for(const preset of Object.values(LAB_PRESETS)){const plan=resolutionPlan(preset,2000,10,3,32768);assert.ok(2000*plan.factor**3<=32768);assert.ok(preset.spacing/plan.factor>=.11-1e-10);}
});
test('refinement fills the same occupied volume with smaller equal-volume parcels',()=>{
 const base=[];for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)base.push({p:[x*.2,y*.2,z*.2],v:[1,2,3]});
 const fine=refineWater(base,.2,2);assert.equal(fine.length,base.length*8);
 assert.ok(Math.abs(fine.length*.1**3-base.length*.2**3)<1e-10);
 for(const p of fine){assert.ok(p.p.every(v=>v>=-.1&&v<=.5));assert.deepEqual(p.v,[1,2,3]);}
 const lab=new WaterLab(mock);lab.configure('waterfall');assert.ok(lab.count>seedWater('waterfall').length*3);assert.ok(lab.count<=lab.particleBudget);
});
test('merged transport retains reciprocal solute diffusion and held points',()=>{
 const p=new Float32Array(6*4),c=p.slice(),v=p.slice();for(let i=0;i<6;i++){p.set([i*.2,1,0,0],i*4);c.set([i/10,i/20,i/30,0],i*4);}p[3]=1;
 const neighbors=buildNeighbors(p,.23).data,expected=diffuseChemistry(c,neighbors,p,.23,.01),result=transportFluid(p,p,v,c,neighbors,.23,1,.01);
 for(let i=0;i<6;i++)for(let k=0;k<3;k++)assert.ok(Math.abs(expected[i*4+k]-result.chem[i*4+k])<1e-6);
 assert.deepEqual(Array.from(result.velocities.slice(0,3)),[0,0,0]);assert.equal(result.metrics[3],0);
});
function surfaceFlow(velocity,incoming=velocity){
 const p=[];for(let y=0;y<3;y++)for(let z=-2;z<=2;z++)for(let x=-2;x<=2;x++)p.push(x*.2,1+y*.2,z*.2,0);
 const next=new Float32Array(p),old=next.slice(),v=next.slice().fill(0),predicted=next.slice(),c=v.slice(),dt=.01;
 for(let i=0;i<p.length;i+=4){const current=velocity(...p.slice(i,i+3)),before=incoming(...p.slice(i,i+3));for(let k=0;k<3;k++){old[i+k]-=current[k]*dt;v[i+k]=before[k];predicted[i+k]=old[i+k]+before[k]*dt;}}
 const result=transportFluid(old,next,v,c,buildNeighbors(next,.23).data,.23,1,dt,predicted);
 return Math.max(...Array.from(result.metrics).filter((_,i)=>i%4===3));
}
test('translation, free fall and rigid rotation do not create whitewater by speed alone',()=>{
 for(const velocity of [()=>[0,0,0],()=>[12,0,0],()=>[0,-15,0],(x,y)=>[-y*8,x*8,0],(x)=>[x*.1,0,0]])assert.equal(surfaceFlow(velocity),0);
});
test('strong surface deformation and an impact independently generate whitewater',()=>{
 assert.ok(surfaceFlow(x=>[x*12,0,0])>.5);
 assert.ok(surfaceFlow(()=>[0,-1,0],()=>[0,-8,0])>1);
});
test('fine Gaussian emission is dense, bounded and does not create liquid volume or solutes',()=>{
 const lab=new WaterLab(mock);lab.configure('pool');const volume=lab.volume,chem=lab.chem.slice();lab.surfaceMetrics=new Float32Array(lab.count*4);for(let i=0;i<lab.count;i++)lab.surfaceMetrics.set([0,1,0,2],i*4);
 lab.detail.emit(lab,1/60);assert.ok(lab.detail.pending>100);assert.ok(lab.detail.pending<1500);assert.equal(lab.volume,volume);assert.deepEqual(lab.chem,chem);
 assert.ok(detailRadius(.36,600,.5)/600<.36*.08);assert.ok(detailRadius(.19,.0025,.5)<.001);
});
test('a small intense region receives most of the bounded emission budget',()=>{
 const count=1024,lab={count,spacing:.2,spec:{scale:1},positions:new Float32Array(count*4),velocities:new Float32Array(count*4),surfaceMetrics:new Float32Array(count*4)};
 for(let i=0;i<count;i++){const strong=i>=count-16;lab.positions[i*4]=strong?10:0;lab.surfaceMetrics.set([0,1,0,strong?5:.18],i*4);}
 const detail=new LabDetail(mock);detail.emit(lab,1/60);let strong=0,weak=0;
 for(let i=0;i<detail.pending;i++)if(detail.spawn[0].image.data[i*4]>5)strong++;else weak++;
 assert.ok(strong>800);assert.ok(strong>weak*20);assert.ok(detail.pending<1200);assert.ok(detail.budget.every(v=>v<1));detail.dispose();
});
test('recirculated emitters do not draw spray bridges back to their previous location',()=>{
 const count=128,lab={count,spacing:.2,spec:{scale:1},time:.05,positions:new Float32Array(count*4),velocities:new Float32Array(count*4),surfaceMetrics:new Float32Array(count*4)};
 for(let i=0;i<count;i++)lab.surfaceMetrics.set([0,1,0,5],i*4);
 const detail=new LabDetail(mock);detail.emit(lab,1/60);assert.ok(detail.pending>0);detail.pending=0;
 for(let i=0;i<count;i++)lab.positions[i*4]=50;lab.time+=1/60;detail.emit(lab,1/60);assert.ok(detail.pending>0);
 for(let i=0;i<detail.pending;i++)assert.ok(detail.spawn[0].image.data[i*4]>49.5);
 detail.dispose();
});
test('emission stays coherent through a brief lull, rejects solid boundaries and makes falling spray ballistic',()=>{
 const count=128,lab={count,spacing:.2,spec:{scale:1},positions:new Float32Array(count*4),velocities:new Float32Array(count*4),surfaceMetrics:new Float32Array(count*4),solid:()=>1};
 for(let i=0;i<count;i++){lab.surfaceMetrics.set([0,1,0,3],i*4);lab.velocities[i*4+1]=-2;}
 const detail=new LabDetail(mock);detail.emit(lab,.05);assert.ok(detail.pending>0);
 for(let i=0;i<detail.pending;i++)assert.equal(detail.spawn[2].image.data[i*4+1],0);
 const before=detail.strength.reduce((a,b)=>a+b,0);lab.surfaceMetrics.fill(0);for(let i=0;i<count;i++)lab.surfaceMetrics[i*4+1]=1;
 detail.emit(lab,.01);const after=detail.strength.reduce((a,b)=>a+b,0);assert.ok(after<before&&after>before*.8);
 lab.solid=()=>0;detail.pending=0;detail.emit(lab,.01);assert.equal(detail.pending,0);assert.equal(detail.strength.reduce((a,b)=>a+b,0),0);detail.dispose();
});
test('free detail reacts to a wind ray and has a finite lifetime without any collision dependency',()=>{
 const a=detailStep([0,1,0],[0,0,0],0,1,.1,0,0,0,null,1,30),b=detailStep([0,1,0],[0,0,0],0,1,.1,0,0,0,{origin:[-1,1,0],direction:[1,0,0]},1,30);assert.ok(b.position[0]>a.position[0]);assert.ok(a.position[1]<1);
 const detail=new LabDetail(mock,256),lab={spec:{scale:1},time:0,wind:0,turbulence:0,radius:1,windStrength:0,jet:null};detail.pending=1;detail.spawn[0].image.data.set([0,1,0,0]);detail.spawn[1].image.data.set([0,0,0,.15]);detail.expiry[0]=.15;detail.advance(.1,lab);assert.equal(detail.count,1);detail.advance(.1,lab);assert.equal(detail.count,0);detail.reset();assert.equal(detail.count,0);detail.dispose();
});

test('neighbor cache rebuilds before motion can exhaust the support margin',()=>{
 const lab=new WaterLab(mock),gpu=lab.gpu,p=new Float32Array([0,1,0,0,.3,1,0,0]);
 const first=gpu.neighborList(p,.2);assert.equal(gpu.neighborReused,false);
 const close=p.slice();close[0]+=.01;assert.equal(gpu.neighborList(close,.2),first);assert.equal(gpu.neighborReused,true);
 close[0]+=.04;assert.notEqual(gpu.neighborList(close,.2),first);assert.equal(gpu.neighborReused,false);
 gpu.neighborList(new Float32Array(12),.2);assert.equal(gpu.neighborReused,false);
});
