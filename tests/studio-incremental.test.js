import test from 'node:test';
import assert from 'node:assert/strict';
import {stamp,seedLibrary,clone,LIMITS} from '../src/asset-studio/model.js';
import {gridSpec,sampleGridCPU,extractSurface,bakeCPU} from '../src/asset-studio/sculpt.js';
import {IncrementalSculpt,SculptCachePool} from '../src/asset-studio/sculpt-incremental.js';
const base=()=>[stamp('box','add',[0,1,0],[1,1,1],'clay',.1)];
test('appended mixed strokes preserve exact grids, normals, ordering and material ties',()=>{
 const s=base(),cache=new IncrementalSculpt();
 for(let i=0;i<20;i++){
  if(i)s.push(stamp(['sphere','capsule','box'][i%3],['paint','subtract','add'][i%3],[Math.sin(i*2.8)*.6,1+Math.cos(i*3.3)*.7,Math.cos(i*.77)*.7],[.2,.24,.18],i%2?'stone':'clay',i%4*.033333333333));
  const {surface,stats}=cache.update(s,.16),g=gridSpec(s,.16);
  assert.deepEqual(cache.values,sampleGridCPU(s,g));assert.deepEqual(surface,bakeCPU(s,.16));
  if(i)assert.equal(stats.mode,'appended strokes');
 }
 const unchanged=cache.update(s,.16);assert.equal(unchanged.stats.stampEvaluations,0);assert.equal(unchanged.stats.rebuiltCells,0);assert.deepEqual(unchanged.surface,bakeCPU(s,.16));
});
test('undo, changed prior operations, reordering, bounds and spacing changes rebuild exactly',()=>{
 const cache=new IncrementalSculpt();let s=base();cache.update(s,.15);s.push(stamp('sphere','paint',[0,1,0],[.5,.5,.5],'stone'));cache.update(s,.15);
 for(const change of [()=>s[0].materialId='bronze',()=>s.pop(),()=>s[0].blend=.35,()=>s.push(stamp('sphere','add',[3,1,0],[.2,.3,.2])),()=>s.reverse()]){change();const result=cache.update(s,.15);assert.equal(result.stats.mode,'full');assert.deepEqual(result.surface,bakeCPU(s,.15));}
 assert.deepEqual(cache.update(s,.11).surface,bakeCPU(s,.11));assert.deepEqual(cache.update([],.1).surface,bakeCPU([],.1));assert.equal(cache.bytes,0);assert.deepEqual(cache.update(base(),.15).surface,bakeCPU(base(),.15));
});
test('sampled grids rebuild all incident cells across eight-cell brick borders',()=>{
 const s=base(),grid={dims:[18,18,18],count:18**3,h:.1,origin:[-.4,-.4,-.4]},values=new Float32Array(grid.count*2),cache=new IncrementalSculpt();for(let i=0;i<grid.count;i++)values[i*2]=(i%18)-8.2;
 assert.deepEqual(cache.update(s,.1,{grid,values}).surface,extractSurface(values,grid,s));
 for(const [x,y,z]of [[8,8,8],[16,16,16],[0,0,0],[17,17,17]]){values[(x+18*(y+18*z))*2]=-2;const result=cache.update(s,.1,{grid,values});assert.deepEqual(result.surface,extractSurface(values,grid,s));if(x===8)assert.ok(result.stats.rebuiltBricks>=8);}
});
test('GPU-sampled floats and CPU accumulators never cross-contaminate',()=>{
 const s=base(),cache=new IncrementalSculpt(),grid=gridSpec(s,.14),values=sampleGridCPU(s,grid);for(let i=0;i<values.length;i+=2)values[i]=Math.fround(values[i]+1e-5);
 cache.update(s,.14);assert.deepEqual(cache.update(s,.14,{grid,values}).surface,extractSurface(values,grid,s));
 s.push(stamp('sphere','add',[.7,1,0],[.2,.2,.2],'stone',.1));const result=cache.update(s,.14);assert.equal(result.stats.mode,'full');assert.deepEqual(result.surface,bakeCPU(s,.14));
});
test('global surface cap and ordering are identical through cached truncated grids',()=>{
 const s=base(),grid={dims:[33,33,33],count:33**3,h:.1,origin:[0,0,0]},values=new Float32Array(grid.count*2),cache=new IncrementalSculpt();for(let i=0;i<grid.count;i++)values[i*2]=i%2?-1:1;
 for(let j=0;j<2;j++){const result=cache.update(s,.1,{grid,values});assert.equal(result.surface.truncated,true);assert.equal(result.surface.materials.length,LIMITS.splats);assert.deepEqual(result.surface,extractSurface(values,grid,s));for(let i=0;i<500;i++)values[i*2]=1;}
});
test('two-part cache evicts old grids and remains bounded across long editing histories',()=>{
 const pool=new SculptCachePool(),s=base();for(let i=0;i<60;i++){const result=pool.update('part-'+i,s,.18);assert.deepEqual(result.surface,bakeCPU(s,.18));assert.ok(pool.entries.size<=2);}
 const cache=pool.entries.get('part-59');const bytes=cache.bytes;for(let i=0;i<80;i++){s.push(stamp('sphere','paint',[Math.sin(i)*.7,1,0],[.12,.12,.12],i%2?'stone':'clay'));pool.update('part-59',s,.18);assert.equal(cache.bytes,bytes);}
 assert.equal(pool.entries.has('part-0'),false);pool.drop('part-59');assert.equal(cache.bytes,0);
 assert.throws(()=>new IncrementalSculpt().update(Array(513).fill(stamp()),.1),/budget/);
});
test('incremental worker keys isolate parts; disabling and re-enabling uses clean state',async()=>{
 const previous=globalThis.self,answers=[];globalThis.self={postMessage:r=>answers.push(r)};
 try{await import('../src/asset-studio/incremental-worker.js');const s=base();
  for(const [key,incremental,optimized]of [['a',true,true],['b',true,true],['a',false,true],['a',true,true],['a',true,false]]){s.push(stamp('sphere','subtract',[.7,1,0],[.15,.15,.15]));self.onmessage({data:{id:answers.length,key,incremental,optimized,stamps:clone(s),spacing:.17}});const result=answers.at(-1);assert.equal(result.error,undefined);assert.deepEqual(result.surface,bakeCPU(s,.17));}
 }finally{globalThis.self=previous;}
});
test('seeded assets keep exact output on initial and repeat bake',()=>{for(const a of seedLibrary().assets)for(const p of a.parts){const c=new IncrementalSculpt();for(let i=0;i<2;i++)assert.deepEqual(c.update(p.stamps,a.spacing).surface,bakeCPU(p.stamps,a.spacing));}});

test('cache limits cannot disable eviction or grow beyond the two-part budget',()=>{
 for(const n of [0,-1,100,NaN,Infinity]){const p=new SculptCachePool(n);assert.ok(p.maxParts>=1&&p.maxParts<=2);}
});

test('Baker preserves the legacy worker by default and forwards explicit per-part reuse',async()=>{
 const previous=globalThis.Worker,workers=[];globalThis.Worker=class{
  constructor(url){this.url=url.href;workers.push(this);}
  postMessage(data){this.message=data;queueMicrotask(()=>this.onmessage({data:{id:data.id,surface:{fixture:true},stats:{mode:'mock'}}}));}
  terminate(){this.terminated=true;}
 };
 try{const {Baker}=await import('../src/asset-studio/baker.js');
  for(const incremental of [false,true]){const b=incremental?new Baker(()=>{},{incremental:true}):new Baker(()=>{});assert.ok(workers.at(-1).url.endsWith(incremental?'incremental-worker.js':'bake-worker.js'));
   await b.bake(base(),.2,false,true,{key:'asset:part'});assert.equal(workers.at(-1).message.incremental,incremental);assert.equal(workers.at(-1).message.key,'asset:part');assert.equal(b.lastStats.mode,'mock');
   await b.bake(base(),.2,false,true,{key:'asset:part',incremental:false});assert.equal(workers.at(-1).message.incremental,false);
   b.gpu={sample:async(s,g)=>new Float32Array(g.count*2),dispose(){}};
   await b.bake(base(),.2,true,true,{key:'asset:part'});assert.equal(workers.at(-1).message.incremental,false,'GPU default retains full extraction');
   await b.bake(base(),.2,true,true,{key:'asset:part',gpuIncremental:true});assert.equal(workers.at(-1).message.incremental,incremental,'GPU reuse is explicit research opt-in');
   b.dispose();assert.equal(workers.at(-1).terminated,true);assert.equal(b.waiting.size,0);
  }
 }finally{globalThis.Worker=previous;}
});
