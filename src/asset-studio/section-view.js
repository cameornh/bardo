import {BoxGeometry,Mesh,Vector3} from 'three';

// Retain authored surface samples, including fibers and paint, on each side.
function splitSurface(surface,section,shape){
 const {axis,b,c}=section,mid=section.halves[0].center[axis]*.5+section.halves[1].center[axis]*.5;
 const sign=Math.sign(shape.center[axis]-mid),out={spacing:surface.spacing,positions:[],normals:[],materials:[]};
 for(let n=0;n<surface.materials.length;n++){
  const i=n*3;if((surface.positions[i+axis]-mid)*sign<0)continue;
  for(let k=0;k<3;k++){out.positions.push(surface.positions[i+k]);out.normals.push(surface.normals[i+k]);}
  out.materials.push(surface.materials[n]);
 }
 const cols=Math.max(1,Math.ceil(2*shape.half[b]/out.spacing)),rows=Math.max(1,Math.ceil(2*shape.half[c]/out.spacing));
 const normal=[0,0,0];normal[axis]=-sign;
 for(let i=0;i<cols;i++)for(let j=0;j<rows;j++){
  const p=shape.center.slice();p[axis]=mid;
  p[b]+=shape.half[b]*(2*(i+.5)/cols-1);p[c]+=shape.half[c]*(2*(j+.5)/rows-1);
  out.positions.push(...p);out.normals.push(...normal);out.materials.push(section.material.id);
 }
 return out;
}

// Intact members use the normal authored surface. Allocate fragment geometry
// once, only when a section has visibly yielded.
export class SectionView{
 constructor(view){this.view=view;this.meshes=new Map();}
 update(sim){
  if(this.sim!==sim){this.clear();this.sim=sim;}
  for(const s of sim?.sections||[]){
   if(!s.exposed)continue;
   if(!this.meshes.has(s)){
    const root=this.view.groups.get(s.root.instance.id)?.children.find(o=>o.userData.partId===s.root.part.id);
    if(!root)continue;
    root.visible=false;
    const pieces=[s.root,s.tip].map((r,k)=>{
     const shape=s.halves[k],surface=this.view.surfaces.get(root.children[0]?.userData.surfaceKey);
     let mesh;
     if(surface){
      const geometry=this.view.geometry(splitSurface(surface,s,shape),this.view.library.materials);
      mesh=new Mesh(geometry,this.view.material);this.view.assetScene.add(mesh);
     }else{
      const geometry=new BoxGeometry(...shape.half.map(h=>2*h));geometry.translate(...shape.center);
      mesh=new Mesh(geometry,this.view.matterView.material(s.material,false,s.length));this.view.scene.add(mesh);
     }
     mesh.matrixAutoUpdate=false;mesh.userData.record=r;return mesh;
    });
    this.meshes.set(s,{root,pieces});
   }
   for(const piece of this.meshes.get(s).pieces){piece.matrix.copy(piece.userData.record.matrix);piece.matrixWorldNeedsUpdate=true;}
  }
 }
 pick(raycaster,nearest){
  if(!this.meshes.size)return nearest;
  const ray=new this.sim.R.Ray(raycaster.ray.origin,raycaster.ray.direction);
  for(const {pieces} of this.meshes.values())for(const mesh of pieces){
   const r=mesh.userData.record,hit=r.body.collider(0).castRayAndGetNormal(ray,nearest?.distance??raycaster.far,true);
   if(!hit||nearest&&hit.timeOfImpact>=nearest.distance)continue;
   nearest={point:raycaster.ray.at(hit.timeOfImpact,new Vector3()),distance:hit.timeOfImpact,normal:new Vector3().copy(hit.normal),
    bodyKey:r.key,instanceId:r.instance.id,partId:r.part.id,assetId:r.asset.id};
  }
  return nearest;
 }
 clear(){
  for(const {root,pieces} of this.meshes.values()){
   root.visible=true;
   for(const mesh of pieces){mesh.removeFromParent();mesh.geometry.dispose();if(mesh.material!==this.view.material)mesh.material.dispose();}
  }
  this.meshes.clear();
 }
}
