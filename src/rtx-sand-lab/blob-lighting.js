import {SH_GLSL} from '../shaders.js';
import {WATER_MATERIAL_GLSL} from '../water-material.js';
import {SOLUTE_GLSL} from '../sand-lab/water-lab-solutes.js';
import {LAB_LIGHTING_GLSL} from '../sand-lab/water-lab-lighting.js';
import {MEDIUM_SHADOW_GLSL} from '../sand-lab/water-lab-medium-shadows.js';
import {CELESTIAL_GLSL} from '../sand-lab/celestial-sky.js';
import {LIGHT_BALL_RADIANCE} from '../sand-lab/local-light.js';

// Detached droplets use the already shaded opaque/depth image plus the shared
// atmosphere and medium-light cache. Never inline scene SDFs or object shadow
// rays here: those nested paths caused driver compiler failure with objects.
// Off-screen reflection falls back to the directional sky, as screen-space
// reflection does elsewhere. Bulk-water shading is unchanged.
export const BLOB_LIGHTING_GLSL=`
${SH_GLSL}${WATER_MATERIAL_GLSL}${SOLUTE_GLSL}${LAB_LIGHTING_GLSL}${MEDIUM_SHADOW_GLSL}${CELESTIAL_GLSL}
uniform vec3 uEye,uSH[16];uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;
uniform vec2 uResolution;uniform float uScale,uSpacing,uTannins,uTurbidity,uAmbient,uSunlight,uLights,uWaterRoughness;
uniform int uSHDegree,uView,uBodyCount;uniform bool uWaterSceneReflections;
uniform highp sampler2D uImage,uBodies,uBodyExtra;
vec3 rayAt(vec2 uv){vec4 p=uInverseProjection*vec4(uv*2.-1.,1,1);return normalize(mat3(uCameraMatrix)*p.xyz/p.w);}
vec3 environment(vec3 d){float b[16];basisSH(d,b);vec3 c=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;c+=b[i]*uSH[i]*diffuseSHBand(i);}return max(c,vec3(0))*uAmbient;}
vec3 sky(vec3 d){return labSky(d)*uAmbient+celestialSky(d);}
bool projectScene(vec3 p,out vec2 uv){vec4 clip=uProjection*uViewMatrix*vec4(p,1);if(clip.w<=.0001)return false;uv=clip.xy/clip.w*.5+.5;return all(greaterThan(uv,vec2(0)))&&all(lessThan(uv,vec2(1)));}
vec3 sceneReflection(vec3 p,vec3 d){
 vec3 fallback=sky(d);if(!uWaterSceneReflections)return fallback;
 float travel=max(.02,uSpacing*.2),prior=-1e4;
 for(int i=0;i<12;i++){
  vec3 q=p+d*travel;vec2 uv;if(!projectScene(q,uv))break;
  vec4 hit=textureLod(uImage,uv,0.);float gap=length(q-uEye)-hit.a;
  if(hit.a<9999.&&gap>=0.&&prior<0.&&gap<max(uSpacing*.6,travel*.3)){
   float edge=smoothstep(0.,.06,min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y)));
   return mix(fallback,hit.rgb,edge);
  }
  prior=gap;travel=travel*1.55+uSpacing*.25;
 }return fallback;
}
vec3 shadeWater(vec3 p,vec3 n,vec3 ray,float path,vec3 concentration){
 vec3 refracted=refract(ray,n,1./WATER_IOR);vec2 uv=gl_FragCoord.xy/uResolution,exitUV;
 vec4 behind=textureLod(uImage,uv,0.);float depth=length(p-uEye);
 // Reject foreground samples so an offset lookup cannot paint objects that
 // are in front of the droplet onto its back surface.
 if(projectScene(p+refracted*path,exitUV)){vec4 candidate=textureLod(uImage,exitUV,0.);if(candidate.a>depth)behind=candidate;}
 vec3 bottom=behind.a<9999.?behind.rgb:sky(refracted);
 float opticalPath=max(0.,min(path,max(0.,behind.a-depth)))*uScale;
 vec3 extinction=soluteExtinction(concentration,uTannins,uTurbidity),trans=exp(-extinction*opticalPath),scatter=soluteScatter(concentration,uTannins,uTurbidity);
 vec3 direct=LAB_SUN*uSunlight*mediumSun(p),incident=environment(vec3(0,1,0))*mediumSky(p)+direct*3.14159265*phaseHG(dot(ray,labSunDirection()),.55);
 vec3 highlight=direct*3.14159265*labSpecular(n,-ray,labSunDirection(),uWaterRoughness,.02037);
 for(int i=0;i<uBodyCount;i++){
  if(texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w<2.5)continue;
  vec4 body=texelFetch(uBodies,ivec2((i*2)%256,(i*2)/256),0);vec3 delta=body.xyz-p;float distance=max(.00001,length(delta)),radius=max(.00001,body.w);vec3 direction=delta/distance;
  vec3 light=texelFetch(uBodyExtra,ivec2((i*3)%256,(i*3)/256),0).rgb*uLights*${LIGHT_BALL_RADIANCE.toFixed(1)}*radius*radius/(radius*radius+distance*distance);
  incident+=light*3.14159265*phaseHG(dot(ray,direction),.4);
  highlight+=light*3.14159265*labSpecular(n,-ray,direction,uWaterRoughness,.02037);
 }
 vec3 color=bottom*trans+incident*scatter/max(extinction,vec3(.0001))*(1.-trans);
 color=mix(color,sceneReflection(p,reflect(ray,n)),waterFresnel(dot(n,-ray)))+highlight;
 if(uView==1)color=n*.5+.5;if(uView==2)color=concentration;return color;
}
`;
