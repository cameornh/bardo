import test from 'node:test';
import assert from 'node:assert/strict';
import {boundaryMetric,collideBoundary,boundaryKernel,buildNeighbors,solveDensity} from '../src/sand-lab/water-lab-model.js';
const normal=[0,1/Math.hypot(1,.48),-.48/Math.hypot(1,.48)];
const plane=p=>p.reduce((s,v,k)=>s+v*normal[k],0);
const bound=p=>plane(p)*.65;
test('water contact distance is invariant to a conservative terrain SDF scale',()=>{
 for(const distance of [-.04,.01,.08,.2]){
  const p=normal.map(v=>v*distance),metric=boundaryMetric(p,bound);
  assert.ok(Math.abs(metric.distance-distance)<1e-10);
  const next=collideBoundary(p,.084,bound);
  assert.ok(Math.abs(plane(next)-Math.max(distance,.084))<1e-9);
  assert.ok(Math.abs(boundaryKernel(metric.distance,.4).density-boundaryKernel(distance,.4).density)<1e-10);
 }
});
test('near-shore density constraints do not depend on the terrain distance safety factor',()=>{
 const data=[];for(let z=0;z<4;z++)for(let y=0;y<3;y++)for(let x=0;x<4;x++)data.push(x*.16,y*.16+z*.08+.04,z*.16,0);
 const p=new Float32Array(data),s=.2,{data:neighbors}=buildNeighbors(p,s);
 const solve=f=>solveDensity(p,neighbors,s,3,q=>collideBoundary(q,s*.42,f),f);
 const a=solve(plane),b=solve(bound);
 for(let i=0;i<p.length;i++)assert.ok(Math.abs(a.positions[i]-b.positions[i])<2e-6);
 assert.ok(a.density.every(Number.isFinite));
});

import {boundaryShape,reconstructionKernel} from '../src/sand-lab/reconstruction.js';
test('flattened contact kernels spread volume tangentially without increasing their peak density',()=>{
 const radius=.17,volume=.008,base=reconstructionKernel({radius,volume});
 for(const clearance of [.005,.04,.12,.3,1]){
  const shape=boundaryShape(clearance,base.sigma),k=reconstructionKernel({radius:radius*shape.widen,volume,flatten:shape.flatten});
  assert.ok(Math.abs(k.amplitude-base.amplitude)<1e-9);
  assert.ok(k.sigma*k.ratio<=base.sigma+1e-10);
  assert.ok(Math.abs(k.sigma**3*k.ratio-base.sigma**3)<1e-10);
 }
});
