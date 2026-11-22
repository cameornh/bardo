// Subdivide the occupied contact proxy only. Adjacent pieces retain their local
// material; touching corners and edges alone cannot transmit a force.
import {cellOwner,mergeBoxes} from './fracture-cells.js';
const axes=[0,1,2],EPS=1e-7;
function unionFind(n){
 const ids=Array.from({length:n},(_,i)=>i);
 const root=i=>{while(ids[i]!==i){ids[i]=ids[ids[i]];i=ids[i];}return i;};
 return {root,join:(i,j)=>{ids[root(i)]=root(j);}};
}

// Sweep the upper and lower faces in each coplanar slice. A high-detail
// sculpt therefore pays for nearby faces rather than every possible box pair.
function visitFaces(pieces,visit){
 for(const axis of axes){
  const planes=new Map(),u=(axis+1)%3,v=(axis+2)%3;
  for(const [id,p] of pieces.entries())for(const upper of [false,true]){
   const position=(upper?p.hi:p.lo)[axis],key=Math.round(position/EPS);
   let plane=planes.get(key);if(!plane){plane=[[],[]];planes.set(key,plane);}
   plane[+upper].push(id);
  }
  for(const [lower,upper] of planes.values()){
   if(!lower.length||!upper.length)continue;
   lower.sort((a,b)=>pieces[a].lo[u]-pieces[b].lo[u]);
   for(const i of upper){
    const a=pieces[i];
    for(const j of lower){
     const b=pieces[j];if(b.lo[u]>=a.hi[u]-EPS)break;
     if(b.hi[u]<=a.lo[u]+EPS||b.hi[v]<=a.lo[v]+EPS||b.lo[v]>=a.hi[v]-EPS)continue;
     const lo=a.lo.map((x,k)=>Math.max(x,b.lo[k])),hi=a.hi.map((x,k)=>Math.min(x,b.hi[k]));
     visit(i,j,{axis,lo,hi});
    }
   }
  }
 }
}
export function fractureGrid(boxes,scale,materials){
 if(!boxes.length||boxes.some(b=>b.type!=='box'))return null;
 const lo=axes.map(k=>Math.min(...boxes.map(b=>b.center[k]-b.half[k]))),hi=axes.map(k=>Math.max(...boxes.map(b=>b.center[k]+b.half[k])));
 const width=hi.map((x,k)=>(x-lo[k])*scale[k]),longest=Math.max(...width);
 // Keep long thin members resolved lengthwise and compact members resolved
 // across all three axes. The collision proxy still supplies fine cutouts.
 const pitch=Math.min(longest/3,Math.max(.075,longest/10,Math.cbrt(width[0]*width[1]*width[2]/38)));
 const dims=width.map(w=>w<longest*.24?1:Math.max(1,Math.round(w/pitch))),step=hi.map((x,k)=>(x-lo[k])/dims[k]);
 const pieces=[],sourceNodes=[];
 for(const [source,box] of boxes.entries()){
  const min=box.center.map((x,k)=>x-box.half[k]),max=box.center.map((x,k)=>x+box.half[k]);
  const start=min.map((x,k)=>Math.max(0,Math.floor((x-lo[k]+EPS)/step[k])));
  const end=max.map((x,k)=>Math.min(dims[k]-1,Math.floor((x-lo[k]-EPS)/step[k])));
  for(let z=start[2];z<=end[2];z++)for(let y=start[1];y<=end[1];y++)for(let x=start[0];x<=end[0];x++){
   const cell=[x,y,z],lower=cell.map((n,k)=>Math.max(min[k],lo[k]+n*step[k])),upper=cell.map((n,k)=>Math.min(max[k],lo[k]+(n+1)*step[k]));
   pieces.push({source,lo:lower,hi:upper,cell:x+dims[0]*(y+dims[1]*z),materialId:box.materialId});
  }
 }
 const sets=unionFind(pieces.length),contacts=[];
 visitFaces(pieces,(a,b,face)=>{
  if(pieces[a].cell===pieces[b].cell&&pieces[a].materialId===pieces[b].materialId)sets.join(a,b);
  else contacts.push({a,b,...face});
 });
 const nodes=[],groups=new Map(),cells=new Map();
 for(const [i,p] of pieces.entries()){
  const key=sets.root(i);let n=groups.get(key);
  if(!n){n={index:nodes.length,material:materials.get(p.materialId),shapes:[],mass:0,center:[0,0,0]};nodes.push(n);groups.set(key,n);
   if(!cells.has(p.cell))cells.set(p.cell,[]);cells.get(p.cell).push(n.index);}
  const center=p.hi.map((h,k)=>(h+p.lo[k])*.5),half=p.hi.map((h,k)=>(h-p.lo[k])*.5);
  n.shapes.push({type:'box',half,center,materialId:p.materialId});
  const mass=half.reduce((v,h,k)=>v*2*h*scale[k],n.material.density);
  for(const k of axes)n.center[k]+=mass*center[k]*scale[k];
  n.mass+=mass;p.node=n.index;sourceNodes[p.source]=n.index;
 }
 for(const n of nodes){
  for(const k of axes)n.center[k]/=n.mass;
  const inertia=[0,0,0,0,0,0];
  for(const s of n.shapes){
   const h=s.half.map((v,k)=>v*scale[k]);
   const [x,y,z]=s.center.map((v,k)=>v*scale[k]-n.center[k]),m=8*h[0]*h[1]*h[2]*n.material.density;
   for(const k of axes){const u=(k+1)%3,v=(k+2)%3;inertia[k]+=m*(h[u]**2+h[v]**2)/3;}
   inertia[0]+=m*(y*y+z*z);inertia[1]+=m*(x*x+z*z);inertia[2]+=m*(x*x+y*y);
   inertia[3]-=m*x*y;inertia[4]-=m*x*z;inertia[5]-=m*y*z;
  }
  n.inertia=inertia;
 }
 const bonds=[],byPair=new Map();
 for(const face of contacts){
  const a=pieces[face.a].node,b=pieces[face.b].node;
  if(a===b)continue;
  const key=a+','+b+','+face.axis;let bond=byPair.get(key);
  if(!bond){bond={a,b,axis:face.axis,patches:[],area:0,center:[0,0,0],damage:0,broken:false};bonds.push(bond);byPair.set(key,bond);}
  const u=(bond.axis+1)%3,v=(bond.axis+2)%3,w=(face.hi[u]-face.lo[u])*scale[u],h=(face.hi[v]-face.lo[v])*scale[v],area=w*h;
  const center=face.hi.map((x,k)=>(x+face.lo[k])*.5*scale[k]);
  for(const k of axes)bond.center[k]+=center[k]*area;
  bond.area+=area;bond.patches.push({lo:face.lo,hi:face.hi,area,center,w,h});
 }
 for(const e of bonds){
  const u=(e.axis+1)%3,v=(e.axis+2)%3;
  for(const k of axes)e.center[k]/=e.area;
  let iu=0,iv=0,du=0,dv=0;
  for(const p of e.patches){
   const x=p.center[u]-e.center[u],y=p.center[v]-e.center[v];
   iu+=p.area*(p.h*p.h/12+y*y);iv+=p.area*(p.w*p.w/12+x*x);
   du=Math.max(du,Math.abs(x)+p.w/2);dv=Math.max(dv,Math.abs(y)+p.h/2);
  }
  e.zu=iu/dv;e.zv=iv/du;e.zt=(iu+iv)/Math.hypot(du,dv);
  const m=nodes[e.a].material,n=nodes[e.b].material;
  // A bond opening across fibres or between laminations sees less tensile strength.
  const strength=t=>{
   const grain=t.fractureGrain??0;
   const weakness=grain<0?(e.axis===1?-grain:0):(e.axis!==0?grain:0);
   return (t.tensileStrength+t.cohesion)*(1-(t.liquidity??0))**2*(1-.72*weakness);
  };
  e.overloadTime=Math.min(m.fractureDelay??.24,n.fractureDelay??.24);
  e.strength=Math.max(.01,Math.min(strength(m),strength(n),m.id===n.id?Infinity:Math.min(m.adhesion,n.adhesion)));
  e.compression=Math.max(e.strength,Math.min(m.yieldStress+strength(m),n.yieldStress+strength(n)));
  const length=Math.max(.001,Math.abs(nodes[e.a].center[e.axis]-nodes[e.b].center[e.axis]));
  const modulus=2/(1/Math.max(1,m.youngModulus)+1/Math.max(1,n.youngModulus));
  e.stiffness=modulus*e.area/length;
  const shear=modulus/(2+m.poissonRatio+n.poissonRatio);
  e.spring=axes.map(k=>k===e.axis?e.stiffness:shear*e.area/length);
  e.spring.push(...axes.map(k=>k===e.axis?shear*(iu+iv)/length:modulus*(k===u?iu:iv)/length));
 }
 return {nodes,bonds,scale,lo,step,dims,cells,boxes,sourceNodes};
}
export function islands(grid){
 const uf=unionFind(grid.nodes.length);
 for(const e of grid.bonds)if(!e.broken)uf.join(e.a,e.b);
 const groups=new Map();
 for(const n of grid.nodes){const id=uf.root(n.index);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(n.index);}
 return [...groups.values()];
}
export function nearestRegion(grid,point,candidates,preferred){
 const {lo,step,dims}=grid;
 const x=Math.floor((point[0]-lo[0])/step[0]),y=Math.floor((point[1]-lo[1])/step[1]),z=Math.floor((point[2]-lo[2])/step[2]);
 const cell=grid.cells.get(x+dims[0]*(y+dims[1]*z));
 let best,dist=Infinity;
 const search=list=>{
  for(const index of list){
   const n=grid.nodes[index];if(preferred&&n.material.id!==preferred)continue;
   for(const box of n.shapes){
    let d=0;
    for(let k=0;k<3;k++){const v=Math.max(0,Math.abs(point[k]-box.center[k])-box.half[k])*grid.scale[k];d+=v*v;}
    if(d<dist){dist=d;best=index;if(!d)return;}
   }
  }
 };
 if(cell)search(candidates.length===grid.nodes.length?cell:cell.filter(id=>candidates.includes(id)));
 if(dist>0)search(candidates);
 if(best!==undefined&&grid.voronoi)return cellOwner(grid,point,best,candidates);
 return best??(preferred?nearestRegion(grid,point,candidates):undefined);
}

// Keep the original curved collider on an intact primitive. Its fracture proxy
// uses symmetric occupied rows; mass is normalized when the body separates.
export function fractureBoxes(shapes){
 return shapes.flatMap(s=>{
  if(s.type==='box')return [s];
  const r=s.radius,half=s.halfHeight||0,ny=Math.min(48,Math.max(8,2*Math.round(4*(r+half)/r)));
  const dx=r/4,dy=2*(r+half)/ny,rows=[];
  for(let y=0;y<ny;y++)for(let z=0;z<8;z++){
   const cy=(y+.5)*dy-r-half,cz=(z+.5)*dx-r;
   const span=Math.sqrt(Math.max(0,r*r-cz*cz-Math.max(0,Math.abs(cy)-half)**2));
   const cells=Math.min(4,Math.floor(span/dx+.5));if(!cells)continue;
   rows.push({type:'box',center:[s.center[0],s.center[1]+cy,s.center[2]+cz],half:[cells*dx,dy/2,dx/2],materialId:s.materialId});
  }
  return rows;
 });
}

// Erase internal collider faces after a split without changing the occupied
// volume, surface material, or any remaining structural bonds.
export function fragmentBoxes(grid,ids){
 return mergeBoxes(ids.flatMap(i=>grid.nodes[i].shapes));
}
