import test from 'node:test';
import assert from 'node:assert/strict';
import {rainVisualCount,rainDropRadius,rainVisualPoint,rainSegments,RAIN_VISUAL_LIMIT} from '../src/sand-lab/rain-appearance.js';
import {LabRain} from '../src/sand-lab/water-lab-rain.js';
import {LabDetail} from '../src/sand-lab/water-lab-detail.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('high rainfall gets many independent visual drops while keeping a bounded budget and narrow minimum sizes',()=>{
 const counts=[5,100,1000,12000].map(rate=>rainVisualCount(rate,10,2.2));
 for(let i=1;i<counts.length;i++)assert.ok(counts[i]>counts[i-1]);assert.equal(counts.at(-1),RAIN_VISUAL_LIMIT);
 for(const scale of [.01,1,10,20])assert.ok(rainDropRadius(scale,1)/rainDropRadius(scale,0)<1.13);
 const bins=new Uint32Array(100);for(let i=0;i<100000;i++){const [x,y,z]=rainVisualPoint(i,17.3,[1.8,-.9,.24]);assert.ok(x>=-5.5&&x<5.5&&z>=-4.9&&z<4.9&&y>=-.80001&&y<=8.5);bins[Math.min(9,Math.floor((x+5.5)/11*10))+Math.min(9,Math.floor((z+4.9)/9.8*10))*10]++;}
 assert.ok(Math.min(...bins)>850);assert.ok(Math.max(...bins)<1150);
});
test('periodic rain sweeps split at edges, preserve travel, and never cut across the middle',()=>{
 for(const [a,b] of [[[5.4,4,0],[5.8,3,0]],[[-5.4,4,4.8],[-6,3,5.4]],[[5,8,4],[29,0,23]]]){
  const segments=rainSegments(a,b),length=segments.reduce((sum,[p,q])=>sum+Math.hypot(...q.map((v,k)=>v-p[k])),0);close(length,Math.hypot(...b.map((v,k)=>v-a[k])));
  for(const [p,q] of segments)for(const r of [p,q])assert.ok(Math.abs(r[0])<=5.5+1e-8&&Math.abs(r[2])<=4.9+1e-8);
 }
 const s=rainSegments([5.4,4,0],[5.8,3,0]);assert.equal(s.length,2);close(s[1][0][0],-5.5);close(s[1][1][0],-5.2);
});
function fixture(){return {sand:{materialAt:()=>1},kind:'ocean',spec:{scale:10},spacing:.2,positions:new Float32Array(0),velocities:new Float32Array(0),chem:new Float32Array(0),neighborCounts:new Uint16Array(0),get count(){return this.positions.length/4},particleBudget:32768,wind:0,time:0,motion:{position:[0,0,0],tilt:0,spin:0,pitch:0},solid:(p,player,bounded)=>bounded===false?p[1]:Math.min(p[1],5.5-Math.abs(p[0]),4.9-Math.abs(p[2])),collide:p=>p,balls:[]};}
test('rain covers the complete ground footprint and conserves its physical precipitation flux',()=>{
 const lab=fixture(),r=new LabRain(lab);r.reset('ocean');r.enabled=true;r.rate=12000;close(r.skyArea,11*9.8);
 for(let i=0;i<120;i++)r.step(1/60);
 close(r.emitted+r.sourceVolume,r.flux*2);close(r.emitted,r.airborneVolume+r.depositVolume+r.transferred);
 assert.ok(r.drops.some(p=>Math.abs(p.position[0])>5));assert.ok(r.drops.some(p=>Math.abs(p.position[2])>4.5));
});
test('physical rain wraps without hitting confinement walls or changing the packet volume',()=>{
 const lab=fixture(),r=new LabRain(lab);r.drops=[{position:[5.49,4,0],velocity:[3,-.9,0],volume:.00001}];r.step(.1);
 assert.equal(r.hits,0);assert.equal(r.drops.length,1);assert.ok(r.drops[0].position[0]<-5);close(r.airborneVolume,.00001);
});
test('hard wet receivers generate more impact mist at ordinary terminal rain speed',()=>{
 const lab=fixture(),counts=[];
 for(const hardness of [0,1]){const d=new LabDetail({extensions:{has:()=>false}},256);d.density=1;d.impact([0,0,0],[0,1,0],[0,-.9,0],.001,lab,hardness);counts.push(d.mistEmitted);d.dispose?.();}
 assert.ok(counts[1]>counts[0]*2);assert.ok(counts[1]>0);
});

import {exposureStatistics,exposureTarget} from '../src/sand-lab/sky-exposure.js';
test('a thin illuminated horizon limits dark adaptation even when almost all pixels are black sky',()=>{
 const frame=new Float32Array(4000).fill(1e-10);for(let i=0;i<10;i++)frame.set([.0001,.00008,.00005,1],i*4);
 const stats=exposureStatistics(frame),gain=exposureTarget(stats);assert.ok(gain>1);assert.ok(gain*stats[2]<=.800001);
 assert.equal(exposureTarget(exposureStatistics(new Float32Array([1,1,1,1]))),1);
 assert.ok(exposureTarget(exposureStatistics(new Float32Array([1e-10,1e-10,1e-10,1])))>1e7);
});
