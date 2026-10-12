import { SH_GLSL } from './shaders.js';
import { GRAVEL_FRAME_GLSL } from './grain-appearance.js';

const lighting=`
${SH_GLSL}
vec3 grainEnvironment(vec3 d,float rough){float b[16];basisSH(d,b);vec3 c=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;float band=i==0?0.:i<4?1.:i<9?2.:3.;c+=uWaterSH[i]*b[i]*exp(-band*(band+1.)*rough*rough*.35);}return max(c,vec3(0));}
vec4 grainNoise(vec3 p){
 vec3 i=floor(p),t=fract(p),f=t*t*(3.-2.*t),df=6.*t*(1.-t);float n=dot(i,vec3(127.1,311.7,74.7));
 vec4 a=fract(sin(n+vec4(0,127.1,311.7,438.8))*43758.5453),b=fract(sin(n+vec4(74.7,201.8,386.4,513.5))*43758.5453);
 float lo=mix(mix(a.x,a.y,f.x),mix(a.z,a.w,f.x),f.y),hi=mix(mix(b.x,b.y,f.x),mix(b.z,b.w,f.x),f.y);
 float dx=mix(mix(a.y-a.x,a.w-a.z,f.y),mix(b.y-b.x,b.w-b.z,f.y),f.z)*df.x;
 float dy=mix(mix(a.z-a.x,a.w-a.y,f.x),mix(b.z-b.x,b.w-b.y,f.x),f.z)*df.y;
 return vec4(mix(lo,hi,f.z),dx,dy,(hi-lo)*df.z);
}
float noiseGrain(vec3 p){return grainNoise(p).x;}

vec3 shadeGrain(vec3 p,vec3 n,vec3 base,float rough,float f0,float occlusion){
 vec3 v=normalize(uEye-p),l=normalize(uLight),h=normalize(v+l);float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,h),0.),vh=max(dot(v,h),0.);
 float a=max(rough*rough,.045),a2=a*a,den=nh*nh*(a2-1.)+1.,D=a2/(3.141593*den*den);
 float gv=2.*nv/(nv+sqrt(a2+(1.-a2)*nv*nv)),gl=2.*nl/max(nl+sqrt(a2+(1.-a2)*nl*nl),.001);
 float F=f0+(1.-f0)*pow(1.-vh,5.),envF=f0+(1.-f0)*pow(1.-nv,5.);
 vec3 diffuse=base*(vec3(.12)+grainEnvironment(n,1.)*.34+vec3(1.15,1.08,.93)*nl*.75)*(1.-f0)*occlusion;
 vec3 specular=vec3(2.8,2.65,2.4)*D*gv*gl*F/max(4.*nv,.001);
 if(uReflections)specular+=grainEnvironment(reflect(-v,n),rough)*envF*occlusion;
 return diffuse+specular;
}
vec3 grainRay(vec2 uv){vec4 q=uInverseProjection*vec4(uv*2.-1.,1,1);return normalize(mat3(uCameraMatrix)*(q.xyz/q.w));}
bool grainBehindBall(vec3 ray,float distance){vec3 q=uEye-uBall;float b=dot(q,ray),disc=b*b-dot(q,q)+uBallRadius*uBallRadius;return disc>0.&&b<0.&&-b-sqrt(disc)<distance;}
`;

export const GRAVEL_FRAGMENT=`precision highp float;
uniform vec2 uResolution;uniform vec3 uEye,uLight,uBall,uWaterSH[16];uniform float uBallRadius;
uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;uniform int uSHDegree,uView;uniform bool uReflections;uniform vec3 uGrainBase[3];uniform float uGrainRoughness[3];
in vec2 vGaussian;in vec3 vCenter;in float vTau,vKind,vGrainSeed,vRadius;out vec4 outColor;
${GRAVEL_FRAME_GLSL}
${lighting}
void main(){
 if(vKind>.5)discard;
 float density=vTau*exp(-.5*dot(vGaussian,vGaussian));if(density<.001)discard;
 vec3 ray=grainRay(gl_FragCoord.xy/uResolution),scale=gravelScale(vGrainSeed,vRadius);mat3 frame=gravelFrame(vGrainSeed);
 vec3 o=transpose(frame)*(uEye-vCenter)/scale,d=transpose(frame)*ray/scale;float enter=-1e6,exit=1e6;vec3 normal=vec3(0,1,0);
 // A fixed, world-oriented clipped stone. The Gaussian supplies its optical
 // density; this invisible support prevents wide tails leaking through corners.
 for(int i=0;i<14;i++){
  vec3 n;float limit;
  if(i<6){n=vec3(0);n[i/2]=i%2==0?1.:-1.;limit=1.;}
  else{int k=i-6;n=vec3((k&1)==0?1.:-1.,(k&2)==0?1.:-1.,(k&4)==0?1.:-1.);limit=1.65+.16*sin(vGrainSeed*23.+float(k)*2.);}
  float den=dot(n,d),dist=limit-dot(n,o);if(abs(den)<1e-8){if(dist<0.)discard;continue;}
  float t=dist/den;if(den<0.){if(t>enter){enter=t;normal=n;}}else exit=min(exit,t);
 }
 if(enter>exit||exit<0.)discard;float distance=max(enter,0.);if(grainBehindBall(ray,distance))discard;
 vec3 p=uEye+ray*distance,n=normalize(frame*(normal/scale));
 float grit=noiseGrain((transpose(frame)*(p-vCenter)/vRadius)*12.);float detail=1.-smoothstep(.15,.7,length(fwidth(p))*65.);
 vec3 base=uGrainBase[0]*mix(vec3(.68,.72,.76),vec3(1.25,1.15,1.02),vGrainSeed)*(.95+(grit-.5)*.18*detail);
 vec3 color=shadeGrain(p,n,base,uGrainRoughness[0],.035,.86);
 if(uView==1)color=n*.5+.5;if(uView==2)color=vec3(.15,.5,.85)*min(density,1.);
 float alpha=1.-exp(-density);vec4 clip=uProjection*uViewMatrix*vec4(p,1.);gl_FragDepth=clip.z/clip.w*.5+.5;outColor=vec4(color*alpha,alpha);
}`;

// Separate moments for sand and mud. Near-surface weighting suppresses buried
// layers, while overlapping Gaussian density joins coarse parcels into a skin.
export const GRAIN_DEPTH_FRAGMENT=`precision highp float;
in vec2 vGaussian;in float vTau,vLinearDepth,vSigma,vKind;
layout(location=0) out vec4 sand;layout(location=1) out vec4 mud;
void main(){sand=vec4(10000);mud=vec4(10000);if(vKind<.5)discard;float q=dot(vGaussian,vGaussian),mass=vTau*exp(-q*.5);if(mass<.02)discard;float depth=vLinearDepth-vSigma*.8*exp(-q*.125);if(vKind<1.5)sand=vec4(depth);else mud=vec4(depth);}`;

export const GRAIN_MOMENTS_FRAGMENT=`precision highp float;
uniform sampler2D uSandFront,uMudFront;uniform vec2 uGrainResolution;
in vec2 vGaussian;in float vTau,vLinearDepth,vSigma,vKind,vGrainSeed;
layout(location=0) out vec4 sand;layout(location=1) out vec4 mud;
void main(){sand=vec4(0);mud=vec4(0);if(vKind<.5)discard;float q=dot(vGaussian,vGaussian),mass=vTau*exp(-q*.5);if(mass<.0001)discard;
 float depth=vLinearDepth-vSigma*.8*exp(-q*.125);vec2 uv=gl_FragCoord.xy/uGrainResolution;float front=vKind<1.5?texture(uSandFront,uv).r:texture(uMudFront,uv).r;float weight=mass*exp(clamp(-(depth-front)*6.,-30.,10.));
 vec4 m=vec4(weight,depth*weight,mass,vGrainSeed*weight);if(vKind<1.5)sand=m;else mud=m;
}`;

// Bilateral depth-field reconstruction, not a blur of the rendered image.
// Three fixed passes retain silhouettes and suppress parcel-scale normal spikes.
export const GRAIN_SMOOTH_FRAGMENT=`precision highp float;
in vec2 vUv;uniform sampler2D uSand,uMud;uniform vec2 uGrainResolution;
layout(location=0) out vec4 sand;layout(location=1) out vec4 mud;
vec4 smoothField(sampler2D field,float radius,float range){
 vec4 m=texture(field,vUv);if(m.x<1e-15||m.z<.02)return m;float center=m.y/m.x,total=0.,depth=0.;
 for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
  vec2 offset=vec2(x,y)*radius/uGrainResolution;vec4 tap=texture(field,vUv+offset);if(tap.z<.02||tap.x<1e-15)continue;
  float z=tap.y/tap.x,delta=(z-center)/range,w=exp(-.5*float(x*x+y*y)-delta*delta*.5);
  total+=w;depth+=z*w;
 }
 return vec4(m.x,depth/max(total,1e-10)*m.x,m.z,m.w);
}
void main(){sand=smoothField(uSand,1.3,.10);mud=smoothField(uMud,2.,.19);}`;

export const GRAIN_SURFACE_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;
uniform sampler2D uSand,uMud,uTerrainDepthTexture;
uniform vec2 uResolution,uGrainResolution;uniform vec3 uEye,uLight,uBall,uWaterSH[16];uniform float uBallRadius,uMudWetness;
uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;uniform int uSHDegree,uView;uniform bool uReflections;uniform vec3 uGrainBase[3];uniform float uGrainRoughness[3];
${lighting}
vec3 grainPosition(vec2 uv,float depth){vec3 ray=grainRay(uv);return uEye+ray*depth/max(dot(ray,-uCameraMatrix[2].xyz),.01);}
vec3 neighborPosition(sampler2D field,vec2 uv,float depth){vec4 m=texture(field,uv);float z=m.z>.035&&m.x>1e-15?m.y/m.x:depth;return grainPosition(uv,z);}
vec3 normalAt(sampler2D field,float depth){vec2 dx=vec2(1.5,0)/uGrainResolution,dy=vec2(0,1.5)/uGrainResolution;
 vec3 p=grainPosition(vUv,depth),l=neighborPosition(field,vUv-dx,depth),r=neighborPosition(field,vUv+dx,depth),d=neighborPosition(field,vUv-dy,depth),u=neighborPosition(field,vUv+dy,depth);
 vec3 n=normalize(cross(r-l,u-d));if(any(isnan(n)))n=vec3(0,1,0);if(dot(n,uEye-p)<0.)n=-n;return n;
}
void main(){
 vec4 sand=texture(uSand,vUv),mud=texture(uMud,vUv);float sd=sand.z>.035&&sand.x>1e-15?sand.y/sand.x:1e5,md=mud.z>.035&&mud.x>1e-15?mud.y/mud.x:1e5;
 bool wet=md<sd;vec4 m=wet?mud:sand;float depth=min(sd,md);if(m.z<.02||m.x<1e-15)discard;
 vec3 p=grainPosition(vUv,depth),ray=grainRay(vUv);if(grainBehindBall(ray,length(p-uEye)))discard;
 vec4 ground=uInverseProjection*vec4(vUv*2.-1.,texture(uTerrainDepthTexture,vUv).r*2.-1.,1.);float groundDepth=-ground.z/ground.w;if(depth>groundDepth)discard;
 vec3 n=wet?normalAt(uMud,depth):normalAt(uSand,depth);float seed=m.w/m.x;
 // Resolve sand's fine grains only when the pixel footprint can support them.
 // The coarse physical parcels never become centimetre-sized shiny beads.
 float frequency=wet?18.:95.,detail=1.-smoothstep(.25,1.2,length(fwidth(p))*frequency);vec4 textureSample=grainNoise(p*frequency);
 vec3 base=wet?uGrainBase[2]*mix(1.,.38,uMudWetness):uGrainBase[1];
 base*=.92+.16*seed;base*=1.+(textureSample.x-.5)*(wet?.24:.48)*detail;
 vec3 gradient=textureSample.yzw;n=normalize(n-(gradient-n*dot(n,gradient))*(wet?.10:.11)*detail);
 float rough=wet?mix(.85,uGrainRoughness[2],uMudWetness):uGrainRoughness[1];
 rough+=wet?((noiseGrain(p*3.5)-.5)*.08+(textureSample.x-.5)*.22*detail):0.;rough=clamp(rough,.2,1.);float f0=wet?mix(.035,.0204,uMudWetness):.025;
 float occlusion=mix(.90,1.,max(n.y,0.));vec3 color=shadeGrain(p,n,base,rough,f0,occlusion);
 if(uView==1)color=n*.5+.5;if(uView==2)color=vec3(.15,.5,.85)*min(m.z,1.);
 float alpha=smoothstep(.035,.22,m.z)*(1.-exp(-m.z*12.))*smoothstep(0.,.025,groundDepth-depth);
 vec4 clip=uProjection*uViewMatrix*vec4(p,1.);gl_FragDepth=clip.z/clip.w*.5+.5;outColor=vec4(color*alpha,alpha);
}`;
