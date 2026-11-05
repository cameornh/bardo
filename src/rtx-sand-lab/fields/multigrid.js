// Live-only pressure solver. A = positive weighted graph Laplacian + open
// boundary diagonal. Piecewise-constant P, R=P^T, and Ac=P^T A P preserve
// symmetry/energy even with a moving shoreline and the water/air density jump.
export const norm = a => Math.sqrt(a.reduce((s,v)=>s+v*v,0)/Math.max(1,a.length));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function multiply(g,x,out=new Float64Array(g.n)) {
 for(let i=0;i<g.n;i++){let v=g.diag[i]*x[i];for(let k=g.offset[i];k<g.offset[i+1];k++)v-=g.weight[k]*x[g.column[k]];out[i]=v;}return out;
}
export function graph(rows,boundary,coords,phase) {
 const n=rows.length,offset=new Int32Array(n+1),diag=Float64Array.from(boundary),column=[],weight=[];
 for(let i=0;i<n;i++){offset[i]=column.length;for(const [j,w] of rows[i]){column.push(j);weight.push(w);diag[i]+=w;}}offset[n]=column.length;
 return {n,offset,diag,column:Int32Array.from(column),weight:Float64Array.from(weight),boundary:Float64Array.from(boundary),coords,phase};
}
export function hierarchy(fine) {
 const levels=[fine];let g=fine;
 while(g.n>48&&levels.length<6){
  const groups=new Map(),parent=new Int32Array(g.n),coords=[],phase=[],children=[];
  for(let i=0;i<g.n;i++){
   const c=g.coords[i].map(v=>Math.floor(v/2)),key=c.join(',')+':'+g.phase[i];
   let p=groups.get(key);if(p===undefined){p=groups.size;groups.set(key,p);coords.push(c);phase.push(g.phase[i]);children.push([]);}parent[i]=p;children[p].push(i);
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
function smooth(g,x,b,passes){const next=new Float64Array(g.n);for(let s=0;s<passes;s++){for(let i=0;i<g.n;i++){let sum=b[i];for(let k=g.offset[i];k<g.offset[i+1];k++)sum+=g.weight[k]*x[g.column[k]];next[i]=g.diag[i]>0?x[i]+.7*(sum/g.diag[i]-x[i]):0;}x.set(next);}return x;}
export function vcycle(levels,b,level=0,x=new Float64Array(b.length)) {
 const g=levels[level];if(level===levels.length-1)return smooth(g,x,b,32);
 smooth(g,x,b,3);const ax=multiply(g,x),coarse=new Float64Array(levels[level+1].n);
 for(let i=0;i<g.n;i++)coarse[g.parent[i]]+=b[i]-ax[i];
 const correction=vcycle(levels,coarse,level+1);
 for(let i=0;i<g.n;i++)x[i]+=correction[g.parent[i]];
 return smooth(g,x,b,3);
}
export function solveMultigrid(levels,b,{initial,tolerance=2e-5,iterations=80,precondition=true}={}) {
 const start=performance.now(),g=levels[0],x=initial?Float64Array.from(initial):new Float64Array(g.n),ax=multiply(g,x),r=b.map((v,i)=>v-ax[i]);
 const pre=r=>precondition?vcycle(levels,r):r.map((v,i)=>v/Math.max(g.diag[i],1e-30));
 let z=pre(r),d=z.slice(),rz=dot(r,z),k=0;const base=Math.max(norm(b),1e-12);
 for(;k<iterations&&norm(r)>Math.max(1e-10,base*tolerance);k++){
  multiply(g,d,ax);const denom=dot(d,ax);if(!(denom>1e-30))break;const alpha=rz/denom;
  for(let i=0;i<g.n;i++){x[i]+=alpha*d[i];r[i]-=alpha*ax[i];}
  z=pre(r);const next=dot(r,z),beta=next/Math.max(1e-30,rz);for(let i=0;i<g.n;i++)d[i]=z[i]+beta*d[i];rz=next;
 }
 const error=multiply(g,x).map((v,i)=>v-b[i]);
 return {potential:x,absoluteResidual:norm(error),relativeResidual:norm(error)/base,iterations:k,levels:levels.length,milliseconds:performance.now()-start,backend:precondition?'CPU multigrid-PCG':'CPU diagonal-PCG'};
}
