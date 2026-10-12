import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSH,evaluateSH,materialSH } from '../src/sh.js';
import { surfaceCovariance,mergeGaussians,buildGaussianHierarchy,FLOATS_PER_SPLAT } from '../src/gaussians.js';
import { MotionDetail,projectedMotion,levelChoice,allocateBudget } from '../src/lod.js';
import { World,MATERIALS } from '../src/world.js';
import { sampleSurface } from '../src/sampling.js';

test('SH projection reconstructs constant and directional radiance',()=>{
  const constant=projectSH(()=>[.2,.5,.8]);
  for(const d of [[1,0,0],[0,1,0],[0,0,-1]])evaluateSH(constant,d).forEach((v,i)=>assert.ok(Math.abs(v-[.2,.5,.8][i])<.015));
  const directional=projectSH(([x,y,z])=>[.5+.2*x,.5+.3*y,.5+.1*z]);
  assert.ok(evaluateSH(directional,[1,0,0])[0]-evaluateSH(directional,[-1,0,0])[0]>.36);
  const material=materialSH([0,1,0],MATERIALS[1]);
  assert.equal(material.length,48);assert.ok(material.slice(3).some(x=>Math.abs(x)>.01));
});

test('Gaussian merging preserves optical mass and spatial first/second moments',()=>{
  const cov=surfaceCovariance([0,1,0],.5);
  const nodes=[-1,1].map(x=>({center:[x,0,0],normal:[0,1,0],cov,mass:2,tau:8}));
  const merged=mergeGaussians(nodes);
  assert.equal(merged.mass,4);assert.deepEqual(merged.center,[0,0,0]);
  assert.ok(Math.abs(merged.cov[0]-1.25)<1e-12);
  assert.ok(Math.abs(merged.cov[3]-cov[3])<1e-12);
  assert.ok(merged.tau>0);assert.ok(merged.cov[0]*merged.cov[3]*merged.cov[5]>0);
});

test('real surface hierarchy reduces thousands of splats to tens with full SH data',()=>{
  const world=new World(),hierarchy=buildGaussianHierarchy(sampleSurface(world,2,.10),MATERIALS[2]);
  assert.ok(hierarchy.levels[0].count>1000);assert.ok(hierarchy.levels.at(-1).count<50);
  for(let i=1;i<hierarchy.levels.length;i++){
    assert.ok(hierarchy.levels[i].count<hierarchy.levels[i-1].count);
    assert.ok(hierarchy.levels[i].sigma>hierarchy.levels[i-1].sigma);
  }
  for(let i=0;i<hierarchy.packed.length;i+=FLOATS_PER_SPLAT){
    assert.ok(hierarchy.packed[i+7]>0);
    const tau=hierarchy.packed[i+7],support=hierarchy.packed[i+15];
    assert.ok(1-Math.exp(-tau*Math.exp(-.5*support*support))<.000101,'even dense parents must end only at a negligible tail opacity');
    assert.ok(hierarchy.packed.subarray(i+24,i+FLOATS_PER_SPLAT).some(x=>Math.abs(x)>.001));
  }
});

const levels=[{sigma:.05,count:1000},{sigma:.10,count:260},{sigma:.20,count:70},{sigma:.4,count:15}];
test('projected size coarsens distant/smaller images and respects budget during blends',()=>{
  assert.ok(levelChoice(levels,100,2).count>levelChoice(levels,4,2).count);
  assert.ok(levelChoice(levels,100,2).count>=levelChoice(levels,50,2).count);
  const items=Array.from({length:12},(_,i)=>({levels,scale:100/(i+1)}));
  for(const budget of [500,2000,4000,16000]){
    const result=allocateBudget(items,2,budget);assert.ok(result.cost<=budget);
    for(const choice of result.choices)assert.ok(choice.t>=0&&choice.t<=1);
  }
  const a=levelChoice(levels,40,3.001),b=levelChoice(levels,40,3.002);
  assert.ok(Math.abs(a.t-b.t)<.002,'tiny projected changes must not jump levels');
});

test('detail falls during motion, with immediate response and smooth continuous recovery',()=>{
  const detail=new MotionDetail();
  assert.ok(detail.update(600,1/60)>1,'respond in the very first moving frame');
  for(let i=0;i<30;i++)detail.update(600,1/60);
  assert.ok(detail.factor>4);
  const moving=detail.factor;detail.update(0,1/60);
  assert.ok(detail.factor>moving-.1,'no abrupt refinement after release');
  for(let i=0;i<300;i++)detail.update(0,1/60);
  assert.ok(Math.abs(detail.factor-1)<.01);
  const slow=new MotionDetail(),fast=new MotionDetail();
  for(let i=0;i<60;i++)slow.update(300,1/30);
  for(let i=0;i<240;i++)fast.update(300,1/120);
  assert.ok(Math.abs(slow.factor-fast.factor)<.01);
});

test('motion estimation reacts to rotation, translation, and focal pixel scale',()=>{
  const previous={position:[0,0,0],quaternion:[0,0,0,1]};
  const translated={...previous,position:[1,0,0]};
  const rotated={...previous,quaternion:[0,Math.sin(.05),0,Math.cos(.05)]};
  assert.equal(projectedMotion(previous,previous,1/60,500,10),0);
  assert.equal(projectedMotion(previous,translated,.1,500,10),500);
  assert.ok(Math.abs(projectedMotion(previous,rotated,.1,500,10)-500)<1e-8);
  assert.equal(projectedMotion(previous,translated,.1,1000,10),1000);
});
