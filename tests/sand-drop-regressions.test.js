import test from 'node:test';
import assert from 'node:assert/strict';
import {SandLab} from '../src/sand-lab/lab.js';
import {SandBed} from '../src/sand-lab/sand.js';
import {shapeRadius,shapeDistance,cutShape} from '../src/sand-lab/sand-shape.js';
import {buildSandBins,sandCell} from '../src/sand-lab/sand-bins.js';
const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
const flat=(n=65)=>{const b=new SandBed(n);b.base.fill(-.7);b.update();return b;};
const add=(b,position,r,aspect=1,wet=0)=>{const p={id:b.nextId++,position,velocity:[0,0,0],mass:4*Math.PI/3*r**3*aspect*.56,packing:.56,wet,memory:wet,aspect};b.parcels.push(p);return p;};
const step=(b,seconds)=>{for(let i=0;i<seconds*30;i++)b.step(1/30,air,calm,10);};

test('flattened smooth sand stays continuous across bin and global-bound edges',()=>{
 const lab=new SandLab({extensions:{has:()=>false}}),b=lab.sand;b.base.fill(-.7);b.parcels=[];
 const p=add(b,[0,.08,0],.5,.32);p.surfaceBlend=.18;b.update();lab.syncUniforms();
 // The old bounds ended at x=.68 and cut a still-negative sand SDF to empty.
 for(let x=.3;x<1.08;x+=.007)for(const z of [-.31,0,.31])for(const y of [.002,.02,.04]){
  const q=[x,y,z];assert.ok(Math.abs(lab.solid(q,false,false)-b.distance(q))<1e-10,`seam at ${q}`);
 }
 assert.ok(lab.solid([.7,.04,0],false,false)<0);
 for(const x of [11/32,22/32,33/32]){const e=.000001,a=lab.solid([x-e,.02,0],false,false),c=lab.solid([x+e,.02,0],false,false);assert.ok(Math.abs(a-c)<.00001);}
});

test('crowded sand bins keep local indices without a whole-scene fallback',()=>{
 const b=flat();for(let i=0;i<60;i++)add(b,[i<24?.01*(i%4):-3+(i%6)*.1,1,i<24?.01*Math.floor(i/4):3+.1*Math.floor(i/6)],.05);
 const bins=buildSandBins(b.parcels),cell=sandCell([0,1,0])*4,offset=bins.headers[cell],count=bins.headers[cell+1];
 assert.equal(count,24);assert.deepEqual([...bins.indices.subarray(offset,offset+count)],Array.from({length:24},(_,i)=>i));
 assert.ok(bins.maxCount>=24);assert.equal(bins.indices.length%256,0);
});

test('a large high-resolution scoop does not multiply into hundreds of landing patches',()=>{
 for(const n of [65,129,257]){
  const b=flat(n),initial=b.totalMass(),ps=b.extract([0,0,0],1.8,[0,0,0],true);assert.ok(ps.length<=24);
  b.wet.fill(.95);b.memory.fill(.95);for(const p of ps){p.held=false;p.position[1]+=1;p.wet=p.memory=0;}
  for(let i=0;i<90;i++){b.step(1/30,air,calm,10);assert.ok(b.parcels.length<=24,'already resolved scoop must not subdivide again');}
  assert.ok(Math.abs(b.totalMass()-initial)<1e-8);assert.ok(b.parcels.every(p=>p.wet===0&&p.memory===0));
 }
});

test('released carved dry shells break into loose stock, while wet CSG keeps its shape',()=>{
 for(const wet of [0,.95]){
  const b=flat(),p=add(b,[0,1,0],.3,1,wet);cutShape(p,[0,.78,0],.33);p.mass*=.9;p.held=true;
  const initial=b.totalMass(),cuts=p.cuts;step(b,.1);assert.equal(p.cuts,cuts,'held selection stays intact');
  p.held=false;step(b,5);
  if(wet===0){assert.ok(b.parcels.every(q=>!q.cuts?.length),'dry geometry cannot remain a rigid carved shell');assert.ok(b.parcels.length<=24);assert.ok(b.parcels.every(q=>q.position[1]<.3),'no dry shell remains overhanging');}
  else{assert.equal(p.cuts,cuts);assert.ok(p.anchored);assert.ok(shapeDistance(p,p.position.map((v,k)=>v+(k===1?.2:0)))<0);}
  assert.ok(Math.abs(b.totalMass()-initial)<1e-9);
 }
});

test('regrabbing and dropping resolved dry layers stays bounded and conserves material',()=>{
 const b=flat(),base=add(b,[0,.3,0],.3,1,.95);b.deposit(base,base.mass);add(b,[0,1,0],.22);step(b,6);const initial=b.totalMass();
 for(let i=0;i<5;i++){
  const dry=b.parcels.find(p=>p!==base);if(!dry)break;
  const r=shapeRadius(dry),point=dry.position.map((v,k)=>v+(k===0?r*.5:0));
  const ps=b.extract(point,r*.8,[0,0,0],true);for(const p of ps){p.position[0]+=.8;p.position[1]+=.4;p.held=false;}step(b,3);
  assert.ok(b.parcels.length<=40);assert.ok(Math.abs(b.totalMass()-initial)<1e-9);
 }
});
