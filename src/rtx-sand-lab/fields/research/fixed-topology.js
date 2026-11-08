import {MATERIAL,WATER,AIR} from '../../../fluid-fields/model.js';
import {graph} from '../multigrid.js';

// The reference uses strings made from coordinates for aggregation. These
// nonnegative lattice coordinates fit a collision-free integer key; insertion
// order and summation order are deliberately identical to the reference.
export function numericHierarchy(fine){
 const levels=[fine];let g=fine;
 while(g.n>48&&levels.length<6){
  const groups=new Map(),parent=new Int32Array(g.n),coords=[],phase=[],children=[];
  for(let i=0;i<g.n;i++){
   const p=g.coords[i],c=[Math.floor(p[0]/2),Math.floor(p[1]/2),Math.floor(p[2]/2)],key=((c[0]*32+c[1])*32+c[2])*3+g.phase[i];
   let j=groups.get(key);if(j===undefined){j=groups.size;groups.set(key,j);coords.push(c);phase.push(g.phase[i]);children.push([]);}parent[i]=j;children[j].push(i);
  }
  if(groups.size>=g.n*.9)break;
  const rows=Array.from({length:groups.size},()=>new Map()),boundary=new Float64Array(groups.size);
  for(let i=0;i<g.n;i++){
   const a=parent[i];boundary[a]+=g.boundary[i];
   for(let k=g.offset[i];k<g.offset[i+1];k++){const b=parent[g.column[k]];if(a!==b)rows[a].set(b,(rows[a].get(b)||0)+g.weight[k]);}
  }
  g.parent=parent;g.children=children;g=graph(rows,boundary,coords,phase);levels.push(g);
 }
 return levels;
}

// Cache only geometry-independent neighbor references. Air/water weights,
// solid masks, sealed-component gauges and every coarse operator are rebuilt.
// Fresh level identities intentionally invalidate WASM/GPU coefficient uploads.
export class FixedGridTopology {
 prepare(g){
  if(this.grid===g)return;
  const rows=Array.from({length:g.count},()=>[]);let face=0;
  for(const f of g.faces)for(let k=0;k<f.a.length;k++,face++){
   const a=f.a[k],b=f.b[k];if(a>=0&&b>=0){rows[a].push([b,face]);rows[b].push([a,face]);}
  }
  this.offset=new Int32Array(g.count+1);this.neighbor=[];this.face=[];
  for(let i=0;i<g.count;i++){this.offset[i]=this.neighbor.length;for(const [j,f] of rows[i]){this.neighbor.push(j);this.face.push(f);}}
  this.offset[g.count]=this.neighbor.length;
  this.neighbor=Int32Array.from(this.neighbor);this.face=Int32Array.from(this.face);
  this.weights=new Float64Array(face);this.grid=g;
 }
 rebuild(g){
  this.prepare(g);const n=g.count,boundary=new Float64Array(n);let face=0;
  for(const f of g.faces)for(let k=0;k<f.a.length;k++,face++){
   const a=f.a[k],b=f.b[k],pa=a<0?AIR:g.phase[a],pb=b<0?AIR:g.phase[b],outer=a<0||b<0;
   const active=pa&&pb&&!(outer&&(pa===WATER||pb===WATER));
   const w=active?2*MATERIAL[WATER].density/(MATERIAL[pa].density+MATERIAL[pb].density)*(g.h/g.cellSize[f.axis])**2:0;
   this.weights[face]=f.coefficient[k]=w;if(w&&outer)boundary[Math.max(a,b)]+=w;
  }
  const offset=new Int32Array(n+1);let length=0;
  for(let i=0;i<n;i++){offset[i]=length;for(let k=this.offset[i];k<this.offset[i+1];k++)if(this.weights[this.face[k]])length++;}offset[n]=length;
  const column=new Int32Array(length),weight=new Float64Array(length);let at=0;
  for(let i=0;i<n;i++)for(let k=this.offset[i];k<this.offset[i+1];k++){const w=this.weights[this.face[k]];if(w){column[at]=this.neighbor[k];weight[at++]=w;}}
  g.closed=[];const seen=new Uint8Array(n);
  for(let i=0;i<n;i++)if(g.phase[i]&&!seen[i]){
   const cells=[i];seen[i]=1;let open=false;
   for(const j of cells){open ||= boundary[j]>0;for(let k=offset[j];k<offset[j+1];k++){const v=column[k];if(!seen[v]){seen[v]=1;cells.push(v);}}}
   if(!open){g.closed.push(cells);boundary[i]+=1;}
  }
  for(let i=0;i<n;i++)if(!g.phase[i])boundary[i]=1;
  const diag=boundary.slice();for(let i=0;i<n;i++)for(let k=offset[i];k<offset[i+1];k++)diag[i]+=weight[k];
  g.levels=numericHierarchy({n,offset,column,weight,boundary,diag,coords:g.coords,phase:Array.from(g.phase)});
 }
}
