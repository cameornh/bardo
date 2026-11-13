import {TerrainSurfaceCache} from './terrain-cache.js';
import {FoamGeometryCache} from './foam-cache.js';
export {terrainCoefficients,evaluateTerrain} from './terrain-cache.js';
export function installRepresentations(draw,{terrain=true,foam=true,foamLighting=false}={}){
 const result={terrain:terrain?new TerrainSurfaceCache(draw).install():null,foam:foam?new FoamGeometryCache(draw,{lighting:foamLighting}).install():null};
 result.jobs=()=>[...(result.terrain?.jobs()||[]),...(result.foam?.jobs()||[])];
 return result;
}
