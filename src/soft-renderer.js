import * as THREE from 'three';
import { SH_GLSL } from './shaders.js';
import { projectSH } from './sh.js';
import { allocateBudget } from './lod.js';
import { fabricSplats,fiberSplats,scalpSplats,softLevels } from './soft-splats.js';

const vertex=`precision highp float;
in vec4 aCenter,aCov0,aCov1,aNormal,aTangent,aColor;
uniform vec2 uResolution;uniform vec3 uEye,uSoftSH[16];uniform int uSHDegree;
${SH_GLSL}
out vec2 vGaussian;out vec3 vNormal,vTangent,vCenter,vColor,vSky;out float vTau,vRoughness,vStrain,vKind;
void main(){
 mat3 covariance=mat3(aCov0.x,aCov0.y,aCov0.z,aCov0.y,aCov1.x,aCov1.y,aCov0.z,aCov1.y,aCov1.z);
 vec4 viewP=viewMatrix*vec4(aCenter.xyz,1.);mat3 rotation=mat3(viewMatrix),c=rotation*covariance*transpose(rotation);
 float z=max(-viewP.z,.1);vec2 f=vec2(projectionMatrix[0][0],projectionMatrix[1][1])*uResolution*.5;
 vec2 slope=clamp(viewP.xy/z,-1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]));
 vec3 jx=vec3(f.x/z,0,f.x*slope.x/z),jy=vec3(0,f.y/z,f.y*slope.y/z);
 float A=dot(jx,c*jx),B=dot(jx,c*jy),C=dot(jy,c*jy),det=max(A*C-B*B,1e-9);A+=.3;C+=.3;
 float compensation=sqrt(det/max(A*C-B*B,1e-9)),mid=(A+C)*.5,d=sqrt(max((A-C)*(A-C)*.25+B*B,0.));
 float e1=mid+d,e2=max(mid-d,.001);vec2 axis=abs(B)>.00001?normalize(vec2(B,e1-A)):(A>=C?vec2(1,0):vec2(0,1));
 float support=min(8.,sqrt(2.*log(max(aCenter.w*compensation/.0001,1.01))));
 vec2 offset=support*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y);
 vec4 clip=projectionMatrix*viewP;clip.xy+=offset*2./uResolution*clip.w;if(viewP.z>-.1)clip=vec4(2,2,2,1);gl_Position=clip;
 vec3 n=normalize(aNormal.xyz),v=normalize(uEye-aCenter.xyz),t=normalize(aTangent.xyz);if(dot(n,v)<0.)n=-n;
 if(aNormal.w>.5&&aNormal.w<1.5)n=normalize(v-t*dot(v,t));
 float basis[16];basisSH(reflect(-v,n),basis);vec3 sky=vec3(0);
 for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;sky+=uSoftSH[i]*basis[i];}
 vSky=max(sky,vec3(0));vNormal=n;vTangent=t;vCenter=aCenter.xyz;vColor=aColor.rgb;
 vGaussian=position.xy*support;vTau=aCenter.w*compensation;vRoughness=aCov0.w;vStrain=aCov1.w;vKind=aNormal.w;
}`;
const fragment=`precision highp float;
uniform vec2 uResolution;uniform vec3 uEye,uLight,uBall;uniform vec4 uScalps[4];
uniform mat4 uInverseProjection,uCameraMatrix;uniform float uBallRadius;uniform bool uReflections,uStrainView;uniform int uView,uScalpCount;
in vec2 vGaussian;in vec3 vNormal,vTangent,vCenter,vColor,vSky;in float vTau,vRoughness,vStrain,vKind;out vec4 outColor;
bool occluded(vec3 ray,vec3 center,float radius,float depth){
 vec3 r=uEye-center;float b=dot(r,ray),disc=b*b-dot(r,r)+radius*radius;
 return disc>0.&&b<0.&&-b-sqrt(max(disc,0.))<depth;
}
void main(){
 float density=exp(-.5*dot(vGaussian,vGaussian)),alpha=1.-exp(-vTau*density);if(alpha<.001)discard;
 vec2 uv=gl_FragCoord.xy/uResolution;vec4 farP=uInverseProjection*vec4(uv*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*(farP.xyz/farP.w));
 float depth=dot(vCenter-uEye,ray);
 if(occluded(ray,uBall,uBallRadius,depth))discard;
 if(vKind<1.5)for(int i=0;i<4;i++){if(i>=uScalpCount)break;if(occluded(ray,uScalps[i].xyz,uScalps[i].w,depth-.025))discard;}
 vec3 n=normalize(vNormal),t=normalize(vTangent),v=normalize(uEye-vCenter),l=normalize(uLight),h=normalize(l+v);
 float rough=clamp(vRoughness,.08,1.),nv=max(dot(n,v),0.),nl=max(dot(n,l),0.);
 vec3 color=vColor*(.28+.85*nl);
 if(vKind>.5&&vKind<1.5){
  // A tangent-dependent fiber lobe, not a calibrated multiple-scattering hair BSDF.
  float tl=dot(t,l),tv=dot(t,v),s=clamp(sqrt(max(0.,1.-tl*tl))*sqrt(max(0.,1.-tv*tv))-tl*tv,0.,1.);
  float highlight=pow(s,mix(95.,4.,rough*rough))*(1.-rough*.7);
  color=vColor*(.25+.6*sqrt(max(0.,1.-tl*tl)))+mix(vColor,vec3(1),.5)*highlight*.75;
 }else{
  float a=rough*rough,a2=a*a,nh=max(dot(n,h),0.),d=nh*nh*(a2-1.)+1.;
  float D=a2/(3.14159*d*d),k=(rough+1.)*(rough+1.)/8.;
  float G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k),F=.04+.96*pow(1.-max(dot(v,h),0.),5.);
  color+=vec3(min(2.,D*G*F/max(4.*nv,.05)));
  color+=vColor*pow(1.-nv,4.)*rough*.35;
 }
 if(uReflections)color+=vSky*(.025+.18*pow(1.-nv,5.))*(1.-rough*.6);
 if(uStrainView&&vKind<.5)color=mix(vec3(.04,.22,.5),vec3(1.,.07,.01),clamp(vStrain/.4,0.,1.));
 if(uView==1)color=n*.5+.5;if(uView==2)color=vec3(.2,.7,1.)*density;
 outColor=vec4(color*alpha,alpha);
}`;

export class SoftRenderer {
 constructor(uniforms){
  this.count=0;this.cpuMs=0;this.budget=12000;this.target=2;
  this.geometry=new THREE.InstancedBufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));this.geometry.setIndex([0,1,2,0,2,3]);
  this.arrays=Array.from({length:6},()=>new Float32Array(this.budget*4));
  ['aCenter','aCov0','aCov1','aNormal','aTangent','aColor'].forEach((name,i)=>this.geometry.setAttribute(name,new THREE.InstancedBufferAttribute(this.arrays[i],4).setUsage(THREE.DynamicDrawUsage)));
  const sh=projectSH(d=>{const sky=.5+.5*d[1],panel=Math.max(0,(d[0]+d[1]+d[2])/Math.sqrt(3))**16;return [.38+.3*sky+.3*panel,.43+.3*sky+.28*panel,.46+.3*sky+.25*panel];});
  this.uniforms={...uniforms,uBall:{value:new THREE.Vector3()},uBallRadius:{value:.43},uScalps:{value:Array.from({length:4},()=>new THREE.Vector4())},uScalpCount:{value:0},uStrainView:{value:false},uSoftSH:{value:Array.from({length:16},(_,i)=>new THREE.Vector3(...sh.subarray(i*3,i*3+3)))}};
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:this.uniforms,depthTest:true,depthWrite:false,transparent:true,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});
  this.scene=new THREE.Scene();const mesh=new THREE.Mesh(this.geometry,this.material);mesh.frustumCulled=false;this.scene.add(mesh);
 }
 prepare(fabrics,fibers,camera,probe,motion,dt,pixelTarget){
  const start=performance.now();this.count=0;this.cpuMs=0;
  const test=fabrics?.enabled?fabrics:fibers?.enabled?fibers:null;
  if(!test){this.geometry.instanceCount=0;return;}
  const hair=!!test.grooms,subjects=hair?test.grooms:test.patches,followers=hair?test.followers:0;
  this.uniforms.uBall.value.copy(probe.position);this.uniforms.uBallRadius.value=probe.radius;this.uniforms.uScalpCount.value=hair?4:0;
  const focal=this.uniforms.uResolution.value.y*camera.projectionMatrix.elements[5]*.5,view=camera.matrixWorldInverse.elements;
  const items=subjects.map(subject=>{const p=subject.center||[subject.centerX,2.3,0],depth=Math.max(1,-(view[2]*p[0]+view[6]*p[1]+view[10]*p[2]+view[14]));return {subject,levels:softLevels(subject,followers),scale:focal/depth};});
  const budget=this.budget-(hair?640:0),requested=pixelTarget*motion;
  const needed=allocateBudget(items,requested,budget).target;
  this.target+=(needed-this.target)*(1-Math.exp(-Math.min(dt,.1)/(needed>this.target?.08:.45)));
  const allocation=allocateBudget(items,this.target,budget),draws=[];
  items.forEach(({subject},i)=>{
   const choice=allocation.choices[i],parts=choice.a===choice.b?[[choice.a,1]]:[[choice.a,1-choice.t],[choice.b,choice.t]];
   for(const [level,weight] of parts){if(weight<.0001)continue;const nodes=hair?fiberSplats(subject,followers,level):fabricSplats(subject,level);for(const g of nodes){g.tau*=weight;draws.push(g);}}
   if(hair){draws.push(...scalpSplats(subject));this.uniforms.uScalps.value[i].set(...subject.center,subject.supportRadius);}
  });
  const visible=[];
  for(const g of draws){g.depth=-(view[2]*g.center[0]+view[6]*g.center[1]+view[10]*g.center[2]+view[14]);if(g.depth>.1)visible.push(g);}
  visible.sort((a,b)=>b.depth-a.depth);
  if(visible.length>this.budget)throw new Error('Deformable Gaussian budget exceeded');
  for(const g of visible){const o=this.count++*4,c=g.cov;
   this.arrays[0].set([...g.center,g.tau],o);this.arrays[1].set([c[0],c[1],c[2],g.roughness],o);this.arrays[2].set([c[3],c[4],c[5],g.strain],o);this.arrays[3].set([...g.normal,g.kind],o);this.arrays[4].set([...g.tangent,0],o);this.arrays[5].set([...g.color,0],o);
  }
  this.geometry.instanceCount=this.count;for(const a of Object.values(this.geometry.attributes))if(a.isInstancedBufferAttribute){a.clearUpdateRanges();a.addUpdateRange(0,this.count*4);a.needsUpdate=true;}
  this.cpuMs=performance.now()-start;
 }
 render(renderer,camera){if(this.count)renderer.render(this.scene,camera);}
 dispose(){this.geometry.dispose();this.material.dispose();}
}
