import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGrassChunk, grassSurface, GrassDynamics, GRASS_GRID, GRASS_STRIDE } from '../src/grass.js';
import { terrainDistance } from '../src/terrain.js';
import { MotionDetail } from '../src/lod.js';
import { World } from '../src/world.js';
import { Probe } from '../src/physics.js';

test('grass roots are deterministic, stay within their chunk and attach to edited terrain',()=>{
  const edits=[[8,0,8,2,-1],[4,0,4,1.2,1]];
  const a=buildGrassChunk(0,0,edits),b=buildGrassChunk(0,0,edits);
  assert.deepEqual(a.records,b.records);assert.equal(a.heights.length,GRASS_GRID**2);
  for(let i=0;i<a.records.length;i+=GRASS_STRIDE){
    const [x,y,z]=a.records.subarray(i,i+3);
    assert.ok(x>=0&&x<16&&z>=0&&z<16);
    assert.ok(Math.abs(terrainDistance(x,y-.012,z,edits))<.006);
  }
  assert.ok(grassSurface(8,8,edits)<-1.9,'roots follow the carved floor');
  assert.ok(grassSurface(4,4,edits)>1.19,'roots attach to added terrain');
  assert.ok(a.levels.at(-1).count<a.levels[0].count/100);
});

test('rolling physics ball bends nearby grass, an airborne ball does not, and springs recover',()=>{
  const world=new World();world.terrainEnabled=true;world.showcaseEnabled=false;
  const probe=new Probe(world),dynamics=new GrassDynamics();
  const chunk=dynamics.add('0,0',buildGrassChunk(0,0),0);
  dynamics.step(1/120,[3,4,3],[4,4,3],probe.radius);assert.equal(chunk.active.size,0);
  probe.dropAt([2,.445,3]);probe.velocity.set(3,0,0);probe.angularVelocity.set(0,0,-3/probe.radius);
  for(let i=0;i<120;i++){const previous=probe.position.toArray();probe.step(1/120);dynamics.step(1/120,previous,probe.position.toArray(),probe.radius);}
  assert.ok(probe.position.x>4);assert.ok(dynamics.bent>5);assert.ok(probe.contacts>0);
  assert.ok(chunk.field.some((v,i)=>i%4===2&&v>.4),'contact visibly flattens the blades');
  for(let i=0;i<1200;i++)dynamics.step(1/120,[100,10,100],[100,10,100],probe.radius);
  assert.equal(chunk.active.size,0);assert.equal(dynamics.bent,0);
});

test('grass deformation crosses chunk seams and survives render LOD changes',()=>{
  const d=new GrassDynamics();const a=d.add('-1,0',buildGrassChunk(-1,0),0),b=d.add('0,0',buildGrassChunk(0,0),1);
  for(let i=0;i<60;i++)d.step(1/120,[-.1,.44,4],[.1,.44,4],.43);
  for(let z=0;z<GRASS_GRID;z++)for(let k=0;k<3;k++)assert.ok(Math.abs(a.field[(z*GRASS_GRID+32)*4+k]-b.field[z*GRASS_GRID*4+k])<1e-6);
  assert.ok(a.active.size&&b.active.size);
  d.remove('-1,0');assert.equal(d.chunks.size,1);assert.ok(b.active.size);
  d.clear();assert.equal(b.active.size,0);assert.ok(b.field.every(v=>v===0));
});

test('steady motion coarsening grows linearly with camera speed',()=>{
  const factor=speed=>{const m=new MotionDetail();for(let i=0;i<600;i++)m.update(speed,1/60);return m.factor;};
  assert.ok(Math.abs(factor(160)-2)<.0001);
  assert.ok(Math.abs(factor(320)-3)<.0001);
  assert.ok(Math.abs(factor(640)-5)<.0001);
});

test('grass draw selection respects its cap and cached draws still receive deformation',async()=>{
  const {GrassRenderer}=await import('../src/grass-renderer.js');
  const {PerspectiveCamera,Vector2}=await import('three');
  const camera=new PerspectiveCamera(50,1,.1,220);camera.position.set(8,4,12);camera.lookAt(8,0,6);camera.updateMatrixWorld();
  const world=new World(),probe=new Probe(world);
  const renderer=new GrassRenderer({uResolution:{value:new Vector2(500,500)}});
  renderer.addChunk('0,0',buildGrassChunk(0,0));renderer.addChunk('1,0',buildGrassChunk(1,0));
  for(const budget of [2000,6000,12000]){renderer.budget=budget;renderer.prepare(camera,probe,1,1/60);assert.ok(renderer.count<=budget);assert.ok(renderer.count>0);}
  for(let i=0;i<300;i++)renderer.prepare(camera,probe,1,1/60);
  const version=renderer.geometry.attributes.aRootHeight.version;
  camera.matrixWorld.elements[12]+=1e-9;
  for(let i=0;i<30;i++)renderer.dynamics.step(1/120,[8,.44,6],[8,.44,6],.43);
  renderer.prepare(camera,probe,1,1/60);
  assert.equal(renderer.geometry.attributes.aRootHeight.version,version,'fixed view reuses the draw list');
  assert.ok(renderer.atlasData.some((v,i)=>i%4===2&&v>.5),'the bend texture updates even when the draw list is cached');
  renderer.removeChunk('0,0');renderer.addChunk('0,0',buildGrassChunk(0,0));renderer.prepare(camera,probe,1,1/60);
  assert.ok(renderer.atlasData.every(v=>v===0),'regenerated chunks do not inherit stale bends');renderer.dispose();
});
