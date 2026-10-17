import * as THREE from 'three';
import {QUAD_VERTEX} from '../shaders.js';

export const MACRO_BLOCK=8;
export function macroLayout(dimensions,width,baseHeight){
 const size=dimensions.map(n=>Math.max(1,Math.ceil((n-1)/MACRO_BLOCK))),count=size[0]*size[1]*size[2];
 return {size,count,rows:Math.ceil(count/width),offset:baseHeight};
}
export function fillMacroCPU(data,l){
 const {dimensions:d,columns,width,macro:m}=l;
 for(let i=0;i<m.count;i++){
  const cx=i%m.size[0],cy=Math.floor(i/m.size[0])%m.size[1],cz=Math.floor(i/(m.size[0]*m.size[1]));let max=0;
  // Inclusive upper vertices cover every trilinear interpolation cell.
  for(let y=cy*8;y<=Math.min(d[1]-1,cy*8+8);y++)for(let z=cz*8;z<=Math.min(d[2]-1,cz*8+8);z++)for(let x=cx*8;x<=Math.min(d[0]-1,cx*8+8);x++){
   const px=y%columns*(d[0]+2)+1+x,py=Math.floor(y/columns)*(d[2]+2)+1+z;max=Math.max(max,data[(py*width+px)*4]);
  }data[(m.offset*width+i)*4]=max;
 }
 return data;
}
export const FIELD_SKIP_GLSL=`
uniform bool uFieldSkipping;uniform int uFieldMacroRow;
float fieldMacroMax(vec3 q){
 ivec3 size=ivec3(ceil((uFieldSize-1.)/8.)),cell=clamp(ivec3(floor(q/8.)),ivec3(0),size-1);
 int i=cell.x+size.x*(cell.y+size.y*cell.z),width=int(uFieldAtlas.x);
 return texelFetch(uLabField,ivec2(i%width,uFieldMacroRow+i/width),0).r;
}
float fieldEmptyAdvance(vec3 p,vec3 d,float threshold){
 if(!uFieldSkipping)return 0.;vec3 q=(p-uFieldOrigin)/uFieldDx;
 if(any(lessThan(q,vec3(0)))||any(greaterThanEqual(q,uFieldSize-1.))){
  vec3 inv=vec3(abs(d.x)>1e-9?1./d.x:1e20,abs(d.y)>1e-9?1./d.y:1e20,abs(d.z)>1e-9?1./d.z:1e20),a=(uFieldOrigin-p)*inv,b=(uFieldOrigin+(uFieldSize-1.)*uFieldDx-p)*inv;
  vec3 lo=min(a,b),hi=max(a,b);float near=max(lo.x,max(lo.y,lo.z)),far=min(hi.x,min(hi.y,hi.z));
  return far<max(0.,near)?1e4:max(0.,near)+uFieldDx*.00001;
 }
 if(fieldMacroMax(q)>=threshold)return 0.;
 vec3 cell=floor(q/8.),edge=uFieldOrigin+(cell+vec3(greaterThanEqual(d,vec3(0))))*(8.*uFieldDx);
 vec3 t=vec3(abs(d.x)>1e-9?(edge.x-p.x)/d.x:1e20,abs(d.y)>1e-9?(edge.y-p.y)/d.y:1e20,abs(d.z)>1e-9?(edge.z-p.z)/d.z:1e20);
 return max(0.,min(t.x,min(t.y,t.z)))+uFieldDx*.00001;
}
`;
const reduce=`precision highp float;precision highp int;
uniform sampler2D uSource;uniform ivec3 uSize,uMacroSize;uniform int uColumns,uWidth;out vec4 result;
void main(){int i=int(gl_FragCoord.x)+int(gl_FragCoord.y)*uWidth;result=vec4(0);if(i>=uMacroSize.x*uMacroSize.y*uMacroSize.z)return;
 ivec3 cell=ivec3(i%uMacroSize.x,(i/uMacroSize.x)%uMacroSize.y,i/(uMacroSize.x*uMacroSize.y))*8;
 for(int y=0;y<=8;y++)for(int z=0;z<=8;z++)for(int x=0;x<=8;x++){
  ivec3 q=cell+ivec3(x,y,z);if(any(greaterThanEqual(q,uSize)))continue;
  ivec2 pixel=ivec2(q.y%uColumns,q.y/uColumns)*(uSize.xz+2)+1+q.xz;
  result.r=max(result.r,texelFetch(uSource,pixel,0).r);
 }
}`;
export class FieldOccupancy {
 constructor(renderer){
  this.renderer=renderer;this.u={uSource:{value:null},uSize:{value:new Int32Array(3)},uMacroSize:{value:new Int32Array(3)},uColumns:{value:1},uWidth:{value:1}};
  this.geometry=new THREE.PlaneGeometry(2,2);this.camera=new THREE.Camera();this.scene=new THREE.Scene();
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:reduce,uniforms:this.u,depthTest:false,depthWrite:false});this.mesh=new THREE.Mesh(this.geometry,this.material);this.scene.add(this.mesh);
  this.copy=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:'precision highp float;uniform sampler2D uSource;in vec2 vUv;out vec4 result;void main(){result=texture(uSource,vUv);}',uniforms:{uSource:{value:null}},depthTest:false,depthWrite:false});
 }
 update(target,l){
  const r=this.renderer,previous=r.getRenderTarget(),viewport=r.getViewport(new THREE.Vector4()),scissor=r.getScissor(new THREE.Vector4()),test=r.getScissorTest();
  if(!this.target)this.target=new THREE.WebGLRenderTarget(l.width,l.macro.rows,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});else if(this.target.width!==l.width||this.target.height!==l.macro.rows)this.target.setSize(l.width,l.macro.rows);
  this.u.uSource.value=target.texture;this.u.uSize.value.set(l.dimensions);this.u.uMacroSize.value.set(l.macro.size);this.u.uColumns.value=l.columns;this.u.uWidth.value=l.width;
  r.setScissorTest(false);r.setRenderTarget(this.target);this.mesh.material=this.material;r.render(this.scene,this.camera);
  // Store the coarse grid at the bottom of the density atlas: no additional
  // sampler in already texture-heavy water/foam lighting programs.
  r.setRenderTarget(target);r.setViewport(0,l.macro.offset,l.width,l.macro.rows);r.setScissor(0,l.macro.offset,l.width,l.macro.rows);r.setScissorTest(true);
  this.copy.uniforms.uSource.value=this.target.texture;this.mesh.material=this.copy;r.render(this.scene,this.camera);
  r.setRenderTarget(previous);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(test);
 }
 dispose(){for(const x of [this.target,this.geometry,this.material,this.copy])x?.dispose();}
}
