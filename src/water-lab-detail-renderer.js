import * as THREE from 'three';
import {SH_GLSL,QUAD_VERTEX} from './shaders.js';
const vertex=`precision highp float;precision highp int;
in float aDetailId;uniform highp sampler2D uDetailP,uDetailV,uDetailI;uniform vec2 uResolution;uniform vec3 uEye;
out vec2 vQ;out float vAlpha,vDepth;out vec3 vDirection;
void main(){int id=int(aDetailId);ivec2 uv=ivec2(id%256,id/256);vec4 source=texelFetch(uDetailP,uv,0),velocity=texelFetch(uDetailV,uv,0),info=texelFetch(uDetailI,uv,0);vec4 p=viewMatrix*vec4(source.xyz,1);float life=velocity.w,age=source.w;
vQ=position.xy*3.;vDepth=length(p.xyz);vDirection=normalize(uEye-source.xyz);vAlpha=0.;
if(age>=life||life<=0.||p.z>-.02){gl_Position=vec4(2,2,2,1);return;}
float s=info.x*(.75+.25*sin(min(1.,age/life)*3.14159)),z=-p.z;vec3 direction=normalize(mat3(viewMatrix)*velocity.xyz+vec3(0,1e-8,0)),jx=vec3(projectionMatrix[0][0]/z,0,projectionMatrix[0][0]*p.x/(z*z)),jy=vec3(0,projectionMatrix[1][1]/z,projectionMatrix[1][1]*p.y/(z*z));
float stretch=info.y<.5?1.2:0.,xx=s*s*(dot(jx,jx)+stretch*pow(dot(jx,direction),2.)),xy=s*s*(dot(jx,jy)+stretch*dot(jx,direction)*dot(jy,direction)),yy=s*s*(dot(jy,jy)+stretch*pow(dot(jy,direction),2.));
float area=sqrt(max(0.,xx*yy-xy*xy));xx+=1.4/(uResolution.x*uResolution.x);yy+=1.4/(uResolution.y*uResolution.y);float filtered=sqrt(max(1e-15,xx*yy-xy*xy));
float l=sqrt(max(0.,pow((xx-yy)*.5,2.)+xy*xy)),e1=max(1e-12,(xx+yy)*.5+l),e2=max(1e-12,(xx+yy)*.5-l);vec2 axis=abs(xy)>1e-12?normalize(vec2(e1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);vec4 clip=projectionMatrix*p;clip.xy+=3.*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y)*clip.w;gl_Position=clip;
vAlpha=info.z*smoothstep(0.,.045,age)*(1.-smoothstep(.45,1.,age/life))*min(1.,area/filtered);
}`;
const fragment=`precision highp float;in vec2 vQ;in float vAlpha,vDepth;in vec3 vDirection;out vec4 outColor;
uniform highp sampler2D uOpaqueRead,uWaterSurface;uniform vec2 uResolution;uniform vec3 uSH[16];uniform int uSHDegree;uniform float uAmbient,uScale;
${SH_GLSL}
void main(){if(vAlpha<.0001)discard;vec2 uv=gl_FragCoord.xy/uResolution;float opaque=texture(uOpaqueRead,uv).a;if(vDepth>opaque)discard;float surface=texture(uWaterSurface,uv).a,under=max(0.,vDepth-surface);float a=exp(-.5*dot(vQ,vQ))*vAlpha*exp(-under*uScale*.16);if(a<.0001)discard;float b[16];basisSH(normalize(vDirection),b);vec3 light=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;light+=uSH[i]*b[i];}vec3 white=(vec3(2.4)+max(light,vec3(0)))*uAmbient;outColor=vec4(white*a,a);}`;
// Accumulate optical density with only a short reconstruction footprint.
// Coherent emission creates the shape; no broad halo is added around it.
// This is not a distance field or a camera-motion blur, and does not move water.
const reconstruct=`precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uMist,uOpaqueRead;uniform vec2 uResolution;
void main(){float center=texture(uOpaqueRead,vUv).a,total=0.;vec4 field=vec4(0);for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 uv=vUv+vec2(x,y)*1.25/uResolution;float depth=texture(uOpaqueRead,uv).a,edge=exp(-abs(depth-center)*18.),w=(x==0?.6:.2)*(y==0?.6:.2)*edge;field+=texture(uMist,uv)*w;total+=w;}field/=max(total,.0001);float density=field.a;if(density<.00001)discard;float alpha=1.-exp(-density);vec3 light=field.rgb/max(density,.00001);outColor=vec4(light*alpha,alpha);}`;
export class LabDetailRenderer {
 constructor(lab,uniforms){this.lab=lab;this.uniforms=uniforms;const g=this.geometry=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);g.setAttribute('aDetailId',new THREE.InstancedBufferAttribute(Float32Array.from({length:lab.detail.capacity},(_,i)=>i),1));g.instanceCount=lab.detail.capacity;this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:{...uniforms,...lab.detail.u},transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});this.scene=new THREE.Scene();const mesh=new THREE.Mesh(g,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
 this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});this.quadGeometry=new THREE.PlaneGeometry(2,2);this.reconstruct=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:reconstruct,uniforms:{...uniforms,uMist:{value:this.target.texture}},transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});this.composite=new THREE.Scene();this.composite.add(new THREE.Mesh(this.quadGeometry,this.reconstruct));this.camera=new THREE.Camera();
 }
 render(renderer,camera){if(!this.lab.detail.enabled||!this.lab.detail.count)return;const size=this.uniforms.uResolution.value;if(this.target.width!==size.x||this.target.height!==size.y)this.target.setSize(size.x,size.y);const old=renderer.getRenderTarget(),color=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha();renderer.setRenderTarget(this.target);renderer.setClearColor(0,0);renderer.clear();renderer.render(this.scene,camera);renderer.setRenderTarget(old);renderer.setClearColor(color,alpha);renderer.render(this.composite,this.camera);}
 dispose(){for(const resource of [this.geometry,this.material,this.target,this.quadGeometry,this.reconstruct])resource.dispose();}
}
