import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {waterColumns,waterConfig} from '../src/rtx-sand-lab/water-consumers/model.js';
import {WaterConsumers,installWaterConsumers} from '../src/rtx-sand-lab/water-consumers/experiment.js';
function lab(n=80){const positions=new Float32Array(n*4);for(let i=0;i<n;i++)positions.set([-5.4+(i%10),i*.01,-4.8+Math.floor(i/10)],i*4);return {count:n,spacing:.3,positions,spec:{scale:10},steps:7,tannins:1};}
test('column lists visit every particle once, keep ascending IDs and use no camera',()=>{const l=lab(),a=waterColumns(l),seen=[];for(const head of a.heads){let prev=-1;for(let i=head;i>=0;i=a.next[i]){assert.ok(i>prev);seen.push(i);prev=i;}}assert.deepEqual(seen.sort((a,b)=>a-b),Array.from({length:l.count},(_,i)=>i));l.eye=[1e6,1e6,1e6];assert.deepEqual(waterColumns(l),a);});
test('full support is covered even at domain edges and outside the footprint',()=>{const l=lab(15);l.positions.set([-10,0,-10,0]);l.positions.set([10,0,10,0],4);const a=waterColumns(l);assert.ok(a);for(const x of [-5.5,-5.49,0,5.499])for(const z of [-4.9,0,4.899]){const b=[Math.floor((x+5.5)/a.r),Math.floor((z+4.9)/a.r)],near=new Set();for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const xx=b[0]+dx,zz=b[1]+dz;if(xx<0||zz<0||xx>=a.nx||zz>=a.nz)continue;for(let i=a.heads[xx+zz*a.nx];i>=0;i=a.next[i])near.add(i);}for(let i=0;i<l.count;i++)if(Math.hypot(x-l.positions[i*4],z-l.positions[i*4+2])<=l.spacing*.85)assert.ok(near.has(i));}});
test('crowding and invalid sizes fall back before GPU work',()=>{const l=lab(70);l.positions.fill(0);assert.equal(waterColumns(l),null);l.count=32769;assert.equal(waterColumns(l),null);l.count=0;l.spacing=0;assert.equal(waterColumns(l),null);});
test('configuration preserves simulation scale, organic load and body count',()=>{const l=lab(),a=waterColumns(l),c=waterConfig(l,a,96,3);assert.equal(c[0],80);assert.equal(c[2],10);assert.equal(c[3],7);assert.equal(c[7],96);assert.equal(c[8],1);assert.equal(c[9],3);});
test('WebGL reference installation does not touch existing consumers',async()=>{const draw={renderer:{isSharedSceneWebGPU:false}};assert.equal((await installWaterConsumers(draw)).enabled,false);});
test('snapshot cannot overwrite data already queued for a different water epoch',()=>{const gpu=Object.create(WaterConsumers.prototype);gpu.stats={fallbacks:0};gpu.pending=1;assert.equal(gpu.snapshot(lab()),null);assert.equal(gpu.stats.fallbacks,1);});
test('invalid particle records cannot produce incomplete GPU lists',()=>{const l=lab();l.positions[4]=NaN;assert.equal(waterColumns(l),null);l.positions=new Float32Array(4);assert.equal(waterColumns(l),null);});
test('same consumer cannot overwrite its pending dispatch',()=>{const gpu=Object.create(WaterConsumers.prototype);gpu.stats={fallbacks:0};gpu.queued=new Set(['flow','sea','rain']);assert.equal(gpu.flow(lab(),{}),false);assert.equal(gpu.enqueue(lab(),'sea'),false);assert.equal(gpu.enqueue(lab(),'rain'),false);assert.equal(gpu.stats.fallbacks,3);});
test('shared installation is idempotent; toggling rain at rest restores the reference texture',async()=>{
 const originals=[];let seaCalls=0,rainCalls=0,flowCalls=0;
 const texture={},surface={update(){seaCalls++;return this;}},rain={texture,update(l){if(this.revision===l.revision)return;rainCalls++;this.revision=l.revision;}},flow={updateBulk(){flowCalls++;}};
 const l={optimizations:{sharedWaterInputs:true},gpu:{cpu:false},revision:1,generation:1,seaFoam:{size:96,surface,u:{uSeaSurface:{},uSeaFlow:{}},surfaceTexture:{},flowTexture:{}},detail:{flow:{field:flow}}};
 const draw={renderer:{isSharedSceneWebGPU:true},lab:l,rainSurface:rain,u:{uRainSurface:{value:texture}}};
 originals.push(mock.method(WaterConsumers.prototype,'prepare',function(){this.seaSurface={proxy:{}};this.seaFlow={proxy:{}};this.rainSurface={proxy:{}};return Promise.resolve(this);}));
 originals.push(mock.method(WaterConsumers.prototype,'enqueue',()=>true));originals.push(mock.method(WaterConsumers.prototype,'flow',()=>true));originals.push(mock.method(WaterConsumers.prototype,'dispose',()=>{}));
 try{const a=await installWaterConsumers(draw);assert.equal(await installWaterConsumers(draw),a);rain.update(l);assert.equal(rain.texture,a.gpu.rainSurface.proxy);assert.equal(rainCalls,0);surface.update(l);flow.updateBulk(l);assert.equal(seaCalls+flowCalls,0);
  a.enabled=false;rain.update(l);assert.equal(rainCalls,1);assert.equal(draw.u.uRainSurface.value,texture);surface.update(l);flow.updateBulk(l);assert.equal(seaCalls,1);assert.equal(flowCalls,1);
  a.enabled=true;l.optimizations.sharedWaterInputs=false;flow.updateBulk(l);assert.equal(flowCalls,2);a.dispose();assert.equal(draw.waterConsumers,undefined);assert.equal(rain.texture,texture);assert.equal(l.seaFoam.surfaceElapsed,Infinity);
 }finally{for(const m of originals)m.mock.restore();}
});
