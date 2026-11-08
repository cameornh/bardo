import {particleFixture} from '../particles/verify.js';
import {freshGrid} from '../connected/verify.js';
import {predictBeach} from '../../../sand-lab/beach-predict.js';
const error=(a,b)=>Math.max(0,...a.map((v,i)=>Math.abs(v-b[i])));
// Independent CPU predictor + original connected path versus persistent state.
// Reuse the same device sequentially; only 60 markers, no drawing or timers.
export async function verifyResident(p){
 const f=particleFixture({nx:5,ny:3,nz:4,objects:true,held:true}),lab=f.lab;lab.steps=0;lab.time=0;lab.wind=24;lab.windTurbulence=1;lab.reactiveWaves=true;lab.sampleFastSurface=i=>!lab.neighborCounts||lab.neighborCounts[i]<25;
 let state={positions:f.context.old.slice(),velocities:lab.velocities.slice(),chem:lab.chem.slice()},g=freshGrid(f.grid),rows=[];
 const enabled=p.residentEnabled;let resident=true;p.residentEnabled=()=>resident;
 try{for(let step=0;step<12;step++){
  lab.steps=step;lab.time+=f.context.dt;lab.velocities=state.velocities;lab.chem=state.chem;lab.neighborCounts=state.counts;
  if(step===3){state.positions[3]=1;state.positions[0]+=.12;lab.chem[5]=.6;lab.velocities[8]+=.1;}
  if(step===5){state.positions[3]=0;lab.jet={};}else lab.jet=null;
  if(step===8)g=freshGrid(g);
  lab.air={grid:g,sampleGrid:q=>g.sampleAirVelocity(q.map(v=>v*f.context.scale)).map(v=>v/f.context.scale)};
  const context={...f.context,old:state.positions.slice(),predicted:state.positions.slice(),generation:step<10?1:2};predictBeach(lab,context.old,context.predicted,context.dt);
  const referenceGrid=freshGrid(g);for(let a=0;a<3;a++)referenceGrid.faces[a].velocity.set(g.faces[a].velocity);
  const environment={solid:q=>lab.solid(q.map(v=>v/context.scale))*context.scale,wind:()=>[3,0,7],wall:()=>[0,0,0]};
  // Separate pipeline for reference avoids invalidating resident buffers.
  const ref=await p.reference.solve(context,lab,referenceGrid,{geometry:f.geometry,environment});p.reference.fields.commit(ref.fieldResult);
  const actual=await p.solve({...context,predictionDeferred:true},lab,g,{geometry:f.geometry,environment});p.fields.commit(actual.fieldResult);g.buildAirVelocity();
  const row={step,positions:error(ref.positions,actual.positions),velocities:error(ref.transport.velocities,actual.transport.velocities),chem:error(ref.transport.chem,actual.transport.chem),counts:error(ref.transport.counts,actual.transport.counts),residual:actual.fieldResult.relativeResidual,patched:actual.stats.patchedParticles,reset:actual.stats.reset};
  row.pass=row.positions<.0003&&row.velocities<.01&&row.chem<.0001&&row.counts===0;rows.push(row);if(!row.pass)throw Error('Resident comparison failed: '+JSON.stringify(row));
  state={positions:actual.positions,...actual.transport};
 }
 return {pass:true,rows};}finally{p.residentEnabled=enabled;}
}
