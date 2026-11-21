import {planarSurface} from './surface-support.js';
import {Mesh,Vector3} from 'three';
import {charSurfacePoint,roundCharChip} from './char-fracture.js';
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
 const surfaces=new Map(),limits=new Map();
 const cuts=s.grid.bonds.filter(e=>s.owners[e.a]!==s.owners[e.b]);
 // The two sides of a separated bond no longer share exterior skin.
 for(const edge of cuts)for(const [id,side] of [[edge.a,1],[edge.b,-1]]){
  if(!limits.has(id))limits.set(id,{lo:[-Infinity,-Infinity,-Infinity],hi:[Infinity,Infinity,Infinity]});
  const bounds=limits.get(id),axis=edge.axis,plane=edge.patches[0].lo[axis];
  if(side>0)bounds.hi[axis]=Math.min(bounds.hi[axis],plane);else bounds.lo[axis]=Math.max(bounds.lo[axis],plane);
 }
 for(const r of changed){
  const out=emptySurface(skin[0].spacing);surfaces.set(r,out);
  for(const i of r.regions){
   const node=skin[i];
   for(const x of node.positions)out.positions.push(x);
   for(const x of node.normals)out.normals.push(x);
   for(const m of node.materials)out.materials.push(m);
   const bounds=limits.get(i);
   for(let j=0;j<node.positions.length;j++){
    out.supportMin.push(Math.max(node.supportMin[j],bounds?.lo[j%3]??-Infinity));
    out.supportMax.push(Math.min(node.supportMax[j],bounds?.hi[j%3]??Infinity));
   }
  }
 }
 const area=cuts.reduce((total,e)=>total+e.area/(s.grid.scale[(e.axis+1)%3]*s.grid.scale[(e.axis+2)%3]),0);
 const spacing=Math.max(skin[0].spacing,Math.sqrt(area/12000));
 for(const e of cuts){
  if(!surfaces.has(s.owners[e.a])&&!surfaces.has(s.owners[e.b]))continue;
  const axis=e.axis,u=(axis+1)%3,v=(axis+2)%3;
  for(const patch of e.patches){
   const w=patch.hi[u]-patch.lo[u],h=patch.hi[v]-patch.lo[v],nx=Math.max(1,Math.ceil(w/spacing)),ny=Math.max(1,Math.ceil(h/spacing));
   for(let x=0;x<nx;x++)for(let y=0;y<ny;y++){
    const p=patch.lo.slice();p[u]+=(x+.5)*w/nx;p[v]+=(y+.5)*h/ny;
    const depth=-field(p,s.root.part.stamps)[0];if(depth<0)continue;
    const position=e.char?charSurfacePoint(p,s.grid,depth,e.char):p;
    const faceNormal=[0,0,0];faceNormal[axis]=1;
    if(e.char){
     const delta=spacing*.25,tu=p.slice(),tv=p.slice();tu[u]+=delta;tv[v]+=delta;
     const tangent=q=>new Vector3(...charSurfacePoint(q,s.grid,-field(q,s.root.part.stamps)[0],e.char)).sub(new Vector3(...position));
     tangent(tu).cross(tangent(tv)).normalize().toArray(faceNormal);
    }
    for(const [node,sign] of [[e.a,1],[e.b,-1]]){
     const out=surfaces.get(s.owners[node]);if(!out)continue;
     const normal=faceNormal.map(x=>x*sign);
     out.positions.push(...position);out.normals.push(...normal);out.materials.push(s.grid.nodes[node].material.id);
     for(let k=0;k<3;k++){
      // A charred seam can curl out of its original plane.
      const shift=position[k]-p[k];
      out.supportMin.push(k===axis?-Infinity:patch.lo[k]+shift);
      out.supportMax.push(k===axis?Infinity:patch.hi[k]+shift);
     }
    }
   }
  }
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
   const shift=out.positions[i]-before[i];out.supportMin[i]+=shift;out.supportMax[i]+=shift;
  }
 }
 return surfaces;
}
export class SectionView{
 constructor(view){this.view=view;this.meshes=new Map();}
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
     mesh.removeFromParent();mesh.geometry.dispose();batch.pieces.delete(r);
    }
    const changed=[...s.bodies].filter(r=>batch.pieces.get(r)?.userData.regions!==r.regions);
    for(const [r,surface] of fragmentSurfaces(s,batch.skin,changed)){
     const geometry=this.view.geometry(surface,this.view.library.materials);let mesh=batch.pieces.get(r);
     if(mesh){mesh.geometry.dispose();mesh.geometry=geometry;}
     else{mesh=new Mesh(geometry,this.view.material);this.view.bindFinish(mesh,()=>r);mesh.matrixAutoUpdate=false;this.view.assetScene.add(mesh);batch.pieces.set(r,mesh);}
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
    bodyKey:r.key,instanceId:r.instance.id,partId:r.part.id,assetId:r.asset.id};
  }
  return nearest;
 }
 clear(){
  for(const {root,pieces} of this.meshes.values()){
   root.visible=true;for(const mesh of pieces.values()){mesh.removeFromParent();mesh.geometry.dispose();}
  }
  this.meshes.clear();
 }
}
