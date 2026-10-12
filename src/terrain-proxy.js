import { CHUNK_SIZE, terrainHeight, terrainNormal, editsForChunk } from './terrain.js';

export const TERRAIN_FADE_START=112;
export const TERRAIN_FADE_END=152;
export const PROXY_RADIUS=11;
export function terrainFade(distance){const t=Math.max(0,Math.min(1,(distance-TERRAIN_FADE_START)/(TERRAIN_FADE_END-TERRAIN_FADE_START)));return 1-t*t*(3-2*t);}

// Cheap upper-surface stand-ins are available synchronously, including while
// the worker builds a nearby edited chunk. They never affect collision geometry.
export function sampleTerrainProxy(cx,cz,terrain,spacing=4){
 const centers=[],normals=[],radii=[];
 for(let z=cz*CHUNK_SIZE-spacing;z<=(cz+1)*CHUNK_SIZE+spacing;z+=spacing)for(let x=cx*CHUNK_SIZE-spacing;x<=(cx+1)*CHUNK_SIZE+spacing;x+=spacing){
  let y=terrainHeight(x,z);
  if(terrain.edits.length){
   y=11;for(let step=0;step<100;step++){const d=terrain.distance([x,y,z]);if(d<.002)break;y-=Math.max(d*.9,.003);if(y<-12)break;}
  }
  centers.push(x,y,z);normals.push(...terrainNormal([x,y,z],terrain.edits));radii.push(spacing*.7);
 }
 return {centers:new Float32Array(centers),normals:new Float32Array(normals),radii:new Float32Array(radii),count:radii.length};
}

export class TerrainProxies {
 constructor(renderer){this.renderer=renderer;this.entries=new Map();this.signature='';}
 update(x,z,terrain,enabled){
  const cx=Math.floor(x/CHUNK_SIZE),cz=Math.floor(z/CHUNK_SIZE),signature=`${enabled}:${cx}:${cz}:${terrain.serialize()}`;
  if(signature===this.signature)return;this.signature=signature;
  const wanted=new Set();
  if(enabled)for(let dz=-PROXY_RADIUS;dz<=PROXY_RADIUS;dz++)for(let dx=-PROXY_RADIUS;dx<=PROXY_RADIUS;dx++){
   if(Math.hypot(dx,dz)>PROXY_RADIUS)continue;
   const bx=cx+dx,bz=cz+dz,key=`${bx},${bz}`;wanted.add(key);
   const edits=editsForChunk(terrain.edits,bx,bz,4),revision=JSON.stringify(edits),old=this.entries.get(key);if(old?.revision===revision)continue;
   if(old)this.renderer.removeBatch(old.batch);
   const localTerrain=Object.create(terrain);localTerrain.edits=edits;
   const batch=this.renderer.addBatch(sampleTerrainProxy(bx,bz,localTerrain),6,0,{terrain:true,proxy:true,key,bounds:[bx*16,bz*16,(bx+1)*16,(bz+1)*16]});
   this.entries.set(key,{batch,revision});
  }
  for(const [key,entry] of this.entries)if(!wanted.has(key)){this.renderer.removeBatch(entry.batch);this.entries.delete(key);}
 }
 dispose(){for(const {batch} of this.entries.values())this.renderer.removeBatch(batch);this.entries.clear();}
}
