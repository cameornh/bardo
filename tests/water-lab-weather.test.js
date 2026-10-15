import test from 'node:test';
import assert from 'node:assert/strict';
import {WaterLab} from '../src/water-lab.js';
import {labAirVelocity,obstacleAir} from '../src/water-lab-air.js';
import {detailStep} from '../src/water-lab-detail.js';
import {detailFluidState} from '../src/water-lab-detail-environment.js';
import {vesselDistance,rotate,normalAt} from '../src/water-lab-model.js';
const mock={extensions:{has:()=>false}},ledger=l=>l.volume+l.rain.unresolvedVolume*l.spec.scale**3-l.initialVolume-l.rain.emitted*l.spec.scale**3;
test('turbulence has a separate 3D wind control and wall-normal flow vanishes',()=>{
 const l=new WaterLab(mock);l.configure('pane');l.wind=20;l.windTurbulence=0;
 assert.ok(Math.hypot(...labAirVelocity([4,4,0],l).map((v,k)=>v-[0,0,20][k]))<1e-12);l.windTurbulence=3;const a=labAirVelocity([4,4,0],l);assert.ok(Math.abs(a[0])>.1&&Math.abs(a[1])>.1);assert.ok(a.every(Number.isFinite));
 const slip=obstacleAir([0,0,0],[3,-10,4],p=>p[1]);assert.equal(slip[1],0);assert.ok(slip[0]>0);assert.ok(Math.hypot(...slip)<Math.hypot(3,10,4));
});
test('mist remains airborne, follows wind faster, and becomes wet on entering water',()=>{
 const args=[[0,2,0],[0,0,0],0,1,.1,0,20,1,null,1,0];const spray=detailStep(...args);args[2]=3;const mist=detailStep(...args);assert.ok(mist.velocity[2]>spray.velocity[2]*3);assert.ok(mist.velocity[1]>spray.velocity[1]);assert.equal(detailFluidState(3,0),3);assert.equal(detailFluidState(3,.7),2);
});
test('repeated coarse rain impacts insert separated parcels and conserve their volume',()=>{
 const l=new WaterLab(mock);l.configure('pane');const s=l.spacing,n=l.count,pv=s**3,hit={point:[3,0,0],normal:[0,1,0],particle:-1};
 for(let i=0;i<24;i++){l.rain.emitted+=pv;l.rain.impact({volume:pv,velocity:[0,-9,0]},hit);l.rain.releaseDeposits();}
 assert.ok(l.count>n+10);for(let i=0;i<l.count;i++)for(let j=i+1;j<l.count;j++)assert.ok(Math.hypot(...[0,1,2].map(k=>l.positions[i*4+k]-l.positions[j*4+k]))>=s*.859);
 assert.ok(Math.abs(ledger(l))<1e-10);assert.ok(Math.max(...l.positions.filter((_,i)=>i%4===1))<s*4);
});
test('sub-capillary glass drops remain adhered as the pane moves and turns',()=>{
 const l=new WaterLab(mock);l.configure('pane');const volume=1e-9;l.rain.emitted=volume;l.rain.impact({volume,velocity:[0,-3,0]},{point:[0,2.049,0],normal:[0,1,0],particle:-1});const deposit=[...l.rain.deposits.values()][0];assert.ok(deposit.local);
 l.motion.tilt=Math.PI/3;l.motion.position=[1,3,0];const point=l.rain.depositPoint(deposit);for(let i=0;i<180;i++)l.rain.slideDeposits(1/60);assert.ok(l.rain.deposits.size===1);assert.ok(Math.hypot(...l.rain.depositPoint(deposit).map((v,k)=>v-point[k]))<.01);assert.ok(Math.abs(ledger(l))<1e-12);
});
test('the player capsule displaces water without becoming part of walkable terrain',()=>{
 const l=new WaterLab(mock);l.configure('pane');l.setPlayer([0,1.65,3],[1,0,0]);assert.ok(l.playerDistance([0,.8,3])<0);assert.ok(l.solid([0,.8,3],false)>0);const p=l.collide([.05,.8,3]);assert.ok(l.playerDistance(p)>=l.spacing*.41);l.setPlayer(null,[0,0,0]);assert.equal(l.playerDistance([0,.8,3]),100);
});
test('lens droplets coalesce, persist and drain with a fixed work budget',()=>{
 const l=new WaterLab(mock);l.configure('pane');for(let i=0;i<200;i++)l.wetting.addLens(1);assert.ok(l.wetting.lens.length<=64);const radius=l.wetting.lens[0].radius;l.wetting.addLens(1,[l.wetting.lens[0].x,l.wetting.lens[0].y]);assert.ok(l.wetting.lens[0].radius>=radius);for(let i=0;i<30;i++)l.wetting.step(.05);assert.ok(l.wetting.lens.length>0);assert.ok(l.wetting.lens.every(p=>[p.x,p.y,p.radius].every(Number.isFinite)));
});

test('pane pitch, tilt and twist invert correctly and wet deposits follow all axes',()=>{
 const l=new WaterLab(mock);l.configure('pane');l.motion.pitch=.6;l.motion.tilt=.4;l.motion.spin=.7;const p=[1,.05,.3],world=rotate(p,.4,.7,false,.6).map((v,k)=>v+l.motion.position[k]),local=rotate(world.map((v,k)=>v-l.motion.position[k]),.4,.7,true,.6);p.forEach((v,k)=>assert.ok(Math.abs(v-local[k])<1e-12));assert.ok(Math.abs(vesselDistance(world,'pane',l.motion)-.005)<1e-9);
});
test('connected rain film can become a bulk puddle on an upward-facing pane',()=>{
 const l=new WaterLab(mock);l.configure('pane');const pv=l.spacing**3;for(let i=0;i<8;i++){const volume=pv*.16;l.rain.emitted+=volume;l.rain.impact({volume,velocity:[0,-3,0]},{point:[(i-4)*.06,2.049,0],normal:[0,1,0],particle:-1});}for(const p of l.rain.deposits.values())p.age=1;l.rain.releaseDeposits();assert.ok(l.count>0);assert.ok(Math.abs(ledger(l))<1e-10);
});

test('rain wets the camera inside the rainfall footprint, but glass shelter blocks it',()=>{
 for(const sheltered of [false,true]){const l=new WaterLab(mock);l.configure('pane');l.wetting.eye=sheltered?[0,1,0]:[3,1,0];l.wetting.forward=[0,-.5,-.866];l.rain.enabled=true;l.rain.rate=600;for(let i=0;i<30;i++)l.wetting.step(1/30);assert.equal(l.wetting.lens.length>0,!sheltered);}
 const l=new WaterLab(mock);l.configure('pane');l.wetting.eye=[0,2,0];l.wetting.hitLens([0,2,-.3],[0,2,0]);assert.equal(l.wetting.lens.length,1);
});
