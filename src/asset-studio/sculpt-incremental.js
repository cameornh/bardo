// Exact derived cache, never authoring data. A changed grid/history uses a full
// rebuild. CPU suffix evaluation retains f64 accumulator precision; resuming
// from the exported f32 grid would change normals and material tie decisions.
import {gridSpec,smoothMin} from './sculpt.js';
import {LIMITS} from './model.js';
const B=8,corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]],edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
const sameGrid=(a,b)=>a&&b&&a.h===b.h&&a.count===b.count&&a.origin.every((v,i)=>v===b.origin[i])&&a.dims.every((v,i)=>v===b.dims[i]);
const empty=()=>({positions:[],normals:[],materials:[],spacing:0,truncated:false});
export class IncrementalSculpt {
 allocate(g){
  this.grid=g;const [nx,ny,nz]=g.dims;this.cells=[nx-1,ny-1,nz-1];this.bricks=this.cells.map(n=>Math.ceil(n/B));
  const count=this.cells.reduce((a,b)=>a*b,1);this.values=new Float32Array(g.count*2);this.distance=new Float64Array(g.count);this.material=new Uint16Array(g.count);
  this.records=new Float64Array(count*7);this.active=new Uint8Array(count);this.dirty=new Uint8Array(this.bricks.reduce((a,b)=>a*b,1));
  this.bytes=this.values.byteLength+this.distance.byteLength+this.material.byteLength+this.records.byteLength+this.active.byteLength+this.dirty.byteLength;
 }
 mark(x,y,z){
  const [cx,cy,cz]=this.cells,[bx,by]=this.bricks;
  // A grid vertex belongs to as many as eight cells, including across bricks.
  for(let k=Math.max(0,z-1);k<=Math.min(cz-1,z);k++)for(let j=Math.max(0,y-1);j<=Math.min(cy-1,y);j++)for(let i=Math.max(0,x-1);i<=Math.min(cx-1,x);i++)this.dirty[Math.floor(i/B)+bx*(Math.floor(j/B)+by*Math.floor(k/B))]=1;
 }
 sample(stamps,start,full){
  const g=this.grid,[nx,ny]=g.dims;let changed=0;
  for(let i=0;i<g.count;i++){
   const ix=i%nx,iy=Math.floor(i/nx)%ny,iz=Math.floor(i/(nx*ny)),x=g.origin[0]+ix*g.h,y=g.origin[1]+iy*g.h,z=g.origin[2]+iz*g.h;
   let d=start?this.distance[i]:1e6,material=start?this.material[i]:0;
   for(let j=start;j<stamps.length;j++){
    const s=stamps[j],qx=x-s.position[0],qy=y-s.position[1],qz=z-s.position[2];let b;
    if(s.shape==='sphere')b=(Math.hypot(qx/s.size[0],qy/s.size[1],qz/s.size[2])-1)*Math.min(...s.size);
    else if(s.shape==='capsule')b=Math.hypot(qx,qy-Math.max(-s.size[1],Math.min(s.size[1],qy)),qz)-s.size[0];
    else{const dx=Math.abs(qx)-s.size[0],dy=Math.abs(qy)-s.size[1],dz=Math.abs(qz)-s.size[2];b=Math.hypot(Math.max(dx,0),Math.max(dy,0),Math.max(dz,0))+Math.min(Math.max(dx,dy,dz),0);}
    if(s.mode==='paint'){if(b<=0)material=j;continue;}if(s.mode==='subtract'){d=-smoothMin(-d,b,s.blend);continue;}if(b<d)material=j;d=smoothMin(d,b,s.blend);
   }
   this.distance[i]=d;this.material[i]=material;const value=Math.fround(d),o=i*2;
   if(full||!Object.is(value,this.values[o])||material!==this.values[o+1]){changed++;if(!full)this.mark(ix,iy,iz);}
   this.values[o]=value;this.values[o+1]=material;
  }return changed;
 }
 extract(){
  const g=this.grid,[nx,ny]=g.dims,[cx,cy,cz]=this.cells,[bx,by]=this.bricks,ds=new Float64Array(8),offsets=[0,2,nx*2,(nx+1)*2,nx*ny*2,(nx*ny+1)*2,(nx*ny+nx)*2,(nx*ny+nx+1)*2];let rebuilt=0,cells=0;
  for(let brick=0;brick<this.dirty.length;brick++){
   if(!this.dirty[brick])continue;rebuilt++;const x0=(brick%bx)*B,y0=(Math.floor(brick/bx)%by)*B,z0=Math.floor(brick/(bx*by))*B;
   for(let z=z0;z<Math.min(cz,z0+B);z++)for(let y=y0;y<Math.min(cy,y0+B);y++)for(let x=x0;x<Math.min(cx,x0+B);x++){
    cells++;const cell=x+cx*(y+cy*z),base=(x+nx*(y+ny*z))*2;let negative=0;
    for(let i=0;i<8;i++){ds[i]=this.values[base+offsets[i]];negative+=ds[i]<0;}
    this.active[cell]=negative!==0&&negative!==8?1:0;if(!this.active[cell])continue;
    const p=[0,0,0];let count=0;
    for(const [a,b]of edges){if((ds[a]<0)===(ds[b]<0))continue;const t=ds[a]/(ds[a]-ds[b]);for(let k=0;k<3;k++)p[k]+=corners[a][k]+t*(corners[b][k]-corners[a][k]);count++;}
    for(let k=0;k<3;k++)p[k]/=count;
    const n=[ds[1]+ds[3]+ds[5]+ds[7]-ds[0]-ds[2]-ds[4]-ds[6],ds[2]+ds[3]+ds[6]+ds[7]-ds[0]-ds[1]-ds[4]-ds[5],ds[4]+ds[5]+ds[6]+ds[7]-ds[0]-ds[1]-ds[2]-ds[3]],len=Math.hypot(...n)||1,o=cell*7;
    this.records[o]=g.origin[0]+(x+p[0])*g.h;this.records[o+1]=g.origin[1]+(y+p[1])*g.h;this.records[o+2]=g.origin[2]+(z+p[2])*g.h;
    for(let k=0;k<3;k++)this.records[o+3+k]=n[k]/len;
    let nearest=0;for(let i=1;i<8;i++)if(Math.abs(ds[i])<Math.abs(ds[nearest]))nearest=i;this.records[o+6]=Math.round(this.values[base+offsets[nearest]+1]);
   }
  }this.dirty.fill(0);return {rebuiltBricks:rebuilt,rebuiltCells:cells};
 }
 update(stamps,spacing,sampled){
  const g=sampled?.grid||gridSpec(stamps,spacing),source=sampled?'gpu':'cpu',signatures=stamps.map(s=>JSON.stringify(s));
  if(!g){this.clear();return {surface:empty(),stats:{mode:'empty',bytes:0,rebuiltBricks:0,rebuiltCells:0,changedSamples:0,stampEvaluations:0}};}
  if(g.count>LIMITS.grid||stamps.length>LIMITS.stamps)throw Error('Incremental sculpt budget exceeded');
  if(sampled&&sampled.values.length!==g.count*2)throw Error('Incomplete sampled sculpt grid');
  const compatible=sameGrid(this.grid,g),prefix=compatible&&source===this.source&&this.signatures?.length<=signatures.length&&this.signatures.every((s,i)=>s===signatures[i]);
  if(!compatible)this.allocate(g);
  const full=!prefix,start=prefix?this.signatures.length:0;let changed=0;
  if(full)this.dirty.fill(1);
  if(sampled){const [nx,ny]=g.dims;
   for(let i=0;i<g.count;i++){const o=i*2;if(full||!Object.is(this.values[o],sampled.values[o])||this.values[o+1]!==sampled.values[o+1]){changed++;if(!full)this.mark(i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny)));}}
   this.values.set(sampled.values);
  }else if(full||start<stamps.length)changed=this.sample(stamps,start,full);
  const stats={mode:full?'full':sampled?'sampled blocks':'appended strokes',source,gridSamples:g.count,changedSamples:changed,stampEvaluations:sampled?0:(stamps.length-start)*g.count,...this.extract(),totalBricks:this.dirty.length,bytes:this.bytes};
  // Restore global z/y/x order, including the original truncation policy. Brick
  // order must never change Gaussian blending order or which samples survive.
  const surface=empty();surface.spacing=g.h;
  for(let i=0;i<this.active.length;i++)if(this.active[i]){if(surface.materials.length===LIMITS.splats){surface.truncated=true;break;}const o=i*7;for(let k=0;k<3;k++){surface.positions.push(this.records[o+k]);surface.normals.push(this.records[o+3+k]);}surface.materials.push(stamps[this.records[o+6]]?.materialId||stamps[0].materialId);}
  this.source=source;this.signatures=signatures;return {surface,stats};
 }
 clear(){for(const key of ['grid','values','distance','material','records','active','dirty','signatures','source'])this[key]=undefined;this.bytes=0;}
}
export class SculptCachePool {
 constructor(maxParts=2){this.maxParts=Number.isInteger(maxParts)?Math.max(1,Math.min(2,maxParts)):2;this.entries=new Map();}
 update(key,stamps,spacing,sampled){let cache=this.entries.get(key);this.entries.delete(key);while(this.entries.size>=this.maxParts){const oldest=this.entries.keys().next().value;this.entries.get(oldest).clear();this.entries.delete(oldest);}if(!cache)cache=new IncrementalSculpt();this.entries.set(key,cache);return cache.update(stamps,spacing,sampled);}
 drop(key){this.entries.get(key)?.clear();this.entries.delete(key);}
}
