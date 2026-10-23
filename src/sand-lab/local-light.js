// One emitter convention for surfaces, participating water and fine particles.
// Values are linear scene radiance, before exposure.
export const LIGHT_BALL_RADIANCE=7;
export const LOCAL_LIGHT_GLSL=`
const float LIGHT_BALL_RADIANCE=${LIGHT_BALL_RADIANCE.toFixed(1)};
vec3 objectLight(vec3 p,int i){
 vec4 b=labBody(i);vec3 delta=b.xyz-p;float distance=length(delta),travel=max(0.,distance-b.w),radius=max(.00001,b.w);
 vec3 direction=delta/max(.00001,distance),tau=vec3(0);
 // Clip extinction to the water atlas before sampling. Spreading a few
 // samples over a long air path missed the entire water volume and made
 // the horizon brighter than nearby sand under the same submerged lamp.
 vec3 inv=1./(direction+vec3(1e-12)),low=(uFieldOrigin-p)*inv,high=(uFieldOrigin+(uFieldSize-1.)*uFieldDx-p)*inv;
 vec3 nearT=min(low,high),farT=max(low,high);
 float begin=max(0.,max(nearT.x,max(nearT.y,nearT.z))),end=min(travel,min(farT.x,min(farT.y,farT.z))),stepSize=max(0.,end-begin)/8.;
 for(int k=0;k<8;k++){
  vec3 q=p+direction*(begin+(float(k)+.5)*stepSize);vec4 a=parcelSample(q);
  tau+=soluteExtinction(a.yzw/max(.001,a.x),uTannins,uTurbidity)*smoothstep(.12,.24,a.x)*stepSize*uScale;
 }
 // Conservative terrain steps also prevent light escaping through the beach.
 float t=.001;
 for(int k=0;k<32;k++){
  if(t>=travel)break;vec3 q=p+direction*t;float h=labOpaque(q);
  if(h<-.00003)return vec3(0);t+=max(.002,h*.7);
 }
 return bodyExtra(i,0).rgb*uLights*LIGHT_BALL_RADIANCE*radius*radius/(radius*radius+distance*distance)*exp(-tau)*bodyTransmissionExcept(p,direction,max(.001,travel),uScale,radius*.4,0.,i);
}
vec3 objectVolumeIncident(vec3 q,vec3 ray){
 vec3 incident=vec3(0);
 for(int i=0;i<uBodyCount;i++)if(texelFetch(uBodies,ivec2((i*2+1)%256,(i*2+1)/256),0).w>2.5){
  vec4 b=labBody(i);vec3 delta=b.xyz-q;
  // A nearby spherical emitter subtends a finite angle. The point-source
  // forward peak must broaden instead of making a halo brighter than its face.
  float g=.55*(1.-clamp(b.w/max(b.w,length(delta)),0.,1.));
  incident+=objectLight(q,i)*3.14159265*phaseHG(dot(ray,normalize(delta+vec3(0,1e-12,0))),g);
 }return incident;
}`;
