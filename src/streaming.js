import { desiredChunks, editsForChunk, CHUNK_SIZE } from './terrain.js';

export class TerrainStreamer {
  constructor(terrain,renderer,worker=new Worker(new URL('./terrain-worker.js',import.meta.url),{type:'module'})) {
    this.terrain=terrain; this.renderer=renderer; this.worker=worker;
    this.resident=new Map(); this.wanted=new Map(); this.queue=[]; this.pending=null;
    this.token=0; this.generated=0; this.evicted=0; this.lastBuildMs=0; this.error=null;
    this.radius=3;this.vegetation=true;
    worker.onmessage=({data})=>this.receive(data);
    worker.onerror=event=>{this.error=event.message||'Terrain worker failed';this.pending=null;};
  }
  update(x,z,enabled=true) {
    const desired=enabled?desiredChunks(x,z,this.radius):[];
    this.wanted=new Map(desired.map(chunk=>{
      const edits=editsForChunk(this.terrain.edits,chunk.cx,chunk.cz);
      // Residency no longer changes sampling grids as the camera crosses a
      // ring. Each stable chunk owns a hierarchy; draw LOD changes per frame.
      const spacing=.5;
      const signature=`${spacing}:${this.vegetation?1:0}:${JSON.stringify(edits)}`;
      return [chunk.key,{...chunk,spacing,edits,signature,vegetation:this.vegetation}];
    }));
    for(const [key,entry] of this.resident)if(!this.wanted.has(key)) {
      this.renderer.removeBatch(entry.batch);this.resident.delete(key);this.evicted++;
    }
    this.queue=[...this.wanted.values()].filter(c=>this.resident.get(c.key)?.signature!==c.signature
      && !(this.pending?.key===c.key&&this.pending.signature===c.signature));
    this.pump();
  }
  pump() {
    if(this.pending||this.error)return;
    const job=this.queue.shift();if(!job)return;
    this.pending={...job,token:++this.token};this.worker.postMessage(this.pending);
  }
  receive(result) {
    const job=this.pending;
    if(!job||result.token!==job.token)return;
    this.pending=null;
    if(result.error){this.error=result.error;return;}
    const desired=this.wanted.get(job.key);
    if(desired?.signature===job.signature) {
      const old=this.resident.get(job.key);if(old)this.renderer.removeBatch(old.batch);
      const batch=this.renderer.addBatch(result.samples,6,0,{
        terrain:true,key:job.key,edited:job.edits.length>0,
        bounds:[job.cx*CHUNK_SIZE,job.cz*CHUNK_SIZE,(job.cx+1)*CHUNK_SIZE,(job.cz+1)*CHUNK_SIZE],
      });
      this.resident.set(job.key,{signature:job.signature,batch});
      this.generated++;this.lastBuildMs=result.ms;
    }
    this.pump();
  }
  get busy(){return this.queue.length+(this.pending?1:0);}
  get bytes(){let total=0;for(const {batch} of this.resident.values())total+=batch.byteLength??batch.count*8*4;return total;}
  dispose(){this.worker.terminate();for(const {batch} of this.resident.values())this.renderer.removeBatch(batch);this.resident.clear();}
}
