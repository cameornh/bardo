import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BeachFieldGrid,AIR,WATER} from '../src/rtx-sand-lab/fields/grid.js';
import {FieldNeighbors} from '../src/rtx-sand-lab/fields/neighbors.js';
import {setNeighborKernel} from '../src/sand-lab/native-neighbors.js';
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('gravity and wall impulses balance in a resting pool over repeated transfers',()=>{
 const grid=new BeachFieldGrid({dims:[8,8,8],h:1,origin:[0,0,0]});let p=[];
 for(let z=.25;z<8;z+=.5)for(let y=.25;y<4;y+=.5)for(let x=.25;x<8;x+=.5)p.push(x,y,z,0);
 p=new Float32Array(p);const initial=p.slice();let velocity=new Float32Array(p.length),peak=0;
 for(let step=0;step<90;step++){
  const dt=1/30,predicted=p.slice();for(let o=0;o<p.length;o+=4)for(let k=0;k<3;k++)predicted[o+k]+=(velocity[o+k]-(k===1?9.81*dt:0))*dt;
  grid.solve(grid.deposit(p,predicted,dt,1,.5,()=>1,()=>[0,0,0]),dt);
  const out=grid.transfer(p,predicted,dt,1,.5);
  for(let o=0;o<p.length;o+=4)for(let k=0;k<3;k++){velocity[o+k]=(out[o+k]-p[o+k])/dt;peak=Math.max(peak,Math.abs(velocity[o+k]));}p=out;
 }
 assert.ok(peak<1e-4,`resting wall generated ${peak} m/s`);
 for(let i=0;i<p.length;i++)close(p[i],initial[i],1e-5);
});

test('sparse drops stay ballistic instead of creating pressure-supported columns',()=>{
 const g=new BeachFieldGrid({dims:[8,8,8],h:1,origin:[0,0,0]}),p=new Float32Array([.1,5,.1,0]),pred=p.slice();pred[1]-=.05;
 const rhs=g.deposit(p,pred,.1,1,.25,()=>1,()=>[0,0,0]);g.solve(rhs,.1);
 assert.equal(g.phase[g.cellAt(p)],AIR);assert.deepEqual(g.transfer(p,pred,.1,1,.25),pred);
});

test('water above a sloping shore remains coupled when the coarse cell center is underground',()=>{
 const g=new BeachFieldGrid({dims:[4,4,4],h:1,origin:[0,0,0]}),p=new Float32Array([1.25,1.85,1.25,0,1.75,1.85,1.25,0,1.25,1.85,1.75,0]);
 g.deposit(p,p,.05,1,.5,p=>p[1]-1.7,()=>[0,0,0]);
 assert.equal(g.phase[g.cellAt([1.5,1.5,1.5])],WATER);assert.equal(g.phase[g.cellAt([1.5,.5,1.5])],0);
});

test('air sampling never extends the submerged current as a wind source',()=>{
 const g=new BeachFieldGrid({dims:[8,8,8],h:1,origin:[0,0,0]});g.setPhase(Uint8Array.from(g.phase,(_,i)=>g.coords[i][1]<5?WATER:AIR));
 for(const f of g.faces)for(let i=0;i<f.velocity.length;i++)f.velocity[i]=g.phase[f.a[i]]===WATER&&g.phase[f.b[i]]===WATER?20:0;
 g.buildAirVelocity();for(let y=.5;y<8;y++)close(Math.hypot(...g.sampleAirVelocity([3.5,y,3.5])),0);
});

test('rectangular grids end at the actual beach walls and project with per-axis spacing',()=>{
 const g=new BeachFieldGrid({dims:[9,6,7],h:1.3,origin:[-5.5,-.5,-4.9],extent:[11,6,9.8]});
 for(let k=0;k<3;k++)close(g.faces[k].position.at(-1)[k],g.origin[k]+[11,6,9.8][k]);
 g.setPhase(Uint8Array.from(g.phase,(_,i)=>g.coords[i][1]<3?WATER:AIR));
 for(const f of g.faces)for(let i=0;i<f.velocity.length;i++)f.velocity[i]=f.coefficient[i]?Math.sin(i*.3):0;
 g.solve(g.rhs(),.05);assert.ok(g.summary().divergence<1e-4);
});

test('cached face advection stencils equal normalized trilinear sampling',()=>{
 const g=new BeachFieldGrid({dims:[9,6,7],h:1.3,origin:[-5.5,-.5,-4.9],extent:[11,6,9.8]});
 for(const f of g.faces)for(let i=0;i<f.velocity.length;i++)f.velocity[i]=Math.sin(i*.71);
 for(const f of g.faces)for(let i=0;i<f.velocity.length;i++)for(let a=0;a<3;a++){
  let v=0;for(let k=0;k<4;k++){const at=f.advectionIndices[i*12+a*4+k];if(at>=0)v+=g.faces[a].velocity[at]*f.advectionWeights[i*12+a*4+k];}
  close(v,g.sampleFace(f.position[i],g.faces[a]),1e-12);
 }
});

test('tight neighbor lists retain every interaction after maximal shifts and cached movement',async()=>{
 await setNeighborKernel(await readFile(new URL('../src/sand-lab/kernels/neighbors.wasm',import.meta.url)));
 const s=.2,n=260,initial=new Float32Array(n*4);for(let i=0;i<n;i++)initial.set([Math.sin(i*8.31),Math.cos(i*7.17),Math.sin(i*4.71),0],i*4);
 for(const native of [false,true]){
  const b=new FieldNeighbors();b.build(initial,s,{native});const moved=initial.slice(),final=initial.slice();
  for(let i=0;i<n;i++){const sign=i%2?1:-1;moved[i*4]+=sign*s*.024;final[i*4]+=sign*s*(.024+.12);}
  const result=b.build(moved,s,{native});assert.ok(b.reused);assert.equal(result.overflow,0);
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j){const r=Math.hypot(...[0,1,2].map(k=>final[i*4+k]-final[j*4+k]));if(r<2*s)assert.ok(result.data.subarray(i*128,(i+1)*128).includes(j),`missing ${i},${j}`);}
  moved[0]+=.1*s;b.build(moved,s,{native});assert.ok(!b.reused);
 }
});
