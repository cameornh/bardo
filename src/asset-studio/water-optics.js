// The interface and detached liquid use the same linear-light transport.
// Reconstruct metres along the view ray from the original (pre-water) depth.
export const medium = /* glsl */`
 uniform sampler2D sceneColor,sceneDepth;
 uniform vec2 viewport;
 uniform vec3 color;
 uniform float absorption,scattering,opacity,ior;
 uniform mat4 inverseProjection;
 vec3 viewPoint(vec2 uv,float depth){
  vec4 h=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
  return h.xyz/h.w;
 }
 vec3 inWater(vec3 incident,float travel){
  float concentration=.3+1.6*opacity;
  vec3 tint=vec3(.009)+.14*color;
  vec3 sigmaS=scattering*tint/max(tint.r,max(tint.g,tint.b));
  vec3 filterColor=color/max(.001,max(color.r,max(color.g,color.b)));
  vec3 extinction=sigmaS+(.06+(1.-sqrt(color))*.4+absorption*(1.-.85*filterColor))*concentration;
  vec3 transmission=exp(-extinction*min(travel,100.));
  vec3 scatter=env(vec3(0.,1.,0.),1.)*.88*sigmaS/extinction;
  return incident*transmission+scatter*(1.-transmission);
 }`;
export const interfaceOptics = /* glsl */`
 uniform sampler2D mirrorColor;
 #ifdef PARCEL_OPTICS
 uniform sampler2D bulkColor,bulkDepth;
 #endif
 uniform vec3 skyColor,boundsMin,boundsMax;
 uniform vec4 properties;
 uniform mat4 mirrorVP,projectionMatrix;
 uniform float submerged;uniform bool finiteBed;
 vec3 opticalSurface(vec3 p,vec3 normal,float thickness,float bubbles){
  vec3 incident=normalize(p-cameraPosition),n=faceforward(normal,incident,normal);
  vec3 vp=(viewMatrix*vec4(p,1.)).xyz;
  vec2 uv=gl_FragCoord.xy/viewport;
  bool under=submerged>.5;
  float eta=under?ior:1./ior;
  vec3 transmitted=refract(incident,n,eta),reflected=reflect(incident,n);
  float f0=pow((ior-1.)/(ior+1.),2.);
  float fresnel=f0+(1.-f0)*pow(1.-clamp(-dot(incident,n),0.,1.),5.);
  if(dot(transmitted,transmitted)<.01)fresnel=1.;
  vec3 through=skyColor;
  vec3 travelDir=mat3(viewMatrix)*transmitted;float travel=100.;
  bool parcel=thickness>0.;
  #ifdef PARCEL_OPTICS
  if(parcel){
   // See the already shaded moving ocean through both sides of a detached drop.
   vec4 bent=projectionMatrix*vec4(vp+travelDir*thickness,1.);
   vec2 tap=clamp(bent.xy/max(.001,bent.w)*.5+.5,vec2(0.),vec2(1.));
   float z=texture2D(sceneDepth,tap).r,wz=texture2D(bulkDepth,tap).r;
   if(viewPoint(tap,min(z,wz)).z>vp.z+.004){tap=uv;z=texture2D(sceneDepth,tap).r;wz=texture2D(bulkDepth,tap).r;}
   through=wz<z?texture2D(bulkColor,tap).rgb:texture2D(sceneColor,tap).rgb;
   travel=thickness;
  }else
  #endif
  {
   // A finite pond has a visible bed behind the interface. At silhouettes
   // the bent ray can leave the depth image: use the original sight line's
   // thickness and radiance there, continuously tending to zero at the bank.
   if(finiteBed&&!under){
    float bedDepth=texture2D(sceneDepth,uv).r;
    if(bedDepth<1.){
     vec3 bed=viewPoint(uv,bedDepth);
     travel=max(0.,vp.z-bed.z)*min(4.,length(vp)/max(.02,-vp.z));
     through=texture2D(sceneColor,uv).rgb;
    }
   }
   // March the refracted ray against the source depth. A single UV offset
   // duplicates silhouettes when the original pixel straddles a depth edge.
   vec3 safeDir=mix(vec3(.000001),transmitted,greaterThan(abs(transmitted),vec3(.000001)));
   vec3 a=(boundsMin-p)/safeDir,b=(boundsMax-p)/safeDir,nearT=min(a,b),farT=max(a,b);
   float lo=max(.006,max(nearT.x,max(nearT.y,nearT.z))),last=min(farT.x,min(farT.y,farT.z));
   float stride=.13,hi=lo;
   for(int i=0;i<11;i++){
    if(boundsMax.x<boundsMin.x||hi>last+.13)break;
    vec3 candidate=vp+travelDir*hi;vec4 clip=projectionMatrix*vec4(candidate,1.);
    vec2 tap=clip.xy/max(.001,clip.w)*.5+.5;
    if(clip.w<=0.||any(lessThan(tap,vec2(0.)))||any(greaterThan(tap,vec2(1.))))break;
    float d=texture2D(sceneDepth,tap).r;float sceneZ=viewPoint(tap,d).z;
    if(d<.999999&&sceneZ<vp.z-.001&&candidate.z<=sceneZ){
     for(int j=0;j<4;j++){
      float m=.5*(lo+hi);vec3 c=vp+travelDir*m;vec4 cp=projectionMatrix*vec4(c,1.);
      vec2 mid=cp.xy/cp.w*.5+.5;float z=viewPoint(mid,texture2D(sceneDepth,mid).r).z;
      if(z<vp.z-.001&&c.z<=z){hi=m;tap=mid;}else lo=m;
     }
     through=texture2D(sceneColor,tap).rgb;travel=hi;break;
    }
    lo=hi;hi+=stride;stride=stride*1.6+.02;
   }
  }
  if(!under||parcel)through=inWater(through,travel);
  vec3 reflection=env(reflected,0.);
  if(!under){
   vec4 projected=mirrorVP*vec4(p,1.);
   vec3 planarRay=reflect(incident,vec3(0.,1.,0.));
   vec4 shifted=mirrorVP*vec4(p+(reflected-planarRay)*min(2.,.22*length(vp)),1.);
   vec2 mu=shifted.xy/max(.001,shifted.w)*.5+.5;
   if(projected.w>0.&&all(greaterThan(mu,vec2(0.)))&&all(lessThan(mu,vec2(1.)))){
    vec4 mirrored=texture2D(mirrorColor,mu);reflection=mix(reflection,mirrored.rgb,mirrored.a);
   }
  }else reflection=inWater(reflection,32.);
  reflection=mix(reflection,env(n,1.),.65*properties.x*properties.x);
  vec3 radiance=mix(through,reflection,fresnel);
  float glint=pow(max(0.,dot(reflected,normalize(vec3(-.6,1.,.5)))),mix(180.,14.,properties.x*properties.x));
  radiance+=vec3(1.,.94,.8)*glint*.32;
  radiance=mix(radiance,env(n,1.)*vec3(.93,.98,1.),bubbles);
  return under?inWater(radiance,length(vp)):radiance;
 }`;
