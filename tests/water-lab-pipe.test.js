import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterLab} from '../src/water-lab.js';
import {pumpPipe, pipeTimestep, pipeStreamKernels, updatePipeStream} from '../src/water-lab-pipe.js';
import {pipeInlet} from '../src/water-lab-inlet.js';
import {LabBlobFamilies} from '../src/water-lab-blobs.js';
import {parcelDensity} from '../src/parcel-field.js';
import {densityAt} from '../src/water-lab-model.js';

test('coarse and fine laminar inlet stencils do not inject pressure pulses',()=>{
 for(const s of [.25,.2,.167,.14,.11]){
  const inlet=pipeInlet(s,1,2,0,0,0),p=new Float32Array(inlet.siteCount*5*4);
  for(let x=-2;x<=2;x++)for(let j=0;j<inlet.siteCount;j++){
   const q=pipeInlet(s,1,2,0,j,0).point;p.set([q[0]+x*inlet.layerSpacing,...q.slice(1),0],((x+2)*inlet.siteCount+j)*4);
  }
  assert.ok(densityAt(p,[-3.72,3.6,0],s)<1,`over-compressed inlet at spacing ${s}`);
 }
});

function fixture() {
 const count=1600, positions=new Float32Array(count*4), velocities=positions.slice(), chem=positions.slice();
 for(let i=0;i<count;i++)positions.set([(i%40)*.2-4,.2,Math.floor(i/40)*.2-4],i*4);
 return {kind:'pipe',count,positions,velocities,chem,spacing:.25,spec:{scale:1},flow:2,turbulence:0,time:0,pumpBudget:0,pumpCursor:0,inletSequence:0,pumped:0,solid:p=>p[1]};
}
function ballistic(lab,dt){
 lab.time+=dt;pumpPipe(lab,dt);
 for(const [i] of lab.pipeLayers||[]){const o=i*4;for(let k=0;k<3;k++)lab.positions[o+k]+=lab.velocities[o+k]*dt;lab.positions[o+1]-=.5*9.81*dt*dt;lab.velocities[o+1]-=9.81*dt;}
}
test('pipe discharge uses complete synchronous sections, independent of frame schedule',()=>{
 const a=fixture(),b=fixture();
 for(let i=0;i<100;i++)ballistic(a,.01);
 for(let i=0;i<50;i++){ballistic(b,.007);ballistic(b,.013);}
 assert.equal(a.inletSequence,b.inletSequence);
 assert.equal(a.inletSequence,5*Math.floor(pipeInlet(.25,1,2,0,0,0).rate/5));
 for(const [id,tag] of a.pipeLayers){const peer=[...b.pipeLayers].find(([,t])=>t.layer===tag.layer&&t.lane===tag.lane)?.[0];assert.notEqual(peer,undefined);for(let k=0;k<3;k++)assert.ok(Math.abs(a.positions[id*4+k]-b.positions[peer*4+k])<.1);}
 assert.equal(a.positions.length,1600*4);assert.ok(Math.abs(a.pumped-a.inletSequence*.25**3)<1e-12);
});
test('blocked and empty intakes do not create water or build a discharge burst',()=>{
 const a=fixture();a.positions.fill(3);a.time=1;pumpPipe(a,1);assert.equal(a.pumped,0);assert.ok(a.pumpBudget<=5);
 a.flow=0;pumpPipe(a,1);assert.equal(a.pumpBudget,0);
});
test('recirculation retains solutes and clears stale impact aeration at the pipe inlet',()=>{
 const a=fixture();a.chem.fill(.2);pumpPipe(a,.1);
 assert.ok(a.pipeLayers.size>0);
 for(const [id]of a.pipeLayers){assert.equal(a.chem[id*4+3],0);for(let k=0;k<3;k++)assert.ok(Math.abs(a.chem[id*4+k]-.2)<1e-7);}
});
test('pipe timestep keeps the requested inlet speed and gravity inside the displacement bound',()=>{
 for(const scale of [.1,1,10])for(const flow of [.1,1,2]){
  const a=fixture();a.spec.scale=scale;a.flow=flow;a.velocities.set([4/scale,-9/scale,0]);
  const dt=pipeTimestep(a),speed=Math.max(2*flow/scale,Math.hypot(4/scale,9/scale));
  assert.ok((speed+9.81/scale*dt)*dt<a.spacing*.45);assert.ok(dt>0&&dt<=1/30);
 }
});
test('thin connected pipe sections retain their volume and are not turned into daughter droplets',()=>{
 const a=fixture();for(let i=0;i<100;i++)ballistic(a,.01);
 const kernels=pipeStreamKernels(a);assert.ok(kernels.size>30);
 for(const [,items]of kernels)assert.ok(Math.abs(items.reduce((s,p)=>s+p.volume,0)-a.spacing**3)<1e-12);
 a.neighborCounts=new Uint16Array(a.count);const blobs=new LabBlobFamilies();blobs.update(a,kernels);a.time+=.1;blobs.update(a,kernels);
 for(const id of kernels.keys())assert.ok(!blobs.active.has(id));
 a.turbulence=2;assert.equal(pipeStreamKernels(a).size,0);
 a.kind='waterfall';a.turbulence=0;assert.equal(pipeStreamKernels(a).size,0);
});
test('contact, grabs and missing samples break stream reconstruction links',()=>{
 const a=fixture();for(let i=0;i<60;i++)ballistic(a,.01);
 const id=[...a.pipeLayers.keys()][15];a.positions[id*4+3]=1;updatePipeStream(a);assert.ok(!a.pipeLayers.has(id));
 const other=[...a.pipeLayers.keys()][0];a.positions[other*4+1]=.1;a.aerationActivity=new Float32Array(a.count*2);a.aerationActivity[other*2+1]=1;updatePipeStream(a);assert.ok(!a.pipeLayers.has(other));
 const last=[...a.pipeLayers.keys()].at(-1);a.positions[last*4]+=30;assert.ok(!pipeStreamKernels(a).has(last));
});
test('the actual CPU pipe solver retains a continuous laminar surface after startup at maximum flow',()=>{
 const lab=new WaterLab({extensions:{has:()=>false}});lab.turbulence=0;lab.flow=2;
 // Turn off visual-only auxiliaries; use the unchanged density/contact solver.
 lab.detail.emit=lab.detail.advance=lab.wetting.step=lab.air.update=()=>{};
 let checks=0,minimum=Infinity;
 while(lab.time<2){lab.step(lab.timestep);if(lab.time<1||lab.steps%20)continue;
  const reconstruction=pipeStreamKernels(lab),items=[];for(let i=0;i<lab.count;i++){const base={kind:'water',position:Array.from(lab.positions.subarray(i*4,i*4+3)),radius:lab.spacing*.65,volume:lab.spacing**3};for(const p of reconstruction.get(i)||[base])items.push({...base,...p});}
  const center=[...lab.pipeLayers].filter(([id,t])=>t.lane===2&&lab.positions[id*4+1]>.9).sort((a,b)=>a[1].layer-b[1].layer);
  for(let i=1;i<center.length;i++)if(center[i][1].layer===center[i-1][1].layer+1){const a=center[i-1][0]*4,b=center[i][0]*4;for(let j=0;j<9;j++){const t=j/8,p=[0,1,2].map(k=>lab.positions[a+k]*(1-t)+lab.positions[b+k]*t);minimum=Math.min(minimum,parcelDensity(items,p,'water').density);checks++;}}
 }
 assert.ok(checks>100);assert.ok(minimum>.18,`minimum liquid density ${minimum}`);assert.equal(lab.volume,lab.initialVolume);
});
