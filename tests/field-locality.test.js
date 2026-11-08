import test from 'node:test';
import assert from 'node:assert/strict';
import {BeachFieldGrid,AIR,WATER} from '../src/rtx-sand-lab/fields/grid.js';
import {FixedGridTopology} from '../src/rtx-sand-lab/fields/research/fixed-topology.js';
import {solveMultigrid} from '../src/rtx-sand-lab/fields/multigrid.js';
import {LOCAL_PRESSURE_WGSL} from '../src/rtx-sand-lab/fields/research/local-pressure.js';
import {installFieldLocality} from '../src/rtx-sand-lab/fields/locality.js';
import {particleFixture} from '../src/rtx-sand-lab/fields/particles/verify.js';
for(const dims of [[4,3,4],[7,4,5],[17,11,19]])test('fixed neighbors preserve every coefficient and gauge '+dims,()=>{
 const settings={dims,h:1.3,extent:[8,7,12]},a=new BeachFieldGrid(settings),b=new BeachFieldGrid(settings);b.topologyBuilder=new FixedGridTopology();
 for(let frame=0;frame<12;frame++){
  const phase=Uint8Array.from(a.coords,([x,y,z],i)=>frame%4===0?(x===0||y===0||z===0||x===dims[0]-1||y===dims[1]-1||z===dims[2]-1?0:WATER):(i+frame*7)%17<3?0:y<1+frame%3?WATER:AIR);
  a.setPhase(phase);b.setPhase(phase);
  assert.deepEqual(b.levels,a.levels);assert.deepEqual(b.closed,a.closed);assert.deepEqual(b.ledger,a.ledger);
  for(let k=0;k<3;k++)assert.deepEqual(b.faces[k].coefficient,a.faces[k].coefficient);
  const levels=b.levels,neighbors=b.topologyBuilder.neighbor;assert.equal(b.setPhase(phase),false);assert.equal(b.levels,levels);assert.equal(b.topologyBuilder.neighbor,neighbors);
 }
});
test('moving phases and reopening cavities preserve pressure solution',()=>{
 const a=new BeachFieldGrid({dims:[7,4,5],h:1}),b=new BeachFieldGrid({dims:[7,4,5],h:1});b.topologyBuilder=new FixedGridTopology();
 for(let t=0;t<5;t++){
  const phase=Uint8Array.from(a.coords,([x,y,z])=>x===3&&z>0&&t%2?0:y<2?WATER:AIR);a.setPhase(phase);b.setPhase(phase);
  const rhs=Float64Array.from({length:a.count},(_,i)=>phase[i]?Math.sin(i*.42+t)*.1:0);
  assert.deepEqual(solveMultigrid(b.levels,rhs).potential,solveMultigrid(a.levels,rhs).potential);
 }
});
test('coarse local shader retains global fine path and bounded storage',()=>{
 assert.match(LOCAL_PRESSURE_WGSL,/if\(n>256u\|\|c\[5\].w<.5\)\{relaxStorageLevel/);
 assert.match(LOCAL_PRESSURE_WGSL,/localX:array<f32,256>/);
 assert.match(LOCAL_PRESSURE_WGSL,/localNext:array<f32,256>/);
 assert.equal((LOCAL_PRESSURE_WGSL.match(/fn relaxLevel\(/g)||[]).length,1);
});
test('live switches preserve independent reference paths and update GPU configuration',()=>{
 const f=particleFixture(),lab={optimizations:{},bulkFields:{grid:f.grid}};
 installFieldLocality(lab);const fields=lab.bulkFields,builder=f.grid.topologyBuilder;
 assert.ok(builder instanceof FixedGridTopology);
 lab.optimizations.fieldTopology=false;fields.configureTopology(f.grid);assert.equal(f.grid.topologyBuilder,null);
 lab.optimizations.fieldTopology=true;fields.configureTopology(f.grid);assert.equal(f.grid.topologyBuilder,builder);
 const pipeline=fields.createConnectedPipeline(),gpuFields=pipeline.createFields();gpuFields.environment={solid:p=>p[1],wind:()=>[0,0,0],wall:()=>[0,0,0]};
 assert.equal(gpuFields.pack(f.context,f.lab,f.grid,f.geometry).fieldConfig[23],1);
 lab.optimizations.fieldLocalPressure=false;assert.equal(gpuFields.pack(f.context,f.lab,f.grid,f.geometry).fieldConfig[23],0);
 assert.equal(f.grid.topologyBuilder,builder);
});
