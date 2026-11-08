// Two bounded readback slots. Timing never adds a queue wait, and a busy slot
// drops a diagnostic sample rather than delaying physics or presentation.
export class PassTimestamps {
 constructor(device,{enabled=true,capacity=256,createBuffer=d=>device.createBuffer(d),destroyBuffer=b=>b.destroy(),now=()=>performance.now()}={}){
  this.device=device;this.supported=!!device.features?.has('timestamp-query');this.enabled=enabled&&this.supported;this.capacity=capacity;this.slots=[];this.createBuffer=createBuffer;this.destroyBuffer=destroyBuffer;this.now=now;this.sequence=0;this.skipped=0;this.rejected=0;this.latest=null;
 }
 begin(){
  if(!this.enabled||this.disposed)return null;
  let slot=this.slots.find(s=>!s.busy);
  if(!slot&&this.slots.length<2){
   const size=this.capacity*16;slot={busy:false};
   try{slot.query=this.device.createQuerySet({type:'timestamp',count:this.capacity*2});slot.resolve=this.createBuffer({size,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});slot.read=this.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});this.slots.push(slot);}
   catch(error){slot.query?.destroy();if(slot.resolve)this.destroyBuffer(slot.resolve);if(slot.read)this.destroyBuffer(slot.read);this.enabled=false;this.error=error.message;return null;}
  }
  if(!slot){this.skipped++;return null;}
  slot.busy=true;return {slot,labels:[],sequence:++this.sequence,resolved:false};
 }
 writes(batch,label){
  if(!batch)return undefined;
  if(batch.labels.length===this.capacity){this.skipped++;batch.truncated=true;return undefined;}
  const index=batch.labels.length*2;batch.labels.push(label);
  return {querySet:batch.slot.query,beginningOfPassWriteIndex:index,endOfPassWriteIndex:index+1};
 }
 resolve(encoder,batch){
  if(!batch)return;if(!batch.labels.length){this.cancel(batch);return;}
  const count=batch.labels.length*2;encoder.resolveQuerySet(batch.slot.query,0,count,batch.slot.resolve,0);encoder.copyBufferToBuffer(batch.slot.resolve,0,batch.slot.read,0,count*8);batch.resolved=true;batch.encodedAt=this.now();
 }
 submitted(batch){
  if(!batch?.resolved)return;
  const {slot,labels,sequence}=batch;
  batch.pending=slot.read.mapAsync(GPUMapMode.READ).then(()=>{
   if(this.disposed)return;
   const ticks=new BigUint64Array(slot.read.getMappedRange()),passes=[];let first=null,last=0n;
   for(let i=0;i<labels.length;i++){
    const delta=ticks[i*2+1]-ticks[i*2];
    // Timestamp counters may reset. Reject, never turn that into a huge cost.
    if(delta<0n||delta>60000000000n){this.reject(sequence,'Timestamp counter discontinuity');return;}
    first=first===null||ticks[i*2]<first?ticks[i*2]:first;last=ticks[i*2+1]>last?ticks[i*2+1]:last;
    passes.push({name:labels[i],ms:Number(delta)*1e-6});
   }
   const sumMs=passes.reduce((s,p)=>s+p.ms,0),spanMs=Number(last-first)*1e-6,elapsedMs=this.now()-batch.encodedAt;
   // Passes can overlap/reorder on the GPU. Their sum is NOT frame duration.
   // Only the enclosing span is compared with submission-to-map wall time.
   // Allow coarse browser clocks; reject inconsistent spans, never rescale.
   if(spanMs>elapsedMs+5){this.reject(sequence,'GPU timestamp span exceeds elapsed wall time',{sumMs,spanMs,elapsedMs});return;}
   const byName={};for(const p of passes)byName[p.name]=(byName[p.name]||0)+p.ms;
   if(!this.latest||sequence>this.latest.sequence)this.latest={sequence,truncated:!!batch.truncated,sumMs,spanMs,elapsedMs,passes,byName};
  }).catch(error=>{if(!this.disposed){this.enabled=false;this.error=error.message;}}).finally(()=>{if(slot.read.mapState==='mapped')slot.read.unmap();slot.busy=false;});
 }
 reject(sequence,reason,details={}){this.rejected++;this.lastRejected={sequence,reason,...details};}
 cancel(batch){if(batch&&!batch.pending)batch.slot.busy=false;}
 snapshot(){return {supported:this.supported,enabled:this.enabled,skipped:this.skipped,rejected:this.rejected,lastRejected:this.lastRejected||null,error:this.error||null,sample:this.latest};}
 dispose(){if(this.disposed)return;this.disposed=true;for(const s of this.slots){s.query.destroy();this.destroyBuffer(s.resolve);this.destroyBuffer(s.read);}this.slots=[];}
}
