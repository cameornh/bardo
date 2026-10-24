import {RainSurface} from './rain-surface.js';
import {TERRAIN_GRADIENT_GLSL} from './terrain-gradient.js';
import {CAUSTIC_RECEIVER_GLSL} from './caustic-receiver.js';
import {LOCAL_LIGHT_GLSL} from './local-light.js';
import {rainVisualCount} from './rain-appearance.js';
import {SAND_COLOR_GLSL} from './sand-material.js';
import {StarGaussians} from './star-gaussians.js';
import {SAND_TRACE_GLSL} from './surface-trace.js';
import {LabExposure} from './sky-exposure.js';
import {CELESTIAL_GLSL} from './celestial-sky.js';
import {WATER_EXIT_GLSL} from '../water-lab-interface.js';
import {WATER_SCENE_REFLECTION_GLSL} from '../water-lab-reflections.js';
import {WETNESS_VIEW_GLSL} from './wetness-view.js';
import {SandGrains} from './sand-grains.js';
import {BeachAtmosphere} from './atmosphere.js';
import {shoreImage} from './reconstruction.js';
import {FOAM_DIFFUSION_GLSL} from './water-lab-foam-diffusion.js';
import {GLASS_WETTING_GLSL,LENS_FIELD_FRAGMENT,LENS_FRAGMENT} from './water-lab-wetting.js';
import {LabMediumShadows} from './water-lab-medium-shadows.js';
import {LAB_LIGHTING_GLSL} from './water-lab-lighting.js';
import {LabSprayShadows} from './water-lab-spray-shadows.js';
import {LabPoolShadows} from './water-lab-pool-shadows.js';
import {LAB_LIGHT_VISIBILITY_GLSL} from './water-lab-light-visibility.js';
import {SOLUTE_GLSL} from './water-lab-solutes.js';
import {LabBlobRenderer} from './water-lab-blob-renderer.js';
import {LabDetailRenderer} from './water-lab-detail-renderer.js';
import {RAIN_VERTEX,RAIN_FRAGMENT} from './water-lab-rain-renderer.js';
import {projectedMotion} from '../lod.js';
import * as THREE from 'three';
import {LabWaterField,LAB_FIELD_GLSL} from './water-lab-field.js';
import {QUAD_VERTEX,SH_GLSL} from '../shaders.js';
import {WATER_MATERIAL_GLSL} from '../water-material.js';
import {LAB_GEOMETRY_GLSL,hash} from './water-lab-model.js';
import {GPUTiming} from '../gpu-timing.js';
const common=`
${LAB_GEOMETRY_GLSL}
${TERRAIN_GRADIENT_GLSL}
${GLASS_WETTING_GLSL}
${LAB_FIELD_GLSL}
${SH_GLSL}
${SAND_COLOR_GLSL}
${WATER_MATERIAL_GLSL}
${SOLUTE_GLSL}
${LAB_LIGHTING_GLSL}
${LAB_LIGHT_VISIBILITY_GLSL}
uniform vec3 uEye,uSH[16];uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;uniform vec2 uResolution;
uniform float uScale,uSpacing,uLights,uClock,uAmbient,uSunlight,uWaterRoughness,uTurbidity,uTannins;uniform vec2 uLightExtent;uniform int uView,uSHDegree;uniform highp sampler2D uFront,uImage,uCaustics;
vec3 rayAt(vec2 uv){vec4 p=uInverseProjection*vec4(uv*2.-1.,1,1);return normalize(mat3(uCameraMatrix)*p.xyz/p.w);}
${CELESTIAL_GLSL}
vec3 sky(vec3 d){return labSky(d)*uAmbient+celestialSky(d);}

vec3 environment(vec3 d){float b[16];basisSH(d,b);vec3 c=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;c+=b[i]*uSH[i]*diffuseSHBand(i);}return max(c,vec3(0))*uAmbient;}
vec3 sun(){return labSunDirection();}
vec3 sunRadiance(vec3 p){return LAB_SUN*uSunlight*sunTransmission(p,uScale);}
vec3 lampRadiance(vec3 p,int i){return poolColor(i)*3.*uLights*poolFalloff(p,poolLamp(i))*poolTransmission(p,i,uScale);}
float rho(vec3 p){return parcelSample(p).r;}
vec3 fluidGradient(vec3 p){float e=max(uFieldDx*.9,uSpacing*.12);return vec3(rho(p+vec3(e,0,0))-rho(p-vec3(e,0,0)),rho(p+vec3(0,e,0))-rho(p-vec3(0,e,0)),rho(p+vec3(0,0,e))-rho(p-vec3(0,0,e)))/(2.*e);}
vec3 fluidNormal(vec3 p){vec3 gradient=fluidGradient(p);return length(gradient)>1e-7?-normalize(gradient):vec3(0,1,0);}
float opaque(vec3 p){float d=labOpaque(p);for(int i=0;i<uBodyCount;i++){vec4 b=labBody(i),v=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0);if(v.w>.5)if(length(p-b.xyz)-b.w*1.5<d)d=min(d,bodyDistance(p,i));}return d;}
float traceBody(vec3 o,vec3 d,int index,float limit){vec4 b=labBody(index);vec3 q=o-b.xyz;float r=b.w*1.55,a=dot(q,d),disc=a*a-dot(q,q)+r*r;if(disc<0.)return 1e4;float t=max(.00001,-a-sqrt(disc)),end=min(limit,-a+sqrt(disc)),eps=max(.000001,b.w*.004);for(int j=0;j<96;j++){if(t>end)break;float h=bodyDistance(o+d*t,index);if(h<eps)return t;t+=max(eps,abs(h)*.8);}return 1e4;}
vec3 opaqueNormal(vec3 p){for(int i=0;i<uBodyCount;i++)if(abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02))return bodyNormal(p,i);float e=.004;if(uStation==6&&(uSandCount==0||any(lessThan(p,uSandMin-vec3(e)))||any(greaterThan(p,uSandMax+vec3(e))))){vec2 gradient=sandHeightGradient(p.xz);return normalize(vec3(-gradient.x,1.,-gradient.y));}return normalize(vec3(labOpaque(p+vec3(e,0,0))-labOpaque(p-vec3(e,0,0)),labOpaque(p+vec3(0,e,0))-labOpaque(p-vec3(0,e,0)),labOpaque(p+vec3(0,0,e))-labOpaque(p-vec3(0,0,e))));}
${SAND_TRACE_GLSL}

${LOCAL_LIGHT_GLSL}
vec3 objectLights(vec3 p,vec3 n){vec3 result=vec3(0);for(int i=0;i<uBodyCount;i++){float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;if(kind>2.5)result+=objectLight(p,i)*max(0.,dot(n,normalize(labBody(i).xyz-p)));}return result;}
vec3 lightAt(vec3 p,vec3 n){vec3 value=objectLights(p,n);if(uStation!=2)return value;for(int i=0;i<3;i++)value+=lampRadiance(p+n*.025,i)*max(0.,dot(n,normalize(poolLamp(i)-p)));return value;}
uniform bool uReuseSurfaceLight;
vec3 dielectricHighlightsLit(vec3 p,vec3 n,vec3 v,float roughness,float f0,vec3 direct){vec3 color=direct*3.14159265*labSpecular(n,v,sun(),roughness,f0);if(uStation==2)for(int i=0;i<3;i++)color+=lampRadiance(p+n*.025,i)*3.14159265*labSpecular(n,v,normalize(poolLamp(i)-p),roughness,f0);for(int i=0;i<uBodyCount;i++){float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;if(kind>2.5)color+=objectLight(p,i)*3.14159*labSpecular(n,v,normalize(labBody(i).xyz-p),roughness,f0);}return color;}
vec3 dielectricHighlights(vec3 p,vec3 n,vec3 v,float roughness,float f0){return dielectricHighlightsLit(p,n,v,roughness,f0,sunRadiance(p+n*.025));}
${FOAM_DIFFUSION_GLSL}
${WETNESS_VIEW_GLSL}
${CAUSTIC_RECEIVER_GLSL}
vec3 surfaceColorFrom(vec3 p,vec3 n,vec3 view){float sandMoisture=uStation==6?sandWetness(p):0.;vec4 wetFilm=surfaceWetting(p);n=normalize(n+wetFilm.xyz-n*dot(wetFilm.xyz,n));
// Choose an overriding object material before doing the discarded sand lighting.
if(uReuseSurfaceLight){int diffuseBody=-1,emissiveBody=-1;for(int i=0;i<uBodyCount;i++){float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;if(kind>1.5&&abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02)){diffuseBody=i;if(kind>2.5)emissiveBody=i;}}if(emissiveBody>=0)return bodyExtra(emissiveBody,0).rgb*uLights*LIGHT_BALL_RADIANCE;if(diffuseBody>=0)return bodyExtra(diffuseBody,0).rgb*(environment(n)*mediumSky(p+n*.025)*sandAmbientVisibility(p,n)+max(0.,dot(n,sun()))*sunRadiance(p+n*.025)+lightAt(p,n));}
vec3 base=uStation==2?vec3(.38,.62,.65):uStation==4||uStation==6?vec3(.42,.31,.16):vec3(.32,.37,.38);if(uStation==2){for(int i=0;i<3;i++){vec3 light=vec3(float(i-1)*2.7,.65,-2.87);if(length(p-light)<.16)return (i==0?vec3(4.,.12,.08):i==1?vec3(.1,3.,.5):vec3(.15,.3,5.))*uLights;}}if(uStation!=4&&uStation!=6){vec2 tile=abs(n.y)>.5?p.xz:abs(n.x)>.5?p.zy:p.xy;float checker=mod(floor(tile.x*1.8)+floor(tile.y*1.8),2.);base*=mix(.675,mix(.35,1.,checker),1.-smoothstep(14.,27.,length(p-uEye)));vec2 grid=abs(fract(tile*1.8)-.5);float aa=min(.3,length(p-uEye)*.003);base*=1.-.3*smoothstep(.46-aa,.48+aa,max(grid.x,grid.y))*(1.-smoothstep(12.,35.,length(p-uEye)));}if(uStation==4){vec3 bed=texture(uLabBed,p.xz/vec2(12,120)+.5).rgb;base=mix(vec3(.31,.23,.13),vec3(.62,.46,.24),smoothstep(-.02,.14,bed.r));base*=1.-.2*clamp(bed.g,0.,1.);if(riverRockDistance(p)<.035)base=vec3(.25,.27,.26);}
if(uStation==6){float grain=fract(sin(dot(floor(p*700.),vec3(12.91,78.233,31.53)))*43758.5453);float grainFilter=1./(1.+pow(700.*length(p-uEye)/max(1.,uResolution.y),2.));base=sandAlbedo(sandMoisture)*(1.+(grain-.5)*.08*grainFilter);}
if(uStation==1&&p.y>1.)base=vec3(.25,.29,.27);if(uStation==0&&p.y>2.)base=vec3(.18,.23,.25);vec2 causticUv=p.xz/uLightExtent+.5;vec4 causticSample=all(greaterThanEqual(causticUv,vec2(0)))&&all(lessThanEqual(causticUv,vec2(1)))?texture(uCaustics,causticUv):vec4(0);vec3 caustic=causticReceiver(causticSample,p.y);float wetCoverage=1.-exp(-wetFilm.w);if(uStation==6)wetCoverage=max(wetCoverage,sandMoisture*.65);base*=1.-.2*wetCoverage;vec3 direct=uReuseSurfaceLight?sunRadiance(p+n*.025):vec3(0);vec3 color=(uReuseSurfaceLight?dielectricHighlightsLit(p,n,view,.15,.02,direct):dielectricHighlights(p,n,view,.15,.02))*wetCoverage+base*(environment(n)*mediumSky(p+n*.025)*sandAmbientVisibility(p,n)+foamFloorRadiance(p+n*.025,n)+(uReuseSurfaceLight?direct:sunRadiance(p+n*.025))*max(0.,dot(n,sun()))+lightAt(p,n)+caustic*.35*uSunlight*max(0.,n.y));for(int i=0;i<uBodyCount;i++){vec4 b=labBody(i),v=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0);if(v.w>1.5&&abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02))color=bodyExtra(i,0).rgb*(environment(n)*mediumSky(p+n*.025)*sandAmbientVisibility(p,n)+max(0.,dot(n,sun()))*sunRadiance(p+n*.025)+lightAt(p,n));}for(int i=0;i<uBodyCount;i++){if(texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w>2.5&&abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02))color=bodyExtra(i,0).rgb*uLights*LIGHT_BALL_RADIANCE;}return color;}
vec3 surfaceColor(vec3 p,vec3 n){return surfaceColorFrom(p,n,normalize(uEye-p));}
// One bounded reflected scene query. Reflected receivers use their actual
// direct/colored lighting and shadows, without recursive mirror bounces.
vec3 floorColor(vec3 p,vec3 n){if(uSandWetnessView&&uStation==6){bool body=false;for(int i=0;i<uBodyCount;i++)body=body||abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02);if(!body)return sandWetnessColor(sandWetness(p));}vec3 color=uReuseSurfaceLight?vec3(0):surfaceColor(p,n);bool reflected=false;for(int i=0;i<uBodyCount;i++){vec4 b=labBody(i),v=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0);if(v.w>.5&&v.w<1.5&&abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02)){vec3 rd=reflect(normalize(p-uEye),n),origin=p+n*.025;float rt=traceOpaque(origin,rd);color=rt<9999.?surfaceColor(origin+rd*rt,opaqueNormal(origin+rd*rt)):sky(rd);
 // Resolve the finite lamp disks analytically to keep their small reflection
 // visible at pixel scale. Their paths share the particle/body shadow queries.
 if(uStation==2)for(int lamp=0;lamp<3;lamp++){vec3 delta=vec3(float(lamp-1)*2.7,.65,-2.87)-p;float t=dot(delta,rd),miss=length(delta-rd*t),width=max(.008,fwidth(miss));float coverage=(t>0.&&p.z>-2.75&&t<rt+.2)?1.-smoothstep(.15-width,.15+width,miss):0.;vec3 radiance=poolColor(lamp)*uLights*poolTransmission(p,lamp,uScale);color=mix(color,radiance,coverage);}
 if(rt>9999.)color+=LAB_SUN*uSunlight*600.*smoothstep(.99994,.99998,dot(rd,sun()))*sunTransmission(origin,uScale);color*=bodyExtra(i,0).rgb;reflected=true;break;}}if(uReuseSurfaceLight&&!reflected)color=surfaceColor(p,n);return color;}
// Secondary receivers stop after their local material response; a second
// mirror does not recursively launch another expensive scene query.
vec3 reflectedSurfaceColor(vec3 p,vec3 n,vec3 view){
 for(int i=0;i<uBodyCount;i++){
  vec4 b=labBody(i);float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;
  if(kind>.5&&kind<1.5&&abs(bodyDistance(p,i))<max(.00001,b.w*.02)){
   vec3 result=sky(reflect(-view,n))*bodyExtra(i,0).rgb;
   result+=dielectricHighlights(p,n,view,.08,.92)*bodyExtra(i,0).rgb;
   return result;
  }
 }
 return surfaceColorFrom(p,n,view);
}
float traceWater(vec3 o,vec3 d,float begin,float end){float t=begin,last=t;if(begin>end)return 1e4;for(int i=0;i<512;i++){float skip=fieldEmptyAdvance(o+d*t,d,PARCEL_ISO);if(skip>0.){float until=t+skip;int skipped=0;for(int j=0;j<32;j++){if(i+skipped>=512)break;last=t;t+=uSpacing*mix(.28,.55,smoothstep(8.,35.,t));skipped++;if(t>=until||t>end)break;}i+=skipped-1;if(t>end)break;continue;}if(rho(o+d*t)>=PARCEL_ISO){float a=last,b=t;for(int j=0;j<5;j++){float m=(a+b)*.5;if(rho(o+d*m)<PARCEL_ISO)a=m;else b=m;}return (a+b)*.5;}last=t;t+=uSpacing*mix(.28,.55,smoothstep(8.,35.,t));if(t>end)break;}return 1e4;}
// The water shader queries glass along its refracted ray. The final shell pass
// handles only glass in front of the liquid, so submerged glass cannot cover it.
float traceGlass(vec3 origin,vec3 ray,float limit,out vec3 normal){
 float t=.012,nearest=1e4;normal=vec3(0,1,0);
 if(uStation==3||uStation==5||uStation==7)for(int k=0;k<100;k++){vec3 p=origin+ray*t;float d=vessel(p);if(d<.006){nearest=t;float e=.005;normal=normalize(vec3(vessel(p+vec3(e,0,0))-vessel(p-vec3(e,0,0)),vessel(p+vec3(0,e,0))-vessel(p-vec3(0,e,0)),vessel(p+vec3(0,0,e))-vessel(p-vec3(0,0,e))));break;}t+=max(.01,d*.8);if(t>min(30.,limit))break;}
 for(int i=0;i<uBodyCount;i++){float kind=texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w;if(kind>.5)continue;float t=traceBody(origin,ray,i,min(limit,nearest));if(t<nearest){nearest=t;normal=bodyNormal(origin+ray*t,i);}}

 return nearest;
}
vec3 shadeGlass(vec3 p,vec3 n,vec3 ray,vec3 background){
 if(vessel(p)<.02)n=wetGlassNormal(p,n);else{vec3 wet=surfaceWetting(p).xyz;n=normalize(n+wet-n*dot(wet,n));}if(dot(n,-ray)<0.)n=-n;float wet=smoothstep(.08,.24,rho(p+n*.02)),ior=mix(1.,WATER_IOR,wet),f0=pow((1.5-ior)/(1.5+ior),2.),F=f0+(1.-f0)*pow(1.-max(0.,dot(n,-ray)),5.);
 vec3 tint=vec3(.965,.986,.99);for(int i=0;i<uBodyCount;i++)if(abs(bodyDistance(p,i))<max(.00001,labBody(i).w*.02))tint=pow(max(bodyExtra(i,0).rgb,vec3(.02)),vec3(.4));vec3 color=mix(background*tint,sky(reflect(ray,n)),F)+dielectricHighlights(p,n,-ray,.12,f0);
 // An etched index on the rotationally symmetric cup makes actual rotation
 // observable. It is attached to the glass, never to the liquid.
 if(uStation==5&&vessel(p)<.02){vec3 q=rotateLab(p-uContainer,true);float mark=(1.-smoothstep(.018,.045,abs(q.z)))*smoothstep(.8,1.,q.x)*(1.-smoothstep(.8,.9,abs(q.y)));color=mix(color,color*.32,mark*.8);}
 return color;
}
${WATER_SCENE_REFLECTION_GLSL}
${WATER_EXIT_GLSL}
vec3 soluteVolume(vec3 bottom,vec3 p,vec3 direction,float path,vec3 c,vec3 ray){
 vec3 extinction=soluteExtinction(c,uTannins,uTurbidity),scatter=soluteScatter(c,uTannins,uTurbidity),trans=exp(-extinction*path),color=bottom*trans;
 // Equal optical-depth intervals keep dense organic water's thin lit skin
 // resolved. Integrate the exponential exactly inside each interval.
 float opticalLimit=min(path,8./max(.001,min(extinction.r,min(extinction.g,extinction.b)))),stepSize=opticalLimit/5.;

 for(int i=0;i<5;i++){float start=float(i)*stepSize,d=start+stepSize*.5;vec3 q=p+direction*(d/uScale),weight=exp(-extinction*start)*(1.-exp(-extinction*stepSize))*scatter/extinction;
 vec3 incident=environment(vec3(0,1,0))*mediumSky(q);
 incident+=sunRadiance(q)*3.14159265*phaseHG(dot(ray,sun()),.55);
 if(uStation==2)for(int lamp=0;lamp<3;lamp++)incident+=lampRadiance(q,lamp)*3.14159265*phaseHG(dot(ray,normalize(poolLamp(lamp)-q)),.55);
 color+=weight*(incident+objectVolumeIncident(q,ray));
 }return color;
}
// Water is not in the opaque SDF: no ray-origin bias is needed here. A fixed
// bias skipped shallow sand contacts, then shaded a point inside the ground.
vec3 shadeWater(vec3 p,vec3 n,vec3 ray,float path,vec3 concentration){vec3 refracted=refract(ray,n,1./WATER_IOR),origin=p;float ground=traceOpaque(origin,refracted);vec3 bottom=ground<9999.?floorColor(origin+refracted*ground,opaqueNormal(origin+refracted*ground)):sky(refracted);float opticalPath=min(path,ground)*uScale;
 vec3 glassNormal;float glassDistance=traceGlass(p+refracted*.012,refracted,ground,glassNormal);
 if(glassDistance<ground){float foreground=min(opticalPath,glassDistance*uScale);vec3 glassPoint=p+refracted*glassDistance;
 bottom=soluteVolume(bottom,glassPoint,refracted,max(0.,opticalPath-foreground),concentration,ray);bottom=shadeGlass(glassPoint,glassNormal,refracted,bottom);opticalPath=foreground;}
 vec3 color=soluteVolume(bottom,p,refracted,opticalPath,concentration,ray);float F=waterFresnel(dot(n,-ray));color=mix(color,waterSceneReflection(p,n,ray),F);
 color+=dielectricHighlights(p,n,-ray,uWaterRoughness,.02037);
 if(uView==1)color=n*.5+.5;if(uView==2)color=vec3(concentration.x,concentration.y,concentration.z);return color;}

`;
const background=`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;${common}
void main(){vec3 ray=rayAt(vUv);float t=traceOpaque(uEye,ray);vec3 p=uEye+ray*t,color=t<9999.?floorColor(p,opaqueNormal(p)):sky(ray);outColor=vec4(color,t);}`;
// Separate air/underwater programs keep the driver's expanded lighting code
// bounded. Both use the same scene/material queries and density field.
const submerged=`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;${common}
void main(){if(rho(uEye)<=.18)discard;vec4 background=texture(uImage,vUv);
 if(rho(uEye)>.18){vec3 ray=rayAt(vUv);float path=0.,end=min(background.a,75.);vec4 chemicals=vec4(0);bool exited=false;
 for(int i=0;i<384;i++){float stepSize=uSpacing*.35,t=min(end,path+stepSize);vec4 a=parcelSample(uEye+ray*((path+t)*.5));chemicals+=vec4(a.yzw/max(a.x,.0001),1.);path=t;if(path>=end)break;if(rho(uEye+ray*path)<.14){exited=true;break;}}
 vec3 color=background.rgb;if(exited){
 // Refine the exit, then continue into the actual scene. A sky-only lookup
 // erased all objects above water. Internal reflection uses the scene too.
 float lo=max(0.,path-uSpacing*.35),hi=path;
 for(int i=0;i<5;i++){float mid=(lo+hi)*.5;if(rho(uEye+ray*mid)>.14)lo=mid;else hi=mid;}path=(lo+hi)*.5;
 vec3 p=uEye+ray*path,n=fluidNormal(p),outRay;float F=waterExitFresnel(ray,n,outRay);
 vec3 reflected=reflect(ray,n);color=waterSceneRadiance(p+reflected*.012,reflected);
 if(F<1.)color=mix(waterSceneRadiance(p+outRay*.012,outRay),color,F);
 }
 color=soluteVolume(color,uEye,ray,path*uScale,chemicals.xyz/max(1.,chemicals.w),ray);outColor=vec4(color,exited?path:end);return;}
}`;
const water=`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;${common}
void main(){vec4 background=texture(uImage,vUv);
 // The separate submerged pass integrates the camera-to-exit segment.
 if(rho(uEye)>.18)discard;
 float front=texture(uFront,vUv).r;if(front<=0.){outColor=vec4(background.rgb,1e4);return;}vec3 ray=rayAt(vUv);float start=max(.005,1./front-uSpacing),t=traceWater(uEye,ray,start,min(background.a,start+24.));if(t>9999.){outColor=vec4(background.rgb,1e4);return;}vec3 p=uEye+ray*t,n=fluidNormal(p);if(dot(n,-ray)<0.)n=-n;vec3 refracted=refract(ray,n,1./WATER_IOR);float path=0.,pathStep=uSpacing*mix(.35,.9,smoothstep(3.,14.,t));vec4 chemicals=vec4(0);for(int i=0;i<100;i++){vec3 q=p+refracted*(path+pathStep*.5);vec4 a=parcelSample(q);if(a.r<PARCEL_ISO)break;chemicals+=vec4(a.yzw/max(a.r,.0001),1.);path+=pathStep;}vec3 concentration=chemicals.xyz/max(1.,chemicals.w);outColor=vec4(shadeWater(p,n,ray,path,concentration),t);}`;
const shell=`precision highp float;precision highp int;in vec2 vUv;out vec4 outColor;uniform sampler2D uWaterSurface,uOpaqueRead;${common}
uniform float uRainRate,uRainTop;uniform vec2 uRainHalf;
vec3 rainVeil(vec3 color,vec3 ray,float limit){
 if(uRainRate<=0.||rho(uEye)>.18)return color;
 vec3 inv=1./(ray+vec3(1e-12)),a=(vec3(-uRainHalf.x,-.8,-uRainHalf.y)-uEye)*inv,b=(vec3(uRainHalf.x,uRainTop,uRainHalf.y)-uEye)*inv,lo=min(a,b),hi=max(a,b);
 float begin=max(0.,max(lo.x,max(lo.y,lo.z))),end=min(limit,min(hi.x,min(hi.y,hi.z))),path=max(0.,end-begin)*uScale;
 float tau=path*.0001*pow(uRainRate/20.,.65);vec3 incident=environment(vec3(0,1,0))+LAB_SUN*uSunlight*.25;
 return color*exp(-tau)+incident*(1.-exp(-tau))*.75;
}
void main(){vec3 ray=rayAt(vUv),normal;float solid=texture(uOpaqueRead,vUv).a,waterDepth=texture(uWaterSurface,vUv).a;float nearest=traceGlass(uEye,ray,min(solid,waterDepth),normal);vec3 color=texture(uImage,vUv).rgb;
 if(nearest<min(solid,waterDepth)){
  vec3 viewNormal=mat3(uViewMatrix)*(vessel(uEye+ray*nearest)<.02?wetGlassNormal(uEye+ray*nearest,normal):normal);vec2 offsetUv=clamp(vUv-viewNormal.xy*.008,vec2(.001),vec2(.999));vec3 background=texture(uImage,offsetUv).rgb;
  color=shadeGlass(uEye+ray*nearest,normal,ray,background);
 }color=rainVeil(color,ray,min(solid,waterDepth));outColor=vec4(color,1);}`;
// Project a true 3D covariance through the perspective Jacobian. These splats
// bound the implicit query; a particle never supplies a hard ellipse surface.
const splatVertex=`precision highp float;in vec4 aParcel;uniform vec2 uResolution;out vec2 vQ;out float vFront,vDepth;out vec3 vColor;in vec4 aColor;void main(){vec4 p=viewMatrix*vec4(aParcel.xyz,1);float z=max(.05,-p.z),s=aParcel.w;vec3 jx=vec3(projectionMatrix[0][0]/z,0,projectionMatrix[0][0]*p.x/(z*z)),jy=vec3(0,projectionMatrix[1][1]/z,projectionMatrix[1][1]*p.y/(z*z));float xx=dot(jx,jx)*s*s+.8/(uResolution.x*uResolution.x),xy=dot(jx,jy)*s*s,yy=dot(jy,jy)*s*s+.8/(uResolution.y*uResolution.y),l=sqrt(max(0.,pow((xx-yy)*.5,2.)+xy*xy)),e1=max(.0000001,(xx+yy)*.5+l),e2=max(.0000001,(xx+yy)*.5-l);vec2 axis=abs(xy)>.00000001?normalize(vec2(e1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);vec2 delta=(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y)*3.;vec4 clip=projectionMatrix*p;clip.xy+=delta*clip.w;if(p.z>-.05)clip=vec4(2,2,2,1);gl_Position=clip;vQ=position.xy*3.;vDepth=length(p.xyz);vFront=max(.01,vDepth-3.*s);vColor=aColor.rgb;}`;
const splatFragment=`precision highp float;in vec2 vQ;in float vFront,vDepth;in vec3 vColor;out vec4 outColor;uniform bool uFoam;uniform highp sampler2D uOpaqueRead;uniform vec2 uResolution;void main(){float d=exp(-.5*dot(vQ,vQ));if(d<.011)discard;if(uFoam){if(vDepth>texture(uOpaqueRead,gl_FragCoord.xy/uResolution).a+.02)discard;float a=d*.55;outColor=vec4(vColor*a,a);}else outColor=vec4(vec3(1./vFront),1);}`;
const photon=`precision highp float;precision highp int;in vec2 vUv;layout(location=0)out vec4 hit;layout(location=1)out vec4 flux;${common}
void main(){vec3 o=vec3((vUv.x-.5)*uLightExtent.x,uStation==4?28.:8.,(vUv.y-.5)*uLightExtent.y),d=-sun();o.xz-=d.xz/(-d.y)*o.y;hit=vec4(0);flux=vec4(0);if(d.y>=-.005)return;float t=traceWater(o,d,0.,uStation==4?32.:9.);if(t>9999.)return;vec3 p=o+d*t,n=fluidNormal(p),r=refract(d,n,1./WATER_IOR);vec3 receiverOrigin=p+r*.002;float land=traceOpaque(receiverOrigin,r);vec3 receiver=receiverOrigin+r*land;if(land>9999.||opaqueNormal(receiver).y<.6)return;hit=vec4(receiver,1);vec4 medium=parcelSample(p);flux=vec4(exp(-soluteExtinction(medium.yzw/max(medium.x,.0001),uTannins,uTurbidity)*land*uScale)*(1.-waterFresnel(dot(n,-d)))*sunTransmission(p,uScale)*bodyTransmission(p,r,land,uScale,0.,0.),1);}`;
const photonVertex=`precision highp float;uniform highp sampler2D uPhotonHits,uPhotonFlux;uniform vec2 uLightExtent;out vec2 vQ;out vec3 vFlux;out float vReceiverHeight;void main(){ivec2 i=ivec2(gl_InstanceID%48,gl_InstanceID/48);vec4 p=texelFetch(uPhotonHits,i,0);vReceiverHeight=p.y;vFlux=texelFetch(uPhotonFlux,i,0).rgb;vec2 uv=p.xz/uLightExtent+.5+position.xy*.009;gl_Position=vec4(uv*2.-1.,0,1);if(p.w<.5)gl_Position=vec4(2,2,0,1);vQ=position.xy*3.;}`;
const photonFragment=`precision highp float;in vec2 vQ;in vec3 vFlux;in float vReceiverHeight;out vec4 outColor;void main(){vec3 flux=vFlux*exp(-.5*dot(vQ,vQ))*1.7;outColor=vec4(flux,(vReceiverHeight+32.)*dot(flux,vec3(.2126,.7152,.0722)));}`;
function instanceGeometry(count){const g=new THREE.InstancedBufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));g.setIndex([0,1,2,0,2,3]);g.instanceCount=count;return g;}
export class WaterLabRenderer{
 constructor(field,lab){this.field=field;this.lab=lab;this.renderer=field.renderer;this.timers=new GPUTiming(this.renderer);this.exposure=new LabExposure(this.renderer);this.adaptiveResolution=true;this.loadScale=1;this.lastLoadChange=0;this.density=new LabWaterField(this.renderer);this.sprayShadows=new LabSprayShadows(this.renderer,lab);this.poolShadows=new LabPoolShadows(this.renderer,lab);const target=(w=1,h=1,count=1)=>new THREE.WebGLRenderTarget(w,h,{count,type:THREE.FloatType,depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});this.front=target();this.background=target();this.water=target();this.blobs=target();this.blobs.depthBuffer=true;this.resolvedWater=target();this.composite=target();this.shellTarget=target();this.starTarget=target();this.lensField=target(256,144);this.lensField.texture.minFilter=this.lensField.texture.magFilter=THREE.LinearFilter;this.photons=target(48,48,2);this.caustics=target(256,256);this.caustics.texture.minFilter=this.caustics.texture.magFilter=THREE.LinearFilter;this.atmosphere=new BeachAtmosphere(this.renderer);const coeff=new Float32Array(48);this.u={uSandSkyCeiling:{value:1e10},uReuseSurfaceLight:{value:false},uWaterSceneReflections:{value:true},uBlobDepth:{value:true},uTightGaussians:{value:true},...this.atmosphere.u,...lab.wetting.uniforms(),uLensField:{value:this.lensField.texture},uLensAspect:{value:1},...lab.u,...this.sprayShadows.u,...this.poolShadows.u,uFoamFloorScatter:{value:true},uBodyShadows:{value:true},uLightExtent:{value:new THREE.Vector2(11,11)},...this.density.u,uEye:{value:new THREE.Vector3()},uInverseProjection:{value:new THREE.Matrix4()},uCameraMatrix:{value:new THREE.Matrix4()},uProjection:{value:new THREE.Matrix4()},uViewMatrix:{value:new THREE.Matrix4()},uResolution:{value:new THREE.Vector2()},uScale:{value:1},uSpacing:{value:.25},uLights:{value:1},uAmbient:{value:1},uSunlight:{value:1},uWaterRoughness:field.water.uniforms.uWaterRoughness,uTurbidity:field.water.uniforms.uTurbidity,uClock:{value:0},uView:field.uniforms.uView,uSHDegree:field.uniforms.uSHDegree,uSH:{value:Array.from({length:16},(_,i)=>new THREE.Vector3(...coeff.subarray(i*3,i*3+3)))},uFront:{value:this.front.texture},uOpaqueRead:{value:this.background.texture},uWaterSurface:{value:this.resolvedWater.texture},uBulkWater:{value:this.water.texture},uBlobSurface:{value:this.blobs.texture},uImage:{value:this.background.texture},uCaustics:{value:this.caustics.texture},uFoam:{value:false},uPhotonHits:{value:this.photons.textures[0]},uPhotonFlux:{value:this.photons.textures[1]}};this.mediumShadows=new LabMediumShadows(this.renderer,lab,this.density,this.u);Object.assign(this.u,this.mediumShadows.u);this.quadCamera=new THREE.Camera();this.stars=new StarGaussians(this.u);this.resources=[];const quad=fragment=>{const s=new THREE.Scene(),g=new THREE.PlaneGeometry(2,2),m=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:QUAD_VERTEX,fragmentShader:fragment,uniforms:this.u,depthTest:false,depthWrite:false});s.add(new THREE.Mesh(g,m));this.resources.push(g,m);return s;};this.copyScene=quad('precision highp float;in vec2 vUv;uniform sampler2D uImage;out vec4 outColor;void main(){outColor=vec4(texture(uImage,vUv).rgb,1);}');this.mergeScene=quad('precision highp float;in vec2 vUv;uniform sampler2D uBulkWater,uBlobSurface;out vec4 outColor;void main(){vec4 bulk=texture(uBulkWater,vUv),blob=texture(uBlobSurface,vUv);outColor=blob.a>0.&&blob.a<bulk.a?blob:bulk;}');this.backgroundScene=quad(background);this.waterScene=quad(water);this.submergedScene=quad(submerged);this.shellScene=quad(shell);this.lensFieldScene=quad(LENS_FIELD_FRAGMENT);this.lensScene=quad(LENS_FRAGMENT);this.photonScene=quad(photon);this.splatScene=new THREE.Scene();this.splatMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:splatVertex,fragmentShader:splatFragment,uniforms:this.u,depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendEquation:THREE.MaxEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});this.geometry=instanceGeometry(0);this.mesh=new THREE.Mesh(this.geometry,this.splatMaterial);this.mesh.frustumCulled=false;this.splatScene.add(this.mesh);const pg=instanceGeometry(48*48),pm=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:photonVertex,fragmentShader:photonFragment,uniforms:this.u,depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});this.photonGather=new THREE.Scene();const mesh=new THREE.Mesh(pg,pm);mesh.frustumCulled=false;this.photonGather.add(mesh);this.lastPhotons=-1;
 this.blobRenderer=new LabBlobRenderer(this.u,common);this.detailRenderer=new LabDetailRenderer(lab,this.u);lab.grains=this.sandGrains=new SandGrains(this.renderer,lab,this.u);this.rainSurface=new RainSurface();this.u.uRainSurface={value:this.rainSurface.texture};this.rainScene=new THREE.Scene();this.u.uRainRate={value:0};this.u.uRainFade={value:0};this.u.uRainTime={value:0};this.u.uRainTop={value:8.5};this.u.uRainVelocity={value:new THREE.Vector3()};this.u.uRainHalf={value:new THREE.Vector2(5.5,4.9)};this.rainGeometry=instanceGeometry(0);this.rainMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:RAIN_VERTEX,fragmentShader:RAIN_FRAGMENT,uniforms:this.u,depthTest:false,depthWrite:false,transparent:true,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor});this.rainMesh=new THREE.Mesh(this.rainGeometry,this.rainMaterial);this.rainMesh.frustumCulled=false;this.rainScene.add(this.rainMesh);}
 updateRain(){const lab=this.lab,rain=lab.rain;if(rain.enabled)this.rainSurface.update(lab);
 if(this.rainGeneration!==lab.generation){this.rainGeneration=lab.generation;this.rainSwitch=lab.time;this.rainWasEnabled=false;this.rainLastRate=0;}
 if(rain.enabled!==this.rainWasEnabled){this.rainSwitch=lab.time;this.rainWasEnabled=rain.enabled;}
 if(rain.enabled)this.rainLastRate=rain.rate;
 const fade=rain.enabled?Math.min(1,(lab.time-this.rainSwitch)/.2):Math.max(0,1-(lab.time-this.rainSwitch)/.2);
 this.u.uRainFade.value=fade;this.u.uRainRate.value=fade*this.rainLastRate;
 this.u.uRainTime.value=lab.time;this.u.uRainHalf.value.set(rain.skyWidth*.5,rain.skyDepth*.5);
 this.u.uRainTop.value=lab.kind==='river'?26.5:8.5;
 this.u.uRainVelocity.value.set(lab.wind*.6/lab.spec.scale,-9/lab.spec.scale,lab.wind*.08/lab.spec.scale);
 this.rainGeometry.instanceCount=fade>0?rainVisualCount(this.rainLastRate,lab.spec.scale,lab.resolution):0;
 }

 packedParcel(i){
 const lab=this.lab,o=i*4,pool=this.parcelPool??=[],p=pool[i]??=({kind:'water',position:[0,0,0],radius:0,volume:0,wet:0,dye:0,tannin:0,sediment:0});
 p.position[0]=lab.positions[o];p.position[1]=lab.positions[o+1];p.position[2]=lab.positions[o+2];p.radius=lab.spacing*(.65+.2*Math.min(1,Math.max(0,((lab.neighborCounts?.[i]||0)-5)/20)));p.volume=lab.spacing**3;p.dye=lab.chem[o];p.tannin=lab.chem[o+1];p.sediment=lab.chem[o+2];return p;
 }
 updateParticles(){const lab=this.lab,items=[],shadowItems=[],height=(x,z)=>lab.terrainHeight(x,z),refined=this.blobRenderer.update(lab);for(let i=0;i<lab.count;i++){const o=i*4;const particle=lab.optimizations?.packedFields?this.packedParcel(i):{kind:'water',position:Array.from(lab.positions.subarray(o,o+3)),radius:lab.spacing*(.65+.2*Math.min(1,Math.max(0,((lab.neighborCounts?.[i]||0)-5)/20))),volume:lab.spacing**3,wet:0,dye:lab.chem[o],tannin:lab.chem[o+1],sediment:lab.chem[o+2]};// A support image preserves the local free-surface elevation at the bank.
const image=!lab.positions[o+3]?shoreImage(particle,height):null;
shadowItems.push(particle);if(image)shadowItems.push(image);if(!refined.has(i)){items.push(particle);if(image)items.push(image);}}const rain=lab.rain.fieldItems();items.push(...rain);shadowItems.push(...rain);this.density.packedFields=lab.optimizations?.packedFields!==false;this.density.cpu=lab.gpu.cpu;this.density.emptySpace=lab.optimizations?.emptySpace!==false;this.density.update(items,lab.spacing,lab.fieldBounds);
 // The analytic daughter surfaces bypass the visible atlas. Their conserved
 // parent volume must still attenuate light, at the bounded shadow resolution.
 if(refined.size){this.shadowDensity??=new LabWaterField(this.renderer,{ratio:1});this.shadowDensity.packedFields=this.density.packedFields;this.shadowDensity.cpu=this.density.cpu;this.shadowDensity.emptySpace=this.density.emptySpace;this.shadowDensity.update(shadowItems,lab.spacing,lab.fieldBounds);this.mediumShadows.density=this.shadowDensity;}else this.mediumShadows.density=this.density;
 Object.assign(this.mediumShadows.uniforms,this.mediumShadows.density.u);const n=items.length;if(!this.capacity||n>this.capacity){this.capacity=2**Math.ceil(Math.log2(Math.max(64,n)));this.geometry.dispose();this.geometry=instanceGeometry(n);this.geometry.setAttribute('aParcel',new THREE.InstancedBufferAttribute(new Float32Array((this.capacity+320)*4),4).setUsage(THREE.DynamicDrawUsage));this.geometry.setAttribute('aColor',new THREE.InstancedBufferAttribute(new Float32Array((this.capacity+320)*4),4).setUsage(THREE.DynamicDrawUsage));this.mesh.geometry=this.geometry;}const a=this.geometry.getAttribute('aParcel'),color=this.geometry.getAttribute('aColor');if(lab.optimizations?.packedFields){for(let i=0;i<n;i++){const p=items[i],o=i*4;a.array[o]=p.position[0];a.array[o+1]=p.position[1];a.array[o+2]=p.position[2];a.array[o+3]=p.radius;color.array[o]=.82;color.array[o+1]=.9;color.array[o+2]=.95;color.array[o+3]=0;}}else items.forEach((p,i)=>{a.array.set([...p.position,p.radius],i*4);color.array.set([.82,.9,.95,0],i*4);});a.needsUpdate=color.needsUpdate=true;this.geometry.instanceCount=n;this.count=n;this.items=items;}
 render({dt=1/60,adaptive=true,focusDistance=8}={}){this.presentationDt=dt;const f=this.field,lab=this.lab,r=this.renderer,c=f.camera,u=this.u;u.uReuseSurfaceLight.value=!!lab.optimizations?.surfaceLightReuse;u.uBlobDepth.value=lab.optimizations?.blobDepth!==false;u.uTightGaussians.value=lab.optimizations?.splatBounds!==false;f.visibleSplats=0;f.sortMs=0;for(const v of [f.beach,f.grass,f.water,f.grains,f.soft,f.optics,f.lightTest])v.count=0;const current={position:c.position.toArray(),quaternion:c.quaternion.toArray()},speed=projectedMotion(f.previousCamera,current,dt,f.resolution.y*c.projectionMatrix.elements[5]*.5,focusDistance);f.previousCamera=current;f.effectivePixelTarget=f.minPixelSigma*f.motion.update(speed,dt,adaptive);const now=performance.now();if(this.adaptiveResolution&&now-this.lastLoadChange>2000&&this.timers.ms.surface){const ms=this.timers.ms.surface,next=ms>12?Math.max(.5,this.loadScale*.8):ms<5?Math.min(1,this.loadScale+.1):this.loadScale;if(next!==this.loadScale){this.loadScale=next;this.lastLoadChange=now;}}if(!this.adaptiveResolution)this.loadScale=this.fixedLoadScale??1;
 const reduction=Math.sqrt(1+Math.min(3,(f.motion.factor-1)*.15))/this.loadScale,width=Math.round(f.resolution.x/reduction),height=Math.round(f.resolution.y/reduction);if(f.target.width!==width||f.target.height!==height)f.target.setSize(width,height);u.uResolution.value.set(width,height);c.updateMatrixWorld();
 // Do not queue identical expensive water passes while an asynchronous solve
 // is pending (or the lab is paused). Camera / material edits still redraw.
 const drawKey=[JSON.stringify(lab.optimizations),lab.paused,lab.generation,lab.revision,lab.time,lab.detail.time,lab.detail.emitted,lab.detail.enabled,this.detailRenderer.material.visible,JSON.stringify(lab.balls.map(b=>[b.kind,b.shape,b.radius,b.tilt,b.spin,b.pitch,...b.color,...b.position])),lab.rain.sequence,this.mediumShadows.enabled,this.sprayShadows.enabled,this.poolShadows.enabled,u.uBodyShadows.value,u.uFoamFloorScatter.value,lab.gpu.cpu,lab.wetting.surfaceRevision,lab.motion.tilt,lab.motion.pitch,lab.motion.spin,...lab.motion.position,lab.tannins,lab.ambient,lab.sunlight,lab.lights,lab.waterfallHeight,width,height,u.uView.value,u.uSHDegree.value,u.uWaterRoughness.value,u.uWaterSceneReflections.value,u.uTurbidity.value,this.detailRenderer.material.uniforms.uHideMist.value,lab.day,lab.lunarDay,lab.moonPhaseOffset,lab.sunIntensity,lab.skyIntensity,lab.moonSize,...c.matrixWorld.elements,...c.projectionMatrix.elements].join(',');
 if(drawKey===this.drawKey){this.present(false);this.timers.poll();this.timers.ms.surface=['front','background','water','blobs'].reduce((n,k)=>n+(this.timers.ms[k]||0),0);return !f.error;}this.drawKey=drawKey;
u.uEye.value.copy(c.position);u.uInverseProjection.value.copy(c.projectionMatrixInverse);u.uCameraMatrix.value.copy(c.matrixWorld);u.uProjection.value.copy(c.projectionMatrix);u.uViewMatrix.value.copy(c.matrixWorldInverse);u.uLightExtent.value.set(lab.kind==='river'?12:11,lab.kind==='river'?120:11);u.uScale.value=lab.spec.scale;u.uSpacing.value=lab.spacing;u.uClock.value=lab.time;u.uLights.value=lab.lights;lab.syncUniforms();if(this.skyBoundRevision!==lab.sand?.revision||this.skyBoundGeneration!==lab.generation){let top=0;for(const h of lab.terrainHeights||[])top=Math.max(top,h);this.skyCeiling=Math.max(top,lab.u.uSandMax?.value.y||0)+.02;this.skyBoundRevision=lab.sand?.revision;this.skyBoundGeneration=lab.generation;}u.uSandSkyCeiling.value=this.skyBounds===false?1e10:this.skyCeiling;u.uAmbient.value=lab.ambient;u.uSunlight.value=lab.sunlight;this.timers.begin('atmosphere');const skyChanged=this.atmosphere.update(lab,u.uSH.value);this.timers.end();if(skyChanged)this.detailRenderer.pathsKey=null;lab.wetting.updateUniforms(u);u.uLensAspect.value=width/height;this.timers.begin('spray shadows');this.sprayShadows.update();this.timers.end();if(lab.kind==='pool'){this.timers.begin('pool shadows');this.poolShadows.update();this.timers.end();}else this.poolShadows.u.uPoolShadows.value=false;if(this.densityRevision!==lab.revision){this.timers.begin('density');this.updateParticles();this.timers.end();this.densityRevision=lab.revision;}this.timers.begin('medium shadows');this.mediumShadows.cpu=this.density.cpu;this.mediumShadows.update();this.timers.end();this.geometry.instanceCount=this.items.length;this.count=this.items.length+this.blobRenderer.geometry.instanceCount*5+lab.detail.count;for(const t of [this.front,this.background,this.water,this.blobs,this.resolvedWater,this.composite,this.shellTarget,this.starTarget])if(t.width!==f.target.width||t.height!==f.target.height)t.setSize(f.target.width,f.target.height);
 const bodyKey=JSON.stringify([lab.motion.position,lab.motion.tilt,lab.motion.spin,lab.motion.pitch,lab.lightEditRevision,u.uTurbidity.value,this.mediumShadows.enabled,u.uBodyShadows.value,lab.balls.map(b=>[b.kind,b.shape,b.radius,b.tilt,b.spin,b.pitch,...b.color,...b.position])]);
 if(bodyKey!==this.lastBodyKey||lab.time<this.lastPhotons||lab.time-this.lastPhotons>.35||this.lastKind!==lab.kind||this.lastTannins!==lab.tannins||this.lastShadowEnabled!==u.uSprayShadows.value){this.timers.begin('photons');r.setRenderTarget(this.photons);r.render(this.photonScene,this.quadCamera);r.setRenderTarget(this.caustics);r.setClearColor(0,0);r.clear();r.render(this.photonGather,this.quadCamera);this.lastBodyKey=bodyKey;this.lastPhotons=lab.time;this.lastKind=lab.kind;this.lastTannins=lab.tannins;this.lastShadowEnabled=u.uSprayShadows.value;this.timers.end();}
 this.timers.begin('front');r.setRenderTarget(this.front);r.setClearColor(0,0);r.clear();u.uFoam.value=false;this.splatMaterial.blendEquation=THREE.MaxEquation;this.splatMaterial.blendDst=THREE.OneFactor;r.render(this.splatScene,c);this.timers.end();this.timers.begin('background');u.uImage.value=this.background.texture;r.setRenderTarget(this.background);r.render(this.backgroundScene,this.quadCamera);this.timers.end();this.timers.begin('water');r.setRenderTarget(this.water);r.render(this.waterScene,this.quadCamera);r.render(this.submergedScene,this.quadCamera);this.timers.end();this.timers.begin('blobs');r.setRenderTarget(this.blobs);r.setClearColor(0,0);r.clear();r.render(this.blobRenderer.scene,c);r.setRenderTarget(this.resolvedWater);r.render(this.mergeScene,this.quadCamera);u.uImage.value=this.resolvedWater.texture;r.setRenderTarget(this.composite);r.render(this.copyScene,this.quadCamera);
 this.timers.end();this.detailRenderer.render(r,c,this.timers);this.timers.begin('sand grains');this.sandGrains.render(r,c);this.timers.end();this.timers.begin('rain / lens');this.updateRain();this.count+=this.rainGeometry.instanceCount;r.render(this.rainScene,c);u.uImage.value=this.composite.texture;r.setRenderTarget(this.shellTarget);r.render(this.shellScene,this.quadCamera);this.present();this.timers.end();if(!this.objectProgramsReady&&r.warmObjectPrograms){const target=r.getRenderTarget();r.setRenderTarget(this.background);this.objectProgramsReady=r.warmObjectPrograms([this.backgroundScene,this.waterScene,this.submergedScene,this.shellScene,this.blobRenderer.scene,this.detailRenderer.opticalScene,this.detailRenderer.scene,this.detailRenderer.composite,this.rainScene],c);r.setRenderTarget(target);}this.timers.poll();this.timers.ms.surface=['front','background','water','blobs'].reduce((n,k)=>n+(this.timers.ms[k]||0),0);return !f.error;}
 // Lens motion does not invalidate the world-space optical / surface passes.
 present(dirty=true){const r=this.renderer,f=this.field,u=this.u;this.lab.wetting.updateUniforms(u);u.uImage.value=this.shellTarget.texture;
 // Project catalogue Gaussians every presentation, even while physics waits.
 // Reuse opaque/water depths; no atmosphere ray march or star image texture.
 r.setRenderTarget(u.uLensCount.value?this.starTarget:f.target);r.render(this.copyScene,this.quadCamera);this.stars.render(r,f.camera,this.exposure,this.presentationDt??1/60);u.uImage.value=this.starTarget.texture;
 if(u.uLensCount.value){r.setRenderTarget(this.lensField);r.render(this.lensFieldScene,this.quadCamera);r.setRenderTarget(f.target);r.render(this.lensScene,this.quadCamera);}
 this.exposure.present(f.target,this.presentationDt??1/60,{dirty:true,cpu:this.lab.gpu.cpu});}

}
