import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpticalSamples, sampleRadii, opticalCoefficients, rayEllipsoid, beerLambert, fresnelDielectric, phaseHG, opticalHierarchy } from '../src/optics.js';
import { solveDiffusion } from '../src/subsurface.js';
import { allocateBudget } from '../src/lod.js';

const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const total=(result,key)=>result.energy.reduce((sum,e)=>sum+e[key],0);
function fieldMean(result,predicate,channel=0){const [nx,ny,nz]=result.size;let sum=0,count=0;for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const o=(x+nx*(y+ny*z))*4;if(result.data[o+3]&&predicate(x/nx,y/ny,z/nz)){sum+=result.data[o+channel];count++;}}return sum/count;}

test('optical boundaries give consistent exterior, interior, tangent, and thin-leaf paths',()=>{
 const radii=[2,1,.1];assert.deepEqual(rayEllipsoid([0,0,1],[0,0,-1],radii).map(v=>Math.round(v*100)),[90,110]);
 const inside=rayEllipsoid([0,0,0],[0,0,1],radii);near(inside[0],-.1);near(inside[1],.1);
 assert.equal(rayEllipsoid([3,0,1],[0,0,-1],radii),null);
 const tangent=rayEllipsoid([2,0,1],[0,0,-1],radii);near(tangent[0],tangent[1]);
 const leaf=createOpticalSamples()[1];near(sampleRadii(leaf)[2]*2,.046);leaf.thickness=3;near(sampleRadii(leaf)[2]*2,.138);
});

test('Beer absorption composes with path length and distinguishes colored glass without scattering',()=>{
 const samples=createOpticalSamples();
 for(const s of samples.slice(4)){s.scatterScale=0;const {absorption,scattering}=opticalCoefficients(s);assert.ok(scattering.every(v=>v===0));const t1=beerLambert(absorption,.7),t2=beerLambert(absorption,1.4);t1.forEach((t,i)=>near(t*t,t2[i]));}
 const amber=beerLambert(opticalCoefficients(samples[5]).absorption,1),green=beerLambert(opticalCoefficients(samples[6]).absorption,1),blue=beerLambert(opticalCoefficients(samples[7]).absorption,1);
 assert.ok(amber[0]>amber[1]&&amber[1]>amber[2]);assert.ok(green[1]>green[0]&&green[1]>green[2]);assert.ok(blue[2]>blue[0]&&blue[2]>blue[1]);
});

test('dielectric boundaries conserve reflected/transmitted energy and handle total internal reflection',()=>{
 near(fresnelDielectric(1,1,1.5),.04);near(fresnelDielectric(1,1,1.333),.02037318784,1e-9);
 near(fresnelDielectric(.5,1.5,1),1);
 for(let i=0;i<=100;i++){const f=fresnelDielectric(i/100,1,1.5);assert.ok(f>=0&&f<=1);near(f+(1-f),1);}
 // HG is normalized over the sphere for all preset asymmetries.
 for(const g of [0,.35,.55,.72]){let integral=0;for(let i=0;i<10000;i++)integral+=phaseHG(-1+2*(i+.5)/10000,g)*4*Math.PI/10000;near(integral,1,1e-5);}
});

test('bounded RGB diffusion is finite, positive, and balances absorption plus boundary escape',()=>{
 for(const s of createOpticalSamples().slice(0,3)){
  const result=solveDiffusion(s,[0,0,1]);assert.ok(result.data.every(v=>Number.isFinite(v)&&v>=0));
  for(const e of result.energy){assert.ok(e.source>0);near((e.absorbed+e.escaped)/e.source,1,2e-4);assert.ok(e.escaped>0&&e.absorbed>0);}
  assert.ok(result.iterations.every(i=>i<280),`${s.name} did not converge`);
 }
});

test('diffusion spreads illumination into an unlit half and responds to increased absorption',()=>{
 const s=createOpticalSamples()[0],full=solveDiffusion(s,[0,0,1],{size:[18,20,12]}),half=solveDiffusion(s,[0,0,1],{split:true,size:[18,20,12]});
 const dark=fieldMean(half,(x,y,z)=>x>.3&&x<.45&&y>.3&&y<.7&&z>.6),lit=fieldMean(half,(x,y,z)=>x>.55&&x<.7&&y>.3&&y<.7&&z>.6);
 assert.ok(dark>0&&dark<lit,`${dark} vs ${lit}`);assert.ok(total(half,'source')<total(full,'source')*.6);
 s.absorptionScale=3;const absorbed=solveDiffusion(s,[0,0,1],{size:[18,20,12]});assert.ok(total(absorbed,'escaped')<total(full,'escaped')*.8);
 s.scatterScale=0;const zero=solveDiffusion(s,[0,0,1],{size:[12,14,8]});near(total(zero,'source'),0);assert.ok(zero.data.filter((_,i)=>i%4!==3).every(v=>v===0));
});

test('skin transmits red farther than blue and thicker samples attenuate backlighting',()=>{
 const s=createOpticalSamples()[2],thin=solveDiffusion(s,[0,0,-1],{size:[18,20,12]});
 const front=(x,y,z)=>x>.35&&x<.65&&y>.35&&y<.65&&z>.75;
 assert.ok(fieldMean(thin,front,0)>fieldMean(thin,front,2)*2);
 s.thickness=3;const thick=solveDiffusion(s,[0,0,-1],{size:[18,20,12]});assert.ok(fieldMean(thick,front,0)<fieldMean(thin,front,0)*.7);
});

test('optical Gaussian hierarchy conserves mass and stays within screen budgets at all motion speeds',()=>{
 const samples=createOpticalSamples(),items=samples.map(s=>({levels:opticalHierarchy(sampleRadii(s),384),scale:120}));
 for(const item of items){const mass=item.levels[0].nodes.reduce((s,g)=>s+g.mass,0);for(const level of item.levels){near(level.nodes.reduce((s,g)=>s+g.mass,0),mass);for(const g of level.nodes){const c=g.cov;assert.ok(c[0]>0&&c[3]>0&&c[5]>0);assert.ok(c[0]*c[3]-c[1]*c[1]>0);assert.ok(c[0]*(c[3]*c[5]-c[4]*c[4])-c[1]*(c[1]*c[5]-c[2]*c[4])+c[2]*(c[1]*c[4]-c[2]*c[3])>0);}}}
 for(const speed of [0,80,160,640,2000])for(const budget of [2000,8000,16000])assert.ok(allocateBudget(items,2*(1+speed/160),budget).cost<=budget);
});
