import test from 'node:test';
import assert from 'node:assert/strict';
import {sandResolutionForWater,interactionRadiusRange} from '../src/sand-lab/resolution.js';
import {SandBed} from '../src/sand-lab/sand.js';
import {solidRayHit,waterRayHit,selectWaterParcels} from '../src/sand-lab/interaction.js';

test('sand follows the actual water spacing and stays bounded',()=>{
 const values=[1,2.2,3].map(q=>sandResolutionForWater(.42/q));
 assert.ok(values[0]<values[1]&&values[1]<values[2]);
 for(const spacing of [.42,.191,.14,.11])assert.ok(11/(sandResolutionForWater(spacing)-1)<=spacing*.9);
 assert.equal(sandResolutionForWater(.0001),129);
});
test('brush minimum remains below the smallest reconstructed blob radius at every supported scale',()=>{
 for(const spacing of [.42,.191,.14,.11])for(const scale of [4,10,20]){
  const {min,step}=interactionRadiusRange(spacing,scale);
  assert.ok(min>0&&step>0&&step<=min);assert.ok(min<spacing*scale*.65*Math.cbrt(.004));
 }
});
test('tiny sand pickup between grid nodes removes conserved stock and carries moisture at the hit point',()=>{
 for(const n of [31,66,89]){
  const bed=new SandBed(n);bed.wet.fill(.9);const x=.047,z=3.023,origin=[x,3,z],ray=solidRayHit(bed,[],origin,[0,-1,0]);
  assert.ok(ray&&Math.abs(ray.point[1]-bed.height(x,z))<1e-5);
  const before=bed.totalMass(),radius=.0047,pieces=bed.extract(ray.point,radius,[0,0,0],true);
  assert.equal(pieces.length,1);assert.ok(pieces[0].mass>1e-9);assert.ok(pieces[0].mass<4*Math.PI/3*radius**3*.56);
  assert.ok(Math.abs(pieces[0].wet-.9)<1e-10);assert.equal(pieces[0].position[0],x);assert.equal(pieces[0].position[2],z);
  assert.ok(Math.abs(bed.totalMass()-before)<1e-10);
  const carved=bed.carve([x+.03,bed.height(x+.03,z),z],radius);assert.ok(carved>0);assert.ok(Math.abs(bed.totalMass()+bed.removedMass-before)<1e-10);
 }
});
test('sub-resolution water selection hits one existing parcel and does not reach unrelated water',()=>{
 const positions=new Float32Array([0,0,0,0,1,0,0,0]),spacing=.2,hit=waterRayHit(positions,spacing,[0,1,0],[0,-1,0]);
 assert.deepEqual(selectWaterParcels(positions,hit.point,.005,spacing),[0]);
 assert.deepEqual(selectWaterParcels(positions,[0,4,0],.005,spacing),[]);
 assert.equal(positions.length,8);
});
