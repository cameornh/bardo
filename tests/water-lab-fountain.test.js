import test from 'node:test';
import assert from 'node:assert/strict';
import {FOUNTAIN_DEFAULTS,FOUNTAIN_PRESET,FOUNTAIN_BASINS,fountainDistance,fountainNozzles,fountainInlet,seedFountain,pumpFountain} from '../src/water-lab-fountain.js';
import {WaterLab} from '../src/water-lab.js';
import {LAB_IDS,fixtureDistance,createMotion,normalAt} from '../src/water-lab-model.js';
const mock={extensions:{has:()=>false}};
test('fountain is appended without changing the existing station IDs',()=>assert.deepEqual(LAB_IDS,['pipe','waterfall','pool','tank','river','glass','ocean','pane','fountain']));
test('each fountain basin has a solid floor and rim, an open interior and a spill route',()=>{
 for(const {radius:R,bottom:h} of FOUNTAIN_BASINS){assert.ok(fountainDistance([R*.7,h+.28*.49-.08,0])<0);assert.ok(fountainDistance([R-.10,h+.40,0])<0);assert.ok(fountainDistance([R*.7,h+.40,0])>.15);assert.ok(fountainDistance([R+.25,h+.75,0])>0);}
 assert.ok(fountainDistance([0,3.2,0])<0);assert.ok(normalAt([0,5.69,0],fountainDistance).every(Number.isFinite));
});
test('fountain seed and all nozzle stencils stay outside metal and within the bounded volume',()=>{
 const seed=seedFountain(),s=FOUNTAIN_PRESET.spacing;assert.ok(seed.length>1500&&seed.length<8192);
 for(const p of seed)assert.ok(fixtureDistance(p.p,'fountain',createMotion())>s*.42-1e-6);
 for(const scale of [.2,2,20])for(const angle of [10,32,70])for(const jet of fountainNozzles({...FOUNTAIN_DEFAULTS,angle},scale))for(let i=0;i<10;i++){const q=fountainInlet(jet,.14,i,1,2);assert.ok(fountainDistance(q.point)>.06);assert.ok([...q.point,...q.velocity,q.rate].every(Number.isFinite));}
});
test('pump controls turn off independent groups; physical jet head scales with gravity',()=>{
 const off=fountainNozzles({...FOUNTAIN_DEFAULTS,crown:0,arcs:0,lower:0});assert.equal(off.length,0);
 assert.equal(fountainNozzles({...FOUNTAIN_DEFAULTS,crown:0}).length,20);
 const a=fountainNozzles(FOUNTAIN_DEFAULTS,2),b=fountainNozzles(FOUNTAIN_DEFAULTS,8);assert.equal(a.length,21);assert.ok(Math.abs(a[0].speed/b[0].speed-2)<1e-12);
 const low=fountainNozzles({...FOUNTAIN_DEFAULTS,angle:10}),high=fountainNozzles({...FOUNTAIN_DEFAULTS,angle:70});assert.ok(high[1].direction[1]>low[1].direction[1]);
 const smooth=fountainInlet(a[0],.21,2,0,0),rough=fountainInlet(a[0],.21,2,0,2);assert.equal(smooth.velocity[0],0);assert.ok(Math.hypot(rough.velocity[0],rough.velocity[2])>0);
});
test('recirculation conserves liquid, dye and held water, and disabled pumps accumulate no backlog',()=>{
 const lab=new WaterLab(mock);lab.configure('fountain');lab.detail.enabled=false;const volume=lab.volume,n=lab.count;lab.chem.fill(.2);lab.positions[3]=1;const held=lab.positions.slice(0,4);for(let i=1;i<n;i++)if(lab.positions[i*4+1]>1)lab.positions[i*4+1]=.8;
 for(let k=0;k<12;k++)pumpFountain(lab,1/30);assert.ok(lab.fountainRecycled>0);assert.equal(lab.count,n);assert.equal(lab.volume,volume);assert.deepEqual(lab.positions.slice(0,4),held);
 for(let i=0;i<n;i++)for(let k=0;k<3;k++)assert.ok(Math.abs(lab.chem[i*4+k]-.2)<1e-7);
 Object.assign(lab.fountain,{crown:0,arcs:0,lower:0});const before=lab.positions.slice(),recycled=lab.fountainRecycled;for(let k=0;k<20;k++)pumpFountain(lab,1/30);assert.equal(lab.fountainRecycled,recycled);assert.deepEqual(lab.positions,before);
});

import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LAB_PRESETS,seedWater,opaqueDistance,vesselDistance} from '../src/water-lab-model.js';
test('existing water stations retain their pre-fountain seeds, dimensions and collision fields',()=>{
 const baseline=JSON.parse(readFileSync(new URL('./fixtures/water-stations-before-fountain.json',import.meta.url))),digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 for(const [kind,expected] of Object.entries(baseline)){assert.deepEqual(LAB_PRESETS[kind],expected.preset);assert.equal(digest(seedWater(kind)),expected.seed,kind+' seed');const values=[],motion=createMotion();motion.tilt=.67;motion.spin=.51;motion.pitch=-.3;
 for(let i=0;i<256;i++){const p=[(i*17%97)/97*12-6,(i*31%89)/89*10-1,(i*13%83)/83*(kind==='river'?120:12)-(kind==='river'?60:6)];values.push(fixtureDistance(p,kind,motion),opaqueDistance(p,kind),vesselDistance(p,kind,motion));}assert.equal(digest(values),expected.distances,kind+' geometry');}
});
test('fountain fine-particle budget is isolated and old stations recover their original system',()=>{
 const lab=new WaterLab(mock),original=lab.detail;lab.configure('fountain');const fountain=lab.detail;assert.notEqual(fountain,original);assert.equal(fountain.capacity,32768);lab.configure('pool');assert.equal(lab.detail,original);assert.equal(original.capacity,131072);lab.configure('fountain');assert.equal(lab.detail,fountain);
});
test('default ring trajectories land inside the receiving basin before wall interaction',()=>{
 const g=9.81/FOUNTAIN_PRESET.scale;for(const jet of fountainNozzles()){if(jet.group==='crown')continue;const basin=FOUNTAIN_BASINS[jet.group==='arcs'?1:0],v=jet.direction.map(x=>x*jet.speed),drop=jet.point[1]-(basin.bottom+.50),t=(v[1]+Math.sqrt(v[1]**2+2*g*drop))/g,r=Math.hypot(jet.point[0]+v[0]*t,jet.point[2]+v[2]*t);assert.ok(r<basin.radius-.08,`${jet.group} ${r}`);}
});
