import {BufferGeometry,Float32BufferAttribute,Mesh,ShaderMaterial,Vector2,Vector4} from 'three';
import {CELL,MAX_CUTS,chunkTriangles} from './ground-tools.js';

export class GroundEditView{
 constructor(view){
  this.view=view;this.meshes=new Map();
  const mat=view.groundMaterial;
  Object.assign(mat.uniforms,{cutCount:{value:0},cutBounds:{value:new Vector4()},cutCenters:{value:Array.from({length:MAX_CUTS},()=>new Vector2())}});
  const patch=new ShaderMaterial({vertexShader:mat.vertexShader,fragmentShader:mat.fragmentShader,uniforms:mat.uniforms,defines:{GROUND_PATCH:1}});
  this.patch=new Mesh(new BufferGeometry(),patch);this.patch.visible=false;view.scene.add(this.patch);
 }
 update(sim){
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
  for(const [c,mesh] of this.meshes)if(!sim?.chunks.has(c.key)||sim.chunks.get(c.key)!==c){
   this.remove(mesh);this.meshes.delete(c);
  }
  for(const c of sim?.chunks.values()||[]){
   let mesh=this.meshes.get(c);
   if(!mesh){
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(chunkTriangles(c.cut),3));g.computeVertexNormals();
    mesh=new Mesh(g,this.view.matterView.material(c.material,false,CELL));mesh.userData.chunk=c;
    this.view.scene.add(mesh);this.meshes.set(c,mesh);
   }
   mesh.position.copy(c.body.translation());mesh.quaternion.copy(c.body.rotation());
  }
 }
 remove(mesh){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}
 dispose(){for(const mesh of this.meshes.values())this.remove(mesh);this.remove(this.patch);}
}
