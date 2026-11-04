import {shapeRadius,shapeDistance,shapeBlend,sandIsTracer} from '../sand-lab/sand-shape.js';
import {sandExtent} from '../sand-lab/sand-bins.js';
import {BoundsGrid} from '../sand-lab/spatial-bounds.js';
import {normalAt} from '../sand-lab/water-lab-model.js';
import {meshField,meshNearest,activeOperand} from './collision-mesh.js';
const union=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/Math.max(k,1e-12);return Math.min(a,b)-h*h*k*.25;};
export const shapeKey=p=>JSON.stringify([shapeRadius(p),p.aspect||1,(p.cuts||[]).map(c=>[...c.offset,c.radius,c.aspect||1])]);
const active=p=>p.mass>0&&!p.held&&!sandIsTracer(p);
export class TerrainCollider{
 constructor({workerFactory=()=>typeof Worker==='undefined'?null:new Worker(new URL('./collision-mesh.worker.js',import.meta.url),{type:'module'}),limit=8}={}){
  this.entries=new Map();this.grid=new BoundsGrid();this.limit=limit;this.serial=0;this.stats={built:0,meshNormals:0,meshNormalReuses:0,exactNormals:0,fieldRejects:0,exactQueries:0};
  try{this.worker=workerFactory();}catch{this.worker=null;}
  if(this.worker){this.worker.onmessage=e=>this.finish(e.data);this.worker.onerror=()=>this.dispose();}
 }
 begin(bed,bodies,dt,enabled=true){
  if(this.bed!==bed){this.entries.clear();this.bed=bed;this.shapeRevision=-1;}
  if(this.shapeRevision!==bed.shapeRevision||this.sourceParcels!==bed.parcels){
  this.parcels=bed.parcels.filter(active);this.sourceParcels=bed.parcels;this.shapeRevision=bed.shapeRevision;
  if(!this.records||this.records.length!==this.parcels.length||this.records.some((e,i)=>e.p!==this.parcels[i])){this.grid.clear();this.records=[];}
  for(let i=0;i<this.parcels.length;i++){const p=this.parcels[i],r=shapeRadius(p),a=p.aspect||1,k=shapeBlend(p),e=this.records[i];
   if(!e||e.r!==r||e.a!==a||e.k!==k||p.position.some((v,j)=>v!==e.position[j])){this.grid.insert(i,p.position,Math.max(...sandExtent(p)));this.records[i]={p,r,a,k,position:p.position.slice()};}
  }
  }
  const alive=new Set(this.parcels);
  const nearby=p=>bodies.some(b=>Math.hypot(...b.position.map((v,k)=>v-p.position[k]))<shapeRadius(p)*Math.max(1,p.aspect||1)+b.radius*2+.5);
  for(const [p,e] of this.entries)if(!enabled||!alive.has(p)||!p.anchored||shapeKey(p)!==e.key||!nearby(p))this.entries.delete(p);
  if(enabled&&this.worker)for(const p of this.parcels){
   // Analytic shapes and a few cuts cost less than building/searching a mesh.
   if(!p.anchored||(p.cuts?.length||0)<4||p.cuts.length>30||this.entries.size>=this.limit&&!this.entries.has(p))continue;
   const r=shapeRadius(p);if(!nearby(p))continue;
   let e=this.entries.get(p);if(!e){e={id:++this.serial,key:shapeKey(p),stable:0,shape:{radius:r,aspect:p.aspect||1,cuts:p.cuts.map(c=>({...c,offset:c.offset.slice()}))}};this.entries.set(p,e);}
   e.stable+=dt;
  }
  this.pump();
 }
 pump(){if(!this.worker||this.pending)return;for(const e of this.entries.values())if(!e.mesh&&!e.failed&&e.stable>=.25){this.pending=e;this.worker.postMessage({id:e.id,shape:e.shape});break;}}
 finish({id,mesh,error}){const e=this.pending;if(!e||e.id!==id)return;this.pending=null;
  if([...this.entries.values()].includes(e)){
   const triangles=[...this.entries.values()].reduce((n,q)=>n+(q.mesh?.triangles.length||0),0);
   if(error||!mesh?.tree||mesh.triangles.length>50000||triangles+mesh.triangles.length>100000)e.failed=true;
   else{e.mesh=mesh;e.normals=new Map();e.normalCell=Math.max(1e-9,Math.min(e.shape.radius*.005,...e.shape.cuts.map(c=>Math.abs(c.radius)*.02)));this.stats.built++;}
  }this.pump();
 }
 valid(p){const e=this.entries.get(p);return p.anchored&&active(p)&&e?.mesh&&e.key===shapeKey(p)?e:null;}
 // Snapshot membership, but validate shape identity on every reused contact.
 // Changes within a substep (compaction or a broken bond) never use stale stock.
 forBody(b){
  const reach=b.radius*1.7+.01,ids=this.grid.query(b.position,reach),parcels=ids.map(i=>this.parcels[i]).filter(active),origin=b.position.slice(),meshes=new Map();
  for(const p of parcels){const e=this.valid(p);if(e)meshes.set(p,e);}
  const token=JSON.stringify([this.bed.bedGeometryRevision||0,this.bed.dirty,parcels.map(p=>[p.id,p.anchored,...p.position,shapeKey(p),shapeBlend(p)])]);
  const exact=q=>{this.stats.exactQueries++;let d=(q[1]-this.bed.height(q[0],q[2]))*.65;for(const p of parcels)if(active(p))d=union(d,shapeDistance(p,q),shapeBlend(p));return d;};
  const distance=q=>{
   let d=(q[1]-this.bed.height(q[0],q[2]))*.65;
   for(const p of parcels){if(!active(p))continue;const k=shapeBlend(p),e=p.anchored&&meshes.get(p);
    // Existing exact operand bricks are already cheaper near the surface;
    // don't stack a redundant interpolated query in front of those contacts.
    const f=e&&!p.distanceCache&&meshField(e.mesh,q.map((v,i)=>v-p.position[i]));
    // Outside a certified interval the shape cannot affect a contact or the
    // smooth join. Inside it retain the original exact CSG, even for thin cuts.
    if(f&&f.value-f.error>Math.max(.001,d+k)){this.stats.fieldRejects++;continue;}
    d=union(d,shapeDistance(p,q),k);
   }return d;
  };
  const normal=q=>{
   const base=(q[1]-this.bed.height(q[0],q[2]))*.65;let winner=null,best=base,second=Infinity;
   for(const p of parcels){if(!active(p))continue;const d=shapeDistance(p,q);if(d<best){second=best;best=d;winner=p;}else second=Math.min(second,d);}
   if(winner&&second-best>Math.max(.08,shapeBlend(winner))){const e=winner.anchored&&meshes.get(winner);
    if(e){const local=q.map((v,k)=>v-winner.position[k]),op=activeOperand(e.shape,local,e.mesh.bricks);
     // A subcell cut may be absent from the mesh: never borrow the enclosing
     // face's normal when the exact field says a different cut is active.
     const key=[op,...local.map(v=>Math.floor(v/e.normalCell))].join(',');
     const cached=e.normals?.get(key);if(cached){this.stats.meshNormalReuses++;return cached;}
     const hit=meshNearest(e.mesh,local,e.mesh.error*2);
     if(hit?.reliable&&hit.operand===op){this.stats.meshNormals++;e.normals?.set(key,hit.normal);if(e.normals?.size>128)e.normals.delete(e.normals.keys().next().value);return hit.normal;}
    }
   }
   this.stats.exactNormals++;return normalAt(q,exact);
  };
  return {distance,exact,normal,token,origin,plane:parcels.length?null:this.groundPlane(b),valid:()=>Math.hypot(...b.position.map((v,k)=>v-origin[k]))<b.radius*.1+.0001};
 }
 groundPlane(b){
  const bed=this.bed,r=b.radius*1.7+.01,n=bed.n,x0=Math.floor((b.position[0]-r+5.5)/bed.dx)-1,x1=Math.floor((b.position[0]+r+5.5)/bed.dx)+2,z0=Math.floor((b.position[2]-r+4.9)/bed.dz)-1,z1=Math.floor((b.position[2]+r+4.9)/bed.dz)+2;
  if(bed.dirty||x0<0||z0<0||x1>=n||z1>=n)return null;
  if(this.planeBed!==bed||this.planeRevision!==bed.bedGeometryRevision){this.planes=new Map();this.planeBed=bed;this.planeRevision=bed.bedGeometryRevision;}
  const key=[x0,x1,z0,z1].join(',');if(this.planes.has(key))return this.planes.get(key);
  const save=plane=>{if(this.planes.size>=128)this.planes.delete(this.planes.keys().next().value);this.planes.set(key,plane);return plane;};
  const y=bed.heightAt(x0+z0*n),sx=(bed.heightAt(x0+1+z0*n)-y)/bed.dx,sz=(bed.heightAt(x0+(z0+1)*n)-y)/bed.dz;
  for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)if(Math.abs(bed.heightAt(x+z*n)-y-sx*(x-x0)*bed.dx-sz*(z-z0)*bed.dz)>1e-9)return save(null);
  const length=Math.hypot(sx,1,sz),normal=[-sx/length,1/length,-sz/length],offset=(y-sx*(x0*bed.dx-5.5)-sz*(z0*bed.dz-4.9))/length;
  return save({normal,offset});
 }
 dispose(){this.worker?.terminate();this.worker=null;this.pending=null;this.entries.clear();}
 get backend(){return this.worker?'CPU contacts / worker collision meshes':'CPU contacts / exact geometry fallback';}
}
