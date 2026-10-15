import * as THREE from 'three';
import {clamp} from './water-lab-model.js';

// Two representative IDs per world-space cell, then exact distance checks.
// This bounded approximation can miss a neighbor in a very crowded cell, but
// cannot count a distant particle as touching. It never depends on the camera.
export const FOAM_GRID=[64,48,64];
export function foamDecay(kind,wet,contact=false){return kind===3?1:wet?(contact?.025:.12):2.2;}
export function foamContactRadius(spacing,a,b){return Math.max(spacing*.22,3*(a+b));}
export function foamCell(p,min,extent){return p.map((v,k)=>clamp(Math.floor((v-min[k])/extent[k]*FOAM_GRID[k]),0,FOAM_GRID[k]-1));}
export const FOAM_CONTACT_GLSL=`
uniform highp sampler2D uFoamContact;uniform vec3 uFoamMin,uFoamExtent;uniform bool uFoamContactEnabled;
ivec3 foamCell(vec3 p){return clamp(ivec3(floor((p-uFoamMin)/uFoamExtent*vec3(64,48,64))),ivec3(0),ivec3(63,47,63));}
bool foamTouch(vec3 p,float radius,int self){if(!uFoamContactEnabled)return false;ivec3 base=foamCell(p);
 for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ivec3 c=base+ivec3(x,y,z);if(any(lessThan(c,ivec3(0)))||any(greaterThan(c,ivec3(63,47,63))))continue;
 vec2 ids=texelFetch(uFoamContact,ivec2(c.x+c.z*64,c.y),0).rg;
 for(int j=0;j<2;j++){int id=j==0?int(ids.x)-1:uCapacity-int(ids.y);if(ids[j]<.5||id==self||id<0||id>=uCapacity)continue;ivec2 uv=ivec2(id%256,id/256);vec4 q=texelFetch(uDetailP,uv,0),v=texelFetch(uDetailV,uv,0),info=texelFetch(uDetailI,uv,0);float reach=max(uDetailSpacing*.22,3.*(radius+info.x));if(q.w<v.w&&distance(p,q.xyz)<reach)return true;}}
 return false;}
float foamDecay(float kind,bool wet,bool touching){return kind>2.5?1.:wet?(touching?.025:.12):2.2;}
`;
export class FoamContactField {
 constructor(renderer,detail){this.renderer=renderer;this.detail=detail;this.u={uFoamContact:{value:detail.fallback[0]},uFoamMin:{value:new THREE.Vector3(-6,-1,-6)},uFoamExtent:{value:new THREE.Vector3(12,11,12)},uFoamContactEnabled:{value:false}};
 this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0],3));
 this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{...detail.u,...this.u},vertexShader:`precision highp float;precision highp int;uniform sampler2D uDetailP,uDetailV,uDetailI;uniform vec3 uFoamMin,uFoamExtent;uniform int uCapacity;flat out vec2 vIds;
 void main(){int id=gl_VertexID;ivec2 uv=ivec2(id%256,id/256);vec4 p=texelFetch(uDetailP,uv,0),v=texelFetch(uDetailV,uv,0),info=texelFetch(uDetailI,uv,0);ivec3 c=clamp(ivec3(floor((p.xyz-uFoamMin)/uFoamExtent*vec3(64,48,64))),ivec3(0),ivec3(63,47,63));vec2 pixel=vec2(c.x+c.z*64,c.y);gl_Position=vec4((pixel+.5)/vec2(4096,48)*2.-1.,0,1);gl_PointSize=1.;vIds=vec2(float(id+1),float(uCapacity-id));if(p.w>=v.w||info.y<.5||info.y>2.5)gl_Position=vec4(2,2,0,1);}`,
 fragmentShader:'precision highp float;flat in vec2 vIds;out vec4 outColor;void main(){outColor=vec4(vIds,0,0);}',depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendEquation:THREE.MaxEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
 // Vertex IDs address texture particles; no per-frame vertex upload.
 this.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(detail.capacity*3),3));this.scene=new THREE.Scene();const points=new THREE.Points(this.geometry,this.material);points.frustumCulled=false;this.scene.add(points);this.camera=new THREE.Camera();
 }
 update(lab,cpu){this.u.uFoamMin.value.set(-6,-1,lab.kind==='river'?-20:-6);this.u.uFoamExtent.value.set(12,14,lab.kind==='river'?40:12);this.u.uFoamContactEnabled.value=!!lab.count;this.spacing=lab.spacing;this.min=this.u.uFoamMin.value.toArray();this.extent=this.u.uFoamExtent.value.toArray();if(!lab.count)return;
 const d=this.detail;
 if(cpu){this.cells=new Map();const [p,v,info]=d.fallback.map(t=>t.image.data);for(let i=0;i<d.activeSpan;i++){const o=i*4;if(p[o+3]>=v[o+3]||info[o+1]<.5||info[o+1]>2.5)continue;const key=foamCell(p.subarray(o,o+3),this.min,this.extent).join(','),ids=this.cells.get(key);if(ids)ids[1]=i;else this.cells.set(key,[i,i]);}this.previous=d.fallback.map(t=>t.image.data.slice());return;}
 if(!this.target)this.target=new THREE.WebGLRenderTarget(4096,48,{type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
 const r=this.renderer,old=r.getRenderTarget(),color=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();this.geometry.setDrawRange(0,d.activeSpan);r.setRenderTarget(this.target);r.setClearColor(0,0);r.clear();r.render(this.scene,this.camera);r.setRenderTarget(old);r.setClearColor(color,alpha);this.u.uFoamContact.value=this.target.texture;
 }
 touching(p,radius,self){if(!this.cells)return false;const base=foamCell(p,this.min,this.extent),[positions,velocities,info]=this.previous;for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const id of this.cells.get([base[0]+x,base[1]+y,base[2]+z].join(','))||[]){if(id===self)continue;const o=id*4;if(positions[o+3]<velocities[o+3]&&Math.hypot(...p.map((v,k)=>v-positions[o+k]))<foamContactRadius(this.spacing,radius,info[o]))return true;}return false;}
 dispose(){this.target?.dispose();this.geometry.dispose();this.material.dispose();}
}
