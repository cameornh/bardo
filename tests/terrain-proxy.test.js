import test from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/terrain.js';
import { TerrainProxies,sampleTerrainProxy,terrainFade,TERRAIN_FADE_START,TERRAIN_FADE_END } from '../src/terrain-proxy.js';

test('terrain proxies immediately cover unbuilt chunks, stay bounded, and reuse unaffected chunks after edits',()=>{
 const live=new Set(),renderer={addBatch(samples,id,level,options){const b={...options,count:samples.count};live.add(b);return b;},removeBatch(b){assert.ok(live.delete(b));}},terrain=new Terrain(),proxies=new TerrainProxies(renderer);
 proxies.update(0,0,terrain,true);assert.equal(proxies.entries.size,377);assert.ok(proxies.entries.has('0,0'));const far=proxies.entries.get('8,0').batch,near=proxies.entries.get('0,0').batch;
 terrain.edit([0,0,0],3);proxies.update(0,0,terrain,true);assert.equal(proxies.entries.get('8,0').batch,far);assert.notEqual(proxies.entries.get('0,0').batch,near);
 proxies.update(1000,-1000,terrain,true);assert.equal(live.size,377);assert.equal(proxies.entries.has('0,0'),false);proxies.update(0,0,terrain,false);assert.equal(live.size,0);
});

test('coarse proxy samples follow the upper edited field and fade continuously before their boundary',()=>{
 const t=new Terrain();t.edit([0,0,0],3);const s=sampleTerrainProxy(0,0,t);
 for(let i=0;i<s.count;i++)assert.ok(Math.abs(t.distance(Array.from(s.centers.subarray(i*3,i*3+3))))<.005);
 assert.equal(terrainFade(TERRAIN_FADE_START),1);assert.equal(terrainFade(TERRAIN_FADE_END),0);assert.ok(Math.abs(terrainFade((TERRAIN_FADE_START+TERRAIN_FADE_END)/2)-.5)<1e-8);
 for(let d=TERRAIN_FADE_START;d<TERRAIN_FADE_END;d+=.1)assert.ok(terrainFade(d)>=terrainFade(d+.1));
});
