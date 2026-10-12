import { TERRAIN_GLSL } from './terrain.js';
import { WATER_MATERIAL_GLSL } from './water-material.js';
import { SH_GLSL } from './shaders.js';

// Reconstruct one optical interface from Gaussian moments. All depth and
// thickness input comes from the simulated particles; no animated normal map.
export const WATER_SURFACE_FRAGMENT=`precision highp float;
in vec2 vUv;out vec4 outColor;
uniform sampler2D uWaterMoments,uWaterBackground,uTerrainDepthTexture;
uniform mat4 uInverseProjection,uCameraMatrix,uProjection,uViewMatrix;
uniform vec2 uResolution;uniform vec3 uEye,uLight,uBall,uWaterSH[16];
uniform float uBallRadius,uWaterRoughness,uTurbidity;uniform bool uReflections;uniform int uSHDegree;
${TERRAIN_GLSL}
${SH_GLSL}
${WATER_MATERIAL_GLSL}
vec3 rayAt(vec2 uv){vec4 h=uInverseProjection*vec4(uv*2.-1.,1,1);return normalize(mat3(uCameraMatrix)*(h.xyz/h.w));}
vec3 positionAt(vec2 uv){vec4 m=texture(uWaterMoments,uv);float depth=m.y/max(m.x,1e-12);vec3 ray=rayAt(uv);return uEye+ray*depth/max(dot(ray,-uCameraMatrix[2].xyz),.01);}
vec3 environment(vec3 d){float b[16];basisSH(d,b);vec3 c=vec3(0);for(int i=0;i<16;i++){if(i>=(uSHDegree+1)*(uSHDegree+1))break;c+=uWaterSH[i]*b[i];}return max(c,vec3(0));}
void main(){
 vec4 m=texture(uWaterMoments,vUv);if(m.x<1e-9||m.z<.003)discard;
 float terrainDepth=texture(uTerrainDepthTexture,vUv).r;
 vec4 terrainHit=uInverseProjection*vec4(vUv*2.-1.,terrainDepth*2.-1.,1.);
 float waterDepth=m.y/max(m.x,1e-12),groundDepth=-terrainHit.z/terrainHit.w;
 if(waterDepth>groundDepth)discard;
 vec3 p=positionAt(vUv),ray=rayAt(vUv),v=-ray;
 vec2 dx=vec2(2.5/uResolution.x,0.),dy=vec2(0.,2.5/uResolution.y);
 vec3 n=normalize(cross(positionAt(vUv+dx)-positionAt(vUv-dx),positionAt(vUv+dy)-positionAt(vUv-dy)));if(dot(n,v)<0.)n=-n;
 if(any(isnan(n)))n=vec3(0,1,0);
 float foam=clamp(m.w/max(m.x,1e-12),0.,1.);
 vec3 l=normalize(uLight),h=normalize(l+v);float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,h),0.);
 float fresnel=waterFresnel(nv);
 vec3 transmittedRay=refract(ray,n,1./WATER_IOR),hit=p;float lengthInside=0.;bool found=false;
 // Follow the refracted ray to the authoritative terrain. This is one surface
 // interface, not multi-bounce transport; caustics require light-side transport.
 for(int i=0;i<40;i++){hit=p+transmittedRay*lengthInside;float d=terrainField(hit);if(d<.006){found=true;break;}lengthInside+=max(d*.95,.015);if(lengthInside>8.)break;}
 float thickness=found?lengthInside:min(3.,m.z*2.);
 vec4 clip=uProjection*uViewMatrix*vec4(hit,1.);vec2 refractedUV=clip.xy/clip.w*.5+.5;
 vec3 bottom=vec3(.25,.22,.12)*(.35+.8*max(l.y,0.));
 if(found&&clip.w>0.&&all(greaterThan(refractedUV,vec2(0)))&&all(lessThan(refractedUV,vec2(1))))bottom=texture(uWaterBackground,refractedUV).rgb;
 vec3 color=waterVolume(bottom,thickness,uTurbidity,environment(vec3(0,1,0))*2.,dot(-l,ray));
 color*=1.-fresnel;if(uReflections)color+=environment(reflect(ray,n))*fresnel;
 float rough=mix(uWaterRoughness,.65,foam),a=max(rough*rough,.012),a2=a*a,denom=nh*nh*(a2-1.)+1.;
 float distribution=a2/(3.14159265*denom*denom),k=(rough+1.)*(rough+1.)/8.;
 float geometry=nv/(nv*(1.-k)+k)*nl/max(nl*(1.-k)+k,.001);
 float F=.02037+.97963*pow(1.-max(dot(v,h),0.),5.);
 color+=vec3(5.,4.6,3.9)*distribution*geometry*F/max(4.*nv,.001);
 color=mix(color,vec3(.8,.86,.83)*(.45+.65*nl),foam);
 float alpha=(1.-exp(-m.z*12.))*smoothstep(0.,.045,groundDepth-waterDepth);outColor=vec4(color*alpha,alpha);
}`;

export const WATER_MOMENTS_FRAGMENT=`precision highp float;
uniform sampler2D uTerrainDepthTexture;uniform vec2 uResolution;
uniform vec3 uEye,uBall;uniform float uBallRadius,uNearestDepth;
uniform mat4 uInverseProjection,uCameraMatrix;
in vec2 vGaussian;in vec3 vCenter;in float vTau,vLinearDepth,vSigma,vFoam;out vec4 outColor;
void main(){
 float q=dot(vGaussian,vGaussian),g=exp(-.5*q),thickness=vTau*g;if(thickness<.0001)discard;

 vec4 h=uInverseProjection*vec4(gl_FragCoord.xy/uResolution*2.-1.,1,1);vec3 ray=normalize(mat3(uCameraMatrix)*(h.xyz/h.w));
 vec3 relative=uEye-uBall;float b=dot(relative,ray),disc=b*b-dot(relative,relative)+uBallRadius*uBallRadius;
 if(disc>0.&&b<0.&&-b-sqrt(disc)<dot(vCenter-uEye,ray))discard;
 float depth=vLinearDepth-vSigma*1.2*exp(-q*.25),weight=thickness*exp(clamp(-(depth-uNearestDepth)*2.5,-30.,10.));
 outColor=vec4(weight,depth*weight,thickness,vFoam*weight);
}`;
