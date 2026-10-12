import { GRASS_RAY_GLSL } from './grass-ray.js';
import { BEACH_WORLD_GLSL } from './beach-model.js';
import { BODY_GLSL } from './beach-bodies.js';
import { WATER_MATERIAL_GLSL } from './water-material.js';
import { SAND_MATERIAL_GLSL } from './sand-material.js';
import { SH_GLSL } from './shaders.js';
export const BEACH_ATMOSPHERE_FRAGMENT=`precision highp float;precision highp int;
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

export const BEACH_RENDER_WORLD=`
uniform sampler2D uFlow,uAux,uBed,uOcean,uWaterSurface,uSky,uHits,uSceneTexture,uCaustics,uParticles,uSurfaceCache;
uniform bool uFieldLinear,uReflections,uCausticsEnabled,uGrassFront;uniform vec2 uOrigin,uResolution;
uniform float uDx,uN,uClock,uWind,uWindAngle,uTurbulence,uTurbidity,uWaterRoughness,uDaylight,uJetLength,uCeiling;
uniform vec4 uJetOrigin,uJetDirection;uniform vec2 uPhotonOrigin;uniform float uPhotonSize;
uniform vec3 uEye,uSun,uMoon,uSunColor,uMoonColor,uBeachSH[16];uniform int uSHDegree,uView;
uniform mat4 uProjection,uViewMatrix,uInverseProjection,uCameraMatrix;
${BEACH_WORLD_GLSL}
${BODY_GLSL}
${WATER_MATERIAL_GLSL}
${SAND_MATERIAL_GLSL}
${SH_GLSL}
vec4 fieldRaw(sampler2D tex,vec2 p){vec2 q=(p-uOrigin)/uDx-.5;ivec2 i=ivec2(floor(q));vec2 t=fract(q);ivec2 hi=ivec2(int(uN)-1);return mix(mix(texelFetch(tex,clamp(i,ivec2(0),hi),0),texelFetch(tex,clamp(i+ivec2(1,0),ivec2(0),hi),0),t.x),mix(texelFetch(tex,clamp(i+ivec2(0,1),ivec2(0),hi),0),texelFetch(tex,clamp(i+ivec2(1,1),ivec2(0),hi),0),t.x),t.y);}
vec4 cubic(float f){return vec4(pow(1.-f,3.),3.*f*f*f-6.*f*f+4.,-3.*f*f*f+3.*f*f+3.*f+1.,f*f*f)/6.;}
vec4 field(sampler2D tex,vec2 p){vec2 q=(p-uOrigin)/uDx-.5,i=floor(q),f=fract(q);vec4 x=cubic(f.x),y=cubic(f.y);vec2 gx=vec2(x.x+x.y,x.z+x.w),gy=vec2(y.x+y.y,y.z+y.w),hx=vec2(i.x-1.+x.y/gx.x,i.x+1.+x.w/gx.y),hy=vec2(i.y-1.+y.y/gy.x,i.y+1.+y.w/gy.y);if(uFieldLinear){return texture(tex,(vec2(hx.x,hy.x)+.5)/uN)*gx.x*gy.x+texture(tex,(vec2(hx.y,hy.x)+.5)/uN)*gx.y*gy.x+texture(tex,(vec2(hx.x,hy.y)+.5)/uN)*gx.x*gy.y+texture(tex,(vec2(hx.y,hy.y)+.5)/uN)*gx.y*gy.y;}return fieldRaw(tex,uOrigin+(vec2(hx.x,hy.x)+.5)*uDx)*gx.x*gy.x+fieldRaw(tex,uOrigin+(vec2(hx.y,hy.x)+.5)*uDx)*gx.y*gy.x+fieldRaw(tex,uOrigin+(vec2(hx.x,hy.y)+.5)*uDx)*gx.x*gy.y+fieldRaw(tex,uOrigin+(vec2(hx.y,hy.y)+.5)*uDx)*gx.y*gy.y;}
float localWeight(vec2 p){vec2 q=(p-uOrigin)/uDx;return smoothstep(2.,14.,min(min(q.x,q.y),min(uN-q.x,uN-q.y)));}
#ifdef BEACH_CACHE_BUILD
float soilHeight(vec2 p){float w=localWeight(p);if(w<=0.)return beachBed(p);return beachBed(p)+(field(uBed,p).g+field(uAux,p).w)*w;}
#else
float soilHeight(vec2 p){vec2 uv=(p-uOrigin)/(uN*uDx);return beachBed(p)+(all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1)))?texture(uSurfaceCache,uv).r:0.);}
#endif
float groundHeight(vec2 p){return max(soilHeight(p),rockHeight(p));}
float terrainField(vec3 p){return min((p.y-soilHeight(p.xz))*.35,rockSDF(p));}
#ifdef BEACH_CACHE_BUILD
vec4 waterState(vec2 p){float bed=groundHeight(p);vec4 far=texture(uOcean,fract((p+256.)/512.));float eta=far.x-8.,w=localWeight(p),foam=0.,presence=1.;vec2 velocity=far.yz/max(far.x,.02);
 if(w>0.){vec4 s=field(uWaterSurface,p),local=field(uFlow,p);float localEta=s.y>.0001?s.x/s.y:bed-.1;eta=mix(eta,localEta,w);presence=mix(1.,smoothstep(.0001,.02,s.y),w);velocity=mix(velocity,s.zw/max(s.y,.0001),w);foam=local.w*w;}
 float h=max(0.,eta-bed)*presence;return vec4(h,eta,presence,foam);}
#else
vec4 waterState(vec2 p){vec2 uv=(p-uOrigin)/(uN*uDx);if(all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1)))){vec4 c=texture(uSurfaceCache,uv);float eta=c.g/max(c.b,.0001);return vec4(max(0.,eta-groundHeight(p))*smoothstep(.0001,.02,c.b),0,0,c.a);}vec4 far=texture(uOcean,fract((p+256.)/512.));return vec4(max(0.,far.x-8.-groundHeight(p)),0,0,far.w);}
#endif
float surfaceHeight(vec2 p,int layer){float b=groundHeight(p);return b+(layer==1?waterState(p).x:0.);}
vec3 surfaceNormal(vec2 p,int layer,float eps){if(layer==0){vec3 q=vec3(p.x,groundHeight(p),p.y);return normalize(vec3(terrainField(q+vec3(eps,0,0))-terrainField(q-vec3(eps,0,0)),terrainField(q+vec3(0,eps,0))-terrainField(q-vec3(0,eps,0)),terrainField(q+vec3(0,0,eps))-terrainField(q-vec3(0,0,eps))));}float center=surfaceHeight(p,1);vec2 offset[4]=vec2[4](vec2(-eps,0),vec2(eps,0),vec2(0,-eps),vec2(0,eps));vec4 level;for(int i=0;i<4;i++){vec2 q=p+offset[i];vec4 w=waterState(q);level[i]=w.x>.005?groundHeight(q)+w.x:center;}return normalize(vec3(level.x-level.y,2.*eps,level.z-level.w));}
vec3 sky(vec3 d){d=normalize(d);vec3 color=texture(uSky,vec2(atan(d.x,d.z)/6.283185+.5,asin(clamp(d.y,-1.,1.))/3.141593+.5)).rgb;
 color+=smoothstep(.99993,.99998,dot(d,uSun))*uSunColor*12.;color+=smoothstep(.99991,.99997,dot(d,uMoon))*vec3(.62,.66,.72);return color;}
vec3 airlight(vec3 d){d.y=max(.025,d.y);return sky(d);}
vec3 shSky(vec3 d){float basis[16];basisSH(d,basis);vec3 c=vec3(0);for(int k=0;k<16;k++){if(k>=(uSHDegree+1)*(uSHDegree+1))break;float band=k==0?0.:k<4?1.:k<9?2.:3.;c+=basis[k]*uBeachSH[k]*exp(-band*(band+1.)*.15);}return max(c,vec3(.001));}
vec3 rayAt(vec2 uv){vec4 p=uInverseProjection*vec4(uv*2.-1.,1,1);return normalize(mat3(uCameraMatrix)*(p.xyz/p.w));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
vec2 sphere(vec3 o,vec3 d,vec3 c,float r){vec3 q=o-c;float b=dot(q,d),disc=b*b-dot(q,q)+r*r;return disc<0.?vec2(1e5):vec2(-b-sqrt(disc),-b+sqrt(disc));}
float shadow(vec3 p,vec3 light){float visibility=1.;for(int i=0;i<uBallCount;i++){vec4 ball=body(i);vec3 q=p-ball.xyz;float b=dot(q,light),d=length(q-light*b);if(b<0.)visibility*=mix(.4,1.,smoothstep(ball.w*.65,ball.w*1.35,d));}return visibility;}
vec3 direct(vec3 p,vec3 n){return uSunColor*max(0.,dot(n,uSun))*shadow(p,uSun)+uMoonColor*max(0.,dot(n,uMoon))*shadow(p,uMoon);}
vec3 specular(vec3 p,vec3 n,vec3 v,vec3 l,vec3 energy,float rough,float f0){vec3 h=normalize(l+v);float nv=max(.001,dot(n,v)),nl=max(0.,dot(n,l)),nh=max(0.,dot(n,h)),a=max(.025,rough*rough),a2=a*a,den=nh*nh*(a2-1.)+1.,D=a2/(3.141593*den*den),k=(rough+1.)*(rough+1.)/8.,G=nv/(nv*(1.-k)+k)*nl/max(nl*(1.-k)+k,.001),F=f0+(1.-f0)*pow(1.-max(0.,dot(v,h)),5.);return energy*D*G*F/max(4.*nv,.001)*shadow(p,l);}
float vegetation(vec2 p){float b=beachBed(p);return smoothstep(.7,1.2,b)*(1.-smoothstep(3.3,4.2,b))*smoothstep(.05,.6,rockSDF(vec3(p.x,groundHeight(p),p.y)));}
vec3 sandColor(vec3 p,vec3 n,float wet){float detail=1.-smoothstep(.012,.065,length(fwidth(p)));vec3 base=sandAlbedo(wet)*(1.+(noise(p.xz*60.)-.5)*.13*detail);float rock=1.-smoothstep(.02,.15,abs(rockSDF(p)));base=mix(base,vec3(.19,.20,.18),rock);float meadow=vegetation(p.xz)*smoothstep(75.,180.,length(p-uEye))*.62;base=mix(base,vec3(.10,.16,.035),meadow);vec3 v=normalize(uEye-p);float rough=mix(sandRoughness(wet),.85,max(rock,meadow));vec3 lighting=direct(p,n),extra=vec3(0);
 if(uCausticsEnabled&&localWeight(p.xz)>.01){vec2 uv=(p.xz-uPhotonOrigin)/uPhotonSize;float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y)),coverage=smoothstep(0.,.09,edge);vec3 flux=texture(uCaustics,(p.xz-uOrigin)/(uN*uDx)).rgb*max(.2,n.y);if(waterState(p.xz).x>.015)lighting=mix(lighting,flux,coverage);else extra=flux*coverage;}
 vec3 color=base*(lighting+extra+shSky(n)*.75+vec3(.008));
 color+=specular(p,n,v,uSun,uSunColor,rough,.025)+specular(p,n,v,uMoon,uMoonColor,rough,.025);color+=(uReflections?sky(reflect(-v,n)):vec3(0))*(.025+.2*pow(1.-max(0.,dot(n,v)),5.))*wet*(1.-rock);return color;}
float traceSurface(vec3 origin,vec3 ray,int layer,float maxT){if(ray.y>0.&&origin.y>uCeiling)return 1e5;float t=.03,last=0.;for(int i=0;i<80;i++){vec3 p=origin+ray*t;if(ray.y>0.&&p.y>uCeiling)break;float d=layer==0?terrainField(p):p.y-surfaceHeight(p.xz,1);if(d<.002){float a=last,b=t;for(int j=0;j<8;j++){float m=(a+b)*.5;vec3 q=origin+ray*m;float f=layer==0?terrainField(q):q.y-surfaceHeight(q.xz,1);if(f>0.)a=m;else b=m;}return (a+b)*.5;}last=t;t+=layer==0?max(.06,d):max(.06,d/max(.25,-ray.y)*.7);if(t>maxT)break;}return 1e5;}
vec3 waterColor(vec3 p,vec3 n,vec4 state){vec3 v=normalize(uEye-p),r=refract(-v,n,1./WATER_IOR);float path=min(100.,state.x/max(.08,-r.y));
 for(int i=0;i<3;i++){vec3 q=p+r*path;path=clamp(path+(q.y-groundHeight(q.xz))/max(.1,-r.y)*.7,.001,100.);}
 vec3 hit=p+r*path;hit.y=groundHeight(hit.xz);vec4 clip=uProjection*uViewMatrix*vec4(hit,1.);vec2 uv=clip.xy/clip.w*.5+.5;vec3 bottom=sandColor(hit,surfaceNormal(hit.xz,0,.15),1.);
 if(clip.w>0.&&all(greaterThan(uv,vec2(0)))&&all(lessThan(uv,vec2(1)))){float visibleDepth=texture(uHits,uv).x;if(abs(visibleDepth-length(hit-uEye))<max(.15,path*.05))bottom=texture(uSceneTexture,uv).rgb;}
 float fresnel=waterFresnel(dot(n,v));vec3 illumination=shSky(vec3(0,1,0))*2.+uSunColor*max(0.,uSun.y)+uMoonColor*max(0.,uMoon.y),reflected=reflect(-v,n),reflection=airlight(reflected);vec3 color=waterVolume(bottom,path,uTurbidity,illumination,dot(v,uSun));color=color*(1.-fresnel)+(uReflections?reflection*fresnel:vec3(0));
 float rough=mix(uWaterRoughness,.55,state.w);color+=specular(p,n,v,uSun,uSunColor,rough,.02037)+specular(p,n,v,uMoon,uMoonColor,rough,.02037);return mix(color,vec3(.82,.86,.84)*(direct(p,n)+shSky(n)*.9),clamp(state.w,0.,1.));}
vec3 fogged(vec3 color,vec3 p){float t=1.-exp(-length(p-uEye)*.0012);return mix(color,airlight(normalize(p-uEye)),t);}
`;
const world=BEACH_RENDER_WORLD;
export const BEACH_SURFACE_CACHE_FRAGMENT=`precision highp float;precision highp int;
#define BEACH_CACHE_BUILD
in vec2 vUv;out vec4 outColor;${world}
void main(){vec2 p=uOrigin+vUv*uN*uDx;vec4 water=waterState(p);outColor=vec4(soilHeight(p)-beachBed(p),water.y*water.z,water.z,water.w);}`;
export const BEACH_WATER_SURFACE_FRAGMENT=`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;uniform sampler2D uFlow,uBed,uAux;void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 a=texelFetch(uFlow,p,0);float bed=texelFetch(uBed,p,0).r+texelFetch(uAux,p,0).w,wet=smoothstep(.001,.015,a.x);outColor=vec4((bed+a.x)*wet,wet,a.yz/max(a.x,.002)*wet);}`;
export const BEACH_HITS_FRAGMENT=`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;${world}
void main(){vec3 ray=rayAt(vUv);float ground=traceSurface(uEye,ray,0,1800.),water=traceSurface(uEye,ray,1,1800.),ball=1e5,id=-1.;if(water<90000.&&waterState((uEye+ray*water).xz).x<.005)water=1e5;for(int i=0;i<uBallCount;i++){vec4 b=body(i);vec2 hit=sphere(uEye,ray,b.xyz,b.w);float t=hit.x>.005?hit.x:hit.y;if(t>.005&&t<ball&&t<ground){ball=t;id=float(i);}}outColor=vec4(ground,water,ball,id);}`;
export const BEACH_BACKGROUND_FRAGMENT=`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;${world}
void main(){outColor=vec4(airlight(rayAt(vUv)),1);}`;
export const BEACH_SPLAT_VERTEX=`precision highp float;precision highp int;
uniform int uPass;in vec4 aPatch,aSeed;out vec2 vGaussian;out vec3 vPoint,vNormal,vTint;out float vSigma,vKind,vWeight,vSeed,vWidth,vWet;
${world.replaceAll('fwidth(p)','vec3(.02)')}
void main(){if(int(aPatch.w)!=uPass){gl_Position=vec4(2,2,2,1);return;}vec2 xz=aPatch.xy;float spacing=aPatch.z,kind=aPatch.w;vec3 n=vec3(0,1,0),p=vec3(xz.x,0,xz.y);float sigma=spacing*.75,thin=sigma*.65;vWet=0.;vTint=vec3(0);
 if(kind<2.){p.y=surfaceHeight(xz,int(kind));n=surfaceNormal(xz,int(kind),max(.12,spacing*.2));}
 if(kind==0.&&aSeed.z>.5){vec4 rock=beachRock(int(aSeed.z)-1);float ring=sqrt(max(0.,1.-aSeed.x*aSeed.x));n=vec3(cos(aSeed.y)*ring,aSeed.x,sin(aSeed.y)*ring);p=rock.xyz+n*rock.w;sigma=spacing*rock.w;thin=sigma*.3;}
 if(kind==2.){p.y=groundHeight(xz);float height=aSeed.z,segment=aSeed.y,cluster=step(.01,spacing);vec2 wind=beachWind(xz,uClock,uWind,uWindAngle,uTurbulence);wind+=windJet(p,uJetOrigin,uJetDirection,uJetLength).xz;wind*=.008*length(wind);vec2 bend=mix(wind,field(uAux,xz).yz,localWeight(xz));bend=clamp(bend,vec2(-2),vec2(2));float s=cluster>.5?.5:(segment+.5)/3.;n=normalize(vec3(bend.x*2.*s,1.,bend.y*2.*s));p+=vec3(bend.x*s*s,s*(1.-.22*min(length(bend),1.)),bend.y*s*s)*height;sigma=height*(cluster>.5?.42:.21);thin=cluster>.5?spacing*.37:height*.025;}
 if(kind==3.){vec4 ball=body(int(aSeed.z));float ring=sqrt(max(0.,1.-aSeed.x*aSeed.x));n=vec3(cos(aSeed.y)*ring,aSeed.x,sin(aSeed.y)*ring);p=ball.xyz+n*ball.w;sigma=spacing*ball.w;thin=sigma*.2;}
 if(kind==4.){int i=int(aSeed.z)*2;vec4 parcel=texelFetch(uParticles,ivec2(i%256,i/256),0),info=texelFetch(uParticles,ivec2((i+1)%256,(i+1)/256),0);p=parcel.xyz;n=normalize(info.xyz+vec3(.001,.001,0));vWet=info.w;sigma=parcel.w*(info.w>1.5?1.2+min(2.,length(info.xyz)*.1):.8);thin=parcel.w*.7;}
 if(kind==2.){vec3 green=mix(vec3(.055,.115,.018),vec3(.19,.25,.045),aSeed.x);vTint=green*(direct(p,vec3(0,1,0))+shSky(n)*.85);}
 mat3 covariance=(kind==2.||kind==4.)?mat3(thin*thin)+outerProduct(n,n)*(sigma*sigma-thin*thin):mat3(sigma*sigma)+outerProduct(n,n)*(thin*thin-sigma*sigma);
 // Heightfield samples are spaced in x/z, not along the sloped surface.
 // Lift their footprint onto the tangent plane to avoid scalloped steep banks.
 if(kind<2.&&aSeed.z<.5){vec3 tx=vec3(1.,-n.x/max(.08,n.y),0),tz=vec3(0,-n.z/max(.08,n.y),1.);covariance=sigma*sigma*(outerProduct(tx,tx)+outerProduct(tz,tz))+thin*thin*outerProduct(n,n);}
 vec4 viewP=viewMatrix*vec4(p,1.);float z=max(-viewP.z,.1);mat3 rot=mat3(viewMatrix),c=rot*covariance*transpose(rot);vec2 focal=vec2(projectionMatrix[0][0],projectionMatrix[1][1])*uResolution*.5;
 vec2 slope=clamp(viewP.xy/z,-1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]),1.3/vec2(projectionMatrix[0][0],projectionMatrix[1][1]));vec3 jx=vec3(focal.x/z,0.,focal.x*slope.x/z),jy=vec3(0.,focal.y/z,focal.y*slope.y/z);float A=dot(jx,c*jx)+.3,B=dot(jx,c*jy),C=dot(jy,c*jy)+.3,mid=(A+C)*.5,d=sqrt(max(0.,(A-C)*(A-C)*.25+B*B)),e1=mid+d,e2=max(.01,mid-d);vec2 axis=abs(B)>.00001?normalize(vec2(B,e1-A)):(A>=C?vec2(1,0):vec2(0,1));vec2 delta=3.*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y);
 vec4 clip=projectionMatrix*viewP;clip.xy+=delta*2./uResolution*clip.w;if(viewP.z>-.08)clip=vec4(2,2,2,1);gl_Position=clip;vGaussian=position.xy*3.;vPoint=p;vNormal=n;vSigma=sigma;vKind=kind;vWeight=aSeed.w;vSeed=aSeed.x;vWidth=sqrt(thin*thin+.3*pow(z/focal.y,2.));}
`;
export const BEACH_SPLAT_FRAGMENT=`precision highp float;precision highp int;
in vec2 vGaussian;in vec3 vPoint,vNormal,vTint;in float vSigma,vKind,vWeight,vSeed,vWidth,vWet;out vec4 outColor;uniform int uPass;uniform vec2 uAccumResolution;${world}
${GRASS_RAY_GLSL}
void main(){if(int(vKind)!=uPass)discard;vec2 uv=gl_FragCoord.xy/((uPass==0||uPass==1||uPass==3)?uAccumResolution:uResolution);vec3 ray=rayAt(uv);float density=exp(-.5*dot(vGaussian,vGaussian))*vWeight;if(density<.001)discard;vec4 hits=texture(uHits,uv);
 if(uPass==3){outColor=vec4(0,0,0,density);return;}
 if(uPass==2||uPass==4){vec2 blade=grassRay(ray,uEye-vPoint,vNormal,vSigma,vWidth);float depth=blade.x;density=blade.y*vWeight*smoothstep(.05,.18,depth);if(density<.001||depth>hits.x+.03)discard;
  if(uPass==2&&uGrassFront&&(hits.z>90000.||depth>=hits.z))discard;
  if(uPass==4&&depth>hits.z)discard;
  vec3 green=mix(vec3(.055,.115,.018),vec3(.19,.25,.045),vSeed),color=vTint;color+=green*max(dot(ray,uSun),0.)*.35*uDaylight;
  if(uPass==4){
   // Shade the rounded density lobe, retaining Gaussian optical coverage.
   // A single facing normal made displaced grains disappear into the bed.
   vec3 radial=(uEye+ray*depth-vPoint)/max(vWidth,.001),normal=normalize(radial-ray*.7);
   color=vWet>1.5?vec3(.78,.84,.87)*(direct(vPoint,normal)+shSky(normal)):sandColor(vPoint,normal,vWet)*mix(.88,1.08,vSeed);
  }
  if(uView==1)color=vNormal*.5+.5;if(uView==2)color=vec3(.15,.7,.2)*density;float alpha=1.-exp(-density*(uPass==4?3.:2.5));outColor=vec4(fogged(color,vPoint)*alpha,alpha);return;}
 float distance=uPass==0?hits.x:hits.y;if(distance>90000.)discard;float separation=abs(dot(vPoint-uEye,ray)-distance);density*=1.-smoothstep(max(.3,vSigma*2.),max(.7,vSigma*5.),separation);outColor=vec4(0,0,0,density);}
`;
export const BEACH_RESOLVE_FRAGMENT=`precision highp float;precision highp int;
in vec2 vUv;out vec4 outColor;uniform sampler2D uAccum;uniform int uPass;${world}
void main(){vec4 m=texture(uAccum,vUv);if(m.a<.001)discard;vec2 hits=texture(uHits,vUv).rg;float distance=uPass==0?hits.x:hits.y;if(distance>90000.)discard;vec3 p=uEye+rayAt(vUv)*distance;
 float footprint=length(fwidth(p.xz));vec3 n=surfaceNormal(p.xz,uPass,max(.12,footprint*.6));vec4 state=waterState(p.xz);float wet=mix(state.x>.02?1.:0.,field(uAux,p.xz).x,localWeight(p.xz));vec3 color=uPass==0?sandColor(p,n,wet):waterColor(p,n,state);if(uView==1)color=n*.5+.5;if(uView==2)color=vec3(.15,.5,.8)*min(m.a,1.);
 float opacity=uPass==1?smoothstep(.001,.025,state.x):1.;float fade=1.-smoothstep(950.,1750.,distance);opacity*=fade*(1.-exp(-m.a*4.));outColor=vec4(fogged(color,p)*opacity,opacity);}
`;
export const BEACH_GLASS_FRAGMENT=`precision highp float;precision highp int;
in vec2 vUv;out vec4 outColor;uniform sampler2D uAccum;${world}
vec3 sceneRay(vec3 o,vec3 d){float land=traceSurface(o,d,0,350.),water=traceSurface(o,d,1,350.);if(min(land,water)>90000.)return airlight(d);vec3 p=o+d*min(land,water);vec4 projected=uProjection*uViewMatrix*vec4(p,1.);vec2 uv=projected.xy/projected.w*.5+.5;if(projected.w>0.&&all(greaterThan(uv,vec2(0)))&&all(lessThan(uv,vec2(1))))return texture(uSceneTexture,uv).rgb;vec3 n=surfaceNormal(p.xz,water<land?1:0,.2);return fogged(water<land?waterColor(p,n,waterState(p.xz)):sandColor(p,n,field(uAux,p.xz).x),p);}
void main(){vec4 hits=texture(uHits,vUv);int id=int(hits.w+.1);float nearest=hits.z;if(hits.w<0.||nearest>90000.)discard;vec3 ray=rayAt(vUv);vec4 ball=body(id);vec3 p=uEye+ray*nearest,n=normalize(p-ball.xyz);float outsideIOR=p.y<surfaceHeight(p.xz,1)&&waterState(p.xz).x>.01?WATER_IOR:1.;float f0=pow((1.5-outsideIOR)/(1.5+outsideIOR),2.),F=f0+(1.-f0)*pow(1.-max(0.,dot(n,-ray)),5.);vec3 direction=refract(ray,n,outsideIOR/1.5),point=p+direction*.001;float glassPath=0.;
 for(int j=0;j<3;j++){float radius=j<2?ball.w-.012:ball.w;vec2 roots=sphere(point,direction,ball.xyz,radius);float t=j==0?roots.x:roots.y;if(t<.00001)t=roots.y;if(t>90000.)break;point+=direction*t;vec3 normal=normalize(point-ball.xyz);if(j>0)normal=-normal;float eta=j==0?1.5:j==1?1./1.5:1.5/(point.y<surfaceHeight(point.xz,1)&&waterState(point.xz).x>.01?WATER_IOR:1.);vec3 next=refract(direction,normal,eta);if(dot(next,next)<.01)next=reflect(direction,normal);if(j!=1)glassPath+=t;direction=next;point+=direction*.002;}
 vec3 color=sceneRay(point,direction)*exp(-vec3(.09,.025,.015)*glassPath)*(1.-F)+sceneRay(p+n*.003,reflect(ray,n))*F;color+=specular(p,n,-ray,uSun,uSunColor,.065,f0)+specular(p,n,-ray,uMoon,uMoonColor,.065,f0);
 if(hits.y<nearest)color=waterVolume(color,nearest-hits.y,uTurbidity,shSky(vec3(0,1,0))*2.+uSunColor*max(0.,uSun.y),dot(ray,uSun));if(uView==1)color=n*.5+.5;float coverage=1.-exp(-texture(uAccum,vUv).a*3.);outColor=vec4(color*coverage,coverage);}
`;
