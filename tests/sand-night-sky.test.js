import {mediumHistorySettings,mediumSkyDepth} from '../src/sand-lab/water-lab-medium-shadows.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {starDirection,projectStar,scintillation,starSeeingCovariance,starTwinkleStrength} from '../src/sand-lab/star-gaussians.js';
import {lunarPhase,moonIrradiance,moonDirection,starIrradiance,starColor,celestialDirection} from '../src/sand-lab/night-sky-model.js';
import {atmosphereSky,atmosphereTransmission} from '../src/sand-lab/atmosphere-model.js';
import {exposureTarget,exposureStatistics,adaptExposure} from '../src/sand-lab/sky-exposure.js';
import {LUNAR_MONTH,lunarState,advanceSkyClocks,tidalElevation,TideBoundary} from '../src/sand-lab/tides.js';
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('lunar irradiance follows a continuous phase curve and is much fainter than sunlight',()=>{
 close(lunarPhase(1),1);close(lunarPhase(0),0);assert.ok(moonIrradiance(1)>5e-7&&moonIrradiance(1)<2e-6);assert.ok(moonIrradiance(0)<moonIrradiance(1)*.001);
 let previous=-1;for(let f=0;f<=1;f+=.001){const v=lunarPhase(f);assert.ok(Number.isFinite(v)&&v>=previous);previous=v;}
 assert.ok(lunarPhase(.5)<.4); // a quarter is less than half of full irradiance
});
test('moon orbit, visible phase and lunar clock agree; daily and monthly clocks are independent',()=>{
 for(const age of [0,3,7.3826475,14.765295,22,29.53059]){const state=lunarState(age),sun=[0,1,0],moon=moonDirection(sun,state.illuminated,state.elongation);close(Math.hypot(...moon),1);close((1-moon[1])*.5,state.illuminated);}
 const state={day:23.5,daySeconds:180,lunarDay:14,lunarSeconds:600,cycle:true,lunarCycle:false};advanceSkyClocks(state,10);close(state.lunarDay,14);assert.ok(state.day<1);
 state.cycle=false;state.lunarCycle=true;const day=state.day;advanceSkyClocks(state,600);close(state.day,day);close(state.lunarDay,14);
});
test('star photometry preserves magnitude ratios, warm/cool colors and flux through spherical projection',()=>{
 close(starIrradiance(1)/starIrradiance(6),100,1e-10);assert.ok(starColor(1.5)[0]>starColor(1.5)[2]);assert.ok(starColor(-.2)[2]>starColor(-.2)[0]);
 for(const dec of [0,60,89,90]){const d=starDirection(12,dec);close(Math.hypot(...d),1);const p=projectStar([0,0,-1],800,800);close(p.xx,p.yy);close(p.xy,0);assert.ok(p.det>0);}
 // Numerically integrate a skewed projected Gaussian and recover its flux.
 const p=projectStar([.6,0,-.8],800,650);let integral=0,step=.025;
 for(let y=-5;y<=5;y+=step)for(let x=-5;x<=5;x+=step)integral+=Math.exp(-.5*(p.yy*x*x-2*p.xy*x*y+p.xx*y*y)/p.det)/(2*Math.PI*Math.sqrt(p.det))*step*step;
 close(integral,1,.0001);
 for(let t=0;t<10;t+=.1){close(scintillation(0,.5,t,3),1);assert.ok(Math.abs(scintillation(6,.1,t,3)-1)<.06);}

 const a=celestialDirection([1,0,0],0),b=celestialDirection([1,0,0],24);a.forEach((v,k)=>close(v,b[k]));close(Math.hypot(...celestialDirection([.6,.8,0],7)),1);
});
test('clear moonless sky remains faint, moonlight scatters, and horizon extinction reddens stars',()=>{
 const s=[0,-1,0],newMoon=atmosphereSky([0,1,0],s,{moonPhase:0}),full=atmosphereSky([0,1,0],s,{moonPhase:1});assert.ok(full[2]>newMoon[2]*100);assert.ok(newMoon.every(v=>v>0&&v<1e-8));
 const trans=atmosphereTransmission([0,.02,0],[1,0,0]);assert.ok(trans[0]>trans[2]);
 const dark=exposureTarget(exposureStatistics(new Float32Array([1e-9,1e-9,1e-9,1])));assert.ok(dark>1e6&&dark<=4e7);assert.ok(adaptExposure(1,dark,1)<dark*.01);close(exposureTarget(exposureStatistics(new Float32Array([.3,.3,.3,1]))),1);
});
test('stellar seeing changes Gaussian edges while preserving centroid, flux and a bounded footprint',()=>{
 const base=projectStar([.6,.1,-Math.sqrt(.63)],800,650),footprints=[];
 for(const time of [0,.4,1,2,4,8]){
  assert.deepEqual(starSeeingCovariance(base,0,.1,time,3),base);
  const c=starSeeingCovariance(base,6,.1,time,3);footprints.push(c.xx);
  assert.ok(c.det>0);assert.ok(Math.abs(c.xx/base.xx-1)<.8&&Math.abs(c.yy/base.yy-1)<.8);
  let mass=0,mx=0,my=0;const step=.05;
  for(let iy=-100;iy<=100;iy++)for(let ix=-100;ix<=100;ix++){
   const x=ix*step,y=iy*step,v=Math.exp(-.5*(c.yy*x*x-2*c.xy*x*y+c.xx*y*y)/c.det)/(2*Math.PI*Math.sqrt(c.det))*step*step;
   mass+=v;mx+=x*v;my+=y*v;
  }
  close(mass,1,1e-8);close(mx,0,1e-12);close(my,0,1e-12);
 }
 assert.ok(Math.max(...footprints)-Math.min(...footprints)>.005);
});
test('faint compact stars twinkle more strongly, with subtle size and brightness changes',()=>{
 const compact=projectStar([0,0,-1],800,800),broad=projectStar([0,0,-1],8000,8000);
 assert.ok(starTwinkleStrength(6,compact)>starTwinkleStrength(3,compact)*2);
 assert.ok(starTwinkleStrength(6,compact)>starTwinkleStrength(6,broad)*2);
 let maxBrightness=0,minRadius=1,maxRadius=1;
 for(let time=0;time<20;time+=.07){
  const c=starSeeingCovariance(compact,6,.05,time,3),radius=Math.pow(c.det/compact.det,.25);
  minRadius=Math.min(minRadius,radius);maxRadius=Math.max(maxRadius,radius);
  const faint=Math.abs(scintillation(6,.05,time,3,compact)-1),bright=Math.abs(scintillation(3,.05,time,3,compact)-1),large=Math.abs(scintillation(6,.05,time,3,broad)-1);
  assert.ok(faint>=bright&&faint>=large);maxBrightness=Math.max(maxBrightness,faint);
 }
 assert.ok(maxBrightness>.03&&maxBrightness<.06);
 assert.ok(minRadius<.94&&maxRadius>1.06&&minRadius>.82&&maxRadius<1.18);
});
test('tide envelope has spring/neap modulation and two highs per solar day at frozen lunar phase',()=>{
 const spring=tidalElevation(12,0),full=tidalElevation(12,LUNAR_MONTH/2),neap=Math.abs(tidalElevation(12,LUNAR_MONTH/4));close(spring,full);assert.ok(spring>neap*2.5);close(tidalElevation(0,0),spring);close(tidalElevation(6,0),-spring);
 const span=10000,values=Array.from({length:span+1},(_,i)=>{const days=i/span*2;return tidalElevation(days*24,days);});let peaks=[];for(let i=1;i<span;i++)if(values[i]>values[i-1]&&values[i]>values[i+1])peaks.push(i/span*48);assert.ok(peaks.length>=3);assert.ok(peaks[1]-peaks[0]>12&&peaks[1]-peaks[0]<12.5);
});
function boundaryLab(){const points=[];for(let z=-4.5;z<-3.7;z+=.25)for(let x=-4.6;x<4.7;x+=.25)for(let y=0;y<1;y+=.25)points.push(x,y,z,0);const positions=new Float32Array(points);return {day:12,lunarDay:0,tideAmplitude:1.5,tidesEnabled:true,spec:{scale:10},spacing:.25,positions,velocities:new Float32Array(points.length),chem:new Float32Array(points.length),get count(){return this.positions.length/4;},particleBudget:2048,solid:()=>1,detail:{remapEmitters(){}},gpu:{},revision:0};}
test('offshore tide exchanges conserve parcel volume, preserve held water, and respect capacity',()=>{
 const lab=boundaryLab(),tide=new TideBoundary(),initial=lab.count;lab.positions[3]=1;lab.held={ids:[0],offsets:[[0,0,0]]};tide.step(lab,.3);lab.day=18;
 for(let i=0;i<10;i++)tide.step(lab,.3);assert.ok(lab.count<initial);close((lab.count-initial)*lab.spacing**3,tide.exchanged);assert.equal(lab.positions[lab.held.ids[0]*4+3],1);
 lab.day=12;for(let i=0;i<20;i++)tide.step(lab,.3);assert.ok(tide.imported>0);close((lab.count-initial)*lab.spacing**3,tide.exchanged);assert.ok(lab.count<=lab.particleBudget);
 const count=lab.count;lab.tidesEnabled=false;lab.day=6;for(let i=0;i<10;i++)tide.step(lab,.3);assert.equal(lab.count,count);assert.ok(lab.positions.every(Number.isFinite));
});

test('moon intensity does not invalidate extinction history; material changes do',()=>{
 const lab={kind:'ocean',spec:{scale:10},tannins:0,ambient:1,sunlight:1,lights:1,day:14,lunarDay:1};const a=mediumHistorySettings(lab,0,false);
 lab.day=22;lab.lunarDay=10;lab.sunlight=1e-6;lab.ambient=.3;assert.equal(mediumHistorySettings(lab,0,false),a);
 lab.tannins=1;assert.notEqual(mediumHistorySettings(lab,0,false),a);
});
test('ambient transmission is invariant to daylight versus tiny night radiance',()=>{
 const options={sample:()=>[0,0,0,0],solid:()=>1,glass:()=>1,scale:10,organic:0,turbidity:0,step:.1};
 const bright=mediumSkyDepth([0,0,0],()=>1,{...options,sky:()=>[1,.8,.5]}),dark=mediumSkyDepth([0,0,0],()=>1,{...options,sky:()=>[1e-10,.8e-10,.5e-10]});
 bright.forEach((v,k)=>close(v,dark[k]));
});
