import {RAIN_SAMPLE_GLSL} from './rain-appearance.js';
import {GAUSSIAN_BOUNDS_GLSL} from './gaussian-bounds.js';
import {LAB_LIGHTING_GLSL} from './water-lab-lighting.js';
import {LAB_LIGHT_VISIBILITY_GLSL} from './water-lab-light-visibility.js';
import {LAB_GEOMETRY_GLSL} from './water-lab-model.js';
import {SOLUTE_GLSL} from './water-lab-solutes.js';
import {SH_GLSL} from '../shaders.js';
import {WATER_MATERIAL_GLSL} from '../water-material.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';

export const RAIN_VERTEX=`precision highp float;precision highp int;
uniform vec2 uResolution,uRainHalf;uniform vec3 uEye,uRainVelocity;uniform float uRainTime,uRainFade,uRainTop;
uniform float uScale,uSpacing,uAmbient,uSunlight,uLights;
uniform vec3 uSH[16];uniform int uSHDegree;
out vec2 vQ;out float vDepth,vAlpha,vBlob;flat out vec3 vLight;
${RAIN_SAMPLE_GLSL}
${GAUSSIAN_BOUNDS_GLSL}
${SH_GLSL}
${WATER_MATERIAL_GLSL}
${SOLUTE_GLSL}
${LAB_FIELD_GLSL}
${LAB_GEOMETRY_GLSL}
${LAB_LIGHTING_GLSL}
${LAB_LIGHT_VISIBILITY_GLSL}
void main(){
 uint id=uint(gl_InstanceID);
 vec3 center=rainVisualPoint(id,uRainTime,uRainVelocity,uRainHalf,uRainTop,-.8);
 vec4 p=viewMatrix*vec4(center,1);float z=max(.05,-p.z),s=(.00065+.00008*rainHash(id+23u))/uScale;
 vec3 fall=mat3(viewMatrix)*uRainVelocity,direction=normalize(fall+vec3(0,1e-8,0));
 vec3 jx=vec3(projectionMatrix[0][0]/z,0,projectionMatrix[0][0]*p.x/(z*z))*uResolution.x*.5;
 vec3 jy=vec3(0,projectionMatrix[1][1]/z,projectionMatrix[1][1]*p.y/(z*z))*uResolution.y*.5;
 vec2 flow=vec2(dot(jx,direction),dot(jy,direction));
 vBlob=1.-smoothstep(.08,.45,uScale);
 // Integrate a short exposure along the fall direction while keeping the
 // droplet's physical width. The projection handles distance and scene scale.
 float trail=length(uRainVelocity)*(.025+.015*rainHash(id+4u));
 float xx=s*s*dot(jx,jx)+trail*trail*flow.x*flow.x+.09;
 float xy=s*s*dot(jx,jy)+trail*trail*flow.x*flow.y;
 float yy=s*s*dot(jy,jy)+trail*trail*flow.y*flow.y+.09;
 float l=sqrt(max(0.,pow((xx-yy)*.5,2.)+xy*xy)),e1=max(1e-8,(xx+yy)*.5+l),e2=max(1e-8,(xx+yy)*.5-l);
 vec2 axis=abs(xy)>1e-8?normalize(vec2(e1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);
 vAlpha=(.0425+.0425*rainHash(id+29u))*uRainFade*smoothstep(1.5,5.,-p.z/max(s,trail));float support=gaussianSupport(vAlpha,.005);
 vec4 clip=projectionMatrix*p;clip.xy+=2.*support*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y)/uResolution*clip.w;
 if(support<=0.||p.z>-.05||!gaussianIntersectsView(p.xyz,3.*max(s,trail),vec2(projectionMatrix[0][0],projectionMatrix[1][1]),uResolution)||labPhysicalSolid(center)<0.)clip=vec4(2,2,2,1);
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
