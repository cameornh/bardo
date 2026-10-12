import { GRASS_RAY_GLSL } from './grass-ray.js';
import { BEACH_WORLD_GLSL } from './beach-model.js';
import { WATER_MATERIAL_GLSL } from './water-material.js';
import { SAND_MATERIAL_GLSL } from './sand-material.js';
import { SH_GLSL } from './shaders.js';

export const BEACH_ATMOSPHERE_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;uniform vec3 uSun,uMoon;uniform float uDaylight;
vec2 sphere(vec3 o,vec3 d,float r){float b=dot(o,d),c=dot(o,o)-r*r,q=b*b-c;return q<0.?vec2(-1):vec2(-b-sqrt(q),-b+sqrt(q));}
vec3 atmosphere(vec3 ray,vec3 light){
 vec3 origin=vec3(0,6360.02,0);vec2 boundary=sphere(origin,ray,6460.);float end=boundary.y;vec2 ground=sphere(origin,ray,6360.);if(ground.x>0.)end=min(end,ground.x);
 vec3 sumR=vec3(0),sumM=vec3(0);float odR=0.,odM=0.,step=end/12.;const vec3 beta=vec3(.0058,.0135,.0331);const float mie=.003;
 for(int i=0;i<12;i++){vec3 p=origin+ray*(float(i)+.5)*step;float height=max(0.,length(p)-6360.),r=exp(-height/8.)*step,m=exp(-height/1.2)*step;odR+=r;odM+=m;
  float toLight=sphere(p,light,6460.).y,ds=toLight/5.,lr=0.,lm=0.;bool shadow=false;
  for(int j=0;j<5;j++){float h=length(p+light*(float(j)+.5)*ds)-6360.;if(h<0.)shadow=true;lr+=exp(-max(0.,h)/8.)*ds;lm+=exp(-max(0.,h)/1.2)*ds;}
  vec3 transmission=shadow?vec3(0):exp(-beta*(odR-r*.5+lr)-mie*(odM-m*.5+lm));sumR+=r*transmission;sumM+=m*transmission;
 }
 float mu=dot(ray,light),rayleigh=3./(16.*3.141593)*(1.+mu*mu),g=.76,phaseM=3./(8.*3.141593)*((1.-g*g)*(1.+mu*mu))/((2.+g*g)*pow(1.+g*g-2.*g*mu,1.5));
 return 22.*(sumR*beta*rayleigh+sumM*mie*phaseM);
}
void main(){float phi=(vUv.x-.5)*6.283185,theta=(vUv.y-.5)*3.141593;vec3 ray=vec3(cos(theta)*sin(phi),sin(theta),cos(theta)*cos(phi));
 vec3 color=atmosphere(ray,uSun)+atmosphere(ray,uMoon)*.012+vec3(.0006,.0009,.0018);
 outColor=vec4(color,1);}
`;

const world=`
uniform sampler2D uFlow,uAux,uBed,uSky,uHits,uSceneTexture;
uniform bool uFieldLinear,uReflections;uniform vec2 uOrigin,uResolution;uniform float uDx,uN,uClock,uWind,uWindAngle,uTurbidity,uWaterRoughness,uDaylight;
uniform vec3 uEye,uSun,uMoon,uSunColor,uMoonColor,uBeachSH[16];uniform int uSHDegree,uView,uBallCount;
uniform vec4 uBalls[12];uniform mat4 uProjection,uViewMatrix,uInverseProjection,uCameraMatrix;
${BEACH_WORLD_GLSL}
${WATER_MATERIAL_GLSL}
${SAND_MATERIAL_GLSL}
${SH_GLSL}
vec4 field(sampler2D tex,vec2 p){if(uFieldLinear)return texture(tex,(p-uOrigin)/(uN*uDx));vec2 q=(p-uOrigin)/uDx-.5;ivec2 i=ivec2(floor(q));vec2 t=fract(q);ivec2 hi=ivec2(int(uN)-1);return mix(mix(texelFetch(tex,clamp(i,ivec2(0),hi),0),texelFetch(tex,clamp(i+ivec2(1,0),ivec2(0),hi),0),t.x),mix(texelFetch(tex,clamp(i+ivec2(0,1),ivec2(0),hi),0),texelFetch(tex,clamp(i+ivec2(1,1),ivec2(0),hi),0),t.x),t.y);}
float localWeight(vec2 p){vec2 q=(p-uOrigin)/uDx;return smoothstep(1.,5.,min(min(q.x,q.y),min(uN-q.x,uN-q.y)));}
float groundHeight(vec2 p){float w=localWeight(p);if(w<=0.)return beachBed(p);return mix(beachBed(p),field(uBed,p).r+field(uAux,p).w,w);}
vec4 waterState(vec2 p){float bed=groundHeight(p),wave=incomingWave(p,uClock,uWind,uWindAngle);
 // Filter unresolved boundary waves over the projected pixel footprint. At
 // grazing angles a single pixel spans many metres; tracing each wave there
 // aliases into alternating strips. The simulation itself remains unchanged.
 float distance=length(p-uEye.xz),footprint=distance*distance/(max(1.,uResolution.y*uProjection[1][1])*max(1.,uEye.y));
 wave*=exp(-.5*pow(6.283185*footprint/20.,2.));
 float h=max(0.,wave-bed);vec4 far=vec4(h,0,0,0);float w=localWeight(p);if(w<=0.)return far;return mix(far,field(uFlow,p),w);}
float surfaceHeight(vec2 p,int layer){float bed=groundHeight(p);return bed+(layer==1?waterState(p).x:0.);}
vec3 surfaceNormal(vec2 p,int layer,float eps){return normalize(vec3(surfaceHeight(p-vec2(eps,0),layer)-surfaceHeight(p+vec2(eps,0),layer),2.*eps,surfaceHeight(p-vec2(0,eps),layer)-surfaceHeight(p+vec2(0,eps),layer)));}
vec3 sky(vec3 d){d=normalize(d);vec3 color=texture(uSky,vec2(atan(d.x,d.z)/6.283185+.5,asin(clamp(d.y,-1.,1.))/3.141593+.5)).rgb;
 // Discs are evaluated per ray; putting them in the low-resolution atmosphere
 // map makes them vanish between texels or inflate into large blurry spots.
 color+=smoothstep(.999982,.999991,dot(d,uSun))*vec3(18,15,11)*smoothstep(-.025,.04,uSun.y);
 color+=smoothstep(.999982,.999991,dot(d,uMoon))*vec3(.5,.58,.7)*smoothstep(-.02,.03,uMoon.y);return color;}
// Unresolved ground/sea coverage fades into horizon airlight, never the
// unlit lower hemisphere of the sky lookup.
vec3 airlight(vec3 d){d.y=max(.025,d.y);return sky(d);}
vec3 shSky(vec3 d){float basis[16];basisSH(d,basis);vec3 c=vec3(0);for(int k=0;k<16;k++){if(k>=(uSHDegree+1)*(uSHDegree+1))break;float band=k==0?0.:k<4?1.:k<9?2.:3.;c+=basis[k]*uBeachSH[k]*exp(-band*(band+1.)*.15);}return max(c,vec3(.001));}
vec3 rayAt(vec2 uv){vec4 p=uInverseProjection*vec4(uv*2.-1.,1,1);return normalize(mat3(uCameraMatrix)*(p.xyz/p.w));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
float shadow(vec3 p,vec3 light){float visibility=1.;for(int i=0;i<12;i++){if(i>=uBallCount)break;vec3 q=p-uBalls[i].xyz;float b=dot(q,light),d=length(q-light*b);if(b<0.)visibility*=mix(.4,1.,smoothstep(uBalls[i].w*.65,uBalls[i].w*1.35,d));}return visibility;}
vec3 direct(vec3 p,vec3 n){return uSunColor*max(0.,dot(n,uSun))*shadow(p,uSun)+uMoonColor*max(0.,dot(n,uMoon))*shadow(p,uMoon);}
vec3 specular(vec3 p,vec3 n,vec3 v,vec3 l,vec3 energy,float rough,float f0){vec3 h=normalize(l+v);float nv=max(.001,dot(n,v)),nl=max(0.,dot(n,l)),nh=max(0.,dot(n,h)),a=max(.018,rough*rough),a2=a*a,den=nh*nh*(a2-1.)+1.,D=a2/(3.141593*den*den),k=(rough+1.)*(rough+1.)/8.,G=nv/(nv*(1.-k)+k)*nl/max(nl*(1.-k)+k,.001),F=f0+(1.-f0)*pow(1.-max(0.,dot(v,h)),5.);return energy*D*G*F/max(4.*nv,.001)*shadow(p,l);}
vec3 sandColor(vec3 p,vec3 n,float wet){float detail=1.-smoothstep(.012,.065,length(fwidth(p)));vec3 base=sandAlbedo(wet)*(1.+(noise(p.xz*80.)-.5)*.24*detail);vec3 v=normalize(uEye-p);float rough=sandRoughness(wet);vec3 color=base*(direct(p,n)+shSky(n)*.7+vec3(.015));color+=specular(p,n,v,uSun,uSunColor,rough,.025)+specular(p,n,v,uMoon,uMoonColor,rough,.025);color+=(uReflections?sky(reflect(-v,n)):vec3(0))*(.025+.25*pow(1.-max(0.,dot(n,v)),5.))*wet;return color;}
float traceSurface(vec3 origin,vec3 ray,int layer,float maxT);
vec3 waterColor(vec3 p,vec3 n,vec4 state){vec3 v=normalize(uEye-p),r=refract(-v,n,1./WATER_IOR);float path=min(100.,state.x/max(.08,-r.y));vec3 hit=p+r*path;vec4 clip=uProjection*uViewMatrix*vec4(hit,1.);vec2 uv=clip.xy/clip.w*.5+.5;vec3 bottom=sandColor(hit,vec3(0,1,0),1.);if(clip.w>0.&&all(greaterThan(uv,vec2(0)))&&all(lessThan(uv,vec2(1))))bottom=texture(uSceneTexture,uv).rgb;
 float fresnel=waterFresnel(dot(n,v));vec3 illumination=shSky(vec3(0,1,0))*2.+uSunColor*max(0.,uSun.y)+uMoonColor*max(0.,uMoon.y);
 vec3 reflected=reflect(-v,n),reflection=sky(reflected);
 // A grazing reflection can hit another wave or the shore. Resolve one
 // secondary surface instead of sampling the black underside of the sky.
 if(uReflections&&reflected.y<.08){float rt=traceSurface(p+n*.07,reflected,1,100.);if(rt<100.){vec3 q=p+n*.07+reflected*rt;vec4 secondary=waterState(q.xz);vec3 substrate=sandColor(vec3(q.x,groundHeight(q.xz),q.z),surfaceNormal(q.xz,0,.5),1.);reflection=waterVolume(substrate,secondary.x*1.5,uTurbidity,illumination,dot(reflected,uSun));}}
 vec3 color=waterVolume(bottom,path,uTurbidity,illumination,dot(v,uSun));color=color*(1.-fresnel)+(uReflections?reflection*fresnel:vec3(0));
 float rough=mix(uWaterRoughness,.55,state.w);color+=specular(p,n,v,uSun,uSunColor,rough,.02037)+specular(p,n,v,uMoon,uMoonColor,rough,.02037);
 return mix(color,vec3(.82,.86,.84)*(direct(p,n)+shSky(n)*.9),clamp(state.w,0.,1.));}
float traceSurface(vec3 origin,vec3 ray,int layer,float maxT){if(ray.y>.15&&origin.y>3.)return 1e5;float t=.05,last=t;for(int i=0;i<65;i++){vec3 p=origin+ray*t;float d=p.y-surfaceHeight(p.xz,layer);if(d<0.){float a=last,b=t;for(int j=0;j<7;j++){float m=(a+b)*.5;vec3 q=origin+ray*m;if(q.y>surfaceHeight(q.xz,layer))a=m;else b=m;}return (a+b)*.5;}last=t;t+=max(.12,d/max(.15,-ray.y)*.65);if(t>maxT)break;}return 1e5;}
vec3 fogged(vec3 color,vec3 p){float t=1.-exp(-length(p-uEye)*.0007);return mix(color,airlight(normalize(p-uEye)),t);}
`;

export const BEACH_HITS_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;${world}
void main(){vec3 ray=rayAt(vUv);float ground=traceSurface(uEye,ray,0,1800.),water=traceSurface(uEye,ray,1,1800.);vec3 p=uEye+ray*water;if(waterState(p.xz).x<.008)water=1e5;outColor=vec4(ground,water,0,1);}`;
export const BEACH_BACKGROUND_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;${world}
void main(){outColor=vec4(airlight(rayAt(vUv)),1);}`;

export const BEACH_SPLAT_VERTEX=`precision highp float;
in vec4 aPatch,aSeed;out vec2 vGaussian;out vec3 vPoint,vNormal;out float vSigma,vKind,vWeight,vSeed,vWidth;
${world.replaceAll('fwidth(p)','vec3(.02)')}
void main(){vec2 xz=aPatch.xy;float spacing=aPatch.z,kind=aPatch.w;vec3 n=surfaceNormal(xz,int(kind),max(.15,spacing*.25)),p=vec3(xz.x,surfaceHeight(xz,int(kind)),xz.y);float sigma=spacing*.68,thin=sigma*.14;
 if(kind==2.){p.y=groundHeight(xz);float height=aSeed.z,segment=aSeed.y;vec2 wind=beachWind(xz,uClock,uWind,uWindAngle)*(.008*uWind),bend=mix(wind,field(uAux,xz).yz,localWeight(xz));bend+=vec2(sin(uClock*2.+xz.x*.3),cos(uClock*1.7+xz.y*.4))*.08*uWind/7.;float s=(segment+.5)/3.;vec3 tangent=normalize(vec3(bend.x*2.*s,1.,bend.y*2.*s));p+=vec3(bend.x*s*s,s*(1.-.22*min(length(bend),1.)),bend.y*s*s)*height;n=tangent;sigma=height*.21;thin=height*.023;}
 if(kind==3.){vec4 ball=uBalls[int(aSeed.z)];float ring=sqrt(max(0.,1.-aSeed.x*aSeed.x));n=vec3(cos(aSeed.y)*ring,aSeed.x,sin(aSeed.y)*ring);p=ball.xyz+n*ball.w;sigma=spacing*ball.w;thin=sigma*.14;}
 mat3 covariance=kind==2.?mat3(thin*thin)+outerProduct(n,n)*(sigma*sigma-thin*thin):mat3(sigma*sigma)+outerProduct(n,n)*(thin*thin-sigma*sigma);
 vec4 viewP=viewMatrix*vec4(p,1.);float z=max(-viewP.z,.1);mat3 rot=mat3(viewMatrix),c=rot*covariance*transpose(rot);vec2 focal=vec2(projectionMatrix[0][0],projectionMatrix[1][1])*uResolution*.5;
 vec2 slope=clamp(viewP.xy/z,-1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]));vec3 jx=vec3(focal.x/z,0.,focal.x*slope.x/z),jy=vec3(0.,focal.y/z,focal.y*slope.y/z);float A=dot(jx,c*jx)+.3,B=dot(jx,c*jy),C=dot(jy,c*jy)+.3,mid=(A+C)*.5,d=sqrt(max(0.,(A-C)*(A-C)*.25+B*B)),e1=mid+d,e2=max(.01,mid-d);vec2 axis=abs(B)>.00001?normalize(vec2(B,e1-A)):(A>=C?vec2(1,0):vec2(0,1));vec2 delta=3.*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y);
 vec4 clip=projectionMatrix*viewP;clip.xy+=delta*2./uResolution*clip.w;if(viewP.z>-.1)clip=vec4(2,2,2,1);gl_Position=clip;
 vGaussian=position.xy*3.;vPoint=p;vNormal=n;vSigma=sigma;vKind=kind;vWeight=aSeed.w;vSeed=aSeed.x;vWidth=sqrt(thin*thin+.3*pow(z/focal.y,2.));
}`;

export const BEACH_SPLAT_FRAGMENT=`precision highp float;
in vec2 vGaussian;in vec3 vPoint,vNormal;in float vSigma,vKind,vWeight,vSeed,vWidth;out vec4 outColor;
uniform int uPass;${world}
${GRASS_RAY_GLSL}
void main(){if(int(vKind)!=uPass)discard;vec2 uv=gl_FragCoord.xy/uResolution;vec3 ray=rayAt(uv);float density=exp(-.5*dot(vGaussian,vGaussian))*vWeight;if(density<.002)discard;vec2 hits=texture(uHits,uv).rg;
 if(uPass==3){outColor=vec4(0,0,0,density);return;}
 if(uPass==2){
  // Evaluate the actual thin 3D blade Gaussian along this pixel's ray. A
  // near-plane billboard can be huge, but only rays through the blade shade.
  vec2 blade=grassRay(ray,uEye-vPoint,vNormal,vSigma,vWidth);float depth=blade.x;density=blade.y*vWeight*smoothstep(.06,.22,depth);if(density<.002||depth>hits.x+.08)discard;for(int i=0;i<12;i++){if(i>=uBallCount)break;vec3 q=uEye-uBalls[i].xyz;float b=dot(q,ray),disc=b*b-dot(q,q)+uBalls[i].w*uBalls[i].w;if(disc>0.&&-b-sqrt(disc)>0.&&-b-sqrt(disc)<depth)discard;}
  vec3 green=mix(vec3(.065,.12,.018),vec3(.23,.29,.055),vSeed);vec3 color=green*(direct(vPoint,vec3(0,1,0))+shSky(vNormal)*.9);color+=green*max(dot(ray,uSun),0.)*.6*uDaylight;
  if(uView==1)color=vNormal*.5+.5;if(uView==2)color=vec3(.15,.7,.2)*density;float alpha=1.-exp(-density*2.5);outColor=vec4(fogged(color,vPoint)*alpha,alpha);return;}
 float distance=uPass==0?hits.x:hits.y;if(distance>90000.)discard;
 float separation=abs(dot(vPoint-uEye,ray)-distance);density*=1.-smoothstep(max(.25,vSigma*1.5),max(.5,vSigma*4.5),separation);
 outColor=vec4(0,0,0,density);
}`;
export const BEACH_RESOLVE_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;uniform sampler2D uAccum;uniform int uPass;${world}
void main(){vec4 m=texture(uAccum,vUv);if(m.a<.001)discard;vec2 hits=texture(uHits,vUv).rg;float distance=uPass==0?hits.x:hits.y;vec3 p=uEye+rayAt(vUv)*distance;
 float footprint=length(fwidth(p.xz));vec3 n=surfaceNormal(p.xz,uPass,max(.25,footprint*.8));vec4 state=waterState(p.xz);float wet=mix(state.x>.02?1.:0.,field(uAux,p.xz).x,localWeight(p.xz));vec3 color=uPass==0?sandColor(p,n,wet):waterColor(p,n,state);if(uView==1)color=n*.5+.5;if(uView==2)color=vec3(.15,.5,.8)*min(m.a,1.);
 float opacity=uPass==1?smoothstep(.005,.05,state.x):1.;float fade=1.-smoothstep(1100.,1750.,distance);opacity*=fade*(1.-exp(-m.a*3.));outColor=vec4(fogged(color,p)*opacity,opacity);}
`;

export const BEACH_GLASS_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;uniform sampler2D uAccum;${world}
vec2 sphere(vec3 o,vec3 d,vec3 c,float r){vec3 q=o-c;float b=dot(q,d),disc=b*b-dot(q,q)+r*r;return disc<0.?vec2(1e5):vec2(-b-sqrt(disc),-b+sqrt(disc));}
vec3 sceneRay(vec3 o,vec3 d){float land=traceSurface(o,d,0,500.),water=traceSurface(o,d,1,500.);if(min(land,water)>90000.)return sky(d);vec3 p=o+d*min(land,water),n=surfaceNormal(p.xz,water<land?1:0,.25);return fogged(water<land?waterColor(p,n,waterState(p.xz)):sandColor(p,n,field(uAux,p.xz).x),p);}
void main(){vec3 ray=rayAt(vUv);int id=-1;float nearest=1e5;for(int i=0;i<12;i++){if(i>=uBallCount)break;float t=sphere(uEye,ray,uBalls[i].xyz,uBalls[i].w).x;if(t>0.&&t<nearest){id=i;nearest=t;}}
 if(id<0||nearest>texture(uHits,vUv).r)discard;vec4 ball=uBalls[id];vec3 p=uEye+ray*nearest,n=normalize(p-ball.xyz);float outsideIOR=p.y<surfaceHeight(p.xz,1)&&waterState(p.xz).x>.01?WATER_IOR:1.;
 float f0=pow((1.5-outsideIOR)/(1.5+outsideIOR),2.),F=f0+(1.-f0)*pow(1.-max(0.,dot(n,-ray)),5.);vec3 direction=refract(ray,n,outsideIOR/1.5),point=p+direction*.001;float glassPath=0.;
 // Outer glass -> inner air -> glass -> surrounding air/water. Hollow shell.
 for(int j=0;j<3;j++){float radius=j<2?ball.w-.012:ball.w;vec2 roots=sphere(point,direction,ball.xyz,radius);float t=j==0?roots.x:roots.y;if(t<.00001)t=roots.y;if(t>90000.)break;point+=direction*t;vec3 normal=normalize(point-ball.xyz);if(j>0)normal=-normal;float eta=j==0?1.5:j==1?1./1.5:1.5/(point.y<surfaceHeight(point.xz,1)&&waterState(point.xz).x>.01?WATER_IOR:1.);vec3 next=refract(direction,normal,eta);if(dot(next,next)<.01)next=reflect(direction,normal);if(j!=1)glassPath+=t;direction=next;point+=direction*.002;}
 vec3 color=sceneRay(point,direction)*exp(-vec3(.09,.025,.015)*glassPath)*(1.-F)+sceneRay(p+n*.003,reflect(ray,n))*F;
 color+=specular(p,n,-ray,uSun,uSunColor,.065,f0)+specular(p,n,-ray,uMoon,uMoonColor,.065,f0);
 float waterHit=texture(uHits,vUv).g;if(waterHit<nearest){float path=nearest-waterHit;color=waterVolume(color,path,uTurbidity,shSky(vec3(0,1,0))*2.+uSunColor*max(0.,uSun.y),dot(ray,uSun));}
 if(uView==1)color=n*.5+.5;float coverage=1.-exp(-texture(uAccum,vUv).a*3.);outColor=vec4(color*coverage,coverage);}
`;
