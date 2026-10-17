import test from 'node:test';
import assert from 'node:assert/strict';
import {fountainVisibility,fountainBounce} from '../src/water-lab-fountain-light.js';
import {fountainGroundLight,traceFountainPhoton} from '../src/water-lab-fountain-caustics.js';
import {fountainFlightNeighborhoods} from '../src/water-lab-fountain-flight.js';
import {fountainNozzles,FOUNTAIN_DEFAULTS} from '../src/water-lab-fountain.js';
import {fixtureDistance,createMotion} from '../src/water-lab-model.js';
import {WaterLab} from '../src/water-lab.js';
const sun=[-.4,1,.3].map(x=>x/Math.sqrt(1.25));
test('fountain rays enter bounds from outside; low basin has a continuous ground shadow',()=>{
 assert.equal(fountainVisibility([4.83,.025,0],sun),0);
 assert.ok(fountainVisibility([8,.025,0],sun)>.99);
 for(let x=-3;x<=3;x+=.1)for(let z=-3;z<=3;z+=.1)assert.equal(fountainVisibility([x,.025,z],sun),0,`${x}, ${z}`);
 assert.ok(fountainGroundLight([1,.025,0]).every(v=>v<.06));assert.ok(fountainGroundLight([9,.025,0]).every(v=>v>.9));
});
test('water splits sunlight into upward reflection and downward transmission without adding energy',()=>{
 const b=fountainBounce(sun.map(x=>-x),[0,1,0]);assert.ok(b.reflected[1]>0&&b.refracted[1]<0);assert.ok(Math.abs(b.reflection+b.transmission-1)<1e-12);
 for(const c of [.05,.3,.8,1]){const q=fountainBounce([Math.sqrt(1-c*c),-c,0],[0,1,0]);assert.ok(Math.abs(Math.hypot(...q.reflected)-1)<1e-10);assert.ok(Math.abs(Math.hypot(...q.refracted)-1)<1e-10);assert.ok(q.reflection>0&&q.reflection<1);}
});
test('reflected photons reach an underside; transmission and organic load obey the water path',()=>{
 const sample=p=>[p[1]<1?1:0,0,0,0],solid=p=>Math.min(p[1],Math.abs(p[1]-2)-.05),d=sun.map(x=>-x),o=[0,1.7,0];
 const clear=traceFountainPhoton(o,d,{sample,solid,visibility:()=>1}),dark=traceFountainPhoton(o,d,{sample,solid,visibility:()=>0}),tea=traceFountainPhoton(o,d,{sample,solid,visibility:()=>1,organic:3});assert.equal(clear.length,2);assert.equal(dark.length,0);assert.ok(clear[0].position[1]>1.94);assert.ok(clear[1].position[1]<.01);assert.ok(clear[0].flux.every(v=>v>0&&v<.1));assert.ok(tea[1].flux.every((v,k)=>v<clear[1].flux[k]));
});
test('maximum jet speed is four times the former maximum and survives the CFL speed limit',()=>{
 const old=fountainNozzles({...FOUNTAIN_DEFAULTS,crown:1.5,arcs:1.5,lower:1.5}),next=fountainNozzles({...FOUNTAIN_DEFAULTS,crown:24,arcs:24,lower:24});next.forEach((n,i)=>assert.ok(Math.abs(n.speed/old[i].speed-4)<1e-12));
 const lab=new WaterLab({extensions:{has:()=>false}});lab.configure('fountain');Object.assign(lab.fountain,{crown:24,arcs:24,lower:24});const dt=lab.timestep;for(const n of next)assert.ok(n.speed<lab.spacing*.45/dt);const h=next[0].point[1]+next[0].speed**2/(2*9.81/lab.spec.scale);assert.ok(h>50&&fixtureDistance([0,h,0],'fountain',createMotion())>1);
});
test('far jets retain Gaussian neighborhoods above the old ceiling without a larger density atlas',()=>{
 const lab={spacing:.21,count:3,positions:Float32Array.from([0,13,0,0,0,13.18,0,0,2,.6,0,0]),neighborCounts:[3,3,3]},result=fountainFlightNeighborhoods(lab);assert.equal(result.flights.length,2);assert.deepEqual(result.flights[0].neighbors,[0,1]);assert.ok(result.particles.every(p=>p.sigma>0&&p.amplitude>0));
});
