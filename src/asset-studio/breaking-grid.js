import * as THREE from 'three';
import {breakerProfile,PROFILE_SIZE} from './breaking-wave.js';

const capacity=2048,subdivisions=8;
export const breakerVertex=/*glsl*/`
 attribute vec4 cellRect,cornerSpacing;
 uniform sampler2D breakProfile;
 uniform int crestCount;uniform vec4 crestPose[16],crestShape[16];uniform vec2 crestBend[16];
 varying vec2 referenceXZ;varying vec3 dxOffset,dzOffset;
 float cornerHeight(vec2 corner,float lod){return surfaceHeight(corner,lod);}
 void refineOcean(out vec3 surface){
  vec2 uv=position.xy,lo=cellRect.xy+modelMatrix[3].xz,hi=lo+cellRect.zw;
  referenceXZ=mix(lo,hi,uv);
  // Match the original two triangles exactly, including on unsubdivided edges.
  float a=cornerHeight(lo,cornerSpacing.x),b=cornerHeight(vec2(hi.x,lo.y),cornerSpacing.y);
  float c=cornerHeight(vec2(lo.x,hi.y),cornerSpacing.z),d=cornerHeight(hi,cornerSpacing.w);
  float base=uv.x+uv.y<=1.?a+(b-a)*uv.x+(c-a)*uv.y:d+(c-d)*(1.-uv.x)+(b-d)*(1.-uv.y);
  surface=vec3(referenceXZ.x,base,referenceXZ.y);dxOffset=vec3(0.);dzOffset=vec3(0.);
  for(int i=0;i<16;i++){
   if(i>=crestCount)break;
   vec4 pose=crestPose[i],shape=crestShape[i];
   vec2 direction=pose.zw,side=vec2(-direction.y,direction.x),p=referenceXZ-pose.xy;
   float s=dot(side,p)/shape.y;if(abs(s)>=1.)continue;
   float q=dot(direction,p)/shape.x-crestBend[i].x*s*s-s*shape.w;if(abs(q)>=1.)continue;
   float tap=(q+1.)*${(PROFILE_SIZE-1)/2}.;int j=int(tap);
   vec4 f=mix(texelFetch(breakProfile,ivec2(j,0),0),texelFetch(breakProfile,ivec2(j+1,0),0),fract(tap));
   float w=1.-s*s,peel=1.+crestBend[i].y*s,amp=shape.z*w*w*peel;
   vec2 ds=side/shape.y,dq=direction/shape.x-(2.*crestBend[i].x*s+shape.w)*ds;
   vec2 da=shape.z*w*(w*crestBend[i].y-4.*s*peel)*ds;
   vec2 pushD=shape.x*(f.x*da+amp*f.z*dq),liftD=shape.x*(f.y*da+amp*f.w*dq);
   surface+=shape.x*amp*vec3(direction.x*f.x,f.y,direction.y*f.x);
   dxOffset+=vec3(direction.x*pushD.x,liftD.x,direction.y*pushD.x);
   dzOffset+=vec3(direction.x*pushD.y,liftD.y,direction.y*pushD.y);
  }
 }`;

function cellAt(axis,x){
 let lo=0,hi=axis.length-1;
 while(hi-lo>1){const m=(hi+lo)>>1;if(axis[m]<=x)lo=m;else hi=m;}
 return lo;
}

// Replace whole ocean cells in place. Refinement changes sampling density only.
// Each selected cell is drawn once, even when several fronts cross inside it.
export class BreakingGrid {
 constructor(mesh){
  const base=this.base=mesh.geometry,cols=base.parameters.widthSegments;
  this.cols=cols;this.axis=Array.from({length:cols+1},(_,i)=>base.attributes.position.getX(i));
  this.original=base.index.array.slice();this.active=new Set();
  const geo=new THREE.InstancedBufferGeometry(),verts=[],indices=[];
  for(let z=0;z<=subdivisions;z++)for(let x=0;x<=subdivisions;x++){
   const i=verts.length/3;verts.push(x/subdivisions,z/subdivisions,0);
   if(x<subdivisions&&z<subdivisions)indices.push(i,i+subdivisions+1,i+1,i+subdivisions+1,i+subdivisions+2,i+1);
  }
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(indices);
  for(const name of ['cellRect','cornerSpacing'])geo.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(THREE.DynamicDrawUsage));
  const uniforms={...mesh.material.uniforms};
  this.profile=new THREE.DataTexture(breakerProfile,PROFILE_SIZE,1,THREE.RGBAFormat,THREE.FloatType);this.profile.needsUpdate=true;
  uniforms.breakProfile={value:this.profile};uniforms.crestCount={value:0};uniforms.crestBend={value:Array.from({length:16},()=>new THREE.Vector2())};
  for(const name of ['crestPose','crestShape'])uniforms[name]={value:Array.from({length:16},()=>new THREE.Vector4())};
  this.uniforms=uniforms;
  const mat=new THREE.ShaderMaterial({uniforms,side:THREE.DoubleSide,defines:{BREAKING_GRID:1},
   vertexShader:mesh.material.vertexShader,fragmentShader:mesh.material.fragmentShader});
  this.mesh=new THREE.Mesh(geo,mat);this.mesh.frustumCulled=false;this.mesh.visible=false;mesh.add(this.mesh);
 }
 update(sea,eye){
  const cells=new Set(),axis=this.axis,n=this.cols,u=this.uniforms;
  let count=0;
  for(const c of sea.crests){
   const {x,z,gain}=c.frame,reach=c.width*(1.02+Math.abs(c.curvature)+Math.abs(c.skew)),ex=Math.abs(c.dx)*reach+Math.abs(c.dz)*c.span,ez=Math.abs(c.dz)*reach+Math.abs(c.dx)*c.span;
   const cx=x-eye.x,cz=z-eye.z,minX=cellAt(axis,cx-ex),maxX=cellAt(axis,cx+ex),minZ=cellAt(axis,cz-ez),maxZ=cellAt(axis,cz+ez);
   const cellSize=Math.max(axis[maxX+1]-axis[maxX],axis[maxZ+1]-axis[maxZ],axis[minX+1]-axis[minX],axis[minZ+1]-axis[minZ]);
   const detail=THREE.MathUtils.smoothstep(c.width*subdivisions/cellSize,.35,1.4);
   if(!detail||!gain||cells.size+(maxX-minX+1)*(maxZ-minZ+1)>capacity)continue;
   u.crestBend.value[count].set(c.curvature,c.frame.peel);u.crestPose.value[count].set(x,z,c.dx,c.dz);u.crestShape.value[count++].set(c.width,c.span,gain*detail,c.skew);
   for(let j=minZ;j<=maxZ;j++)for(let i=minX;i<=maxX;i++)cells.add(j*n+i);
  }
  u.crestCount.value=count;this.mesh.geometry.instanceCount=cells.size;this.mesh.visible=!!count;
  const index=this.base.index,geo=this.mesh.geometry,spacing=this.base.attributes.spacing.array;
  let row=0,first=Infinity,last=-1;
  for(const cell of cells){
   if(!this.active.has(cell)){index.array.fill(0,cell*6,cell*6+6);first=Math.min(first,cell);last=Math.max(last,cell);}
   const i=cell%n,j=Math.floor(cell/n),v=i+(n+1)*j;
   geo.attributes.cellRect.setXYZW(row,axis[i],axis[j],axis[i+1]-axis[i],axis[j+1]-axis[j]);
   geo.attributes.cornerSpacing.setXYZW(row++,spacing[v],spacing[v+1],spacing[v+n+1],spacing[v+n+2]);
  }
  for(const cell of this.active)if(!cells.has(cell)){
   index.array.set(this.original.subarray(cell*6,cell*6+6),cell*6);first=Math.min(first,cell);last=Math.max(last,cell);
  }
  if(first<=last){index.addUpdateRange(first*6,(last-first+1)*6);index.needsUpdate=true;}
  if(row)for(const attr of [geo.attributes.cellRect,geo.attributes.cornerSpacing]){
   attr.clearUpdateRanges();attr.addUpdateRange(0,4*row);attr.needsUpdate=true;
  }
  this.active=cells;
 }
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();this.profile.dispose();}
}
