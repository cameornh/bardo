import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {renderPassPlan} from '../src/webgpu-sand-lab/pass-plan.js';
import {sceneTextureFormat,textureBytes,packTextureRows} from '../src/webgpu-sand-lab/formats.js';
import {PassTimestamps} from '../src/webgpu-sand-lab/timestamps.js';

test('pass grouping preserves clear order, target changes and transfer barriers',()=>{
 const a={},b={},clear={type:'clear',state:a,color:[0,0,0,0],depth:true},draw=state=>({type:'draw',state}),upload={type:'upload'},copy={type:'copy'};
 const commands=[clear,draw(a),draw(a),upload,draw(a),draw(b),copy,draw(b),clear,draw(a)];
 const merged=renderPassPlan(commands);
 assert.deepEqual(merged.map(p=>p.type==='render'?p.draws.length:p.type),[2,'upload',1,1,'copy',1,1]);
 assert.equal(merged[0].color,clear.color);assert.equal(merged[0].depth,true);
 assert.deepEqual(merged.flatMap(p=>p.draws||[]),commands.filter(c=>c.type==='draw'));
 assert.equal(renderPassPlan(commands,false).length,commands.length);
});
test('later depth-only clear cannot discard earlier draws or change color load',()=>{
 const state={},p=renderPassPlan([{type:'draw',state},{type:'clear',state,color:null,depth:true},{type:'draw',state}]);
 assert.equal(p.length,2);assert.equal(p[1].color,null);assert.equal(p[1].depth,true);assert.equal(p[1].draws.length,1);
});
test('native R/RG rows retain exact signed, tiny and large values and padding',()=>{
 for(const [channels,format] of [[1,THREE.RedFormat],[2,THREE.RGFormat]]){
  const values=new Float32Array(Array.from({length:3*2*channels},(_,i)=>[-1e12,1e-20,Math.PI,-3,0,100000][i%6])),t=new THREE.DataTexture(values,3,2,format,THREE.FloatType);
  const native=sceneTextureFormat(t),packed=packTextureRows(t.image,channels,native),legacy=packTextureRows(t.image,channels,sceneTextureFormat(t,false));
  assert.equal(textureBytes(native),channels*4);assert.equal(packed.row,256);
  for(let y=0;y<2;y++)for(let x=0;x<3;x++)for(let c=0;c<4;c++){
   const a=c<channels?new DataView(packed.data.buffer).getFloat32(y*packed.row+(x*channels+c)*4,true):c===3?1:0;
   const b=new DataView(legacy.data.buffer).getFloat32(y*legacy.row+x*16+c*4,true);assert.equal(a,b);
  }
 }
 const target=new THREE.WebGLRenderTarget(4,4,{type:THREE.FloatType});assert.equal(sceneTextureFormat(target.texture),'rgba32float');
 assert.equal(textureBytes('rgba16float'),8);assert.equal(textureBytes('depth32float'),4);
});
function fakeDevice(supported=true){
 globalThis.GPUBufferUsage={QUERY_RESOLVE:1,COPY_SRC:2,COPY_DST:4,MAP_READ:8};globalThis.GPUMapMode={READ:1};
 const maps=[],resources=[],device={features:new Set(supported?['timestamp-query']:[]),createQuerySet:()=>({destroy(){}}),createBuffer({size}){const b={mapState:'unmapped',data:new ArrayBuffer(size),destroyed:false,mapAsync(){this.mapState='pending';return new Promise((resolve,reject)=>maps.push({resolve:()=>{this.mapState='mapped';resolve();},reject,buffer:this}));},getMappedRange(){return this.data;},unmap(){this.mapState='unmapped';},destroy(){this.destroyed=true;}};resources.push(b);return b;}};
 return {device,maps,resources,encoder:{resolveQuerySet(){},copyBufferToBuffer(){}}};
}
test('unavailable timing allocates nothing and leaves execution usable',()=>{
 const f=fakeDevice(false),t=new PassTimestamps(f.device);assert.equal(t.begin(),null);assert.equal(t.snapshot().supported,false);assert.equal(f.resources.length,0);
});
test('timing reads asynchronously with two slots, never waits for a busy slot',async()=>{
 const f=fakeDevice(),t=new PassTimestamps(f.device,{capacity:2}),a=t.begin();t.writes(a,'water');t.resolve(f.encoder,a);t.submitted(a);
 const b=t.begin();t.writes(b,'foam');t.resolve(f.encoder,b);t.submitted(b);
 assert.equal(t.begin(),null);assert.equal(t.snapshot().skipped,1);assert.equal(f.resources.length,4);
 new BigUint64Array(f.maps[1].buffer.data).set([9000000n,12000000n]);f.maps[1].resolve();await b.pending;
 new BigUint64Array(f.maps[0].buffer.data).set([1000000n,2000000n]);f.maps[0].resolve();await a.pending;
 assert.equal(t.latest.sequence,2);assert.equal(t.latest.sumMs,3);assert.equal(t.latest.byName.foam,3);
 const c=t.begin();assert.ok(c);t.cancel(c);t.dispose();assert.ok(f.resources.every(b=>b.destroyed));
});
test('counter reset drops the sample; mapping failure disables only diagnostics',async()=>{
 const f=fakeDevice(),t=new PassTimestamps(f.device),a=t.begin();t.writes(a,'draw');t.resolve(f.encoder,a);t.submitted(a);
 new BigUint64Array(f.maps[0].buffer.data).set([200n,100n]);f.maps[0].resolve();await a.pending;assert.equal(t.latest,null);
 const b=t.begin();t.writes(b,'draw');t.resolve(f.encoder,b);t.submitted(b);f.maps[1].reject(Error('map failed'));await b.pending;
 assert.equal(t.snapshot().enabled,false);assert.match(t.snapshot().error,/map failed/);t.dispose();
});
test('implausible counter scale is rejected without disabling future samples',async()=>{
 const f=fakeDevice();let clock=0;const t=new PassTimestamps(f.device,{now:()=>clock});
 const a=t.begin();t.writes(a,'draw');t.resolve(f.encoder,a);t.submitted(a);
 new BigUint64Array(f.maps[0].buffer.data).set([0n,90000000n]);clock=40;f.maps[0].resolve();await a.pending;
 assert.equal(t.latest,null);assert.equal(t.snapshot().rejected,1);assert.equal(t.snapshot().enabled,true);assert.match(t.snapshot().lastRejected.reason,/wall time/);
 const b=t.begin();t.writes(b,'draw');t.resolve(f.encoder,b);t.submitted(b);
 new BigUint64Array(f.maps[1].buffer.data).set([100000000n,125000000n]);clock=80;f.maps[1].resolve();await b.pending;
 assert.equal(t.latest.sumMs,25);assert.equal(t.latest.elapsedMs,40);t.dispose();
});
test('query capacity is bounded and partial results are explicitly marked',async()=>{
 const f=fakeDevice(),t=new PassTimestamps(f.device,{capacity:1}),a=t.begin();
 assert.ok(t.writes(a,'first'));assert.equal(t.writes(a,'overflow'),undefined);t.resolve(f.encoder,a);t.submitted(a);
 new BigUint64Array(f.maps[0].buffer.data).set([0n,1000n]);f.maps[0].resolve();await a.pending;
 assert.equal(t.latest.truncated,true);assert.equal(t.latest.passes.length,1);assert.equal(t.snapshot().skipped,1);t.dispose();
});

test('overlapping and reordered pass intervals retain per-pass cost without double-counting span',async()=>{
 const f=fakeDevice();let clock=0;const t=new PassTimestamps(f.device,{now:()=>clock}),a=t.begin();
 t.writes(a,'later');t.writes(a,'earlier');t.resolve(f.encoder,a);t.submitted(a);
 new BigUint64Array(f.maps[0].buffer.data).set([3000000n,13000000n,1000000n,11000000n]);clock=12;f.maps[0].resolve();await a.pending;
 assert.equal(t.latest.sumMs,20);assert.equal(t.latest.spanMs,12);assert.equal(t.snapshot().rejected,0);t.dispose();
});
test('diagnostic allocation failure does not take down rendering',()=>{
 const f=fakeDevice(),t=new PassTimestamps(f.device,{createBuffer:()=>{throw Error('budget exhausted');}});
 assert.equal(t.begin(),null);assert.equal(t.snapshot().enabled,false);assert.match(t.snapshot().error,/budget/);t.dispose();
});
