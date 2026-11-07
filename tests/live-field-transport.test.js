import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FieldTransport,setTransportKernel} from '../src/rtx-sand-lab/fields/native-transport.js';
import {transportFluid} from '../src/sand-lab/water-lab-transport.js';
import {buildNeighbors} from '../src/sand-lab/water-lab-model.js';
await setTransportKernel(await readFile(new URL('../src/rtx-sand-lab/fields/kernels/transport.wasm',import.meta.url)));
test('native hybrid transport matches the reference for holds, collisions, chemistry and changing capacity',()=>{
 const kernel=new FieldTransport();
 for(const reciprocal of [true,false])for(const n of [31,219,10])for(const havePrediction of [true,false]){
  const old=new Float32Array(n*4),next=old.slice(),previous=old.slice(),chem=old.slice(),predicted=old.slice(),dt=.05,s=.2;
  for(let i=0;i<n;i++){const o=i*4;old.set([i%7*.17,Math.floor(i/7)%6*.17,Math.floor(i/42)*.17,i%19===0?1:0],o);chem.set([i%3*.13,i%5*.06,i%7*.02,i%11*.03],o);for(let k=0;k<3;k++){previous[o+k]=Math.sin(i*1.3+k)*.4;next[o+k]=old[o+k]+(old[o+3]?0:Math.sin(i*.7+k)*.012);predicted[o+k]=old[o+k]+previous[o+k]*dt;}next[o+3]=old[o+3];}
  const neighbors=buildNeighbors(next,s).data,args=[old,next,previous,chem,neighbors,s,10,dt,havePrediction?predicted:null],expected=transportFluid(...args),actual=kernel.solve(...args,reciprocal);
  assert.equal(kernel.backend,'WebAssembly CPU transport');
  for(const key of Object.keys(expected)){assert.equal(actual[key].length,expected[key].length);for(let i=0;i<expected[key].length;i++)assert.ok(Math.abs(actual[key][i]-expected[key][i])<2e-6,`${key}[${i}]: ${actual[key][i]} vs ${expected[key][i]}`);}
 }
});
