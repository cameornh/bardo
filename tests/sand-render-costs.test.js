import test from 'node:test';
import assert from 'node:assert/strict';
import {LabWaterField} from '../src/sand-lab/water-lab-field.js';
import {InteriorWaterCompression,distanceDetail,stableDrawingSize} from '../src/sand-lab/adaptive-water-detail.js';
import {waterFixture} from './sand-adaptive-fixture.js';

test('moderately moving interiors finish their blend rather than retaining two representations',()=>{
 for(const speed of [.2,.35,.5,.7,.95,1.3]){
  const {items,lab}=waterFixture(),c=new InteriorWaterCompression();
  for(const p of items)lab.velocities[p.sourceIndex*4]=speed/lab.spec.scale;
  let out;for(let i=0;i<20;i++)out=c.update(items,lab,.1);
  assert.ok(out.length<=items.length,`${speed}: ${out.length}`);
  assert.ok(c.stats.estimatedVoxelWork<=1.00001);
  assert.ok(Math.abs(out.reduce((v,p)=>v+p.volume,0)-items.reduce((v,p)=>v+p.volume,0))<1e-9);
 }
});
test('quietness hysteresis prevents repeated blend restarts near an eligibility boundary',()=>{
 const {items,lab}=waterFixture(),c=new InteriorWaterCompression();
 for(let i=0;i<20;i++)c.update(items,lab,.1);
 const count=c.stats.kernels;
 for(const speed of [.54,.56,.54,.56,.8,1]){
  for(const p of items)lab.velocities[p.sourceIndex*4]=speed/lab.spec.scale;
  c.update(items,lab,.1);assert.equal(c.stats.kernels,count);
 }
});
test('changing Gaussian slice ranges reuses texture storage and allows the range to shrink',()=>{
 const f=new LabWaterField({extensions:{has:()=>false}});f.allocateItems(100,12);
 const original=[f.centers,f.channels,f.shapes],capacity=f.capacity;
 for(const slices of [13,16,19,17,12,9]){
  f.allocateItems(90,slices);assert.deepEqual([f.centers,f.channels,f.shapes],original);
  assert.equal(f.capacity,capacity);assert.equal(f.slices,slices);
  assert.equal(f.geometry.getAttribute('aParticle').meshPerAttribute,slices);
 }
 f.allocateItems(300,9);assert.ok(f.capacity>=300);assert.notEqual(f.centers,original[0]);f.dispose();
});
test('distant sampling reaches fourfold spacing continuously while nearby sampling stays fine',()=>{
 assert.equal(distanceDetail(1,.2,320),1);assert.equal(distanceDetail(40,.2,320),4);
 let prior=distanceDetail(1,.2,320);
 for(let d=1.0001;d<40;d+=.0001){const next=distanceDetail(d,.2,320);assert.ok(next>=prior&&next-prior<.0002);prior=next;}
 const size=stableDrawingSize(960,640);assert.ok(size.width*size.height/(624*416)<.60);
});
