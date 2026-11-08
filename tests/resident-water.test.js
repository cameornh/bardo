import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,gridPlan,outputState,frameSchedule,LIMITS} from '../src/resident-water/model.js';
import {referenceStep} from '../src/resident-water/reference.js';

test('resident fixtures stay within fixed dispatch and storage budgets',()=>{
 for(const resolution of [1,1.4,2.2]){const f=fixture(resolution),g=gridPlan(f);assert.ok(f.positions.length/4<=LIMITS.particles);assert.ok(g.count<=LIMITS.cells);assert.ok(f.geometry.every(Number.isFinite));assert.equal(g.geometryOffset,g.faces*4+g.count);}
 assert.throws(()=>fixture(20));assert.throws(()=>fixture(NaN));
});
test('fixed clock never spends unearned time or catches up an unbounded backlog',()=>{
 for(const fps of [5,17,30,60,144]){let accumulator=0,time=0;for(let i=0;i<fps*5;i++){const s=frameSchedule(accumulator,1/fps,1/30);accumulator=s.accumulator;time+=s.steps/30;assert.ok(s.steps<=3);}assert.ok(time<=5+1e-8);if(fps>=17)assert.ok(time>=4.96);}
 assert.equal(frameSchedule(0,60,1/30).steps,3);assert.equal(frameSchedule(0,-1,1/30).steps,0);
});
test('CPU oracle projection lowers divergence and preserves finite conserved marker count',()=>{
 const f=fixture(1);const n=160;f.positions=f.positions.slice(0,n*4);f.velocities=f.velocities.slice(0,n*4);f.chem=f.chem.slice(0,n*4);
 for(let i=0;i<n;i++){f.velocities[i*4]=.2*Math.sin(i);f.chem[i*4]=.2;}
 let state=outputState(f);for(let i=0;i<3;i++){const r=referenceStep(f,state);state=r.state;assert.equal(state.length,n*20);assert.ok(state.every(Number.isFinite));assert.ok(r.divergence<r.before*.2+1e-5);for(let j=0;j<n;j++)assert.ok(state[j*20+8]>=0);}
});
