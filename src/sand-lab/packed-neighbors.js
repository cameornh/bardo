import {NEIGHBORS} from './water-lab-model.js';

// Compact cell ranges, retaining input order within each cell and discovery
// order across cells. No particle identity changes or per-cell JS arrays.
export class PackedPointGrid {
 constructor(){this.capacity=0;}
 allocate(n){
  if(n<=this.capacity)return;
  this.capacity=2**Math.ceil(Math.log2(Math.max(16,n)));
  const n0=this.capacity;this.table=new Int32Array(n0*4);this.xyz=new Int32Array(n0*3);
  this.counts=new Uint32Array(n0);this.starts=new Uint32Array(n0+1);this.cursors=new Uint32Array(n0);
  this.particleCell=new Uint32Array(n0);this.indices=new Uint32Array(n0);
 }
 hash(x,y,z){return (Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))>>>0;}
 cell(x,y,z,create=false){
  let slot=this.hash(x,y,z)&(this.table.length-1);
  while(this.table[slot]){const i=this.table[slot]-1,o=i*3;if(this.xyz[o]===x&&this.xyz[o+1]===y&&this.xyz[o+2]===z)return i;slot=(slot+1)&(this.table.length-1);}
  if(!create)return -1;
  const i=this.cellCount++;this.table[slot]=i+1;this.xyz[i*3]=x;this.xyz[i*3+1]=y;this.xyz[i*3+2]=z;return i;
 }
 build(positions,reach){
  const n=positions.length/4;this.allocate(Math.max(1,n));this.reach=reach;this.cellCount=0;this.table.fill(0);this.counts.fill(0);
  for(let i=0;i<n;i++){const o=i*4,c=this.cell(Math.floor(positions[o]/reach),Math.floor(positions[o+1]/reach),Math.floor(positions[o+2]/reach),true);this.particleCell[i]=c;this.counts[c]++;}
  let offset=0;for(let c=0;c<this.cellCount;c++){this.starts[c]=this.cursors[c]=offset;offset+=this.counts[c];}this.starts[this.cellCount]=offset;
  for(let i=0;i<n;i++)this.indices[this.cursors[this.particleCell[i]]++]=i;
  return this;
 }
}

export class PackedNeighbors {
 constructor(){this.grid=new PackedPointGrid();this.capacity=0;}
 build(positions,spacing){
  const n=positions.length/4,reach=spacing*2.65,r2max=reach*reach,g=this.grid.build(positions,reach);
  if(n>this.capacity){this.capacity=g.capacity;this.data=new Float32Array(this.capacity*NEIGHBORS);this.counts=new Uint16Array(this.capacity);}
  if(!this.data){this.data=new Float32Array(0);this.counts=new Uint16Array(0);}
  this.data.fill(-1,0,n*NEIGHBORS);this.counts.fill(0,0,n);let overflow=0;const data=this.data,counts=this.counts,indices=g.indices,starts=g.starts;
  const pair=(i,j)=>{const a=i*4,b=j*4,x=positions[a]-positions[b],y=positions[a+1]-positions[b+1],z=positions[a+2]-positions[b+2];if(x*x+y*y+z*z>=r2max)return;
   if(counts[i]===NEIGHBORS||counts[j]===NEIGHBORS){overflow++;return;}
   data[i*NEIGHBORS+counts[i]++]=j;data[j*NEIGHBORS+counts[j]++]=i;
  };
  for(let c=0;c<g.cellCount;c++){
   const start=starts[c],end=starts[c+1],o=c*3;
   for(let a=start;a<end;a++)for(let b=a+1;b<end;b++)pair(indices[a],indices[b]);
   for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
    if(z<0||z===0&&y<0||z===0&&y===0&&x<=0)continue;
    const other=g.cell(g.xyz[o]+x,g.xyz[o+1]+y,g.xyz[o+2]+z);if(other<0)continue;
    for(let a=start;a<end;a++)for(let b=starts[other];b<starts[other+1];b++)pair(indices[a],indices[b]);
   }
  }
  return {data:this.data.subarray(0,n*NEIGHBORS),overflow,cells:g.cellCount};
 }
}
