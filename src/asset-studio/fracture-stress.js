// Small-displacement elastic network inside one connected rigid fragment.
// Six virtual degrees of freedom per region. Springs meet at each shared face,
// so translation and bending are coupled and a rigid rotation costs no energy.
// The first region fixes the reference frame after external loads are balanced.
export function networkLayout(indices,grid){
 const members=new Set(indices),edges=grid.bonds.filter(e=>!e.broken&&members.has(e.a)&&members.has(e.b));
 const neighbors=new Map(indices.map(i=>[i,[]]));
 for(const e of edges){neighbors.get(e.a).push(e);neighbors.get(e.b).push(e);}
 const startId=indices.reduce((a,b)=>neighbors.get(a).length<=neighbors.get(b).length?a:b);
 // Order nearby regions together to keep the elastic matrix narrow.
 const order=[startId],seen=new Set(order),parent=new Map();
 for(let cursor=0;cursor<order.length;cursor++){
  const id=order[cursor],adjacent=neighbors.get(id).map(edge=>({edge,next:edge.a===id?edge.b:edge.a}));
  adjacent.sort((a,b)=>neighbors.get(a.next).length-neighbors.get(b.next).length);
  for(const {edge,next} of adjacent)if(!seen.has(next)){seen.add(next);order.push(next);parent.set(next,edge);}
 }
 return {edges,order,parent,totals:new Float64Array(grid.nodes.length*6)};
}

// The spring solution minimizes complementary energy among wrenches in
// equilibrium. Routing the same loads over a spanning tree gives a usable
// *upper* bound. If even that energy cannot yield any face, the intact part
// can take the exact no-damage branch without factoring its stiffness matrix.
export function belowBondYield(layout,loads){
 const {order,parent,edges,totals}=layout;
 if(layout.yieldEnergy===undefined){
  let worst=0;
  for(const e of edges){
   const k=e.axis,u=(k+1)%3,v=(k+2)%3,s=e.spring;
   const normal=s[k]/e.area**2+s[3+u]/e.zu**2+s[3+v]/e.zv**2;
   const shear=2.25*Math.max(s[u],s[v])/e.area**2+s[k+3]/e.zt**2;
   // Normal and shear use disjoint wrench components. Compression strength
   // is at least tensile strength by construction.
   worst=Math.max(worst,normal/e.compression**2,Math.max(normal,shear)/e.strength**2);
  }
  layout.yieldEnergy=.81/worst; // Margin for roundoff and iterative solves.
 }
 totals.set(loads);let energy=0;
 for(let j=order.length-1;j>0;j--){
  const id=order[j],edge=parent.get(id),offset=id*6,dest=(edge.a===id?edge.b:edge.a)*6;
  for(let k=0;k<3;k++){
   const u=(k+1)%3,v=(k+2)%3,force=totals[offset+k];
   const moment=totals[offset+3+k]-edge.center[u]*totals[offset+v]+edge.center[v]*totals[offset+u];
   energy+=force*force/edge.spring[k]+moment*moment/edge.spring[k+3];
   totals[dest+k]+=force;totals[dest+k+3]+=totals[offset+k+3];
  }
  if(energy>=layout.yieldEnergy)return false;
 }
 return energy<layout.yieldEnergy;
}

export function factorNetwork(indices,grid,layout=networkLayout(indices,grid)){
 const {edges,order}=layout;
 // With only one load path per joint, equilibrium gives the exact forces and
 // moments by summing outward branches. No stiffness solve is necessary.
 if(edges.length===indices.length-1)return {tree:true,...layout};
 indices=order;
 const map=new Map(indices.map((id,k)=>[id,6*(k-1)])),n=6*(indices.length-1);
 const rows=[],matrix=Array.from({length:n},()=>new Map());
 for(const e of edges){
  for(let k=0;k<6;k++){
   const ix=[],v=[];
   for(const [id,sign] of [[e.a,-1],[e.b,1]]){
    const off=map.get(id);if(off<0)continue;
    ix.push(off+k);v.push(sign);
    if(k<3){
     const u=(k+1)%3,w=(k+2)%3,center=grid.nodes[id].center;
     ix.push(off+3+u,off+3+w);v.push(sign*(e.center[w]-center[w]),-sign*(e.center[u]-center[u]));
    }
   }
   const spring=e.spring[k];
   for(let i=0;i<ix.length;i++)for(let j=0;j<ix.length;j++){
    if(ix[j]>ix[i]||!v[i]||!v[j])continue;
    const m=matrix[ix[i]];m.set(ix[j],(m.get(ix[j])||0)+spring*v[i]*v[j]);
   }
   rows.push({ix,v,spring});
  }
 }
 // Skyline Cholesky. Empty columns before a row's first occupied column
 // remain empty under elimination, which keeps long slender members cheap.
 const start=matrix.map((m,i)=>Math.min(i,...m.keys()));
 // Bound factorization work for densely interleaved painted sculpts. The
 // iterative path stores only actual couplings and reuses its last solution.
 if(start.reduce((cost,s,i)=>cost+(i-s+1)**2,0)>3e6){
  const sparse=matrix.map((row,i)=>({ix:Int32Array.from(row.keys()),v:Float64Array.from(row.values()),diag:row.get(i)}));
  return {indices,grid,edges,rows,n,values:new Float64Array(n),sparse,
   buffers:Array.from({length:4},()=>new Float64Array(n))};
 }
 const L=matrix.map((m,i)=>{
  const row=new Float64Array(i-start[i]+1);for(const [j,v] of m)row[j-start[i]]=v;return row;
 });
 for(let i=0;i<n;i++){
  const si=start[i],row=L[i];
  for(let j=si;j<=i;j++){
   const sj=start[j];let x=row[j-si];
   for(let k=Math.max(si,sj);k<j;k++)x-=row[k-si]*L[j][k-sj];
   row[j-si]=i===j?Math.sqrt(Math.max(1e-16,x)):x/L[j][j-sj];
  }
 }
 return {indices,grid,edges,rows,L,start,n,values:new Float64Array(n)};
}
function utilization(e,force,moment,visit){
 const k=e.axis,u=(k+1)%3,w=(k+2)%3;
 const normal=force[k]/e.area,bending=Math.abs(moment[u])/e.zu+Math.abs(moment[w])/e.zv;
 const shear=1.5*Math.hypot(force[u],force[w])/e.area+Math.abs(moment[k])/e.zt;
 const ratio=Math.max(Math.hypot(Math.max(0,normal+bending),shear)/e.strength,(-normal+bending)/e.compression);
 visit(e,ratio,force[k]);
}
function solveTree(net,loads,visit){
 const {totals,order,parent}=net;totals.set(loads);
 const force=new Float64Array(3),moment=new Float64Array(3);
 for(let j=order.length-1;j>0;j--){
  const id=order[j],e=parent.get(id),sign=e.b===id?1:-1,other=e.b===id?e.a:e.b,offset=id*6;
  for(let k=0;k<6;k++)totals[other*6+k]+=totals[offset+k];
  for(let k=0;k<3;k++){
   const u=(k+1)%3,w=(k+2)%3;
   force[k]=totals[offset+k]*sign;
   moment[k]=(totals[offset+3+k]-e.center[u]*totals[offset+w]+e.center[w]*totals[offset+u])*sign;
  }
  utilization(e,force,moment,visit);
 }
}
function multiplySparse(rows,x,out){
 out.fill(0);
 for(let i=0;i<rows.length;i++){
  const row=rows[i];let sum=0;
  for(let k=0;k<row.ix.length;k++){
   const j=row.ix[k],v=row.v[k];sum+=v*x[j];if(i!==j)out[j]+=v*x[i];
  }
  out[i]+=sum;
 }
}
function solveSparse(net,rhs){
 const {sparse,values:x,buffers:[,residual,direction,product],n}=net;
 multiplySparse(sparse,x,product);let error=0,norm=0;
 for(let i=0;i<n;i++){
  residual[i]=rhs[i]-product[i];direction[i]=residual[i]/sparse[i].diag;
  error+=residual[i]*direction[i];norm+=rhs[i]**2/sparse[i].diag;
 }
 for(let it=0;it<Math.min(n,100)&&error>Math.max(norm*1e-12,1e-22);it++){
  multiplySparse(sparse,direction,product);let denom=0;
  for(let i=0;i<n;i++)denom+=direction[i]*product[i];
  if(!(denom>0))break;
  const step=error/denom;let next=0;
  for(let i=0;i<n;i++){x[i]+=step*direction[i];residual[i]-=step*product[i];next+=residual[i]**2/sparse[i].diag;}
  const beta=next/error;for(let i=0;i<n;i++)direction[i]=residual[i]/sparse[i].diag+beta*direction[i];
  error=next;
 }
 net.pending=error>Math.max(norm*1e-8,1e-20);
}
export function solveBonds(net,loads,visit){
 if(net.tree){solveTree(net,loads,visit);return;}
 const {indices,grid,edges,rows,L,start,n,values:v}=net,rhs=net.sparse?net.buffers[0]:v;
 for(let i=1;i<indices.length;i++){
  const id=indices[i],j=id*6,off=6*(i-1),p=grid.nodes[id].center;
  for(let k=0;k<3;k++){
   const u=(k+1)%3,w=(k+2)%3;
   rhs[off+k]=loads[j+k];rhs[off+3+k]=loads[j+3+k]-p[u]*loads[j+w]+p[w]*loads[j+u];
  }
 }
 if(net.sparse)solveSparse(net,rhs);
 else solveFactored(L,start,n,v);
 const wrench=new Float64Array(6),force=wrench.subarray(0,3),moment=wrench.subarray(3);let r=0;
 for(const e of edges){
  for(let k=0;k<6;k++){
   const row=rows[r++];let displacement=0;
   for(let i=0;i<row.ix.length;i++)displacement+=row.v[i]*v[row.ix[i]];
   wrench[k]=displacement*row.spring;
  }
  utilization(e,force,moment,visit);
 }
}

function solveFactored(L,start,n,v){
 for(let i=0;i<n;i++){
  const s=start[i],row=L[i];let x=v[i];
  for(let j=s;j<i;j++)x-=row[j-s]*v[j];
  v[i]=x/row[i-s];
 }
 for(let i=n-1;i>=0;i--){
  const s=start[i],row=L[i],x=v[i]/row[i-s];v[i]=x;
  for(let j=s;j<i;j++)v[j]-=row[j-s]*x;
 }
}
