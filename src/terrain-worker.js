import { sampleRegion } from './sampling.js';
import { buildGaussianHierarchy } from './gaussians.js';
import { MATERIALS } from './world.js';
import { buildGrassChunk } from './grass.js';
import { terrainDistance, terrainNormal, CHUNK_SIZE, TERRAIN_MIN_Y, TERRAIN_MAX_Y } from './terrain.js';

self.onmessage=({data:job})=>{
  const start=performance.now();
  try {
    const {cx,cz,spacing,edits}=job;
    const minimum=[cx*CHUNK_SIZE-spacing,TERRAIN_MIN_Y,cz*CHUNK_SIZE-spacing];
    const maximum=[(cx+1)*CHUNK_SIZE+spacing,TERRAIN_MAX_Y,(cz+1)*CHUNK_SIZE+spacing];
    const samples=sampleRegion((x,y,z)=>terrainDistance(x,y,z,edits),p=>terrainNormal(p,edits),minimum,maximum,spacing);
    const hierarchy=buildGaussianHierarchy(samples,MATERIALS[6]);
    const grass=job.vegetation?buildGrassChunk(cx,cz,edits):null;
    const transfers=[hierarchy.packed.buffer];if(grass)transfers.push(grass.records.buffer,grass.heights.buffer);
    self.postMessage({token:job.token,key:job.key,samples:{hierarchy,grass},ms:performance.now()-start},transfers);
  } catch(error) { self.postMessage({token:job.token,key:job.key,error:String(error)}); }
};
