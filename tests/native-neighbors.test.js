import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PackedNeighbors} from '../src/sand-lab/packed-neighbors.js';
import {NativeNeighbors,setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
await setNeighborKernel(await readFile(new URL('../src/sand-lab/kernels/neighbors.wasm',import.meta.url)));
function fixture(n,dense=false){const p=new Float32Array(n*4);for(let i=0;i<n;i++){p[i*4]=(Math.sin(i*312.7)*3+Math.cos(i*56.1))*(dense?.025:1);p[i*4+1]=Math.sin(i*61.1)*2*(dense?.025:1);p[i*4+2]=Math.cos(i*12.1)*4*(dense?.025:1);}return p;}
test('native neighbor lists exactly match reciprocal JS traversal, including overflow and reuse',()=>{
 const native=new NativeNeighbors(),reference=new PackedNeighbors();
 for(const [n,dense] of [[0,false],[1,false],[900,false],[384,true],[12000,false],[70,false]]){const p=fixture(n,dense),a=native.build(p,.23),b=reference.build(p,.23,true);assert.equal(a.overflow,b.overflow);assert.equal(a.cells,b.cells);assert.deepEqual(a.data,b.data);}
});
test('native cutoff decisions preserve double precision and negative cell boundaries',()=>{
 const s=.25,reach=s*2.65,p=new Float32Array([0,0,0,0,reach,0,0,0,-reach,0,0,0,reach-1e-7,0,0,0,-reach+1e-7,0,0,0]);
 assert.deepEqual(new NativeNeighbors().build(p,s),new PackedNeighbors().build(p,s,true));
});

import {SandBed} from '../src/sand-lab/sand.js';
import {createSandWind} from '../src/sand-lab/sand-air.js';
test('batched moving sand wind samples preserve forces after each group settles',()=>{
 const make=batched=>{const sand=new SandBed(33);sand.optimizations={windBatch:batched,windGeometry:true,fastHeight:true,stressPruning:true,sandQueryBounds:true};
  for(let j=0;j<5;j++){const pieces=sand.extract([(j-2)*.25,sand.height((j-2)*.25,3),3],.17);for(const p of pieces){p.position[1]+=.5;p.wet=j*.24;p.memory=p.wet;}}
  return {sand,balls:[],time:0,spec:{scale:10},wind:50,windTurbulence:1.2,radius:.5,windStrength:120,jet:{origin:[-3,2,3],direction:[1,-.1,0]},optimizations:sand.optimizations};};
 const a=make(false),b=make(true),water=()=>({density:0,velocity:[0,0,0]});
 for(let i=0;i<30;i++){a.time=b.time=i/15;for(const lab of [a,b])lab.sand.step(1/15,water,createSandWind(lab),10,0,.2);
  assert.deepEqual(a.sand.parcels,b.sand.parcels);assert.deepEqual(a.sand.mass,b.sand.mass);assert.deepEqual(a.sand.wet,b.sand.wet);
 }
});

import {packNeighborTexture} from '../src/sand-lab/neighbor-texture.js';
test('GPU neighbor layout preserves every index and pads the partial last tile',()=>{
 for(const count of [1,63,64,65,777,32768]){const src=Float32Array.from({length:count*128},(_,i)=>i%127===0?-1:i),out=new Float32Array(Math.ceil(count/64)*8192);packNeighborTexture(src,out,count);
  for(let i=0;i<Math.ceil(count/64)*64;i++)for(let a=0;a<128;a++){const x=i%64+Math.floor(a/32)*64,y=Math.floor(i/64)*8+Math.floor((a%32)/4);assert.equal(out[(y*256+x)*4+a%4],i<count?src[i*128+a]:-1);}
 }
});
