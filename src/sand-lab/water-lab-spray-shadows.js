import {detailOpacity,DETAIL_OPACITY_GLSL,detailDisplayRadius,DETAIL_RADIUS_GLSL} from './water-lab-detail-opacity.js';
import * as THREE from 'three';
import {LAB_FIELD_MIN,LAB_FIELD_MAX} from './water-lab-field.js';

export const SHADOW_MARKER_BUDGET=16384;
export const shadowStride=span=>2**Math.max(0,Math.ceil(Math.log2(Math.max(1,span)/SHADOW_MARKER_BUDGET)));
export const SPRAY_SHADOW_SIZE=256,SPRAY_SHADOW_LAYERS=16;
const normalize=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);},dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
export const SPRAY_LIGHT=normalize([-.4,1,.3]);
const U=normalize([SPRAY_LIGHT[1],-SPRAY_LIGHT[0],0]);
const V=[SPRAY_LIGHT[1]*U[2]-SPRAY_LIGHT[2]*U[1],SPRAY_LIGHT[2]*U[0]-SPRAY_LIGHT[0]*U[2],SPRAY_LIGHT[0]*U[1]-SPRAY_LIGHT[1]*U[0]];
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
// Compact approximation to the normal CDF along the incoming light ray.
export const sprayCDF=x=>smooth(-3,3,x*1.5);
export function sprayShadowLayout(bounds={min:LAB_FIELD_MIN,max:LAB_FIELD_MAX},size=SPRAY_SHADOW_SIZE,light=SPRAY_LIGHT){const U=normalize([light[1],-light[0],0]),V=[light[1]*U[2]-light[2]*U[1],light[2]*U[0]-light[0]*U[2],light[0]*U[1]-light[1]*U[0]];
 const min=[Infinity,Infinity,Infinity],max=min.map(()=>-Infinity);
 for(let corner=0;corner<8;corner++){const p=bounds.min.map((v,k)=>((corner>>k)&1)?bounds.max[k]+.5:v-.5);[U,V,light].forEach((axis,k)=>{const q=dot(p,axis);min[k]=Math.min(min[k],q);max[k]=Math.max(max[k],q);});}
 return {axes:[U,V,light],min,max,span:max.map((v,k)=>v-min[k]),size};
}
// CPU reference uses the same anisotropic covariance, optical depth, life fade,
// depth planes and footprint filtering as the GPU deep-opacity map.
export function sprayShadowKernel(position,velocity,info,layout){
 const age=position[3],life=velocity[3];if(life<=0||age>=life||info[0]<=0)return null;
 const s=detailDisplayRadius(info[0],info[1])*(.75+.25*Math.sin(Math.min(1,age/life)*Math.PI)),stretch=info[1]<.5?1.2:0,d=normalize([velocity[0],velocity[1]+1e-8,velocity[2]]),axes=layout.axes||[U,V,SPRAY_LIGHT],axis=axes.map(a=>dot(a,d)),up=axes.map(a=>a[1]),flatten=info[2]<0&&info[1]>2.5?1-.52**2:0;
 const a=s*s*(1+stretch*axis[0]**2-flatten*up[0]**2),b=s*s*(stretch*axis[0]*axis[1]-flatten*up[0]*up[1]),c=s*s*(1+stretch*axis[1]**2-flatten*up[1]**2),xx=a+(layout.span[0]/layout.size*.6)**2,yy=c+(layout.span[1]/layout.size*.6)**2,det=xx*yy-b*b;
 const cross=[s*s*(stretch*axis[0]*axis[2]-flatten*up[0]*up[2]),s*s*(stretch*axis[1]*axis[2]-flatten*up[1]*up[2])],coupling=[(cross[0]*yy-cross[1]*b)/det,(cross[1]*xx-cross[0]*b)/det];
 const sigma=Math.sqrt(Math.max(1e-12,s*s*(1+stretch*axis[2]**2-flatten*up[2]**2)-dot(cross,coupling))),opacity=Math.min(.98,detailOpacity(info[1],age,life,info[2]));
 return {center:axes.map(a=>dot(a,position)),xx,xy:b,yy,det,coupling,sigma,tau:-Math.log(1-opacity)*Math.sqrt((a*c-b*b)/det)};
}
export function sprayOpticalDepth(kernel,x,y,depth){
 const q=[x-kernel.center[0],y-kernel.center[1]],r2=(q[0]*q[0]*kernel.yy-2*q[0]*q[1]*kernel.xy+q[1]*q[1]*kernel.xx)/kernel.det;
 if(r2>9)return 0;
 return kernel.tau*Math.exp(-.5*r2)*sprayCDF((kernel.center[2]+dot(kernel.coupling,q)-depth)/kernel.sigma);
}
export const SPRAY_SHADOW_GLSL=`
uniform bool uSprayShadows;uniform highp sampler2D uSprayShadow0,uSprayShadow1,uSprayShadow2,uSprayShadow3;
uniform vec3 uSprayU,uSprayV,uSprayL,uSprayMin,uSpraySpan;
float sprayDepthAt(vec2 uv,int layer){vec4 a;if(layer<4)a=texture(uSprayShadow0,uv);else if(layer<8)a=texture(uSprayShadow1,uv);else if(layer<12)a=texture(uSprayShadow2,uv);else a=texture(uSprayShadow3,uv);return a[layer%4];}
float spraySun(vec3 p){
 if(!uSprayShadows)return 1.;vec3 q=(vec3(dot(p,uSprayU),dot(p,uSprayV),dot(p,uSprayL))-uSprayMin)/uSpraySpan;
 if(any(lessThan(q.xy,vec2(0)))||any(greaterThan(q.xy,vec2(1)))||q.z>=1.)return 1.;
 float z=clamp(q.z,0.,1.)*15.;int lo=int(floor(z));float tau=mix(sprayDepthAt(q.xy,lo),sprayDepthAt(q.xy,min(lo+1,15)),fract(z));return exp(-max(0.,tau));
}
`;
const vertex=`precision highp float;precision highp int;
${DETAIL_OPACITY_GLSL}${DETAIL_RADIUS_GLSL}
uniform highp sampler2D uDetailP,uDetailV,uDetailI;uniform vec3 uSprayU,uSprayV,uSprayL,uSprayMin,uSpraySpan;uniform float uShadowSize;uniform int uShadowStride,uActiveSpan;
out vec2 vDelta;flat out vec3 vInverse;flat out vec2 vCoupling;flat out float vSigma,vDepth,vTau;
void main(){int id=gl_InstanceID*uShadowStride;ivec2 uv=ivec2(id%256,id/256);vec4 p=texelFetch(uDetailP,uv,0),v=texelFetch(uDetailV,uv,0),info=texelFetch(uDetailI,uv,0);gl_Position=vec4(2,2,2,1);vTau=0.;if(v.w<=0.||p.w>=v.w||info.x<=0.)return;
 float s=detailDisplayRadius(info.x,info.y)*(.75+.25*sin(min(1.,p.w/v.w)*3.14159265359)),stretch=info.y<.5?1.2:0.;vec3 direction=normalize(v.xyz+vec3(0,1e-8,0)),d=vec3(dot(direction,uSprayU),dot(direction,uSprayV),dot(direction,uSprayL));
 vec3 up=vec3(uSprayU.y,uSprayV.y,uSprayL.y);float flatten=info.z<0.&&info.y>2.5?1.-.52*.52:0.;
 float a=s*s*(1.+stretch*d.x*d.x-flatten*up.x*up.x),b=s*s*(stretch*d.x*d.y-flatten*up.x*up.y),c=s*s*(1.+stretch*d.y*d.y-flatten*up.y*up.y),xx=a+pow(uSpraySpan.x/uShadowSize*.6,2.),yy=c+pow(uSpraySpan.y/uShadowSize*.6,2.),det=xx*yy-b*b;
 vInverse=vec3(yy,-b,xx)/det;vec2 crossDepth=s*s*(stretch*d.xy*d.z-flatten*up.xy*up.z);vCoupling=vec2(dot(crossDepth,vInverse.xy),dot(crossDepth,vInverse.yz));vSigma=sqrt(max(1e-12,s*s*(1.+stretch*d.z*d.z-flatten*up.z*up.z)-dot(crossDepth,vCoupling)));
 vec3 center=vec3(dot(p.xyz,uSprayU),dot(p.xyz,uSprayV),dot(p.xyz,uSprayL));vDepth=center.z;
 float opacity=min(.98,detailOpacity(info.y,p.w,v.w,info.z));vTau=-log(1.-opacity)*sqrt((a*c-b*b)/det)*float(min(uShadowStride,uActiveSpan-id));
 // Cholesky projects the full covariance onto the light plane without a camera.
 float sx=sqrt(xx);vDelta=vec2(sx*position.x,b/sx*position.x+sqrt(det/xx)*position.y)*3.;vec2 q=(center.xy+vDelta-uSprayMin.xy)/uSpraySpan.xy;gl_Position=vec4(q*2.-1.,0,1);
}`;
const fragment=`precision highp float;in vec2 vDelta;flat in vec3 vInverse;flat in vec2 vCoupling;flat in float vSigma,vDepth,vTau;uniform vec3 uSprayMin,uSpraySpan;
layout(location=0)out vec4 depth0;layout(location=1)out vec4 depth1;layout(location=2)out vec4 depth2;layout(location=3)out vec4 depth3;
float layer(float i,float tau){float d=uSprayMin.z+uSpraySpan.z*i/15.;return tau*smoothstep(-3.,3.,(vDepth+dot(vCoupling,vDelta)-d)/vSigma*1.5);}
void main(){float r2=vDelta.x*vDelta.x*vInverse.x+2.*vDelta.x*vDelta.y*vInverse.y+vDelta.y*vDelta.y*vInverse.z;if(r2>9.||vTau<=0.)discard;float tau=vTau*exp(-.5*r2);depth0=vec4(layer(0.,tau),layer(1.,tau),layer(2.,tau),layer(3.,tau));depth1=vec4(layer(4.,tau),layer(5.,tau),layer(6.,tau),layer(7.,tau));depth2=vec4(layer(8.,tau),layer(9.,tau),layer(10.,tau),layer(11.,tau));depth3=vec4(layer(12.,tau),layer(13.,tau),layer(14.,tau),layer(15.,tau));}`;
export class LabSprayShadows{
 constructor(renderer,lab,size=SPRAY_SHADOW_SIZE,light=SPRAY_LIGHT){const U=normalize([light[1],-light[0],0]),V=[light[1]*U[2]-light[2]*U[1],light[2]*U[0]-light[0]*U[2],light[0]*U[1]-light[1]*U[0]];
  this.renderer=renderer;this.lab=lab;this.size=size;this.enabled=true;this.cpu=!renderer.extensions.has('EXT_color_buffer_float');
  this.u={uSprayShadows:{value:false},uSprayU:{value:new THREE.Vector3(...U)},uSprayV:{value:new THREE.Vector3(...V)},uSprayL:{value:new THREE.Vector3(...SPRAY_LIGHT)},uSprayMin:{value:new THREE.Vector3()},uSpraySpan:{value:new THREE.Vector3()}};
  this.target=new THREE.WebGLRenderTarget(size,size,{count:4,type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  for(let i=0;i<4;i++)this.u['uSprayShadow'+i]={value:this.target.textures[i]};
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:{...this.u,uShadowStride:{value:1},uActiveSpan:{value:lab.detail.capacity},uShadowSize:{value:size},uDetailP:lab.detail.u.uDetailP,uDetailV:lab.detail.u.uDetailV,uDetailI:lab.detail.u.uDetailI},depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
  this.geometry=new THREE.InstancedBufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);this.geometry.instanceCount=lab.detail.capacity;
  const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene=new THREE.Scene();this.scene.add(mesh);this.camera=new THREE.Camera();
 }
 update(){
  const {lab}=this,d=lab.detail;const span=d.activeSpan||d.capacity,stride=shadowStride(span);this.geometry.instanceCount=Math.ceil(span/stride);this.material.uniforms.uShadowStride.value=stride;this.material.uniforms.uActiveSpan.value=span;this.u.uSprayShadows.value=this.enabled&&d.enabled&&d.count>0;if(!this.u.uSprayShadows.value)return false;
  const key=[lab.kind,d.time,d.count,lab.revision,lab.day].join();if(this.key===key)return false;this.key=key;
  const layout=this.layout=sprayShadowLayout(lab.fieldBounds,this.size,lab.u.uDaySun.value.toArray());[this.u.uSprayU,this.u.uSprayV,this.u.uSprayL].forEach((u,i)=>u.value.fromArray(layout.axes[i]));this.u.uSprayMin.value.fromArray(layout.min);this.u.uSpraySpan.value.fromArray(layout.span);
  if(this.cpu){this.updateCPU();return true;}
  for(let i=0;i<4;i++)this.u['uSprayShadow'+i].value=this.target.textures[i];
  const r=this.renderer,old=r.getRenderTarget(),color=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();r.setRenderTarget(this.target);r.setClearColor(0,0);r.clear();r.render(this.scene,this.camera);r.setRenderTarget(old);r.setClearColor(color,alpha);return true;
 }
 updateCPU(){
  const l=this.layout,size=this.size,d=this.lab.detail,[p,v,info]=d.fallback.map(t=>t.image.data),data=Array.from({length:4},()=>new Float32Array(size*size*4));
  const span=d.activeSpan||d.capacity,stride=shadowStride(span);for(let i=0;i<span;i+=stride){const o=i*4,k=sprayShadowKernel(p.subarray(o,o+4),v.subarray(o,o+4),info.subarray(o,o+4),l);if(!k)continue;k.tau*=Math.min(stride,span-i);const rx=3*Math.sqrt(k.xx),ry=3*Math.sqrt(k.yy),lo=[rx,ry].map((r,a)=>Math.max(0,Math.floor((k.center[a]-r-l.min[a])/l.span[a]*size))),hi=[rx,ry].map((r,a)=>Math.min(size-1,Math.ceil((k.center[a]+r-l.min[a])/l.span[a]*size)));
   for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)for(let z=0;z<16;z++)data[z>>2][(y*size+x)*4+z%4]+=sprayOpticalDepth(k,l.min[0]+(x+.5)/size*l.span[0],l.min[1]+(y+.5)/size*l.span[1],l.min[2]+z/15*l.span[2]);
  }
  if(!this.fallback)this.fallback=data.map(a=>{const t=new THREE.DataTexture(a,size,size,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=this.renderer.extensions.has('OES_texture_float_linear')?THREE.LinearFilter:THREE.NearestFilter;return t;});
  this.fallback.forEach((t,i)=>{t.image.data.set(data[i]);t.needsUpdate=true;this.u['uSprayShadow'+i].value=t;});
 }
 dispose(){for(const t of [this.target,this.material,this.geometry,...(this.fallback||[])])t.dispose();}
}
