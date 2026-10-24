import test from 'node:test';
import assert from 'node:assert/strict';
import {InteriorWaterCompression,distanceDetail,stableDrawingSize,traceDensityInterval} from '../src/sand-lab/adaptive-water-detail.js';
import {reconstructionSample} from '../src/sand-lab/reconstruction.js';
import {LabRain} from '../src/sand-lab/water-lab-rain.js';
import {makeBody} from '../src/sand-lab/objects.js';
import {SURFACE_DROP_OPACITY} from '../src/sand-lab/surface-drop-renderer.js';
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
import {waterFixture} from './sand-adaptive-fixture.js';
const ledger=items=>items.reduce((a,p)=>{a[0]+=p.volume;for(let k=0;k<3;k++){a[k+1]+=p.volume*p.position[k];a[k+4]+=p.volume*(p[['dye','tannin','sediment'][k]]||0);}return a;},Array(7).fill(0));
test('quiet surrounded water conserves volume, centroid and solutes throughout its continuous blend',()=>{
 const {items,lab}=waterFixture(),before=structuredClone(items),c=new InteriorWaterCompression(),expected=ledger(items);let out;
 for(let k=0;k<30;k++){out=c.update(items,lab,1/30);ledger(out).forEach((v,k)=>near(v,expected[k],1e-9));}
 assert.ok(out.length<items.length*.8);assert.ok(c.stats.estimatedVoxelWork<.8);assert.deepEqual(items,before);
 for(const p of items)if(p.position.some(v=>v<.4||v>2))assert.ok(out.includes(p),'surface shell stays exact');
});
test('surface crossings stay fixed after interior compression',()=>{
 const {items,lab}=waterFixture(),c=new InteriorWaterCompression();let out;for(let i=0;i<10;i++)out=c.update(items,lab,.1);
 const density=(field,p)=>field.reduce((v,q)=>v+reconstructionSample(q,p),0);
 for(const x of [.3,.9,1.5,2.1])for(const z of [.3,1.1,1.9]){
  const root=field=>{let lo=2.2,hi=2.8;for(let i=0;i<20;i++){const m=(lo+hi)/2;if(density(field,[x,m,z])>.18)lo=m;else hi=m;}return (lo+hi)/2;};
  near(root(out),root(items),lab.spacing*.005);
 }
});
test('fast water, sheets and strong chemical boundaries retain fine kernels',()=>{
 for(const mode of ['fast','sheet','chemical']){
  const f=waterFixture();if(mode==='fast')for(const p of f.items)f.lab.velocities[p.sourceIndex*4]=2;
  if(mode==='sheet')f.items=f.items.filter(p=>p.position[1]<.4);
  if(mode==='chemical')for(const p of f.items)p.dye=p.sourceIndex%2;
  const c=new InteriorWaterCompression();let out;for(let i=0;i<12;i++)out=c.update(f.items,f.lab,.1);assert.equal(out.length,f.items.length);
 }
});
test('compression wakes smoothly without losing mass, with no camera input',()=>{
 const {items,lab}=waterFixture(),c=new InteriorWaterCompression();for(let i=0;i<10;i++)c.update(items,lab,.1);
 const count=c.stats.kernels;lab.velocities.fill(.2);const output=c.update(items,lab,.001);assert.ok(output.length>count);
 near(ledger(output)[0],ledger(items)[0]);const phase=[...c.groups.values()].map(g=>g.phase);assert.ok(phase.some(w=>w>0&&w<1));
 lab.camera={position:[1e6,-1e6,0]};const frozen=c.update(items,lab,0);assert.deepEqual(frozen,output);
 for(let i=0;i<6;i++)c.update(items,lab,.1);assert.equal(c.stats.kernels,items.length);
});
test('distance reduction is continuous, monotone and does not resize the pixel grid',()=>{
 for(const motion of [1,2,10]){let last=distanceDetail(.1,.2,320,motion);for(let d=.101;d<70;d+=.001){const value=distanceDetail(d,.2,320,motion);assert.ok(value>=last-1e-12);assert.ok(value-last<.002);last=value;}}
 assert.deepEqual(stableDrawingSize(960,640,true),{width:480,height:320,scale:.5});
 assert.deepEqual(stableDrawingSize(960,640,false),{width:960,height:640,scale:1});
 assert.deepEqual(stableDrawingSize(960,640,true,.5),{width:480,height:320,scale:.5});
});
test('saturated sand and player never accumulate visible water or exhaust the rainfall capacity',()=>{
 for(const player of [false,true]){
  const lab={sand:{materialAt:()=>1},balls:[],player:player?{}:null,playerDistance:()=>0,spacing:.2,count:0,spec:{scale:10},particleBudget:100};
  const rain=new LabRain(lab),hit={point:[0,0,0],normal:[0,1,0],particle:-1};
  for(let i=0;i<200;i++)rain.impact({volume:.01,velocity:[0,-1,0]},hit);
  rain.surfaceDrops.step(1);rain.releaseDeposits();assert.equal(rain.deposits.size,0);assert.equal(rain.fieldItems().length,0);assert.equal(rain.transferred,0);near(rain.surfaceDrops.drained,2);near(rain.unresolvedVolume-rain.surfaceDrops.absorbed-rain.surfaceDrops.drained,0);
  rain.deposits.set('legacy',{volume:1,particle:-1,point:[0,0,0],normal:[0,1,0]});assert.equal(rain.fieldItems().length,0);rain.releaseDeposits();assert.equal(rain.deposits.size,0);near(rain.surfaceDrops.drained,3);
 }
});
test('objects still form condensation and water impacts still have a bulk-water reservoir',()=>{
 const b=makeBody('rock','sphere',1,[0,0,0]),lab={sand:{materialAt:()=>1},balls:[b],spacing:.2,count:0,spec:{scale:10},particleBudget:100},rain=new LabRain(lab);
 rain.surfaceDrops.impact({volume:.0001},{point:[0,1,0],normal:[0,1,0],particle:-1});assert.equal(rain.surfaceDrops.patches.size,1);assert.equal(rain.surfaceDrops.drained,0);
 rain.addWaterDeposit([0,0,0],.001);assert.equal(rain.deposits.size,1);near(rain.depositVolume,.0011);
 assert.equal(SURFACE_DROP_OPACITY,.38/2);
});
test('camera sweeps retain accurate surface positions and thickness with larger distant steps',()=>{
 const density=p=>p[1]>=0&&p[1]<=1?1:0;
 let maxError=0,maxThicknessChange=0,last=null;
 for(let i=0;i<200;i++){
  const angle=-.12+i*.0012,ray=[Math.sin(angle),-Math.cos(angle),0],eye=[0,20+i*.01,0],trace=traceDensityInterval(density,eye,ray,{spacing:.2,motion:3,limit:30});
  assert.notEqual(trace.entry,null);assert.notEqual(trace.exit,null);
  maxError=Math.max(maxError,Math.abs(trace.entry-(eye[1]-1)/-ray[1]),Math.abs(trace.exit-eye[1]/-ray[1]));
  const thickness=trace.exit-trace.entry;if(last!==null)maxThicknessChange=Math.max(maxThicknessChange,Math.abs(thickness-last));last=thickness;
 }
 assert.ok(maxError<.0003,`${maxError}`);assert.ok(maxThicknessChange<.001,`${maxThicknessChange}`);
});
