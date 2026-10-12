import { SH_GLSL } from './shaders.js';
import { OPTICS_MOMENTS_VERTEX } from './optics-shaders.js';

// These boundary equations match light-transport.js. The cache supplies optical
// radiance and visibility; projected covariance Gaussians supply image coverage.
export const LIGHT_BOUNDARIES_GLSL=`
uniform int uVolumeCount;
uniform vec3 uCentersLT[12],uSizesLT[12];
uniform vec4 uShapesLT[12],uParamsLT[12]; // type, medium, cos(rotation), sin(rotation)
const float EPS=.00015;
vec3 rotateLT(vec3 p,float c,float s){return vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);}
vec3 localLT(int i,vec3 p){return rotateLT(p-uCentersLT[i],uShapesLT[i].z,-uShapesLT[i].w);}
float waveLT(vec2 p,vec2 a){return a.x*(.55*sin(2.8*p.x+.8*p.y+a.y)+.3*sin(-1.5*p.x+3.6*p.y+1.24*a.y)+.15*cos(4.5*p.x-2.4*p.y-.81*a.y));}
float fieldLT(int i,vec3 p){
 vec3 s=uSizesLT[i];vec4 a=uParamsLT[i];int type=int(uShapesLT[i].x);
 if(type==0)return length(p)-s.x;
 if(type==1){vec3 q=abs(p)-s;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
 if(type==2)return max(max(abs(p.x)-s.x,abs(p.z)-s.z),max(-s.y-p.y,p.y-s.y-waveLT(p.xz,a.xy)));
 if(type==6)return max(max(abs(p.x)-s.x,-p.y-s.y),a.x*p.y+a.y*abs(p.z)-a.x*s.y);
 if(type==5)return abs(p.z-a.x*dot(p.xy,p.xy));
 float shift=type==3?sqrt(a.x*a.x-s.x*s.x)-a.y:a.x+a.y;
 float d1=length(p-vec3(0,0,shift))-a.x,d2=length(p+vec3(0,0,shift))-a.x;
 return type==3?max(length(p.xy)-s.x,max(d1,d2)):max(max(length(p.xy)-s.x,abs(p.z)-s.z),max(-d1,-d2));
}
int mediumLT(vec3 p){int m=0;for(int i=0;i<12;i++){if(i>=uVolumeCount)break;if(int(uShapesLT[i].x)!=5&&fieldLT(i,localLT(i,p))<0.)m=int(uShapesLT[i].y);}return m;}
// Stable q-form avoids cancellation for nearly collimated parabola rays and
// near-surface roots. The naive (-b + sqrt(discriminant))/a invented mirror hits.
vec2 quadraticLT(float a,float b,float c){if(abs(a)<1e-10)return abs(b)<1e-10?vec2(1e6):vec2(-c/(2.*b));float disc=b*b-a*c;if(disc<0.)return vec2(1e6);float q=-b-(b<0.?-1.:1.)*sqrt(disc);if(abs(q)<1e-20)return vec2(-b/a);vec2 t=vec2(q/a,c/q);return vec2(min(t.x,t.y),max(t.x,t.y));}
vec2 boxLT(vec3 o,vec3 d,vec3 s){float near=-1e5,far=1e5;for(int k=0;k<3;k++){if(abs(d[k])<1e-9){if(abs(o[k])>s[k])return vec2(1e6,-1e6);}else{float a=(-s[k]-o[k])/d[k],b=(s[k]-o[k])/d[k];near=max(near,min(a,b));far=min(far,max(a,b));}}return vec2(near,far);}
struct HitLT{float t;int id;vec3 p;vec3 n;int before;int after;};
void offerLT(float t,int i,vec3 o,vec3 d,inout HitLT hit){
 if(t<EPS||t>=hit.t)return;
 if(hit.id>=100&&t>=hit.t-.001&&abs(fieldLT(i,o+d*hit.t))<.00001)return;vec3 q=o+d*t;int type=int(uShapesLT[i].x);
 if(type==5){if(length(q.xy)>uSizesLT[i].x)return;}
 else{if(abs(fieldLT(i,q))>.002)return;if((fieldLT(i,q-d*EPS*2.)<0.)==(fieldLT(i,q+d*EPS*2.)<0.))return;}
 hit.t=t;hit.id=i;
}
HitLT nearestLT(vec3 origin,vec3 direction){
 HitLT h;h.t=60.;h.id=-1;h.before=0;h.after=0;h.n=vec3(0,1,0);
 if(direction.y<-.00000001){float t=-origin.y/direction.y;vec3 p=origin+direction*t;if(t>EPS&&abs(p.x)<6.&&abs(p.z)<6.){h.t=t;h.id=100;}}
 if(direction.z<-.00000001){float t=(-5.8-origin.z)/direction.z;vec3 p=origin+direction*t;if(t>EPS&&t<h.t&&abs(p.x)<6.&&p.y>=0.&&p.y<6.){h.t=t;h.id=101;h.n=vec3(0,0,1);}}
 for(int i=0;i<12;i++){
  if(i>=uVolumeCount)break;vec3 o=localLT(i,origin),d=rotateLT(direction,uShapesLT[i].z,-uShapesLT[i].w),s=uSizesLT[i];int type=int(uShapesLT[i].x);vec4 a=uParamsLT[i];vec2 ts;
  // A conservative bound avoids wave marching or CSG roots for distant rays.
  vec3 bound=type==2?vec3(s.x,s.y+a.x,s.z):s;ts=boxLT(o,d,bound);
  if(ts.x>ts.y||ts.y<EPS||ts.x>h.t)continue;
  if(type==0){ts=quadraticLT(dot(d,d),dot(o,d),dot(o,o)-s.x*s.x);offerLT(ts.x,i,o,d,h);offerLT(ts.y,i,o,d,h);}
  else if(type==1){offerLT(ts.x,i,o,d,h);offerLT(ts.y,i,o,d,h);}
  else if(type==6){
   if(abs(d.x)>1e-8){offerLT((-s.x-o.x)/d.x,i,o,d,h);offerLT((s.x-o.x)/d.x,i,o,d,h);}
   if(abs(d.y)>1e-8)offerLT((-s.y-o.y)/d.y,i,o,d,h);
   float den=a.x*d.y+a.y*d.z;if(abs(den)>1e-8)offerLT((a.x*s.y-a.x*o.y-a.y*o.z)/den,i,o,d,h);
   den=a.x*d.y-a.y*d.z;if(abs(den)>1e-8)offerLT((a.x*s.y-a.x*o.y+a.y*o.z)/den,i,o,d,h);
  }
  else if(type==2){float t=max(EPS,ts.x),end=min(ts.y+.001,h.t);for(int j=0;j<100;j++){if(t>end)break;float f=fieldLT(i,o+d*t);if(abs(f)<.00008){float old=h.t;offerLT(t,i,o,d,h);if(h.t<old)break;t+=EPS*6.;}else t+=max(EPS,abs(f)/(1.+4.*a.x));}}
  else if(type==5){ts=quadraticLT(-a.x*dot(d.xy,d.xy),(d.z-2.*a.x*dot(o.xy,d.xy))*.5,o.z-a.x*dot(o.xy,o.xy));offerLT(ts.x,i,o,d,h);offerLT(ts.y,i,o,d,h);}
  else{
   float shift=type==3?sqrt(a.x*a.x-s.x*s.x)-a.y:a.x+a.y;
   vec3 q=o-vec3(0,0,shift);ts=quadraticLT(dot(d,d),dot(q,d),dot(q,q)-a.x*a.x);offerLT(ts.x,i,o,d,h);offerLT(ts.y,i,o,d,h);
   q=o+vec3(0,0,shift);ts=quadraticLT(dot(d,d),dot(q,d),dot(q,q)-a.x*a.x);offerLT(ts.x,i,o,d,h);offerLT(ts.y,i,o,d,h);
   ts=quadraticLT(dot(d.xy,d.xy),dot(o.xy,d.xy),dot(o.xy,o.xy)-s.x*s.x);offerLT(ts.x,i,o,d,h);offerLT(ts.y,i,o,d,h);
   if(abs(d.z)>1e-8){offerLT((-s.z-o.z)/d.z,i,o,d,h);offerLT((s.z-o.z)/d.z,i,o,d,h);}
  }
 }
 h.p=origin+direction*h.t;
 if(h.id>=0&&h.id<100){int i=h.id;vec3 q=localLT(i,h.p);vec3 e=vec3(.0001,0,0);
  vec3 n=int(uShapesLT[i].x)==5?vec3(-2.*uParamsLT[i].x*q.xy,1.):vec3(fieldLT(i,q+e.xyy)-fieldLT(i,q-e.xyy),fieldLT(i,q+e.yxy)-fieldLT(i,q-e.yxy),fieldLT(i,q+e.yyx)-fieldLT(i,q-e.yyx));
  h.n=normalize(rotateLT(n,uShapesLT[i].z,uShapesLT[i].w));if(dot(h.n,direction)>0.)h.n=-h.n;
  h.before=mediumLT(h.p-direction*EPS*2.);h.after=mediumLT(h.p+direction*EPS*2.);
 }
 return h;
}
`;

export const LIGHT_MEDIA_GLSL=`
vec3 absorptionLT(int m){return m==1?vec3(.018,.009,.005):m==2?vec3(.20,.055,.022):vec3(0);}
float iorLT(int m,int channel){if(m==0)return 1.;if(!uDispersion)return m==1?1.52:1.333;return m==1?(channel==0?1.513:channel==1?1.52:1.535):(channel==0?1.331:channel==1?1.334:1.34);}
float fresnelLT(float c,float ni,float nt){float s=ni*ni/(nt*nt)*(1.-c*c);if(s>=1.)return 1.;float t=sqrt(1.-s),rs=(ni*c-nt*t)/(ni*c+nt*t),rp=(nt*c-ni*t)/(nt*c+ni*t);return .5*(rs*rs+rp*rp);}
`;

export const LIGHT_CACHE_FRAGMENT=`precision highp float;
in vec2 vUv;layout(location=0) out vec4 outRadiance;layout(location=1) out vec4 outHit;
uniform mat4 uInverseProjection,uCameraMatrix;uniform vec3 uEye,uEnvironmentLT[16];uniform int uSHDegree,uLightView;uniform bool uDispersion,uReflections;
uniform sampler2D uDirectLT,uCausticLT;
${SH_GLSL}
${LIGHT_BOUNDARIES_GLSL}
vec3 environmentLT(vec3 d){float b[16];basisSH(d,b);vec3 c=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;c+=b[i]*uEnvironmentLT[i];}return max(c,vec3(.005));}
${LIGHT_MEDIA_GLSL}
float checkerIntegralLT(float x){return 1.-abs(mod(x,2.)-1.);}
vec3 receiverLT(HitLT h){
 vec2 uv=h.id==100?(h.p.xz+6.)/12.:vec2((h.p.x+6.)/12.,h.p.y/6.);uv.y=(uv.y+float(h.id-100))*.5;
 vec3 flux=vec3(0);if(uLightView!=2)flux+=texture(uDirectLT,uv).rgb;if(uLightView!=1)flux+=texture(uCausticLT,uv).rgb;
 vec2 grid=(h.id==100?h.p.xz:h.p.xy)*2.;vec2 w=max(fwidth(grid),vec2(.002));
 vec2 wave=vec2(checkerIntegralLT(grid.x+w.x)-checkerIntegralLT(grid.x-w.x),checkerIntegralLT(grid.y+w.y)-checkerIntegralLT(grid.y-w.y))/(2.*w);
 float checker=.5-.5*wave.x*wave.y;vec3 albedo=mix(vec3(.32,.38,.40),vec3(.72,.73,.68),checker);
 return uLightView==2?flux/3.141593:albedo*(flux/3.141593+vec3(.07));
}
// Two deterministic paths: the main transmitted path and its strongest first
// reflection. Both paths trace the scene; total internal reflections stay on
// their current path. Deeper dielectric branch splitting is intentionally bounded.
vec3 transportLT(vec3 origin,vec3 direction,int channel,out vec4 primary){
 vec3 sum=vec3(0),throughput=vec3(1),secondaryO=origin,secondaryD=direction,secondaryW=vec3(0);bool hasSecondary=false;primary=vec4(-1,60,0,0);
 for(int branch=0;branch<2;branch++){
  if(branch==1){if(!hasSecondary)break;origin=secondaryO;direction=secondaryD;throughput=secondaryW;}
  for(int depth=0;depth<32;depth++){
   HitLT h=nearestLT(origin,direction);if(h.id<0){sum+=throughput*environmentLT(direction);break;}
   throughput*=exp(-absorptionLT(mediumLT(origin))*h.t);
   if(h.id<100&&int(uShapesLT[h.id].x)!=5&&h.before==h.after){origin=h.p+direction*EPS*3.;continue;}
   if(branch==0&&primary.x<0.)primary=vec4(float(h.id),length(h.p-uEye),h.n.xy);
   if(h.id>=100){sum+=throughput*receiverLT(h);break;}
   if(int(uShapesLT[h.id].x)==5){direction=reflect(direction,h.n);throughput*=.95;}
   else{
    float ni=iorLT(h.before,channel),nt=iorLT(h.after,channel),F=fresnelLT(max(0.,-dot(direction,h.n)),ni,nt);vec3 transmitted=refract(direction,h.n,ni/nt),reflected=reflect(direction,h.n);
    if(dot(transmitted,transmitted)<.1){direction=reflected;}
    else{
     if(branch==0&&uReflections&&F>0.0001){vec3 weight=throughput*F;
      if(!hasSecondary){secondaryO=h.p+reflected*EPS*3.;secondaryD=reflected;secondaryW=weight;hasSecondary=true;}
      else sum+=weight*environmentLT(reflected); // remaining reflection budget: SH environment approximation
     }
     throughput*=1.-F;direction=normalize(transmitted);
    }
   }
   origin=h.p+direction*EPS*3.;if(max(throughput.r,max(throughput.g,throughput.b))<.001)break;
  }
 }
 return sum;
}
void main(){vec4 h=uInverseProjection*vec4(vUv*2.-1.,1,1);vec3 d=normalize(mat3(uCameraMatrix)*(h.xyz/h.w));vec4 primary;vec3 c;
 if(uDispersion){vec4 unused;c.r=transportLT(uEye,d,0,unused).r;c.g=transportLT(uEye,d,1,primary).g;c.b=transportLT(uEye,d,2,unused).b;}else c=transportLT(uEye,d,1,primary);
 outRadiance=vec4(c,1);outHit=primary;
}`;

// Reuse the exact 3D covariance projection, including pixel-filter determinant
// compensation and continuous Gaussian tails, used in test 08.
export const LIGHT_SPLAT_VERTEX=OPTICS_MOMENTS_VERTEX
 .replace('in vec4 aCenter,aCov0,aCov1,aNormal;','in vec4 aCenter,aCov0,aCov1,aNormal;\nin float aObject;flat out float vObject;')
 .replace('||dot(aNormal.xyz,uEye-center)<-.02','')
 .replace('vNormal=aNormal.xyz;','vObject=aObject;vNormal=aNormal.xyz;');
export const LIGHT_SPLAT_FRAGMENT=`precision highp float;
in vec2 vGaussian;in float vTau;in vec3 vNormal;flat in float vObject;
uniform sampler2D uRadianceLT,uHitLT;uniform vec2 uResolution;uniform int uView;out vec4 outColor;
void main(){vec2 uv=gl_FragCoord.xy/uResolution;float id=texture(uHitLT,uv).r;if(abs(id-vObject)>.25)discard;
 float density=vTau*exp(-.5*dot(vGaussian,vGaussian));if(density<.0001)discard;float alpha=1.-exp(-density);
 vec3 color=texture(uRadianceLT,uv).rgb;if(uView==1)color=normalize(vNormal)*.5+.5;if(uView==2)color=vec3(.15,.5,.85)*min(density,1.);
 outColor=vec4(color*alpha,alpha);
}`;
export const LIGHT_BACKDROP_FRAGMENT=`precision highp float;in vec2 vUv;uniform sampler2D uRadianceLT,uHitLT;out vec4 outColor;void main(){outColor=vec4(texture(uHitLT,vUv).r<0.?texture(uRadianceLT,vUv).rgb:vec3(.015,.02,.025),1);}`;
export const LIGHT_PATH_VERTEX=LIGHT_SPLAT_VERTEX.replace('flat out float vObject;','flat out float vObject;out vec3 vCenter;').replace('vObject=aObject;','vCenter=aCenter.xyz;vObject=aObject;');
export const LIGHT_PATH_FRAGMENT=`precision highp float;in vec2 vGaussian;in float vTau;flat in float vObject;out vec4 outColor;
void main(){if(abs(vGaussian.x)>1.73205)discard;float density=vTau*exp(-.5*dot(vGaussian,vGaussian));if(density<.001)discard;float alpha=(1.-exp(-density))*.55;vec3 c=vObject<.5?vec3(1,.07,.025):vObject<1.5?vec3(.1,1,.1):vec3(.09,.22,1);outColor=vec4(c*alpha*2.,alpha);}`;
