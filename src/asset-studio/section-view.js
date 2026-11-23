import {solidOptics} from './material-reactions.js';
import {planarSurface} from './surface-support.js';
import {Mesh,Vector3} from 'three';
import {charSurfacePoint,roundCharChip} from './char-fracture.js';
import {cellOwner} from './fracture-cells.js';
import {nearestRegion} from './fracture-grid.js';
import {bakeFast} from './sculpt-fast.js';
import {field} from './sculpt.js';

function emptySurface(spacing){return {spacing,positions:[],normals:[],materials:[],supportMin:[],supportMax:[]};}
function partitionSkin(s,surface){
 const skin=s.indices.map(()=>emptySurface(surface.spacing));
 const solids=new Set(s.grid.nodes.map(n=>n.material.id));
 for(let i=0;i<surface.materials.length;i++){
  const material=surface.materials[i];if(!solids.has(material))continue;
  const p=Array.from(surface.positions.slice(i*3,i*3+3));
  const n=nearestRegion(s.grid,p,s.indices,material),out=skin[n];
  out.positions.push(...p);out.normals.push(...surface.normals.slice(i*3,i*3+3));out.materials.push(material);
  for(let k=0;k<3;k++){out.supportMin.push(surface.supportMin?.[i*3+k]??-Infinity);out.supportMax.push(surface.supportMax?.[i*3+k]??Infinity);}
 }
 return skin;
}
function fragmentSurfaces(s,skin,changed){
 const surfaces=new Map(),grid=s.grid,cells=grid.voronoi;
 const cuts=grid.bonds.filter(e=>s.owners[e.a]!==s.owners[e.b]);
 const nodeChar=new Float32Array(grid.nodes.length);
 for(const e of cuts)if(e.char)for(const i of [e.a,e.b])nodeChar[i]=Math.max(nodeChar[i],e.char);
 const materialCuts=cuts.filter(e=>grid.nodes[e.a].material.id!==grid.nodes[e.b].material.id);
 const p=new Vector3();
 for(const r of changed){
  const out=emptySurface(skin[0].spacing);out.seamPlanes=[];surfaces.set(r,out);
  for(const i of r.regions){
   const node=skin[i],planes=cells.planes[i].filter(f=>s.owners[f.j]!==r);
   for(const e of materialCuts){
    if(e.a!==i&&e.b!==i)continue;
    const sign=e.a===i?1:-1,n=new Vector3().setComponent(e.axis,sign);
    planes.push({n,d:sign*e.patches[0].lo[e.axis]});
   }
   for(let j=0;j<node.positions.length;j+=3){
    p.fromArray(node.positions,j);let nearest=null,dist=Infinity;
    for(const plane of planes){const gap=plane.d-plane.n.dot(p);if(gap>=-1e-6&&gap<dist){dist=gap;nearest=plane;}}
    out.seamPlanes.push(...(nearest?[...nearest.n.toArray(),nearest.d]:[0,0,0,0]));
   }
   for(const key of ['positions','normals','materials','supportMin','supportMax'])for(const value of node[key])out[key].push(value);
  }
 }
 // Tessellate each newly exposed convex face in its own tangent frame. Both
 // fragments use the same polygon. Only an original material seam is planar
 // by construction. Intact interior faces never enter the draw list.
 const facets=[];
 for(const [i,shapes] of cells.parts.entries())for(const shape of shapes)for(const f of shape.faces??[]){
  if(f.neighbor==null||f.neighbor<=i||s.owners[i]===s.owners[f.neighbor])continue;
  if(surfaces.has(s.owners[i])||surfaces.has(s.owners[f.neighbor]))facets.push({...f,a:i,b:f.neighbor});
 }
 // Different materials abut at the original contact proxy. Sample the actual
 // Voronoi owner on either side as their fragments can separate independently.
 for(const e of grid.bonds){
  if(grid.nodes[e.a].material.id===grid.nodes[e.b].material.id)continue;
  const k=e.axis,u=(k+1)%3,v=(k+2)%3;
  for(const patch of e.patches){
   const points=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>new Vector3(...patch.lo)
    .setComponent(u,x?patch.hi[u]:patch.lo[u]).setComponent(v,y?patch.hi[v]:patch.lo[v]));
   facets.push({points,normal:new Vector3().setComponent(k,1),a:e.a,b:e.b,interface:true});
  }
 }
 let area=0;
 for(const f of facets)for(let k=2;k<f.points.length;k++)area+=new Vector3().subVectors(f.points[k-1],f.points[0])
  .cross(new Vector3().subVectors(f.points[k],f.points[0])).length()*.5;
 const spacing=Math.max(skin[0].spacing,Math.sqrt(area/12000));
 for(const f of facets){
  const {points,normal}=f,origin=points[0];
  const edge=points.find(p=>p.distanceToSquared(origin)>1e-14);if(!edge)continue;
  const u=edge.clone().sub(origin).normalize(),v=new Vector3().crossVectors(normal,u);
  const uv=points.map(p=>{const d=p.clone().sub(origin);return [d.dot(u),d.dot(v)];});
  const edges=[];
  for(let k=0;k<points.length;k++){
   const a=points[k],b=points[(k+1)%points.length],n=b.clone().sub(a).cross(normal);
   if(n.lengthSq()>1e-16){n.normalize();edges.push({n,d:n.dot(a)});}
  }
  const lo=[0,1].map(k=>Math.min(...uv.map(p=>p[k]))),hi=[0,1].map(k=>Math.max(...uv.map(p=>p[k])));
  const count=lo.map((x,k)=>Math.max(1,Math.ceil((hi[k]-x)/spacing)));
  const emit=pos=>{
   let closest=null,best=Infinity;
   for(const edge of edges){const gap=edge.d-edge.n.dot(pos);if(gap<-.000001)return false;if(gap<best){best=gap;closest=edge;}}
   const point=pos.toArray(),depth=-field(point,s.root.part.stamps)[0];if(depth<-.000001)return false;
   const a=f.interface?cellOwner(grid,point,f.a):f.a,b=f.interface?cellOwner(grid,point,f.b):f.b;
   if(s.owners[a]===s.owners[b])return false;
   const char=Math.max(nodeChar[a],nodeChar[b]),position=char?charSurfacePoint(point,grid,depth,char):point;
   for(const [i,sign] of [[a,1],[b,-1]]){
    const out=surfaces.get(s.owners[i]);if(!out)continue;
    out.positions.push(...position);out.materials.push(grid.nodes[i].material.id);
    out.normals.push(sign*normal.x,sign*normal.y,sign*normal.z);
    out.supportMin.push(-Infinity,-Infinity,-Infinity);out.supportMax.push(Infinity,Infinity,Infinity);
    out.seamPlanes.push(...(closest?[...closest.n.toArray(),closest.d+closest.n.dot(new Vector3(...position).sub(pos))]:[0,0,0,0]));
   }
   return true;
  };
  let sampled=false;
  for(let x=0;x<count[0];x++)for(let y=0;y<count[1];y++){
   const pos=origin.clone().addScaledVector(u,lo[0]+(hi[0]-lo[0])*(x+.5)/count[0]).addScaledVector(v,lo[1]+(hi[1]-lo[1])*(y+.5)/count[1]);
   if(emit(pos))sampled=true;
  }
  if(!sampled)emit(points.reduce((v,p)=>v.add(p),new Vector3()).divideScalar(points.length));
 }
 const char=new Map();
 for(const e of cuts)if(e.char)for(const owner of [s.owners[e.a],s.owners[e.b]])
  char.set(owner,Math.max(char.get(owner)??0,e.char));
 for(const [r,out] of surfaces){
  const amount=char.get(r);
  if(!amount||r.regions.length>8)continue;
  const before=out.positions.slice();
  roundCharChip(out,s.grid,r.regions,amount);
  for(let i=0;i<before.length;i++){
   const shift=out.positions[i]-before[i],j=Math.floor(i/3)*4;out.seamPlanes[j+3]+=out.seamPlanes[j+i%3]*shift;out.supportMin[i]+=shift;out.supportMax[i]+=shift;
  }
 }
 return surfaces;
}
export class SectionView{
 constructor(view){this.view=view;this.meshes=new Map();}
 clearOptics(mesh){for(const child of [...mesh.children]){this.view.frozenOptics.delete(child);mesh.remove(child);}}
 update(sim){
  if(this.sim!==sim){this.clear();this.sim=sim;}
  for(const s of sim?.structures||[]){
   if(s.bodies.size<=1&&!s.meltRevision)continue;
   if(!s.bodies.size&&!this.meshes.has(s))continue;
   let batch=this.meshes.get(s);
   if(!batch){
    const r=s.root,root=this.view.groups.get(r.instance.id)?.children.find(o=>o.userData.partId===r.part.id);
    if(!root)continue;
    const surface=this.view.surfaces.get(r.asset.id+':'+r.part.id)??planarSurface(r.part.stamps,r.asset.spacing)??bakeFast(r.part.stamps,r.asset.spacing);
    batch={root,skin:partitionSkin(s,surface),pieces:new Map()};this.meshes.set(s,batch);
   }
   batch.root.visible=false;
   if(batch.count!==s.bodies.size||batch.meltRevision!==s.meltRevision){
    batch.meltRevision=s.meltRevision;
    for(const [r,mesh] of batch.pieces)if(!s.bodies.has(r)){
     this.clearOptics(mesh);mesh.removeFromParent();mesh.geometry.dispose();batch.pieces.delete(r);
    }
    const changed=[...s.bodies].filter(r=>batch.pieces.get(r)?.userData.regions!==r.regions);
    for(const [r,surface] of fragmentSurfaces(s,batch.skin,changed)){
     const geometry=this.view.geometry(surface,this.view.library.materials);let mesh=batch.pieces.get(r);
     if(mesh){this.clearOptics(mesh);mesh.geometry.dispose();mesh.geometry=geometry;}
     else{mesh=new Mesh(geometry,this.view.material);this.view.bindFinish(mesh,()=>r);mesh.matrixAutoUpdate=false;this.view.assetScene.add(mesh);batch.pieces.set(r,mesh);}
     for(const id of geometry.userData.materialIds){
      const index=this.view.materialIndices.get(id),m=this.view.library.materials[index];
      if(solidOptics(m))this.view.attachOptics(mesh,geometry,m,index,null,()=>r);
     }
     mesh.userData.regions=r.regions;
    }
    batch.count=s.bodies.size;
   }
   for(const [r,mesh] of batch.pieces){mesh.matrix.copy(r.matrix);mesh.matrixWorldNeedsUpdate=true;}
  }
 }
 pick(raycaster,nearest){
  if(!this.meshes.size)return nearest;
  const ray=new this.sim.R.Ray(raycaster.ray.origin,raycaster.ray.direction);
  for(const {pieces} of this.meshes.values())for(const r of pieces.keys())for(let i=0;i<r.body.numColliders();i++){
   const hit=r.body.collider(i).castRayAndGetNormal(ray,nearest?.distance??raycaster.far,true);
   if(!hit||nearest&&hit.timeOfImpact>=nearest.distance)continue;
   nearest={point:raycaster.ray.at(hit.timeOfImpact,new Vector3()),distance:hit.timeOfImpact,normal:new Vector3().copy(hit.normal),
    bodyKey:r.key,instanceId:r.instance.id,partId:r.part.id,assetId:r.asset.id,materialId:r.field.shapes[i].materialId};
  }
  return nearest;
 }
 clear(){
  for(const {root,pieces} of this.meshes.values()){
   root.visible=true;for(const mesh of pieces.values()){this.clearOptics(mesh);mesh.removeFromParent();mesh.geometry.dispose();}
  }
  this.meshes.clear();
 }
}
