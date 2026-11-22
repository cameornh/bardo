// Physical crack geometry is built once, on separation. Each connected material
// gets its own Voronoi diagram, intersected with the occupied collision volume.
import {Vector3} from 'three';
const axes=[0,1,2],epsilon=1e-8;
const vector=a=>new Vector3().fromArray(a);
function noise(i){
 let x=Math.imul(i+53,0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);
 return ((x^(x>>>16))>>>0)/4294967296;
}
function boxFaces(box){
 const faces=[];
 for(const axis of axes)for(const sign of [-1,1]){
  const normal=[0,0,0];normal[axis]=sign;
  const points=[[1,1],[-1,1],[-1,-1],[1,-1]].map(([u,v])=>{
   const corner=normal.slice();corner[(axis+1)%3]=u;corner[(axis+2)%3]=v;
   return vector(corner.map((d,k)=>box.center[k]+d*box.half[k]));
  });
  if(sign<0)points.reverse();
  faces.push({points,normal:vector(normal),neighbor:null});
 }
 return faces;
}
function clip(faces,normal,offset,neighbor){
 const next=[],rim=[];
 for(const face of faces){
  const points=[];let a=face.points.at(-1),da=normal.dot(a)-offset;
  for(const b of face.points){
   const db=normal.dot(b)-offset;
   if((da>epsilon)!==(db>epsilon)){
    const crossing=a.clone().lerp(b,Math.max(0,Math.min(1,da/(da-db))));
    points.push(crossing);
    if(!rim.some(p=>p.distanceToSquared(crossing)<epsilon**2))rim.push(crossing);
   }
   if(db<=epsilon)points.push(b);
   a=b;da=db;
  }
  if(points.length>=3)next.push({...face,points});
 }
 if(rim.length>=3){
  const middle=new Vector3();for(const p of rim)middle.add(p);middle.divideScalar(rim.length);
  const u=new Vector3(Math.abs(normal.x)<.8?1:0,Math.abs(normal.x)<.8?0:1,0).cross(normal).normalize();
  const v=new Vector3().crossVectors(normal,u);
  const angle=p=>Math.atan2(v.dot(p)-v.dot(middle),u.dot(p)-u.dot(middle));
  rim.sort((a,b)=>angle(a)-angle(b));
  next.push({points:rim,normal,neighbor});
 }
 return next;
}
function hullShape(faces,materialId){
 const points=[...new Set(faces.flatMap(f=>f.points))];
 const lower=new Vector3(Infinity,Infinity,Infinity),upper=lower.clone().negate();
 for(const p of points){lower.min(p);upper.max(p);}
 const center=lower.clone().lerp(upper,.5),half=upper.clone().sub(center);
 const cross=new Vector3(),a=new Vector3(),b=new Vector3();let volume=0;
 for(const f of faces){
  const origin=f.points[0],distance=f.normal.dot(a.subVectors(origin,center));
  for(let k=2;k<f.points.length;k++){
   cross.crossVectors(a.subVectors(f.points[k-1],origin),b.subVectors(f.points[k],origin));
   volume+=distance*cross.dot(f.normal)/6;
  }
 }
 return {type:'hull',center:center.toArray(),half:half.toArray(),materialId,volume,
  vertices:points.flatMap(p=>p.clone().sub(center).toArray()),
  planes:faces.map(f=>[...f.normal.toArray(),f.normal.dot(f.points[0])]),faces};
}
const boxVolume=s=>8*s.half[0]*s.half[1]*s.half[2];
export function fractureCells(grid){
 if(grid.voronoi)return grid.voronoi;
 const {nodes,boxes}=grid,domains=nodes.map((_,i)=>i);
 const root=i=>{while(i!==domains[i]){domains[i]=domains[domains[i]];i=domains[i];}return i;};
 for(const e of grid.bonds)if(nodes[e.a].material.id===nodes[e.b].material.id)domains[root(e.a)]=root(e.b);
 const byDomain=new Map(),parts=nodes.map(()=>[]),sourcePieces=boxes.map(()=>[]);
 // Put the seed inside real material, including narrow carved or painted regions.
 const sites=nodes.map((node,i)=>{
  const box=node.shapes.reduce((a,b)=>boxVolume(a)>boxVolume(b)?a:b);
  const p=vector(box.center.map((x,k)=>x+box.half[k]*1.40*(noise(i*3+k)-.5)));
  const id=root(i);if(!byDomain.has(id))byDomain.set(id,[]);
  byDomain.get(id).push(i);return p;
 });
 const widest=Math.max(...grid.step.map((v,k)=>v*grid.scale[k]));
 const baseMetric=vector(grid.scale.map((s,k)=>1/Math.max(grid.step[k],.45*widest/s)**2));
 // A single metric per connected material keeps the two sides of every cut
 // complementary. Fibres run along local X; layer normals follow local Y.
 const metrics=new Map();
 for(const [id,indices] of byDomain){
  const grain=nodes[indices[0]].material.fractureGrain??0;
  const metric=baseMetric.clone();
  if(grain>0)metric.x*=Math.exp(-3.6*grain);
  else metric.y*=Math.exp(-3.6*grain);
  metrics.set(id,metric);
 }
 const center=new Vector3();
 const distance=(a,b,metric)=>metric.x*(a.x-b.x)**2+metric.y*(a.y-b.y)**2+metric.z*(a.z-b.z)**2;
 const planes=sites.map((p,i)=>byDomain.get(root(i)).filter(j=>j!==i).map(j=>{
  const metric=metrics.get(root(i)),q=sites[j],n=q.clone().sub(p).multiply(metric).normalize();
  return {j,n,d:n.dot(p.clone().lerp(q,.5)),order:distance(p,q,metric)};
 }).sort((a,b)=>a.order-b.order));
 for(const [index,box] of boxes.entries()){
  center.fromArray(box.center);
  const id=root(grid.sourceNodes[index]),ids=byDomain.get(id),metric=metrics.get(id);
  let nearest=Infinity;for(const i of ids)nearest=Math.min(nearest,distance(center,sites[i],metric));
  const radius=Math.sqrt(box.half.reduce((v,x,k)=>v+x*x*metric.getComponent(k),0));
  const limit=(Math.sqrt(nearest)+2*radius+epsilon)**2;
  for(const i of ids){
   if(distance(center,sites[i],metric)>limit)continue;
   let faces;
   for(const {j,n,d} of planes[i]){
    const extent=box.half[0]*Math.abs(n.x)+box.half[1]*Math.abs(n.y)+box.half[2]*Math.abs(n.z);
    const gap=n.dot(center)-d;
    if(gap>extent-epsilon){faces=[];break;}
    if(gap<=-extent+epsilon)continue;
    faces=clip(faces??boxFaces(box),n,d,j);
    if(!faces.length)break;
   }
   if(faces&&!faces.length)continue;
   const shape=faces?hullShape(faces,box.materialId):box;
   if(faces&&shape.volume<=boxVolume(box)*1e-11)continue;
   parts[i].push(shape);sourcePieces[index].push({i,shape});
  }
 }
 const cells={sites,parts,sourcePieces,planes,byDomain,domain:sites.map((_,i)=>root(i)),metrics,distance};
 grid.voronoi=cells;return cells;
}
export function cellShapes(grid,ids){
 const cells=fractureCells(grid),allowed=new Set(ids),shapes=[];
 for(const [i,pieces] of cells.sourcePieces.entries()){
  if(pieces.length&&pieces.every(p=>allowed.has(p.i)))shapes.push(grid.boxes[i]);
  else for(const p of pieces)if(allowed.has(p.i))shapes.push(p.shape);
 }
 return [...mergeBoxes(shapes.filter(p=>p.type==='box')),...shapes.filter(p=>p.type==='hull')];
}
export function cellOwner(grid,point,coarse,candidates){
 const cells=grid.voronoi,domain=cells.domain[coarse],indices=cells.byDomain.get(domain),metric=cells.metrics.get(domain),p=vector(point);
 let nearest=Infinity,owner=coarse;
 for(const i of indices){
  if(candidates&&candidates.length!==grid.nodes.length&&!candidates.includes(i))continue;
  const d=cells.distance(p,cells.sites[i],metric);if(d<nearest){nearest=d;owner=i;}
 }
 return owner;
}

export function mergeBoxes(boxes){
 for(const axis of axes){
  const u=(axis+1)%3,v=(axis+2)%3,rows=new Map();
  for(const s of boxes){
   const key=[s.materialId,...[s.center[u],s.center[v],s.half[u],s.half[v]].map(x=>Math.round(x/epsilon))].join('|');
   if(!rows.has(key))rows.set(key,[]);rows.get(key).push(s);
  }
  boxes=[];
  for(const row of rows.values()){
   row.sort((a,b)=>a.center[axis]-b.center[axis]);let current;
   for(const s of row){
    const lo=s.center[axis]-s.half[axis],hi=s.center[axis]+s.half[axis];
    if(!current||Math.abs(current.center[axis]+current.half[axis]-lo)>epsilon){
     current={...s,center:s.center.slice(),half:s.half.slice()};boxes.push(current);continue;
    }
    const start=current.center[axis]-current.half[axis];
    current.half[axis]=(hi-start)*.5;current.center[axis]=(start+hi)*.5;
   }
  }
 }
 return boxes;
}
