import test from 'node:test';
import assert from 'node:assert/strict';
import {PackedNeighbors} from '../src/sand-lab/packed-neighbors.js';
import {buildNeighbors} from '../src/sand-lab/water-lab-model.js';
import {BoundsGrid,separateBodies} from '../src/sand-lab/spatial-bounds.js';
import {makeBody,resolveSandContacts} from '../src/sand-lab/objects.js';
import {SandBed,SAND} from '../src/sand-lab/sand.js';
import {SandLab} from '../src/sand-lab/lab.js';
import {gaussianSupport} from '../src/sand-lab/gaussian-bounds.js';
import {fieldLayout} from '../src/sand-lab/water-lab-field.js';
import {fillMacroCPU} from '../src/sand-lab/field-occupancy.js';
import {sampleFieldCPU} from '../src/sand-lab/water-lab-medium-shadows.js';
import {LightingTiles} from '../src/sand-lab/lighting-tiles.js';
const rnd=i=>{const a=Math.sin(i*123.31+8.9)*143758.5453;return a-Math.floor(a);};
const points=(n,extent)=>Float32Array.from({length:n*4},(_,i)=>i%4===3?0:(rnd(i)-.5)*extent);
const clump=(id,position,r=.15)=>({id,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*SAND.packing,packing:SAND.packing,wet:.95,memory:.95,anchored:true});

test('packed neighbors preserve every reference index, order and overflow across resizes',()=>{
 const packed=new PackedNeighbors();
 for(const [n,e] of [[0,1],[1,1],[350,5],[270,.15],[1200,8],[27,2]]){
  const data=points(n,e),actual=packed.build(data,.23),expected=buildNeighbors(data,.23);
  assert.equal(actual.overflow,expected.overflow);assert.deepEqual(actual.data,expected.data);
 }
});
test('broad phase preserves sequential body contacts including contacts created by correction',()=>{
 const input=Array.from({length:150},(_,i)=>makeBody('rock','sphere',.07+rnd(i)*.4,[rnd(i+13)*7,rnd(i+67)*3,rnd(i+41)*5],[0,0,0]));
 input[0].held=true;input.push(makeBody('rock','sphere',2.5,[3,1,2],[0,0,0]));
 const ref=structuredClone(input),actual=structuredClone(input),a=separateBodies(ref),b=separateBodies(actual,new BoundsGrid());
 assert.deepEqual(actual,ref);assert.equal(a.contacts,b.contacts);assert.ok(b.tested<a.tested/3);
});
test('object/sand broad phase preserves contact results',()=>{
 const bodies=Array.from({length:30},(_,i)=>makeBody(i%2?'glass':'rock',i%3?'sphere':'cup',.12+rnd(i)*.3,[rnd(i+3)*3,rnd(i+9),rnd(i+15)*3],[.1,-.3,.1]));
 const sand=Array.from({length:70},(_,i)=>({...clump(i+1,[rnd(i+6)*3,rnd(i+12),rnd(i+18)*3]),anchored:i%2===0}));
 const b=structuredClone(bodies),s=structuredClone(sand);resolveSandContacts(sand,bodies,.03);resolveSandContacts(s,b,.03,new BoundsGrid());assert.deepEqual(s,sand);assert.deepEqual(b,bodies);
});
test('settled support history ignores moisture but invalidates for shape and bed changes',()=>{
 const bed=new SandBed(33);bed.base.fill(-.7);bed.parcels.push(clump(1,[0,.15,0]),clump(2,[0,.43,0]));bed.update();bed.releaseUnsupported();
 const rebuilt=bed.supportRebuilds;bed.parcels[0].wet=.6;bed.update();bed.releaseUnsupported();assert.equal(bed.supportRebuilds,rebuilt);
 bed.parcels[0].position[0]+=1;bed.update();bed.releaseUnsupported();assert.equal(bed.parcels[1].anchored,false);
 bed.base.fill(-2);bed.update();bed.releaseUnsupported();assert.equal(bed.parcels[0].anchored,false);
});
test('moisture updates reuse sand bins while contact movements invalidate shape data',()=>{
 const lab=new SandLab({extensions:{has:()=>false}});lab.sand.parcels.push(clump(1,[0,3,0]));lab.sand.update();lab.syncUniforms();const count=lab.sandBinRebuilds;
 lab.sand.parcels[0].wet=.41;lab.sand.update();lab.syncUniforms();assert.equal(lab.sandBinRebuilds,count);assert.ok(Math.abs(lab.u.uSandParcels.value.image.data[4]-.41)<1e-6);
 lab.sand.parcels[0].position[0]=3;lab.sand.touchShapes();lab.syncUniforms();assert.equal(lab.sandBinRebuilds,count+1);assert.ok(lab.solid([3,3,0],false,false)<0);assert.ok(lab.solid([0,3,0],false,false)>0);
});
test('tight Gaussian rectangles retain all previously surviving fragments',()=>{
 for(const cutoff of [.005,.0001])for(const alpha of [0,.00001,.001,.02,.05,.5,1])for(let x=-3;x<=3;x+=.09)for(let y=-3;y<=3;y+=.17){
  if(alpha*Math.exp(-.5*(x*x+y*y))>cutoff){const r=gaussianSupport(alpha,cutoff);assert.ok(Math.abs(x)<=r&&Math.abs(y)<=r);}
 }
});
test('macro maxima conservatively bound trilinear water density across tile edges',()=>{
 const l=fieldLayout(.25,.5,{min:[-1,-1,-1],max:[1,1.5,1.1]}),d=l.dimensions,data=new Float32Array(l.width*l.height*4);
 for(let y=0;y<d[1];y++)for(let z=0;z<d[2];z++)for(let x=0;x<d[0];x++){const px=y%l.columns*(d[0]+2)+1+x,py=Math.floor(y/l.columns)*(d[2]+2)+1+z;data[(py*l.width+px)*4]=rnd(x+y*31+z*371)>.8?.6:0;}
 fillMacroCPU(data,l);
 for(let i=0;i<1500;i++){const q=d.map((n,k)=>rnd(i*3+k)*(n-1)),c=q.map(v=>Math.floor(v/8)),m=c[0]+l.macro.size[0]*(c[1]+l.macro.size[1]*c[2]),rho=sampleFieldCPU(data,l,q.map((v,k)=>l.min[k]+v*l.dx))[0];assert.ok(rho<=data[(l.macro.offset*l.width+m)*4]+1e-8);}
});
test('lighting tiles cover history in four frames and reject explicit edits and paused changes',()=>{
 const tiles=new LightingTiles();assert.equal(tiles.plan(16,0,'a',0).full,true);const rows=new Set();
 for(let i=1;i<=4;i++){const p=tiles.plan(16,i/60,'a',i);assert.equal(p.full,false);for(const [a,n] of p.ranges)for(let j=a;j<a+n;j++)rows.add(j);}
 assert.equal(rows.size,16);assert.equal(tiles.plan(16,.1,'edit',5).blend,1);assert.equal(tiles.plan(16,.1,'edit',6,true).full,true);assert.equal(tiles.plan(16,.1,'edit',6,true),null);assert.equal(tiles.plan(16,.5,'edit',7).full,true);
});
