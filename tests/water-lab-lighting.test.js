import test from 'node:test';
import assert from 'node:assert/strict';
import {soluteCoefficients} from '../src/water-lab-solutes.js';
import {mediumOpticalDepth} from '../src/water-lab-medium-shadows.js';
import {vesselDistance,createMotion} from '../src/water-lab-model.js';
import {phaseHG,labSky,diffuseSHBand} from '../src/water-lab-lighting.js';
import {projectSH,evaluateSH} from '../src/sh.js';
import {detailRadiance,detailResponse,detailViewTransport,detailClusterResponse} from '../src/water-lab-detail-optics.js';

test('medium shadows obey Beer law and ignore the air part of a lamp path',()=>{
 const options={sample:p=>p[2]>=1&&p[2]<3?[1,0,0,0]:[0,0,0,0],step:.025};
 const tau=mediumOpticalDepth([0,0,0],[0,0,1],5,options),tau2=mediumOpticalDepth([0,0,-1],[0,0,1],6,{...options,step:.05});
 const ext=soluteCoefficients([0,0,0]).extinction;
 ext.forEach((e,k)=>{assert.ok(Math.abs(tau[k]-2*e)<.015);assert.ok(Math.abs(tau[k]-tau2[k])<.02);});
 const half=mediumOpticalDepth([0,0,0],[0,0,1],5,{...options,scale:.5});tau.forEach((v,k)=>assert.ok(Math.abs(half[k]*2-v)<1e-9));
});
test('organic load is absorption dominated at high values, with amber transmitted shadows',()=>{
 const clear=soluteCoefficients([0,0,0]),low=soluteCoefficients([0,0,0],.3),high=soluteCoefficients([0,0,0],3);
 for(let k=0;k<3;k++){assert.ok(high.scatter[k]>low.scatter[k]);assert.ok(high.scatter[k]/high.extinction[k]<low.scatter[k]/low.extinction[k]);assert.ok(high.absorption[k]>clear.absorption[k]);}
 const tau=mediumOpticalDepth([0,0,0],[0,0,1],2,{sample:()=>[1,0,0,0],organic:3,step:.1});assert.ok(tau[2]>tau[1]&&tau[1]>tau[0]);assert.ok(Math.exp(-tau[2])<.001);
 const local=soluteCoefficients([0,3,0]);assert.deepEqual(local,high);
});
test('empty cups and tanks transmit partial shadows and move with the container',()=>{
 for(const kind of ['tank','glass']){const m=createMotion(),sample=()=>[0,0,0,0],glass=p=>vesselDistance(p,kind,m),ray=[1,0,0],origin=[-3,2,0],query=()=>mediumOpticalDepth(origin,ray,6,{sample,glass,step:.08});
 const tau=query();assert.ok(tau.every(v=>v>.12&&v<1),`${kind}: ${tau}`);m.position[2]=6;assert.deepEqual(query(),[0,0,0]);}
});
test('a blocker darkens only downstream light and open water is not an opaque occluder',()=>{
 const sample=()=>[0,0,0,0],solid=p=>Math.abs(p[2]-2)-.3;
 assert.deepEqual(mediumOpticalDepth([0,0,0],[0,0,1],5,{sample,solid}),[16,16,16]);
 assert.deepEqual(mediumOpticalDepth([0,0,3],[0,0,1],2,{sample,solid}),[0,0,0]);
});
test('sky SH is a cosine-convolved dome with no sunlight baked in',()=>{
 const coeff=projectSH(labSky);for(let i=0;i<16;i++)for(let k=0;k<3;k++)coeff[i*3+k]*=diffuseSHBand(i);
 for(const n of [[0,1,0],[0,-1,0],[1,0,0]])assert.ok(evaluateSH(coeff,n).every(v=>v>0&&v<1));
 assert.equal(diffuseSHBand(12),0);
 // HG is normalized over the sphere; a sun phase should not invent energy.
 let integral=0;const count=10000;for(let i=0;i<count;i++)integral+=phaseHG(-1+2*(i+.5)/count)*4*Math.PI/count;assert.ok(Math.abs(integral-1)<1e-6);
});
test('foam direct light is directional and sunlight cannot extinguish independent sky fill',()=>{
 assert.equal(detailResponse(1,[0,1,0],[0,1,0],[0,-1,0]),.18);assert.equal(detailResponse(1,[0,1,0],[0,1,0],[1,0,0]),0);
 const sky=detailRadiance(1,[.3,.4,.5],1,0,100,0,0,0);assert.deepEqual(sky,[.3,.4,.5]);
 assert.deepEqual(detailRadiance(0,[.3,.4,.5],0,0,0,0,1,0),[0,0,0]);
});

test('ambient transport preserves unoccluded dome light beside absorbing water',async()=>{
 const {mediumSkyDepth,skyDirection,SKY_SAMPLES}=await import('../src/water-lab-medium-shadows.js');
 const options={sample:()=>[0,0,0,0],step:.06,organic:3},limit=d=>2/d[1];
 assert.ok(mediumSkyDepth([0,0,0],limit,options).every(v=>Math.abs(v)<1e-10));
 for(let i=0;i<SKY_SAMPLES;i++){const d=skyDirection(i);assert.ok(d[1]>0);assert.ok(Math.abs(Math.hypot(...d)-1)<1e-12);}
 options.sample=p=>p[0]<0&&p[1]>.35&&p[1]<1.5?[1,0,0,0]:[0,0,0,0];
 const dome=mediumSkyDepth([-.04,0,0],limit,options).map(v=>Math.exp(-v));
 const zenith=mediumOpticalDepth([-.04,0,0],[0,1,0],2,options).map(v=>Math.exp(-v));
 assert.ok(dome.every(v=>v>.3&&v<.85),`partial sky visibility: ${dome}`);
 assert.ok(dome.every((v,k)=>v>zenith[k]*1.3));
 assert.deepEqual(dome,mediumSkyDepth([-.04,0,0],limit,options).map(v=>Math.exp(-v)));
});


test('sunlit submerged markers retain transmitted and foreground scattered light with zero ambient',()=>{
 const incoming=detailRadiance(2,[0,0,0],0,0,1,0,1,3),segment={length:2,incident:[2,2,2]},lit=detailViewTransport(incoming,[segment]);
 assert.ok(lit.radiance.every(v=>v>.15));assert.ok(lit.radiance[2]>lit.radiance[0]);assert.ok(lit.scatter.every(v=>v>0));
 const split=detailViewTransport(incoming,[{...segment,length:.7},{...segment,length:1.3}]);lit.radiance.forEach((v,k)=>assert.ok(Math.abs(v-split.radiance[k])<1e-12));
 const dark=detailViewTransport([0,0,0],[{...segment,incident:[0,0,0]}]);assert.deepEqual(dark.radiance,[0,0,0]);
 const organic=detailViewTransport(incoming,[{...segment,organic:3}]);assert.ok(organic.transmission.every((v,k)=>v<lit.transmission[k]));
});
test('whitewater diffusion vanishes without intervening foam and stays bounded in dense clusters',()=>{
 assert.equal(detailClusterResponse(.8,1),.8);
 for(const t of [.8,.5,.1,.01])assert.ok(detailClusterResponse(.8,t)>.8*t&&detailClusterResponse(.8,t)<.8);
 assert.ok(detailClusterResponse(0,.1)>0);assert.ok(detailClusterResponse(.8,0)<.03);
});
