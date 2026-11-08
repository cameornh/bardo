// Cache the same Galerkin hierarchy used by the double-precision reference.
// Child lists make restriction a deterministic gather (no float atomics).
export function packHierarchy(levels,base){
 const data=new Array(levels.length*8).fill(0);let work=0;
 for(let l=0;l<levels.length;l++){
  const g=levels[l],desc=l*8,node=base+data.length;for(let i=0;i<g.n;i++)data.push(g.diag[i],g.offset[i],g.offset[i+1],0);
  const links=base+data.length;for(let k=0;k<g.column.length;k++)data.push(g.column[k],g.weight[k]);
  const parent=base+data.length;if(g.parent)for(const v of g.parent)data.push(v);
  const child=base+data.length;
  if(l){const lists=levels[l-1].children,offset=data.length;for(let i=0;i<g.n;i++)data.push(0,0);for(let i=0;i<g.n;i++){data[offset+i*2]=base+data.length;data[offset+i*2+1]=lists[i].length;for(const j of lists[i])data.push(j);}}
  data.splice(desc,8,g.n,node,links,parent,child,work,0,0);work+=g.n*3;
 }
 return {data:Float32Array.from(data),work};
}
export const MG_WGSL=`
fn md(level:u32,k:u32)->u32{return u32(topo[u32(c[6].x)+level*8u+k]);}
fn mgAt(level:u32,i:u32,slot:u32)->u32{return F()*4u+N()*8u+4u+md(level,5u)+i+slot*md(level,0u);}
fn mgProduct(level:u32,i:u32)->f32{
 let node=md(level,1u)+i*4u;var v=topo[node]*tmp[mgAt(level,i,0u)];let links=md(level,2u);
 for(var k=u32(topo[node+1u]);k<u32(topo[node+2u]);k++){v-=topo[links+k*2u+1u]*tmp[mgAt(level,u32(topo[links+k*2u]),0u)];}return v;
}
fn relaxLevel(level:u32,lid:u32,passes:u32){
 for(var s=0u;s<passes;s++){
  for(var i=lid;i<md(level,0u);i+=256u){let x=tmp[mgAt(level,i,0u)];tmp[mgAt(level,i,2u)]=x+.7*(tmp[mgAt(level,i,1u)]-mgProduct(level,i))/max(topo[md(level,1u)+i*4u],1e-20);}
  storageBarrier();for(var i=lid;i<md(level,0u);i+=256u){tmp[mgAt(level,i,0u)]=tmp[mgAt(level,i,2u)];}storageBarrier();
 }
}
fn precondition(lid:u32){
 let levels=u32(c[6].y);
 for(var i=lid;i<N();i+=256u){tmp[mgAt(0u,i,0u)]=0.;tmp[mgAt(0u,i,1u)]=tmp[at(i,1u)];}storageBarrier();
 for(var l=0u;l<levels;l++){
  relaxLevel(l,lid,select(3u,32u,l+1u==levels));
  if(l+1u<levels){
   for(var i=lid;i<md(l,0u);i+=256u){tmp[mgAt(l,i,2u)]=tmp[mgAt(l,i,1u)]-mgProduct(l,i);}storageBarrier();
   for(var i=lid;i<md(l+1u,0u);i+=256u){let at=md(l+1u,4u)+i*2u;var sum=0.;for(var k=0u;k<u32(topo[at+1u]);k++){sum+=tmp[mgAt(l,u32(topo[u32(topo[at])+k]),2u)];}tmp[mgAt(l+1u,i,0u)]=0.;tmp[mgAt(l+1u,i,1u)]=sum;}storageBarrier();
  }
 }
 for(var level=i32(levels)-2;level>=0;level--){let l=u32(level);for(var i=lid;i<md(l,0u);i+=256u){tmp[mgAt(l,i,0u)]+=tmp[mgAt(l+1u,u32(topo[md(l,3u)+i]),0u)];}storageBarrier();relaxLevel(l,lid,3u);}
 for(var i=lid;i<N();i+=256u){tmp[at(i,4u)]=tmp[mgAt(0u,i,0u)];}storageBarrier();
}
`;
