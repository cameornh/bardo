import test from 'node:test';
import assert from 'node:assert/strict';
import {sandVisibility} from '../src/sand-lab/surface-shadow.js';
const sphere=center=>({min:center.map(x=>x-.4),max:center.map(x=>x+.4),distance:p=>Math.hypot(...p.map((x,k)=>x-center[k]))-.3});
test('moving sand remains sunlit above its surface and casts a shadow below',()=>{
 for(let i=0;i<100;i++){
  const c=[-.6+i*.013,1.5+i*.007,Math.sin(i*.11)*.3],shape=sphere(c);
  assert.equal(sandVisibility([c[0],c[1]+.31,c[2]],[0,1,0],shape),1);
  assert.equal(sandVisibility([c[0],c[1]-.6,c[2]],[0,1,0],shape),0);
  assert.equal(sandVisibility([c[0]+.6,c[1]-.6,c[2]],[0,1,0],shape),1);
 }
});
test('solar penumbra moves continuously with the caster',()=>{
 let previous=0;const shape=sphere([0,1,0]);
 for(let i=0;i<100;i++){
  const visibility=sandVisibility([.295+i*.0002,0,0],[0,1,0],shape);
  assert.ok(visibility>=previous-1e-9);assert.ok(Math.abs(visibility-previous)<.04);previous=visibility;
 }
 assert.equal(previous,1);
});
