import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BeachFieldGrid} from '../src/rtx-sand-lab/fields/grid.js';
import {FieldTransfer,setTransferKernel} from '../src/rtx-sand-lab/fields/native-transfer.js';
await setTransferKernel(await readFile(new URL('../src/rtx-sand-lab/fields/kernels/transfer.wasm',import.meta.url)));
const near=(a,b)=>{assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<1e-11,`${i}: ${a[i]} != ${b[i]}`);};
test('native MAC scatter/gather matches reference at walls, shoreline, held and out-of-domain parcels',()=>{
 const options={dims:[10,8,9],h:.4,origin:[-2,-1,-2],extent:[4,3.1,3.7]},a=new BeachFieldGrid(options),b=new BeachFieldGrid(options);b.nativeTransfer=new FieldTransfer();
 for(const count of [300,900,80,1400]){
  const p=new Float32Array(count*4),q=p.slice();for(let i=0;i<count;i++){const o=i*4;p[o]=-2.1+(i%19)*.23;p[o+1]=-.95+Math.floor(i/19)%7*.2;p[o+2]=-2.1+Math.floor(i/133)*.24;p[o+3]=i%27===0?1:0;q.set(p.subarray(o,o+4),o);q[o]+=.02*Math.sin(i);q[o+1]-=.015;q[o+2]+=.03*Math.cos(i);}
  const solid=p=>Math.min(p[1]+.9,p[0]+1.9),wind=p=>[.7,.02,.1],wall=()=>[0,0,0];
  const ra=a.deposit(p,q,1/30,1,.4,solid,wind,wall),rb=b.deposit(p,q,1/30,1,.4,solid,wind,wall);near(ra,rb);assert.deepEqual(a.phase,b.phase);assert.deepEqual(a.stencilIndices,b.stencilIndices);
  for(let i=0;i<a.stencilIndices.length;i++)if(a.stencilIndices[i]>=0)assert.equal(a.stencilWeights[i],b.stencilWeights[i]);
  for(let k=0;k<3;k++){near(a.faces[k].before,b.faces[k].before);near(a.faces[k].velocity,b.faces[k].velocity);near(a.faces[k].weight,b.faces[k].weight);}
  const result=a.solve(ra,1/30);b.project(result.potential,1/30);
  assert.deepEqual(a.transfer(p,q,1/30,1,.4),b.transfer(p,q,1/30,1,.4));assert.equal(a.coupled,b.coupled);
 }
});
