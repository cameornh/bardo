// A small rigid assembly over a flat floor fits in one depth draw.
// Six instances project the same closed caster geometry into one row of the
// lamp atlas. Each fragment belongs exclusively to its own cube face.
import * as T from 'three';
import {cutMask} from './ground-surface.js';
import {MAX_CUTS} from './ground-tools.js';
import {polishedShell} from './polished-shell.js';

const LIMIT=24;
export class OpticShadowBatch{
 constructor(faceSize){
  this.poses=Array.from({length:LIMIT+2},()=>new T.Matrix4());
  this.material=new T.ShaderMaterial({side:T.DoubleSide,colorWrite:false,uniforms:{
   poses:{value:this.poses},skip:{value:-1},origin:{value:new T.Vector3()}},
   vertexShader:`attribute float owner;uniform mat4 poses[${LIMIT+2}];uniform int skip;uniform vec3 origin;
   flat varying int face,flatFloor;varying vec2 floorXZ;
   void main(){
    face=gl_InstanceID;int i=int(owner);flatFloor=int(i==${LIMIT});
    if(i==skip||poses[i][3][3]==0.){gl_Position=vec4(2.,2.,2.,1.);return;}
    vec3 p=(poses[i]*vec4(position,1.)).xyz-origin,eye;
    floorXZ=p.xz+origin.xz;
    if(face==0)eye=vec3(-p.z,-p.y,-p.x);
    else if(face==1)eye=vec3(p.z,-p.y,p.x);
    else if(face==2)eye=vec3(p.x,p.z,-p.y);
    else if(face==3)eye=vec3(p.x,-p.z,p.y);
    else if(face==4)eye=vec3(p.x,-p.y,-p.z);
    else eye=vec3(-p.x,-p.y,p.z);
    vec4 clip=projectionMatrix*vec4(eye,1.);
    clip.x=(clip.x+(2.*float(face)-5.)*clip.w)/6.;gl_Position=clip;
   }`,
   fragmentShader:`${cutMask}
    flat varying int face,flatFloor;varying vec2 floorXZ;
    void main(){if(int(gl_FragCoord.x)/${faceSize}!=face)discard;if(flatFloor==1)discardCut(floorXZ);gl_FragColor=vec4(0.);}`});
 }
 prepare(view,emitter,origin){
  const solids=view.raySolids;
  if(!view.opticalParts.length||view.garden||view.sea||view.ground.geometry!==view.flatFloor||
   !view.ground.visible||view.groundEdits.meshes.size||
   view.sectionView.meshes.size||view.matterView.meshes.size||view.paintView.batches.length)return null;
  if(this.parts!==solids){
   this.parts=solids;this.mesh?.geometry.dispose();this.mesh=null;
   let count=0;for(const group of view.groups.values())count+=group.children.length;
   if(count>LIMIT||solids.length!==count||solids.some(s=>!s.shadowShell))return null;
   const positions=[],owners=[],indices=[];
   const append=(geometry,owner)=>{
    const p=geometry.getAttribute('position'),start=owners.length;
    for(let j=0;j<p.count;j++){positions.push(p.getX(j),p.getY(j),p.getZ(j));owners.push(owner);}
    for(const j of geometry.index.array)indices.push(start+j);
   };
   for(const [i,{object,shape}] of solids.entries()){
    const surface=object.children[0],shared=surface?.userData.polished&&surface.children[0].geometry;
    const g=shared||polishedShell(shape,true);append(g,i);if(!shared)g.dispose();
   }
   append(view.flatFloor,LIMIT);
   // Elastic dents can appear on the first impact. Reserve their bounded
   // triangle range up front so contact never switches shadow pipelines.
   this.patchIndex=indices.length;this.patchVertex=owners.length;this.patchVersion=-1;this.patchSource=null;
   for(let i=0;i<18*MAX_CUTS;i++){positions.push(0,0,0);owners.push(LIMIT+1);indices.push(this.patchVertex+i);}
   const u=view.groundMaterial.uniforms;
   Object.assign(this.material.uniforms,{cutCount:u.cutCount,cutCenters:u.cutCenters,cutBounds:u.cutBounds});
   const g=new T.InstancedBufferGeometry();g.instanceCount=6;
   g.setAttribute('position',new T.Float32BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));g.setAttribute('owner',new T.Float32BufferAttribute(owners,1));
   g.setIndex(indices);this.mesh=new T.Mesh(g,this.material);this.mesh.frustumCulled=false;
  }
  if(!this.mesh)return null;
  for(const [i,{object}] of solids.entries()){
   if(object.visible&&object.parent.visible)this.poses[i].copy(object.matrixWorld);else this.poses[i].elements.fill(0);
  }
  this.poses[LIMIT].copy(view.ground.matrixWorld);
  const patch=view.groundEdits.patch,count=patch.visible?patch.geometry.drawRange.count:0;
  if(count){
   const source=patch.geometry.getAttribute('position');
   if(this.patchSource!==source||this.patchVersion!==source.version){
    const dest=this.mesh.geometry.getAttribute('position'),start=3*this.patchVertex;
    dest.array.set(source.array.subarray(0,3*count),start);dest.clearUpdateRanges();dest.addUpdateRange(start,3*count);dest.needsUpdate=true;
    this.patchSource=source;this.patchVersion=source.version;
   }
  }
  this.mesh.geometry.setDrawRange(0,this.patchIndex+count);
  this.material.uniforms.skip.value=solids.findIndex(s=>s.object===emitter);
  this.material.uniforms.origin.value.copy(origin);
  this.material.uniformsNeedUpdate=true;
  return this.mesh;
 }
 dispose(){this.mesh?.geometry.dispose();this.material.dispose();}
}
