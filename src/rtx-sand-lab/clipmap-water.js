import * as THREE from 'three';
import {LabWaterField,LAB_FIELD_GLSL,fieldLayout} from '../sand-lab/water-lab-field.js';
import {QUAD_VERTEX} from '../shaders.js';

export function nearWindow(eye,spacing,bounds,cellLimit=30){
 const dx=spacing*.5,half=Math.min(Math.floor(3.4/dx),cellLimit)*dx,min=eye.map((v,k)=>bounds.min[k]+Math.floor((v-bounds.min[k])/dx)*dx-half);
 // Bias the inclusive bound below the last lattice point by a tiny
 // fraction of a cell so ceil() cannot add a spurious slice after a shift.
 return {min,max:min.map(v=>v+2*half-dx*1e-7),half};
}
export function nearWeight(point,eye,half){const d=Math.hypot(...point.map((v,k)=>v-eye[k]))/half,t=Math.max(0,Math.min(1,(d-.5)/.35));return 1-t*t*(3-2*t);}

// Both levels share one sampler. Fine samples are on the same world lattice
// after a window shift. Their weight is already zero well before that edge.
const extra=`uniform vec3 uNearOrigin,uNearSize,uDetailEye;uniform float uNearDx,uNearHalf;uniform int uNearColumns,uNearRow,uCoarseWidth;uniform bool uClipmapEnabled;\n`;
function releaseFieldTargets(field){for(const key of ['target','fallback']){field[key]?.dispose();field[key]=null;}field.occupancy?.target?.dispose();if(field.occupancy)field.occupancy.target=null;field.layoutKey=null;}
const base=LAB_FIELD_GLSL.replace('float fieldEmptyAdvance(', 'float coarseEmptyAdvance(').replace('int(uFieldAtlas.x)','uCoarseWidth').replace('vec4 parcelSample(', 'vec4 coarseSample(');
export const CLIPMAP_FIELD_GLSL=extra+base+`
vec4 nearSlice(vec3 q,int y){vec2 pixel=vec2(ivec2(y%uNearColumns,y/uNearColumns))*(uNearSize.xz+2.)+vec2(1.5)+q.xz+vec2(0.,float(uNearRow));if(uFieldLinear)return texture(uLabField,pixel/uFieldAtlas);vec2 f=fract(pixel-.5);ivec2 c=ivec2(floor(pixel-.5));return mix(mix(texelFetch(uLabField,c,0),texelFetch(uLabField,c+ivec2(1,0),0),f.x),mix(texelFetch(uLabField,c+ivec2(0,1),0),texelFetch(uLabField,c+ivec2(1,1),0),f.x),f.y);}
float detailWeight(vec3 p){return 1.-smoothstep(uNearHalf*.5,uNearHalf*.85,length(p-uDetailEye));}
float fieldDetailDx(vec3 p){return uClipmapEnabled?mix(uFieldDx,uNearDx,detailWeight(p)):uFieldDx;}
vec4 parcelSample(vec3 p){if(any(lessThan(p,uFieldOrigin))||any(greaterThan(p,uFieldOrigin+(uFieldSize-1.)*uFieldDx)))return vec4(0);vec4 coarse=coarseSample(p);if(!uClipmapEnabled)return coarse;float w=detailWeight(p);if(w<=0.)return coarse;vec3 q=(p-uNearOrigin)/uNearDx;if(any(lessThan(q,vec3(0)))||any(greaterThan(q,uNearSize-1.)))return coarse;int y=min(int(floor(q.y)),int(uNearSize.y)-2);return mix(coarse,mix(nearSlice(q,y),nearSlice(q,y+1),q.y-float(y)),w);}
float fieldEmptyAdvance(vec3 p,vec3 d,float threshold){float advance=coarseEmptyAdvance(p,d,threshold);if(!uClipmapEnabled||advance<=0.)return advance;
 vec3 inv=vec3(abs(d.x)>1e-9?1./d.x:1e20,abs(d.y)>1e-9?1./d.y:1e20,abs(d.z)>1e-9?1./d.z:1e20),a=(uDetailEye-vec3(uNearHalf*.86)-p)*inv,b=(uDetailEye+vec3(uNearHalf*.86)-p)*inv,lo=min(a,b),hi=max(a,b);float entry=max(lo.x,max(lo.y,lo.z)),leave=min(hi.x,min(hi.y,hi.z));if(leave>=max(0.,entry))advance=min(advance,max(0.,entry));return advance;}
`;

class WindowWaterField extends LabWaterField {
 setup(spacing,bounds){const l=fieldLayout(spacing,this.ratio,bounds);
  if(this.target?.width!==l.width||this.target?.height!==l.height)return super.setup(spacing,bounds);
  // Moving a window changes its origin, not its texture allocation or VAO.
  this.layout=l;this.spacing=spacing;this.u.uFieldOrigin.value.fromArray(l.min);this.u.uFieldSize.value.fromArray(l.dimensions);this.u.uFieldAtlas.value.set(l.width,l.height);this.u.uFieldDx.value=l.dx;this.u.uFieldColumns.value=l.columns;this.u.uFieldMacroRow.value=l.macro.offset;this.u.uFieldSkipping.value=this.emptySpace;return l;
 }
}

export class ClipmapWaterField {
 constructor(renderer,u,{nearCells=30}={}){
  this.nearCells=nearCells;
  this.renderer=renderer;this.coarse=new LabWaterField(renderer,{ratio:1});this.near=new WindowWaterField(renderer);this.reference=new LabWaterField(renderer);this.u=u||{};
  for(const [k,v] of Object.entries(this.coarse.u))this.u[k]??={value:v.value?.clone?v.value.clone():v.value};
  Object.assign(this.u,{uNearOrigin:{value:new THREE.Vector3()},uNearSize:{value:new THREE.Vector3(1,1,1)},uDetailEye:{value:new THREE.Vector3()},uNearDx:{value:1},uNearHalf:{value:1},uNearColumns:{value:1},uNearRow:{value:0},uCoarseWidth:{value:1},uClipmapEnabled:{value:false}});
  this.eye=[0,0,0];this.enabled=true;this.cpu=this.coarse.cpu;this.emptySpace=true;this.packedFields=true;
  this.copyMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:'precision highp float;uniform sampler2D uSource;uniform ivec2 uOffset;out vec4 result;void main(){result=texelFetch(uSource,ivec2(gl_FragCoord.xy)-uOffset,0);}',uniforms:{uSource:{value:null},uOffset:{value:new Int32Array(2)}},depthTest:false,depthWrite:false});
  this.copyGeometry=new THREE.PlaneGeometry(2,2);this.copyScene=new THREE.Scene();this.copyScene.add(new THREE.Mesh(this.copyGeometry,this.copyMaterial));
 }
 get scene(){return this.coarse.scene;}get camera(){return this.coarse.camera;}get target(){return this.active?.target||this.coarse.target;}
 get occupancy(){return this.coarse.occupancy;}set occupancy(v){this.coarse.occupancy=v;}
 setup(spacing,bounds,allocate=true){this.spacing=spacing;this.bounds=bounds||{min:[-6,-1,-5.5],max:[6,10,5.5]};this.layout=allocate?this.coarse.setup(spacing,this.bounds):fieldLayout(spacing,1,this.bounds);return this.layout;}
 copyUniforms(source){for(const [k,u] of Object.entries(source.u)){const dest=this.u[k];if(dest.value?.isVector2||dest.value?.isVector3)dest.value.copy(u.value);else dest.value=u.value;}}
 update(items,spacing,bounds){
  this.setup(spacing,bounds,false);this.items=items;
  const fineLayout=fieldLayout(spacing,.5,this.bounds),window=nearWindow(this.eye,spacing,this.bounds,this.nearCells),nearLayout=fieldLayout(spacing,.5,window);
  // Small fields and non-float devices keep the original reference path.
  const previousMode=this.useClipmap;
  const workTexels=this.layout.width*this.layout.height+nearLayout.width*nearLayout.height,atlasTexels=Math.max(this.layout.width,nearLayout.width)*(this.layout.height+nearLayout.height);
  this.useClipmap=this.enabled&&!this.cpu&&workTexels<fineLayout.width*fineLayout.height*.8&&workTexels+atlasTexels<fineLayout.width*fineLayout.height*.9;
  if(previousMode!==this.useClipmap){if(this.useClipmap)releaseFieldTargets(this.reference);else{releaseFieldTargets(this.coarse);releaseFieldTargets(this.near);this.atlas?.dispose();this.atlas=null;}}
  const active=this.active=this.useClipmap?this.coarse:this.reference;
  active.emptySpace=this.emptySpace;active.packedFields=this.packedFields;active.cpu=this.cpu;active.update(items,spacing,this.bounds);this.layout=active.layout;
  this.copyUniforms(active);this.u.uCoarseWidth.value=this.layout.width;
  this.u.uClipmapEnabled.value=this.useClipmap;
  if(this.useClipmap)this.updateNear(true);
  const texels=this.layout.width*this.layout.height+(this.useClipmap?this.near.layout.width*this.near.layout.height:0);
  this.stats={backend:this.cpu?'CPU reference':this.useClipmap?'GPU nested water fields':'GPU reference',referenceTexels:fineLayout.width*fineLayout.height,texels,allocatedTexels:texels+(this.useClipmap?this.atlas.width*this.atlas.height:0)};
 }
 setView(eye,enabled=true,defer=false){const changed=this.enabled!==enabled;this.enabled=enabled;this.eye=eye.slice();this.u.uDetailEye.value.fromArray(eye);if(defer)return;
  if(changed&&this.items)this.update(this.items,this.spacing,this.bounds);else if(this.useClipmap&&this.items)this.updateNear(false);
 }
 updateNear(force){const window=nearWindow(this.eye,this.spacing,this.bounds,this.nearCells),key=window.min.join();this.u.uNearHalf.value=window.half;
  if(!force&&key===this.nearKey)return;this.nearKey=key;
  // Cull reconstruction work by full covariance support, never particle center.
  const items=this.items.filter(p=>{const r=3*Math.max(.018,p.radius*.95)*Math.max(1,p.flatten??1);return p.position.every((v,k)=>v+r>=window.min[k]&&v-r<=window.max[k]);});
  this.near.emptySpace=false;this.near.packedFields=this.packedFields;this.near.update(items,this.spacing,window);
  const l=this.near.layout,c=this.coarse.layout,width=Math.max(c.width,l.width),height=c.height+l.height;
  const resized=!this.atlas||this.atlas.width!==width||this.atlas.height!==height;
  if(!this.atlas)this.atlas=new THREE.WebGLRenderTarget(width,height,{type:THREE.FloatType,depthBuffer:false,minFilter:this.coarse.linear?THREE.LinearFilter:THREE.NearestFilter,magFilter:this.coarse.linear?THREE.LinearFilter:THREE.NearestFilter});else if(this.atlas.width!==width||this.atlas.height!==height)this.atlas.setSize(width,height);
  const r=this.renderer,target=r.getRenderTarget(),viewport=r.getViewport(new THREE.Vector4()),scissor=r.getScissor(new THREE.Vector4()),test=r.getScissorTest(),auto=r.autoClear;r.autoClear=false;r.setRenderTarget(this.atlas);r.setScissorTest(true);
  try{for(const [field,row] of force||resized?[[this.coarse,0],[this.near,c.height]]:[[this.near,c.height]]){r.setViewport(0,row,field.layout.width,field.layout.height);r.setScissor(0,row,field.layout.width,field.layout.height);this.copyMaterial.uniforms.uSource.value=field.target.texture;this.copyMaterial.uniforms.uOffset.value.set([0,row]);r.render(this.copyScene,this.camera);}}
  finally{r.setRenderTarget(target);r.setViewport(viewport);r.setScissor(scissor);r.setScissorTest(test);r.autoClear=auto;}
  this.u.uLabField.value=this.atlas.texture;this.u.uFieldAtlas.value.set(width,height);this.u.uNearOrigin.value.fromArray(l.min);this.u.uNearSize.value.fromArray(l.dimensions);this.u.uNearDx.value=l.dx;this.u.uNearColumns.value=l.columns;this.u.uNearRow.value=c.height;
 }
 get lightingField(){return this.active||this.coarse;}
 dispose(){for(const x of [this.coarse,this.near,this.reference,this.atlas,this.copyGeometry,this.copyMaterial])x?.dispose();}
}
