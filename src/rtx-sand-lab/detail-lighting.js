import {SH_GLSL} from '../shaders.js';
import {CLIPMAP_FIELD_GLSL} from './clipmap-water.js';
import {SOLUTE_GLSL} from '../sand-lab/water-lab-solutes.js';
import {DETAIL_LIGHT_GLSL} from '../sand-lab/water-lab-detail-optics.js';
import {DETAIL_OPACITY_GLSL,DETAIL_RADIUS_GLSL} from '../sand-lab/water-lab-detail-opacity.js';
import {GAUSSIAN_BOUNDS_GLSL} from '../sand-lab/gaussian-bounds.js';
import {MEDIUM_SHADOW_GLSL} from '../sand-lab/water-lab-medium-shadows.js';
import {SPRAY_SHADOW_GLSL} from '../sand-lab/water-lab-spray-shadows.js';
import {LIGHT_BALL_RADIANCE} from '../sand-lab/local-light.js';

// Fine translucent markers reuse world-space illumination. The old shader
// traced terrain, glass and sand inside every light inside every view segment;
// activating loose sand made that nested program fail on the Metal driver.
// Keep the Gaussian projection, SH response, cluster shadows and spectral view
// transport. Local lights use bounded water absorption, without geometry rays.
export const LIVE_DETAIL_LIGHTING=`precision highp float;precision highp int;
layout(location=0)out vec4 outColor;layout(location=1)out vec4 outTau;layout(location=2)out vec4 outScatter;
uniform highp sampler2D uDetailP,uDetailV,uDetailI,uWaterSurface,uOpaqueRead,uBodies,uBodyExtra;
uniform int uBodyCount;uniform vec3 uEye,uSH[16];uniform int uSHDegree;
uniform mat4 uViewMatrix,uProjection;uniform vec2 uResolution;
uniform float uScale,uSpacing,uTurbidity,uTannins,uAmbient,uSunlight,uLights,uDetailLightScale;
${DETAIL_OPACITY_GLSL}${DETAIL_RADIUS_GLSL}${GAUSSIAN_BOUNDS_GLSL}
${CLIPMAP_FIELD_GLSL}${SH_GLSL}${SOLUTE_GLSL}${DETAIL_LIGHT_GLSL}
${MEDIUM_SHADOW_GLSL}${SPRAY_SHADOW_GLSL}
vec3 detailEnvironment(vec3 normal){float b[16];basisSH(normal,b);vec3 light=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;light+=uSH[i]*b[i]*diffuseSHBand(i);}return max(vec3(0),light)*uAmbient;}
vec4 detailBody(int i){return texelFetch(uBodies,ivec2((i*2)%256,(i*2)/256),0);}
vec3 detailLamp(vec3 p,int i){
 vec4 b=detailBody(i);vec3 delta=b.xyz-p;float distance=length(delta),radius=max(.00001,b.w),travel=max(0.,distance-radius);vec3 direction=delta/max(.00001,distance),tau=vec3(0);
 // Restrict quadrature to the occupied atlas, including a long air-to-water
 // path. Otherwise a submerged lamp can incorrectly illuminate distant air.
 vec3 inv=1./(direction+vec3(1e-12)),low=(uFieldOrigin-p)*inv,high=(uFieldOrigin+(uFieldSize-1.)*uFieldDx-p)*inv,nearT=min(low,high),farT=max(low,high);
 float begin=max(0.,max(nearT.x,max(nearT.y,nearT.z))),end=min(travel,min(farT.x,min(farT.y,farT.z))),ds=max(0.,end-begin)/4.;
 for(int k=0;k<4;k++){vec4 a=parcelSample(p+direction*(begin+(float(k)+.5)*ds));tau+=soluteExtinction(a.yzw/max(.001,a.x),uTannins,uTurbidity)*smoothstep(.12,.24,a.x)*ds*uScale;}
 return texelFetch(uBodyExtra,ivec2((i*3)%256,(i*3)/256),0).rgb*uLights*${LIGHT_BALL_RADIANCE.toFixed(1)}*radius*radius/(radius*radius+distance*distance)*exp(-tau);
}
vec3 detailObjectLight(vec3 p,vec3 ray,float kind,vec3 normal){vec3 light=vec3(0);for(int i=0;i<uBodyCount;i++){if(texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w<2.5)continue;vec3 delta=detailBody(i).xyz-p;light+=detailLamp(p,i)*detailAlbedo(kind)*detailResponse(kind,-ray,normal,normalize(delta+vec3(0,1e-12,0)));}return light;}
vec3 detailLocalIncident(vec3 p,vec3 ray){vec3 light=vec3(0);for(int i=0;i<uBodyCount;i++){if(texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w<2.5)continue;vec4 b=detailBody(i);vec3 delta=b.xyz-p;float g=.55*(1.-clamp(b.w/max(b.w,length(delta)),0.,1.));light+=detailLamp(p,i)*3.14159265*phaseHG(dot(ray,normalize(delta+vec3(0,1e-12,0))),g);}return light;}
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);vec4 source=texelFetch(uDetailP,uv,0),velocity=texelFetch(uDetailV,uv,0);outColor=vec4(0,0,0,-1);outTau=vec4(0);outScatter=vec4(0);
 if(source.w>=velocity.w||velocity.w<=0.)return;
 vec4 p=uViewMatrix*vec4(source.xyz,1),info=texelFetch(uDetailI,uv,0);info.x=detailDisplayRadius(info.x,info.y);
 if(uTightGaussians&&detailOpacity(info.y,source.w,velocity.w,info.z)<=.0001)return;if(p.z>-max(.025,info.x*1.5))return;
 float depth=length(p.xyz);vec4 clip=uProjection*p;
 if(!gaussianIntersectsView(p.xyz,3.*info.x*(info.y<.5?sqrt(2.2):1.),vec2(uProjection[0][0],uProjection[1][1]),uResolution))return;
 vec2 centerUv=clip.xy/clip.w*.5+.5,support=vec2(uProjection[0][0],uProjection[1][1])*info.x*6.*(1.+abs(p.xy)/max(.01,-p.z))/max(.01,-p.z-info.x*1.5);
 if(any(lessThan(centerUv+support,vec2(0)))||any(greaterThan(centerUv-support,vec2(1))))return;
 if(depth>texture(uOpaqueRead,clamp(centerUv,0.,1.)).a+info.x*6.)return;
 float surface=texture(uWaterSurface,clamp(centerUv,0.,1.)).a,begin=parcelSample(uEye).x>.18?0.:min(depth,surface),kind=info.y;
 vec3 ray=normalize(source.xyz-uEye),normal=vec3(0,1,0);
 if(kind>.5&&kind<1.5){float e=max(fieldDetailDx(source.xyz)*.9,uSpacing*.12);vec3 q=source.xyz,gradient=vec3(parcelSample(q+vec3(e,0,0)).x-parcelSample(q-vec3(e,0,0)).x,parcelSample(q+vec3(0,e,0)).x-parcelSample(q-vec3(0,e,0)).x,parcelSample(q+vec3(0,0,e)).x-parcelSample(q-vec3(0,0,e)).x);if(length(gradient)>1e-6)normal=-normalize(gradient);}
 float response=detailClusterResponse(detailResponse(kind,-ray,normal,labSunDirection()),spraySun(source.xyz));
 vec3 white=detailLight(kind,detailEnvironment(kind>.5&&kind<1.5?normal:vec3(0,1,0))*mediumSky(source.xyz),1.,mediumSun(source.xyz),uSunlight,response)+detailObjectLight(source.xyz,ray,kind,normal);
 float lengthStep=(depth-begin)/8.,path=0.;
 // Evaluate movable lamps once for the column, not within its integration
 // loop. Sun/sky extinction still varies across all eight occupied segments.
 vec3 local=lengthStep>.00001?detailLocalIncident(uEye+ray*(begin+depth)*.5,ray):vec3(0),sky=detailEnvironment(vec3(0,1,0));
 for(int i=0;i<8;i++){
  if(lengthStep<=.00001)break;vec3 q=uEye+ray*(begin+(float(i)+.5)*lengthStep);vec4 a=parcelSample(q);float wet=smoothstep(.12,.24,a.x)*lengthStep*uScale;if(wet<=0.)continue;
  vec3 c=a.yzw/max(a.x,.0001),ext=soluteExtinction(c,uTannins,uTurbidity),incident=sky*mediumSky(q)+LAB_SUN*uSunlight*mediumSun(q)*spraySun(q)*3.14159265*phaseHG(dot(ray,labSunDirection()),.55)+local;
  detailTransportStep(outTau.rgb,outScatter.rgb,ext,soluteScatter(c,uTannins,uTurbidity),incident,wet);path+=wet;
 }
 outColor=vec4(white*uDetailLightScale,path);outScatter.rgb*=uDetailLightScale;
}`;

export function installLiveDetailLighting(detail,fieldSource=CLIPMAP_FIELD_GLSL){
 detail.opticalMaterial.fragmentShader=LIVE_DETAIL_LIGHTING.replace(CLIPMAP_FIELD_GLSL,fieldSource);
 detail.opticalMaterial.name='fine-water-cached-lighting';
 detail.opticalMaterial.needsUpdate=true;
 detail.material.fragmentShader=LIVE_DETAIL_FRAGMENT;
 detail.material.name='fine-water-depth-composite';
 detail.material.needsUpdate=true;
}

// The resolved opaque depth already includes carved terrain and rigid bodies.
// Use it to clip fine splats, instead of evaluating all those shapes a second
// time inside every covered pixel. No geometry-dependent shader variants.
export const LIVE_DETAIL_FRAGMENT=`precision highp float;
in vec2 vQ;in float vAlpha,vDepth;flat in vec4 vOptical;flat in vec3 vViewTau,vScatter;flat in vec3 vKindRadiusClearance;
uniform bool uHideMist;uniform highp sampler2D uOpaqueRead;uniform vec2 uResolution;out vec4 outColor;
void main(){
 if(vOptical.a<0.||vAlpha<.0001||(uHideMist&&vKindRadiusClearance.x>2.5))discard;
 float opaque=texture(uOpaqueRead,gl_FragCoord.xy/uResolution).a;if(vDepth>opaque)discard;
 float a=exp(-.5*dot(vQ,vQ))*vAlpha;if(a<.0001)discard;
 bool wet=vOptical.a>0.;vec3 radiance=wet?vOptical.rgb*exp(-vViewTau)+vScatter:vOptical.rgb;
 if(wet)a*=exp(-dot(vViewTau,vec3(.1)));
 if(any(isnan(radiance))||any(isinf(radiance)))discard;
 outColor=vec4(max(vec3(0),radiance)*a,a);
}`;
