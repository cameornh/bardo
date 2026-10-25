import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_WIND_BRUSH,windBrushErosion} from '../src/rtx-sand-lab/wind-brush.js';
import {SandBed} from '../src/sand-lab/sand.js';
import {erodeSand} from '../src/sand-lab/sand-wind.js';
import {sandWindForce} from '../src/sand-lab/sand-stress.js';
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`),water=()=>({density:0,velocity:[0,0,0]});
const fixture=(live=true)=>{const b=new SandBed(33);b.base.fill(-.7);b.update();if(live)b.windBrushErosion=windBrushErosion;return b;};
const wind=(speed,brush=true)=>{const w=()=>[speed/10,0,0];if(brush)w.brush={kind:'sand',point:[0,0,0],normal:[0,1,0],radius:.5,distance:2};w.normal=()=>[0,1,0];return w;};
test('stronger brush has ten times the previous speed and a hundred times the same-sample aerodynamic force',()=>{
 assert.equal(LIVE_WIND_BRUSH.initial,2400);assert.equal(LIVE_WIND_BRUSH.max,9000);
 const p={position:[0,.2,0],velocity:[0,0,0],mass:.56*4*Math.PI/3*.2**3,packing:.56,wet:.95};
 const old=sandWindForce(p,wind(240),10),next=sandWindForce(p,wind(2400),10);near(next[0]/old[0],100);
});
test('erosion responds smoothly above the old plateau and stays bounded at extreme brush speeds',()=>{
 let previous={rate:0,bedFraction:.02,parcelFraction:.08};
 for(let excess=0;excess<=12000;excess+=5){const q=windBrushErosion(excess,10);
  for(const key of Object.keys(q))assert.ok(Number.isFinite(q[key])&&q[key]>=previous[key]);
  assert.ok(q.bedFraction<=.1&&q.parcelFraction<=.4);assert.ok(q.rate<=.00035*2000**1.5/10);previous=q;
 }
 near(windBrushErosion(170-1e-6,10).rate,windBrushErosion(170+1e-6,10).rate,1e-8);
 assert.ok(windBrushErosion(2000,10).rate>windBrushErosion(170,10).rate*10);
});
test('the live brush actually removes more sand, without increasing the 32-packet budget or losing stock',()=>{
 const a=fixture(false),b=fixture(),mass=b.totalMass();erodeSand(a,.13,wind(2400),10,water);erodeSand(b,.13,wind(2400),10,water);
 assert.ok(b.windMoved>a.windMoved*2,`${b.windMoved} vs ${a.windMoved}`);assert.ok(b.parcels.length<=32);near(b.totalMass(),mass);
 for(let i=0;i<30;i++){erodeSand(b,.13,wind(LIVE_WIND_BRUSH.max),10,water);assert.ok(b.parcels.length<=32);near(b.totalMass(),mass);}
 assert.ok(b.parcels.every(p=>[...p.position,...p.velocity,p.mass].every(Number.isFinite)));
});
test('ambient air and underwater-current erosion remain identical to the reference',()=>{
 for(const submerged of [false,true]){
  const a=fixture(false),b=fixture(),flow=wind(2400,submerged),sample=submerged?()=>({density:1,velocity:[240,0,0]}):water;
  erodeSand(a,.13,flow,10,sample);erodeSand(b,.13,flow,10,sample);assert.deepEqual(a.parcels,b.parcels);assert.deepEqual(a.mass,b.mass);
 }
});
