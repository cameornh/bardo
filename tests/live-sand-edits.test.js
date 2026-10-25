import test from 'node:test';
import assert from 'node:assert/strict';
import {SandBed} from '../src/sand-lab/sand.js';
import {shapeHeight,shapeDistance} from '../src/sand-lab/sand-shape.js';
import {SandEditPolicy,EDIT_CUT_LIMIT} from '../src/rtx-sand-lab/sand-edit-policy.js';
import {LiveSandLab} from '../src/rtx-sand-lab/live-lab.js';
const near=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const air=()=>({density:0,velocity:[0,0,0]}),calm=()=>[0,0,0];
export function editFixture(live=true){
 const b=new SandBed(65);if(live)b.editPolicy=new SandEditPolicy();
 b.base.fill(-.7);b.wet.fill(.9);b.memory.fill(.9);b.optimizations={fastHeight:true,settlingIndex:true,broadphase:true,sandCache:true,windBatch:true,stressPruning:true,patchFloor:true};b.update();
 const p={id:b.nextId++,mass:4*Math.PI/3*.65**3*.56,packing:.56,wet:.9,memory:.9,position:[0,.45,0],velocity:[0,0,0],anchored:true};b.parcels.push(p);b.update();return b;
}
export function editCycle(b,i){
 const a=i*2.3999632297,point=[Math.cos(a)*.44,.69+.12*Math.sin(i*1.7),Math.sin(a)*.44],ps=b.extract(point,.19,[0,0,0],true);
 for(const q of ps){q.held=false;q.anchored=true;q.position=[1.5+(i%5)*.06,shapeHeight(q)+.002,1+Math.floor(i%20/5)*.06];}b.update();return ps;
}
const totals=b=>{
 let wet=0,memory=0,volume=0;
 for(let k=0;k<b.mass.length;k++){wet+=b.mass[k]*b.wet[k];memory+=b.mass[k]*b.memory[k];volume+=b.mass[k]/b.packing[k];}
 for(const p of b.parcels){wet+=p.mass*p.wet;memory+=p.mass*(p.memory||0);volume+=p.mass/p.packing;}
 return [b.totalMass(),wet,memory,volume];
};
test('400 partial grab/drop edits have bounded cut history and preserve all material ledgers',()=>{
 const b=editFixture(),stock=totals(b),counts=[];
 for(let i=0;i<400;i++){
  editCycle(b,i);assert.ok(b.parcels.every(p=>(p.cuts?.length||0)<=EDIT_CUT_LIMIT));
  if(i%40===39)counts.push(b.parcels.length);
 }
 totals(b).forEach((v,k)=>near(v,stock[k]));
 assert.ok(b.editPolicy.rebuilt>0);assert.ok(b.editPolicy.returned>0);
 assert.ok(Math.max(...counts)<240,`parcel growth: ${counts}`);
 assert.ok(counts.at(-1)<counts[1]*1.6,`late edit growth: ${counts}`);
});
test('old cut detail is resampled only inside occupied source stock; held stock is unchanged',()=>{
 const b=editFixture(),p=b.parcels[0];
 p.cuts=Array.from({length:13},(_,i)=>({offset:[.45*Math.cos(i),.2,.45*Math.sin(i)],radius:.15}));
 const original={...p,position:p.position.slice()},stock=totals(b),held={...p,id:b.nextId++,position:[2,2,2],held:true};b.parcels.push(held);
 b.editPolicy.maintain(b);
 assert.equal(held.cuts,original.cuts);assert.equal(held.mass,original.mass);
 const packets=b.parcels.filter(q=>q!==held);assert.ok(packets.length>1&&packets.length<=125);
 for(const q of packets){assert.ok(!q.cuts?.length);assert.ok(shapeDistance(original,q.position)<=1e-12);near(q.wet,.9);near(q.memory,.9);near(q.packing,.56);}
 b.parcels=b.parcels.filter(q=>q!==held);totals(b).forEach((v,k)=>near(v,stock[k]));
});
test('continuous carving preserves removed-stock accounting without a growing operation log',()=>{
 const b=editFixture(),stock=b.totalMass();
 for(let i=0;i<160;i++){
  const a=i*2.3999632297;b.carve([.55*Math.cos(a),.7,.55*Math.sin(a)],.13);
  near(b.totalMass()+b.removedMass,stock);assert.ok(b.parcels.every(p=>(p.cuts?.length||0)<=EDIT_CUT_LIMIT));
 }
});
test('a partial cut exhausting the remaining stock still drops inherited history',()=>{
 const b=editFixture(),p=b.parcels[0];p.shapeRadius=.65;p.mass=1e-8;
 p.cuts=Array.from({length:12},()=>({offset:[0,-.5,0],radius:.1}));
 const q=b.editPolicy.cut(p,[.5,.45,0],.2);assert.ok(q&&q.mass>0);assert.equal(p.mass,0);assert.ok(!q.cuts?.length);near(q.mass,1e-8,1e-14);
});
test('tiny settled deposits merge conservatively but unlike layers and raised sand remain explicit',()=>{
 const b=editFixture();b.parcels=[];const grain=(id,x,y,wet,memory=wet)=>({id,mass:.0004,packing:.61,wet,memory,position:[x,y,0],velocity:[0,0,0],anchored:true,looseResolved:true});
 const dry=grain(1,0,.055,0),wet=grain(2,0,.15,.9),raised=grain(3,2,1,.9),a=grain(4,2,1,.35),c=grain(5,2.01,1,.37);
 b.parcels.push(dry,wet,raised,a,c);const stock=totals(b);b.editPolicy.maintain(b);totals(b).forEach((v,k)=>near(v,stock[k]));
 assert.ok(dry.mass>0&&dry.wet===0);assert.ok(wet.mass>0&&wet.wet===.9);assert.ok(raised.mass>0&&raised.position[1]===1);assert.equal(c.mass,0);assert.ok(a.wet>.35&&a.wet<.37);
});
test('live editing retains dry settling and wet support during a repeated pickup soak',()=>{
 const b=new SandBed(33);b.editPolicy=new SandEditPolicy();b.base.fill(-.7);b.wet.fill(.95);b.memory.fill(.95);b.update();const stock=b.totalMass();let max=0;
 for(let pass=0;pass<40;pass++){
  const ps=b.extract([0,b.height(0,3),3],.23,[0,0,0],true);
  for(const p of ps){p.wet=0;p.memory=0;p.position[1]+=.4;p.held=false;}
  for(let i=0;i<24;i++)b.step(1/30,air,calm,10,0,.08);
  max=Math.max(max,b.parcels.length);near(b.totalMass(),stock);
 }
 assert.ok(max<80,`active parcels: ${max}`);assert.ok(b.parcels.every(p=>p.position[1]<1.8));
});
test('a stationary held handful does not invalidate terrain; moving it still does',()=>{
 const lab={sandHeld:[{position:[1,2,4],offset:[0,0,1]}],sandHoldDistance:3,revision:7,lightEditRevision:4};
 LiveSandLab.prototype.moveHeld.call(lab,[1,2,0],[0,0,1]);assert.equal(lab.revision,7);assert.equal(lab.lightEditRevision,4);
 lab.sand={update(){this.updated=true;}};
 LiveSandLab.prototype.moveHeld.call(lab,[2,2,0],[0,0,1]);assert.deepEqual(lab.sandHeld[0].position,[2,2,4]);assert.ok(lab.sand.updated);assert.equal(lab.revision,8);
});
