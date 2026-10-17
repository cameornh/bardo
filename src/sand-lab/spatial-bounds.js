// Conservative broad phase. Oversized bounds use a separate list instead of
// exploding the grid or silently overflowing a fixed cell capacity.
export class BoundsGrid {
 constructor(cellSize=.5){this.cellSize=cellSize;this.bins=new Map();this.entries=[];this.large=new Set();this.stamp=0;this.visited=[];this.checks=0;}
 range(position,radius){const s=this.cellSize;return [position.map(v=>Math.floor((v-radius)/s)),position.map(v=>Math.floor((v+radius)/s))];}
 key(x,y,z){return `${x},${y},${z}`;}
 clear(){this.bins.clear();this.entries.length=0;this.large.clear();this.checks=0;}
 insert(id,position,radius){
  this.remove(id);const [lo,hi]=this.range(position,radius),keys=[];
  if((hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1)>256)this.large.add(id);
  else for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
   const key=this.key(x,y,z);let cell=this.bins.get(key);if(!cell)this.bins.set(key,cell=new Set());cell.add(id);keys.push(key);
  }
  this.entries[id]={keys,position:position.slice(),radius};
 }
 remove(id){const entry=this.entries[id];if(entry)for(const key of entry.keys){const cell=this.bins.get(key);cell.delete(id);if(!cell.size)this.bins.delete(key);}this.large.delete(id);}
 build(items,radius){this.clear();for(let i=0;i<items.length;i++)this.insert(i,items[i].position,radius(items[i]));return this;}
 query(position,radius,out=[]){
  out.length=0;const stamp=++this.stamp,[lo,hi]=this.range(position,radius);
  const add=id=>{if(this.visited[id]===stamp)return;this.visited[id]=stamp;this.checks++;const e=this.entries[id],r=radius+e.radius;
   if(Math.abs(e.position[0]-position[0])<=r&&Math.abs(e.position[1]-position[1])<=r&&Math.abs(e.position[2]-position[2])<=r)out.push(id);
  };
  // Wide probes should scan objects, not millions of empty grid cells.
  if((hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1)>4096){for(let i=0;i<this.entries.length;i++)if(this.entries[i])add(i);}
  else{for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)for(const id of this.bins.get(this.key(x,y,z))||[])add(id);for(const id of this.large)add(id);}
  out.sort((a,b)=>a-b);return out;
 }
}

export function separateBodies(bodies,grid=null){
 const radius=b=>b.radius;
 if(grid)grid.build(bodies,radius);
 let tested=0,contacts=0;
 for(let i=0;i<bodies.length;i++){
  const a=bodies[i];let candidates=grid?grid.query(a.position,a.radius):null,j=i+1;
  while(j<bodies.length){
   if(candidates){const next=candidates.find(k=>k>=j);if(next===undefined)break;j=next;}
   const b=bodies[j],d=b.position.map((v,k)=>v-a.position[k]),r=Math.hypot(...d),overlap=a.radius+b.radius-r;tested++;
   if(overlap>0&&r>1e-5){contacts++;for(let k=0;k<3;k++){if(!a.held)a.position[k]-=d[k]/r*overlap*.5;if(!b.held)b.position[k]+=d[k]/r*overlap*.5;}
    if(grid){grid.insert(i,a.position,a.radius);grid.insert(j,b.position,b.radius);candidates=grid.query(a.position,a.radius);}
   }j++;
  }
 }
 return {tested,contacts};
}
