import test from 'node:test';
import assert from 'node:assert/strict';
import {poolLamp,poolShadowKernel,poolOpticalDepth} from '../src/water-lab-pool-shadows.js';
import {bodyLightTransmission} from '../src/water-lab-body-shadows.js';
import {detailResponse,detailRadiance} from '../src/water-lab-detail-optics.js';
const marker=(kind=0,age=.2)=>poolShadowKernel([0,.65,-.75,age],[1,-2,.5,2],[.14,kind,.7,1],1);
test('point-light optical depth begins behind the Gaussian and accumulates with density',()=>{
 const k=marker();assert.equal(poolOpticalDepth(k,0,0,.5),0);const tau=poolOpticalDepth(k,0,0,4);assert.ok(tau>0);assert.ok(poolOpticalDepth(k,.08,0,4)<tau);assert.ok(Math.exp(-tau*8)<Math.exp(-tau));
 assert.equal(poolOpticalDepth(k,1,1,4),0);assert.equal(marker(0,3),null);assert.equal(Math.abs(marker(0,0).tau),0);assert.ok(marker(2).tau<k.tau);
});
test('each colored lamp projects its own footprint and only emits into the pool',()=>{
 const p=[0,.65,-.75,.2],v=[0,0,0,2],info=[.1,2,.6,1],red=poolShadowKernel(p,v,info,0),green=poolShadowKernel(p,v,info,1),blue=poolShadowKernel(p,v,info,2);
 assert.ok(red.center[0]>0&&blue.center[0]<0);assert.equal(green.center[0],0);assert.ok(Math.abs(red.center[0]+blue.center[0])<1e-12);
 assert.equal(poolShadowKernel([0,.65,-4,.2],v,info,1),null);assert.deepEqual(poolLamp(1),[0,.65,-2.75]);
});
test('sphere shadows reject occluders outside the segment, behind the receiver and on its own surface',()=>{
 const ball={position:[0,0,2],radius:.4,kind:'rock'},visibility=(p,d,limit=5)=>bodyLightTransmission(p,d,limit,[ball]);
 assert.deepEqual(visibility([0,0,0],[0,0,1]),[0,0,0]);assert.deepEqual(visibility([1,0,0],[0,0,1]),[1,1,1]);assert.deepEqual(visibility([0,0,0],[0,0,-1]),[1,1,1]);assert.deepEqual(visibility([0,0,0],[0,0,1],1),[1,1,1]);assert.deepEqual(visibility([0,0,1.6],[0,0,1]),[1,1,1]);
 assert.deepEqual(visibility([0,0,0],[0,0,1],1.85),[0,0,0]); // The lamp is inside the occluder.
});
test('mirror and rock balls block light while hollow glass transmits and has a darker rim',()=>{
 const ball={position:[0,0,2],radius:.4,kind:'mirror'},sample=(x,balls=[ball])=>bodyLightTransmission([x,0,0],[0,0,1],5,balls);
 assert.deepEqual(sample(0),[0,0,0]);ball.kind='glass';const center=sample(0),rim=sample(.37);assert.ok(center.every(x=>x>.7&&x<.95));assert.ok(rim.every((x,i)=>x<center[i]));assert.ok(center[0]<center[2]);
 const stacked=sample(0,[ball,{...ball,position:[0,0,3]}]);assert.ok(stacked.every((x,i)=>x<center[i]));const edge=sample(.4,[{...ball,kind:'rock'}]);assert.ok(edge.every(x=>x>0&&x<1));
});
test('foam direct lighting survives zero ambient and has a view-dependent specular response',()=>{
 const direction=[Math.SQRT1_2,Math.SQRT1_2,0],reflected=[-Math.SQRT1_2,Math.SQRT1_2,0],normal=[0,1,0],glint=detailResponse(1,reflected,normal,direction),away=detailResponse(1,[0,1,0],normal,direction);
 assert.ok(glint>away*1.4);
 const direct=detailRadiance(1,[.5,.5,.5],0,0,0,0,1,1,glint),dark=detailRadiance(1,[.5,.5,.5],0,0,0,0,1,0,glint),shadow=detailRadiance(1,[.5,.5,.5],1,0,0,0,0,1,glint);
 assert.ok(direct.every(x=>x>1));assert.deepEqual(dark,[0,0,0]);assert.deepEqual(shadow,[.5,.5,.5]);
 for(const kind of [0,2])assert.ok(detailResponse(kind,[0,-1,0],normal,[0,1,0])>detailResponse(kind,[0,1,0],normal,[0,1,0]));
});
