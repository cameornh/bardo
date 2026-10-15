import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBody,bodyVolume,bodyDistance,cupCapacity,cupContains,cupHydrostatics} from '../src/sand-lab/objects.js';
import {cupWaterState} from '../src/sand-lab/cup-water.js';
import {softenPlayerImpulse} from '../src/sand-lab/water-lab-player.js';

test('rock spheres sink but a dry rock cup has enough air capacity to float',()=>{
 const b=makeBody('rock','cup',1,[0,0,0]);assert.ok(b.ratio>1);
 assert.ok(bodyVolume(b)*(b.ratio-1)<cupCapacity(b));
 assert.ok(cupHydrostatics(b,1).buoyancy>1);
 assert.ok(cupHydrostatics(b,1,cupCapacity(b)).buoyancy<1);
 assert.equal(cupHydrostatics(b,-2).displaced,0);
});
test('cup flotation approaches equilibrium below its dry rim and flooding reverses acceleration',()=>{
 const b=makeBody('rock','cup',1,[0,3,0]);let velocity=0;
 for(let i=0;i<1200;i++){const h=cupHydrostatics(b,1);velocity+=(h.buoyancy-1)*9.81/60;velocity*=Math.exp(-2*h.submerged/60);b.position[1]+=velocity/60;}
 const dry=cupHydrostatics(b,1),wet=cupHydrostatics(b,1,cupCapacity(b));
 assert.ok(Math.abs(dry.buoyancy-1)<.002);assert.ok(Math.abs(velocity)<.01);assert.ok(b.position[1]+1>1.3);
 assert.ok(wet.buoyancy<.7);assert.equal(wet.airVolume,0);
});
test('cup displacement respects orientation, scale, and actual contained liquid',()=>{
 const b=makeBody('rock','cup',1,[0,0,0]);b.tilt=Math.PI/2;const h=cupHydrostatics(b,0,cupCapacity(b)*.2);
 assert.ok(Math.abs(h.submerged-.5)<.04);assert.equal(h.airVolume,cupCapacity(b)*.8);
 const large={...b,radius:3},scaled=cupHydrostatics(large,0,cupCapacity(large)*.2);assert.ok(Math.abs(scaled.displaced/h.displaced-27)<1e-9);assert.ok(Math.abs(scaled.buoyancy-h.buoyancy)<1e-9);
});
test('exterior surface sampling supports a dry cavity and interior parcels count as carried water',()=>{
 const b=makeBody('rock','cup',.5,[0,.5,0]),s=.1,points=[];
 for(let x=-12;x<=12;x++)for(let y=-1;y<=8;y++)for(let z=-12;z<=12;z++){const p=[x*s,y*s,z*s];if(bodyDistance(p,b)>.025&&!cupContains(p,b))points.push(...p,0);}
 const sample=values=>{const positions=new Float32Array(values),reach=s*2,bins=new Map();for(let i=0;i<positions.length/4;i++){const c=[0,1,2].map(k=>Math.floor(positions[i*4+k]/reach)),key=(c[0]+512)+(c[1]+512)*1024+(c[2]+512)*1048576;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(i);}return cupWaterState(b,positions,s,{bins,reach});};
 const dry=sample(points);assert.ok(Math.abs(dry.surface-.845)<.001);assert.ok(dry.sectors>=6);assert.equal(dry.waterVolume,0);
 points.push(0,.5,0,0,.1,.5,0,0);const wet=sample(points);assert.ok(Math.abs(wet.waterVolume-2*s**3)<1e-12);assert.equal(wet.surface,dry.surface);
});
test('player splash adjustment still removes outward projection energy and preserves tangential flow',()=>{
 const v=softenPlayerImpulse([2,5,-1],[2,1,-1],[0,1,0],1);assert.equal(v[0],2);assert.equal(v[2],-1);assert.ok(v[1]>1&&v[1]<3);
});
