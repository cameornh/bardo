import test from 'node:test';
import assert from 'node:assert/strict';
import {BLOB_FAMILIES, LabBlobFamilies, blobFamily, sampleBlob} from '../src/water-lab-blobs.js';

test('smaller liquid lobes conserve volume and center of mass throughout breakup', () => {
  let smallest = 1, largest = 0;
  for (let id = 0; id < 100; id++) for (const blend of [0, .01, .2, .6, 1]) {
    const spacing = .25, origin = [.8, 2, -1], f = blobFamily(id, origin, spacing, blend);
    assert.ok(Math.abs(f.kernels.reduce((s,k) => s + k.volume, 0) - spacing ** 3) < 1e-15);
    for (let axis=0;axis<3;axis++) assert.ok(Math.abs(f.kernels.reduce((s,k) => s+k.position[axis]*k.volume,0)/spacing**3-origin[axis])<1e-13);
    for (const k of f.kernels.slice(1)) {
      assert.ok(k.radius <= .65 * spacing);
      if (blend===1) {smallest=Math.min(smallest,k.radius/(.65*spacing));largest=Math.max(largest,k.radius/(.65*spacing));}
    }
    assert.deepEqual(f, blobFamily(id, origin, spacing, blend));
  }
  assert.ok(smallest<.18 && largest>.8 && largest<.82, `range ${smallest}–${largest}`);
});

test('analytic Gaussian gradient matches finite differences, including tiny lobes', () => {
  const f=blobFamily(51,[.2,.3,.1],.25,1);
  for(const k of f.kernels.slice(1)) {
    const p=k.position.map((v,i)=>v+k.sigma*(i+.5)*.2),actual=sampleBlob(f,p),e=1e-6;
    for(let axis=0;axis<3;axis++) {
      const a=p.slice(),b=p.slice();a[axis]+=e;b[axis]-=e;
      assert.ok(Math.abs((sampleBlob(f,a).density-sampleBlob(f,b).density)/(2*e)-actual.gradient[axis])<1e-5);
    }
  }
});

function fixture(count=500) {
  return {kind:'waterfall',count,spacing:.25,time:0,positions:new Float32Array(count*4),neighborCounts:new Uint16Array(count)};
}
test('refinement has a hard cap, does not alter simulation parcels, and returns dense water to the bulk',()=>{
  const lab=fixture(),blobs=new LabBlobFamilies(),positions=lab.positions.slice();
  assert.equal(blobs.update(lab).length,0);
  lab.time=.02;blobs.update(lab);assert.equal(blobs.active.size,BLOB_FAMILIES);
  const ids=[...blobs.active.keys()];
  for(let i=0;i<30;i++){lab.time+=.02;blobs.update(lab);}
  assert.deepEqual([...blobs.active.keys()],ids);
  assert.ok(blobs.families.every(f=>f.blend>.95));
  assert.deepEqual(lab.positions,positions);assert.equal(lab.count,500);
  const frozen=blobs.update(lab);assert.deepEqual(blobs.update(lab),frozen);
  lab.neighborCounts.fill(30);
  for(let i=0;i<60;i++){lab.time+=.02;blobs.update(lab);}
  assert.equal(blobs.active.size,0);
  lab.neighborCounts.fill(0);lab.time+=.02;blobs.update(lab);lab.time=0;
  assert.equal(blobs.update(lab).length,0);
});

test('held parcels stay connected and activation is based on simulation time',()=>{
  const lab=fixture(2),a=new LabBlobFamilies(),b=new LabBlobFamilies();lab.positions[3]=1;
  a.update(lab);b.update(lab);lab.time=.02;a.update(lab);b.update(lab);
  assert.deepEqual([...a.active.keys()],[1]);
  for(let i=0;i<20;i++) {lab.time+=.01;a.update(lab);if(i%2===1)b.update(lab);}
  assert.ok(Math.abs(a.active.get(1)-b.active.get(1))<1e-12);
});
