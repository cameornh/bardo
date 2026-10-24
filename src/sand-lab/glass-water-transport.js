import * as THREE from 'three';
import {QUAD_VERTEX,SH_GLSL} from '../shaders.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';
import {BODY_RAY_GLSL} from './body-ray.js';
import {SOLUTE_GLSL} from './water-lab-solutes.js';
import {LAB_LIGHTING_GLSL} from './water-lab-lighting.js';
// B already contains foreground water. S=K*B+R is the late glass result.
// Transport only its new reflection R, restoring the scattering removed by K.
// Applying water fog to all of S would incorrectly attenuate B twice.
export function transportGlassLayer(shell,background,k,trans,scatter){return shell.map((v,i)=>v+(trans[i]-1)*(v-k[i]*background[i])+(1-k[i])*scatter[i]);}
const bodies=`uniform int uBodyCount;uniform highp sampler2D uBodies,uBodyExtra;
vec4 labBody(int i){return texelFetch(uBodies,ivec2((i*2)%256,(i*2)/256),0);}
vec4 bodyExtra(int i,int j){return texelFetch(uBodyExtra,ivec2((i*3+j)%256,(i*3+j)/256),0);}
vec3 bodyLocal(vec3 p,int i){vec4 r=bodyExtra(i,1);vec3 q=p-labBody(i).xyz;float cp=cos(r.z),sp=sin(r.z),c=cos(r.x),s=sin(r.x),a=cos(r.y),b=sin(r.y);q=vec3(q.x,cp*q.y+sp*q.z,-sp*q.y+cp*q.z);q=vec3(c*q.x+s*q.y,-s*q.x+c*q.y,q.z);return vec3(a*q.x-b*q.z,q.y,b*q.x+a*q.z);}
float bodyDistance(vec3 p,int i){vec4 b=labBody(i);if(bodyExtra(i,0).w<.5)return length(p-b.xyz)-b.w;vec3 q=bodyLocal(p,i);float radial=length(q.xz),r=b.w;return min(max(abs(radial-r*.84)-r*.16,abs(q.y)-r),max(radial-r,abs(q.y+r)-r*.16));}
vec3 bodyNormal(vec3 p,int i){float e=max(.000001,min(.003,labBody(i).w*.02));return normalize(vec3(bodyDistance(p+vec3(e,0,0),i)-bodyDistance(p-vec3(e,0,0),i),bodyDistance(p+vec3(0,e,0),i)-bodyDistance(p-vec3(0,e,0),i),bodyDistance(p+vec3(0,0,e),i)-bodyDistance(p-vec3(0,0,e),i)));}
`;
export const GLASS_WATER_FRAGMENT=`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;
uniform sampler2D uGlassImage,uImage,uOpaqueRead,uWaterSurface;uniform vec3 uEye,uSH[16];uniform int uSHDegree;uniform mat4 uInverseProjection,uCameraMatrix,uViewMatrix;uniform float uScale,uAmbient,uSunlight,uTannins,uTurbidity;
${LAB_FIELD_GLSL}${bodies}${BODY_RAY_GLSL}${SH_GLSL}${SOLUTE_GLSL}${LAB_LIGHTING_GLSL}
void main(){vec3 shell=texture(uGlassImage,vUv).rgb;outColor=vec4(shell,1);if(parcelSample(uEye).x<=.18)return;
 vec4 vp=uInverseProjection*vec4(vUv*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*vp.xyz/vp.w);float nearest=min(texture(uOpaqueRead,vUv).a,texture(uWaterSurface,vUv).a);int index=-1;
 for(int i=0;i<uBodyCount;i++){if(texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w>.5)continue;float t=bodyRayHit(uEye,ray,i,nearest,.00001);if(t<nearest){nearest=t;index=i;}}
 if(index<0)return;
 vec3 p=uEye+ray*nearest,n=bodyNormal(p,index);vec2 offsetUv=clamp(vUv-(mat3(uViewMatrix)*n).xy*.008,vec2(.001),vec2(.999));vec3 background=texture(uImage,offsetUv).rgb;if(dot(n,-ray)<0.)n=-n;
 float wet=smoothstep(.08,.24,parcelSample(p+n*.02).x),ior=mix(1.,1.333,wet),f0=pow((1.5-ior)/(1.5+ior),2.),F=f0+(1.-f0)*pow(1.-max(0.,dot(n,-ray)),5.);
 vec3 K=pow(max(bodyExtra(index,0).rgb,vec3(.02)),vec3(.4))*(1.-F),trans=vec3(1),scatter=vec3(0);
 float sh[16];basisSH(vec3(0,1,0),sh);vec3 ambient=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;ambient+=uSH[i]*sh[i]*diffuseSHBand(i);}
 vec3 incident=max(ambient,vec3(0))*uAmbient+LAB_SUN*uSunlight*.25;
 float stepSize=nearest/12.;for(int i=0;i<12;i++){vec4 a=parcelSample(uEye+ray*((float(i)+.5)*stepSize));float distance=smoothstep(.12,.24,a.x)*stepSize*uScale;if(distance<=0.)continue;vec3 chem=a.yzw/max(a.x,.0001),ext=soluteExtinction(chem,uTannins,uTurbidity),tr=exp(-ext*distance);scatter+=trans*(1.-tr)*soluteScatter(chem,uTannins,uTurbidity)/ext*incident;trans*=tr;}
 outColor=vec4(max(vec3(0),shell+(trans-1.)*(shell-K*background)+(1.-K)*scatter),1);
}`;
export class GlassWaterTransport{
 constructor(u){this.u={...u,uGlassImage:{value:null}};this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});this.scene=new THREE.Scene();this.camera=new THREE.Camera();this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:this.u,vertexShader:QUAD_VERTEX,fragmentShader:GLASS_WATER_FRAGMENT,depthTest:false,depthWrite:false});this.geometry=new THREE.PlaneGeometry(2,2);this.scene.add(new THREE.Mesh(this.geometry,this.material));}
 render(r,input,lab,eye){if(!lab.sand||!lab.balls.some(b=>b.kind==='glass')||lab.sample(eye)<=.18)return input;
 if(this.target.width!==input.width||this.target.height!==input.height)this.target.setSize(input.width,input.height);this.u.uGlassImage.value=input.texture;r.setRenderTarget(this.target);r.render(this.scene,this.camera);return this.target;
 }
 dispose(){this.target.dispose();this.material.dispose();this.geometry.dispose();}
}
