import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed} from '../src/sand-lab/sand.js';
import {shapeDistance,packSandShapes} from '../src/sand-lab/sand-shape.js';
import {buildSandBins} from '../src/sand-lab/sand-bins.js';
import {createSandUniforms,floatTexture} from '../src/sand-lab/uniforms.js';
import {IncrementalSand} from '../src/rtx-sand-lab/incremental-sand.js';
import {buildSandBricks,brickDistance} from '../src/rtx-sand-lab/sand-bricks.js';
import {SandDistanceCache} from '../src/rtx-sand-lab/sand-distance-cache.js';
import {nearWindow,nearWeight} from '../src/rtx-sand-lab/clipmap-water.js';
let seed=381;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
const parcel=(i)=>({id:i,mass:.005,packing:.6,wet:.5,position:[random()*9-4.5,random(),random()*8-4],aspect:.3+random()*2,anchored:true});
function fixture(n=120){const sand=new SandBed(33);sand.parcels=Array.from({length:n},(_,i)=>parcel(i));sand.update();const lab={sand,u:createSandUniforms()};lab.u.uSand.value=floatTexture(sand.data,sand.n,sand.n);return lab;}
function compare(lab){const ps=lab.sandRenderParcels,reference=packSandShapes(ps).data,actual=lab.u.uSandParcels.value.image.data;
 for(let i=0;i<ps.length;i++){for(const k of [0,1,2,3,4,5,7,8])assert.equal(actual[i*12+k],reference[i*12+k]);for(let c=0;c<(ps[i].cuts?.length||0)*8;c++)assert.equal(actual[actual[i*12+6]*4+c],reference[reference[i*12+6]*4+c]);}
 const bins=buildSandBins(ps).data,a=lab.u.uSandBins.value.image.data;
 for(let i=0;i<1024;i++){assert.equal(a[i*4+1],bins[i*4+1]);assert.deepEqual([...a.subarray(4096+a[i*4],4096+a[i*4]+a[i*4+1])],[...bins.subarray(4096+bins[i*4],4096+bins[i*4]+bins[i*4+1])]);}
 for(const t of [lab.u.uSandParcels.value,lab.u.uSandBins.value])for(const r of t.updateRanges)assert.ok(r.start%(t.image.width*4)+r.count<=t.image.width*4);
}
test('incremental geometry matches full packing after motion, cuts, deletion, reorder and growth',()=>{
 const lab=fixture(),cache=new IncrementalSand(lab.sand);cache.update(lab);compare(lab);
 for(let step=0;step<60;step++){const p=lab.sand.parcels[step%lab.sand.parcels.length];p.position[0]+=.03;p.wet=random();if(step%5===0)p.cuts=[...(p.cuts||[]),{offset:[0,.04,0],radius:.04}];if(step%11===0)lab.sand.parcels.splice(3,1);if(step%13===0)lab.sand.parcels.reverse();if(step===40)lab.sand.parcels.push(...Array.from({length:150},(_,i)=>parcel(i+200)));cache.update(lab);compare(lab);}
});
test('moving one handful leaves unrelated GPU rows and stable bins untouched',()=>{
 const lab=fixture(300),cache=new IncrementalSand(lab.sand);cache.update(lab);
 for(const key of ['uSandParcels','uSandBins','uSand'])lab.u[key].value.clearUpdateRanges();
 cache.update(lab);assert.equal(cache.stats.uploadedRows,0);
 lab.sand.parcels[5].position[0]+=.15;cache.update(lab);assert.equal(cache.stats.changedShapes,1);assert.ok(cache.stats.changedBins<50);assert.ok(cache.stats.uploadedRows<20);compare(lab);
});
test('terrain heights and wetness remain current without geometry repacking',()=>{
 const lab=fixture(),cache=new IncrementalSand(lab.sand);cache.update(lab);lab.sand.mass[100]+=.4;lab.sand.wet[100]=.8;lab.sand.update();cache.update(lab);assert.equal(lab.terrainHeights[100],lab.sand.heightAt(100));assert.equal(cache.stats.changedShapes,0);assert.ok(cache.stats.uploadedRows>0);
});
test('CSG bricks return exact distances for flattened, cut, intersected and translated parcels',()=>{
 let retained=0,possible=0;
 for(let j=0;j<12;j++){const p={...parcel(j),shapeRadius:.8,cuts:Array.from({length:12},(_,i)=>({offset:[random()*1.7-.85,random()*.8-.4,random()*1.7-.85],radius:(i%5===0?-1:1)*(.1+random()*.4),aspect:.2+random()*2}))};
  const shape={radius:p.shapeRadius,aspect:p.aspect,cuts:p.cuts},bricks=buildSandBricks(shape);
  for(const mask of bricks.masks){retained+=mask.toString(2).replaceAll('0','').length;possible+=13;}
  for(let k=0;k<5000;k++){const q=[random()*1.6-.8,(random()*1.6-.8)*p.aspect,random()*1.6-.8],expected=shapeDistance(p,q.map((v,i)=>v+p.position[i]));assert.ok(Math.abs(brickDistance(shape,bricks,q)-expected)<1e-12);}
 }
 assert.ok(retained/possible<.5,`retained ${retained/possible}`);
});
test('worker replies cannot restore deleted or edited geometry; translations reuse exact caches',()=>{
 const worker={postMessage(data){this.sent=data;},terminate(){}};const cache=new SandDistanceCache(()=>worker),p={...parcel(0),shapeRadius:.8,cuts:[0,1,2].map(i=>({offset:[i*.2,0,0],radius:.3}))};cache.refresh([p]);const first=worker.sent;
 p.cuts=[{offset:[0,0,0],radius:.7},...p.cuts];cache.refresh([p]);cache.finish({id:first.id,bricks:buildSandBricks(first.shape)});assert.equal(cache.completed,0);
 const next=worker.sent;cache.finish({id:next.id,bricks:buildSandBricks(next.shape)});assert.equal(cache.completed,1);
 p.position[0]+=2;const point=p.position.map(v=>v+.02),actual=shapeDistance(p,point);delete p.distanceCache;assert.equal(actual,shapeDistance(p,point));p.distanceCache=cache;
 p.shapeRadius=.9;assert.equal(cache.distance(p,point),undefined);cache.refresh([]);assert.equal(cache.entries.size,0);assert.equal(p.distanceCache,undefined);
});
test('clipmap moves on a common lattice and fades fully before a window boundary',()=>{
 const bounds={min:[-6,-1,-5.5],max:[6,10,5.5]},spacing=.2;
 for(let t=0;t<100;t++){const eye=[t*.043,1,0],w=nearWindow(eye,spacing,bounds);for(let k=0;k<3;k++){const q=(w.min[k]-bounds.min[k])/(spacing*.5);assert.ok(Math.abs(q-Math.round(q))<1e-8);for(const v of [w.min[k],w.max[k]]){const p=eye.slice();p[k]=v;assert.equal(nearWeight(p,eye,w.half),0);}}}
 const a=nearWeight([1.8,0,0],[0,0,0],3),b=nearWeight([1.8,0,0],[.0001,0,0],3);assert.ok(Math.abs(a-b)<.0002);assert.ok(a>0&&a<1);
});
