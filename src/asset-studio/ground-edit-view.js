import {SandTerrainView} from './sand-terrain-view.js';
import {BufferGeometry,Float32BufferAttribute,Mesh,ShaderMaterial,Vector2,Vector4} from 'three';
import {CELL,MAX_CUTS,chunkTriangles} from './ground-tools.js';

export class GroundEditView{
 constructor(view){
  this.view=view;this.meshes=new Map();this.chunkPool=[];this.chunkMaterials=new Map();
  const mat=view.groundMaterial;this.sand=new SandTerrainView(mat.uniforms);
  Object.assign(mat.uniforms,{cutCount:{value:0},cutBounds:{value:new Vector4()},cutCenters:{value:Array.from({length:MAX_CUTS},()=>new Vector2())}});
  const patch=new ShaderMaterial({vertexShader:mat.vertexShader,fragmentShader:mat.fragmentShader,uniforms:mat.uniforms,defines:{GROUND_PATCH:1}});
  this.patch=new Mesh(new BufferGeometry(),patch);this.patch.visible=false;view.scene.add(this.patch);
 }
 update(sim){
  this.sand.update(sim?.sandTerrain,this.view.camera.position);
  const cuts=sim?.cuts,u=this.patch.material.uniforms;
  if(this.cuts!==cuts||this.version!==cuts?.version){
   this.cuts=cuts;this.version=cuts?.version;
   const nodes=[...(cuts?.nodes.values()||[])];u.cutCount.value=nodes.length;
   this.patch.visible=nodes.length>0;
   if(nodes.length){
    const xs=nodes.map(n=>n.x),zs=nodes.map(n=>n.z);
    u.cutBounds.value.set(Math.min(...xs)-CELL,Math.min(...zs)-CELL,Math.max(...xs)+CELL,Math.max(...zs)+CELL);
    nodes.forEach((n,i)=>u.cutCenters.value[i].set(n.x,n.z));
    const positions=cuts.triangles(),g=this.patch.geometry;
    if(!g.attributes.position||g.attributes.position.count<positions.length/3){
     g.dispose();g.setAttribute('position',new Float32BufferAttribute(new Float32Array(MAX_CUTS*54),3));
    }
    g.attributes.position.array.set(positions);g.attributes.position.needsUpdate=true;
    g.setDrawRange(0,positions.length/3);this.patch.frustumCulled=false;
   }
  }
  if(this.sim!==sim){
   this.clearChunks();this.sim=sim;
  }
  for(const [c,mesh] of this.meshes)if(!sim?.chunks.has(c.key)||sim.chunks.get(c.key)!==c){
   mesh.removeFromParent();mesh.userData.chunk=null;this.chunkPool.push(mesh);this.meshes.delete(c);
  }
  for(const c of sim?.chunks.values()||[]){
   let mesh=this.meshes.get(c);
   if(!mesh){
    mesh=this.chunkPool.pop();
    if(!mesh){
     mesh=new Mesh(new BufferGeometry(),this.patch.material);
    }
    if(!this.chunkMaterials.has(c.material.id))this.chunkMaterials.set(c.material.id,this.view.matterView.material(c.material,false,CELL));
    mesh.material=this.chunkMaterials.get(c.material.id);
    const geometry=mesh.geometry;
    geometry.setAttribute('position',new Float32BufferAttribute(chunkTriangles(c.cut),3));
    geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();geometry.computeBoundingSphere();
    mesh.userData.chunk=c;
    this.view.scene.add(mesh);this.meshes.set(c,mesh);
   }
   mesh.scale.setScalar(c.field?.scale??1);mesh.position.copy(c.body.translation());mesh.quaternion.copy(c.body.rotation());
  }
 }
 remove(mesh){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}
 clearChunks(){
  for(const mesh of [...this.meshes.values(),...this.chunkPool]){mesh.removeFromParent();mesh.geometry.dispose();}
  this.meshes.clear();this.chunkPool.length=0;for(const m of this.chunkMaterials.values())m.dispose();this.chunkMaterials.clear();
 }
 dispose(){this.sand.dispose();this.clearChunks();this.remove(this.patch);}
}
