import {DataTexture,RedFormat,FloatType,Vector2,Vector4} from 'three';
import {CELL} from './ground-tools.js';
import {SAND_SIDE} from './wind-sand.js';

const tilesAcross=12,N=SAND_SIDE;
function heightTexture(width,height){
 const texture=new DataTexture(new Float32Array(width*height),width,height,RedFormat,FloatType);
 texture.needsUpdate=true;return texture;
}
// Only upload edited tiles in the visible window. A one-node zero border lets
// the GPU interpolate down to the unedited bed on every edge.
export class SandTerrainView{
 constructor(uniforms){
  this.texture=heightTexture(1,1);this.uniforms=uniforms;
  Object.assign(uniforms,{localBed:{value:this.texture},localOrigin:{value:new Vector2()},
   localExtent:{value:new Vector4(1,1,-1,-1)}});
  this.versions=new Map();
 }
 update(terrain,camera){
  const u=this.uniforms;
  if(!terrain?.version){this.terrain=null;u.localExtent.value.set(1,1,-1,-1);return;}
  const x=Math.round(camera.x/(CELL*N))-tilesAcross/2,z=Math.round(camera.z/(CELL*N))-tilesAcross/2;
  if(this.terrain===terrain&&this.x===x&&this.z===z&&this.version===terrain.version)return;
  this.x=x;this.z=z;this.version=terrain.version;
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  const visible=[];
  for(let j=z;j<z+tilesAcross;j++)for(let i=x;i<x+tilesAcross;i++){
   const tile=terrain.tile(i,j);if(!tile)continue;
   visible.push([i,j,tile]);minX=Math.min(minX,i);maxX=Math.max(maxX,i);minZ=Math.min(minZ,j);maxZ=Math.max(maxZ,j);
  }
  if(!visible.length){this.terrain=null;u.localExtent.value.set(1,1,-1,-1);return;}
  const width=(maxX-minX+1)*N+2,height=(maxZ-minZ+1)*N+2;
  const resized=this.texture.image.width!==width||this.texture.image.height!==height;
  if(resized){this.texture.dispose();this.texture=heightTexture(width,height);u.localBed.value=this.texture;}
  const fresh=resized||this.terrain!==terrain||minX!==this.minX||minZ!==this.minZ;
  this.terrain=terrain;this.minX=minX;this.minZ=minZ;
  const data=this.texture.image.data;
  if(fresh){this.versions.clear();if(!resized)data.fill(0);}
  let dirty=fresh;
  for(const [i,j,tile] of visible){
   if(this.versions.get(tile)===tile.version)continue;
   const start=(i-minX)*N+1+((j-minZ)*N+1)*width;
   for(let k=0;k<N;k++)data.set(tile.heights.subarray(k*N,k*N+N),start+k*width);
   this.versions.set(tile,tile.version);dirty=true;
  }
  u.localOrigin.value.set(minX*N-1,minZ*N-1);
  u.localExtent.value.set(0,0,width-1,height-1);
  if(dirty)this.texture.needsUpdate=true;
 }
 dispose(){this.texture.dispose();}
}
