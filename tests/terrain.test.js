import test from 'node:test';
import assert from 'node:assert/strict';
import { Terrain, terrainHeight, desiredChunks, editsForChunk } from '../src/terrain.js';
import { TerrainStreamer } from '../src/streaming.js';
import { sampleRegion } from '../src/sampling.js';
import { World } from '../src/world.js';
import { Probe } from '../src/physics.js';

test('terrain edits compose in order, undo, persist, and reject invalid saves atomically',()=>{
  const terrain=new Terrain();
  assert.equal(terrain.distance([0,0,0]),0);
  assert.ok(terrain.edit([0,0,0],2,'subtract'));
  assert.equal(terrain.distance([0,0,0]),2);
  assert.ok(terrain.edit([0,0,0],1,'add'));
  assert.equal(terrain.distance([0,0,0]),-1);
  const restored=new Terrain();assert.ok(restored.restore(terrain.serialize()));
  assert.deepEqual(restored.edits,terrain.edits);
  const saved=restored.serialize();
  assert.equal(restored.restore('{"version":1,"edits":[[0,0,0,100,1]]}'),false);
  assert.equal(restored.serialize(),saved);
  assert.ok(restored.undo());assert.equal(restored.distance([0,0,0]),2);
  assert.equal(restored.edit([0,11,0],2),false);
  assert.equal(restored.edit([0,0],1),false);
});

test('chunk selection stays bounded across negative coordinates and long travel',()=>{
  for(const [x,z] of [[0,0],[-.1,-.1],[128,7],[-1024,4096]]){
    const chunks=desiredChunks(x,z);
    assert.equal(chunks.length,49);assert.equal(new Set(chunks.map(c=>c.key)).size,49);
    assert.equal(chunks[0].cx,Math.floor(x/16));assert.equal(chunks[0].cz,Math.floor(z/16));
    assert.equal(chunks.filter(c=>c.spacing===.5).length,9);
  }
});

test('both sides of a chunk boundary receive the same cut and samples follow its surface',()=>{
  const terrain=new Terrain(),y=terrainHeight(16,4);
  terrain.edit([16,y,4],1.5);
  assert.deepEqual(editsForChunk(terrain.edits,0,0),terrain.edits);
  assert.deepEqual(editsForChunk(terrain.edits,1,0),terrain.edits);
  assert.equal(editsForChunk(terrain.edits,20,0).length,0);
  for(const bounds of [[[14,y-3,2],[16.5,y+1,6]],[[15.5,y-3,2],[18,y+1,6]]]){
    const samples=sampleRegion((...p)=>terrain.distance(p),p=>terrain.normal(p),...bounds,.25);
    assert.ok(samples.count>20);
    for(let i=0;i<samples.count;i++)assert.ok(Math.abs(terrain.distance([...samples.centers.slice(i*3,i*3+3)]))<.025);
  }
});

function harness(){
  const terrain=new Terrain(),live=new Set(),worker={postMessage(job){this.job=job;},terminate(){}};
  const renderer={addBatch(samples){const b={count:samples.count};live.add(b);return b;},removeBatch(b){assert.ok(live.delete(b));}};
  const streamer=new TerrainStreamer(terrain,renderer,worker);
  const finish=()=>streamer.receive({token:worker.job.token,samples:{count:10},ms:1});
  const drain=()=>{let limit=100;while(streamer.pending&&limit-->0)finish();assert.ok(limit>0);};
  return {terrain,live,worker,streamer,finish,drain};
}

test('streaming evicts geometry, preserves edits, and regenerates the same region',()=>{
  const h=harness();h.terrain.edit([0,0,0],1);h.streamer.update(0,0);h.drain();
  assert.equal(h.live.size,49);assert.equal(h.streamer.bytes,49*10*32);
  const signatures=[...h.streamer.resident].map(([k,v])=>[k,v.signature]);
  h.streamer.update(128,0);assert.equal(h.live.size,0);h.drain();
  assert.equal(h.live.size,49);assert.equal(h.streamer.evicted,49);
  assert.equal(h.terrain.edits.length,1);
  h.streamer.update(0,0);h.drain();
  assert.deepEqual([...h.streamer.resident].map(([k,v])=>[k,v.signature]),signatures);
  h.streamer.dispose();assert.equal(h.live.size,0);
});

test('late worker results cannot resurrect evicted or superseded geometry',()=>{
  const h=harness();h.streamer.update(0,0);const oldKey=h.worker.job.key;
  h.streamer.update(128,0);h.finish();
  assert.equal(h.streamer.resident.has(oldKey),false);h.drain();
  h.streamer.update(0,0);h.terrain.edit([0,0,0],1);h.streamer.update(0,0);h.finish();
  assert.equal(h.streamer.resident.has('0,0'),false);h.drain();
  assert.ok(h.streamer.resident.get('0,0').signature.includes('[[0,0,0,1,-1]]'));
  h.streamer.update(0,0,false);h.drain();assert.equal(h.live.size,0);
});

test('terrain contact converts distance bounds to contact distance and works beyond origin',()=>{
  const world=new World();world.terrainEnabled=true;
  assert.equal(world.distanceTo(6,[7,1,0]),.5);
  assert.ok(Math.abs(world.collisionSample([7,1,0],5).distance-1)<1e-8);
  const probe=new Probe(world);probe.dropAt([128,terrainHeight(128,0)+4,0]);
  for(let i=0;i<1000;i++)probe.step(1/120);
  assert.ok(probe.position.x>50,'a rolling probe must remain far from the origin, without resetting');
  assert.ok(probe.contacts>0);
  assert.ok(world.collisionSample(probe.position.toArray(),5).distance>=probe.radius-.002);
});
