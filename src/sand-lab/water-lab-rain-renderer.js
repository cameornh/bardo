import {GAUSSIAN_BOUNDS_GLSL} from './gaussian-bounds.js';
import {LAB_LIGHTING_GLSL} from './water-lab-lighting.js';
import {LAB_LIGHT_VISIBILITY_GLSL} from './water-lab-light-visibility.js';
import {LAB_GEOMETRY_GLSL} from './water-lab-model.js';
import {SOLUTE_GLSL} from './water-lab-solutes.js';
import {SH_GLSL} from '../shaders.js';
import {WATER_MATERIAL_GLSL} from '../water-material.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';

// Sampling the appearance of a mass-bearing packet is independent of its
// bookkeeping. Larger / finer fixtures get more bounded GPU-only droplets.
export function rainVisualCopies(scale,resolution=1){return Math.min(64,Math.max(1,Math.ceil(8*Math.pow(scale,.65)*Math.pow(resolution,1.35))));}
export function rainVisualRadius(scale,random){return Math.min(.16,(.00065+.00135*random)/scale);}
export const RAIN_VERTEX=`precision highp float;precision highp int;
in vec4 aRain;in vec3 aFall;in float aRainSeed;in float aRainSpread;in float aRainAge;uniform vec2 uResolution;uniform vec3 uEye;
uniform int uRainCopies;uniform float uScale,uSpacing,uAmbient,uSunlight,uLights;
uniform vec3 uSH[16];uniform int uSHDegree;
out vec2 vQ;out float vDepth,vAlpha,vBlob;flat out vec3 vLight;
${GAUSSIAN_BOUNDS_GLSL}
${SH_GLSL}
${WATER_MATERIAL_GLSL}
${SOLUTE_GLSL}
${LAB_FIELD_GLSL}
${LAB_GEOMETRY_GLSL}
${LAB_LIGHTING_GLSL}
${LAB_LIGHT_VISIBILITY_GLSL}
float rh(float n){return fract(sin(n*91.173+18.17)*43758.54);}
void main(){
 float child=float(gl_InstanceID%uRainCopies),seed=aRainSeed*67.+child*19.;
 vec3 jitter=vec3(rh(seed),rh(seed+7.),rh(seed+13.))-.5;
 // Stable independent columns; no visible bunch of children around a packet.
 vec3 center=aRain.xyz+vec3(jitter.x*2.8,-rh(seed+7.)*1.8,jitter.z*2.8)*aRainSpread;
 float rainFade=mix(1.,smoothstep(0.,.10,aRainAge),aRainSpread);
 vec4 p=viewMatrix*vec4(center,1);float z=max(.05,-p.z),s=aRain.w*(.65+.7*rh(seed+23.));
 vec3 fall=mat3(viewMatrix)*aFall,direction=normalize(fall+vec3(0,1e-8,0));
 vec3 jx=vec3(projectionMatrix[0][0]/z,0,projectionMatrix[0][0]*p.x/(z*z))*uResolution.x*.5;
 vec3 jy=vec3(0,projectionMatrix[1][1]/z,projectionMatrix[1][1]*p.y/(z*z))*uResolution.y*.5;
 vec2 flow=vec2(dot(jx,direction),dot(jy,direction));
 vBlob=1.-smoothstep(.08,.45,uScale);
 // Short exposure streaks at normal distances; physically round droplets at
 // miniature scales. No fixed two-pixel streak / parallel curtain.
 float trail=mix(min(.09,length(aFall)*(.002+.003*rh(seed+4.))),s*.18,vBlob);
 float xx=s*s*dot(jx,jx)+trail*trail*flow.x*flow.x+.09;
 float xy=s*s*dot(jx,jy)+trail*trail*flow.x*flow.y;
 float yy=s*s*dot(jy,jy)+trail*trail*flow.y*flow.y+.09;
 float l=sqrt(max(0.,pow((xx-yy)*.5,2.)+xy*xy)),e1=max(1e-8,(xx+yy)*.5+l),e2=max(1e-8,(xx+yy)*.5-l);
 vec2 axis=abs(xy)>1e-8?normalize(vec2(e1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);
 vAlpha=(.0425+.0425*rh(seed+29.))*rainFade*smoothstep(1.5,5.,-p.z/max(s,trail));float support=gaussianSupport(vAlpha,.005);
 vec4 clip=projectionMatrix*p;clip.xy+=2.*support*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y)/uResolution*clip.w;
 if(support<=0.||p.z>-.05||labOpaque(center)<0.||vessel(center)<0.)clip=vec4(2,2,2,1);
 gl_Position=clip;vQ=position.xy*support;vDepth=length(p.xyz);
 float basis[16];basisSH(normalize(uEye-center),basis);vec3 light=vec3(0);
 for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;light+=uSH[i]*basis[i];}
 vLight=max(light,vec3(0))*uAmbient*mediumSky(center)+LAB_SUN*uSunlight*sunTransmission(center,uScale);
 if(uStation==2)for(int i=0;i<3;i++)vLight+=poolColor(i)*3.*uLights*poolFalloff(center,poolLamp(i))*poolTransmission(center,i,uScale);
}`;
export const RAIN_FRAGMENT=`precision highp float;
in vec2 vQ;in float vDepth,vAlpha,vBlob;flat in vec3 vLight;out vec4 outColor;
uniform sampler2D uOpaqueRead,uWaterSurface;uniform vec2 uResolution;
void main(){
 vec2 uv=gl_FragCoord.xy/uResolution;if(vDepth>texture(uOpaqueRead,uv).a)discard;
 float r2=dot(vQ,vQ),a=exp(-.5*r2)*vAlpha;if(a<.005)discard;
 // Sub-grid drops are collected at their first wet interface. Hide the
 // jittered appearance samples when they fall behind that interface.
 if(vDepth>texture(uWaterSurface,uv).a+.015)discard;
 float rim=exp(-pow(sqrt(r2)-1.5,2.)*5.);
 vec3 light=vLight*mix(1.,.2+rim*1.6+exp(-dot(vQ-vec2(-.5,.65),vQ-vec2(-.5,.65))*9.)*1.8,vBlob);
 outColor=vec4(light*a,a);
}`;
