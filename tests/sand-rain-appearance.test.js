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
function fixture(){return {sand:{materialAt:()=>1},kind:'ocean',spec:{scale:10},spacing:.2,positions:new Float32Array(0),velocities:new Float32Array(0),chem:new Float32Array(0),neighborCounts:new Uint16Array(0),get count(){return this.positions.length/4},particleBudget:32768,wind:0,time:0,motion:{position:[0,0,0],velocity:[0,0,0],tilt:0,spin:0,pitch:0,tiltVelocity:0,spinVelocity:0,pitchVelocity:0},solid:(p,player,bounded)=>bounded===false?p[1]:Math.min(p[1],5.5-Math.abs(p[0]),4.9-Math.abs(p[2])),collide:p=>p,balls:[]};}
test('rain covers the complete ground footprint and conserves its physical precipitation flux',()=>{
 const lab=fixture(),r=new LabRain(lab);r.reset('ocean');r.enabled=true;r.rate=12000;close(r.skyArea,11*9.8);
 const points=[],impact=r.impact.bind(r);r.impact=(drop,hit)=>{points.push(hit.point);impact(drop,hit);};
 for(let i=0;i<120;i++)r.step(1/60);
 close(r.emitted+r.sourceVolume,r.flux*2);close(r.emitted,r.airborneVolume+r.depositVolume+r.transferred);
 assert.ok(points.some(p=>Math.abs(p[0])>5));assert.ok(points.some(p=>Math.abs(p[2])>4.5));
});
test('physical rain wraps without hitting confinement walls or changing the packet volume',()=>{
 const lab=fixture(),r=new LabRain(lab);r.drops=[{position:[5.49,4,0],velocity:[3,-.9,0],volume:.00001}];r.step(.1);
 assert.equal(r.hits,0);assert.equal(r.drops.length,1);assert.ok(r.drops[0].position[0]<-5);close(r.airborneVolume,.00001);
});
test('hard wet receivers generate more impact mist at ordinary terminal rain speed',()=>{
 const lab=fixture(),counts=[];
 for(const hardness of [0,1]){const d=new LabDetail({extensions:{has:()=>false}},256);d.density=1;d.impact([0,0,0],[0,1,0],[0,-.9,0],.001,lab,hardness);counts.push(Math.abs(d.spawn[2].image.data[18]));d.dispose?.();}
 assert.ok(counts[1]>counts[0]*1.8);assert.ok(counts[1]>0);
});

import {exposureStatistics,exposureTarget} from '../src/sand-lab/sky-exposure.js';
test('a thin illuminated horizon limits dark adaptation even when almost all pixels are black sky',()=>{
 const frame=new Float32Array(4000).fill(1e-10);for(let i=0;i<10;i++)frame.set([.0001,.00008,.00005,1],i*4);
 const stats=exposureStatistics(frame),gain=exposureTarget(stats);assert.ok(gain>1);assert.ok(gain*stats[2]<=.800001);
 assert.equal(exposureTarget(exposureStatistics(new Float32Array([1,1,1,1]))),1);
 assert.ok(exposureTarget(exposureStatistics(new Float32Array([1e-10,1e-10,1e-10,1])))>1e7);
});

import {detailOpacity} from '../src/sand-lab/water-lab-detail-opacity.js';
import {causticReceiver,causticMoment} from '../src/sand-lab/caustic-receiver.js';
test('rain impacts start on the first step and stop without an airborne queue; mass remains accounted for',()=>{
 const lab=fixture(),rain=new LabRain(lab);rain.reset('ocean');rain.enabled=true;rain.rate=12000;
 rain.step(.05);assert.ok(rain.hits>0);assert.equal(rain.drops.length,0);const hits=rain.hits;rain.enabled=false;
 for(let i=0;i<20;i++)rain.step(.05);assert.equal(rain.hits,hits);close(rain.emitted,rain.transferred+rain.unresolvedVolume);
});
test('existing water gets no stationary rain kernels and inserted volume stays beneath the surface',()=>{
 const lab=fixture(),positions=[];for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)for(let y=1;y<=4;y++)positions.push(x*.2,y*.2,z*.2,0);
 lab.positions=new Float32Array(positions);lab.velocities=new Float32Array(positions.length);lab.chem=lab.velocities.slice();lab.neighborCounts=new Uint16Array(lab.count);
 const rain=new LabRain(lab);rain.reset('ocean');rain.buildSurfaceIndex();rain.impact({velocity:[0,-.9,0],volume:.04},{point:[0,.884,0],normal:[0,1,0],particle:0});
 assert.equal(rain.fieldItems().length,0);const initial=lab.count;rain.releaseDeposits();assert.ok(lab.count>initial);
 for(let i=initial;i<lab.count;i++)assert.ok(lab.positions[i*4+1]<.8);close(rain.transferred+rain.depositVolume,.04);
});
test('rain impacts gain 50% opacity while broader mist lingers and expires',()=>{
 const lab=fixture(),d=new LabDetail({extensions:{has:()=>false}},256);lab.time=0;lab.wind=0;lab.turbulence=0;
 d.impact([0,.5,0],[0,1,0],[0,-.9,0],.001,lab,1);assert.equal(d.pending,5);
 const info=d.spawn[2].image.data;close(detailOpacity(0,.1,.65,info[2])/detailOpacity(0,.1,.65,.65),.375);
 assert.ok(info[16]*10>=3.2&&info[16]*10<=4.8);assert.ok(Math.abs(info[18])<.03);
 for(let i=0;i<130;i++){lab.time+=.1;d.advance(.1,lab);}assert.equal(d.count,0);d.dispose();
});
test('caustic flux stays on its receiving surface and filters continuously between photon footprints',()=>{
 const flux=[2,.7,.2],at=[...flux,causticMoment(flux,.4)];assert.deepEqual(causticReceiver(at,.4),flux);
 assert.deepEqual(causticReceiver(at,1.5),[0,0,0]);assert.deepEqual(causticReceiver(at,-.2),[0,0,0]);
 let previous=0;for(let i=0;i<=100;i++){const t=i/100,sample=at.map(v=>v*t),actual=causticReceiver(sample,.4)[0];assert.ok(Math.abs(actual-previous)<=.020001);previous=actual;}
});

import {sprayShadowKernel} from '../src/sand-lab/water-lab-spray-shadows.js';
test('rain mist uses the same shallow covariance for its light transmission and visible footprint',()=>{
 const layout={axes:[[1,0,0],[0,0,1],[0,1,0]],span:[10,10,10],size:256};
 const spherical=sprayShadowKernel([0,1,0,.2],[1,0,0,4],[.3,3,.02,1],layout);
 const rain=sprayShadowKernel([0,1,0,.2],[1,0,0,4],[.3,3,-.02,1],layout);
 close(rain.xx,spherical.xx);close(rain.yy,spherical.yy);close(rain.sigma/spherical.sigma,.22);close(rain.tau,spherical.tau);
 const side={...layout,axes:[[1,0,0],[0,1,0],[0,0,1]]},thin=sprayShadowKernel([0,1,0,.2],[1,0,0,4],[.3,3,-.02,1],side);
 assert.ok(thin.yy<thin.xx*.07);assert.ok(thin.det>0&&thin.tau>0);
});

import {terrainGradient} from '../src/sand-lab/terrain-gradient.js';
import {SandBed} from '../src/sand-lab/sand.js';
test('terrain slopes match the cubic surface and stay exactly flat beyond its clamped edges',()=>{
 const bed=new SandBed(65);for(let i=0;i<bed.base.length;i++)bed.base[i]+=.06*Math.sin(i*1.4);bed.update();
 for(let i=0;i<60;i++){const x=-5+i*10/59,z=-4+(i*17%59)*8/59,g=terrainGradient(bed.data,bed.n,x,z,4),h=.0001;
  const numeric=[(bed.height(x+h,z)-bed.height(x-h,z))/(2*h),(bed.height(x,z+h)-bed.height(x,z-h))/(2*h)];
  g.forEach((v,k)=>assert.ok(Math.abs(v-numeric[k])<.000003));
 }
 const flat=new Float32Array(65*65).fill(1.234567);
 for(const [x,z] of [[0,0],[4.123,3.243],[50,20],[-90,-20]])assert.deepEqual(terrainGradient(flat,65,x,z),[0,0]);
 assert.equal(terrainGradient(bed.data,65,50,20,4)[1],0);assert.equal(terrainGradient(bed.data,65,50,20,4)[0],0);
});

import {rainContact,rainSurfaceHeights,RAIN_CONTACT_SECONDS} from '../src/sand-lab/rain-surface.js';
import {detailStep} from '../src/sand-lab/water-lab-detail.js';
import {makeBody,bodyDistance} from '../src/sand-lab/objects.js';
test('rain contact dips, rebounds and fades in a short bounded interval at every scale',()=>{
 for(const scale of [.02,1,10,100]){
  close(rainContact(0,scale).offset,0);assert.ok(rainContact(.16,scale).offset<0);assert.ok(rainContact(.48,scale).offset>0);
  assert.equal(rainContact(RAIN_CONTACT_SECONDS,scale).opacity,0);assert.equal(rainContact(5,scale).opacity,0);
  for(let i=0;i<=100;i++){const c=rainContact(i/100*RAIN_CONTACT_SECONDS,scale);assert.ok(Math.abs(c.offset)*scale<=.12);assert.ok(c.opacity>=0&&c.opacity<=1);}
 }
});
test('rain surface map follows moved water and excludes held water without camera inputs',()=>{
 const lab=fixture();lab.positions=new Float32Array([0,.8,0,0,1,2,1,1]);const data=new Float32Array(128*128);rainSurfaceHeights(lab,data);
 assert.ok(data.some(v=>v>.8&&v<.9));assert.ok(!data.some(v=>v>1));lab.positions[1]=1.2;rainSurfaceHeights(lab,data);assert.ok(data.some(v=>v>1.2));
 lab.positions[3]=1;rainSurfaceHeights(lab,data);assert.ok(data.every(v=>v===-100));
});
test('rain traces real sphere and cup surfaces before emitting mist',()=>{
 const lab=fixture(),rain=new LabRain(lab);
 for(const shape of ['sphere','cup']){
  const body=makeBody('rock',shape,.4,[0,1,0]),field=p=>Math.min(p[1],bodyDistance(p,body));
  const x=shape==='cup'?.35:0,hit=rain.solidHit([x,4,0],[x,0,0],field);
  assert.ok(hit&&hit.point[1]>1);assert.ok(Math.abs(bodyDistance(hit.point,body)-.003)<.0001);assert.ok(hit.normal[1]>.8);
 }
});
test('rain mist drifts more slowly than free spray and stays close to its receiving surface',()=>{
 let p=[0,1,0],v=[0,0,0];for(let i=0;i<100;i++){const next=detailStep(p,v,3,10,.01,i*.01,20,0,null,1,0,null,true);p=next.position;v=next.velocity;}
 assert.ok(Math.hypot(p[0],p[2])>.02&&Math.hypot(p[0],p[2])<.3);assert.ok(Math.abs(p[1]-1)<.01);
});
