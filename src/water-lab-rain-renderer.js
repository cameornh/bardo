import {SH_GLSL} from './shaders.js';
import {WATER_MATERIAL_GLSL} from './water-material.js';
import {LAB_FIELD_GLSL} from './water-lab-field.js';

// Each visible Gaussian is a live, mass-bearing precipitation packet. The
// pixel floor is a visibility approximation, independent of simulation scale.
export const RAIN_VERTEX=`precision highp float;
in vec4 aRain;in vec3 aFall;uniform vec2 uResolution;uniform vec3 uEye;
out vec2 vQ;out float vDepth;out vec3 vDirection,vCenter;
void main(){
 vec4 p=viewMatrix*vec4(aRain.xyz,1);float z=max(.05,-p.z),s=aRain.w;
 vec3 fall=mat3(viewMatrix)*aFall,direction=normalize(fall+vec3(0,1e-8,0));
 vec3 jx=vec3(projectionMatrix[0][0]/z,0,projectionMatrix[0][0]*p.x/(z*z))*uResolution.x*.5;
 vec3 jy=vec3(0,projectionMatrix[1][1]/z,projectionMatrix[1][1]*p.y/(z*z))*uResolution.y*.5;
 vec2 flow=vec2(dot(jx,direction),dot(jy,direction));
 vec2 axisFlow=flow/max(length(flow),1e-6);
 // Short velocity-aligned support, with a narrow, readable screen footprint.
 float trail=min(.18,max(s*2.,length(aFall)*.008));
 float xx=s*s*dot(jx,jx)+trail*trail*flow.x*flow.x+.16+4.*axisFlow.x*axisFlow.x;
 float xy=s*s*dot(jx,jy)+trail*trail*flow.x*flow.y+4.*axisFlow.x*axisFlow.y;
 float yy=s*s*dot(jy,jy)+trail*trail*flow.y*flow.y+.16+4.*axisFlow.y*axisFlow.y;
 float l=sqrt(max(0.,pow((xx-yy)*.5,2.)+xy*xy)),e1=max(1e-8,(xx+yy)*.5+l),e2=max(1e-8,(xx+yy)*.5-l);
 vec2 axis=abs(xy)>1e-8?normalize(vec2(e1-yy,xy)):xx>=yy?vec2(1,0):vec2(0,1);
 vec4 clip=projectionMatrix*p;clip.xy+=6.*(axis*sqrt(e1)*position.x+vec2(-axis.y,axis.x)*sqrt(e2)*position.y)/uResolution*clip.w;
 if(p.z>-.05)clip=vec4(2,2,2,1);gl_Position=clip;vQ=position.xy*3.;vDepth=length(p.xyz);vDirection=normalize(uEye-aRain.xyz);vCenter=aRain.xyz;
}`;
export const RAIN_FRAGMENT=`precision highp float;precision highp int;
in vec2 vQ;in float vDepth;in vec3 vDirection,vCenter;out vec4 outColor;
${SH_GLSL}
${WATER_MATERIAL_GLSL}
${LAB_FIELD_GLSL}
uniform vec3 uSH[16],uEye;uniform int uSHDegree;
uniform highp sampler2D uOpaqueRead,uWaterSurface;uniform vec2 uResolution;uniform float uScale,uAmbient,uTurbidity;
void main(){
 vec2 uv=gl_FragCoord.xy/uResolution;if(vDepth>texture(uOpaqueRead,uv).a)discard;
 float a=exp(-.5*dot(vQ,vQ))*.6;if(a<.006)discard;
 float basis[16];basisSH(normalize(vDirection),basis);vec3 light=vec3(0);
 for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;light+=uSH[i]*basis[i];}
 // Test actual reconstructed water, not the conservative bulk-splat bounds.
 float surface=texture(uWaterSurface,uv).a,path=0.;
 if(vDepth>surface){float begin=parcelSample(uEye).x>.18?0.:surface,stepLength=(vDepth-begin)/6.;vec3 ray=normalize(vCenter-uEye);
   for(int i=0;i<6;i++)path+=smoothstep(.08,.22,parcelSample(uEye+ray*(begin+(float(i)+.5)*stepLength)).x)*stepLength*uScale;}
 vec3 trans=waterTransmission(path,uTurbidity);
 vec3 color=(vec3(.6,.7,.8)+max(light,vec3(0))*2.2)*uAmbient;
 outColor=vec4(color*trans*a,a*max(trans.x,max(trans.y,trans.z)));
}`;
