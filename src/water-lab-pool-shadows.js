import * as THREE from 'three';
import {sprayCDF} from './water-lab-spray-shadows.js';

// Wall-mounted lights emit into the pool's forward hemisphere. A paraboloid
// covers its full 180 degrees without cube-face seams or a perspective cutoff.
// Three tiles share four MRTs / sixteen radial planes, independent of camera.
export const POOL_SHADOW_SIZE=128,POOL_SHADOW_FAR=16;
export const poolLamp=i=>[(i-1)*2.7,.65,-2.75];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function poolShadowKernel(p,v,info,lamp,size=POOL_SHADOW_SIZE){
 if(v[3]<=0||p[3]>=v[3]||info[0]<=0)return null;
 const q=poolLamp(lamp).map((x,k)=>p[k]-x),r=Math.hypot(...q),s=info[0]*(.75+.25*Math.sin(Math.min(1,p[3]/v[3])*Math.PI));if(q[2]<-3*s||r<.03)return null;
 const radial=q.map(x=>x/r),w=Math.max(.001,r+q[2]),j=[0,1].map(a=>q.map((x,k)=>(k===a?1/w:0)-q[a]/(w*w)*(radial[k]+(k===2?1:0)))),direction=[v[0],v[1]+1e-8,v[2]],speed=Math.hypot(...direction),d=direction.map(x=>x/speed),stretch=info[1]<.5?1.2:0;
 const cov=(a,b)=>s*s*(dot(a,b)+stretch*dot(a,d)*dot(b,d)),a=cov(j[0],j[0]),b=cov(j[0],j[1]),c=cov(j[1],j[1]),xx=a+(1.2/size)**2,yy=c+(1.2/size)**2,det=xx*yy-b*b,cross=j.map(axis=>cov(axis,radial)),coupling=[(cross[0]*yy-cross[1]*b)/det,(cross[1]*xx-cross[0]*b)/det];
 const opacity=Math.min(.98,info[2]*smooth(0,.045,p[3])*(1-smooth(.45,1,p[3]/v[3]))*(info[1]>2.5?.7:info[1]>1.5?.5:1));
 return {center:[q[0]/w,q[1]/w,r],xx,xy:b,yy,det,coupling,sigma:Math.sqrt(Math.max(1e-12,cov(radial,radial)-dot(cross,coupling))),tau:-Math.log(1-opacity)*Math.sqrt(Math.max(0,a*c-b*b)/det)};
}
export function poolOpticalDepth(k,x,y,depth){
 if(x*x+y*y>1)return 0;const q=[x-k.center[0],y-k.center[1]],r2=(q[0]*q[0]*k.yy-2*q[0]*q[1]*k.xy+q[1]*q[1]*k.xx)/k.det;
 return r2>9?0:k.tau*Math.exp(-.5*r2)*sprayCDF((depth-k.center[2]-dot(k.coupling,q))/k.sigma);
}
export const POOL_SHADOW_GLSL=`
uniform bool uPoolShadows;uniform highp sampler2D uPoolShadow0,uPoolShadow1,uPoolShadow2,uPoolShadow3;uniform float uPoolShadowSize;
vec3 poolLamp(int i){return vec3(float(i-1)*2.7,.65,-2.75);}
vec3 poolColor(int i){return i==0?vec3(4.,.12,.08):i==1?vec3(.1,3.,.5):vec3(.15,.3,5.);}
float poolDepthAt(vec2 uv,int layer){vec4 a;if(layer<4)a=texture(uPoolShadow0,uv);else if(layer<8)a=texture(uPoolShadow1,uv);else if(layer<12)a=texture(uPoolShadow2,uv);else a=texture(uPoolShadow3,uv);return a[layer%4];}
float sprayPool(vec3 p,int lamp){
 vec3 q=p-poolLamp(lamp);if(q.z<0.)return 0.;if(!uPoolShadows)return 1.;float r=length(q);if(r<.03)return 1.;vec2 xy=q.xy/(r+q.z),uv=clamp(xy*.5+.5,vec2(.5/uPoolShadowSize),vec2(1.-.5/uPoolShadowSize));uv.x=(uv.x+float(lamp))/3.;
 float z=sqrt(clamp(r/16.,0.,1.))*15.;int lo=int(floor(z));float tau=mix(poolDepthAt(uv,lo),poolDepthAt(uv,min(lo+1,15)),fract(z));return exp(-max(0.,tau));
}
`;
const vertex=`precision highp float;precision highp int;
uniform highp sampler2D uDetailP,uDetailV,uDetailI;uniform int uCapacity;uniform float uPoolShadowSize;
out vec2 vDelta,vPoint;flat out vec3 vInverse;flat out vec2 vCoupling;flat out float vSigma,vDepth,vTau;flat out int vLamp;
void main(){vLamp=gl_InstanceID/uCapacity;int id=gl_InstanceID%uCapacity;ivec2 uv=ivec2(id%256,id/256);vec4 p=texelFetch(uDetailP,uv,0),v=texelFetch(uDetailV,uv,0),info=texelFetch(uDetailI,uv,0);gl_Position=vec4(2,2,2,1);vTau=0.;if(v.w<=0.||p.w>=v.w||info.x<=0.)return;
 float s=info.x*(.75+.25*sin(min(1.,p.w/v.w)*3.14159265359)),stretch=info.y<.5?1.2:0.;vec3 q=p.xyz-vec3(float(vLamp-1)*2.7,.65,-2.75);float r=length(q);if(q.z < -3.*s||r<.03)return;vec3 radial=q/r,d=normalize(v.xyz+vec3(0,1e-8,0));float w=max(.001,r+q.z);
 vec3 jx=vec3(1,0,0)/w-q.x/(w*w)*(radial+vec3(0,0,1)),jy=vec3(0,1,0)/w-q.y/(w*w)*(radial+vec3(0,0,1));
 float a=s*s*(dot(jx,jx)+stretch*pow(dot(jx,d),2.)),b=s*s*(dot(jx,jy)+stretch*dot(jx,d)*dot(jy,d)),c=s*s*(dot(jy,jy)+stretch*pow(dot(jy,d),2.)),xx=a+pow(1.2/uPoolShadowSize,2.),yy=c+pow(1.2/uPoolShadowSize,2.),det=xx*yy-b*b;
 vInverse=vec3(yy,-b,xx)/det;vec2 crossDepth=s*s*(vec2(dot(jx,radial),dot(jy,radial))+stretch*vec2(dot(jx,d),dot(jy,d))*dot(radial,d));vCoupling=vec2(dot(crossDepth,vInverse.xy),dot(crossDepth,vInverse.yz));vSigma=sqrt(max(1e-12,s*s*(1.+stretch*pow(dot(radial,d),2.))-dot(crossDepth,vCoupling)));vDepth=r;
 float opacity=min(.98,info.z*smoothstep(0.,.045,p.w)*(1.-smoothstep(.45,1.,p.w/v.w))*(info.y>2.5?.7:info.y>1.5?.5:1.));vTau=-log(1.-opacity)*sqrt(max(0.,a*c-b*b)/det);
 float sx=sqrt(xx);vDelta=vec2(sx*position.x,b/sx*position.x+sqrt(det/xx)*position.y)*3.;vPoint=q.xy/w+vDelta;gl_Position=vec4((vPoint.x+1.+float(vLamp)*2.)/3.-1.,vPoint.y,0,1);
}`;
const fragment=`precision highp float;precision highp int;in vec2 vDelta,vPoint;flat in vec3 vInverse;flat in vec2 vCoupling;flat in float vSigma,vDepth,vTau;flat in int vLamp;uniform float uPoolShadowSize;
layout(location=0)out vec4 depth0;layout(location=1)out vec4 depth1;layout(location=2)out vec4 depth2;layout(location=3)out vec4 depth3;
float layer(float i,float tau){float depth=16.*pow(i/15.,2.);return tau*smoothstep(-3.,3.,(depth-vDepth-dot(vCoupling,vDelta))/vSigma*1.5);}
void main(){if(int(gl_FragCoord.x/uPoolShadowSize)!=vLamp||dot(vPoint,vPoint)>1.)discard;float r2=vDelta.x*vDelta.x*vInverse.x+2.*vDelta.x*vDelta.y*vInverse.y+vDelta.y*vDelta.y*vInverse.z;if(r2>9.||vTau<=0.)discard;float tau=vTau*exp(-.5*r2);depth0=vec4(layer(0.,tau),layer(1.,tau),layer(2.,tau),layer(3.,tau));depth1=vec4(layer(4.,tau),layer(5.,tau),layer(6.,tau),layer(7.,tau));depth2=vec4(layer(8.,tau),layer(9.,tau),layer(10.,tau),layer(11.,tau));depth3=vec4(layer(12.,tau),layer(13.,tau),layer(14.,tau),layer(15.,tau));}`;
export class LabPoolShadows{
 constructor(renderer,lab,size=POOL_SHADOW_SIZE){
  this.renderer=renderer;this.lab=lab;this.size=size;this.enabled=true;this.cpu=!renderer.extensions.has('EXT_color_buffer_float');this.u={uPoolShadows:{value:false},uPoolShadowSize:{value:size}};
  this.target=new THREE.WebGLRenderTarget(size*3,size,{count:4,type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});for(let i=0;i<4;i++)this.u['uPoolShadow'+i]={value:this.target.textures[i]};
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:{...this.u,uCapacity:{value:lab.detail.capacity},uDetailP:lab.detail.u.uDetailP,uDetailV:lab.detail.u.uDetailV,uDetailI:lab.detail.u.uDetailI},depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
  this.geometry=new THREE.InstancedBufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);this.geometry.instanceCount=lab.detail.capacity*3;const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene=new THREE.Scene();this.scene.add(mesh);this.camera=new THREE.Camera();
 }
 update(){
  const {lab}=this,d=lab.detail;this.u.uPoolShadows.value=this.enabled&&lab.kind==='pool'&&lab.lights>0&&d.enabled&&d.count>0;if(!this.u.uPoolShadows.value)return false;
  const key=[lab.kind,d.time,d.count,lab.revision].join();if(this.key===key)return false;this.key=key;if(this.cpu){this.updateCPU();return true;}
  for(let i=0;i<4;i++)this.u['uPoolShadow'+i].value=this.target.textures[i];const r=this.renderer,old=r.getRenderTarget(),color=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha();r.setRenderTarget(this.target);r.setClearColor(0,0);r.clear();r.render(this.scene,this.camera);r.setRenderTarget(old);r.setClearColor(color,alpha);return true;
 }
 updateCPU(){
  const size=this.size,d=this.lab.detail,[p,v,info]=d.fallback.map(t=>t.image.data),data=Array.from({length:4},()=>new Float32Array(size*size*3*4));
  for(let i=0;i<d.capacity;i++)for(let lamp=0;lamp<3;lamp++){const o=i*4,k=poolShadowKernel(p.subarray(o,o+4),v.subarray(o,o+4),info.subarray(o,o+4),lamp,size);if(!k)continue;const radii=[3*Math.sqrt(k.xx),3*Math.sqrt(k.yy)],lo=radii.map((r,a)=>Math.max(0,Math.floor(((k.center[a]-r)*.5+.5)*size))),hi=radii.map((r,a)=>Math.min(size-1,Math.ceil(((k.center[a]+r)*.5+.5)*size)));
   for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++)for(let z=0;z<16;z++)data[z>>2][(y*size*3+lamp*size+x)*4+z%4]+=poolOpticalDepth(k,(x+.5)/size*2-1,(y+.5)/size*2-1,POOL_SHADOW_FAR*(z/15)**2);
  }
  if(!this.fallback)this.fallback=data.map(a=>{const t=new THREE.DataTexture(a,size*3,size,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=this.renderer.extensions.has('OES_texture_float_linear')?THREE.LinearFilter:THREE.NearestFilter;return t;});this.fallback.forEach((t,i)=>{t.image.data.set(data[i]);t.needsUpdate=true;this.u['uPoolShadow'+i].value=t;});
 }
 dispose(){for(const t of [this.target,this.material,this.geometry,...(this.fallback||[])])t.dispose();}
}
