import test from 'node:test';
import assert from 'node:assert/strict';
import {planeVolume,planeOffset,planeFlux} from '../src/volume-interface.js';

test('plane/cube intersections match axis slabs, diagonal tetrahedra and complement symmetry',()=>{
 assert.equal(planeVolume(.3,[0,1,0]),.3);
 assert.ok(Math.abs(planeVolume(.5,[1,1,1])-1/48)<1e-12);
 assert.ok(Math.abs(planeVolume(1,[1,1,0])-.5)<1e-12);
 for(const m of [[.2,.3,.5],[1e-7,.01,.99],[0,0,1]])for(const alpha of [.001,.05,.3,.5,.8,.999]){
  const offset=planeOffset(alpha,m),sum=m.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(planeVolume(offset,m)-alpha)<.0002);
  assert.ok(Math.abs(planeVolume(offset,m)+planeVolume(sum-offset,m)-1)<1e-9);
 }
});
test('geometric flux moves the liquid slab while leaving its empty portion behind',()=>{
 // Lower half is water; a quarter-cell sweep out the upper face contains none.
 assert.equal(planeFlux(.5,[0,1,0],.5,1,.25),0);
 assert.equal(planeFlux(.5,[0,1,0],.5,1,-.25),1);
 assert.equal(planeFlux(.5,[0,1,0],.5,0,.25),.5);
 assert.equal(planeFlux(.5,[0,-1,0],.5,1,.25),1);
});
