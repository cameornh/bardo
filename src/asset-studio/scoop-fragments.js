import {Box3,Vector3} from 'three';
import {detachSandBonds} from './ground-interaction.js';

// The polar terrain scoop already consists of convex triangular prisms. Reuse
// those same finite elements for later cuts, including their exposed side walls.
function cutMesh(cells){
 const vertices=[],edges=new Map();
 for(const {points} of cells){
  const [a,b,c,d,e,f]=points;
  for(const v of [a,c,b,d,e,f])vertices.push(...v.toArray());
  for(const [u,v,w,x] of [[a,b,e,d],[b,c,f,e],[c,a,d,f]]){
   const k=[u,v].map(p=>[p.x,p.z].map(n=>Math.round(n*1e6)).join(',')).sort().join('|');
   if(edges.has(k))edges.delete(k);else edges.set(k,[u,v,w,u,w,x]);
  }
 }
 for(const face of edges.values())for(const v of face)vertices.push(...v.toArray());
 return vertices;
}
export function selectScoop(sim,chunk,point,radius){
 const cells=chunk.cut.samples;
 if(!cells?.[0]?.points||cells.length===1)return chunk;
 const local=sim.localPoint(chunk,point),picked=[],left=[];
 let nearest=cells[0],best=Infinity;
 for(const cell of cells){
  const d=cell.sample.distanceToSquared(local);
  if(d<best){best=d;nearest=cell;}
  (d<=radius*radius?picked:left).push(cell);
 }
 if(!left.length)return chunk;
 if(!picked.length){picked.push(nearest);left.splice(left.indexOf(nearest),1);}
 if(sim.chunks.size>=32)return null;
 const prior=chunk.field,rot=chunk.body.rotation(),origin=chunk.body.translation(),spin=chunk.body.angvel(),velocity=chunk.body.linvel(),com=chunk.body.worldCom();
 detachSandBonds(sim,chunk);
 function piece(portion){
  const body=sim.world.createRigidBody(sim.R.RigidBodyDesc.dynamic().setTranslation(origin.x,origin.y,origin.z)
   .setRotation(rot).setCcdEnabled(true).setLinearDamping(.12).setAngularDamping(.3));
  const shapes=[],m=chunk.material;
  for(const cell of portion){
   const points=cell.points.flatMap(p=>p.toArray()),desc=sim.R.ColliderDesc.convexHull(Float32Array.from(points));
   sim.world.createCollider(desc.setMass(cell.vol*m.density).setFriction(m.friction).setRestitution(m.restitution),body);
   const bounds=new Box3().setFromArray(points);
   shapes.push({type:'box',center:bounds.getCenter(new Vector3()).toArray(),half:bounds.getSize(new Vector3()).multiplyScalar(.5).toArray(),materialId:m.id});
  }
  const cut={...chunk.cut,vertices:cutMesh(portion),volume:portion.reduce((sum,c)=>sum+c.vol,0),samples:portion};
  const result={...chunk,body,cut,bond:null,bondParent:null,key:'ground-'+(++sim.chunkSerial)};
  body.setLinvel(new Vector3().copy(spin).cross(new Vector3().copy(body.worldCom()).sub(com)).add(velocity),true);
  body.setAngvel(spin,true);
  sim.materialWorld?.bind(result,shapes);
  sim.chunks.set(result.key,result);
  return result;
 }
 const carried=piece(picked),rest=piece(left);
 sim.materialWorld?.inherit(prior,[carried,rest]);
 sim.chunks.delete(chunk.key);sim.world.removeRigidBody(chunk.body);
 return carried;
}
