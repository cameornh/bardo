import {shapeRadius} from '../sand-lab/sand-shape.js';
import {brickDistance} from './sand-bricks.js';

export class SandDistanceCache {
 constructor(workerFactory=()=>typeof Worker==='undefined'?null:new Worker(new URL('./sand-bricks.worker.js',import.meta.url),{type:'module'})) {
  this.entries=new Map();this.serial=0;this.hits=0;this.misses=0;this.completed=0;this.limit=64;
  try{this.worker=workerFactory();}catch{this.worker=null;}
  this.backend=this.worker?'CPU worker / exact CSG bricks':'CPU exact CSG';
  if(this.worker){this.worker.onmessage=e=>this.finish(e.data);this.worker.onerror=()=>{this.dispose();this.backend='CPU exact CSG';};}
 }
 valid(e,p){return e.cuts===p.cuts&&e.shape.cuts.length===p.cuts?.length&&e.shape.radius===shapeRadius(p)&&e.shape.aspect===(p.aspect||1);}
 refresh(parcels) {
  if(!this.worker){this.reset();return;}
  const alive=new Set(parcels);
  for(const [p,e] of this.entries)if(!alive.has(p)||!this.valid(e,p)){this.entries.delete(p);if(p.distanceCache===this)delete p.distanceCache;}
  // Settled geometry gets priority; a translated local cache remains valid.
  const candidates=parcels.filter(p=>p.mass>0&&p.cuts?.length>=3&&p.cuts.length<=30).sort((a,b)=>Number(!!b.anchored)-Number(!!a.anchored));
  for(const p of candidates){if(this.entries.size>=this.limit)break;if(this.entries.has(p))continue;
   const shape={radius:shapeRadius(p),aspect:p.aspect||1,cuts:p.cuts.map(c=>({...c,offset:c.offset.slice()}))};
   this.entries.set(p,{id:++this.serial,cuts:p.cuts,shape});Object.defineProperty(p,'distanceCache',{value:this,writable:true,configurable:true});
  }
  this.pump();
 }
 pump(){if(!this.worker||this.pending)return;for(const e of this.entries.values())if(!e.bricks){this.pending=e;this.worker.postMessage({id:e.id,shape:e.shape});break;}}
 finish({id,bricks}){const e=this.pending;if(!e||e.id!==id)return;this.pending=null;
  // A reply to a carved/deleted/reset parcel must never resurrect old geometry.
  if([...this.entries.values()].includes(e)){e.bricks=bricks;this.completed++;}this.pump();
 }
 distance(p,point){const e=this.entries.get(p);if(!e?.bricks||!this.valid(e,p)){this.misses++;return undefined;}
  const d=brickDistance(e.shape,e.bricks,point.map((v,k)=>v-p.position[k]));if(d===undefined)this.misses++;else this.hits++;return d;
 }
 reset(){for(const p of this.entries.keys())if(p.distanceCache===this)delete p.distanceCache;this.entries.clear();}
 dispose(){this.reset();this.worker?.terminate();this.worker=null;this.pending=null;}
}
