import { SH_GLSL } from './shaders.js';

export const OPTICS_MOMENTS_VERTEX=`precision highp float;
in vec4 aCenter,aCov0,aCov1,aNormal;
uniform vec2 uResolution;uniform vec3 uEye,uSampleCenter;
out vec2 vGaussian;out float vTau;out vec3 vNormal;
void main(){
 mat3 covariance=mat3(aCov0.x,aCov0.y,aCov0.z,aCov0.y,aCov1.x,aCov1.y,aCov0.z,aCov1.y,aCov1.z);
 vec3 center=aCenter.xyz+uSampleCenter;
 vec4 viewP=viewMatrix*vec4(center,1.);mat3 rotation=mat3(viewMatrix),c=rotation*covariance*transpose(rotation);
 float z=max(-viewP.z,.1);vec2 f=vec2(projectionMatrix[0][0],projectionMatrix[1][1])*uResolution*.5;
 vec3 jx=vec3(f.x/z,0,f.x*viewP.x/(z*z)),jy=vec3(0,f.y/z,f.y*viewP.y/(z*z));
 float A=dot(jx,c*jx),B=dot(jx,c*jy),C=dot(jy,c*jy),det=max(A*C-B*B,1e-9);A+=.3;C+=.3;
 float compensation=sqrt(det/max(A*C-B*B,1e-9)),mid=(A+C)*.5,d=sqrt(max((A-C)*(A-C)*.25+B*B,0.));
 float e1=mid+d,e2=max(mid-d,.001);vec2 axis=abs(B)>.00001?normalize(vec2(B,e1-A)):(A>=C?vec2(1,0):vec2(0,1));
 float support=min(8.,sqrt(2.*log(max(aCenter.w*compensation/.0001,1.01))));
 vec2 offset=support*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y);
 vec4 clip=projectionMatrix*viewP;clip.xy+=offset*2./uResolution*clip.w;
 if(viewP.z>-.1||dot(aNormal.xyz,uEye-center)<-.02)clip=vec4(2,2,2,1);gl_Position=clip;
 vNormal=aNormal.xyz;vGaussian=position.xy*support;vTau=aCenter.w*compensation;
}`;
export const OPTICS_MOMENTS_FRAGMENT=`precision highp float;
in vec2 vGaussian;in float vTau;in vec3 vNormal;out vec4 outColor;
void main(){float weight=vTau*exp(-.5*dot(vGaussian,vGaussian));if(weight<.0001)discard;outColor=vec4(vNormal*weight,weight);}`;

const common=`
uniform vec3 uEye,uOpticsLight,uSampleCenter,uRadii,uSigmaA,uSigmaS,uDiffusion,uBoundary,uGridStep,uOpticsSH[16];
uniform vec3 uCardCenters[6],uSceneCenters[9],uSceneRadii[9],uSceneA[9],uSceneS[9];
uniform vec3 uSceneD[3],uSceneBoundary[3],uSceneStep[3],uSceneReady;
uniform vec4 uSceneOptics[9];uniform int uSampleID;
uniform highp sampler3D uField0,uField1,uField2;
uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;
uniform float uRoughness,uIOR,uPhaseG;uniform bool uSplit,uTransport,uOpaque,uReflections;uniform int uSHDegree,uView,uOpticsView;
uniform highp sampler3D uFluence;uniform sampler2D uMoments;uniform vec2 uResolution;
${SH_GLSL}
const float PI=3.14159265359;
vec3 rayAt(vec2 uv){vec4 h=uInverseProjection*vec4(uv*2.-1.,1,1);return normalize(mat3(uCameraMatrix)*(h.xyz/h.w));}
vec2 interval(vec3 p,vec3 d){vec3 o=p/uRadii,v=d/uRadii;float a=dot(v,v),b=dot(o,v),c=dot(o,o)-1.,disc=b*b-a*c;if(disc<0.)return vec2(1e5,-1e5);return (-b+vec2(-1,1)*sqrt(disc))/a;}
vec3 normalAt(vec3 p){return normalize(p/(uRadii*uRadii));}
float fresnel(float cosine,float ni,float nt){float c=clamp(cosine,0.,1.),s2=ni*ni/(nt*nt)*(1.-c*c);if(s2>=1.)return 1.;float t=sqrt(1.-s2),rs=(ni*c-nt*t)/(ni*c+nt*t),rp=(nt*c-ni*t)/(nt*c+ni*t);return .5*(rs*rs+rp*rp);}
float beam(vec3 p){return uSplit?step(.02,p.x/uRadii.x):1.;}
vec3 environment(vec3 d,float rough){float b[16];basisSH(d,b);vec3 c=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;float band=i<1?0.:i<4?1.:i<9?2.:3.;c+=uOpticsSH[i]*b[i]*exp(-band*(band+1.)*rough*rough*.5);}return max(c,vec3(0));}
float checkerIntegral(float x){return 1.-abs(mod(x,2.)-1.);}
vec3 targetAt(vec3 o,vec3 d,float rough){
 if(d.z<-.0001){float t=(-1.9-o.z)/d.z;vec3 p=o+d*t;
  if(t>0.)for(int i=0;i<6;i++){vec2 q=p.xy-uCardCenters[i].xy;
   float footprint=.0005+rough*rough*t*1.5;
   float coverage=(1.-smoothstep(.83-footprint,.83+footprint,abs(q.x)))*(1.-smoothstep(.83-footprint,.83+footprint,abs(q.y)));
   if(coverage>.0001){vec2 cell=q*7.;
    // Integrate the calibration grid over a rough-refraction ray cone. This
    // removes the aliasing of deterministic microfacet samples, rather
    // than applying a screen blur to the finished image.
    vec2 width=max(vec2(footprint*7.),fwidth(cell)*.5);
    vec2 wave=vec2(checkerIntegral(cell.x+width.x)-checkerIntegral(cell.x-width.x),checkerIntegral(cell.y+width.y)-checkerIntegral(cell.y-width.y))/(2.*width);
    float checker=.5-.5*wave.x*wave.y;return mix(environment(d,rough)*.18,mix(vec3(.045,.063,.072),vec3(.63,.66,.64),checker),coverage);}
  }
 }
 return environment(d,rough)*.18;
}
vec3 microNormal(vec3 n,int sampleIndex,float rough){
 vec3 t=normalize(cross(abs(n.y)<.95?vec3(0,1,0):vec3(1,0,0),n)),b=cross(n,t);
 float u=(float(sampleIndex)+.5)/16.,phi=float(sampleIndex)*2.39996323,a=rough*rough;
 float tanTheta=a*sqrt(u/max(1.-u,.001));return normalize(n+tanTheta*(cos(phi)*t+sin(phi)*b));
}
float hg(float c,float g){return (1.-g*g)/(4.*PI*pow(max(.001,1.+g*g-2.*g*c),1.5));}
vec3 singleScatter(vec3 p,vec3 d,float distance){
 vec3 ss=uTransport?uSigmaS:vec3(0),st=uSigmaA+ss;if(max(ss.r,max(ss.g,ss.b))<.001)return vec3(0);
 vec3 sum=vec3(0);float ds=distance/12.;
 for(int j=0;j<12;j++){
  float s=(float(j)+.5)*ds;vec3 q=p+d*s;float lightPath=max(0.,interval(q,uOpticsLight).y);vec3 entry=q+uOpticsLight*lightPath;
  float enter=1.-fresnel(max(dot(normalAt(entry),uOpticsLight),0.),1.,uIOR);
  sum+=exp(-st*(s+lightPath))*ss*ds*beam(entry)*enter*hg(dot(d,uOpticsLight),uPhaseG);
 }
 return sum*4.5;
}
vec2 sceneInterval(vec3 p,vec3 d,vec3 radii){vec3 o=p/radii,v=d/radii;float a=dot(v,v),b=dot(o,v),c=dot(o,o)-1.,disc=b*b-a*c;if(disc<0.)return vec2(1e5,-1e5);return (-b+vec2(-1,1)*sqrt(disc))/a;}
vec3 sceneNormal(vec3 p,int id){return normalize(p/(uSceneRadii[id]*uSceneRadii[id]));}
float sceneBeam(vec3 p,int id){return uSplit?step(.02,p.x/uSceneRadii[id].x):1.;}
vec3 shadeOpaqueSample(int id,vec3 p,vec3 n,vec3 v){
 vec3 radii=uSceneRadii[id];vec4 properties=uSceneOptics[id];float rough=properties.y,ior=properties.x;
 vec3 reduced=uSceneS[id]*(1.-properties.z),albedo=reduced/max(uSceneA[id]+reduced,vec3(.000001)),color;
 if(uTransport&&uSceneReady[id]>.5){
  float inset=max(.0001,.6*length(uSceneStep[id]*n));vec3 uv=clamp((p-n*inset)/radii*.5+.5,vec3(0),vec3(1));vec4 field;
  if(id==0)field=texture(uField0,uv);else if(id==1)field=texture(uField1,uv);else field=texture(uField2,uv);
  color=4.5*uSceneD[id]*field.rgb/max(field.a,.001)/(vec3(inset)+uSceneBoundary[id])/PI*(1.-fresnel(max(dot(n,v),0.),1.,ior));
 }else color=albedo*max(dot(n,uOpticsLight),0.)*4.5/PI*sceneBeam(p,id)*(1.-fresnel(max(dot(n,v),0.),1.,ior));
 vec3 h=normalize(uOpticsLight+v);float nl=max(dot(n,uOpticsLight),0.),nv=max(dot(n,v),.001),nh=max(dot(n,h),0.),a=max(.002,rough*rough),a2=a*a,denom=nh*nh*(a2-1.)+1.,k=(rough+1.)*(rough+1.)/8.;
 float D=a2/(PI*denom*denom),G=nv/(nv*(1.-k)+k)*nl/max(nl*(1.-k)+k,.001);
 color+=vec3(sceneBeam(p,id)*4.5*D*G*fresnel(max(dot(v,h),0.),1.,ior)/max(4.*nv,.001));
 if(uReflections)color+=environment(reflect(-v,n),rough)*fresnel(nv,1.,ior);
 return color+albedo*.025;
}
vec3 scatterSample(int id,vec3 p,vec3 d,float path){
 vec3 ss=uTransport?uSceneS[id]:vec3(0),st=uSceneA[id]+ss;if(max(ss.r,max(ss.g,ss.b))<.001)return vec3(0);
 vec3 sum=vec3(0);float ds=path/8.;
 for(int j=0;j<8;j++){float s=(float(j)+.5)*ds;vec3 q=p+d*s;float lightPath=max(0.,sceneInterval(q,uOpticsLight,uSceneRadii[id]).y);vec3 entry=q+uOpticsLight*lightPath;
  float enter=1.-fresnel(max(dot(sceneNormal(entry,id),uOpticsLight),0.),1.,uSceneOptics[id].x);
  sum+=exp(-st*(s+lightPath))*ss*ds*sceneBeam(entry,id)*enter*hg(dot(d,uOpticsLight),uSceneOptics[id].z);
 }
 return sum*4.5;
}
// Bounded, scene-space secondary visibility. It queries the same sample
// boundaries/material fields even when they are hidden or off screen.
vec3 sceneRadiance(vec3 origin,vec3 direction,int ignoreID,float coneRough){
 vec3 throughput=vec3(1),radiance=vec3(0),o=origin+direction*.0001,d=direction;int previous=ignoreID;
 for(int bounce=0;bounce<5;bounce++){
  int id=-1;float nearest=1e5;
  for(int i=0;i<9;i++){if(i==previous||uSceneOptics[i].w<.5)continue;vec2 h=sceneInterval(o-uSceneCenters[i],d,uSceneRadii[i]);if(h.y<max(h.x,.00001))continue;float t=max(h.x,.00001);if(t<nearest){nearest=t;id=i;}}
  // Cards are real bounded optical targets, and may be nearer than an object.
  if(d.z<-.0001){float t=(-1.9-o.z)/d.z;if(t>0.&&t<nearest){vec2 p=(o+d*t).xy;for(int i=0;i<6;i++)if(max(abs(p.x-uCardCenters[i].x),abs(p.y-uCardCenters[i].y))<.83){id=-1;break;}}}
  if(id<0){radiance+=throughput*targetAt(o,d,coneRough);return radiance;}
  vec3 p=o+d*nearest-uSceneCenters[id],n=sceneNormal(p,id);if(dot(n,-d)<0.)n=-n;
  if(id<3){radiance+=throughput*shadeOpaqueSample(id,p,n,-d);return radiance;}
  float ior=uSceneOptics[id].x,f0=fresnel(max(dot(-d,n),0.),1.,ior);
  if(uReflections)radiance+=throughput*f0*environment(reflect(d,n),uSceneOptics[id].y);
  vec3 inside=refract(d,n,1./ior);float path=max(0.,sceneInterval(p+inside*.00001,inside,uSceneRadii[id]).y);vec3 exitP=p+inside*path,exitN=sceneNormal(exitP,id);
  vec3 ss=uTransport?uSceneS[id]:vec3(0),st=uSceneA[id]+ss;
  radiance+=throughput*(1.-f0)*scatterSample(id,p,inside,path);throughput*=(1.-f0)*exp(-st*path);
  float f1=fresnel(max(dot(inside,exitN),0.),ior,1.);vec3 outgoing=refract(inside,-exitN,ior);
  if(f1>.9999){inside=reflect(inside,exitN);float extra=max(0.,sceneInterval(exitP+inside*.00001,inside,uSceneRadii[id]).y);exitP+=inside*extra;exitN=sceneNormal(exitP,id);throughput*=exp(-st*extra);f1=fresnel(max(dot(inside,exitN),0.),ior,1.);outgoing=refract(inside,-exitN,ior);}
  if(f1>.9999)return radiance;throughput*=1.-f1;if(max(throughput.r,max(throughput.g,throughput.b))<.0001)return radiance;
  d=outgoing;o=exitP+uSceneCenters[id]+d*.0001;previous=id;coneRough=max(coneRough,uSceneOptics[id].y*.6);
 }
 return radiance; // Unresolved paths terminate dark, never leak through a blocker.
}
vec3 transmission(vec3 p,vec3 incident,vec3 n,bool addScattering){
 vec3 color=vec3(0),ss=uTransport?uSigmaS:vec3(0),st=uSigmaA+ss;
 int samples=uRoughness>.12?16:1;
 for(int j=0;j<16;j++){
  if(j>=samples)break;vec3 m=samples==1?n:microNormal(n,j,uRoughness);if(dot(m,-incident)<.001)m=n;
  vec3 d=refract(incident,m,1./uIOR);if(dot(d,normalAt(p))>=0.)d=refract(incident,normalAt(p),1./uIOR);
  float path=max(0.,interval(p+d*.00001,d).y);vec3 exitP=p+d*path,exitN=normalAt(exitP);
  vec3 exitM=samples==1?exitN:microNormal(exitN,15-j,uRoughness);
  if(dot(d,exitM)<.001)exitM=exitN;
  float f0=fresnel(max(dot(-incident,m),0.),1.,uIOR),f1=fresnel(max(dot(d,exitM),0.),uIOR,1.);
  vec3 outRay=refract(d,-exitM,uIOR),background=vec3(0);
  if(f1<.9999)background=sceneRadiance(exitP+uSampleCenter,outRay,uSampleID,uRoughness*.6)*(1.-f1);
  // One internal reflection is retained; further bounces are deliberately truncated.
  if(f1>.01){vec3 bounce=reflect(d,exitM);float extra=max(0.,interval(exitP+bounce*.00001,bounce).y);vec3 p2=exitP+bounce*extra,n2=normalAt(p2),r2=refract(bounce,-n2,uIOR);
   if(length(r2)>.1)background+=f1*(1.-fresnel(max(dot(bounce,n2),0.),uIOR,1.))*exp(-st*extra)*sceneRadiance(p2+uSampleCenter,r2,uSampleID,uRoughness*.6);
  }
  color+=(1.-f0)*(background*exp(-st*path)+(addScattering?singleScatter(p,d,path):vec3(0)));
 }
 return color/float(samples);
}
vec3 surfaceReflection(vec3 n,vec3 v,float visibility){
 vec3 l=uOpticsLight,h=normalize(l+v);float nl=max(dot(n,l),0.),nv=max(dot(n,v),.001),nh=max(dot(n,h),0.);
 float rough=max(.045,uRoughness),a=rough*rough,a2=a*a,denom=nh*nh*(a2-1.)+1.,D=a2/(PI*denom*denom),k=(rough+1.)*(rough+1.)/8.;
 float G=nv/(nv*(1.-k)+k)*nl/max(nl*(1.-k)+k,.001),F=fresnel(max(dot(v,h),0.),1.,uIOR);
 vec3 result=vec3(visibility*4.5*D*G*F/max(4.*nv,.001));
 if(uReflections)result+=environment(reflect(-v,n),rough)*fresnel(nv,1.,uIOR);
 return result;
}
`;
export const OPTICS_BACKGROUND_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;
${common}
void main(){outColor=vec4(targetAt(uEye,rayAt(vUv),0.),1);}`;
export const OPTICS_SURFACE_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;
${common}
void main(){
 vec4 moments=texture(uMoments,vUv);if(moments.w<.0001)discard;
 vec3 ray=rayAt(vUv),localEye=uEye-uSampleCenter;vec2 hit=interval(localEye,ray);if(hit.y<max(hit.x,0.))discard;
 // Analytic boundary is an invisible optical support/visibility field; Gaussian
 // moments supply coverage and the reconstructed normal, including visual LOD.
 float t=max(hit.x,0.);vec3 p=localEye+ray*t,n=normalize(moments.xyz/max(moments.w,.0001));
 vec3 geometric=normalAt(p);if(dot(n,geometric)<.5)n=geometric;if(dot(n,-ray)<0.)n=-n;
 vec3 color;
 if(uOpaque){
  vec3 reduced=uSigmaS*(1.-uPhaseG),albedo=reduced/max(uSigmaA+reduced,vec3(.000001));
  if(uTransport){
   float inset=max(.0001,.6*length(uGridStep*geometric));vec3 q=p-geometric*inset;
   vec4 field=texture(uFluence,clamp(q/uRadii*.5+.5,vec3(0),vec3(1)));
   vec3 phi=field.rgb/max(field.a,.001),flux=uDiffusion*phi/(vec3(inset)+uBoundary);
   color=4.5*flux/PI*(1.-fresnel(max(dot(n,-ray),0.),1.,uIOR));
  }else color=albedo*max(dot(n,uOpticsLight),0.)*4.5/PI*beam(p)*(1.-fresnel(max(dot(n,-ray),0.),1.,uIOR));
  color+=albedo*.025;
  if(uTransport)color+=transmission(p,ray,geometric,false);
 }else color=transmission(p,ray,geometric,true);
 if(uOpticsView==1){float thickness=(hit.y-t)*25.;color=vec3(thickness/30.,thickness/60.,thickness/100.);}
 else if(uOpticsView==2){color=exp(-(uSigmaA+uSigmaS)*(hit.y-t));}
 else {color+=surfaceReflection(n,-ray,beam(p));}
 if(uView==1)color=n*.5+.5;if(uView==2)color=vec3(.15,.6,1.)*(1.-exp(-moments.w));
 vec3 worldP=p+uSampleCenter;vec4 clip=uProjection*uViewMatrix*vec4(worldP,1.);gl_FragDepth=clip.z/clip.w*.5+.5;
 float alpha=1.-exp(-moments.w);outColor=vec4(color*alpha,alpha);
}`;
