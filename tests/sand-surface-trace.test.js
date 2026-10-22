import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSandBins,sandCell} from '../src/sand-lab/sand-bins.js';
import {shapeDistance,shapeBlend} from '../src/sand-lab/sand-shape.js';
import {traceSandSurface,sandRayInterval} from '../src/sand-lab/surface-trace.js';
const make=(position,r,aspect=1)=>({position,shapeRadius:r,aspect,mass:1,packing:.56});
const smooth=(a,b,k)=>Math.min(a,b)-Math.max(0,k-Math.abs(a-b))**2/(4*k);
function fixture(parcels){const bins=buildSandBins(parcels);return {...bins,distance:p=>{
 let d=p[1]+1;if(p.some((v,k)=>v<bins.min[k]||v>bins.max[k]))return d;
 const c=sandCell(p)*4;for(let j=0;j<bins.headers[c+1];j++){const q=parcels[bins.indices[bins.headers[c]+j]];d=smooth(d,shapeDistance(q,p),shapeBlend(q));}return d;
}};}
test('moving overlapping sand stays on the first surface, including sparse-bin boundaries',()=>{
 for(let i=0;i<60;i++){
  const x=-.45+i*.015,parcels=[make([x,1,0],.18),make([x+.15,1.02,.02],.13,.35)],f=fixture(parcels),o=[x+.1,1.01,2],d=[0,0,-1],hit=traceSandSurface(o,d,f);
  assert.ok(Number.isFinite(hit));const p=o.map((v,k)=>v+d[k]*hit);assert.ok(Math.abs(f.distance(p))<.00004);
  // Independently bracket the first crossing with a fine uniform scan.
  let reference=0;while(reference<3&&f.distance(o.map((v,k)=>v+d[k]*reference))>0)reference+=.0002;
  assert.ok(Math.abs(hit-reference)<.001,`${i}: ${hit} versus ${reference}`);
 }
});
test('flattened wide sand deposits are not missed by spherical bounds',()=>{
 const f=fixture([make([0,1,0],.5,.12)]),o=[.45,2,0],d=[0,-1,0],hit=traceSandSurface(o,d,f);
 assert.ok(Number.isFinite(hit));assert.ok(hit<1.01);assert.ok(Math.abs(f.distance([o[0],o[1]-hit,0]))<.00004);
});
test('parallel rays and origins inside bounds have finite correct intervals',()=>{
 assert.deepEqual(sandRayInterval([0,0,2],[0,0,-1],[-1,-1,-1],[1,1,1]),[1,3]);
 assert.deepEqual(sandRayInterval([0,0,0],[0,1,0],[-1,-1,-1],[1,1,1]),[0,1]);
 const f=fixture([make([0,1,0],.1)]);assert.equal(traceSandSurface([2,1,2],[0,0,-1],f),Infinity);
});
test('shallow refracted rays resolve the bank without skipping the contact',()=>{
 const distance=p=>p[1]*.65,min=[0,0,0],max=[0,0,0];
 for(const height of [.0001,.001,.005,.02]){
  const hit=traceSandSurface([0,height,0],[0,-1,0],{distance,min,max});
  assert.ok(Math.abs(hit-height)<.00005,`${height}: ${hit}`);
  assert.ok(distance([0,height-hit,0])>=0);
 }
});
