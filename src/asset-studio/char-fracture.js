// Grow connected patches along finite load-bearing faces. Charring opens
// weak seams around the patches while some ligaments retain their strength.
function noise(i){
 let a=Math.imul(i+157,0x45d9f3b);a=Math.imul(a^(a>>>16),0x45d9f3b);
 return ((a^(a>>>16))>>>0)/4294967296;
}
export function charDomains(grid){
 const {nodes,bonds}=grid, ids=new Int32Array(nodes.length).fill(-1);
 const adj=nodes.map(()=>[]);
 for(const {a,b} of bonds)if(nodes[a].material.id===nodes[b].material.id){
  adj[a].push(b);adj[b].push(a);
 }
 const seeds=nodes.map(n=>n.index).sort((a,b)=>noise(a)-noise(b));
 for(const seed of seeds){
  if(ids[seed]!==-1)continue;
  const fringe=[seed],limit=3+Math.floor(5*noise(seed+131));
  let count=0;
  while(fringe.length&&count<limit){
   const i=fringe.shift();
   if(ids[i]!==-1)continue;
   ids[i]=seed;count++;fringe.push(...adj[i].filter(j=>ids[j]===-1));
   fringe.sort((a,b)=>noise(a+seed*67)-noise(b+seed*67));
  }
 }
 // Absorb isolated last cells into a contiguous same-material patch.
 const sizes=new Map();
 for(const id of ids)sizes.set(id,(sizes.get(id)??0)+1);
 for(const i of seeds)if(sizes.get(ids[i])===1&&adj[i].length){
  const next=ids[adj[i][0]];ids[i]=next;sizes.set(next,sizes.get(next)+1);
 }
 return ids;
}
export function charBondStrength(structure,bond,base,char){
 if(char<=.001)return base;
 structure.charDomains??=charDomains(structure.grid);
 const same=structure.charDomains[bond.a]===structure.charDomains[bond.b];
 // Changes continuously from the unburned law. Other damage (such as melting)
 // still weakens the whole body; only the fuel-loss contribution is redistributed.
 const remaining=1-.94*char;
 const adjusted=same?1-.50*char:remaining*(1-.78*char);
 return Math.max(.002,base*adjusted/remaining);
}

// Shared deformation for the two exposed skins. Fade it to zero on the
// authored outside skin, so ragged new surfaces still join the original shape.
export function charSurfacePoint(p,grid,interior,amount){
 const a=p.map((x,k)=>(x-grid.lo[k])/grid.step[k]);
 const depth=Math.min(Math.max(0,interior)*.65,Math.min(...grid.step)*.27)*amount;
 return p.map((x,k)=>x+depth*(.7*Math.sin(1.7*a[(k+1)%3]+1.1*a[(k+2)%3]+k)
  +.3*Math.sin(3.7*a[k]+2.2*a[(k+2)%3]+k)));
}

// Round only the exposed corners of a small charred chip as one piece.
// A compound fragment keeps its connected silhouette across cell boundaries.
export function roundCharChip(surface,grid,regions,char){
 if(!char||regions.length>8)return;
 const lo=[Infinity,Infinity,Infinity],hi=lo.map(x=>-x);
 for(const i of regions)for(const box of grid.nodes[i].shapes)for(let k=0;k<3;k++){
  lo[k]=Math.min(lo[k],box.center[k]-box.half[k]);
  hi[k]=Math.max(hi[k],box.center[k]+box.half[k]);
 }
 const middle=hi.map((h,k)=>(h+lo[k])*.5),half=hi.map((h,k)=>(h-lo[k])*.5);
 const amount=.80*Math.sqrt(char);
 // A local oblique split takes a larger bite out of one side. The seed stays
 // with the material so newly exposed chips have different, stable profiles.
 const seed=Math.min(...regions),cut=[0,1,2].map(k=>2*noise(seed*11+273+k)-1);
 const length=Math.hypot(...cut)||1;
 for(let k=0;k<3;k++)cut[k]/=length;
 const {positions,normals}=surface;
 for(let i=0;i<positions.length;i+=3){
  const x=positions[i]-middle[0],y=positions[i+1]-middle[1],z=positions[i+2]-middle[2];
  const u=x/half[0],v=y/half[1],w=z/half[2],radial=Math.hypot(u,v,w);
  if(radial<=1)continue;
  const blend=(1-1/radial)*amount;
  positions[i]-=x*blend;positions[i+1]-=y*blend;positions[i+2]-=z*blend;
  const nx=x/(half[0]*half[0]),ny=y/(half[1]*half[1]),nz=z/(half[2]*half[2]);
  const cutDepth=Math.max(0,u*cut[0]+v*cut[1]+w*cut[2]-1)*amount*.75;
  for(let k=0;k<3;k++)positions[i+k]-=cutDepth*half[k]*cut[k];
  const weight=Math.min(1,2*blend),dir=weight/Math.hypot(nx,ny,nz);
  normals[i]=normals[i]*(1-weight)+nx*dir;normals[i+1]=normals[i+1]*(1-weight)+ny*dir;
  normals[i+2]=normals[i+2]*(1-weight)+nz*dir;
  if(cutDepth){
   const gradient=Math.hypot(cut[0]/half[0],cut[1]/half[1],cut[2]/half[2]);
   for(let k=0;k<3;k++)normals[i+k]+=3*cutDepth*cut[k]/(gradient*half[k]);
  }
  const normalLength=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;
  normals[i]/=normalLength;normals[i+1]/=normalLength;normals[i+2]/=normalLength;
 }
}
