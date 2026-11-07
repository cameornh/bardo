import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BeachFieldGrid,AIR,WATER} from '../src/rtx-sand-lab/fields/grid.js';
import {FieldPressure,setPressureKernel} from '../src/rtx-sand-lab/fields/native-pressure.js';
import {solveMultigrid} from '../src/rtx-sand-lab/fields/multigrid.js';
await setPressureKernel(await readFile(new URL('../src/rtx-sand-lab/fields/kernels/pressure.wasm',import.meta.url)));
test('compiled pressure matches double-precision reference through topology and capacity changes',()=>{
 const solver=new FieldPressure();
 for(const dims of [[8,6,9],[18,10,16],[6,6,6]]){
  const g=new BeachFieldGrid({dims,h:1,origin:[0,0,0],extent:dims.map((n,k)=>n*(1+k*.13))});
  for(const waterHeight of [2,3]){
   const phase=Uint8Array.from(g.coords,c=>c[0]===2&&c[1]===1?0:c[1]<waterHeight?WATER:AIR);g.setPhase(phase);
   const rhs=Float64Array.from({length:g.count},(_,i)=>phase[i]?Math.sin(i*.31)*.1:0);
   for(const initial of [undefined,new Float64Array(g.count).fill(.001)]){
    const options={initial,tolerance:1e-7},expected=solveMultigrid(g.levels,rhs,options),actual=solver.solve(g.levels,rhs,options);
    assert.equal(actual.backend,'WebAssembly CPU multigrid-PCG');assert.ok(actual.relativeResidual<1e-7);
    assert.ok(Math.max(...actual.potential.map((v,i)=>Math.abs(v-expected.potential[i])))<1e-8);
    assert.equal(actual.iterations,expected.iterations);
   }
  }
 }
});
test('compiled pressure preserves the explicit diagonal CPU reference option',()=>{
 const grid=new BeachFieldGrid({dims:[4,4,4],h:1});grid.setPhase(new Uint8Array(64).fill(AIR));
 const result=new FieldPressure().solve(grid.levels,new Float64Array(64),{precondition:false});
 assert.equal(result.backend,'CPU diagonal-PCG');assert.equal(result.absoluteResidual,0);
});
