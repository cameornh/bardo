// Exact memoization of the already synchronized terrain snapshot. Only repeated
// identical x/z queries are reused; edited parcels, bodies and player SDFs are
// still evaluated by the caller. No quantization, camera LOD or stale heights.
export class SnapshotHeights {
 constructor(limit=8192){this.limit=limit;this.columns=new Map();this.size=0;this.hits=0;this.misses=0;this.resets=0;}
 sample(bed,heights,revision,x,z){
  if(this.bed!==bed||this.heights!==heights||this.revision!==revision){this.columns.clear();this.size=0;this.bed=bed;this.heights=heights;this.revision=revision;this.resets++;}
  const column=this.columns.get(x),cached=column?.get(z);
  if(cached!==undefined){this.hits++;return cached;}
  this.misses++;const height=bed.heightCached(x,z,heights);
  // Stop caching new locations when full. The next snapshot releases all keys;
  // random moving queries can never grow history or evict hot fixed grid sites.
  if(this.size<this.limit){const row=column||new Map();if(!column)this.columns.set(x,row);row.set(z,height);this.size++;}
  return height;
 }
}
export function installSnapshotHeights(lab){
 if(lab.snapshotHeights)return;const reference=lab.terrainHeight.bind(lab);lab.snapshotHeights=new SnapshotHeights();lab.optimizations.snapshotHeights??=true;
 lab.terrainHeight=function(x,z){
  if(this.optimizations.snapshotHeights===false||this.optimizations.terrainCache===false)return reference(x,z);
  this.syncSandUniforms();return this.snapshotHeights.sample(this.sand,this.terrainHeights,this.sandRevision,x,z);
 };
}
