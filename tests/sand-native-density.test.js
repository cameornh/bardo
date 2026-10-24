import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NativeDensity,setDensityKernel} from '../src/sand-lab/native-density.js';
import {solveDensityCPU} from '../src/sand-lab/density-cpu.js';
import {buildNeighbors,collideBoundary} from '../src/sand-lab/water-lab-model.js';
import {makeBody,bodyDistance} from '../src/sand-lab/objects.js';
await setDensityKernel(await readFile(new URL('../src/sand-lab/kernels/density.wasm',import.meta.url)));
test('native safe contacts match JS density, held parcels, cups, terrain and repeated allocation',()=>{
 const solver=new NativeDensity(),body=makeBody('glass','cup',.3,[0,.2,0]);body.pitch=.5;body.tilt=.7;
 const solid=p=>Math.min((p[1]+.1-.2*p[0])*.65,bodyDistance(p,body));
 for(const n of [0,1,175,420,37])for(const steps of [1,3,5])for(const boundary of [null,solid]){
  const points=Float32Array.from({length:n*4},(_,i)=>i%4===3?(i%36===3?1:0):((i%4===0?Math.floor(i/4)%7:i%4===1?Math.floor(i/28)%5:Math.floor(i/140))-2.3)*.13),s=.14;
  const neighbors=buildNeighbors(points,s).data,collide=p=>collideBoundary(p,s*.12,solid),expected=solveDensityCPU(points,neighbors,s,steps,collide,boundary),actual=solver.solve(points,neighbors,s,steps,collide,boundary);
  let error=0;for(let i=0;i<actual.length;i++){error=Math.max(error,Math.abs(actual[i]-expected[i]));if(points[i-i%4+3]>.5)assert.equal(actual[i],points[i]);}
  assert.ok(actual.every(Number.isFinite));assert.ok(error<1e-6,`${n} ${steps} ${error}`);
 }
});

import {SandLab} from '../src/sand-lab/lab.js';
import {boundaryMetric} from '../src/sand-lab/water-lab-model.js';
import {sandCell} from '../src/sand-lab/sand-bins.js';
test('scattered sand only uses reference geometry in occupied bins, including normal probes across a bin edge',()=>{
 const lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true}),solver=new NativeDensity();
 for(const x of [-3,3])lab.sand.parcels.push({id:lab.sand.nextId++,position:[x,.4,-2],velocity:[0,0,0],mass:.01,packing:.56,wet:.8,anchored:true});
 lab.sand.update();lab.syncUniforms();
 solver.allocate(1,32+lab.sand.n**2+lab.balls.length*16+1024);solver.prepareGeometry(lab);
 const metric=p=>solver.instance.exports.metric(...p,lab.spacing*2,solver.offsets.geometry,solver.offsets.metric),bins=lab.u.uSandBins.value.image.data;
 assert.equal(metric([0,.4,-2]),0,'empty space between parcels keeps compiled geometry');
 assert.equal(metric([-3,.4,-2]),1,'occupied sand cell uses full CSG reference');
 let edgeChecks=0;
 for(let i=1;i<32;i++){
  const x=i/32*11-5.5,left=[x-.001,.4,-2],right=[x+.001,.4,-2];
  if((bins[sandCell(left)*4+1]>0)===(bins[sandCell(right)*4+1]>0))continue;
  const empty=bins[sandCell(left)*4+1]===0?left:right;
  // Ignore the overall geometry bounds: this specifically exercises a bin
  // transition within the large bounds of two widely separated parcels.
  if(empty[0]<=lab.u.uSandMin.value.x+.01||empty[0]>=lab.u.uSandMax.value.x-.01)continue;
  assert.equal(metric(empty),1,'normal probe across occupied edge needs reference');edgeChecks++;
 }
 assert.ok(edgeChecks>=2);
 for(let i=0;i<150;i++){
  const p=[-4+i*.055,.4,-2];if(metric(p))continue;
  const expected=boundaryMetric(p,q=>lab.solid(q),lab.spacing*2);
  assert.ok(Math.abs(expected.distance-solver.metric[3])<1e-7);
  for(let k=0;k<3;k++)assert.ok(Math.abs(expected.normal[k]-solver.metric[k])<1e-7);
 }
 lab.gpu.dispose();
});
test('compiled beach geometry agrees with ground, boulders, rotated cups, walls and player; carved sand uses reference',()=>{
 const lab=new SandLab({extensions:{has:()=>true}},{boulders:true,physicalResolution:true}),solver=new NativeDensity();
 const cup=makeBody('glass','cup',.27,[.2,1.1,2.8]);cup.tilt=.63;cup.pitch=.41;cup.spin=.39;lab.balls.push(cup);lab.setPlayer([.5,1.6,2],[.1,0,0],.028,.165);
 lab.sand.extract([0,lab.sand.height(0,3),3],.2,[0,0,0],true);lab.sand.update();lab.syncUniforms();
 const positions=[];for(let i=0;i<250;i++)positions.push(Math.sin(i*12.1)*5.6,lab.sand.height(Math.sin(i*12.1)*5.6,Math.cos(i*9.9)*4.95)+Math.sin(i*12.9)*.4,Math.cos(i*9.9)*4.95,i%23===0?1:0);
 positions.push(...cup.position,0,0,lab.sand.height(0,3),3,0,...lab.balls[0].position,0);
 const p=new Float32Array(positions),s=lab.spacing,neighbors=buildNeighbors(p,s).data,solid=p=>lab.solid(p),collide=p=>lab.collide(p),expected=solveDensityCPU(p,neighbors,s,3,collide,solid),actual=solver.solve(p,neighbors,s,3,collide,solid,lab);
 let error=0;for(let i=0;i<p.length;i++)error=Math.max(error,Math.abs(expected[i]-actual[i]));assert.ok(error<1e-6,error);
 for(let i=0;i<p.length;i+=4){const q=Array.from(p.subarray(i,i+3)),code=solver.instance.exports.metric(...q,s*2,solver.offsets.geometry,solver.offsets.metric);if(code)continue;const ref=boundaryMetric(q,solid,s*2);assert.ok(Math.abs(ref.distance-solver.metric[3])<1e-7);for(let k=0;k<3;k++)assert.ok(Math.abs(ref.normal[k]-solver.metric[k])<1e-7);}
 lab.gpu.dispose();
});
test('large neighbor uploads select a texture layout that fits the device',()=>{
 const lab=new SandLab({extensions:{has:()=>true},capabilities:{maxTextureSize:16384}});lab.gpu.uniforms.uPackedGpuNeighbors.value=false;lab.gpu.allocate(66000);
 assert.equal(lab.gpu.uniforms.uPackedGpuNeighbors.value,true);assert.ok(lab.gpu.neighborTexture.image.height<=16384);lab.gpu.dispose();
});
test('live contact backend can switch to its JS reference without graphics work or changed positions',()=>{
 const forbidden=()=>assert.fail('object constraints attempted GPU work');
 const lab=new SandLab({extensions:{has:()=>true},render:forbidden,compileAsync:forbidden,getRenderTarget:forbidden,setRenderTarget:forbidden},{boulders:true,physicalResolution:true});
 lab.gpu.contactGeometry=lab;lab.gpu.packedNeighbors=true;lab.gpu.neighborBounds=true;
 const p=Float32Array.from({length:180*4},(_,i)=>i%4===3?(i%28===3?1:0):i%4===0?(Math.floor(i/4)%6-3)*.13:i%4===1?.2+Math.floor(i/24)%5*.12:Math.floor(i/120)*.13-.4);
 for(const collision of [false,true])for(const completion of [false,true]){
  lab.gpu.uniforms.uCollision.value=collision;lab.gpu.uniforms.uBoundaryDensity.value=completion;
  lab.gpu.nativeDensity=true;const actual=lab.gpu.solve(p,.14,q=>lab.collide(q,.14*.12),3,q=>lab.solid(q));
  assert.equal(lab.gpu.contactArithmetic,'WebAssembly CPU');assert.equal(lab.gpu.cpuContacts,true);
  lab.gpu.nativeDensity=false;const reference=lab.gpu.solve(p,.14,q=>lab.collide(q,.14*.12),3,q=>lab.solid(q));
  assert.equal(lab.gpu.contactArithmetic,'JavaScript CPU');
  let error=0;for(let i=0;i<p.length;i++)error=Math.max(error,Math.abs(actual[i]-reference[i]));assert.ok(error<1e-6,error);
 }
 lab.gpu.dispose();
});
