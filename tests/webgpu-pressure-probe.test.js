import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pressureFixture,packPressure,referencePressure,pressureReport,probeWebGPU,boundedWait,PROBE_LIMITS,PRESSURE_WGSL} from '../src/webgpu-probe/pressure.js';
import {multiply,norm} from '../src/rtx-sand-lab/fields/multigrid.js';

test('bounded pressure fixture includes air, water, obstacles and matches independent double precision smoothing',()=>{
 const f=pressureFixture(),packed=packPressure(f.operator,f.rhs),actual=referencePressure(packed,32),g=f.operator;
 assert.equal(g.n,288);assert.deepEqual(new Set(f.grid.phase),new Set([1,0,2]));
 let x=new Float64Array(g.n);
 for(let step=0;step<32;step++){const ax=multiply(g,x);x=x.map((v,i)=>g.diag[i]>0?v+.7*(f.rhs[i]-ax[i])/g.diag[i]:0);}
 assert.ok(norm(actual.map((v,i)=>v-x[i]))<2e-6);
 const report=pressureReport(f,actual,actual);assert.equal(report.pass,true);assert.ok(report.relativeResidual<.1);
 assert.ok(packed.rows.byteLength+packed.edges.byteLength+packed.rhs.byteLength+3*g.n*4<65536);
});
test('corrupt and oversized pressure inputs are rejected before GPU access',async()=>{
 const f=pressureFixture();assert.throws(()=>packPressure({...f.operator,n:513},f.rhs),/budget/);
 const rhs=f.rhs.slice();rhs[0]=NaN;assert.throws(()=>packPressure(f.operator,rhs),/Non-finite/);
 const offset=f.operator.offset.slice();offset[1]=7;assert.throws(()=>packPressure({...f.operator,offset},f.rhs),/row/);
 const packed=packPressure(f.operator,f.rhs);assert.throws(()=>referencePressure(packed,65),/budget/);
 let requested=0;await assert.rejects(probeWebGPU(packed,{iterations:65,gpu:{requestAdapter(){requested++;}}}),/budget/);assert.equal(requested,0);
 for(const n of [-1,NaN,513])await assert.rejects(probeWebGPU({...packed,n},{gpu:{requestAdapter(){requested++;}}}),/budget/);
 const invalidRows=packed.rows.slice();invalidRows[2]=10000;
 await assert.rejects(probeWebGPU({...packed,rows:invalidRows},{gpu:{requestAdapter(){requested++;}}}),/Invalid packed/);assert.equal(requested,0);
 assert.equal(pressureReport(f,new Float32Array([NaN]),new Float32Array(1)).pass,false);
});
test('unavailable WebGPU gives an explicit fallback without creating WebGL',async()=>{
 const f=pressureFixture(),p=packPressure(f.operator,f.rhs);
 await assert.rejects(probeWebGPU(p,{gpu:null}),/not exposed/);
 await assert.rejects(probeWebGPU(p,{gpu:{requestAdapter:async()=>null}}),/No WebGPU adapter/);
 const source=await readFile(new URL('../src/webgpu-probe/pressure.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/WebGLRenderer|getContext\(|requestAnimationFrame/);
 assert.match(PRESSURE_WGSL,/@workgroup_size\(64\)/);assert.match(PRESSURE_WGSL,/k<6u/);
});
test('a compilation error releases the device and submits no work',async()=>{
 const f=pressureFixture(),p=packPressure(f.operator,f.rhs);let destroyed=0,scopes=0,submitted=0;
 const device={lost:new Promise(()=>{}),pushErrorScope(){scopes++;},async popErrorScope(){scopes--;return null;},destroy(){destroyed++;},
  createShaderModule(){return {getCompilationInfo:async()=>({messages:[{type:'error',lineNum:2,linePos:3,message:'invalid test shader'}]})};},queue:{submit(){submitted++;}}};
 await assert.rejects(probeWebGPU(p,{gpu:{requestAdapter:async()=>({requestDevice:async()=>device})}}),/invalid test shader/);
 assert.equal(submitted,0);assert.equal(scopes,0);assert.equal(destroyed,1);
});
test('cancelled probes request no adapter and time limits reject without retry',async()=>{
 const f=pressureFixture(),p=packPressure(f.operator,f.rhs);let requested=0;const abort=new AbortController();abort.abort();
 await assert.rejects(probeWebGPU(p,{signal:abort.signal,gpu:{requestAdapter(){requested++;}}}),/stopped/);assert.equal(requested,0);
 await assert.rejects(boundedWait(new Promise(()=>{}),'test submission',5),/time budget/);
 assert.equal(PROBE_LIMITS.batch,8);assert.equal(PROBE_LIMITS.cells,512);
});
