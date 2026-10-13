import test from 'node:test';
import assert from 'node:assert/strict';
import {sprayShadowLayout,sprayShadowKernel,sprayOpticalDepth,SPRAY_LIGHT} from '../src/water-lab-spray-shadows.js';
import {detailRadiance} from '../src/water-lab-detail-optics.js';
const layout=sprayShadowLayout();
const kernel=(age=.2,kind=0)=>sprayShadowKernel([0,3,0,age],[2,-3,1,2],[.15,kind,.6,1],layout);
test('spray blocks light below it, with cumulative soft Gaussian shadows and clear light above',()=>{
 const k=kernel(),[x,y,z]=k.center,tau=sprayOpticalDepth(k,x,y,z-2),edge=sprayOpticalDepth(k,x+.2,y,z-2);
 assert.ok(tau>edge&&edge>0);assert.equal(sprayOpticalDepth(k,x,y,z+2),0);assert.equal(sprayOpticalDepth(k,x+5,y,z-2),0);
 assert.ok(Math.exp(-tau*6)<Math.exp(-tau));assert.ok(sprayOpticalDepth(k,x,y,z)>0&&sprayOpticalDepth(k,x,y,z)<tau);
});
test('birth, expiry, particle type and light-space resolution preserve bounded optical weight',()=>{
 assert.equal(kernel(2),null);assert.equal(Math.abs(kernel(0).tau),0);assert.ok(kernel(1.95).tau<kernel(.2).tau*.1);assert.ok(kernel(.2,2).tau<kernel(.2,1).tau);
 const coarse=sprayShadowKernel([0,3,0,.2],[2,-3,1,2],[.15,0,.6,1],sprayShadowLayout(undefined,32)),fine=kernel();
 assert.ok(coarse.tau<fine.tau);assert.ok(Math.abs(coarse.tau*Math.sqrt(coarse.det)-fine.tau*Math.sqrt(fine.det))<1e-12);
 assert.ok(Math.abs(Math.hypot(...SPRAY_LIGHT)-1)<1e-12);
});
test('the longer river fits its shadow volume and spray self-shadow retains ambient illumination',()=>{
 const river=sprayShadowLayout({min:[-6,-2,-20],max:[6,13,20]});assert.ok(river.span[1]>layout.span[1]*2);
 const lit=detailRadiance(0,[.5,.5,.5],1,0,0,0,1),shadowed=detailRadiance(0,[.5,.5,.5],1,0,0,0,0);
 assert.deepEqual(shadowed,[.5,.5,.5]);assert.ok(lit.every((v,k)=>v>shadowed[k]));
});
